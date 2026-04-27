"""
In-memory JSON response cache for Firebase Gen2 ``https_fn`` handlers.

Cache keys should include request path + normalized query string and any config fingerprint
so BigQuery env changes do not reuse stale payloads.

``HTTP_CACHE_VISIBILITY`` may be ``public`` (default) or ``private`` for ``Cache-Control`` on 200 OK.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import functools
from collections.abc import Callable
from typing import Any

from firebase_functions import https_fn

logger = logging.getLogger(__name__)

_DEFAULT_TTL = 86400
_MAX_KEYS = 64
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _prune_expired_locked(now: float) -> None:
    for k, (exp, _) in list(_cache.items()):
        if now >= exp:
            del _cache[k]


def cache_key_from_request(req: https_fn.Request) -> str:
    """Stable key: METHOD, path (no query), sorted query parameters."""
    method = (getattr(req, "method", None) or "GET").upper()
    full = getattr(req, "full_path", None) or getattr(req, "path", "") or ""
    if "?" in full:
        path_only, qstr = full.split("?", 1)
    else:
        path_only, qstr = full, ""
    path_only = path_only or "/"
    if not qstr.strip():
        return f"{method}|{path_only}|"
    from urllib.parse import parse_qs, urlencode

    parsed = parse_qs(qstr, keep_blank_values=True)
    pairs: list[tuple[str, str]] = []
    for k in sorted(parsed.keys()):
        for v in sorted(str(x) for x in parsed[k]):
            pairs.append((k, v))
    return f"{method}|{path_only}|{urlencode(pairs)}"


def json_cache_get(cache_key: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _cache_lock:
        _prune_expired_locked(now)
        hit = _cache.get(cache_key)
        if not hit:
            return None
        expires_at, payload = hit
        if now >= expires_at:
            del _cache[cache_key]
            return None
        return payload


def json_cache_set(cache_key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    now = time.monotonic()
    ttl = float(max(1, ttl_seconds))
    with _cache_lock:
        _prune_expired_locked(now)
        _cache[cache_key] = (now + ttl, payload)
        while len(_cache) > _MAX_KEYS:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            del _cache[oldest]


def json_cache_fetch(
    cache_key: str,
    ttl_seconds: int,
    producer: Callable[[], dict[str, Any]],
    *,
    log_label: str = "json_cache",
) -> tuple[dict[str, Any], bool]:
    """
    Return (payload, cache_hit). On miss, runs ``producer()`` and stores the result.
    Only successful payloads should be passed to ``json_cache_set`` by callers (typically 200 bodies).
    """
    cached = json_cache_get(cache_key)
    if cached is not None:
        logger.info("%s: memory hit key=%r", log_label, cache_key[:200])
        return cached, True
    data = producer()
    json_cache_set(cache_key, data, ttl_seconds)
    logger.info("%s: memory miss stored key=%r", log_label, cache_key[:200])
    return data, False


def cache_control_header(ttl_seconds: int) -> str:
    vis = (os.environ.get("HTTP_CACHE_VISIBILITY") or "public").strip().lower()
    if vis not in ("public", "private"):
        vis = "public"
    return f"{vis}, max-age={max(0, int(ttl_seconds))}"


def vary_for_cache() -> str:
    """Extra ``Vary`` tokens for shared caches with Authorization (paired with private/public choice)."""
    return "Authorization"


def memory_json_cache(
    ttl_seconds: int = _DEFAULT_TTL,
    *,
    key_builder: Callable[[https_fn.Request], str],
    log_label: str | None = None,
):
    """
    Decorator for ``fn(req) -> dict`` BigQuery/data handlers (use inside ``@https_fn.on_request()``
    after auth/options). ``key_builder(req)`` must return the full cache key string.
    """

    def decorator(fn: Callable[[https_fn.Request], dict[str, Any]]):
        label = log_label or fn.__name__

        @functools.wraps(fn)
        def wrapper(req: https_fn.Request) -> dict[str, Any]:
            key = key_builder(req)
            data, _hit = json_cache_fetch(
                key,
                ttl_seconds,
                lambda: fn(req),
                log_label=label,
            )
            return data

        return wrapper

    return decorator
