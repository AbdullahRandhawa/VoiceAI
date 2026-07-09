"""
Firebase Auth dependency — verifies the Bearer token on every protected route.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

import firebase_admin
from firebase_admin import auth as firebase_auth
from config import settings
from services import firestore as firestore_service

# Ensure Firebase app is initialised (firestore.py may have done it already,
# but we guard with the check here too in case auth router is imported first).
if not firebase_admin._apps:
    from firebase_admin import credentials

    firebase_admin.initialize_app(
        credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
    )

router = APIRouter()
_bearer = HTTPBearer()

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency: verifies Firebase ID token and returns the decoded payload.
    Raises HTTP 401 on any failure.
    """
    try:
        decoded = firebase_auth.verify_id_token(creds.credentials)
        return decoded
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        )

class SyncUserRequest(BaseModel):
    display_name: str | None = None
    photo_url: str | None = None
    provider: str = "email"

@router.post("/sync")
async def sync_user(body: SyncUserRequest, user: dict = Depends(get_current_user)):
    """
    Syncs user details from frontend to Firestore via Admin SDK.
    Bypasses client-side Firestore security rules.
    """
    email = user.get("email", "")
    await firestore_service.upsert_user_document(
        uid=user["uid"],
        email=email,
        display_name=body.display_name,
        photo_url=body.photo_url,
        provider=body.provider
    )
    return {"status": "success"}
