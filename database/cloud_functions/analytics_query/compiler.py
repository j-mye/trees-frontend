"""
Translate analytics draft JSON into BigQuery SQL using identifier allowlists only.
Never interpolate user-controlled identifiers into SQL — map through fixed dicts.
"""

from __future__ import annotations

import json
import re
from typing import Any

# Mirrors frontend/src/analytics/fieldCatalog.js
FILTER_TO_COLUMN: dict[str, str] = {
    "filter-quarter-section": "qs_id",
    "filter-district": "district",
    # legacy persisted ids
    "dim-quarter-section": "qs_id",
    "dim-district": "district",
}

DIMENSION_TO_COLUMN: dict[str, str] = {
    "dim-quarter-section": "qs_id",
    "dim-species": "top_species",
    "dim-priority-level": "priority_level",
    "dim-inspection-year": "inspection_year",
    "dim-tree-status": "tree_status",
    "dim-risk-to-building": "risk_to_building",
    "dim-maintenance-band": "maintenance_band",
}

MEASURE_TO_COLUMN: dict[str, str] = {
    "meas-tree-count": "tree_count",
    "meas-avg-dbh": "avg_dbh",
    "meas-max-priority": "Priority_Score_Normalized",
    "meas-height": "height",
    "meas-age": "age",
    "meas-crown-width": "crown_diameter_m",
    "meas-priority-score": "priority_score",
    "meas-iof": "i_f",
    "meas-p-f": "p_f",
    "meas-age-prioritization": "age_prioritization",
}

AGG_FUNCS = frozenset({"SUM", "AVG", "COUNT", "MAX"})
FILTER_OPS = frozenset({"eq", "in", "gt", "gte", "lt", "lte"})


def _safe_ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError(f"Invalid identifier {name!r}")
    return name


def _assert_allowed_column(col: str) -> str:
    allowed = (
        set(FILTER_TO_COLUMN.values())
        | set(DIMENSION_TO_COLUMN.values())
        | set(MEASURE_TO_COLUMN.values())
    )
    if col not in allowed:
        raise ValueError(f"Column not in allowlist: {col!r}")
    return _safe_ident(col)


def _normalize_dimension_expr(col: str) -> str:
    safe = _assert_allowed_column(col)
    return f"COALESCE(NULLIF(TRIM(CAST(`{safe}` AS STRING)), ''), 'Unknown')"


def _number_or_none(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def compile_draft_to_sql(draft: dict[str, Any], *, table_fqn: str) -> tuple[str, list[dict[str, Any]]]:
    """
    Returns (sql, params) where params are BigQuery scalar parameter specs.
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
    color_item = draft.get("colorItem") or {}
    color_id = str(color_item.get("id") or "")
    color_col = None
    if color_id:
        if color_id not in DIMENSION_TO_COLUMN:
            raise ValueError(f"Unknown color dimension id {color_id!r}")
        color_col = _assert_allowed_column(DIMENSION_TO_COLUMN[color_id])

    if not re.fullmatch(r"[\w`.:-]+", table_fqn):
        raise ValueError("Invalid table_fqn")

    # COUNT(measure) counts non-null rows in group; COUNT(*) for COUNT agg on tree_count use SUM for sum semantics — frontend uses COUNT as row count in bucket; SQL COUNT(*) per group matches when grouping.
    if agg == "COUNT":
        agg_expr = "COUNT(*)"
    else:
        agg_expr = f"{agg}(`{meas_col}`)"

    x_expr = _normalize_dimension_expr(dim_col)
    order_sql = "ORDER BY 1"

    where_parts: list[str] = []
    params: list[dict[str, Any]] = []
    for i, raw_filter in enumerate(draft.get("draftFilters") or []):
        if not isinstance(raw_filter, dict):
            continue
        field_id = str(raw_filter.get("fieldId") or "")
        op = str(raw_filter.get("op") or "").lower()
        value = raw_filter.get("value")
        if not field_id or op not in FILTER_OPS:
            continue
        filter_col = (
            FILTER_TO_COLUMN.get(field_id)
            or DIMENSION_TO_COLUMN.get(field_id)
            or MEASURE_TO_COLUMN.get(field_id)
        )
        if not filter_col:
            raise ValueError(f"Unknown filter field id {field_id!r}")
        safe_filter_col = _assert_allowed_column(filter_col)
        p_name = f"f_{i}"
        if op == "in":
            raw_values = raw_filter.get("values")
            if isinstance(raw_values, list) and raw_values:
                values = [str(v).strip() for v in raw_values if str(v).strip()]
            else:
                values = [v.strip() for v in str(value or "").replace("|", ",").split(",") if v.strip()]
            if not values:
                continue
            where_parts.append(f"{_normalize_dimension_expr(safe_filter_col)} IN UNNEST(@{p_name})")
            params.append({"name": p_name, "type": "ARRAY<STRING>", "value": values})
            continue
        if op == "eq":
            n = _number_or_none(value)
            if n is not None:
                where_parts.append(f"SAFE_CAST(`{safe_filter_col}` AS FLOAT64) = @{p_name}")
                params.append({"name": p_name, "type": "FLOAT64", "value": n})
            else:
                where_parts.append(f"{_normalize_dimension_expr(safe_filter_col)} = @{p_name}")
                params.append({"name": p_name, "type": "STRING", "value": str(value or "").strip() or "Unknown"})
            continue
        n = _number_or_none(value)
        if n is None:
            raise ValueError(f"Filter {field_id!r} with op {op!r} requires numeric value")
        op_sql = {  # nosec B608
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
        }[op]
        where_parts.append(f"SAFE_CAST(`{safe_filter_col}` AS FLOAT64) {op_sql} @{p_name}")
        params.append({"name": p_name, "type": "FLOAT64", "value": n})

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    if color_col is not None:
        color_expr = _normalize_dimension_expr(color_col)
        order_sql = "ORDER BY 1, 3"
        sql = (
            f"SELECT {x_expr} AS xLabel, {agg_expr} AS yValue, {color_expr} AS series "
            f"FROM `{table_fqn}` {where_sql} GROUP BY 1, 3 {order_sql}"
        )
    else:
        sql = (
            f"SELECT {x_expr} AS xLabel, {agg_expr} AS yValue FROM `{table_fqn}` {where_sql} GROUP BY 1 {order_sql}"
        )
    return sql, params


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
