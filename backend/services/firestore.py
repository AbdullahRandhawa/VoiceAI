"""
Firestore service — all DB operations wrapped in asyncio.to_thread
so they don't block the async event loop.
"""
import asyncio
import datetime
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore as fs
from config import settings

# ── Initialise Firebase Admin once ──────────────────────────────────────────
if not firebase_admin._apps:
    cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
    firebase_admin.initialize_app(cred)

db = fs.client()


def _serialize(data: dict) -> dict:
    """Convert Firestore datetime/server-timestamp objects to ISO strings."""
    out = {}
    for k, v in data.items():
        if isinstance(v, datetime.datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ── Conversations ────────────────────────────────────────────────────────────

async def get_conversations(user_id: str) -> list[dict]:
    def _get():
        ref = (
            db.collection("conversations")
            .where("user_id", "==", user_id)
            .order_by("updated_at", direction=fs.Query.DESCENDING)
        )
        return [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]

    return await asyncio.to_thread(_get)


async def create_conversation(user_id: str, title: str = "New Chat") -> dict:
    def _create():
        now = datetime.datetime.utcnow()
        doc_ref = db.collection("conversations").document()
        data = {
            "user_id": user_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
        }
        doc_ref.set(data)
        return {"id": doc_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_create)


async def update_conversation_title(conversation_id: str, title: str) -> None:
    def _update():
        db.collection("conversations").document(conversation_id).update(
            {"title": title, "updated_at": datetime.datetime.utcnow()}
        )

    await asyncio.to_thread(_update)


async def delete_conversation(conversation_id: str) -> None:
    def _delete():
        # Delete all child messages first
        msgs_ref = (
            db.collection("conversations")
            .document(conversation_id)
            .collection("messages")
        )
        for doc in msgs_ref.stream():
            doc.reference.delete()
        db.collection("conversations").document(conversation_id).delete()

    await asyncio.to_thread(_delete)


# ── Messages ─────────────────────────────────────────────────────────────────

async def get_messages(conversation_id: str) -> list[dict]:
    def _get():
        ref = (
            db.collection("conversations")
            .document(conversation_id)
            .collection("messages")
            .order_by("created_at")
        )
        return [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]

    return await asyncio.to_thread(_get)


async def save_message(
    conversation_id: str,
    role: str,
    content: str,
    audio_url: Optional[str] = None,
    transcript: Optional[str] = None,
) -> dict:
    def _save():
        now = datetime.datetime.utcnow()
        msg_ref = (
            db.collection("conversations")
            .document(conversation_id)
            .collection("messages")
            .document()
        )
        data = {
            "role": role,
            "content": content,
            "audio_url": audio_url,
            "transcript": transcript,
            "created_at": now,
        }
        msg_ref.set(data)
        # Bump the conversation's updated_at timestamp
        db.collection("conversations").document(conversation_id).update(
            {"updated_at": now}
        )
        return {"id": msg_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_save)
