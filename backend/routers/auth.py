"""
Firebase Auth dependency — verifies the Bearer token on every protected route.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import firebase_admin
from firebase_admin import auth
from config import settings

# Ensure Firebase app is initialised (firestore.py may have done it already,
# but we guard with the check here too in case auth router is imported first).
if not firebase_admin._apps:
    from firebase_admin import credentials

    firebase_admin.initialize_app(
        credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
    )

_bearer = HTTPBearer()


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency: verifies Firebase ID token and returns the decoded payload.
    Raises HTTP 401 on any failure.
    """
    try:
        decoded = auth.verify_id_token(creds.credentials)
        return decoded
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        )
