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


async def upload_audio(audio_bytes: bytes, filename: str = "audio.mp3", public_id: str | None = None) -> dict:
    """Upload raw audio bytes to Cloudinary. Returns {url, public_id}."""

    def _upload():
        pid = public_id or f"ai-voice-assistant/{uuid.uuid4().hex}"
        result = cloudinary.uploader.upload(
            io.BytesIO(audio_bytes),
            resource_type="video",
            folder="ai-voice-assistant",
            public_id=pid,
            overwrite=True,
            filename=filename,
        )
        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
        }

    return await asyncio.to_thread(_upload)


async def delete_audio_by_url(url: str) -> None:
    """Extract the public_id from a Cloudinary URL and delete it."""
    def _delete():
        # URL pattern: .../video/upload/v12345/folder/name.ext
        # We need everything after /upload/vXXXXXX/
        import re
        match = re.search(r'/upload/(?:v\d+/)?(.+?)(?:\.\w+)?$', url)
        if not match:
            return
        public_id = match.group(1)
        try:
            cloudinary.uploader.destroy(public_id, resource_type="video")
        except Exception:
            pass

    await asyncio.to_thread(_delete)
