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


import subprocess
import tempfile
import os

async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Convert audio bytes → transcript string via Whisper on OpenRouter.
    
    Strategy: Use ffmpeg to convert any browser audio format (webm/opus, mp4, ogg)
    into a 16kHz mono WAV, then send to whisper-large-v3 which handles WAV reliably.
    """
    # Determine input extension from filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    
    # Write input to a temp file
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f_in:
        f_in.write(audio_bytes)
        f_in_path = f_in.name
    
    f_out_path = f_in_path + ".wav"
    
    try:
        # Convert to 16kHz mono WAV — universally accepted by Whisper
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", f_in_path,
                "-ar", "16000",   # 16kHz sample rate
                "-ac", "1",       # mono
                "-c:a", "pcm_s16le",  # 16-bit PCM (standard WAV)
                f_out_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="ignore")
            print(f"[STT] ffmpeg conversion failed: {stderr[-300:]}")
            return ""
        
        with open(f_out_path, "rb") as f_out:
            wav_bytes = f_out.read()
        
        print(f"[STT] Converted {ext} ({len(audio_bytes)}B) → WAV ({len(wav_bytes)}B)")
    except subprocess.TimeoutExpired:
        print("[STT] ffmpeg timed out")
        return ""
    except Exception as e:
        print(f"[STT] ffmpeg error: {e}")
        return ""
    finally:
        if os.path.exists(f_in_path):
            os.unlink(f_in_path)
        if os.path.exists(f_out_path):
            os.unlink(f_out_path)
    
    # Send WAV to Whisper via OpenRouter
    headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
            headers=headers,
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            data={"model": settings.STT_MODEL},
        )
        if response.status_code != 200:
            print(f"[STT] OpenRouter error {response.status_code}: {response.text}")
            return ""
        text = response.json().get("text", "").strip()
        print(f"[STT] Transcript: '{text}'")
        return text



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
        "max_tokens": 500,
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
    """Convert text → MP3 audio bytes via OpenRouter TTS (Kokoro 82M)."""
    # Kokoro voices: af_heart, af_sky, bf_emma, am_adam, bm_lewis, etc.
    # If TTS_VOICE is set to a Gemini voice like 'Aoede', fall back to af_heart
    voice = settings.TTS_VOICE
    gemini_voices = {"Aoede", "Charon", "Fenrir", "Kore", "Puck"}
    if voice in gemini_voices:
        voice = "af_heart"

    payload = {
        "model": settings.TTS_MODEL,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
    }
    headers = {**_HEADERS, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/speech",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        return response.content
