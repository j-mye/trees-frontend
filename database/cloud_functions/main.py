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

import cached_http

set_global_options(max_instances=10)
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
        "Access-Control-Allow-Methods": "GET, OPTIONS",
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
    - quarter_sections (qs_id, district, geometry)
    - qs_priority (PS_* fields, Priority_Score_Normalized)
    - trees_core (dbh, qs_id)
    """
    qs_t = _table_ref(cfg.qs_table_fqn)
    tree_t = _table_ref(cfg.trees_table_fqn)
    qsp_t = _table_ref(f"{cfg.project_id}.{cfg.dataset}.qs_priority")
    id_col = cfg.qs_join_column
    gcol = cfg.qs_geometry_column
    tqs = cfg.tree_qs_id_column
    return f"""
    WITH tree_stats AS (
      SELECT
        TRIM(CAST({tqs} AS STRING)) AS clean_site_id,
        COUNT(*) AS tree_count,
        AVG(CAST(dbh AS FLOAT64)) AS avg_dbh
      FROM {tree_t}
      GROUP BY clean_site_id
    )
    SELECT
      CAST(qs.OBJECTID AS INT64) AS qs_objectid,
      TRIM(CAST(qs.{id_col} AS STRING)) AS qs_id,
      CAST(qsp.PS_critical AS FLOAT64) AS ps_critical,
      CAST(qsp.PS_bottom90 AS FLOAT64) AS ps_bottom90,
      CAST(qsp.PS_background AS FLOAT64) AS ps_background,
      CAST(qsp.PS_composite AS FLOAT64) AS ps_composite,
      CAST(qsp.Priority_Score_Normalized AS FLOAT64) AS priority_score_normalized,
      CAST(COALESCE(ts.tree_count, 0) AS INT64) AS tree_count,
      CAST(COALESCE(ts.tree_count, 0) AS INT64) AS total_trees,
      CAST(COALESCE(ts.avg_dbh, 0.0) AS FLOAT64) AS avg_dbh,
      CAST(COALESCE(qs.district, "Unknown") AS STRING) AS district,
      CAST(qs.{gcol} AS STRING) AS geom_json,
      ST_X(ST_CENTROID(ST_GEOGFROMGEOJSON(qs.{gcol}))) AS center_lon,
      ST_Y(ST_CENTROID(ST_GEOGFROMGEOJSON(qs.{gcol}))) AS center_lat
    FROM {qs_t} qs
    LEFT JOIN {qsp_t} qsp
      ON TRIM(CAST(qs.{id_col} AS STRING)) = TRIM(CAST(qsp.qs_id AS STRING))
    LEFT JOIN tree_stats ts
      ON TRIM(CAST(qs.{id_col} AS STRING)) = ts.clean_site_id
    WHERE qs.{gcol} IS NOT NULL
    """


def _trees_sql(cfg: BigQueryEnvConfig) -> str:
    t = _table_ref(cfg.trees_table_fqn)
    tf = _table_ref(f"{cfg.project_id}.{cfg.dataset}.trees_features")
    sp = _table_ref(f"{cfg.project_id}.{cfg.dataset}.species")
    return f"""
    SELECT
      CAST(t.qs_id AS STRING) AS qs_id,
      CAST(t.tree_id AS STRING) AS tree_id,
      CAST(t.latitude AS FLOAT64) AS lat,
      CAST(t.longitude AS FLOAT64) AS lon,
      CAST(t.dbh AS FLOAT64) AS dbh,
      SAFE_CAST(t.height AS FLOAT64) AS height,
      CAST(COALESCE(CAST(t.condition_aerial AS STRING), "Unknown") AS STRING) AS condition_aerial,
      CAST(COALESCE(s.simple_species, s.full_name, s.scientific_name, "Unknown") AS STRING) AS species,
      CAST(tf.priority_score AS FLOAT64) AS priority_score,
      CAST(tf.risk_term_k1_I_f_p_f_b AS FLOAT64) AS risk_term_k1_I_f_p_f_b,
      CAST(tf.age_term_k3_a_p AS FLOAT64) AS age_term_k3_a_p,
      CAST(t.age AS FLOAT64) AS age,
      CAST(t.maintenance_deficit AS INT64) AS maintenance_deficit,
      CAST(t.years_since_pruned AS INT64) AS years_since_pruned,
      CAST(t.can_strike_building AS BOOL) AS can_strike_building,
      CAST(t.crown_diameter_m AS FLOAT64) AS crown_diameter_m,
      CAST(COALESCE(CAST(t.missing_or_dead AS STRING), "") AS STRING) AS missing_or_dead
    FROM {t} AS t
    LEFT JOIN {tf} AS tf
      ON CAST(t.tree_id AS STRING) = CAST(tf.tree_id AS STRING)
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
        if geom is None:
            continue
        ps_critical = float(row["ps_critical"] or 0.0)
        ps_bottom90 = float(row["ps_bottom90"] or 0.0)
        ps_background = float(row["ps_background"] or 0.0)
        ps_composite = float(row["ps_composite"] or 0.0)
        priority_score_normalized = float(row["priority_score_normalized"] or 0.0)
        qs = str(row["qs_id"])
        tt = int(row["total_trees"] or 0)
        clat = float(row["center_lat"] or 0.0)
        clon = float(row["center_lon"] or 0.0)
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
                "center_lat": clat,
                "center_lon": clon,
                "district": str(row["district"] or "Unknown"),
                "avg_dbh": avg_dbh,
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
                "priority_score": float(row["priority_score"] or 0.0),
                "risk_term_k1_I_f_p_f_b": float(row["risk_term_k1_I_f_p_f_b"] or 0.0),
                "age_term_k3_a_p": float(row["age_term_k3_a_p"] or 0.0),
                "age": float(row["age"]) if row["age"] is not None else 0.0,
                "maintenance_deficit": int(row["maintenance_deficit"] or 0),
                "years_since_pruned": int(row["years_since_pruned"] or 0),
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
_TREES_TTL_SECONDS = 86400
_SHAP_EXPLANATION_TTL_SECONDS = 86400
# Bump when getTreesByQs SELECT / per-tree JSON shape changes (invalidates in-memory json_cache).
_TREES_PAYLOAD_CACHE_REVISION = "new-schema-v1"


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
    return "|".join((_shap_table_fqn_from_cfg(cfg), site_col, cfg.location, cfg.project_id))


def _shap_explanation_sql(cfg: BigQueryEnvConfig) -> str:
    shap_fqn = _shap_table_fqn_from_cfg(cfg)
    site_col = _safe_shap_site_id_column(_env("BQ_SHAP_SITE_ID_COLUMN") or "Site ID")
    site_expr = _shap_site_id_sql_expr("s", site_col)
    t = _table_ref(shap_fqn)
    return f"""
    SELECT CAST(s.english_translation AS STRING) AS english_translation
    FROM {t} AS s
    WHERE CAST({site_expr} AS STRING) = TRIM(@site_id)
    LIMIT 1
    """


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
        return {"english_translation": None}
    raw = rows[0].get("english_translation")
    if raw is None:
        return {"english_translation": None}
    text = str(raw).strip()
    return {"english_translation": text if text else None}


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

    if _verify_firebase_user(req) is None:
        return _json_response(
            req,
            {
                "error": "Unauthorized",
                "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
            },
            status=401,
        )

    bq_cfg = bigquery_config_from_environ()
    http_key = cached_http.cache_key_from_request(req)
    full_key = f"summaries|{http_key}|{_bq_config_cache_fingerprint(bq_cfg)}"
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

    if _verify_firebase_user(req) is None:
        return _json_response(
            req,
            {
                "error": "Unauthorized",
                "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
            },
            status=401,
        )

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
    """BigQuery: SHAP English explanation for one tree/site. GET ?site_id=... (only ``english_translation`` scanned)."""
    if req.method == "OPTIONS":
        return _cors_preflight_response(req)

    if req.method != "GET":
        return _json_response(req, {"error": "Method not allowed"}, status=405)

    if _verify_firebase_user(req) is None:
        return _json_response(
            req,
            {
                "error": "Unauthorized",
                "message": "Valid Firebase ID token required (Authorization: Bearer <token>)",
            },
            status=401,
        )

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
