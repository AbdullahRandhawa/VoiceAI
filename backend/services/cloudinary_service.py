"""
Cloudinary service — audio file upload/management.
"""
import asyncio
import io
import uuid

import cloudinary
import cloudinary.uploader
from config import settings

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)


async def upload_audio(audio_bytes: bytes, public_id: str | None = None) -> dict:
    """Upload raw audio bytes to Cloudinary. Returns {url, public_id}."""

    def _upload():
        pid = public_id or f"ai-voice-assistant/{uuid.uuid4().hex}"
        result = cloudinary.uploader.upload(
            io.BytesIO(audio_bytes),
            resource_type="auto",
            folder="ai-voice-assistant",
            public_id=pid,
            overwrite=True,
        )
        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
        }

    return await asyncio.to_thread(_upload)
