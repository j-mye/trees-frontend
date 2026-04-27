"""Verify Firebase Authentication ID tokens on HTTP requests."""

from __future__ import annotations

from typing import Any

import firebase_admin
from firebase_admin import auth
from flask import jsonify

_initialized = False


def _ensure_app() -> None:
    global _initialized
    if _initialized:
        return
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _initialized = True


def verify_firebase_id_token(request) -> dict[str, Any] | None:
    """Return decoded JWT claims if Authorization Bearer token is valid, else None."""
    auth_header = request.headers.get("Authorization") or ""
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    if not token:
        return None
    try:
        _ensure_app()
        return auth.verify_id_token(token)
    except Exception:
        return None


def require_firebase_auth(request, cors_headers: dict[str, str]):
    claims = verify_firebase_id_token(request)
    if claims is None:
        return (
            None,
            (
                jsonify(
                    {
                        "error": "Unauthorized",
                        "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
                    }
                ),
                401,
                cors_headers,
            ),
        )
    return claims, None
