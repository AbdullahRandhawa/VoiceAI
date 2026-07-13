"""
Chats router — CRUD for chat documents in Firestore.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routers.auth import get_current_user
from services import cloudinary_service, firestore as firestore_service

router = APIRouter()


class CreateChatRequest(BaseModel):
    title: str = "New Chat"


@router.get("/")
async def list_chats(user: dict = Depends(get_current_user)):
    chats = await firestore_service.get_chats(user["uid"])
    return {"chats": chats}


@router.post("/")
async def create_chat(
    body: CreateChatRequest,
    user: dict = Depends(get_current_user),
):
    chat = await firestore_service.create_chat(user["uid"], body.title)
    return chat


@router.get("/{chat_id}/messages")
async def get_messages(chat_id: str, user: dict = Depends(get_current_user)):
    messages = await firestore_service.get_chat_messages(chat_id)
    return {"messages": messages}


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str, user: dict = Depends(get_current_user)
):
    # Fetch all messages to find audio URLs before deletion
    messages = await firestore_service.get_chat_messages(chat_id)
    audio_public_ids = [
        m.get("audio_url") for m in messages
        if m.get("audio_url")
    ]

    # Delete chat and messages from Firestore
    await firestore_service.delete_chat(chat_id)

    # Delete Cloudinary audio files (fire-and-forget, don't fail if error)
    for url in audio_public_ids:
        try:
            await cloudinary_service.delete_audio_by_url(url)
        except Exception:
            pass  # Best effort

    return {"success": True}
