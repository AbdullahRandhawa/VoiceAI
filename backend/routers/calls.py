"""
Calls router — REST API for the voice call history.

Endpoints:
  POST   /calls/                  → create a new call record
  GET    /calls/                  → list all calls for the current user
  DELETE /calls/{call_id}         → delete a call and all its exchanges
  GET    /calls/{call_id}/messages → list all messages (exchanges) for a call
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel
from services import firestore as firestore_service

router = APIRouter()
_bearer = HTTPBearer()


def _get_uid(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        decoded = firebase_auth.verify_id_token(creds.credentials)
        return decoded["uid"]
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")


class CreateCallBody(BaseModel):
    title: str = "Voice Call"


@router.post("/")
async def create_call(body: CreateCallBody, uid: str = Depends(_get_uid)):
    call = await firestore_service.create_call(uid, body.title)
    return call


@router.get("/")
async def list_calls(uid: str = Depends(_get_uid)):
    calls = await firestore_service.get_calls(uid)
    return {"calls": calls}


@router.delete("/{call_id}")
async def delete_call(call_id: str, uid: str = Depends(_get_uid)):
    await firestore_service.delete_call(call_id)
    return {"ok": True}


@router.get("/{call_id}/messages")
async def get_messages(call_id: str, uid: str = Depends(_get_uid)):
    messages = await firestore_service.get_call_messages(call_id)
    return {"messages": messages}
