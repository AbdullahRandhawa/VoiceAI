"""
OpenRouter service — handles all AI API calls:
  - transcribe_audio()  → STT via mistralai/voxtral-mini-transcribe
  - chat_stream()       → LLM stream via deepseek/deepseek-v4-flash
  - text_to_speech()    → TTS via hexgrad/kokoro-82m
"""
import json
import httpx
import base64
import subprocess
import tempfile
import os
from typing import AsyncGenerator
from config import settings

_HEADERS = {
    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
    "HTTP-Referer": settings.OPENROUTER_REFERER,
    "X-Title": settings.OPENROUTER_SITE_NAME,
}


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Convert audio bytes → transcript string via OpenRouter STT.

    Tries ffmpeg conversion to WAV first for maximum compatibility.
    Falls back to sending raw bytes if ffmpeg is unavailable.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"

    wav_bytes: bytes | None = None

    # ── Try ffmpeg conversion ──────────────────────────────────────────────
    f_in_path = None
    f_out_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f_in:
            f_in.write(audio_bytes)
            f_in_path = f_in.name

        f_out_path = f_in_path + ".wav"

        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", f_in_path,
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                f_out_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0:
            with open(f_out_path, "rb") as fout:
                wav_bytes = fout.read()
            print(f"[STT] ffmpeg: {ext} ({len(audio_bytes)}B) → WAV ({len(wav_bytes)}B)")
        else:
            stderr = result.stderr.decode("utf-8", errors="ignore")
            print(f"[STT] ffmpeg failed (code {result.returncode}): {stderr[-200:]}")
    except FileNotFoundError:
        print("[STT] ffmpeg not found — sending raw audio bytes")
    except subprocess.TimeoutExpired:
        print("[STT] ffmpeg timed out — sending raw audio bytes")
    except Exception as e:
        print(f"[STT] ffmpeg error: {e}")
    finally:
        if f_in_path and os.path.exists(f_in_path):
            os.unlink(f_in_path)
        if f_out_path and os.path.exists(f_out_path):
            os.unlink(f_out_path)

    # Use converted WAV if available, otherwise raw bytes
    if wav_bytes:
        send_bytes = wav_bytes
        send_mime = "audio/wav"
        send_name = "audio.wav"
    else:
        send_bytes = audio_bytes
        send_mime = f"audio/{ext}" if ext != "webm" else "audio/webm"
        send_name = filename

    print(f"[STT] Sending {len(send_bytes)}B as {send_mime} to model={settings.STT_MODEL}")

    headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}

    # ── Try multipart/form-data upload (standard OpenAI-compatible) ────────
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
            headers=headers,
            files={"file": (send_name, send_bytes, send_mime)},
            data={"model": settings.STT_MODEL},
        )

        if response.status_code == 200:
            body = response.json()
            text = body.get("text", "").strip()
            print(f"[STT] Transcript: '{text}'")
            return text

        # Some models (voxtral) need base64 JSON format — try that
        if response.status_code in (400, 422):
            print(f"[STT] Multipart failed ({response.status_code}), trying base64 JSON…")
            b64 = base64.b64encode(send_bytes).decode()
            audio_fmt = "wav" if wav_bytes else ext
            json_payload = {
                "model": settings.STT_MODEL,
                "input_audio": {
                    "data": b64,
                    "format": audio_fmt,
                },
            }
            resp2 = await client.post(
                f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(json_payload),
            )
            if resp2.status_code == 200:
                body2 = resp2.json()
                text = body2.get("text", "").strip()
                print(f"[STT] Transcript (base64): '{text}'")
                return text
            print(f"[STT] base64 also failed {resp2.status_code}: {resp2.text[:300]}")
            return ""

        print(f"[STT] Error {response.status_code}: {response.text[:300]}")
        return ""


async def chat_stream(
    messages: list[dict],
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens via OpenRouter."""
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


import re as _re

def _strip_markdown(text: str) -> str:
    """Remove markdown formatting symbols so TTS reads clean prose."""
    # Bold/italic: **text**, *text*, __text__, _text_
    text = _re.sub(r'\*{1,3}(.*?)\*{1,3}', r'\1', text)
    text = _re.sub(r'_{1,3}(.*?)_{1,3}', r'\1', text)
    # Headers: ### text
    text = _re.sub(r'#+\s*', '', text)
    # Inline code: `code`
    text = _re.sub(r'`+([^`]*)`+', r'\1', text)
    # Bullet points: - item or * item or • item
    text = _re.sub(r'^[\s]*[-•*]\s+', '', text, flags=_re.MULTILINE)
    # Numbered lists: 1. item
    text = _re.sub(r'^\d+\.\s+', '', text, flags=_re.MULTILINE)
    # Links: [text](url)
    text = _re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Extra whitespace
    text = _re.sub(r'[ \t]+', ' ', text).strip()
    return text


async def text_to_speech(text: str) -> bytes:
    """Convert text → MP3 audio bytes via OpenRouter TTS (Kokoro 82M)."""
    # Strip markdown so the voice reads clean prose, not symbols
    clean_text = _strip_markdown(text)
    if not clean_text:
        clean_text = text  # fallback to original if stripping emptied it

    voice = settings.TTS_VOICE
    # Kokoro voices: af_heart, af_sky, bf_emma, am_adam, bm_lewis
    # Gemini voices are not supported by Kokoro — fall back
    gemini_voices = {"Aoede", "Charon", "Fenrir", "Kore", "Puck"}
    if voice in gemini_voices:
        voice = "af_heart"

    payload = {
        "model": settings.TTS_MODEL,
        "input": clean_text,
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
