"""
Chat router — text message → streaming LLM response (SSE).
LLM streaming finishes → save to DB immediately → emit done → TTS generated in background → emit audio_ready.
"""
import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routers.auth import get_current_user
from services import cloudinary_service, firestore as firestore_service, openrouter

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a sophisticated, adaptive AI companion acting seamlessly across voice calls and text chat. "
    "Your guiding principle is to match your formatting directly to the nature of the user's request.\n\n"
    
    "1. FOR TEXT & STRUCTURED REQUESTS (Coding, Data, Complex Explanations):\n"
    "- Always use strict, perfectly structured Markdown format.\n"
    "- For code: Always wrap snippets in explicit code blocks with the language identifier specified "
    "(e.g., ```typescript ... ```) so the UI can render copy-paste containers.\n"
    "- For structured data/comparisons: Always format using standard Markdown pipe tables "
    "with clear headers (e.g., | Header | Header |) so the frontend can properly align elements.\n"
    "- Use bolding and concise bullet points to keep information scannable.\n\n"
    
    "2. FOR VOICE CALLS & CONVERSATIONAL MOMENTS:\n"
    "- Keep responses brief, engaging, and entirely conversational.\n"
    "- Avoid reading out raw markdown characters, symbols, or list numbers aloud.\n"
    "- Speak in natural, human-like cadences that are easy to listen to while streaming.\n\n"
    
    "Contextually judge every input. If the user asks for code or a table, prioritize flawless layout delivery. "
    "Otherwise, speak clearly and straight to the point."
)


class ChatRequest(BaseModel):
    chat_id: str
    message: str
    skip_user_save: bool = False


@router.post("/")
async def chat(body: ChatRequest, user: dict = Depends(get_current_user)):
    """
    Send a text message and receive a Server-Sent Events (SSE) stream.

    Events emitted (in order):
      data: {"token": "..."}                  — partial LLM output
      data: {"done": true, "message_id": "...", "audio_generating": true}  — stream complete, TTS running in bg
      data: {"audio_ready": true, "message_id": "...", "audio_url": "..."} — TTS finished
    """
    # Fetch history and save user message in parallel
    history_task = asyncio.create_task(
        firestore_service.get_chat_messages(body.chat_id)
    )
    if not body.skip_user_save:
        # Fire user message save in background — don't block LLM start
        asyncio.create_task(
            firestore_service.save_chat_message(
                body.chat_id, "user", body.message
            )
        )

    history = await history_task
    is_first_message = len(history) == 0

    llm_messages = [
        {"role": m["role"], "content": m["content"]} for m in history[-20:]
    ]
    llm_messages.append({"role": "user", "content": body.message})

    full_response: list[str] = []
    saved_message_id = None

    async def generate():
        nonlocal saved_message_id

        # Start LLM streaming immediately
        async for token in openrouter.chat_stream(llm_messages, SYSTEM_PROMPT):
            full_response.append(token)
            yield f"data: {json.dumps({'token': token})}\n\n"

        complete = "".join(full_response)

        # ── Save to DB immediately (no audio_url yet) ─────────────────────
        saved = await firestore_service.save_chat_message(
            body.chat_id, "assistant", complete, audio_url=None
        )
        saved_message_id = saved["id"]

        if is_first_message:
            short_title = body.message[:60] + ("…" if len(body.message) > 60 else "")
            await firestore_service.update_chat_title(
                body.chat_id, short_title
            )

        # Tell client the text response is done (audio is still generating)
        yield f"data: {json.dumps({'done': True, 'message_id': saved_message_id, 'audio_generating': True})}\n\n"

        # ── Generate TTS in background and push audio_ready event ─────────
        audio_url = await generate_tts_background(complete)
        if audio_url and saved_message_id:
            # Update the stored message with the audio URL
            try:
                await firestore_service.update_chat_message_audio(
                    body.chat_id, saved_message_id, audio_url
                )
            except Exception:
                pass
            yield f"data: {json.dumps({'audio_ready': True, 'message_id': saved_message_id, 'audio_url': audio_url})}\n\n"
        else:
            yield f"data: {json.dumps({'audio_ready': True, 'message_id': saved_message_id, 'audio_url': None})}\n\n"

    async def generate_tts_background(text: str) -> str | None:
        """Generate TTS audio and upload to Cloudinary. Returns URL or None."""
        try:
            audio_bytes = await openrouter.text_to_speech(text)
            upload = await cloudinary_service.upload_audio(audio_bytes, filename="audio.mp3")
            return upload["url"]
        except Exception:
            return None

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
