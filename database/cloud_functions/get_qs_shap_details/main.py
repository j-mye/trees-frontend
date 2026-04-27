"""HTTP Cloud Function: get pre-calculated SHAP rows for one quarter section."""

from __future__ import annotations

import functions_framework
from firebase_auth import require_firebase_auth
from flask import Request, jsonify
from google.cloud import firestore

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

_db: firestore.Client | None = None


def _client() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def _parse_qs_id(request: Request) -> str | None:
    qs_id = request.args.get("qsId") or request.args.get("qs_id")
    if qs_id:
        return qs_id.strip() or None
    if request.method == "POST" and request.is_json:
        body = request.get_json(silent=True) or {}
        raw = body.get("qsId") or body.get("qs_id")
        if raw is not None:
            return str(raw).strip() or None
    return None


@functions_framework.http
def getQsShapDetails(request: Request):
    """Return { qsId, shap: [...], label? } for document quarter_sections/{qsId}."""
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method not in ("GET", "POST"):
        return (jsonify({"error": "Method not allowed"}), 405, CORS_HEADERS)

    _claims, auth_err = require_firebase_auth(request, CORS_HEADERS)
    if auth_err:
        return auth_err

    qs_id = _parse_qs_id(request)
    if not qs_id:
        return (jsonify({"error": "qsId is required (query or JSON body)"}), 400, CORS_HEADERS)

    try:
        snap = _client().collection("quarter_sections").document(qs_id).get()
        if not snap.exists:
            return (
                jsonify({"error": "Quarter section not found", "qsId": qs_id}),
                404,
                CORS_HEADERS,
            )
        data = snap.to_dict() or {}
        shap = data.get("shap")
        if shap is None:
            shap = []
        if not isinstance(shap, list):
            return (
                jsonify({"error": "Invalid shap field: expected array", "qsId": qs_id}),
                500,
                CORS_HEADERS,
            )
        out: dict = {"qsId": qs_id, "shap": shap}
        if data.get("label") is not None:
            out["label"] = data["label"]
        return (jsonify(out), 200, CORS_HEADERS)
    except Exception as exc:  # noqa: BLE001
        return (jsonify({"error": str(exc)}), 500, CORS_HEADERS)
