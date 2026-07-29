# VoiceAI — AI Voice Assistant

A full-stack AI voice assistant that supports real-time voice calls, streaming LLM chat (SSE), STT transcription and TTS synthesis. The project pairs a FastAPI backend that orchestrates STT / LLM / TTS and persistence with a Vite + React frontend.

## Key features
- Real-time voice calls over WebSocket with low-latency pipeline: STT → streaming LLM tokens → parallel TTS → ordered audio playback and recording.
- Text chat endpoint that streams LLM tokens as Server-Sent Events (SSE) and produces TTS audio in the background.
- Firestore (Firebase) persistence for chats and call sessions.
- Cloudinary upload for storing generated audio recordings.
- Configurable model providers (OpenRouter/OpenAI/etc.) and swappable model names via environment variables.

---

## Stack
- Language(s): JavaScript (frontend), Python (backend)
- Framework / runtime:
  - Backend: FastAPI (ASGI)
  - Frontend: React (Vite)
- Notable libraries & services:
  - Firebase (auth + Firestore)
  - Cloudinary (audio uploads)
  - OpenRouter (LLM / STT / TTS integrations — configurable via env)
  - Axios (frontend HTTP)

---

## Repository structure (top-level)
```text
backend/         Python FastAPI backend (routers, services, config)
frontend/        Vite + React frontend (UI, client)
package.json     (root placeholder)
package-lock.json
