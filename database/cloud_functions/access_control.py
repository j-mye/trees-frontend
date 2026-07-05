"""
User access approval, tiers, and admin notifications for Pruning Planner.

BigQuery ``users`` row is the source of truth (approval_status, role, tier).
Firebase Auth holds credentials; optional ``disabled`` flag until approved.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

from firebase_admin import auth
from google.cloud import bigquery

logger = logging.getLogger(__name__)

APPROVAL_PENDING = "pending"
APPROVAL_APPROVED = "approved"
APPROVAL_REJECTED = "rejected"

VALID_ROLES = frozenset({"admin", "arborist", "viewer"})
VALID_TIERS = frozenset({"standard", "analyst", "supervisor", "executive"})
VALID_APPROVAL = frozenset({APPROVAL_PENDING, APPROVAL_APPROVED, APPROVAL_REJECTED})


def access_require_approval_enabled() -> bool:
    return os.environ.get("ACCESS_REQUIRE_APPROVAL", "true").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _env_list(key: str) -> list[str]:
    raw = os.environ.get(key, "") or ""
    out: list[str] = []
    for part in raw.split(","):
        token = part.strip().strip('"').strip("'").lower()
        if token:
            out.append(token)
    return out


def is_bootstrap_admin_email(email: str) -> bool:
    normalized = (email or "").strip().lower()
    return normalized in _env_list("ACCESS_BOOTSTRAP_ADMIN_EMAILS")


def _admin_notify_emails() -> list[str]:
    return [p.strip() for p in (os.environ.get("ACCESS_ADMIN_NOTIFY_EMAILS", "") or "").split(",") if p.strip()]


def _portal_base_url() -> str:
    return (os.environ.get("ACCESS_PORTAL_BASE_URL", "https://mke-trees.web.app") or "").rstrip("/")


def users_table_fqn(cfg: Any, table_ref_fn: Any) -> str:
    return table_ref_fn(f"{cfg.project_id}.{cfg.dataset}.users")


def _user_row_from_bq(r: Any) -> dict[str, Any]:
    return {
        "user_id": str(r.get("user_id") or ""),
        "email": str(r.get("email") or ""),
        "role": str(r.get("role") or "viewer"),
        "tier": str(r.get("tier") or "standard"),
        "active": bool(r.get("active")) if r.get("active") is not None else False,
        "approval_status": str(r.get("approval_status") or APPROVAL_PENDING),
        "display_name": str(r.get("display_name") or ""),
        "organization": str(r.get("organization") or ""),
        "access_note": str(r.get("access_note") or ""),
        "rejection_reason": str(r.get("rejection_reason") or ""),
        "created_at": str(r.get("created_at") or ""),
        "approved_at": str(r.get("approved_at") or ""),
        "approved_by": str(r.get("approved_by") or ""),
    }


def fetch_user_row(
    *,
    user_id: str,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any] | None:
    users_t = users_table_fqn(cfg, table_ref_fn)
    sql = f"""
    SELECT
      CAST(user_id AS STRING) AS user_id,
      CAST(email AS STRING) AS email,
      CAST(role AS STRING) AS role,
      CAST(tier AS STRING) AS tier,
      CAST(active AS BOOL) AS active,
      CAST(approval_status AS STRING) AS approval_status,
      CAST(display_name AS STRING) AS display_name,
      CAST(organization AS STRING) AS organization,
      CAST(access_note AS STRING) AS access_note,
      CAST(rejection_reason AS STRING) AS rejection_reason,
      CAST(created_at AS STRING) AS created_at,
      CAST(approved_at AS STRING) AS approved_at,
      CAST(approved_by AS STRING) AS approved_by
    FROM {users_t}
    WHERE user_id = @user_id
    LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("user_id", "STRING", user_id)]
    )
    rows = list(run_query_fn(client, sql, location=cfg.location, job_config=job_config).result())
    if not rows:
        return None
    return _user_row_from_bq(dict(rows[0].items()))


