"""
Central configuration — reads from .env via python-dotenv.
All model names, API keys, and service settings are env-configurable.
Change any value in .env without touching source code.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ── OpenRouter ─────────────────────────────────────────────────────────
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_BASE_URL: str = os.getenv(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    )
    OPENROUTER_REFERER: str = os.getenv("OPENROUTER_REFERER", "http://localhost:5173")
    OPENROUTER_SITE_NAME: str = os.getenv("OPENROUTER_SITE_NAME", "AI Voice Assistant")

    # ── AI Models (all swappable via env) ──────────────────────────────────
    # LLM for chat completions
    LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek/deepseek-chat-v3-0324")
    # Speech-to-Text transcription
    STT_MODEL: str = os.getenv("STT_MODEL", "openai/gpt-4o-mini-transcribe")
    # Text-to-Speech synthesis
    TTS_MODEL: str = os.getenv("TTS_MODEL", "google/gemini-3.1-flash-tts-preview")
    # TTS voice character (provider-specific options)
    TTS_VOICE: str = os.getenv("TTS_VOICE", "Aoede")

    # ── Firebase Admin SDK ─────────────────────────────────────────────────
    FIREBASE_CREDENTIALS_PATH: str = os.getenv(
        "FIREBASE_CREDENTIALS_PATH", "firebase-adminsdk.json"
    )

    # ── Cloudinary ─────────────────────────────────────────────────────────
    CLOUDINARY_CLOUD_NAME: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    CLOUDINARY_API_KEY: str = os.getenv("CLOUDINARY_API_KEY", "")
    CLOUDINARY_API_SECRET: str = os.getenv("CLOUDINARY_API_SECRET", "")

    # ── App ────────────────────────────────────────────────────────────────
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
    # Max conversation history messages sent to LLM
    MAX_HISTORY: int = int(os.getenv("MAX_HISTORY", "20"))


settings = Settings()

