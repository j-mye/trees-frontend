# Access control (government approval workflow)

## Overview

- **Firebase Auth** — credentials only (email/password).
- **BigQuery `users` table** — source of truth for approval, role, and tier.
- **`accessApi`** — registration, admin approve/reject, profile lookup.
- **All data APIs** — require `approval_status = approved` when `ACCESS_REQUIRE_APPROVAL=true`.

## Setup checklist

1. **BigQuery migration** — run `database/migrations/001_user_access_approval.sql` in your dataset.
2. **Bootstrap admin** — set `ACCESS_BOOTSTRAP_ADMIN_EMAILS` in **`database/cloud_functions/.env`** and on the **deployed** `accessApi` function in Firebase/GCP (not only `database/.env`). First sign-up or “Check status” auto-approves that email as `admin`.
3. **Notify admins** — set `ACCESS_ADMIN_NOTIFY_EMAILS` and SMTP variables in `database/cloud_functions/.env` (deployed as function env).
4. **Deploy** `accessApi` and set `VITE_CF_ACCESS_API_URL` in `frontend/.env`.
5. **Enable enforcement** — `ACCESS_REQUIRE_APPROVAL=true` (default). Use `false` only during initial migration testing.

## User flow

1. User chooses **Request access** on `/login`, creates Firebase credentials, and submits name/org/reason.
2. Row inserted in `users` with `approval_status=pending`; admins receive email (if SMTP configured).
3. User sees `/pending-approval` until an admin approves at `/admin/access`.
4. On approve: `approval_status=approved`, role/tier set, approval email sent to user.
5. User can use Inventory, Analytics, and other APIs.

## Roles and tiers

| Field | Values | Purpose today |
|-------|--------|----------------|
| `role` | `admin`, `arborist`, `viewer` | RBAC for tasks/data (existing) |
| `tier` | `standard`, `analyst`, `supervisor`, `executive` | Reserved for future action tracking / feature flags |

## Future: action tracking

Add a `user_audit_log` table and log writes from Cloud Functions with `user_id`, `action`, `resource`, `timestamp`. Tier can gate sensitive exports or admin screens.

## Firebase console recommendations

- Disable **public** Google sign-in if not vetted for government use.
- Enable email verification (optional extra step).
- Set password policy in Firebase Authentication settings.
