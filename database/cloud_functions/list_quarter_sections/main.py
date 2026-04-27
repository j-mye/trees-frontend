"""HTTP Cloud Function: list quarter section ids from Firestore."""

from __future__ import annotations

import functions_framework
from firebase_auth import require_firebase_auth
from flask import Request, jsonify
from google.cloud import firestore

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

_MAX_DOCS = 500

_db: firestore.Client | None = None


def _client() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


@functions_framework.http
def listQuarterSections(request: Request):
    """Return { items: [ { id, label }, ... ] } from collection quarter_sections."""
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "GET":
        return (jsonify({"error": "Method not allowed"}), 405, CORS_HEADERS)

    _claims, auth_err = require_firebase_auth(request, CORS_HEADERS)
    if auth_err:
        return auth_err

    try:
        col = _client().collection("quarter_sections")
        items = []
        for doc in col.limit(_MAX_DOCS).stream():
            data = doc.to_dict() or {}
            label = data.get("label")
            items.append(
                {
                    "id": doc.id,
                    "label": label if label is not None else doc.id,
                }
            )
        return (jsonify({"items": items}), 200, CORS_HEADERS)
    except Exception as exc:  # noqa: BLE001 — surface message to client in dev
        return (jsonify({"error": str(exc)}), 500, CORS_HEADERS)
