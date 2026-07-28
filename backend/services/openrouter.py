"""
OpenRouter service — handles all AI API calls:
  - transcribe_audio()  → STT via mistralai/voxtral-mini-transcribe
  - chat_stream()       → LLM stream via deepseek/deepseek-v4-flash
  - text_to_speech()    → TTS via hexgrad/kokoro-82m

Performance notes:
  - Single persistent httpx.AsyncClient — eliminates TCP handshake overhead per call.
  - ffmpeg conversion uses asyncio.create_subprocess_exec — non-blocking event loop.
"""
import json
import httpx
import base64
import asyncio
import tempfile
import io
import os
import re as _re
import shutil
from typing import AsyncGenerator
from config import settings

_HEADERS = {
    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
    "HTTP-Referer": settings.OPENROUTER_REFERER,
    "X-Title": settings.OPENROUTER_SITE_NAME,
}

# ── Persistent HTTP client ────────────────────────────────────────────────────
# Shared across all requests — avoids creating a new TCP connection per call.
_client: httpx.AsyncClient | None = None


def _get_ffmpeg_cmd() -> str:
    """Find system ffmpeg or fallback to imageio_ffmpeg binary."""
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=90.0, write=30.0, pool=5.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


# ── STT ───────────────────────────────────────────────────────────────────────

async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Convert audio bytes → transcript string via OpenRouter STT.

    Uses asyncio subprocess for ffmpeg so the event loop is never blocked.
    Falls back to raw bytes if ffmpeg is unavailable.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"

    wav_bytes: bytes | None = None
    f_in_path: str | None = None
    f_out_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f_in:
            f_in.write(audio_bytes)
            f_in_path = f_in.name
        f_out_path = f_in_path + ".wav"

        # Non-blocking async subprocess — does NOT block the event loop
        proc = await asyncio.create_subprocess_exec(
            _get_ffmpeg_cmd(), "-y",
            "-i", f_in_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            f_out_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            if proc.returncode == 0:
                with open(f_out_path, "rb") as fout:
                    wav_bytes = fout.read()
                print(f"[STT] ffmpeg: {ext} ({len(audio_bytes)}B) → WAV ({len(wav_bytes)}B)")
            else:
                print(f"[STT] ffmpeg failed (code {proc.returncode}): {stderr.decode('utf-8', 'ignore')[-200:]}")
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            print("[STT] ffmpeg timed out — sending raw audio bytes")
    except FileNotFoundError:
        print("[STT] ffmpeg not found — sending raw audio bytes")
    except Exception as e:
        print(f"[STT] ffmpeg error: {e}")
    finally:
        for p in (f_in_path, f_out_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass

    if wav_bytes:
        send_bytes, send_mime, send_name = wav_bytes, "audio/wav", "audio.wav"
    else:
        send_bytes = audio_bytes
        send_mime = f"audio/{ext}" if ext != "webm" else "audio/webm"
        send_name = filename

    print(f"[STT] Sending {len(send_bytes)}B as {send_mime} → model={settings.STT_MODEL}")

    auth_header = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}
    client = await _get_client()

    response = await client.post(
        f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
        headers=auth_header,
        files={"file": (send_name, send_bytes, send_mime)},
        data={"model": settings.STT_MODEL},
    )

    if response.status_code == 200:
        text = response.json().get("text", "").strip()
        print(f"[STT] Transcript: '{text}'")
        return text

    # Fallback: base64 JSON format (voxtral compatibility)
    if response.status_code in (400, 422):
        print(f"[STT] Multipart failed ({response.status_code}), trying base64 JSON…")
        b64 = base64.b64encode(send_bytes).decode()
        resp2 = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/audio/transcriptions",
            headers={**auth_header, "Content-Type": "application/json"},
            content=json.dumps({
                "model": settings.STT_MODEL,
                "input_audio": {"data": b64, "format": "wav" if wav_bytes else ext},
            }),
        )
        if resp2.status_code == 200:
            text = resp2.json().get("text", "").strip()
            print(f"[STT] Transcript (base64): '{text}'")
            return text
        print(f"[STT] base64 also failed {resp2.status_code}: {resp2.text[:300]}")
        return ""

    print(f"[STT] Error {response.status_code}: {response.text[:300]}")
    return ""


