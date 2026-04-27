"""Gen2 HTTPS: GET analytics field catalog (mirrors frontend fieldCatalog / compiler allowlist)."""

from __future__ import annotations

import functions_framework
from firebase_auth import require_firebase_auth
from flask import Request, jsonify

# Keep in sync with database/cloud_functions/analytics_query/compiler.py
DIMENSION_TO_COLUMN = {
    "dim-species": "top_species",
    "dim-district": "district",
    "dim-priority-level": "priority_level",
    "dim-inspection-year": "inspection_year",
}
MEASURE_TO_COLUMN = {
    "meas-tree-count": "tree_count",
    "meas-avg-dbh": "avg_dbh",
    "meas-max-priority": "Priority_Score_Normalized",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


@functions_framework.http
def analytics_schema(request: Request):
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)
    if request.method != "GET":
        return (jsonify({"error": "Method not allowed"}), 405, CORS_HEADERS)
    claims, err = require_firebase_auth(request, CORS_HEADERS)
    if err:
        return err
    dims = [{"id": k, "bqColumn": v, "type": "dimension"} for k, v in sorted(DIMENSION_TO_COLUMN.items())]
    meas = [{"id": k, "bqColumn": v, "type": "measure"} for k, v in sorted(MEASURE_TO_COLUMN.items())]
    return (jsonify({"dimensions": dims, "measures": meas}), 200, CORS_HEADERS)
