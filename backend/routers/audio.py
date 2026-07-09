"""
Audio router — voice message transcription + TTS generation.
"""
from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from routers.auth import get_current_user
from services import cloudinary_service, firestore as firestore_service, openrouter

router = APIRouter()


# ── POST /audio/transcribe ───────────────────────────────────────────────────

@router.post("/transcribe")
async def transcribe_voice_message(
    audio: UploadFile = File(...),
    conversation_id: str = Form(...),
    user: dict = Depends(get_current_user),
):
    """
    Receives an audio blob, transcribes it via OpenRouter (STT),
    uploads audio to Cloudinary, and saves the message to Firestore.
    """
    audio_bytes = await audio.read()
    filename = audio.filename or "audio.webm"

    # Run STT and Cloudinary upload concurrently
    import asyncio
    transcript, upload = await asyncio.gather(
        openrouter.transcribe_audio(audio_bytes, filename),
        cloudinary_service.upload_audio(audio_bytes, filename=filename),
    )

    saved = await firestore_service.save_message(
        conversation_id,
        role="user",
        content=transcript,
        audio_url=upload["url"],
        transcript=transcript,
    )
    return {
        "transcript": transcript,
        "audio_url": upload["url"],
        "message_id": saved["id"],
    }


# ── POST /audio/tts ──────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str


@router.post("/tts")
async def generate_tts(body: TTSRequest, user: dict = Depends(get_current_user)):
    """
    Converts text → audio, uploads to Cloudinary, returns the URL.
    Used by the frontend to generate playback audio for assistant messages.
    """
    audio_bytes = await openrouter.text_to_speech(body.text)
    upload = await cloudinary_service.upload_audio(audio_bytes, filename="audio.mp3")
    return {"audio_url": upload["url"]}
