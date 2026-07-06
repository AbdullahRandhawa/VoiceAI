"""
Chat router — text message → streaming LLM response (SSE).
"""
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routers.auth import get_current_user
from services import firestore as firestore_service
from services import openrouter

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a helpful, intelligent AI voice assistant. "
    "Be concise, clear, and conversational. "
    "When speaking your responses aloud, use natural language that is easy to listen to. "
    "Avoid excessive bullet points or markdown when a voice context is implied."
)


class ChatRequest(BaseModel):
    conversation_id: str
    message: str


@router.post("/")
async def chat(body: ChatRequest, user: dict = Depends(get_current_user)):
    """
    Send a text message and receive a Server-Sent Events (SSE) stream.

    Events emitted:
      data: {"token": "..."} — partial LLM output
      data: {"done": true, "message_id": "..."} — stream complete
    """
    # Load existing history for context (last 20 messages)
    history = await firestore_service.get_messages(body.conversation_id)
    is_first_message = len(history) == 0

    # Persist the user's message immediately
    await firestore_service.save_message(
        body.conversation_id, "user", body.message
    )

    # Build message list for the LLM
    llm_messages = [
        {"role": m["role"], "content": m["content"]} for m in history[-20:]
    ]
    llm_messages.append({"role": "user", "content": body.message})

    full_response: list[str] = []

    async def generate():
        async for token in openrouter.chat_stream(llm_messages, SYSTEM_PROMPT):
            full_response.append(token)
            yield f"data: {json.dumps({'token': token})}\n\n"

        complete = "".join(full_response)

        # Persist assistant message
        saved = await firestore_service.save_message(
            body.conversation_id, "assistant", complete
        )

        # Auto-title the conversation from the first user message
        if is_first_message:
            short_title = body.message[:60] + ("…" if len(body.message) > 60 else "")
            await firestore_service.update_conversation_title(
                body.conversation_id, short_title
            )

        yield f"data: {json.dumps({'done': True, 'message_id': saved['id']})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
