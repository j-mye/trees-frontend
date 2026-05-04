"""
Gen2 HTTPS: POST { "draft": { ... } } -> tabular rows for analytics UI (BigQuery).
Requires Firebase ID token. Uses in-memory LRU cache by normalized draft fingerprint.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import OrderedDict
from typing import Any

import functions_framework
from compiler import compile_draft_to_sql, draft_cache_key
from firebase_auth import require_firebase_auth
from flask import Request, jsonify
from google.cloud import bigquery

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

_MAX_CACHE = 64
_cache: "OrderedDict[str, dict[str, Any]]" = OrderedDict()


def _cache_get(key: str) -> dict[str, Any] | None:
    if key not in _cache:
        return None
    _cache.move_to_end(key)
    return _cache[key]


def _normalize_tabular_xlabel(v: Any) -> str:
    """Null/blank -> Unknown; preserve literal strings from BigQuery (including 'Unknown')."""
    if v is None:
        return "Unknown"
    s = str(v).strip()
    if s == "":
        return "Unknown"
    return s


def _cache_set(key: str, value: dict[str, Any]) -> None:
    _cache[key] = value
    _cache.move_to_end(key)
    while len(_cache) > _MAX_CACHE:
        _cache.popitem(last=False)


def _table_fqn() -> str:
    raw = (os.environ.get("BQ_ANALYTICS_SOURCE_TABLE") or os.environ.get("BQ_QUARTER_SECTION_TABLE_FQN") or "").strip()
    if not raw:
        raise ValueError("Set BQ_ANALYTICS_SOURCE_TABLE or BQ_QUARTER_SECTION_TABLE_FQN")
    return raw


@functions_framework.http
def analytics_query(request: Request):
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "POST":
        return (jsonify({"error": "Method not allowed"}), 405, CORS_HEADERS)

    _claims, err = require_firebase_auth(request, CORS_HEADERS)
    if err:
        return err

    try:
        body = request.get_json(silent=True) or {}
        draft = body.get("draft")
        if not isinstance(draft, dict):
            return (jsonify({"error": "Missing draft object"}), 400, CORS_HEADERS)
        print(
            "[analytics_query] incoming draft",
            json.dumps(
                {
                    "xAxisItem": (draft.get("xAxisItem") or {}).get("id"),
                    "yAxisItem": (draft.get("yAxisItem") or {}).get("id"),
                    "yAggregation": draft.get("yAggregation"),
                    "colorItem": (draft.get("colorItem") or {}).get("id"),
                    "filters": draft.get("draftFilters") or [],
                },
                sort_keys=True,
            ),
            flush=True,
        )
    except Exception as e:
        return (jsonify({"error": str(e)}), 400, CORS_HEADERS)

    key_raw = draft_cache_key(draft) + "|" + (_claims.get("uid") or "")
    cache_key = hashlib.sha256(key_raw.encode()).hexdigest()
    hit = _cache_get(cache_key)
    if hit is not None:
        return (jsonify({**hit, "source": "cache"}), 200, CORS_HEADERS)

    try:
        table_fqn = _table_fqn()
        sql, param_specs = compile_draft_to_sql(draft, table_fqn=table_fqn)
        print(
            "[analytics_query] compiled",
            json.dumps(
                {
                    "table_fqn": table_fqn,
                    "params": param_specs,
                    "sql_preview": sql[:500],
                },
                sort_keys=True,
                default=str,
            ),
            flush=True,
        )
    except ValueError as e:
        return (jsonify({"error": str(e)}), 400, CORS_HEADERS)

    if os.environ.get("ANALYTICS_QUERY_DRY_RUN") == "1":
        payload = {"rows": [], "columns": ["xLabel", "yValue"], "sql": sql, "source": "dry_run"}
        _cache_set(cache_key, payload)
        return (jsonify(payload), 200, CORS_HEADERS)

    try:
        client = bigquery.Client()
        bq_params: list[bigquery.ScalarQueryParameter] = []
        for p in param_specs:
            bq_params.append(
                bigquery.ScalarQueryParameter(
                    str(p["name"]),
                    str(p["type"]),
                    p.get("value"),
                )
            )
        job = client.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=bq_params))
        rows_out: list[dict[str, Any]] = []
        for r in job.result():
            y_raw = r["yValue"]
            y_val = float(y_raw) if y_raw is not None and str(y_raw).strip() != "" else 0.0
            out_row = {
                "xLabel": _normalize_tabular_xlabel(r["xLabel"]),
                "yValue": y_val,
            }
            if "series" in r:
                out_row["series"] = _normalize_tabular_xlabel(r["series"])
            rows_out.append(out_row)
        print(
            "[analytics_query] query result",
            json.dumps(
                {
                    "rows_count": len(rows_out),
                    "preview": rows_out[:5],
                },
                sort_keys=True,
                default=str,
            ),
            flush=True,
        )
    except Exception as e:
        return (jsonify({"error": "BigQuery error", "message": str(e)}), 500, CORS_HEADERS)

    payload = {"rows": rows_out, "columns": ["xLabel", "yValue"], "source": "bigquery"}
    _cache_set(cache_key, payload)
    return (jsonify(payload), 200, CORS_HEADERS)