# ── LLM ───────────────────────────────────────────────────────────────────────

async def chat_stream(
    messages: list[dict],
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens via OpenRouter using the persistent client."""
    payload_messages: list[dict] = []
    if system_prompt:
        payload_messages.append({"role": "system", "content": system_prompt})
    payload_messages.extend(messages)

    payload = {
        "model": settings.LLM_MODEL,
        "messages": payload_messages,
        "stream": True,
        "max_tokens": 300,   # Voice: 1-3 short sentences. 300 tokens is plenty.
        "temperature": 0.7,
    }

    client = await _get_client()
    async with client.stream(
        "POST",
        f"{settings.OPENROUTER_BASE_URL}/chat/completions",
        headers={**_HEADERS, "Content-Type": "application/json"},
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


# ── TTS ───────────────────────────────────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    """Remove markdown formatting symbols so TTS reads clean prose."""
    text = _re.sub(r'\*{1,3}(.*?)\*{1,3}', r'\1', text)
    text = _re.sub(r'_{1,3}(.*?)_{1,3}', r'\1', text)
    text = _re.sub(r'#+\s*', '', text)
    text = _re.sub(r'`+([^`]*)`+', r'\1', text)
    text = _re.sub(r'^[\s]*[-•*]\s+', '', text, flags=_re.MULTILINE)
    text = _re.sub(r'^\d+\.\s+', '', text, flags=_re.MULTILINE)
    text = _re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = _re.sub(r'[ \t]+', ' ', text).strip()
    return text


# ── Voice map: env vars / kokoro names → Microsoft Azure Neural voice IDs ─────
_VOICE_MAP: dict[str, str] = {
    # Kokoro / af_ voices (female)
    "af_heart":   "en-US-AvaNeural",
    "af_sky":     "en-US-AriaNeural",
    "bf_emma":    "en-GB-LibbyNeural",
    # Kokoro / am_ voices (male)
    "am_adam":    "en-US-AndrewNeural",
    "bm_lewis":   "en-GB-RyanNeural",
    # Google / Gemini TTS voice names that may be stored in env
    "Aoede":      "en-US-AvaNeural",
    "Charon":     "en-US-AndrewNeural",
    "Fenrir":     "en-US-BrianNeural",
    "Kore":       "en-US-EmmaNeural",
    "Puck":       "en-US-GuyNeural",
    # x-ai / grok voice names
    "x-ai/grok-voice-tts-1.0": "en-US-AvaNeural",
}


async def text_to_speech(text: str) -> bytes:
    """Convert text → MP3 audio bytes via edge-tts (Microsoft Azure Neural TTS).

    edge-tts is free, requires no API key, and returns low-latency MP3 audio.
    Voices are mapped from env/kokoro naming conventions to Azure Neural voice IDs.
    """
    import edge_tts

    clean_text = _strip_markdown(text) or text

    # Resolve configured voice name to an Azure Neural voice ID
    raw_voice = settings.TTS_VOICE
    azure_voice = _VOICE_MAP.get(raw_voice, _VOICE_MAP.get(settings.TTS_MODEL, "en-US-AvaNeural"))

    buffer = io.BytesIO()
    communicate = edge_tts.Communicate(clean_text, azure_voice)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.write(chunk["data"])

    mp3_bytes = buffer.getvalue()
    if not mp3_bytes:
        raise RuntimeError("edge-tts returned empty audio — check voice name and text input")

    print(f"[TTS] edge-tts synthesized {len(mp3_bytes)}B MP3 (voice={azure_voice})")
    return mp3_bytes
