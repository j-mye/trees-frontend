"""
Translate analytics draft JSON into BigQuery SQL using identifier allowlists only.
Never interpolate user-controlled identifiers into SQL — map through fixed dicts.
"""

from __future__ import annotations

import json
import re
from typing import Any

# Mirrors frontend/src/analytics/fieldCatalog.js
DIMENSION_TO_COLUMN: dict[str, str] = {
    "dim-species": "top_species",
    "dim-district": "district",
    "dim-priority-level": "priority_level",
    "dim-inspection-year": "inspection_year",
}

MEASURE_TO_COLUMN: dict[str, str] = {
    "meas-tree-count": "tree_count",
    "meas-avg-dbh": "avg_dbh",
    "meas-max-priority": "Priority_Score_Normalized",
}

AGG_FUNCS = frozenset({"SUM", "AVG", "COUNT", "MAX"})


def _safe_ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError(f"Invalid identifier {name!r}")
    return name


def _assert_allowed_column(col: str) -> str:
    allowed = set(DIMENSION_TO_COLUMN.values()) | set(MEASURE_TO_COLUMN.values())
    if col not in allowed:
        raise ValueError(f"Column not in allowlist: {col!r}")
    return _safe_ident(col)


def compile_draft_to_sql(draft: dict[str, Any], *, table_fqn: str) -> tuple[str, list[Any]]:
    """
    Returns (sql, params) where params are empty (all literals from allowlist) — reserved for future binding.
    """
    x = draft.get("xAxisItem") or {}
    y = draft.get("yAxisItem") or {}
    agg = str(draft.get("yAggregation") or "SUM").upper()
    if agg not in AGG_FUNCS:
        raise ValueError(f"Invalid aggregation {agg!r}")

    xid = str(x.get("id") or "")
    yid = str(y.get("id") or "")
    if xid not in DIMENSION_TO_COLUMN:
        raise ValueError(f"Unknown dimension id {xid!r}")
    if yid not in MEASURE_TO_COLUMN:
        raise ValueError(f"Unknown measure id {yid!r}")

    dim_col = _assert_allowed_column(DIMENSION_TO_COLUMN[xid])
    meas_col = _assert_allowed_column(MEASURE_TO_COLUMN[yid])

    if not re.fullmatch(r"[\w`.:-]+", table_fqn):
        raise ValueError("Invalid table_fqn")

    # COUNT(measure) counts non-null rows in group; COUNT(*) for COUNT agg on tree_count use SUM for sum semantics — frontend uses COUNT as row count in bucket; SQL COUNT(*) per group matches when grouping.
    if agg == "COUNT":
        agg_expr = "COUNT(*)"
    else:
        agg_expr = f"{agg}(`{meas_col}`)"

    dim_expr = f"COALESCE(NULLIF(TRIM(CAST(`{dim_col}` AS STRING)), ''), 'Unknown')"
    sql = f"SELECT {dim_expr} AS xLabel, {agg_expr} AS yValue FROM `{table_fqn}` GROUP BY 1 ORDER BY 1"
    return sql, []


def draft_cache_key(draft: dict[str, Any]) -> str:
    """Stable key for LRU (normalized JSON)."""
    slim = {
        "x": (draft.get("xAxisItem") or {}).get("id"),
        "y": (draft.get("yAxisItem") or {}).get("id"),
        "agg": draft.get("yAggregation"),
        "color": (draft.get("colorItem") or {}).get("id"),
        "filters": draft.get("draftFilters") or [],
    }
    return json.dumps(slim, sort_keys=True, separators=(",", ":"))
