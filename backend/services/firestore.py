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
    if not data:
        return data
    out = {}
    for k, v in data.items():
        if isinstance(v, datetime.datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ── Users ────────────────────────────────────────────────────────────────────

async def upsert_user_document(uid: str, email: str, display_name: Optional[str] = None, photo_url: Optional[str] = None, provider: str = "email") -> None:
    def _upsert():
        user_ref = db.collection("users").document(uid)
        doc = user_ref.get()
        now = datetime.datetime.utcnow()

        data = {
            "uid": uid,
            "email": email,
            "display_name": display_name,
            "photo_url": photo_url,
            "provider": provider,
            "last_login_at": now
        }

        if not doc.exists:
            data["created_at"] = now
            user_ref.set(data)
        else:
            user_ref.set(data, merge=True)

    await asyncio.to_thread(_upsert)


# ── Chats ────────────────────────────────────────────────────────────────────

async def get_chats(user_id: str) -> list[dict]:
    def _get():
        ref = (
            db.collection("chats")
            .where("user_id", "==", user_id)
        )
        results = [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]
        results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return results

    return await asyncio.to_thread(_get)


async def create_chat(user_id: str, title: str = "New Chat") -> dict:
    def _create():
        now = datetime.datetime.utcnow()
        doc_ref = db.collection("chats").document()
        data = {
            "user_id": user_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
        }
        doc_ref.set(data)
        return {"id": doc_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_create)


async def update_chat_title(chat_id: str, title: str) -> None:
    def _update():
        db.collection("chats").document(chat_id).update(
            {"title": title, "updated_at": datetime.datetime.utcnow()}
        )

    await asyncio.to_thread(_update)


async def delete_chat(chat_id: str) -> None:
    def _delete():
        msgs_ref = (
            db.collection("chats")
            .document(chat_id)
            .collection("messages")
        )
        for doc in msgs_ref.stream():
            doc.reference.delete()
        db.collection("chats").document(chat_id).delete()

    await asyncio.to_thread(_delete)


# ── Chat Messages ─────────────────────────────────────────────────────────────

async def get_chat_messages(chat_id: str) -> list[dict]:
    def _get():
        ref = (
            db.collection("chats")
            .document(chat_id)
            .collection("messages")
            .order_by("created_at")
        )
        return [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]

    return await asyncio.to_thread(_get)


async def save_chat_message(
    chat_id: str,
    role: str,
    content: str,
    audio_url: Optional[str] = None,
    transcript: Optional[str] = None,
) -> dict:
    def _save():
        now = datetime.datetime.utcnow()
        msg_ref = (
            db.collection("chats")
            .document(chat_id)
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
        db.collection("chats").document(chat_id).update(
            {"updated_at": now}
        )
        return {"id": msg_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_save)


async def update_chat_message_audio(chat_id: str, message_id: str, audio_url: str) -> None:
    """Update a chat message's audio_url after TTS finishes (background generation)."""
    def _update():
        db.collection("chats").document(chat_id).collection("messages").document(message_id).update(
            {"audio_url": audio_url}
        )

    await asyncio.to_thread(_update)


# ── Calls ─────────────────────────────────────────────────────────────────────

async def create_call(user_id: str, title: str = "Voice Call") -> dict:
    def _create():
        now = datetime.datetime.utcnow()
        doc_ref = db.collection("calls").document()
        data = {
            "user_id": user_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "audio_url": None,
        }
        doc_ref.set(data)
        return {"id": doc_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_create)


async def get_calls(user_id: str) -> list[dict]:
    def _get():
        ref = db.collection("calls").where("user_id", "==", user_id)
        results = [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]
        results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return results

    return await asyncio.to_thread(_get)


async def delete_call(call_id: str) -> None:
    def _delete():
        msgs_ref = (
            db.collection("calls")
            .document(call_id)
            .collection("messages")
        )
        for doc in msgs_ref.stream():
            doc.reference.delete()
        db.collection("calls").document(call_id).delete()

    await asyncio.to_thread(_delete)


async def save_call_message(
    call_id: str,
    transcript: str,
    response: str,
) -> dict:
    """Save one user↔AI exchange as a message to the call's messages subcollection."""
    def _save():
        now = datetime.datetime.utcnow()
        msg_ref = (
            db.collection("calls")
            .document(call_id)
            .collection("messages")
            .document()
        )
        data = {
            "transcript": transcript,
            "response": response,
            "created_at": now,
        }
        msg_ref.set(data)
        # Bump the call's updated_at
        db.collection("calls").document(call_id).update({"updated_at": now})
        return {"id": msg_ref.id, **_serialize(data)}

    return await asyncio.to_thread(_save)


async def get_call_messages(call_id: str) -> list[dict]:
    """Return all messages (exchanges) for a call, ordered by time."""
    def _get():
        ref = (
            db.collection("calls")
            .document(call_id)
            .collection("messages")
            .order_by("created_at")
        )
        return [{"id": doc.id, **_serialize(doc.to_dict())} for doc in ref.stream()]

    return await asyncio.to_thread(_get)


async def update_call(call_id: str, title: Optional[str] = None, audio_url: Optional[str] = None) -> None:
    """Update call title or call audio URL."""
    def _update():
        data = {"updated_at": datetime.datetime.utcnow()}
        if title is not None:
            data["title"] = title
        if audio_url is not None:
            data["audio_url"] = audio_url
        db.collection("calls").document(call_id).update(data)

    await asyncio.to_thread(_update)