def user_is_approved(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    return (
        str(row.get("approval_status") or "") == APPROVAL_APPROVED
        and bool(row.get("active"))
    )


def user_is_admin(row: dict[str, Any] | None) -> bool:
    return bool(row) and str(row.get("role") or "") == "admin" and user_is_approved(row)


def is_approved_for_claims(row: dict[str, Any] | None, claims: dict[str, Any]) -> bool:
    if is_bootstrap_admin_email(str(claims.get("email") or "")):
        return True
    return user_is_approved(row)


def is_admin_for_claims(row: dict[str, Any] | None, claims: dict[str, Any]) -> bool:
    if is_bootstrap_admin_email(str(claims.get("email") or "")):
        return True
    return user_is_admin(row)


def access_denied_payload(row: dict[str, Any] | None) -> dict[str, Any]:
    status = (row or {}).get("approval_status") or "unregistered"
    return {
        "error": "Access denied",
        "message": "Account is not approved for portal access",
        "approval_status": status,
        "active": bool((row or {}).get("active")),
    }


def enforce_approved_access(
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Return (claims, error_payload). error_payload set when caller must receive 403."""
    if not access_require_approval_enabled():
        return claims, None
    uid = str(claims.get("uid") or "")
    if not uid:
        return None, {"error": "Unauthorized", "message": "Missing uid in token"}
    if is_bootstrap_admin_email(str(claims.get("email") or "")):
        return claims, None
    row = fetch_user_row(
        user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if user_is_approved(row):
        return claims, None
    return None, access_denied_payload(row)


def _set_firebase_disabled(user_id: str, *, disabled: bool) -> None:
    try:
        auth.update_user(user_id, disabled=disabled)
    except Exception as e:  # noqa: BLE001
        logger.warning("Firebase update_user(disabled=%s) failed for %s: %s", disabled, user_id, e)


def send_access_notification(
    *,
    subject: str,
    body_text: str,
    to_addrs: list[str],
) -> bool:
    """Send email via SMTP env config. Returns True if sent (or no recipients)."""
    if not to_addrs:
        logger.info("access email skipped (no recipients): %s", subject)
        return False
    host = (os.environ.get("ACCESS_SMTP_HOST") or "").strip()
    port_raw = (os.environ.get("ACCESS_SMTP_PORT") or "587").strip()
    user = (os.environ.get("ACCESS_SMTP_USER") or "").strip()
    password = os.environ.get("ACCESS_SMTP_PASSWORD") or ""
    from_addr = (os.environ.get("ACCESS_SMTP_FROM") or user or "noreply@pruning-planner.local").strip()
    use_tls = os.environ.get("ACCESS_SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes"}

    if not host:
        logger.warning(
            "ACCESS_SMTP_HOST not set; access email not sent. subject=%r recipients=%s",
            subject,
            to_addrs,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.set_content(body_text)

    try:
        port = int(port_raw)
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            if use_tls:
                smtp.starttls(context=ssl.create_default_context())
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
        logger.info("access email sent: %s -> %s", subject, to_addrs)
        return True
    except Exception as e:  # noqa: BLE001
        logger.exception("access email failed: %s", e)
        return False


def register_access_request(
    req_body: dict[str, Any],
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    uid = str(claims.get("uid") or "").strip()
    email = str(claims.get("email") or req_body.get("email") or "").strip()
    if not uid:
        raise ValueError("authenticated user id is required")
    if not email:
        raise ValueError("email is required")

    display_name = str(req_body.get("display_name") or claims.get("name") or "").strip()
    organization = str(req_body.get("organization") or "").strip()
    access_note = str(req_body.get("access_note") or req_body.get("justification") or "").strip()

    bootstrap = is_bootstrap_admin_email(email)
    approval_status = APPROVAL_APPROVED if bootstrap else APPROVAL_PENDING
    role = "admin" if bootstrap else "viewer"
    tier = "executive" if bootstrap else "standard"
    active = bootstrap

    users_t = users_table_fqn(cfg, table_ref_fn)
    sql = f"""
    MERGE {users_t} t
    USING (
      SELECT
        @user_id AS user_id,
        @email AS email,
        @role AS role,
        @tier AS tier,
        @active AS active,
        @approval_status AS approval_status,
        @display_name AS display_name,
        @organization AS organization,
        @access_note AS access_note,
        CURRENT_TIMESTAMP() AS created_at
    ) s
    ON t.user_id = s.user_id
    WHEN MATCHED AND s.approval_status = @approval_approved THEN
      UPDATE SET
        email = s.email,
        role = s.role,
        tier = s.tier,
        active = s.active,
        approval_status = s.approval_status,
        display_name = COALESCE(NULLIF(s.display_name, ''), t.display_name),
        organization = COALESCE(NULLIF(s.organization, ''), t.organization),
        approved_at = CURRENT_TIMESTAMP(),
        rejection_reason = NULL
    WHEN MATCHED AND t.approval_status != @approval_approved THEN
      UPDATE SET
        email = s.email,
        display_name = COALESCE(NULLIF(s.display_name, ''), t.display_name),
        organization = COALESCE(NULLIF(s.organization, ''), t.organization),
        access_note = COALESCE(NULLIF(s.access_note, ''), t.access_note)
    WHEN NOT MATCHED THEN
      INSERT (
        user_id, email, role, tier, active, approval_status,
        display_name, organization, access_note, created_at
      )
      VALUES (
        s.user_id, s.email, s.role, s.tier, s.active, s.approval_status,
        s.display_name, s.organization, s.access_note, s.created_at
      )
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("user_id", "STRING", uid),
            bigquery.ScalarQueryParameter("email", "STRING", email),
            bigquery.ScalarQueryParameter("role", "STRING", role),
            bigquery.ScalarQueryParameter("tier", "STRING", tier),
            bigquery.ScalarQueryParameter("active", "BOOL", active),
            bigquery.ScalarQueryParameter("approval_status", "STRING", approval_status),
            bigquery.ScalarQueryParameter("display_name", "STRING", display_name),
            bigquery.ScalarQueryParameter("organization", "STRING", organization),
            bigquery.ScalarQueryParameter("access_note", "STRING", access_note),
            bigquery.ScalarQueryParameter("approval_approved", "STRING", APPROVAL_APPROVED),
        ]
    )
    run_query_fn(client, sql, location=cfg.location, job_config=job_config).result()

    # Keep Firebase sign-in enabled while pending so users can view /pending-approval.
    # API access is blocked via _require_approved_claims until approved.

    if approval_status == APPROVAL_PENDING:
        admin_emails = _admin_notify_emails()
        portal = _portal_base_url()
        send_access_notification(
            subject="[Pruning Planner] New access request",
            body_text=(
                f"A new portal access request needs review.\n\n"
                f"Name: {display_name or '(not provided)'}\n"
                f"Email: {email}\n"
                f"Organization: {organization or '(not provided)'}\n"
                f"Note: {access_note or '(not provided)'}\n"
                f"Firebase UID: {uid}\n\n"
                f"Review pending users in the admin console:\n"
                f"{portal}/admin/access\n"
            ),
            to_addrs=admin_emails,
        )

    row = fetch_user_row(
        user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    return {"ok": True, "profile": row or {}, "bootstrap_admin": bootstrap}


def ensure_bootstrap_user_promoted(
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any] | None:
    """If email is in ACCESS_BOOTSTRAP_ADMIN_EMAILS, upsert an approved admin row."""
    uid = str(claims.get("uid") or "").strip()
    email = str(claims.get("email") or "").strip()
    if not uid or not email or not is_bootstrap_admin_email(email):
        return fetch_user_row(
            user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
        )
    return register_access_request(
        {
            "email": email,
            "display_name": str(claims.get("name") or ""),
        },
        claims,
        cfg=cfg,
        client=client,
        table_ref_fn=table_ref_fn,
        run_query_fn=run_query_fn,
    ).get("profile") or fetch_user_row(
        user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )


def list_users_payload(
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
    approval_filter: str | None = None,
) -> dict[str, Any]:
    users_t = users_table_fqn(cfg, table_ref_fn)
    where = ""
    params: list[bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter] = []
    if approval_filter:
        where = "WHERE approval_status = @approval_status"
        params.append(bigquery.ScalarQueryParameter("approval_status", "STRING", approval_filter))

    sql = f"""
    SELECT
      CAST(user_id AS STRING) AS user_id,
      CAST(email AS STRING) AS email,
      CAST(role AS STRING) AS role,
      CAST(tier AS STRING) AS tier,
      CAST(active AS BOOL) AS active,
      CAST(approval_status AS STRING) AS approval_status,
      CAST(display_name AS STRING) AS display_name,
      CAST(organization AS STRING) AS organization,
      CAST(access_note AS STRING) AS access_note,
      CAST(rejection_reason AS STRING) AS rejection_reason,
      CAST(created_at AS STRING) AS created_at,
      CAST(approved_at AS STRING) AS approved_at,
      CAST(approved_by AS STRING) AS approved_by
    FROM {users_t}
    {where}
    ORDER BY created_at DESC
    """
    job_config = bigquery.QueryJobConfig(query_parameters=params) if params else None
    rows = list(
        run_query_fn(client, sql, location=cfg.location, job_config=job_config).result()
    )
    users = [_user_row_from_bq(dict(r.items())) for r in rows]
    return {"users": users}


def _require_admin_actor(
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    uid = str(claims.get("uid") or "")
    if is_bootstrap_admin_email(str(claims.get("email") or "")):
        return {"user_id": uid, "email": claims.get("email"), "role": "admin"}
    row = fetch_user_row(
        user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if not user_is_admin(row):
        raise PermissionError("Admin role required")
    return row or {}


def approve_user(
    req_body: dict[str, Any],
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    _require_admin_actor(
        claims, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    target_id = str(req_body.get("user_id") or "").strip()
    if not target_id:
        raise ValueError("user_id is required")
    role = str(req_body.get("role") or "viewer").strip().lower()
    tier = str(req_body.get("tier") or "standard").strip().lower()
    if role not in VALID_ROLES:
        raise ValueError("role must be one of admin, arborist, viewer")
    if tier not in VALID_TIERS:
        raise ValueError("tier must be one of standard, analyst, supervisor, executive")

    users_t = users_table_fqn(cfg, table_ref_fn)
    sql = f"""
    UPDATE {users_t}
    SET
      role = @role,
      tier = @tier,
      active = TRUE,
      approval_status = @approval_status,
      approved_at = CURRENT_TIMESTAMP(),
      approved_by = @approved_by,
      rejection_reason = NULL
    WHERE user_id = @user_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("user_id", "STRING", target_id),
            bigquery.ScalarQueryParameter("role", "STRING", role),
            bigquery.ScalarQueryParameter("tier", "STRING", tier),
            bigquery.ScalarQueryParameter("approval_status", "STRING", APPROVAL_APPROVED),
            bigquery.ScalarQueryParameter("approved_by", "STRING", str(claims.get("uid") or "")),
        ]
    )
    run_query_fn(client, sql, location=cfg.location, job_config=job_config).result()
    _set_firebase_disabled(target_id, disabled=False)

    row = fetch_user_row(
        user_id=target_id, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if row and row.get("email"):
        portal = _portal_base_url()
        send_access_notification(
            subject="[Pruning Planner] Access approved",
            body_text=(
                f"Your Pruning Planner portal access has been approved.\n\n"
                f"Role: {role}\n"
                f"Tier: {tier}\n\n"
                f"Sign in: {portal}/login\n"
            ),
            to_addrs=[str(row["email"])],
        )
    return {"ok": True, "user": row}


def reject_user(
    req_body: dict[str, Any],
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    _require_admin_actor(
        claims, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    target_id = str(req_body.get("user_id") or "").strip()
    reason = str(req_body.get("rejection_reason") or req_body.get("reason") or "").strip()
    if not target_id:
        raise ValueError("user_id is required")

    users_t = users_table_fqn(cfg, table_ref_fn)
    sql = f"""
    UPDATE {users_t}
    SET
      active = FALSE,
      approval_status = @approval_status,
      rejection_reason = @rejection_reason,
      approved_at = NULL,
      approved_by = NULL
    WHERE user_id = @user_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("user_id", "STRING", target_id),
            bigquery.ScalarQueryParameter("approval_status", "STRING", APPROVAL_REJECTED),
            bigquery.ScalarQueryParameter("rejection_reason", "STRING", reason),
        ]
    )
    run_query_fn(client, sql, location=cfg.location, job_config=job_config).result()
    _set_firebase_disabled(target_id, disabled=True)

    row = fetch_user_row(
        user_id=target_id, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if row and row.get("email"):
        send_access_notification(
            subject="[Pruning Planner] Access request declined",
            body_text=(
                "Your request for Pruning Planner portal access was not approved.\n\n"
                f"{('Reason: ' + reason) if reason else ''}\n"
            ).strip(),
            to_addrs=[str(row["email"])],
        )
    return {"ok": True, "user": row}


def update_user_access(
    req_body: dict[str, Any],
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    _require_admin_actor(
        claims, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    target_id = str(req_body.get("user_id") or "").strip()
    if not target_id:
        raise ValueError("user_id is required")

    sets: list[str] = []
    params: list[bigquery.ScalarQueryParameter] = [
        bigquery.ScalarQueryParameter("user_id", "STRING", target_id),
    ]

    if "role" in req_body:
        role = str(req_body.get("role") or "").strip().lower()
        if role not in VALID_ROLES:
            raise ValueError("invalid role")
        sets.append("role = @role")
        params.append(bigquery.ScalarQueryParameter("role", "STRING", role))
    if "tier" in req_body:
        tier = str(req_body.get("tier") or "").strip().lower()
        if tier not in VALID_TIERS:
            raise ValueError("invalid tier")
        sets.append("tier = @tier")
        params.append(bigquery.ScalarQueryParameter("tier", "STRING", tier))
    if "active" in req_body:
        active = bool(req_body.get("active"))
        sets.append("active = @active")
        params.append(bigquery.ScalarQueryParameter("active", "BOOL", active))

    if not sets:
        raise ValueError("no fields to update")

    users_t = users_table_fqn(cfg, table_ref_fn)
    sql = f"UPDATE {users_t} SET {', '.join(sets)} WHERE user_id = @user_id"
    run_query_fn(
        client,
        sql,
        location=cfg.location,
        job_config=bigquery.QueryJobConfig(query_parameters=params),
    ).result()

    row = fetch_user_row(
        user_id=target_id, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if row and not row.get("active"):
        _set_firebase_disabled(target_id, disabled=True)
    elif row and user_is_approved(row):
        _set_firebase_disabled(target_id, disabled=False)
    return {"ok": True, "user": row}


VALID_USAGE_TOOLS = frozenset(
    {
        "inventory",
        "analytics",
        "data_management",
        "user_tasks",
        "admin_access",
        "admin_usage",
    }
)
VALID_USAGE_EVENT_TYPES = frozenset({"page_view", "action"})
_MAX_USAGE_EVENTS_PER_REQUEST = 40


def usage_events_table_fqn(cfg: Any, table_ref_fn: Any) -> str:
    return table_ref_fn(f"{cfg.project_id}.{cfg.dataset}.user_usage_events")


def _require_approved_actor(
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    uid = str(claims.get("uid") or "")
    if not uid:
        raise PermissionError("Missing uid in token")
    if is_bootstrap_admin_email(str(claims.get("email") or "")):
        return {"user_id": uid, "email": str(claims.get("email") or ""), "role": "admin"}
    row = fetch_user_row(
        user_id=uid, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    if not user_is_approved(row):
        raise PermissionError("Account is not approved for portal access")
    return row or {"user_id": uid, "email": str(claims.get("email") or ""), "role": "viewer"}


def log_usage_events(
    req_body: dict[str, Any],
    claims: dict[str, Any],
    *,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    """Append client-reported usage events (approved users only)."""
    _require_approved_actor(
        claims, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    raw_events = req_body.get("events")
    if not isinstance(raw_events, list) or not raw_events:
        raise ValueError("events array is required")
    if len(raw_events) > _MAX_USAGE_EVENTS_PER_REQUEST:
        raise ValueError(f"at most {_MAX_USAGE_EVENTS_PER_REQUEST} events per request")

    uid = str(claims.get("uid") or "")
    email = str(claims.get("email") or "")
    usage_t = usage_events_table_fqn(cfg, table_ref_fn)
    rows_sql: list[str] = []
    params: list[bigquery.ScalarQueryParameter] = []

    for i, ev in enumerate(raw_events):
        if not isinstance(ev, dict):
            continue
        tool = str(ev.get("tool") or "").strip().lower()
        event_type = str(ev.get("event_type") or "page_view").strip().lower()
        if tool not in VALID_USAGE_TOOLS:
            raise ValueError(f"invalid tool: {tool}")
        if event_type not in VALID_USAGE_EVENT_TYPES:
            raise ValueError(f"invalid event_type: {event_type}")
        action_name = str(ev.get("action_name") or "").strip()[:120]
        path = str(ev.get("path") or "").strip()[:256]
        event_id = str(ev.get("event_id") or uuid.uuid4().hex)
        occurred_raw = str(ev.get("occurred_at") or "").strip()
        occurred_at = occurred_raw if occurred_raw else datetime.now(timezone.utc).isoformat()

        rows_sql.append(
            f"SELECT @event_id_{i} AS event_id, @user_id_{i} AS user_id, @email_{i} AS email, "
            f"@tool_{i} AS tool, @event_type_{i} AS event_type, @action_name_{i} AS action_name, "
            f"@path_{i} AS path, SAFE_CAST(@occurred_at_{i} AS TIMESTAMP) AS occurred_at"
        )
        params.extend(
            [
                bigquery.ScalarQueryParameter(f"event_id_{i}", "STRING", event_id),
                bigquery.ScalarQueryParameter(f"user_id_{i}", "STRING", uid),
                bigquery.ScalarQueryParameter(f"email_{i}", "STRING", email),
                bigquery.ScalarQueryParameter(f"tool_{i}", "STRING", tool),
                bigquery.ScalarQueryParameter(f"event_type_{i}", "STRING", event_type),
                bigquery.ScalarQueryParameter(f"action_name_{i}", "STRING", action_name or None),
                bigquery.ScalarQueryParameter(f"path_{i}", "STRING", path or None),
                bigquery.ScalarQueryParameter(f"occurred_at_{i}", "STRING", occurred_at),
            ]
        )

    if not rows_sql:
        raise ValueError("no valid events to log")

    sql = f"""
    INSERT INTO {usage_t} (event_id, user_id, email, tool, event_type, action_name, path, occurred_at)
    {" UNION ALL ".join(rows_sql)}
    """
    run_query_fn(
        client,
        sql,
        location=cfg.location,
        job_config=bigquery.QueryJobConfig(query_parameters=params),
    ).result()
    return {"ok": True, "inserted": len(rows_sql)}


def usage_stats_payload(
    claims: dict[str, Any],
    *,
    days: int,
    cfg: Any,
    client: bigquery.Client,
    table_ref_fn: Any,
    run_query_fn: Any,
) -> dict[str, Any]:
    """Aggregate tool popularity and power users (admin only)."""
    _require_admin_actor(
        claims, cfg=cfg, client=client, table_ref_fn=table_ref_fn, run_query_fn=run_query_fn
    )
    window_days = min(max(int(days or 30), 1), 365)
    usage_t = usage_events_table_fqn(cfg, table_ref_fn)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("days", "INT64", window_days)]
    )

    by_tool_sql = f"""
    SELECT
      CAST(tool AS STRING) AS tool,
      COUNT(*) AS event_count,
      COUNT(DISTINCT user_id) AS unique_users
    FROM {usage_t}
    WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY tool
    ORDER BY event_count DESC
    """
    by_user_sql = f"""
    SELECT
      CAST(user_id AS STRING) AS user_id,
      CAST(COALESCE(NULLIF(TRIM(email), ''), user_id) AS STRING) AS email,
      COUNT(*) AS event_count,
      COUNT(DISTINCT tool) AS tools_used,
      CAST(MAX(occurred_at) AS STRING) AS last_active,
      APPROX_TOP_COUNT(tool, 1)[OFFSET(0)].value AS top_tool
    FROM {usage_t}
    WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY user_id, email
    ORDER BY event_count DESC
    LIMIT 50
    """
    totals_sql = f"""
    SELECT
      COUNT(*) AS total_events,
      COUNT(DISTINCT user_id) AS active_users
    FROM {usage_t}
    WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    """

    by_tool = [
        {
            "tool": str(r["tool"] or ""),
            "event_count": int(r["event_count"] or 0),
            "unique_users": int(r["unique_users"] or 0),
        }
        for r in run_query_fn(client, by_tool_sql, location=cfg.location, job_config=job_config).result()
    ]
    by_user = [
        {
            "user_id": str(r["user_id"] or ""),
            "email": str(r["email"] or ""),
            "event_count": int(r["event_count"] or 0),
            "tools_used": int(r["tools_used"] or 0),
            "last_active": str(r["last_active"] or ""),
            "top_tool": str(r["top_tool"] or ""),
        }
        for r in run_query_fn(client, by_user_sql, location=cfg.location, job_config=job_config).result()
    ]
    totals_row = list(
        run_query_fn(client, totals_sql, location=cfg.location, job_config=job_config).result()
    )
    totals = totals_row[0] if totals_row else None
    return {
        "days": window_days,
        "total_events": int(totals["total_events"] or 0) if totals else 0,
        "active_users": int(totals["active_users"] or 0) if totals else 0,
        "by_tool": by_tool,
        "power_users": by_user,
    }
