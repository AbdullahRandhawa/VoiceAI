"""
Conversations router — CRUD for conversation documents in Firestore.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routers.auth import get_current_user
from services import firestore as firestore_service

router = APIRouter()


class CreateConversationRequest(BaseModel):
    title: str = "New Chat"


@router.get("/")
async def list_conversations(user: dict = Depends(get_current_user)):
    conversations = await firestore_service.get_conversations(user["uid"])
    return {"conversations": conversations}


@router.post("/")
async def create_conversation(
    body: CreateConversationRequest,
    user: dict = Depends(get_current_user),
):
    conversation = await firestore_service.create_conversation(user["uid"], body.title)
    return conversation


@router.get("/{conversation_id}/messages")
async def get_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    messages = await firestore_service.get_messages(conversation_id)
    return {"messages": messages}


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str, user: dict = Depends(get_current_user)
):
    await firestore_service.delete_conversation(conversation_id)
    return {"success": True}
