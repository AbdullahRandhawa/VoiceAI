"""
OpenRouter service — handles all AI API calls:
  - transcribe_audio()  → STT via openai/gpt-4o-mini-transcribe
  - chat_stream()       → LLM stream via deepseek/deepseek-chat-v3-0324
  - text_to_speech()    → TTS via google/gemini-3.1-flash-tts-preview
"""
import json
import httpx
from typing import AsyncGenerator
from config import settings

_HEADERS = {
    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
    "HTTP-Referer": settings.OPENROUTER_REFERER,
    "X-Title": settings.OPENROUTER_SITE_NAME,
}


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Convert audio bytes → transcript string via OpenRouter STT."""
    # Detect MIME type from filename
    ext = filename.rsplit(".", 1)[-1].lower()
    mime_map = {"webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg"}
    mime = mime_map.get(ext, "audio/webm")

    headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
            headers=headers,
            files={"file": (filename, audio_bytes, mime)},
            data={"model": settings.STT_MODEL},
        )
        response.raise_for_status()
        return response.json().get("text", "").strip()


async def chat_stream(
    messages: list[dict],
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens from DeepSeek via OpenRouter."""
    payload_messages: list[dict] = []
    if system_prompt:
        payload_messages.append({"role": "system", "content": system_prompt})
    payload_messages.extend(messages)

    payload = {
        "model": settings.LLM_MODEL,
        "messages": payload_messages,
        "stream": True,
        "max_tokens": 1024,
        "temperature": 0.7,
    }

    headers = {**_HEADERS, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for raw_line in response.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str == "[DONE]":
                    return
                try:
                    chunk = json.loads(data_str)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def text_to_speech(text: str) -> bytes:
    """Convert text → MP3 audio bytes via OpenRouter TTS."""
    payload = {
        "model": settings.TTS_MODEL,
        "input": text,
        "voice": settings.TTS_VOICE,
    }
    headers = {**_HEADERS, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/speech",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        return response.content
