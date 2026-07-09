"""
Real-Time Voice Call — WebSocket endpoint.

Approach (per user spec):
  1. Client sends FULL recorded audio blob (binary frame)
  2. Server transcribes via STT                → sends {type:"transcript"}
  3. Server streams LLM tokens                 → sends {type:"token"} per token
  4. As LLM streams, sentences are buffered.
     Each complete sentence → TTS → binary audio frame back to client
  5. Client plays audio chunks in order as they arrive

This gives a natural "sentence-level streaming" feel without requiring
true real-time microphone chunk streaming.
"""
import re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from firebase_admin import auth as firebase_auth
from services import openrouter, firestore as firestore_service

router = APIRouter()

# Sentence boundary detector — splits on ., !, ? followed by whitespace or end
# We use findall to keep the delimiters instead of dropping them
_SENTENCE_END = re.compile(r"([^.!?]+[.!?]+)")


def _split_sentences(text: str) -> tuple[list[str], str]:
    """
    Returns (complete_sentences, leftover_fragment).
    """
    sentences = _SENTENCE_END.findall(text)
    
    # Calculate leftover
    matched_length = sum(len(s) for s in sentences)
    leftover = text[matched_length:]
    
    return sentences, leftover


@router.websocket("/voice-call")
async def voice_call_ws(
    websocket: WebSocket,
    token: str = Query(..., description="Firebase ID token"),
    conversation_id: str = Query(None, description="Optional conversation ID to save messages"),
):
    """
    WebSocket flow:
      client → binary (full audio blob)
      server → JSON {type: "transcript", text: "..."}
      server → JSON {type: "token", text: "..."}  (multiple)
      server → binary (MP3 audio chunk per sentence)
      server → JSON {type: "done"}
    """
    # Validate Firebase token before accepting connection
    try:
        firebase_auth.verify_id_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    try:
        while True:
            # ── 1. Receive full audio blob ───────────────────────────────
            audio_bytes = await websocket.receive_bytes()

            # ── 2. STT ───────────────────────────────────────────────────
            try:
                transcript = await openrouter.transcribe_audio(audio_bytes, "audio.webm")
            except Exception as exc:
                await websocket.send_json(
                    {"type": "error", "message": f"STT failed: {exc}"}
                )
                continue

            if not transcript.strip():
                await websocket.send_json({"type": "transcript", "text": ""})
                continue

            await websocket.send_json({"type": "transcript", "text": transcript})

            if conversation_id:
                # Save user's voice transcript to Firestore
                await firestore_service.save_message(
                    conversation_id,
                    role="user",
                    content=transcript,
                    transcript=transcript
                )

            # ── 3+4. Stream LLM → sentence-level TTS ────────────────────
            buffer = ""
            full_response: list[str] = []

            try:
                async for token in openrouter.chat_stream(
                    [{"role": "user", "content": transcript}]
                ):
                    full_response.append(token)
                    buffer += token

                    # Emit token to UI for live text display
                    await websocket.send_json({"type": "token", "text": token})

                    # Check for complete sentences in buffer
                    sentences, buffer = _split_sentences(buffer)
                    for sentence in sentences:
                        sentence = sentence.strip()
                        if not sentence:
                            continue
                        try:
                            audio_chunk = await openrouter.text_to_speech(sentence)
                            await websocket.send_bytes(audio_chunk)
                        except Exception:
                            pass  # TTS failure for a sentence is non-fatal

                # Flush any remaining text in buffer as last TTS chunk
                if buffer.strip():
                    try:
                        audio_chunk = await openrouter.text_to_speech(buffer.strip())
                        await websocket.send_bytes(audio_chunk)
                    except Exception:
                        pass
                
                # Save AI response to Firestore
                if conversation_id:
                    complete_response = "".join(full_response)
                    await firestore_service.save_message(
                        conversation_id,
                        role="assistant",
                        content=complete_response
                    )

            except Exception as exc:
                await websocket.send_json(
                    {"type": "error", "message": f"LLM error: {exc}"}
                )
                continue

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass
