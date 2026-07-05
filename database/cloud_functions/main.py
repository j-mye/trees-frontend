"""
Firebase Gen2 HTTP Cloud Functions — BigQuery quarter-section summaries + lazy tree loads.

BigQuery configuration uses environment variables (set in Firebase Functions config / Secret
Manager, or in a local `.env` loaded by the emulator). See `database/cloud_functions/.env.example`.

Composition:
  Fully qualified table = `{BQ_PROJECT_ID}.{BQ_DATASET}.{table_name}`
  unless `BQ_TREES_TABLE` / `BQ_QS_SUMMARIES_TABLE` overrides with a full `project.dataset.table`.

Node.js uses `process.env`; this Python backend uses `os.environ` with the **same variable
names** (e.g. `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_LOCATION`). Local runs load ``database/cloud_functions/.env``
via ``python-dotenv`` at import time (same idea as ``require('dotenv').config()``). Cloud Functions / emulator
inject env without a file. Pre-query debug: `print()` + `logger.info`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple
from urllib.parse import parse_qs

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_bq_job_location() -> str:
    """Region for BigQuery jobs and client (must match the dataset region)."""
    raw = os.environ.get("BQ_LOCATION", "us-central1")
    loc = (raw or "").strip()
    return loc if loc else "us-central1"


def _load_dotenv_files() -> None:
    """Populate os.environ from ``.env`` / ``.env.local`` beside this file (local dev + emulator).

    ``override=False`` so real deployment and emulator exports are not replaced by a stray .env.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env", ".env.local"):
        path = os.path.join(_BASE_DIR, name)
        if os.path.isfile(path):
            load_dotenv(path, override=False)
    # Optional fallback: database/.env (teams often set ACCESS_* there by mistake).
    parent_env = os.path.join(_BASE_DIR, "..", ".env")
    if os.path.isfile(parent_env):
        load_dotenv(parent_env, override=False)


_load_dotenv_files()
# Proves whether BQ_LOCATION was set by .env, shell, or Firebase (unset uses code default us-central1).
print(
    "[ENV CHECK] BQ_LOCATION="
    f"{os.environ.get('BQ_LOCATION', '<unset>')!r} "
    f"effective={_resolve_bq_job_location()!r}",
    flush=True,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

import firebase_admin
from firebase_admin import auth, credentials
from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from google.cloud import bigquery
from google.oauth2 import service_account

import access_control as ac
import cached_http

set_global_options(max_instances=10)

# Public Cloud Run invoker: browser preflight (OPTIONS) has no Firebase token; private invoker
# returns 403 without app CORS headers. Do not combine @https_fn.on_request(cors=...) with
# _json_response()'s _cors_headers — that duplicates Access-Control-Allow-Origin and breaks CORS.
# Prefer key beside this file; fallback to database/serviceAccountKey.json
_SERVICE_ACCOUNT_LOCAL = os.path.join(_BASE_DIR, "serviceAccountKey.json")
_SERVICE_ACCOUNT_PARENT = os.path.join(os.path.dirname(_BASE_DIR), "serviceAccountKey.json")


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _safe_dataset_or_table_id(name: str, fallback: str) -> str:
    if name and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    if name:
        logger.warning("Invalid BigQuery identifier %r; using %r", name, fallback)
    return fallback


def _safe_project_id(raw: str) -> str:
    """BigQuery project ids: letters, digits, hyphens (e.g. mke-trees)."""
    p = raw.replace("`", "").strip()
    if p and re.fullmatch(r"[a-z0-9][a-z0-9_.-]*", p, re.I):
        return p
    if p:
        logger.warning("Suspicious BQ_PROJECT_ID %r; using mke-trees", p)
    return "mke-trees"


def _safe_qs_join_column(raw: str) -> str:
    """Allow only simple BigQuery column names to avoid SQL injection in identifiers."""
    name = (raw or "").strip() or "qs_id"
    if name == "qs_id":
        return name
    logger.warning("Invalid BQ_QS_ID_COLUMN %r; using qs_id", name)
    return "qs_id"


def _safe_qs_geometry_column(raw: str) -> str:
    """Quarter-section geometry column: GeoJSON text (STRING) or GEOGRAPHY (centroid via ST_GEOGFROMGEOJSON)."""
    name = (raw or "").strip() or "geometry"
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    logger.warning("Invalid BQ_QS_GEOMETRY_COLUMN %r; using geometry", name)
    return "geometry"


def _safe_tree_qs_id_column(raw: str) -> str:
    """Tree table column joined/filtered by quarter-section id from the map."""
    name = (raw or "").strip() or "qs_id"
    if name == "qs_id":
        return name
    logger.warning("Invalid BQ_TREE_QS_ID_COLUMN %r; using qs_id", name)
    return "qs_id"


class BigQueryEnvConfig(NamedTuple):
    """Resolved BigQuery settings from os.environ (same keys you would use in process.env on Node).

    NamedTuple instead of @dataclass: Firebase's functions analyzer imports this module before it is
    registered in sys.modules, which breaks dataclasses' type introspection on Python 3.12.
    """

    project_id: str
    dataset: str
    trees_table_name: str
    qs_table_name: str
    trees_table_fqn: str
    qs_table_fqn: str
    location: str
    qs_join_column: str
    qs_geometry_column: str
    tree_qs_id_column: str


def bigquery_config_from_environ() -> BigQueryEnvConfig:
    """
    Read BQ_PROJECT_ID (or GCLOUD_PROJECT), BQ_DATASET, table name env vars, BQ_LOCATION,
    and optional full-table overrides. Called per request so emulator env reloads are respected.
    """
    project_id = _safe_project_id(
        _env("BQ_PROJECT_ID") or _env("GCLOUD_PROJECT") or "mke-trees"
    )
    dataset = _safe_dataset_or_table_id(_env("BQ_DATASET", "mke_tree_dataset"), "mke_tree_dataset")
    trees_table_name = _safe_dataset_or_table_id(
        _env("BQ_TREES_TABLE_NAME") or _env("BQ_TABLE_NAME") or "trees_core",
        "trees_core",
    )
    qs_table_name = _safe_dataset_or_table_id(
        _env("BQ_QUARTER_SECTION_TABLE_NAME") or _env("BQ_QS_TABLE_NAME") or "quarter_sections",
        "quarter_sections",
    )
    trees_override = _env("BQ_TREES_TABLE")
    qs_override = _env("BQ_QS_SUMMARIES_TABLE")
    trees_fqn = (
        trees_override.replace("`", "").strip()
        if trees_override
        else f"{project_id}.{dataset}.{trees_table_name}"
    )
    qs_fqn = (
        qs_override.replace("`", "").strip()
        if qs_override
        else f"{project_id}.{dataset}.{qs_table_name}"
    )
    location = _resolve_bq_job_location()
    bq_loc_set = "BQ_LOCATION" in os.environ
    bq_loc_raw = os.environ.get("BQ_LOCATION")
    logger.info(
        "BigQuery env: BQ_LOCATION in_environ=%s raw_value=%r effective=%r",
        bq_loc_set,
        bq_loc_raw,
        location,
    )
    qs_join_column = _safe_qs_join_column(_env("BQ_QS_ID_COLUMN") or "qs_id")
    qs_geometry_column = _safe_qs_geometry_column(_env("BQ_QS_GEOMETRY_COLUMN") or "geometry")
    tree_qs_id_column = _safe_tree_qs_id_column(_env("BQ_TREE_QS_ID_COLUMN") or "qs_id")
    return BigQueryEnvConfig(
        project_id=project_id,
        dataset=dataset,
        trees_table_name=trees_table_name,
        qs_table_name=qs_table_name,
        trees_table_fqn=trees_fqn,
        qs_table_fqn=qs_fqn,
        location=location,
        qs_join_column=qs_join_column,
        qs_geometry_column=qs_geometry_column,
        tree_qs_id_column=tree_qs_id_column,
    )


def _ensure_firebase_app() -> None:
    try:
        firebase_admin.get_app()
    except ValueError:
        key = _resolve_service_account_path()
        if key:
            cred = credentials.Certificate(key)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()


def _resolve_service_account_path() -> str | None:
    env = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if env and os.path.isfile(env):
        return env
    if os.path.isfile(_SERVICE_ACCOUNT_LOCAL):
        return _SERVICE_ACCOUNT_LOCAL
    if os.path.isfile(_SERVICE_ACCOUNT_PARENT):
        return _SERVICE_ACCOUNT_PARENT
    return None


def _bigquery_client(cfg: BigQueryEnvConfig) -> bigquery.Client:
    """Create a client for cfg.project_id; ``location`` matches ``BQ_LOCATION`` (default ``us-central1``)."""
    key = _resolve_service_account_path()
    loc = cfg.location
    if key:
        creds = service_account.Credentials.from_service_account_file(
            key,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        project = cfg.project_id or creds.project_id
        return bigquery.Client(
            credentials=creds,
            project=project,
            location=loc,
        )
    return bigquery.Client(project=cfg.project_id or None, location=loc)


def _run_query(
    client: bigquery.Client,
    sql: str,
    *,
    location: str,
    job_config: bigquery.QueryJobConfig | None = None,
):
    """Run a query job in ``location`` (same as client; passed explicitly for the Python SDK)."""
    return client.query(sql, job_config=job_config, location=location)


def _log_bq_query_start(cfg: BigQueryEnvConfig, *, endpoint: str, sql: str) -> None:
    """Stdout + logger so emulator terminals and Cloud Logging show the exact config."""
    msg = (
        f"[BigQuery] {endpoint}: "
        f"location={cfg.location!r}, "
        f"project_id={cfg.project_id!r}, "
        f"dataset={cfg.dataset!r}, "
        f"trees_table_fqn={cfg.trees_table_fqn!r}, "
        f"quarter_section_table_fqn={cfg.qs_table_fqn!r}, "
        f"trees_table_name={cfg.trees_table_name!r}, "
        f"qs_table_name={cfg.qs_table_name!r}, "
        f"qs_join_column={cfg.qs_join_column!r}, "
        f"qs_geometry_column={cfg.qs_geometry_column!r}, "
        f"tree_qs_id_column={cfg.tree_qs_id_column!r}"
    )
    print(msg, flush=True)
    logger.info(msg)
    preview = sql.strip().replace("\n", " ")[:500]
    preview_msg = f"[BigQuery] {endpoint}: SQL preview (500 chars max): {preview}"
    print(preview_msg, flush=True)
    logger.info(preview_msg)


def _verify_firebase_user(req: https_fn.Request) -> dict[str, Any] | None:
    _ensure_firebase_app()
    auth_header = req.headers.get("Authorization") or ""
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    if not token:
        return None
    try:
        return auth.verify_id_token(token)
    except Exception:
        return None


def _require_approved_claims(
    req: https_fn.Request,
) -> tuple[dict[str, Any] | None, https_fn.Response | None]:
    """Verify Firebase token and (when enabled) BigQuery approval_status=approved."""
    claims = _verify_firebase_user(req)
    if claims is None:
        return None, _json_response(
            req,
            {
                "error": "Unauthorized",
                "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
            },
            status=401,
        )
    if not ac.access_require_approval_enabled():
        return claims, None
    cfg = bigquery_config_from_environ()
    client = _bigquery_client(cfg)
    claims_out, err_payload = ac.enforce_approved_access(
        claims,
        cfg=cfg,
        client=client,
        table_ref_fn=_table_ref,
        run_query_fn=_run_query,
    )
    if err_payload:
        return None, _json_response(req, err_payload, status=403)
    return claims_out, None


def _cors_headers(req: https_fn.Request) -> dict[str, str]:
    """Build CORS response headers (safe if ``req`` or ``headers`` is unusual)."""
    origin = ""
    try:
        hdrs = getattr(req, "headers", None)
        if hdrs is not None:
            raw = hdrs.get("Origin") or hdrs.get("origin") or ""
            if isinstance(raw, bytes):
                origin = raw.decode("latin-1", errors="replace")
            else:
                origin = str(raw or "")
    except Exception as e:
        logger.warning("Failed reading Origin from request headers: %s", e)
        origin = ""
    allowed = (
        "https://mke-trees.web.app",
        "https://mke-trees.firebaseapp.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    )
    allow_origin = origin if origin in allowed else "*"
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With, Accept",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    }


def _cors_preflight_response(req: https_fn.Request) -> https_fn.Response:
    """204 No Content + CORS headers for OPTIONS.

    Uses ``https_fn.Response`` (Flask ``Response``) directly — not ``make_response`` — so this
    works without a Flask application context (required by the Functions framework / tests).
    """
    return https_fn.Response("", status=204, headers=_cors_headers(req))


def _json_response(
    req: https_fn.Request,
    payload: dict[str, Any],
    status: int = 200,
    *,
    cache_control: str | None = None,
) -> https_fn.Response:
    body = json.dumps(payload, default=str)
    headers: dict[str, str] = {
        **_cors_headers(req),
        "Content-Type": "application/json; charset=utf-8",
    }
    if status == 200 and cache_control:
        headers["Cache-Control"] = cache_control
        vary = headers.get("Vary", "")
        auth_vary = cached_http.vary_for_cache()
        if auth_vary.lower() not in vary.lower():
            headers["Vary"] = f"{vary}, {auth_vary}" if vary else auth_vary
    elif status >= 400:
        headers["Cache-Control"] = "no-store"
    return https_fn.Response(body, status=status, headers=headers)


def _priority_level_from_score(priority_score: float) -> str:
    if priority_score >= 70:
        return "Critical"
    if priority_score >= 50:
        return "High"
    if priority_score >= 30:
        return "Medium"
    return "Low"


def _table_ref(full_name: str) -> str:
    """Backtick-quoted BigQuery table id (project.dataset.table)."""
    safe = full_name.replace("`", "").strip()
    return f"`{safe}`"


def _parse_query_param(req: https_fn.Request, name: str) -> str | None:
    args = getattr(req, "args", None)
    if args is not None:
        getter = getattr(args, "get", None)
        if callable(getter):
            v = getter(name)
            if v:
                return str(v)
    full_path = getattr(req, "full_path", None) or getattr(req, "path", "") or ""
    if "?" in full_path:
        qs = parse_qs(full_path.split("?", 1)[1])
        vals = qs.get(name)
        if vals:
            return vals[0]
    return None


_GEOJSON_POLYGON_TYPES = frozenset({"Polygon", "MultiPolygon"})


def _geometry_from_bq_value(raw: Any) -> dict[str, Any] | None:
    """Parse BigQuery geometry payload (GeoJSON string or dict) into a GeoJSON geometry object."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        geom = raw
    elif isinstance(raw, (str, bytes)):
        s = raw.decode() if isinstance(raw, bytes) else raw
        if not str(s).strip():
            return None
        try:
            geom = json.loads(s)
        except json.JSONDecodeError:
            logger.warning("Invalid GeoJSON string from BigQuery (preview): %s", str(s)[:120])
            return None
    else:
        try:
            geom = json.loads(str(raw))
        except json.JSONDecodeError:
            logger.warning("Could not parse geometry; unexpected type=%s", type(raw).__name__)
            return None
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    if gtype not in _GEOJSON_POLYGON_TYPES:
        logger.warning("Skipping unsupported GeoJSON geometry type: %s", gtype)
        return None
    coords = geom.get("coordinates")
    if coords is None:
        logger.warning("Skipping geometry type=%s: missing coordinates", gtype)
        return None
    return geom


def _bq_config_cache_fingerprint(cfg: BigQueryEnvConfig) -> str:
    """Segment for HTTP cache keys so BigQuery table/location/column env changes invalidate entries."""
    return "|".join(
        (
            cfg.qs_table_fqn,
            cfg.trees_table_fqn,
            cfg.location,
            cfg.qs_join_column,
            cfg.qs_geometry_column,
            cfg.tree_qs_id_column,
        )
    )


def _summaries_sql(cfg: BigQueryEnvConfig) -> str:
    """
    Expects refactored operational schema:
    - qs_priority (driver: authoritative qs_id list + PS_* / Priority_Score_Normalized)
    - quarter_sections (LEFT JOIN: OBJECTID, district, geometry)
    - trees_core (dbh, qs_id) aggregated in tree_stats
    """
    qs_t = _table_ref(cfg.qs_table_fqn)
    tree_t = _table_ref(cfg.trees_table_fqn)
    tf_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")
    qsp_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.qs_priority")
    sp_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    id_col = cfg.qs_join_column
    gcol = cfg.qs_geometry_column
    tqs = cfg.tree_qs_id_column
    return f"""
    WITH tree_stats AS (
      SELECT
        TRIM(CAST({tqs} AS STRING)) AS clean_site_id,
        COUNT(*) AS tree_count,
        AVG(CAST(dbh AS FLOAT64)) AS avg_dbh,
        APPROX_TOP_COUNT(
          COALESCE(NULLIF(TRIM(CAST(COALESCE(s.simple_species, s.common_name, s.full_name, s.scientific_name) AS STRING)), ''), 'Unknown')
          , 1
        )[OFFSET(0)].value AS top_species,
        CAST(
          MAX(
            SAFE_CAST(
              REGEXP_EXTRACT(CAST(t.inventory_date AS STRING), r'(19\\d{{2}}|20\\d{{2}})')
              AS INT64
            )
          ) AS STRING
        ) AS inspection_year,
        AVG(
          NULLIF(
            GREATEST(
              COALESCE(SAFE_CAST(t.last_pruned AS FLOAT64), 0),
              COALESCE(
                SAFE_CAST(
                  REGEXP_EXTRACT(CAST(t.last_pruned AS STRING), r'(19\\d{{2}}|20\\d{{2}})')
                  AS FLOAT64
                ),
                0
              )
            ),
            0
          )
        ) AS avg_last_pruned,
        AVG(SAFE_CAST(tf.`I_f` AS FLOAT64)) AS avg_i_f,
        AVG(SAFE_CAST(tf.p_f AS FLOAT64)) AS avg_p_f,
        AVG(SAFE_CAST(tf.a_p AS FLOAT64)) AS avg_a_p,
        AVG(SAFE_CAST(tf.risk_term_k1_I_f_p_f_b AS FLOAT64)) AS avg_risk_term,
        AVG(SAFE_CAST(tf.age_term_k3_a_p AS FLOAT64)) AS avg_age_term
      FROM {tree_t} AS t
      LEFT JOIN {tf_t} AS tf
        ON TRIM(CAST(t.tree_id AS STRING)) = TRIM(CAST(tf.tree_id AS STRING))
      LEFT JOIN {sp_t} s
        ON t.species_id = s.species_id
      GROUP BY clean_site_id
    )
    SELECT
      CAST(qs.OBJECTID AS INT64) AS qs_objectid,
      TRIM(CAST(qsp.qs_id AS STRING)) AS qs_id,
      CAST(qsp.PS_critical AS FLOAT64) AS ps_critical,
      CAST(qsp.PS_bottom90 AS FLOAT64) AS ps_bottom90,
      CAST(qsp.PS_background AS FLOAT64) AS ps_background,
      CAST(qsp.PS_composite AS FLOAT64) AS ps_composite,
      CAST(qsp.Priority_Score_Normalized AS FLOAT64) AS priority_score_normalized,
      CAST(COALESCE(ts.tree_count, 0) AS INT64) AS tree_count,
      CAST(COALESCE(ts.tree_count, 0) AS INT64) AS total_trees,
      CAST(COALESCE(ts.avg_dbh, 0.0) AS FLOAT64) AS avg_dbh,
      CAST(COALESCE(ts.top_species, "Unknown") AS STRING) AS top_species,
      CAST(COALESCE(ts.inspection_year, "Unknown") AS STRING) AS inspection_year,
      ts.avg_last_pruned AS avg_last_pruned,
      ts.avg_i_f AS avg_i_f,
      ts.avg_p_f AS avg_p_f,
      ts.avg_a_p AS avg_a_p,
      ts.avg_risk_term AS avg_risk_term,
      ts.avg_age_term AS avg_age_term,
      CAST(qsp.critical_weight AS FLOAT64) AS critical_weight,
      CAST(qsp.k AS FLOAT64) AS qs_k,
      CAST(COALESCE(qs.district, "Unknown") AS STRING) AS district,
      CAST(qs.{gcol} AS STRING) AS geom_json,
      IF(
        qs.{gcol} IS NOT NULL AND TRIM(CAST(qs.{gcol} AS STRING)) != '',
        ST_X(ST_CENTROID(ST_GEOGFROMGEOJSON(qs.{gcol}))),
        NULL
      ) AS center_lon,
      IF(
        qs.{gcol} IS NOT NULL AND TRIM(CAST(qs.{gcol} AS STRING)) != '',
        ST_Y(ST_CENTROID(ST_GEOGFROMGEOJSON(qs.{gcol}))),
        NULL
      ) AS center_lat
    FROM {qsp_t} qsp
    LEFT JOIN {qs_t} qs
      ON TRIM(CAST(qsp.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
    LEFT JOIN tree_stats ts
      ON TRIM(CAST(qsp.qs_id AS STRING)) = ts.clean_site_id
    """


def _trees_sql(cfg: BigQueryEnvConfig) -> str:
    t = _table_ref(cfg.trees_table_fqn)
    tf = _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")
    sp = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    return f"""
    SELECT
      CAST(t.qs_id AS STRING) AS qs_id,
      CAST(t.tree_id AS STRING) AS tree_id,
      CAST(t.site_id AS STRING) AS site_id,
      CAST(t.latitude AS FLOAT64) AS lat,
      CAST(t.longitude AS FLOAT64) AS lon,
      CAST(t.dbh AS FLOAT64) AS dbh,
      SAFE_CAST(t.height AS FLOAT64) AS height,
      CAST(COALESCE(CAST(t.condition_aerial AS STRING), "Unknown") AS STRING) AS condition_aerial,
      CAST(COALESCE(s.simple_species, s.full_name, s.scientific_name, "Unknown") AS STRING) AS species,
      SAFE_CAST(tf.priority_score AS FLOAT64) AS priority_score,
      SAFE_CAST(tf.`I_f` AS FLOAT64) AS i_f,
      SAFE_CAST(tf.`p_f` AS FLOAT64) AS p_f,
      SAFE_CAST(tf.a_p AS FLOAT64) AS a_p,
      CAST(t.age AS FLOAT64) AS age,
      CAST(t.maintenance_deficit AS INT64) AS maintenance_deficit,
      CAST(t.years_since_pruned AS INT64) AS years_since_pruned,
      SAFE_CAST(t.last_pruned AS FLOAT64) AS last_pruned,
      CAST(t.can_strike_building AS BOOL) AS can_strike_building,
      CAST(t.crown_diameter_m AS FLOAT64) AS crown_diameter_m,
      CAST(COALESCE(CAST(t.missing_or_dead AS STRING), "") AS STRING) AS missing_or_dead
    FROM {t} AS t
    LEFT JOIN {tf} AS tf
      ON TRIM(CAST(t.tree_id AS STRING)) = TRIM(CAST(tf.tree_id AS STRING))
    LEFT JOIN {sp} AS s
      ON t.species_id = s.species_id
    WHERE TRIM(CAST(t.qs_id AS STRING)) = TRIM(@qs_id)
      AND t.latitude IS NOT NULL
      AND t.longitude IS NOT NULL
    """


def _build_summary_from_features(
    features: list[dict[str, Any]],
) -> dict[str, Any]:
    if not features:
        return {
            "bounds": {
                "min_lat": 0.0,
                "max_lat": 0.0,
                "min_lon": 0.0,
                "max_lon": 0.0,
                "center_lat": 0.0,
                "center_lon": 0.0,
            },
            "statistics": {
                "total_quarter_sections": 0,
                "total_trees": 0,
                "priority_levels": {"Critical": 0, "High": 0, "Medium": 0, "Low": 0},
            },
            "districts": [],
            "priority_score_range": {"min": 0.0, "max": 0.0},
        }

    lats: list[float] = []
    lons: list[float] = []
    priority_scores: list[float] = []
    total_trees_sum = 0
    districts: set[str] = set()
    levels = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}

    for f in features:
        p = f.get("properties") or {}
        lat = p.get("center_lat")
        lon = p.get("center_lon")
        if lat is not None and lon is not None:
            lats.append(float(lat))
            lons.append(float(lon))
        psn = p.get("Priority_Score_Normalized")
        if psn is not None:
            priority_scores.append(float(psn))
        pl = p.get("priority_level")
        if pl in levels:
            levels[str(pl)] += 1
        tt = p.get("total_trees")
        if tt is not None:
            total_trees_sum += int(tt)
        district = p.get("district")
        if district is not None and str(district).strip():
            districts.add(str(district))

    min_lat = min(lats) if lats else 0.0
    max_lat = max(lats) if lats else 0.0
    min_lon = min(lons) if lons else 0.0
    max_lon = max(lons) if lons else 0.0
    pmin = min(priority_scores) if priority_scores else 0.0
    pmax = max(priority_scores) if priority_scores else 0.0

    return {
        "bounds": {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lon": min_lon,
            "max_lon": max_lon,
            "center_lat": (min_lat + max_lat) / 2 if lats else 0.0,
            "center_lon": (min_lon + max_lon) / 2 if lons else 0.0,
        },
        "statistics": {
            "total_quarter_sections": len(features),
            "total_trees": total_trees_sum,
            "priority_levels": levels,
        },
        "districts": sorted(districts),
        "priority_score_range": {"min": pmin, "max": pmax},
    }


def _summaries_payload_from_bigquery(
    cfg: BigQueryEnvConfig, client: bigquery.Client
) -> dict[str, Any]:
    summaries_sql = _summaries_sql(cfg)
    _log_bq_query_start(cfg, endpoint="getQuarterSectionSummaries", sql=summaries_sql)
    job = _run_query(client, summaries_sql, location=cfg.location)
    rows = list(job.result())

    features: list[dict[str, Any]] = []
    for row in rows:
        geom = _geometry_from_bq_value(row["geom_json"])
        ps_critical = float(row["ps_critical"] or 0.0)
        ps_bottom90 = float(row["ps_bottom90"] or 0.0)
        ps_background = float(row["ps_background"] or 0.0)
        ps_composite = float(row["ps_composite"] or 0.0)
        priority_score_normalized = float(row["priority_score_normalized"] or 0.0)
        qs = str(row["qs_id"])
        tt = int(row["total_trees"] or 0)
        clat_raw = row.get("center_lat")
        clon_raw = row.get("center_lon")
        clat = float(clat_raw) if clat_raw is not None else None
        clon = float(clon_raw) if clon_raw is not None else None
        avg_dbh = float(row["avg_dbh"] or 0.0)
        feature = {
            "type": "Feature",
            "properties": {
                "quarter_section": qs,
                "qs_id": qs,
                "OBJECTID": int(row["qs_objectid"] or 0),
                "QTRSEC": qs,
                "tree_count": tt,
                "total_trees": tt,
                "PS_critical": ps_critical,
                "PS_bottom90": ps_bottom90,
                "PS_background": ps_background,
                "PS_composite": ps_composite,
                "Priority_Score_Normalized": priority_score_normalized,
                "priority_level": _priority_level_from_score(priority_score_normalized),
                "top_species": str(row["top_species"] or "Unknown"),
                "inspection_year": str(row["inspection_year"] or "Unknown"),
                "avg_last_pruned": _optional_float_for_json(row.get("avg_last_pruned")),
                "avg_i_f": _optional_float_for_json(row.get("avg_i_f")),
                "avg_p_f": _optional_float_for_json(row.get("avg_p_f")),
                "avg_a_p": _optional_float_for_json(row.get("avg_a_p")),
                "avg_risk_term": _optional_float_for_json(row.get("avg_risk_term")),
                "avg_age_term": _optional_float_for_json(row.get("avg_age_term")),
                "critical_weight": _optional_float_for_json(row.get("critical_weight")),
                "qs_k": _optional_float_for_json(row.get("qs_k")),
                "center_lat": clat,
                "center_lon": clon,
                "district": str(row["district"] or "Unknown"),
                "avg_dbh": avg_dbh,
                "has_map_geometry": geom is not None,
            },
            "geometry": geom,
        }
        features.append(feature)

    geojson: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": features,
    }
    summary = _build_summary_from_features(features)
    return {
        "geojson": geojson,
        "summary": summary,
        "tree_points": [],
    }


def _optional_float_for_json(v: Any) -> float | None:
    """Coerce BigQuery numeric / string cell to float; None for missing, non-finite, or NaN."""
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return x


def _metric_from_bq_row(row: Any, *field_names: str) -> float | None:
    """Read first present numeric column from a BigQuery row (alias or source name)."""
    for field in field_names:
        val = None
        try:
            val = row.get(field)  # type: ignore[attr-defined]
        except (AttributeError, TypeError):
            try:
                val = row[field]
            except (KeyError, TypeError, IndexError):
                continue
        out = _optional_float_for_json(val)
        if out is not None:
            return out
    return None


def _trees_payload_from_bigquery(
    qs_id: str, cfg: BigQueryEnvConfig, client: bigquery.Client
) -> dict[str, Any]:
    trees_sql = _trees_sql(cfg)
    _log_bq_query_start(cfg, endpoint="getTreesByQs", sql=trees_sql)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("qs_id", "STRING", qs_id),
        ]
    )
    job = _run_query(client, trees_sql, location=cfg.location, job_config=job_config)
    rows = list(job.result())
    trees: list[dict[str, Any]] = []
    for row in rows:
        trees.append(
            {
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "dbh": float(row["dbh"]) if row["dbh"] is not None else 0.0,
                "height": _optional_float_for_json(row.get("height")),
                "condition_aerial": str(row["condition_aerial"] or "Unknown"),
                "condition": str(row["condition_aerial"] or "Unknown"),
                "species": str(row["species"] or "Unknown"),
                "qs_id": str(row["qs_id"] or qs_id),
                "quarter_section": str(row["qs_id"] or qs_id),
                "tree_id": str(row["tree_id"] or ""),
                "tree_row_id": str(row["tree_id"] or ""),
                "site_id": str(row["site_id"] or ""),
                "priority_score": _metric_from_bq_row(row, "priority_score") or 0.0,
                "i_f": _metric_from_bq_row(row, "i_f", "I_f"),
                "p_f": _metric_from_bq_row(row, "p_f", "P_f"),
                "a_p": _metric_from_bq_row(row, "a_p"),
                "age": float(row["age"]) if row["age"] is not None else 0.0,
                "maintenance_deficit": int(row["maintenance_deficit"] or 0),
                "years_since_pruned": int(row["years_since_pruned"] or 0),
                "last_pruned": _metric_from_bq_row(row, "last_pruned"),
                "can_strike_building": bool(row["can_strike_building"])
                if row["can_strike_building"] is not None
                else False,
                "crown_diameter_m": float(row["crown_diameter_m"])
                if row["crown_diameter_m"] is not None
                else 0.0,
                "missing_or_dead": str(row["missing_or_dead"] or ""),
            }
        )
    return {"qs_id": qs_id, "trees": trees}


_SUMMARIES_TTL_SECONDS = 86400
# Bump when getQuarterSectionSummaries SELECT / GeoJSON properties change (invalidates json_cache).
_SUMMARIES_PAYLOAD_CACHE_REVISION = "v5-all-qs-priority-rows"
_TREES_TTL_SECONDS = 86400
_SHAP_EXPLANATION_TTL_SECONDS = 86400
# Bump when getTreesByQs SELECT / per-tree JSON shape changes (invalidates in-memory json_cache).
_TREES_PAYLOAD_CACHE_REVISION = "new-schema-v6-site-id"


def _safe_shap_site_id_column(raw: str) -> str:
    """Allowlisted SHAP table column used to match a tree / site id (avoid SQL injection in identifiers)."""
    name = (raw or "").strip() or "Site ID"
    if name == "Site ID":
        return "Site ID"
    allowed = frozenset({"site_id", "tree_id", "tree_row_id", "Site_ID"})
    if name in allowed and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    logger.warning("Invalid BQ_SHAP_SITE_ID_COLUMN %r; using Site ID", raw)
    return "Site ID"


def _shap_site_id_sql_expr(table_alias: str, column_name: str) -> str:
    """Qualified column for WHERE/CAST (handles spaced ``Site ID``)."""
    if column_name == "Site ID":
        return f"`{table_alias}`.`Site ID`"
    return f"{table_alias}.{column_name}"


def _shap_table_fqn_from_cfg(cfg: BigQueryEnvConfig) -> str:
    override = _env("BQ_SHAP_TABLE")
    if override:
        return override.replace("`", "").strip()
    table_name = _safe_dataset_or_table_id(
        _env("BQ_SHAP_TABLE_NAME") or "shap",
        "shap",
    )
    return f"{cfg.project_id}.{cfg.dataset}.{table_name}"


def _shap_http_cache_fingerprint(cfg: BigQueryEnvConfig) -> str:
    site_col = _safe_shap_site_id_column(_env("BQ_SHAP_SITE_ID_COLUMN") or "Site ID")
    return "|".join((_shap_table_fqn_from_cfg(cfg), site_col, cfg.location, cfg.project_id, "shap-v3-site-id"))


_SHAP_CONTRIBUTION_SKIP_COLUMNS = frozenset(
    {
        "Site ID",
        "Site_ID",
        "site_id",
        "tree_id",
        "tree_row_id",
        "qs_id",
        "quarter_section",
        "QTRSEC",
        "english_translation",
        "English_Translation",
    }
)


def _shap_explanation_sql(cfg: BigQueryEnvConfig) -> str:
    shap_fqn = _shap_table_fqn_from_cfg(cfg)
    site_col = _safe_shap_site_id_column(_env("BQ_SHAP_SITE_ID_COLUMN") or "Site ID")
    site_expr = _shap_site_id_sql_expr("s", site_col)
    t = _table_ref(shap_fqn)
    return f"""
    SELECT s.*
    FROM {t} AS s
    WHERE CAST({site_expr} AS STRING) = TRIM(@site_id)
    LIMIT 1
    """


def _shap_numeric_contributions_from_row(row: Any) -> list[dict[str, Any]]:
    """Top SHAP feature contributions from a BigQuery row (numeric fields only)."""
    if row is None:
        return []
    items: list[tuple[str, float]] = []
    try:
        keys = list(row.keys())
    except Exception:  # noqa: BLE001
        return []
    for key in keys:
        col = str(key)
        if col in _SHAP_CONTRIBUTION_SKIP_COLUMNS:
            continue
        raw = row.get(key)
        if raw is None:
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        if not (val == val):  # NaN
            continue
        if abs(val) < 1e-9:
            continue
        items.append((col, val))
    items.sort(key=lambda x: abs(x[1]), reverse=True)
    return [{"feature": name, "value": val} for name, val in items[:18]]


def _log_shap_query_start(cfg: BigQueryEnvConfig, sql: str) -> None:
    shap_fqn = _shap_table_fqn_from_cfg(cfg)
    site_col = _safe_shap_site_id_column(_env("BQ_SHAP_SITE_ID_COLUMN") or "Site ID")
    msg = (
        f"[BigQuery] getTreeShapExplanation: "
        f"location={cfg.location!r}, "
        f"project_id={cfg.project_id!r}, "
        f"shap_table_fqn={shap_fqn!r}, "
        f"shap_site_id_column={site_col!r}"
    )
    print(msg, flush=True)
    logger.info(msg)
    preview = sql.strip().replace("\n", " ")[:500]
    logger.info("[BigQuery] getTreeShapExplanation: SQL preview (500 chars max): %s", preview)
    print(f"[BigQuery] getTreeShapExplanation: SQL preview (500 chars max): {preview}", flush=True)


def _shap_explanation_payload_from_bigquery(
    site_id: str, cfg: BigQueryEnvConfig, client: bigquery.Client
) -> dict[str, Any]:
    sql = _shap_explanation_sql(cfg)
    _log_shap_query_start(cfg, sql)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("site_id", "STRING", site_id),
        ]
    )
    job = _run_query(client, sql, location=cfg.location, job_config=job_config)
    rows = list(job.result())
    if not rows:
        return {"english_translation": None, "contributions": [], "site_id": site_id}
    row = rows[0]
    raw = row.get("english_translation")
    text = str(raw).strip() if raw is not None else ""
    return {
        "site_id": site_id,
        "english_translation": text if text else None,
        "contributions": _shap_numeric_contributions_from_row(row),
    }


@https_fn.on_request()
def getQuarterSectionSummaries(req: https_fn.Request) -> https_fn.Response:
    """
    BigQuery: all quarter-section polygons + priority metadata. No tree points.
    Response: { geojson, summary, tree_points: [] }
    """
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)

    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)

    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err

    bq_cfg = bigquery_config_from_environ()
    http_key = cached_http.cache_key_from_request(req)
    full_key = f"summaries|{_SUMMARIES_PAYLOAD_CACHE_REVISION}|{http_key}|{_bq_config_cache_fingerprint(bq_cfg)}"
    cc = cached_http.cache_control_header(_SUMMARIES_TTL_SECONDS)
    try:

        def _produce() -> dict[str, Any]:
            client = _bigquery_client(bq_cfg)
            return _summaries_payload_from_bigquery(bq_cfg, client)

        payload, _hit = cached_http.json_cache_fetch(
            full_key,
            _SUMMARIES_TTL_SECONDS,
            _produce,
            log_label="getQuarterSectionSummaries",
        )
        return _json_response(req, payload, status=200, cache_control=cc)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "getQuarterSectionSummaries failed: project=%s location=%s qs_table=%s trees_table=%s",
            bq_cfg.project_id,
            bq_cfg.location,
            bq_cfg.qs_table_fqn,
            bq_cfg.trees_table_fqn,
        )
        tb = traceback.format_exc()
        logger.error("getQuarterSectionSummaries traceback:\n%s", tb)
        return _json_response(
            req,
            {
                "error": "Failed to load quarter section summaries",
                "detail": str(e),
                "error_type": type(e).__name__,
            },
            status=500,
        )




@https_fn.on_request()
def getTreesByQs(req: https_fn.Request) -> https_fn.Response:
    """BigQuery: tree points for one quarter section. GET ?qs_id=..."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)

    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)

    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err

    qs_id = _parse_query_param(req, "qs_id")
    if not qs_id or not str(qs_id).strip():
        return _json_response(
            req,
            {"error": "Bad request", "message": "Missing qs_id query parameter"},
            status=400,
        )

    qs_id = str(qs_id).strip()

    bq_cfg = bigquery_config_from_environ()
    http_key = cached_http.cache_key_from_request(req)
    full_key = f"trees|{_TREES_PAYLOAD_CACHE_REVISION}|{http_key}|{_bq_config_cache_fingerprint(bq_cfg)}"
    cc = cached_http.cache_control_header(_TREES_TTL_SECONDS)
    try:

        def _produce_trees() -> dict[str, Any]:
            client = _bigquery_client(bq_cfg)
            return _trees_payload_from_bigquery(qs_id, bq_cfg, client)

        payload, _hit = cached_http.json_cache_fetch(
            full_key,
            _TREES_TTL_SECONDS,
            _produce_trees,
            log_label="getTreesByQs",
        )
        return _json_response(req, payload, status=200, cache_control=cc)
    except Exception as e:  # noqa: BLE001
        logger.exception("getTreesByQs failed qs_id=%s", qs_id)
        return _json_response(
            req,
            {
                "error": "Failed to load trees for quarter section",
                "detail": str(e),
                "error_type": type(e).__name__,
            },
            status=500,
        )


@https_fn.on_request()
def getTreeShapExplanation(req: https_fn.Request) -> https_fn.Response:
    """BigQuery: SHAP narrative + numeric feature contributions for one tree/site. GET ?site_id=..."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)

    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)

    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err

    site_id = _parse_query_param(req, "site_id")
    if not (site_id and str(site_id).strip()):
        full_path = getattr(req, "full_path", None) or getattr(req, "path", "") or ""
        if "?" in full_path:
            qstr = full_path.split("?", 1)[1]
            parsed = parse_qs(qstr, keep_blank_values=True)
            vals = parsed.get("site_id")
            if vals and vals[0] is not None:
                site_id = str(vals[0]).strip()
    if not site_id or not str(site_id).strip():
        return _json_response(
            req,
            {"error": "Bad request", "message": "Missing site_id query parameter"},
            status=400,
        )

    site_id = str(site_id).strip()

    bq_cfg = bigquery_config_from_environ()
    http_key = cached_http.cache_key_from_request(req)
    full_key = f"shap_explanation|{http_key}|{_shap_http_cache_fingerprint(bq_cfg)}"
    cc = cached_http.cache_control_header(_SHAP_EXPLANATION_TTL_SECONDS)
    try:

        def _produce_shap() -> dict[str, Any]:
            client = _bigquery_client(bq_cfg)
            return _shap_explanation_payload_from_bigquery(site_id, bq_cfg, client)

        payload, _hit = cached_http.json_cache_fetch(
            full_key,
            _SHAP_EXPLANATION_TTL_SECONDS,
            _produce_shap,
            log_label="getTreeShapExplanation",
        )
        return _json_response(req, payload, status=200, cache_control=cc)
    except Exception as e:  # noqa: BLE001
        logger.exception("getTreeShapExplanation failed site_id=%s", site_id)
        return _json_response(
            req,
            {
                "error": "Failed to load SHAP explanation",
                "detail": str(e),
                "error_type": type(e).__name__,
            },
            status=500,
        )


_PRIORITY_HISTORY_TTL_SECONDS = 300
_PRIORITY_HISTORY_CACHE_REVISION = "v11"
_DEFAULT_BASELINE_AT = "2026-01-01T00:00:00Z"
SCORE_METRIC_AVG_TREE_PS = "avg_tree_priority_score"


def _history_table_fqn(cfg: BigQueryEnvConfig, table_name: str) -> str:
    safe = _safe_dataset_or_table_id(table_name, table_name)
    return f"{cfg.project_id}.{cfg.dataset}.{safe}"


def _parse_optional_date_param(raw: str | None) -> str | None:
    """Return YYYY-MM-DD if valid, else None."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    return None


def _sync_runs_history_sql(cfg: BigQueryEnvConfig) -> str:
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    return f"""
    SELECT
      CAST(sync_run_id AS STRING) AS sync_run_id,
      CAST(started_at AS STRING) AS started_at,
      CAST(completed_at AS STRING) AS completed_at,
      CAST(status AS STRING) AS status,
      CAST(trees_changed AS INT64) AS trees_changed,
      CAST(trees_ps_recomputed AS INT64) AS trees_ps_recomputed,
      CAST(qs_updated AS INT64) AS qs_updated,
      CAST(model_version AS STRING) AS model_version
    FROM {runs_t}
    WHERE CAST(status AS STRING) = 'success'
    ORDER BY completed_at ASC
    """


def _count_successful_syncs(cfg: BigQueryEnvConfig, client: bigquery.Client) -> int:
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    sql = f"SELECT COUNT(*) AS n FROM {runs_t} WHERE CAST(status AS STRING) = 'success'"
    rows = list(_run_query(client, sql, location=cfg.location).result())
    if not rows:
        return 0
    return int(rows[0].get("n") or 0)


def _history_row_success_only_clause() -> str:
    return "CAST(r.status AS STRING) = 'success'"


def _operational_tree_tables(cfg: BigQueryEnvConfig) -> tuple[str, str, str, str]:
    core_t = _table_ref(cfg.trees_table_fqn)
    tf_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")
    qs_t = _table_ref(cfg.qs_table_fqn)
    id_col = cfg.qs_join_column
    return core_t, tf_t, qs_t, id_col


def _priority_history_qs_sql(cfg: BigQueryEnvConfig) -> str:
    """Multi-sync QS epochs: district-wide averages reconstructed across all trees per sync."""
    return _priority_history_entity_epochs_sql(cfg, entity="quarter_section")


def _priority_history_district_sql(cfg: BigQueryEnvConfig) -> str:
    """Multi-sync district epochs: averages reconstructed across all trees per sync."""
    return _priority_history_entity_epochs_sql(cfg, entity="district")


def _priority_history_entity_epochs_sql(cfg: BigQueryEnvConfig, *, entity: str) -> str:
    """
    Reconstruct post-sync priority_score at each successful sync using all operational trees.

    trees_snapshot_history only has changed trees; naive AVG per sync_run_id compares
    incomparable subsets. Per tree: post-sync after sync i is the next sync's pre-sync PS,
    or current operational PS when no later change exists (latest sync always operational).
  """
    tree_hist_t = _table_ref(_history_table_fqn(cfg, "trees_snapshot_history"))
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    core_t, tf_t, qs_t, id_col = _operational_tree_tables(cfg)
    is_qs = entity == "quarter_section"
    group_select = (
        "t.qs_id,\n      t.district,"
        if is_qs
        else "t.district,"
    )
    group_by_entity = "qs_id, district" if is_qs else "district"
    order_entity = "qs_id" if is_qs else "district"
    qs_filters = (
        """
        AND TRIM(CAST(c.qs_id AS STRING)) != ''
        AND (@qs_id IS NULL OR TRIM(CAST(c.qs_id AS STRING)) = @qs_id)
        """
        if is_qs
        else ""
    )
    return f"""
    WITH sync_order AS (
      SELECT
        CAST(sync_run_id AS STRING) AS sync_run_id,
        CAST(completed_at AS STRING) AS completed_at,
        ROW_NUMBER() OVER (ORDER BY completed_at ASC) AS sync_idx
      FROM {runs_t}
      WHERE CAST(status AS STRING) = 'success'
    ),
    max_sync AS (
      SELECT MAX(sync_idx) AS max_idx FROM sync_order
    ),
    all_trees AS (
      SELECT
        TRIM(CAST(c.tree_id AS STRING)) AS tree_id,
        TRIM(CAST(c.qs_id AS STRING)) AS qs_id,
        CAST(COALESCE(qs.district, 'Unknown') AS STRING) AS district,
        SAFE_CAST(f.priority_score AS FLOAT64) AS current_ps
      FROM {core_t} AS c
      INNER JOIN {tf_t} AS f
        ON TRIM(CAST(c.tree_id AS STRING)) = TRIM(CAST(f.tree_id AS STRING))
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(c.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE c.qs_id IS NOT NULL
        AND f.priority_score IS NOT NULL
        {qs_filters}
        AND (@district IS NULL OR CAST(COALESCE(qs.district, 'Unknown') AS STRING) = @district)
        AND CAST(COALESCE(qs.district, 'Unknown') AS STRING) != 'Unknown'
    ),
    history AS (
      SELECT
        TRIM(CAST(h.tree_id AS STRING)) AS tree_id,
        so.sync_idx,
        SAFE_CAST(h.priority_score AS FLOAT64) AS pre_sync_ps
      FROM {tree_hist_t} AS h
      INNER JOIN sync_order AS so
        ON CAST(h.sync_run_id AS STRING) = so.sync_run_id
      WHERE h.priority_score IS NOT NULL
    ),
    tree_post_epochs AS (
      SELECT
        t.tree_id,
        t.qs_id,
        t.district,
        so.sync_idx,
        so.sync_run_id,
        so.completed_at AS recorded_at,
        CASE
          WHEN so.sync_idx = ms.max_idx THEN t.current_ps
          ELSE COALESCE(hnext.pre_sync_ps, t.current_ps)
        END AS epoch_ps
      FROM all_trees AS t
      CROSS JOIN sync_order AS so
      CROSS JOIN max_sync AS ms
      LEFT JOIN history AS hnext
        ON hnext.tree_id = t.tree_id
        AND hnext.sync_idx = so.sync_idx + 1
    ),
    baseline_trees AS (
      SELECT
        t.tree_id,
        t.qs_id,
        t.district,
        COALESCE(h1.pre_sync_ps, t.current_ps) AS baseline_ps
      FROM all_trees AS t
      LEFT JOIN history AS h1
        ON h1.tree_id = t.tree_id
        AND h1.sync_idx = 1
    ),
    post_epochs AS (
      SELECT
        {group_select}
        sync_run_id,
        recorded_at,
        FALSE AS is_baseline_load,
        FALSE AS is_synthetic_baseline,
        'sync' AS phase,
        AVG(epoch_ps) AS priority_score,
        COUNT(*) AS n
        {", COUNT(DISTINCT t.qs_id) AS qs_count" if not is_qs else ""}
      FROM tree_post_epochs AS t
      GROUP BY {group_by_entity}, sync_idx, sync_run_id, recorded_at
    ),
    baseline_epoch AS (
      SELECT
        {group_select}
        'initial-load' AS sync_run_id,
        CAST(@baseline_at AS STRING) AS recorded_at,
        TRUE AS is_baseline_load,
        TRUE AS is_synthetic_baseline,
        'baseline' AS phase,
        AVG(baseline_ps) AS priority_score,
        COUNT(*) AS n
        {", COUNT(DISTINCT t.qs_id) AS qs_count" if not is_qs else ""}
      FROM baseline_trees AS t
      GROUP BY {group_by_entity}
    )
    SELECT * FROM baseline_epoch
    WHERE (@from_date IS NULL OR DATE(recorded_at) >= @from_date)
      AND (@to_date IS NULL OR DATE(recorded_at) <= @to_date)
    UNION ALL
    SELECT * FROM post_epochs
    WHERE (@from_date IS NULL OR DATE(recorded_at) >= @from_date)
      AND (@to_date IS NULL OR DATE(recorded_at) <= @to_date)
    ORDER BY recorded_at ASC, {order_entity} ASC
    """


def _priority_history_movers_from_rows(
    rows: list[dict[str, Any]], *, id_key: str = "qs_id"
) -> list[dict[str, Any]]:
    """Rank entities by absolute score change between earliest and latest sync point."""
    by_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        entity_id = str(row.get(id_key) or "").strip()
        if not entity_id:
            continue
        by_id.setdefault(entity_id, []).append(row)
    movers: list[dict[str, Any]] = []
    for entity_id, points in by_id.items():
        if len(points) < 2:
            continue
        sorted_pts = sorted(points, key=lambda p: str(p.get("recorded_at") or ""))
        prev = sorted_pts[-2]
        latest = sorted_pts[-1]
        prev_score = _optional_float_for_json(prev.get("priority_score"))
        latest_score = _optional_float_for_json(latest.get("priority_score"))
        if prev_score is None or latest_score is None:
            continue
        delta = latest_score - prev_score
        movers.append(
            {
                "id": entity_id,
                "district": str(latest.get("district") or prev.get("district") or "Unknown"),
                "prev_score": prev_score,
                "latest_score": latest_score,
                "delta": delta,
                "recorded_at": latest.get("recorded_at"),
                "prev_recorded_at": prev.get("recorded_at"),
            }
        )
    movers.sort(key=lambda m: abs(float(m.get("delta") or 0.0)), reverse=True)
    return movers[:25]


def _series_from_history_rows(
    rows: list[dict[str, Any]], *, id_key: str, label_prefix: str = ""
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        entity_id = str(row.get(id_key) or "").strip()
        if not entity_id:
            continue
        bucket = grouped.setdefault(
            entity_id,
            {
                "id": entity_id,
                "label": f"{label_prefix}{entity_id}" if label_prefix else entity_id,
                "district": str(row.get("district") or "Unknown"),
                "points": [],
            },
        )
        if row.get("district"):
            bucket["district"] = str(row.get("district"))
        point: dict[str, Any] = {
            "recorded_at": row.get("recorded_at"),
            "sync_run_id": row.get("sync_run_id"),
            "priority_score": _optional_float_for_json(row.get("priority_score")),
        }
        if row.get("is_baseline_load") in (True, "true", "True", 1):
            point["is_baseline_load"] = True
        if row.get("is_synthetic_baseline") in (True, "true", "True", 1):
            point["is_synthetic_baseline"] = True
        if row.get("phase"):
            point["phase"] = str(row.get("phase"))
        if row.get("n") is not None:
            point["n"] = int(row.get("n") or 0)
        if row.get("ps_composite") is not None:
            point["ps_composite"] = _optional_float_for_json(row.get("ps_composite"))
        if row.get("qs_count") is not None:
            point["qs_count"] = int(row.get("qs_count") or 0)
        bucket["points"].append(point)
    series = list(grouped.values())
    series.sort(key=lambda s: str(s.get("id") or ""))
    return series


def _ensure_baseline_sync_run(sync_rows: list[dict[str, Any]], baseline_at: str | None) -> list[dict[str, Any]]:
    """If the initial bulk load has history rows but no sync_runs entry, synthesize one for the UI."""
    if not baseline_at:
        return sync_rows
    baseline_day = baseline_at[:10]
    for row in sync_rows:
        completed = str(row.get("completed_at") or row.get("started_at") or "")
        if completed[:10] == baseline_day:
            return sync_rows
        source = str(row.get("source") or "").strip().lower()
        run_id = str(row.get("sync_run_id") or "").strip().lower()
        if source in ("baseline", "initial", "initial_load", "legacy") or run_id in (
            "initial-load",
            "initial_load",
        ):
            return sync_rows
    out = list(sync_rows)
    out.insert(
        0,
        {
            "sync_run_id": "initial-load",
            "started_at": baseline_at,
            "completed_at": baseline_at,
            "status": "success",
            "source": "baseline",
            "trees_changed": None,
            "trees_ps_recomputed": None,
            "qs_updated": None,
            "model_version": None,
        },
    )
    return out


def _two_point_qs_history_sql(cfg: BigQueryEnvConfig) -> str:
    """
    First-sync two-point QS series: average tree priority_score (0–1).

    Baseline: pre-sync tree PS from trees_snapshot_history (changed trees per QS).
    Post-sync: average tree PS from live trees_core + trees_features.
    """
    tree_hist_t = _table_ref(_history_table_fqn(cfg, "trees_snapshot_history"))
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    core_t, tf_t, qs_t, id_col = _operational_tree_tables(cfg)
    return f"""
    WITH first_sync AS (
      SELECT
        CAST(sync_run_id AS STRING) AS sync_run_id,
        CAST(completed_at AS STRING) AS completed_at
      FROM {runs_t}
      WHERE CAST(status AS STRING) = 'success'
      ORDER BY completed_at ASC
      LIMIT 1
    ),
    operational AS (
      SELECT
        TRIM(CAST(c.qs_id AS STRING)) AS qs_id,
        CAST(COALESCE(qs.district, 'Unknown') AS STRING) AS district,
        AVG(SAFE_CAST(f.priority_score AS FLOAT64)) AS priority_score,
        COUNT(*) AS n
      FROM {core_t} AS c
      INNER JOIN {tf_t} AS f
        ON TRIM(CAST(c.tree_id AS STRING)) = TRIM(CAST(f.tree_id AS STRING))
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(c.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE c.qs_id IS NOT NULL
        AND TRIM(CAST(c.qs_id AS STRING)) != ''
        AND f.priority_score IS NOT NULL
        AND (@qs_id IS NULL OR TRIM(CAST(c.qs_id AS STRING)) = @qs_id)
        AND (@district IS NULL OR CAST(COALESCE(qs.district, 'Unknown') AS STRING) = @district)
      GROUP BY qs_id, district
    ),
    tree_baseline AS (
      SELECT
        TRIM(CAST(h.qs_id AS STRING)) AS qs_id,
        AVG(SAFE_CAST(h.priority_score AS FLOAT64)) AS priority_score,
        COUNT(*) AS tree_count
      FROM {tree_hist_t} AS h
      CROSS JOIN first_sync AS fs
      WHERE CAST(h.sync_run_id AS STRING) = fs.sync_run_id
        AND h.qs_id IS NOT NULL
        AND TRIM(CAST(h.qs_id AS STRING)) != ''
        AND h.priority_score IS NOT NULL
      GROUP BY qs_id
    )
    SELECT
      o.qs_id,
      o.district,
      'initial-load' AS sync_run_id,
      CAST(@baseline_at AS STRING) AS recorded_at,
      COALESCE(tb.priority_score, o.priority_score) AS priority_score,
      COALESCE(tb.tree_count, o.n) AS n,
      TRUE AS is_baseline_load,
      (tb.qs_id IS NOT NULL) AS is_synthetic_baseline,
      'baseline' AS phase
    FROM operational AS o
    LEFT JOIN tree_baseline AS tb
      ON o.qs_id = tb.qs_id

    UNION ALL

    SELECT
      o.qs_id,
      o.district,
      fs.sync_run_id,
      fs.completed_at AS recorded_at,
      o.priority_score,
      o.n,
      FALSE AS is_baseline_load,
      FALSE AS is_synthetic_baseline,
      'post_sync' AS phase
    FROM operational AS o
    CROSS JOIN first_sync AS fs
    ORDER BY recorded_at ASC, qs_id ASC
    """


def _two_point_district_history_sql(cfg: BigQueryEnvConfig) -> str:
    """District average tree priority_score for the first-sync two-point pattern."""
    tree_hist_t = _table_ref(_history_table_fqn(cfg, "trees_snapshot_history"))
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    core_t, tf_t, qs_t, id_col = _operational_tree_tables(cfg)
    return f"""
    WITH first_sync AS (
      SELECT
        CAST(sync_run_id AS STRING) AS sync_run_id,
        CAST(completed_at AS STRING) AS completed_at
      FROM {runs_t}
      WHERE CAST(status AS STRING) = 'success'
      ORDER BY completed_at ASC
      LIMIT 1
    ),
    operational AS (
      SELECT
        CAST(COALESCE(qs.district, 'Unknown') AS STRING) AS district,
        AVG(SAFE_CAST(f.priority_score AS FLOAT64)) AS priority_score,
        COUNT(*) AS n,
        COUNT(DISTINCT TRIM(CAST(c.qs_id AS STRING))) AS qs_count
      FROM {core_t} AS c
      INNER JOIN {tf_t} AS f
        ON TRIM(CAST(c.tree_id AS STRING)) = TRIM(CAST(f.tree_id AS STRING))
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(c.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE c.qs_id IS NOT NULL
        AND f.priority_score IS NOT NULL
        AND (@district IS NULL OR CAST(COALESCE(qs.district, 'Unknown') AS STRING) = @district)
        AND CAST(COALESCE(qs.district, 'Unknown') AS STRING) != 'Unknown'
      GROUP BY district
    ),
    tree_baseline AS (
      SELECT
        CAST(COALESCE(qs.district, CAST(h.district AS STRING), 'Unknown') AS STRING) AS district,
        AVG(SAFE_CAST(h.priority_score AS FLOAT64)) AS priority_score,
        COUNT(*) AS n,
        COUNT(DISTINCT TRIM(CAST(h.qs_id AS STRING))) AS qs_count
      FROM {tree_hist_t} AS h
      CROSS JOIN first_sync AS fs
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(h.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE CAST(h.sync_run_id AS STRING) = fs.sync_run_id
        AND h.priority_score IS NOT NULL
        AND CAST(COALESCE(qs.district, CAST(h.district AS STRING), 'Unknown') AS STRING) != 'Unknown'
      GROUP BY district
    )
    SELECT
      o.district,
      'initial-load' AS sync_run_id,
      CAST(@baseline_at AS STRING) AS recorded_at,
      COALESCE(tb.priority_score, o.priority_score) AS priority_score,
      COALESCE(tb.n, o.n) AS n,
      COALESCE(tb.qs_count, o.qs_count) AS qs_count,
      TRUE AS is_baseline_load,
      (tb.district IS NOT NULL) AS is_synthetic_baseline,
      'baseline' AS phase
    FROM operational AS o
    LEFT JOIN tree_baseline AS tb
      ON o.district = tb.district

    UNION ALL

    SELECT
      o.district,
      fs.sync_run_id,
      fs.completed_at AS recorded_at,
      o.priority_score,
      o.n,
      o.qs_count,
      FALSE AS is_baseline_load,
      FALSE AS is_synthetic_baseline,
      'post_sync' AS phase
    FROM operational AS o
    CROSS JOIN first_sync AS fs
    ORDER BY recorded_at ASC, district ASC
    """


def _resolve_synthetic_baseline_at(
    cfg: BigQueryEnvConfig,
    *,
    sync_rows: list[dict[str, Any]],
) -> str:
    """Synthetic x-axis date for the pre-sync inventory point (not stored in BQ)."""
    override = _env("BQ_BASELINE_LOAD_AT")
    if override:
        return override
    if sync_rows:
        success_times = [
            str(r.get("completed_at") or r.get("started_at") or "").strip()
            for r in sync_rows
            if str(r.get("completed_at") or r.get("started_at") or "").strip()
        ]
        if success_times:
            first_success_at = min(success_times)
            try:
                normalized = first_success_at.replace("Z", "+00:00")
                dt = datetime.fromisoformat(normalized)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                approx = dt - timedelta(days=150)
                return approx.strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                pass
    return _DEFAULT_BASELINE_AT


def _is_unknown_district(name: str | None) -> bool:
    return str(name or "").strip().lower() in ("", "unknown")


def _metric_epoch_row_to_trends(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pivot epoch rows (wide metrics) into chart-friendly metric series."""
    specs = [
        ("avg_dbh", "Average DBH (in)", 1),
        ("avg_height", "Average height (ft)", 1),
        ("avg_condition", "Average condition (0–4)", 1),
        ("tree_count", "Tree count", 0),
        ("species_richness", "Distinct species", 0),
    ]
    out: list[dict[str, Any]] = []
    for metric_id, label, decimals in specs:
        points: list[dict[str, Any]] = []
        for row in rows:
            raw = row.get(metric_id)
            value = _optional_float_for_json(raw) if metric_id != "tree_count" else (
                int(raw) if raw is not None and str(raw).strip() != "" else None
            )
            if metric_id == "tree_count" and value is None and raw is not None:
                try:
                    value = int(raw)
                except (TypeError, ValueError):
                    value = None
            if value is None:
                continue
            pt: dict[str, Any] = {
                "recorded_at": row.get("recorded_at"),
                "value": float(value) if metric_id != "tree_count" else value,
                "sync_run_id": row.get("sync_run_id"),
            }
            if row.get("phase"):
                pt["phase"] = row.get("phase")
            if row.get("is_baseline_load") in (True, "true", "True", 1):
                pt["is_baseline_load"] = True
            points.append(pt)
        if points:
            out.append(
                {
                    "id": metric_id,
                    "label": label,
                    "decimals": decimals,
                    "points": points,
                }
            )
    return out


def _two_point_metric_epochs_sql(cfg: BigQueryEnvConfig) -> str:
    """Two epoch rows (baseline + post) of inventory averages for the filtered tree set."""
    tree_hist_t = _table_ref(_history_table_fqn(cfg, "trees_snapshot_history"))
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    core_t, tf_t, qs_t, id_col = _operational_tree_tables(cfg)
    return f"""
    WITH first_sync AS (
      SELECT
        CAST(sync_run_id AS STRING) AS sync_run_id,
        CAST(completed_at AS STRING) AS completed_at
      FROM {runs_t}
      WHERE CAST(status AS STRING) = 'success'
      ORDER BY completed_at ASC
      LIMIT 1
    ),
    baseline AS (
      SELECT
        CAST(@baseline_at AS STRING) AS recorded_at,
        'initial-load' AS sync_run_id,
        'baseline' AS phase,
        TRUE AS is_baseline_load,
        AVG(SAFE_CAST(h.dbh AS FLOAT64)) AS avg_dbh,
        AVG(SAFE_CAST(h.height AS FLOAT64)) AS avg_height,
        AVG(SAFE_CAST(h.condition AS FLOAT64)) AS avg_condition,
        COUNT(*) AS tree_count,
        COUNT(DISTINCT h.species_id) AS species_richness
      FROM {tree_hist_t} AS h
      CROSS JOIN first_sync AS fs
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(h.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE CAST(h.sync_run_id AS STRING) = fs.sync_run_id
        AND (@qs_id IS NULL OR TRIM(CAST(h.qs_id AS STRING)) = @qs_id)
        AND (
          @district IS NULL
          OR CAST(COALESCE(qs.district, CAST(h.district AS STRING), 'Unknown') AS STRING) = @district
        )
        AND CAST(COALESCE(qs.district, CAST(h.district AS STRING), 'Unknown') AS STRING) != 'Unknown'
    ),
    post AS (
      SELECT
        fs.completed_at AS recorded_at,
        fs.sync_run_id,
        'post_sync' AS phase,
        FALSE AS is_baseline_load,
        AVG(SAFE_CAST(c.dbh AS FLOAT64)) AS avg_dbh,
        AVG(SAFE_CAST(c.height AS FLOAT64)) AS avg_height,
        AVG(SAFE_CAST(c.condition AS FLOAT64)) AS avg_condition,
        COUNT(*) AS tree_count,
        COUNT(DISTINCT c.species_id) AS species_richness
      FROM {core_t} AS c
      CROSS JOIN first_sync AS fs
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(c.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE c.qs_id IS NOT NULL
        AND (@qs_id IS NULL OR TRIM(CAST(c.qs_id AS STRING)) = @qs_id)
        AND (
          @district IS NULL
          OR CAST(COALESCE(qs.district, 'Unknown') AS STRING) = @district
        )
        AND CAST(COALESCE(qs.district, 'Unknown') AS STRING) != 'Unknown'
      GROUP BY fs.completed_at, fs.sync_run_id
    )
    SELECT * FROM baseline
    UNION ALL
    SELECT * FROM post
    ORDER BY recorded_at ASC
    """


def _multi_sync_metric_epochs_sql(cfg: BigQueryEnvConfig) -> str:
    """Inventory metric epochs across all trees (not snapshot-only subsets)."""
    tree_hist_t = _table_ref(_history_table_fqn(cfg, "trees_snapshot_history"))
    runs_t = _table_ref(_history_table_fqn(cfg, "sync_runs"))
    core_t, tf_t, qs_t, id_col = _operational_tree_tables(cfg)
    return f"""
    WITH sync_order AS (
      SELECT
        CAST(sync_run_id AS STRING) AS sync_run_id,
        CAST(completed_at AS STRING) AS completed_at,
        ROW_NUMBER() OVER (ORDER BY completed_at ASC) AS sync_idx
      FROM {runs_t}
      WHERE CAST(status AS STRING) = 'success'
    ),
    max_sync AS (
      SELECT MAX(sync_idx) AS max_idx FROM sync_order
    ),
    all_trees AS (
      SELECT
        TRIM(CAST(c.tree_id AS STRING)) AS tree_id,
        SAFE_CAST(c.dbh AS FLOAT64) AS current_dbh,
        SAFE_CAST(c.height AS FLOAT64) AS current_height,
        SAFE_CAST(c.condition AS FLOAT64) AS current_condition,
        c.species_id AS current_species_id
      FROM {core_t} AS c
      LEFT JOIN {qs_t} AS qs
        ON TRIM(CAST(c.qs_id AS STRING)) = TRIM(CAST(qs.{id_col} AS STRING))
      WHERE c.qs_id IS NOT NULL
        AND (@qs_id IS NULL OR TRIM(CAST(c.qs_id AS STRING)) = @qs_id)
        AND (
          @district IS NULL
          OR CAST(COALESCE(qs.district, 'Unknown') AS STRING) = @district
        )
        AND CAST(COALESCE(qs.district, 'Unknown') AS STRING) != 'Unknown'
    ),
    history AS (
      SELECT
        TRIM(CAST(h.tree_id AS STRING)) AS tree_id,
        so.sync_idx,
        SAFE_CAST(h.dbh AS FLOAT64) AS pre_dbh,
        SAFE_CAST(h.height AS FLOAT64) AS pre_height,
        SAFE_CAST(h.condition AS FLOAT64) AS pre_condition,
        h.species_id AS pre_species_id
      FROM {tree_hist_t} AS h
      INNER JOIN sync_order AS so
        ON CAST(h.sync_run_id AS STRING) = so.sync_run_id
    ),
    tree_post_epochs AS (
      SELECT
        so.sync_idx,
        so.sync_run_id,
        so.completed_at AS recorded_at,
        CASE WHEN so.sync_idx = ms.max_idx THEN t.current_dbh ELSE COALESCE(hnext.pre_dbh, t.current_dbh) END AS dbh,
        CASE WHEN so.sync_idx = ms.max_idx THEN t.current_height ELSE COALESCE(hnext.pre_height, t.current_height) END AS height,
        CASE WHEN so.sync_idx = ms.max_idx THEN t.current_condition ELSE COALESCE(hnext.pre_condition, t.current_condition) END AS condition,
        CASE WHEN so.sync_idx = ms.max_idx THEN t.current_species_id ELSE COALESCE(hnext.pre_species_id, t.current_species_id) END AS species_id
      FROM all_trees AS t
      CROSS JOIN sync_order AS so
      CROSS JOIN max_sync AS ms
      LEFT JOIN history AS hnext
        ON hnext.tree_id = t.tree_id
        AND hnext.sync_idx = so.sync_idx + 1
    ),
    baseline_trees AS (
      SELECT
        COALESCE(h1.pre_dbh, t.current_dbh) AS dbh,
        COALESCE(h1.pre_height, t.current_height) AS height,
        COALESCE(h1.pre_condition, t.current_condition) AS condition,
        COALESCE(h1.pre_species_id, t.current_species_id) AS species_id
      FROM all_trees AS t
      LEFT JOIN history AS h1
        ON h1.tree_id = t.tree_id
        AND h1.sync_idx = 1
    ),
    post_epochs AS (
      SELECT
        recorded_at,
        sync_run_id,
        'sync' AS phase,
        FALSE AS is_baseline_load,
        AVG(dbh) AS avg_dbh,
        AVG(height) AS avg_height,
        AVG(condition) AS avg_condition,
        COUNT(*) AS tree_count,
        COUNT(DISTINCT species_id) AS species_richness
      FROM tree_post_epochs
      GROUP BY sync_idx, sync_run_id, recorded_at
    ),
    baseline_epoch AS (
      SELECT
        CAST(@baseline_at AS STRING) AS recorded_at,
        'initial-load' AS sync_run_id,
        'baseline' AS phase,
        TRUE AS is_baseline_load,
        AVG(dbh) AS avg_dbh,
        AVG(height) AS avg_height,
        AVG(condition) AS avg_condition,
        COUNT(*) AS tree_count,
        COUNT(DISTINCT species_id) AS species_richness
      FROM baseline_trees
    )
    SELECT * FROM baseline_epoch
    WHERE (@from_date IS NULL OR DATE(recorded_at) >= @from_date)
      AND (@to_date IS NULL OR DATE(recorded_at) <= @to_date)
    UNION ALL
    SELECT * FROM post_epochs
    WHERE (@from_date IS NULL OR DATE(recorded_at) >= @from_date)
      AND (@to_date IS NULL OR DATE(recorded_at) <= @to_date)
    ORDER BY recorded_at ASC
    """


def _fetch_metric_trends(
    cfg: BigQueryEnvConfig,
    client: bigquery.Client,
    *,
    use_two_point: bool,
    baseline_at: str | None,
    qs_id: str | None,
    district: str | None,
    from_date: str | None,
    to_date: str | None,
    params_base: list[bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter],
) -> list[dict[str, Any]]:
    params = list(params_base)
    if use_two_point:
        if not baseline_at:
            return []
        if not any(getattr(p, "name", None) == "baseline_at" for p in params):
            params.append(bigquery.ScalarQueryParameter("baseline_at", "STRING", baseline_at))
        sql = _two_point_metric_epochs_sql(cfg)
        label = "getPriorityHistory:metric_trends_two_point"
    else:
        sql = _multi_sync_metric_epochs_sql(cfg)
        label = "getPriorityHistory:metric_trends_multi"

    _log_bq_query_start(cfg, endpoint=label, sql=sql)
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    epoch_rows = [
        dict(r.items())
        for r in _run_query(client, sql, location=cfg.location, job_config=job_config).result()
    ]
    return _metric_epoch_row_to_trends(epoch_rows)


def _filter_unknown_district_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if not _is_unknown_district(str(r.get("district") or ""))]


def _filter_unknown_district_series(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        s
        for s in series
        if not _is_unknown_district(str(s.get("id") or ""))
        and not _is_unknown_district(str(s.get("district") or ""))
    ]


def _distinct_history_dates(rows: list[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for row in rows:
        raw = row.get("recorded_at")
        if raw is None:
            continue
        out.add(str(raw)[:10])
    return out


def _priority_history_payload_from_bigquery(
    cfg: BigQueryEnvConfig,
    client: bigquery.Client,
    *,
    scope: str,
    qs_id: str | None,
    district: str | None,
    from_date: str | None,
    to_date: str | None,
) -> dict[str, Any]:
    sync_sql = _sync_runs_history_sql(cfg)
    _log_bq_query_start(cfg, endpoint="getPriorityHistory:sync_runs", sql=sync_sql)
    sync_rows = [
        dict(r.items())
        for r in _run_query(client, sync_sql, location=cfg.location).result()
    ]
    successful_sync_count = _count_successful_syncs(cfg, client)
    use_two_point = successful_sync_count < 2

    scope_norm = (scope or "quarter_section").strip().lower()
    if scope_norm not in ("quarter_section", "district"):
        scope_norm = "quarter_section"

    params: list[bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter] = [
        bigquery.ScalarQueryParameter("qs_id", "STRING", qs_id),
        bigquery.ScalarQueryParameter("district", "STRING", district),
    ]
    if from_date:
        params.append(bigquery.ScalarQueryParameter("from_date", "DATE", from_date))
    else:
        params.append(bigquery.ScalarQueryParameter("from_date", "DATE", None))
    if to_date:
        params.append(bigquery.ScalarQueryParameter("to_date", "DATE", to_date))
    else:
        params.append(bigquery.ScalarQueryParameter("to_date", "DATE", None))

    synthetic_baseline_at: str | None = None
    synthetic_injected = False

    if use_two_point:
        synthetic_baseline_at = _resolve_synthetic_baseline_at(cfg, sync_rows=sync_rows)
        params.append(bigquery.ScalarQueryParameter("baseline_at", "STRING", synthetic_baseline_at))
        if scope_norm == "district":
            hist_sql = _two_point_district_history_sql(cfg)
            id_key = "district"
            label_prefix = "District "
        else:
            hist_sql = _two_point_qs_history_sql(cfg)
            id_key = "qs_id"
            label_prefix = "QS "
        synthetic_injected = True
        sync_rows = _ensure_baseline_sync_run(sync_rows, synthetic_baseline_at)
    else:
        synthetic_baseline_at = _resolve_synthetic_baseline_at(cfg, sync_rows=sync_rows)
        params.append(bigquery.ScalarQueryParameter("baseline_at", "STRING", synthetic_baseline_at))
        synthetic_injected = True
        sync_rows = _ensure_baseline_sync_run(sync_rows, synthetic_baseline_at)
        if scope_norm == "district":
            hist_sql = _priority_history_district_sql(cfg)
            id_key = "district"
            label_prefix = "District "
        else:
            hist_sql = _priority_history_qs_sql(cfg)
            id_key = "qs_id"
            label_prefix = "QS "

    _log_bq_query_start(
        cfg,
        endpoint=f"getPriorityHistory:{scope_norm}{':two_point' if use_two_point else ''}",
        sql=hist_sql,
    )
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    hist_rows = [
        dict(r.items())
        for r in _run_query(client, hist_sql, location=cfg.location, job_config=job_config).result()
    ]
    if scope_norm == "district":
        hist_rows = _filter_unknown_district_rows(hist_rows)

    series = _series_from_history_rows(hist_rows, id_key=id_key, label_prefix=label_prefix)
    if scope_norm == "district":
        series = _filter_unknown_district_series(series)
    movers = _priority_history_movers_from_rows(hist_rows, id_key=id_key)

    metric_trends: list[dict[str, Any]] = []
    if scope_norm == "quarter_section":
        metric_trends = _fetch_metric_trends(
            cfg,
            client,
            use_two_point=use_two_point,
            baseline_at=synthetic_baseline_at,
            qs_id=qs_id,
            district=district,
            from_date=from_date,
            to_date=to_date,
            params_base=params,
        )

    districts = sorted(
        {
            str(r.get("district") or "")
            for r in hist_rows
            if r.get("district") and not _is_unknown_district(str(r.get("district")))
        }
    )

    return {
        "scope": scope_norm,
        "score_metric": SCORE_METRIC_AVG_TREE_PS,
        "sync_runs": sync_rows,
        "series": series,
        "movers": movers,
        "metric_trends": metric_trends,
        "districts": districts,
        "synthetic_baseline_injected": synthetic_injected,
        "synthetic_baseline_at": synthetic_baseline_at,
        "two_point_mode": use_two_point,
        "successful_sync_count": successful_sync_count,
        "filters": {
            "qs_id": qs_id,
            "district": district,
            "from": from_date,
            "to": to_date,
        },
    }


@https_fn.on_request()
def getPriorityHistory(req: https_fn.Request) -> https_fn.Response:
    """BigQuery: quarter-section or district priority score history from qs_priority_history."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)

    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)

    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err

    scope = str(_parse_query_param(req, "scope") or "quarter_section").strip().lower()
    qs_id_raw = _parse_query_param(req, "qs_id")
    qs_id = str(qs_id_raw).strip() if qs_id_raw and str(qs_id_raw).strip() else None
    district_raw = _parse_query_param(req, "district")
    district = str(district_raw).strip() if district_raw and str(district_raw).strip() else None
    from_date = _parse_optional_date_param(_parse_query_param(req, "from"))
    to_date = _parse_optional_date_param(_parse_query_param(req, "to"))

    bq_cfg = bigquery_config_from_environ()
    http_key = cached_http.cache_key_from_request(req)
    full_key = (
        f"priority_history|{_PRIORITY_HISTORY_CACHE_REVISION}|{http_key}|"
        f"{_bq_config_cache_fingerprint(bq_cfg)}"
    )
    cc = cached_http.cache_control_header(_PRIORITY_HISTORY_TTL_SECONDS)
    try:

        def _produce() -> dict[str, Any]:
            client = _bigquery_client(bq_cfg)
            return _priority_history_payload_from_bigquery(
                bq_cfg,
                client,
                scope=scope,
                qs_id=qs_id,
                district=district,
                from_date=from_date,
                to_date=to_date,
            )

        payload, _hit = cached_http.json_cache_fetch(
            full_key,
            _PRIORITY_HISTORY_TTL_SECONDS,
            _produce,
            log_label="getPriorityHistory",
        )
        return _json_response(req, payload, status=200, cache_control=cc)
    except Exception as e:  # noqa: BLE001
        logger.exception("getPriorityHistory failed scope=%s qs_id=%s district=%s", scope, qs_id, district)
        return _json_response(
            req,
            {
                "error": "Failed to load priority score history",
                "message": str(e),
                "detail": str(e),
                "error_type": type(e).__name__,
            },
            status=500,
        )


def _tasks_table_fqn(cfg: BigQueryEnvConfig, table_name: str) -> str:
    safe = _safe_dataset_or_table_id(table_name, table_name)
    return f"{cfg.project_id}.{cfg.dataset}.{safe}"


def _list_users_payload(cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    users_t = _table_ref(_tasks_table_fqn(cfg, "users"))
    sql = f"""
    SELECT
      CAST(user_id AS STRING) AS user_id,
      CAST(email AS STRING) AS email,
      CAST(role AS STRING) AS role,
      CAST(active AS BOOL) AS active,
      CAST(created_at AS STRING) AS created_at
    FROM {users_t}
    ORDER BY created_at DESC
    """
    rows = list(_run_query(client, sql, location=cfg.location).result())
    users: list[dict[str, Any]] = []
    for r in rows:
        users.append(
            {
                "user_id": str(r["user_id"] or ""),
                "email": str(r["email"] or ""),
                "role": str(r["role"] or "viewer"),
                "active": bool(r["active"]) if r["active"] is not None else True,
                "created_at": str(r["created_at"] or ""),
            }
        )
    return {"users": users}


def _list_tasks_payload(cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    sr_t = _table_ref(_tasks_table_fqn(cfg, "service_requests"))
    sra_t = _table_ref(_tasks_table_fqn(cfg, "service_request_assignees"))
    users_t = _table_ref(_tasks_table_fqn(cfg, "users"))
    sql = f"""
    SELECT
      CAST(sr.service_request_id AS STRING) AS service_request_id,
      CAST(sr.tree_id AS STRING) AS tree_id,
      CAST(sr.request_type AS STRING) AS request_type,
      CAST(sr.priority AS STRING) AS priority,
      CAST(sr.status AS STRING) AS status,
      CAST(sr.notes AS STRING) AS notes,
      CAST(sr.created_by AS STRING) AS created_by,
      CAST(sr.requested_at AS STRING) AS requested_at,
      CAST(sr.due_at AS STRING) AS due_at,
      ARRAY_AGG(CAST(sra.user_id AS STRING) IGNORE NULLS) AS assignee_user_ids,
      ARRAY_AGG(CAST(u.email AS STRING) IGNORE NULLS) AS assignee_emails
    FROM {sr_t} AS sr
    LEFT JOIN {sra_t} AS sra ON sr.service_request_id = sra.service_request_id
    LEFT JOIN {users_t} AS u ON sra.user_id = u.user_id
    GROUP BY 1,2,3,4,5,6,7,8,9
    ORDER BY requested_at DESC
    """
    rows = list(_run_query(client, sql, location=cfg.location).result())
    tasks: list[dict[str, Any]] = []
    for r in rows:
        tasks.append(
            {
                "service_request_id": str(r["service_request_id"] or ""),
                "tree_id": str(r["tree_id"] or ""),
                "request_type": str(r["request_type"] or ""),
                "priority": str(r["priority"] or ""),
                "status": str(r["status"] or ""),
                "notes": str(r["notes"] or ""),
                "created_by": str(r["created_by"] or ""),
                "requested_at": str(r["requested_at"] or ""),
                "due_at": str(r["due_at"] or ""),
                "assignee_user_ids": [str(v) for v in (r["assignee_user_ids"] or []) if v],
                "assignee_emails": [str(v) for v in (r["assignee_emails"] or []) if v],
            }
        )
    return {"tasks": tasks}


def _create_user(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    users_t = _table_ref(_tasks_table_fqn(cfg, "users"))
    user_id_raw = req_body.get("user_id")
    email_raw = req_body.get("email")
    role_raw = req_body.get("role") or "viewer"
    user_id = str(user_id_raw or "").strip()
    email = str(email_raw or "").strip()
    role = str(role_raw).strip().lower()
    if not user_id:
        raise ValueError("user_id is required")
    if not email:
        raise ValueError("email is required")
    if role not in {"admin", "arborist", "viewer"}:
        raise ValueError("role must be one of admin, arborist, viewer")
    sql = f"""
    MERGE {users_t} t
    USING (
      SELECT
        @user_id AS user_id,
        @email AS email,
        @role AS role,
        TRUE AS active,
        CURRENT_TIMESTAMP() AS created_at
    ) s
    ON t.user_id = s.user_id
    WHEN MATCHED THEN UPDATE SET
      email = s.email,
      role = s.role,
      active = TRUE
    WHEN NOT MATCHED THEN
      INSERT (user_id, email, role, active, created_at)
      VALUES (s.user_id, s.email, s.role, s.active, s.created_at)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
            bigquery.ScalarQueryParameter("email", "STRING", email),
            bigquery.ScalarQueryParameter("role", "STRING", role),
        ]
    )
    _run_query(client, sql, location=cfg.location, job_config=job_config).result()
    return {"ok": True, "user_id": user_id, "email": email, "role": role, "updated_by": str(claims.get("uid") or "")}


def _create_task(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    sr_t = _table_ref(_tasks_table_fqn(cfg, "service_requests"))
    sra_t = _table_ref(_tasks_table_fqn(cfg, "service_request_assignees"))
    task_id = str(req_body.get("service_request_id") or uuid.uuid4().hex[:20]).strip()
    tree_id = str(req_body.get("tree_id") or "").strip()
    request_type = str(req_body.get("request_type") or "inspect").strip().lower()
    priority = str(req_body.get("priority") or "med").strip().lower()
    status = str(req_body.get("status") or "open").strip().lower()
    notes = str(req_body.get("notes") or "").strip()
    due_at = req_body.get("due_at")
    created_by = str(claims.get("uid") or "").strip()
    assignees_raw = req_body.get("assignee_user_ids") or []
    assignees = [str(v).strip() for v in assignees_raw if str(v).strip()]
    if not tree_id:
        raise ValueError("tree_id is required")
    if request_type not in {"prune", "remove", "plant", "inspect", "treat"}:
        raise ValueError("request_type must be one of prune, remove, plant, inspect, treat")
    if priority not in {"low", "med", "high", "critical"}:
        raise ValueError("priority must be one of low, med, high, critical")
    if status not in {"open", "in_progress", "completed", "cancelled"}:
        raise ValueError("status must be one of open, in_progress, completed, cancelled")
    if not created_by:
        raise ValueError("authenticated user id is required")
    insert_sql = f"""
    INSERT INTO {sr_t}
      (service_request_id, tree_id, request_type, priority, status, requested_at, due_at, completed_at, notes, created_by)
    VALUES
      (@service_request_id, @tree_id, @request_type, @priority, @status, CURRENT_TIMESTAMP(), SAFE_CAST(@due_at AS TIMESTAMP), NULL, @notes, @created_by)
    """
    insert_cfg = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
            bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id),
            bigquery.ScalarQueryParameter("request_type", "STRING", request_type),
            bigquery.ScalarQueryParameter("priority", "STRING", priority),
            bigquery.ScalarQueryParameter("status", "STRING", status),
            bigquery.ScalarQueryParameter("due_at", "STRING", str(due_at or "")),
            bigquery.ScalarQueryParameter("notes", "STRING", notes),
            bigquery.ScalarQueryParameter("created_by", "STRING", created_by),
        ]
    )
    _run_query(client, insert_sql, location=cfg.location, job_config=insert_cfg).result()
    if assignees:
        assignee_sql = f"""
        INSERT INTO {sra_t} (service_request_id, user_id, assigned_at, assigned_by)
        SELECT @service_request_id, uid, CURRENT_TIMESTAMP(), @assigned_by
        FROM UNNEST(@assignee_user_ids) uid
        """
        assignee_cfg = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
                bigquery.ScalarQueryParameter("assigned_by", "STRING", created_by),
                bigquery.ArrayQueryParameter("assignee_user_ids", "STRING", assignees),
            ]
        )
        _run_query(client, assignee_sql, location=cfg.location, job_config=assignee_cfg).result()
    return {"ok": True, "service_request_id": task_id, "created_by": created_by}


def _assign_task_users(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    sra_t = _table_ref(_tasks_table_fqn(cfg, "service_request_assignees"))
    task_id = str(req_body.get("service_request_id") or "").strip()
    assignees_raw = req_body.get("assignee_user_ids") or []
    assignees = [str(v).strip() for v in assignees_raw if str(v).strip()]
    assigned_by = str(claims.get("uid") or "").strip()
    if not task_id:
        raise ValueError("service_request_id is required")
    if not assigned_by:
        raise ValueError("authenticated user id is required")
    delete_sql = f"DELETE FROM {sra_t} WHERE service_request_id = @service_request_id"
    delete_cfg = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
        ]
    )
    _run_query(client, delete_sql, location=cfg.location, job_config=delete_cfg).result()
    if assignees:
        insert_sql = f"""
        INSERT INTO {sra_t} (service_request_id, user_id, assigned_at, assigned_by)
        SELECT @service_request_id, uid, CURRENT_TIMESTAMP(), @assigned_by
        FROM UNNEST(@assignee_user_ids) uid
        """
        insert_cfg = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
                bigquery.ScalarQueryParameter("assigned_by", "STRING", assigned_by),
                bigquery.ArrayQueryParameter("assignee_user_ids", "STRING", assignees),
            ]
        )
        _run_query(client, insert_sql, location=cfg.location, job_config=insert_cfg).result()
    return {"ok": True, "service_request_id": task_id, "assignee_count": len(assignees)}


def _complete_task(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    sr_t = _table_ref(_tasks_table_fqn(cfg, "service_requests"))
    task_id = str(req_body.get("service_request_id") or "").strip()
    if not task_id:
        raise ValueError("service_request_id is required")
    sql = f"""
    UPDATE {sr_t}
    SET
      status = 'completed',
      completed_at = CURRENT_TIMESTAMP()
    WHERE service_request_id = @service_request_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
        ]
    )
    qj = _run_query(client, sql, location=cfg.location, job_config=job_config)
    qj.result()
    if qj.num_dml_affected_rows is not None and qj.num_dml_affected_rows == 0:
        raise ValueError("No task found with that service_request_id")
    return {"ok": True, "service_request_id": task_id, "completed_by": str(claims.get("uid") or "")}


def _delete_task(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    sra_t = _table_ref(_tasks_table_fqn(cfg, "service_request_assignees"))
    sr_t = _table_ref(_tasks_table_fqn(cfg, "service_requests"))
    task_id = str(req_body.get("service_request_id") or "").strip()
    if not task_id:
        raise ValueError("service_request_id is required")
    del_assign = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
        ]
    )
    _run_query(
        client,
        f"DELETE FROM {sra_t} WHERE service_request_id = @service_request_id",
        location=cfg.location,
        job_config=del_assign,
    ).result()
    del_sr = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("service_request_id", "STRING", task_id),
        ]
    )
    qj_sr = _run_query(
        client,
        f"DELETE FROM {sr_t} WHERE service_request_id = @service_request_id",
        location=cfg.location,
        job_config=del_sr,
    )
    qj_sr.result()
    if qj_sr.num_dml_affected_rows is not None and qj_sr.num_dml_affected_rows == 0:
        raise ValueError("No task found with that service_request_id")
    return {"ok": True, "service_request_id": task_id, "deleted_by": str(claims.get("uid") or "")}


def _safe_tree_id_param(raw: Any) -> str:
    s = str(raw or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._\-]{1,256}", s):
        raise ValueError("tree_id must be 1-256 characters: letters, digits, . _ -")
    return s


def _trees_core_qs_column(cfg: BigQueryEnvConfig) -> str:
    col = (cfg.tree_qs_id_column or "").strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", col):
        return "qs_id"
    return col


def _trees_features_table_ref(cfg: BigQueryEnvConfig) -> str:
    return _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")


def _list_species_short_payload(cfg: BigQueryEnvConfig, client: bigquery.Client, limit: int) -> dict[str, Any]:
    lim = min(max(int(limit or 500), 1), 3000)
    species_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    sql = f"""
    SELECT
      CAST(s.species_id AS INT64) AS species_id,
      CAST(
        COALESCE(
          NULLIF(TRIM(s.simple_species), ''),
          NULLIF(TRIM(s.full_name), ''),
          NULLIF(TRIM(s.scientific_name), ''),
          CAST(s.species_id AS STRING)
        ) AS STRING
      ) AS label
    FROM {species_t} AS s
    ORDER BY label
    LIMIT {lim}
    """
    rows = list(_run_query(client, sql, location=cfg.location).result())
    species: list[dict[str, Any]] = []
    for r in rows:
        sid = r.get("species_id")
        if sid is None:
            continue
        species.append({"species_id": int(sid), "label": str(r.get("label") or "")})
    return {"species": species}


def _get_tree_core_row(cfg: BigQueryEnvConfig, client: bigquery.Client, tree_id: str) -> dict[str, Any]:
    t = _table_ref(cfg.trees_table_fqn)
    sp = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    qc = _trees_core_qs_column(cfg)
    sql = f"""
    SELECT
      CAST(t.tree_id AS STRING) AS tree_id,
      CAST(t.site_id AS STRING) AS site_id,
      CAST(t.{qc} AS STRING) AS qs_id,
      t.species_id AS species_id,
      CAST(COALESCE(s.simple_species, s.full_name, s.scientific_name, '') AS STRING) AS species_label,
      SAFE_CAST(t.latitude AS FLOAT64) AS latitude,
      SAFE_CAST(t.longitude AS FLOAT64) AS longitude,
      SAFE_CAST(t.dbh AS FLOAT64) AS dbh,
      SAFE_CAST(t.height AS FLOAT64) AS height,
      CAST(COALESCE(CAST(t.condition_aerial AS STRING), '') AS STRING) AS condition_aerial,
      CAST(COALESCE(CAST(t.inventory_date AS STRING), '') AS STRING) AS inventory_date,
      SAFE_CAST(t.years_since_pruned AS INT64) AS years_since_pruned,
      SAFE_CAST(t.maintenance_deficit AS INT64) AS maintenance_deficit,
      SAFE_CAST(t.age AS FLOAT64) AS age,
      t.can_strike_building AS can_strike_building,
      SAFE_CAST(t.crown_diameter_m AS FLOAT64) AS crown_diameter_m,
      CAST(COALESCE(CAST(t.missing_or_dead AS STRING), '') AS STRING) AS missing_or_dead,
      CAST(COALESCE(CAST(t.status AS STRING), '') AS STRING) AS status
    FROM {t} AS t
    LEFT JOIN {sp} AS s ON t.species_id = s.species_id
    WHERE CAST(t.tree_id AS STRING) = @tree_id
    LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id)]
    )
    rows = list(_run_query(client, sql, location=cfg.location, job_config=job_config).result())
    if not rows:
        raise ValueError("Tree not found")
    r = rows[0]
    return {
        "tree_id": str(r["tree_id"] or ""),
        "site_id": str(r["site_id"] or ""),
        "qs_id": str(r["qs_id"] or ""),
        "species_id": int(r["species_id"]) if r["species_id"] is not None else None,
        "species_label": str(r["species_label"] or ""),
        "latitude": _optional_float_for_json(r.get("latitude")),
        "longitude": _optional_float_for_json(r.get("longitude")),
        "dbh": float(r["dbh"] or 0.0) if r["dbh"] is not None else None,
        "height": _optional_float_for_json(r.get("height")),
        "condition_aerial": str(r["condition_aerial"] or ""),
        "inventory_date": str(r["inventory_date"] or ""),
        "years_since_pruned": int(r["years_since_pruned"] or 0) if r["years_since_pruned"] is not None else None,
        "maintenance_deficit": int(r["maintenance_deficit"] or 0) if r["maintenance_deficit"] is not None else None,
        "age": _optional_float_for_json(r.get("age")),
        "can_strike_building": bool(r["can_strike_building"]) if r["can_strike_building"] is not None else False,
        "crown_diameter_m": _optional_float_for_json(r.get("crown_diameter_m")),
        "missing_or_dead": str(r["missing_or_dead"] or ""),
        "status": str(r["status"] or ""),
    }


def _create_tree_core(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    tid = str(req_body.get("tree_id") or "").strip()
    tree_id = _safe_tree_id_param(tid if tid else uuid.uuid4().hex[:28])
    qc = _trees_core_qs_column(cfg)
    qs_id = str(req_body.get("qs_id") or "").strip()
    if not qs_id:
        raise ValueError("qs_id is required")
    lat = float(req_body.get("latitude"))
    lon = float(req_body.get("longitude"))
    if lat != lat or lon != lon:
        raise ValueError("latitude and longitude must be numbers")
    dbh_f = float(req_body.get("dbh") or 0)
    dbh_i = int(round(dbh_f))
    species_raw = req_body.get("species_id")
    if species_raw is None or str(species_raw).strip() == "":
        raise ValueError("species_id is required for new inventory rows")
    species_id = int(species_raw)
    height_ins = _optional_float_for_json(req_body.get("height"))
    condition_aerial = str(req_body.get("condition_aerial") or "Unknown").strip() or "Unknown"
    inventory_date = str(req_body.get("inventory_date") or "").strip()
    years_since_pruned = int(req_body.get("years_since_pruned") or 0)
    maintenance_deficit = int(req_body.get("maintenance_deficit") or 0)
    age = _optional_float_for_json(req_body.get("age")) or 0.0
    can_strike = bool(req_body.get("can_strike_building"))
    crown_m = float(req_body.get("crown_diameter_m") or 0.0)
    missing_or_dead = str(req_body.get("missing_or_dead") or "").strip()
    site_id = str(req_body.get("site_id") or tree_id).strip() or tree_id
    status = str(req_body.get("status") or "Active").strip() or "Active"
    t = _table_ref(cfg.trees_table_fqn)
    sql = f"""
    INSERT INTO {t} (
      tree_id,
      site_id,
      {qc},
      species_id,
      status,
      created_at,
      updated_at,
      latitude,
      longitude,
      dbh,
      height,
      condition_aerial,
      inventory_date,
      years_since_pruned,
      maintenance_deficit,
      age,
      can_strike_building,
      crown_diameter_m,
      missing_or_dead
    )
    VALUES (
      @tree_id,
      @site_id,
      @qs_id,
      @species_id,
      @status,
      CURRENT_TIMESTAMP(),
      CURRENT_TIMESTAMP(),
      @latitude,
      @longitude,
      @dbh,
      @height,
      @condition_aerial,
      @inventory_date,
      @years_since_pruned,
      @maintenance_deficit,
      @age,
      @can_strike_building,
      @crown_diameter_m,
      @missing_or_dead
    )
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id),
            bigquery.ScalarQueryParameter("site_id", "STRING", site_id),
            bigquery.ScalarQueryParameter("qs_id", "STRING", qs_id),
            bigquery.ScalarQueryParameter("species_id", "INT64", species_id),
            bigquery.ScalarQueryParameter("status", "STRING", status),
            bigquery.ScalarQueryParameter("latitude", "FLOAT64", lat),
            bigquery.ScalarQueryParameter("longitude", "FLOAT64", lon),
            bigquery.ScalarQueryParameter("dbh", "INT64", dbh_i),
            bigquery.ScalarQueryParameter("height", "FLOAT64", height_ins),
            bigquery.ScalarQueryParameter("condition_aerial", "STRING", condition_aerial),
            bigquery.ScalarQueryParameter("inventory_date", "STRING", inventory_date),
            bigquery.ScalarQueryParameter("years_since_pruned", "INT64", years_since_pruned),
            bigquery.ScalarQueryParameter("maintenance_deficit", "INT64", maintenance_deficit),
            bigquery.ScalarQueryParameter("age", "FLOAT64", float(age)),
            bigquery.ScalarQueryParameter("can_strike_building", "BOOL", can_strike),
            bigquery.ScalarQueryParameter("crown_diameter_m", "FLOAT64", crown_m),
            bigquery.ScalarQueryParameter("missing_or_dead", "STRING", missing_or_dead),
        ]
    )
    _run_query(client, sql, location=cfg.location, job_config=job_config).result()
    return {"ok": True, "tree_id": tree_id, "created_by": str(claims.get("uid") or "")}


def _update_tree_core(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    tree_id = _safe_tree_id_param(req_body.get("tree_id"))
    qc = _trees_core_qs_column(cfg)
    qs_id = str(req_body.get("qs_id") or "").strip()
    if not qs_id:
        raise ValueError("qs_id is required")
    lat = float(req_body.get("latitude"))
    lon = float(req_body.get("longitude"))
    if lat != lat or lon != lon:
        raise ValueError("latitude and longitude must be numbers")
    dbh_i = int(round(float(req_body.get("dbh") or 0)))
    species_raw = req_body.get("species_id")
    species_id_param: int | None
    if species_raw is None or str(species_raw).strip() == "":
        species_id_param = None
    else:
        species_id_param = int(species_raw)
    height_upd = _optional_float_for_json(req_body.get("height"))
    condition_aerial = str(req_body.get("condition_aerial") or "").strip()
    inventory_date = str(req_body.get("inventory_date") or "").strip()
    years_since_pruned = int(req_body.get("years_since_pruned") or 0)
    maintenance_deficit = int(req_body.get("maintenance_deficit") or 0)
    age = _optional_float_for_json(req_body.get("age")) or 0.0
    can_strike = bool(req_body.get("can_strike_building"))
    crown_m = float(req_body.get("crown_diameter_m") or 0.0)
    missing_or_dead = str(req_body.get("missing_or_dead") or "").strip()
    status = str(req_body.get("status") or "").strip()
    t = _table_ref(cfg.trees_table_fqn)
    status_sql = ", status = @status" if status else ""
    sql = f"""
    UPDATE {t}
    SET
      {qc} = @qs_id,
      latitude = @latitude,
      longitude = @longitude,
      dbh = @dbh,
      height = @height,
      species_id = @species_id,
      condition_aerial = @condition_aerial,
      inventory_date = @inventory_date,
      years_since_pruned = @years_since_pruned,
      maintenance_deficit = @maintenance_deficit,
      age = @age,
      can_strike_building = @can_strike_building,
      crown_diameter_m = @crown_diameter_m,
      missing_or_dead = @missing_or_dead,
      updated_at = CURRENT_TIMESTAMP(){status_sql}
    WHERE CAST(tree_id AS STRING) = @tree_id
    """
    params: list[bigquery.ScalarQueryParameter] = [
        bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id),
        bigquery.ScalarQueryParameter("qs_id", "STRING", qs_id),
        bigquery.ScalarQueryParameter("latitude", "FLOAT64", lat),
        bigquery.ScalarQueryParameter("longitude", "FLOAT64", lon),
        bigquery.ScalarQueryParameter("dbh", "INT64", dbh_i),
        bigquery.ScalarQueryParameter("height", "FLOAT64", height_upd),
        bigquery.ScalarQueryParameter("species_id", "INT64", species_id_param),
        bigquery.ScalarQueryParameter("condition_aerial", "STRING", condition_aerial),
        bigquery.ScalarQueryParameter("inventory_date", "STRING", inventory_date),
        bigquery.ScalarQueryParameter("years_since_pruned", "INT64", years_since_pruned),
        bigquery.ScalarQueryParameter("maintenance_deficit", "INT64", maintenance_deficit),
        bigquery.ScalarQueryParameter("age", "FLOAT64", float(age)),
        bigquery.ScalarQueryParameter("can_strike_building", "BOOL", can_strike),
        bigquery.ScalarQueryParameter("crown_diameter_m", "FLOAT64", crown_m),
        bigquery.ScalarQueryParameter("missing_or_dead", "STRING", missing_or_dead),
    ]
    if status:
        params.append(bigquery.ScalarQueryParameter("status", "STRING", status))
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    qj = _run_query(client, sql, location=cfg.location, job_config=job_config)
    qj.result()
    if qj.num_dml_affected_rows is not None and qj.num_dml_affected_rows == 0:
        raise ValueError("Tree not found or not updated")
    return {"ok": True, "tree_id": tree_id, "updated_by": str(claims.get("uid") or "")}


def _delete_tree_core(req_body: dict[str, Any], claims: dict[str, Any], cfg: BigQueryEnvConfig, client: bigquery.Client) -> dict[str, Any]:
    tree_id = _safe_tree_id_param(req_body.get("tree_id"))
    t = _table_ref(cfg.trees_table_fqn)
    feat = _trees_features_table_ref(cfg)
    del_feat = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id)]
    )
    _run_query(client, f"DELETE FROM {feat} WHERE tree_id = @tree_id", location=cfg.location, job_config=del_feat).result()
    del_core = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("tree_id", "STRING", tree_id)]
    )
    qj = _run_query(client, f"DELETE FROM {t} WHERE tree_id = @tree_id", location=cfg.location, job_config=del_core)
    qj.result()
    if qj.num_dml_affected_rows is not None and qj.num_dml_affected_rows == 0:
        raise ValueError("Tree not found")
    return {"ok": True, "tree_id": tree_id, "deleted_by": str(claims.get("uid") or "")}


def _analytics_table_fqn(cfg: BigQueryEnvConfig) -> str:
    raw = (
        _env("BQ_ANALYTICS_SOURCE_TABLE")
        or _env("BQ_QS_SUMMARIES_TABLE")
        or f"{cfg.project_id}.{cfg.dataset}.{cfg.qs_table_name}"
    )
    return raw.replace("`", "").strip()


def _analytics_source_sql(cfg: BigQueryEnvConfig) -> str:
    trees_t = _table_ref(cfg.trees_table_fqn)
    trees_feat_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")
    qs_t = _table_ref(cfg.qs_table_fqn)
    qsp_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.qs_priority")
    species_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    tqs = cfg.tree_qs_id_column
    qsid = cfg.qs_join_column
    return f"""
    SELECT
      TRIM(CAST(qsp.qs_id AS STRING)) AS qs_id,
      CAST(COALESCE(s.simple_species, s.common_name, s.full_name, s.scientific_name, 'Unknown') AS STRING) AS top_species,
      CAST(COALESCE(qs.district, 'Unknown') AS STRING) AS district,
      CAST(COALESCE(t.status, 'Unknown') AS STRING) AS tree_status,
      CAST(CASE WHEN COALESCE(t.can_strike_building, FALSE) THEN 'Yes' ELSE 'No' END AS STRING) AS risk_to_building,
      CAST(
        CASE
          WHEN COALESCE(t.maintenance_deficit, 0) >= 12 THEN 'High'
          WHEN COALESCE(t.maintenance_deficit, 0) >= 6 THEN 'Medium'
          ELSE 'Low'
        END AS STRING
      ) AS maintenance_band,
      CAST(
        CASE
          WHEN CAST(COALESCE(qsp.Priority_Score_Normalized, 0) AS FLOAT64) >= 70 THEN 'Critical'
          WHEN CAST(COALESCE(qsp.Priority_Score_Normalized, 0) AS FLOAT64) >= 50 THEN 'High'
          WHEN CAST(COALESCE(qsp.Priority_Score_Normalized, 0) AS FLOAT64) >= 30 THEN 'Medium'
          ELSE 'Low'
        END AS STRING
      ) AS priority_level,
      CAST(
        COALESCE(
          REGEXP_EXTRACT(CAST(t.inventory_date AS STRING), r'(19\\d{{2}}|20\\d{{2}})'),
          'Unknown'
        ) AS STRING
      ) AS inspection_year,
      CAST(1 AS INT64) AS tree_count,
      CAST(t.dbh AS FLOAT64) AS avg_dbh,
      CAST(t.height AS FLOAT64) AS height,
      CAST(t.age AS FLOAT64) AS age,
      CAST(t.crown_diameter_m AS FLOAT64) AS crown_diameter_m,
      CAST(COALESCE(tf.priority_score, 0) AS FLOAT64) AS priority_score,
      CAST(COALESCE(tf.`I_f`, 0) AS FLOAT64) AS i_f,
      CAST(COALESCE(tf.`p_f`, 0) AS FLOAT64) AS p_f,
      CAST(COALESCE(tf.age_term_k3_a_p, 0) AS FLOAT64) AS age_prioritization,
      CAST(COALESCE(qsp.Priority_Score_Normalized, 0) AS FLOAT64) AS Priority_Score_Normalized
    FROM {trees_t} t
    LEFT JOIN {trees_feat_t} tf
      ON CAST(t.tree_id AS STRING) = CAST(tf.tree_id AS STRING)
    LEFT JOIN {species_t} s
      ON t.species_id = s.species_id
    INNER JOIN {qsp_t} qsp
      ON TRIM(CAST(t.{tqs} AS STRING)) = TRIM(CAST(qsp.qs_id AS STRING))
    LEFT JOIN {qs_t} qs
      ON TRIM(CAST(qsp.qs_id AS STRING)) = TRIM(CAST(qs.{qsid} AS STRING))
    """


@https_fn.on_request(invoker="public")
def analytics_query(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)
    if req.method != "POST":
        return _json_response(req, {"error": "Method not allowed"}, status=405)
    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err
    body = req.get_json(silent=True) or {}
    draft = body.get("draft")
    if not isinstance(draft, dict):
        return _json_response(req, {"error": "Missing draft object"}, status=400)
    try:
        from analytics_query.compiler import compile_draft_to_sql
    except Exception as e:  # noqa: BLE001
        return _json_response(req, {"error": "Failed loading analytics compiler", "detail": str(e)}, status=500)
    cfg = bigquery_config_from_environ()
    try:
        table_fqn = _analytics_table_fqn(cfg)
        if "BQ_ANALYTICS_SOURCE_TABLE" in os.environ and _env("BQ_ANALYTICS_SOURCE_TABLE"):
            sql, param_specs = compile_draft_to_sql(draft, table_fqn=table_fqn)
        else:
            placeholder_table = "__analytics_source__"
            sql_template, param_specs = compile_draft_to_sql(draft, table_fqn=placeholder_table)
            source_sql = _analytics_source_sql(cfg)
            sql = sql_template.replace(
                f"FROM `{placeholder_table}`",
                f"FROM ({source_sql})",
            )
        print(
            "[analytics_query/firebase] compiled",
            json.dumps({"table_fqn": table_fqn, "sql_preview": sql[:400], "params": param_specs}, default=str),
            flush=True,
        )
        bq_params: list[bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter] = []
        for p in param_specs:
            p_name = str(p["name"])
            p_type = str(p["type"])
            p_value = p.get("value")
            if p_type == "ARRAY<STRING>":
                bq_params.append(
                    bigquery.ArrayQueryParameter(p_name, "STRING", list(p_value or [])),
                )
            else:
                bq_params.append(bigquery.ScalarQueryParameter(p_name, p_type, p_value))
        client = _bigquery_client(cfg)
        job = _run_query(
            client,
            sql,
            location=cfg.location,
            job_config=bigquery.QueryJobConfig(query_parameters=bq_params),
        )
        rows: list[dict[str, Any]] = []
        for r in job.result():
            out = {
                "xLabel": str(r["xLabel"] or "Unknown").strip() or "Unknown",
                "yValue": float(r["yValue"] or 0.0),
            }
            if "series" in r:
                out["series"] = str(r["series"] or "Unknown").strip() or "Unknown"
            rows.append(out)
        return _json_response(
            req,
            {"rows": rows, "columns": ["xLabel", "yValue"], "source": "bigquery"},
            status=200,
        )
    except ValueError as e:
        return _json_response(req, {"error": str(e)}, status=400)
    except Exception as e:  # noqa: BLE001
        logger.exception("analytics_query failed")
        return _json_response(req, {"error": "BigQuery error", "message": str(e)}, status=500)


@https_fn.on_request(invoker="public")
def analytics_schema(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)
    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)
    _, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err
    try:
        from analytics_query.compiler import DIMENSION_TO_COLUMN, MEASURE_TO_COLUMN

        dims = [{"id": k, "bqColumn": v, "type": "dimension"} for k, v in sorted(DIMENSION_TO_COLUMN.items())]
        meas = [{"id": k, "bqColumn": v, "type": "measure"} for k, v in sorted(MEASURE_TO_COLUMN.items())]
        return _json_response(req, {"dimensions": dims, "measures": meas}, status=200)
    except Exception as e:  # noqa: BLE001
        logger.exception("analytics_schema failed")
        return _json_response(req, {"error": "Failed to load analytics schema", "detail": str(e)}, status=500)


@https_fn.on_request()
def userTasksApi(req: https_fn.Request) -> https_fn.Response:
    """Self-contained user/task CRUD for `users`, `service_requests`, `service_request_assignees`."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)
    claims, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err
    cfg = bigquery_config_from_environ()
    client = _bigquery_client(cfg)
    try:
        if req.method == "GET":
            mode = str(_parse_query_param(req, "mode") or "all").strip().lower()
            if mode == "users":
                return _json_response(req, _list_users_payload(cfg, client), status=200)
            if mode == "tasks":
                return _json_response(req, _list_tasks_payload(cfg, client), status=200)
            users_payload: dict[str, Any] = {"users": []}
            tasks_payload: dict[str, Any] = {"tasks": []}
            load_errors: dict[str, str] = {}
            try:
                users_payload = _list_users_payload(cfg, client)
            except Exception as e:  # noqa: BLE001
                load_errors["users"] = f"{type(e).__name__}: {e}"
            try:
                tasks_payload = _list_tasks_payload(cfg, client)
            except Exception as e:  # noqa: BLE001
                load_errors["tasks"] = f"{type(e).__name__}: {e}"
            payload: dict[str, Any] = {**users_payload, **tasks_payload}
            if load_errors:
                payload["errors"] = load_errors
            if len(load_errors) == 2:
                return _json_response(
                    req,
                    {
                        "error": "Failed to load users and tasks from BigQuery",
                        "detail": str(load_errors),
                        "errors": load_errors,
                    },
                    status=500,
                )
            return _json_response(req, payload, status=200)
        if req.method != "POST":
            return _json_response(req, {"error": "Method not allowed"}, status=405)
        body = req.get_json(silent=True) or {}
        action = str(body.get("action") or "").strip().lower()
        if action == "create_user":
            return _json_response(req, _create_user(body, claims, cfg, client), status=200)
        if action == "create_task":
            return _json_response(req, _create_task(body, claims, cfg, client), status=200)
        if action == "assign_users":
            return _json_response(req, _assign_task_users(body, claims, cfg, client), status=200)
        if action == "complete_task":
            return _json_response(req, _complete_task(body, claims, cfg, client), status=200)
        if action == "delete_task":
            return _json_response(req, _delete_task(body, claims, cfg, client), status=200)
        return _json_response(req, {"error": "Bad request", "message": "Unknown action"}, status=400)
    except ValueError as e:
        return _json_response(req, {"error": "Bad request", "message": str(e)}, status=400)
    except Exception as e:  # noqa: BLE001
        logger.exception("userTasksApi failed")
        return _json_response(
            req,
            {"error": "Failed processing user tasks request", "detail": str(e), "error_type": type(e).__name__},
            status=500,
        )


@https_fn.on_request()
def treesDataApi(req: https_fn.Request) -> https_fn.Response:
    """Authenticated CRUD for ``trees_core`` (read one tree, list species, create / update / delete)."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)
    claims, auth_err = _require_approved_claims(req)
    if auth_err is not None:
        return auth_err
    cfg = bigquery_config_from_environ()
    client = _bigquery_client(cfg)
    try:
        if req.method == "GET":
            mode = str(_parse_query_param(req, "mode") or "").strip().lower()
            if mode == "species":
                lim_raw = _parse_query_param(req, "limit") or "800"
                try:
                    lim = int(str(lim_raw))
                except ValueError:
                    lim = 800
                return _json_response(req, _list_species_short_payload(cfg, client, lim), status=200)
            tree_id_raw = _parse_query_param(req, "tree_id")
            if not tree_id_raw:
                return _json_response(
                    req,
                    {"error": "Bad request", "message": "Pass tree_id=… or mode=species"},
                    status=400,
                )
            tree_id = _safe_tree_id_param(tree_id_raw)
            return _json_response(req, {"tree": _get_tree_core_row(cfg, client, tree_id)}, status=200)
        if req.method != "POST":
            return _json_response(req, {"error": "Method not allowed"}, status=405)
        body = req.get_json(silent=True) or {}
        action = str(body.get("action") or "").strip().lower()
        if action == "create_tree":
            return _json_response(req, _create_tree_core(body, claims, cfg, client), status=200)
        if action == "update_tree":
            return _json_response(req, _update_tree_core(body, claims, cfg, client), status=200)
        if action == "delete_tree":
            return _json_response(req, _delete_tree_core(body, claims, cfg, client), status=200)
        return _json_response(
            req,
            {"error": "Bad request", "message": "Unknown action; use create_tree, update_tree, or delete_tree"},
            status=400,
        )
    except ValueError as e:
        return _json_response(req, {"error": "Bad request", "message": str(e)}, status=400)
    except Exception as e:  # noqa: BLE001
        logger.exception("treesDataApi failed")
        return _json_response(
            req,
            {"error": "treesDataApi failed", "detail": str(e), "error_type": type(e).__name__},
            status=500,
        )


@https_fn.on_request()
def accessApi(req: https_fn.Request) -> https_fn.Response:
    """Registration, approval workflow, and access profile (does not require prior approval)."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)
    claims = _verify_firebase_user(req)
    if claims is None:
        return _json_response(
            req,
            {
                "error": "Unauthorized",
                "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
            },
            status=401,
        )
    cfg = bigquery_config_from_environ()
    client = _bigquery_client(cfg)
    try:
        if req.method == "GET":
            mode = str(_parse_query_param(req, "mode") or "me").strip().lower()
            uid = str(claims.get("uid") or "")
            if mode == "pending":
                try:
                    ac._require_admin_actor(
                        claims,
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                    )
                except PermissionError as e:
                    return _json_response(req, {"error": "Forbidden", "message": str(e)}, status=403)
                return _json_response(
                    req,
                    ac.list_users_payload(
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                        approval_filter=ac.APPROVAL_PENDING,
                    ),
                    status=200,
                )
            if mode == "all":
                try:
                    ac._require_admin_actor(
                        claims,
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                    )
                except PermissionError as e:
                    return _json_response(req, {"error": "Forbidden", "message": str(e)}, status=403)
                return _json_response(
                    req,
                    ac.list_users_payload(
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                    ),
                    status=200,
                )
            if mode == "usage_stats":
                try:
                    days_raw = _parse_query_param(req, "days") or "30"
                    days = int(str(days_raw))
                except ValueError:
                    days = 30
                try:
                    ac._require_admin_actor(
                        claims,
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                    )
                except PermissionError as e:
                    return _json_response(req, {"error": "Forbidden", "message": str(e)}, status=403)
                return _json_response(
                    req,
                    ac.usage_stats_payload(
                        claims,
                        days=days,
                        cfg=cfg,
                        client=client,
                        table_ref_fn=_table_ref,
                        run_query_fn=_run_query,
                    ),
                    status=200,
                )
            row = ac.ensure_bootstrap_user_promoted(
                claims,
                cfg=cfg,
                client=client,
                table_ref_fn=_table_ref,
                run_query_fn=_run_query,
            )
            bootstrap = ac.is_bootstrap_admin_email(str(claims.get("email") or ""))
            return _json_response(
                req,
                {
                    "profile": row,
                    "approval_required": ac.access_require_approval_enabled(),
                    "is_approved": ac.is_approved_for_claims(row, claims),
                    "is_admin": ac.is_admin_for_claims(row, claims),
                    "bootstrap_admin": bootstrap,
                },
                status=200,
            )
        if req.method != "POST":
            return _json_response(req, {"error": "Method not allowed"}, status=405)
        body = req.get_json(silent=True) or {}
        action = str(body.get("action") or "").strip().lower()
        if action == "register":
            return _json_response(
                req,
                ac.register_access_request(
                    body,
                    claims,
                    cfg=cfg,
                    client=client,
                    table_ref_fn=_table_ref,
                    run_query_fn=_run_query,
                ),
                status=200,
            )
        if action == "approve":
            return _json_response(
                req,
                ac.approve_user(
                    body,
                    claims,
                    cfg=cfg,
                    client=client,
                    table_ref_fn=_table_ref,
                    run_query_fn=_run_query,
                ),
                status=200,
            )
        if action == "reject":
            return _json_response(
                req,
                ac.reject_user(
                    body,
                    claims,
                    cfg=cfg,
                    client=client,
                    table_ref_fn=_table_ref,
                    run_query_fn=_run_query,
                ),
                status=200,
            )
        if action == "update_user":
            return _json_response(
                req,
                ac.update_user_access(
                    body,
                    claims,
                    cfg=cfg,
                    client=client,
                    table_ref_fn=_table_ref,
                    run_query_fn=_run_query,
                ),
                status=200,
            )
        if action == "log_usage":
            return _json_response(
                req,
                ac.log_usage_events(
                    body,
                    claims,
                    cfg=cfg,
                    client=client,
                    table_ref_fn=_table_ref,
                    run_query_fn=_run_query,
                ),
                status=200,
            )
        return _json_response(req, {"error": "Bad request", "message": "Unknown action"}, status=400)
    except PermissionError as e:
        return _json_response(req, {"error": "Forbidden", "message": str(e)}, status=403)
    except ValueError as e:
        return _json_response(req, {"error": "Bad request", "message": str(e)}, status=400)
    except Exception as e:  # noqa: BLE001
        logger.exception("accessApi failed")
        return _json_response(
            req,
            {"error": "accessApi failed", "detail": str(e), "error_type": type(e).__name__},
            status=500,
        )
