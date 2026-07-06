"""
FastAPI application entry point.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import audio, chat, conversations, voice_call

app = FastAPI(
    title="AI Voice Assistant API",
    description="Backend for the AI Voice Assistant — STT, LLM streaming, TTS, and real-time voice calls.",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(chat.router, prefix="/chat", tags=["Chat"])
app.include_router(audio.router, prefix="/audio", tags=["Audio"])
app.include_router(conversations.router, prefix="/conversations", tags=["Conversations"])
app.include_router(voice_call.router, prefix="/ws", tags=["Voice Call"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": "1.0.0"}
