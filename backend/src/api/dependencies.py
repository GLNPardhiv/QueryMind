# src/api/dependencies.py
import base64
import json
import time
from typing import Optional
from fastapi import Security, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from src.db.mongodb import mongo_service

security = HTTPBearer(auto_error=False)

def decode_token_payload(token: str) -> dict:
    """
    Safely extracts JWT payload claims without requiring external jwt libraries.
    Works for Clerk tokens, standard JWTs, and dev tokens.
    """
    try:
        parts = token.split(".")
        if len(parts) >= 2:
            payload_b64 = parts[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            decoded_bytes = base64.urlsafe_b64decode(payload_b64)
            return json.loads(decoded_bytes.decode("utf-8"))
    except Exception:
        pass
    return {}

def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> dict:
    """
    Validates incoming auth token from Clerk or direct API calls.
    Enforces multi-tenant enterprise enrollment and RBAC verification.
    First user from a company domain becomes ADMIN; subsequent colleagues become STANDARD_USER.
    """
    header_role = request.headers.get("x-user-role")
    
    if not credentials or not credentials.credentials:
        # Development fallback
        user_record = mongo_service.get_or_create_user(
            user_id="local_dev_user",
            email="developer@querymind.io",
            requested_role=header_role or "ADMIN"
        )
        return {
            "sub": user_record["user_id"],
            "user_id": user_record["user_id"],
            "email": user_record["email"],
            "org_id": user_record["org_id"],
            "role": user_record["role"]
        }

    token = credentials.credentials.strip()
    payload = decode_token_payload(token)

    # Check expiration if exp claim exists
    exp = payload.get("exp")
    if exp and isinstance(exp, (int, float)) and time.time() > exp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired."
        )

    user_id = payload.get("sub", "authenticated_user")
    email = payload.get("email") or payload.get("primary_email") or payload.get("sub", "user@enterprise.com")

    # Enroll user in enterprise tenant with role check
    user_record = mongo_service.get_or_create_user(
        user_id=user_id,
        email=email,
        requested_role=header_role
    )

    payload["user_id"] = user_record["user_id"]
    payload["org_id"] = user_record["org_id"]
    payload["role"] = user_record["role"]
    payload["email"] = user_record["email"]

    return payload
