"""
Cloud Function: load inventory CSV from GCS and return map payload (GeoJSON + summary + tree points).
"""

from __future__ import annotations

import io
import os
from typing import Any

import functions_framework
import numpy as np
import pandas as pd
from firebase_auth import require_firebase_auth
from flask import Request, jsonify
from google.cloud import storage

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

_DEFAULT_MAX_TREE_POINTS = 10_000


def _parse_inventory_location() -> tuple[str, str]:
    """Resolve (bucket, blob_name) from INVENTORY_GCS_URI or GCS_BUCKET + GCS_INVENTORY_BLOB."""
    uri = (os.environ.get("INVENTORY_GCS_URI") or "").strip()
    if uri:
        if not uri.startswith("gs://"):
            raise ValueError("INVENTORY_GCS_URI must start with gs://")
        path = uri[5:]
        bucket, _, blob = path.partition("/")
        if not bucket or not blob:
            raise ValueError("INVENTORY_GCS_URI must be gs://bucket/path/to/file.csv")
        return bucket, blob

    bucket = (os.environ.get("GCS_BUCKET") or "").strip()
    blob = (os.environ.get("GCS_INVENTORY_BLOB") or "").strip()
    if not bucket or not blob:
        raise ValueError(
            "Set INVENTORY_GCS_URI or both GCS_BUCKET and GCS_INVENTORY_BLOB"
        )
    return bucket, blob


def load_inventory_from_gcs(bucket_name: str, blob_name: str) -> pd.DataFrame:
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    data = blob.download_as_bytes()
    return pd.read_csv(io.BytesIO(data), low_memory=False)


def _simplify_species(species: Any) -> str:
    if pd.isna(species):
        return "Unknown"
    species_str = str(species).upper()
    if "," in species_str:
        return species_str.split(",")[0].strip()
    if "(" in species_str:
        return species_str.split("(")[0].strip()
    parts = species_str.split()
    return parts[0] if parts else "Unknown"


def build_map_payload(
    inventory_df: pd.DataFrame, *, max_tree_points: int
) -> dict[str, Any]:
    """Core pandas logic from prepare_map_data.py; returns geojson, summary, tree_points."""
    inventory_df = inventory_df.copy()
    inventory_df["Quarter Section"] = (
        inventory_df["Quarter Section"].astype(str).str.replace(".0", "", regex=False)
    )

    if "Species_Simple" not in inventory_df.columns:
        inventory_df["Species_Simple"] = inventory_df["Species"].apply(_simplify_species)

    inventory_df = inventory_df[
        (inventory_df["Latitude"].notna())
        & (inventory_df["Longitude"].notna())
        & (inventory_df["Latitude"] != 0)
        & (inventory_df["Longitude"] != 0)
    ]

    if len(inventory_df) == 0:
        raise ValueError("No rows with valid coordinates after filtering")

    min_lat = float(inventory_df["Latitude"].min())
    max_lat = float(inventory_df["Latitude"].max())
    min_lon = float(inventory_df["Longitude"].min())
    max_lon = float(inventory_df["Longitude"].max())

    qs_data = inventory_df.groupby("Quarter Section").agg(
        {
            "Site ID": "count",
            "Latitude": ["mean", "min", "max"],
            "Longitude": ["mean", "min", "max"],
            "DBH": "mean",
            "Condition": lambda x: x.value_counts().to_dict(),
            "Property Type": lambda x: x.value_counts().to_dict(),
            "District": lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else None,
            "Species_Simple": lambda x: x.value_counts().head(3).to_dict(),
        }
    ).round(6)

    qs_data.columns = [
        "_".join(col).strip() if col[1] else col[0] for col in qs_data.columns.values
    ]

    qs_data = qs_data.rename(
        columns={
            "Site ID_count": "Total_Trees",
            "Latitude_mean": "Center_Lat",
            "Longitude_mean": "Center_Lon",
            "Latitude_min": "Min_Lat",
            "Latitude_max": "Max_Lat",
            "Longitude_min": "Min_Lon",
            "Longitude_max": "Max_Lon",
            "DBH_mean": "Avg_DBH",
        }
    )

    lat_range = max_lat - min_lat
    lon_range = max_lon - min_lon
    num_qs = len(qs_data)

    min_lr = min(lat_range, lon_range)
    if min_lr <= 0:
        min_lr = 1e-9
    max_range = max(lat_range, lon_range)
    grid_size = int(np.ceil(np.sqrt(num_qs * (max_range / min_lr)))) + 1
    square_size = max_range / grid_size

    qs_features: list[dict[str, Any]] = []

    for qs_id, row in qs_data.iterrows():
        center_lat = float(row["Center_Lat"])
        center_lon = float(row["Center_Lon"])
        half_size = square_size / 2

        # GeoJSON Polygon rings use [longitude, latitude] order
        square_ring_lonlat: list[list[float]] = [
            [center_lon - half_size, center_lat - half_size],
            [center_lon + half_size, center_lat - half_size],
            [center_lon + half_size, center_lat + half_size],
            [center_lon - half_size, center_lat + half_size],
            [center_lon - half_size, center_lat - half_size],
        ]

        condition_dist = row.get("Condition_<lambda>", {})
        poor_count = condition_dist.get("Poor", 0) if isinstance(condition_dist, dict) else 0
        total_trees = float(row["Total_Trees"])
        condition_risk = (poor_count / total_trees * 100) if total_trees > 0 else 0.0

        avg_dbh = float(row["Avg_DBH"]) if pd.notna(row["Avg_DBH"]) else 0.0
        risk_score = (
            condition_risk * 0.4
            + (avg_dbh / 30 * 100) * 0.3
            + min(total_trees / 100 * 100, 100) * 0.3
        )

        if risk_score >= 70:
            risk_level = "Critical"
        elif risk_score >= 50:
            risk_level = "High"
        elif risk_score >= 30:
            risk_level = "Medium"
        else:
            risk_level = "Low"

        district_val = row.get("District_<lambda>", "Unknown")
        district_str = str(district_val) if district_val is not None else "Unknown"

        feature = {
            "type": "Feature",
            "properties": {
                "quarter_section": str(qs_id),
                "tree_count": int(total_trees),
                "total_trees": int(total_trees),
                "avg_dbh": avg_dbh,
                "risk_score": float(risk_score),
                "risk_level": risk_level,
                "condition_risk": float(condition_risk),
                "district": district_str,
                "center_lat": center_lat,
                "center_lon": center_lon,
            },
            "geometry": {"type": "Polygon", "coordinates": [square_ring_lonlat]},
        }
        qs_features.append(feature)

    geojson: dict[str, Any] = {"type": "FeatureCollection", "features": qs_features}

    if qs_features:
        risk_scores = [f["properties"]["risk_score"] for f in qs_features]
        rmin, rmax = float(min(risk_scores)), float(max(risk_scores))
    else:
        rmin, rmax = 0.0, 0.0

    summary: dict[str, Any] = {
        "bounds": {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lon": min_lon,
            "max_lon": max_lon,
            "center_lat": (min_lat + max_lat) / 2,
            "center_lon": (min_lon + max_lon) / 2,
        },
        # Map dashboard Overview totals are recomputed client-side from GeoJSON + filters;
        # these fields remain for backwards compatibility and non-map consumers.
        "statistics": {
            "total_quarter_sections": len(qs_features),
            "total_trees": int(inventory_df["Site ID"].nunique()),
            "risk_levels": {
                "Critical": sum(
                    1 for f in qs_features if f["properties"]["risk_level"] == "Critical"
                ),
                "High": sum(
                    1 for f in qs_features if f["properties"]["risk_level"] == "High"
                ),
                "Medium": sum(
                    1 for f in qs_features if f["properties"]["risk_level"] == "Medium"
                ),
                "Low": sum(
                    1 for f in qs_features if f["properties"]["risk_level"] == "Low"
                ),
            },
        },
        "districts": sorted(
            list(
                {
                    f["properties"]["district"]
                    for f in qs_features
                    if f["properties"]["district"] != "Unknown"
                }
            )
        ),
        "risk_score_range": {"min": rmin, "max": rmax},
    }

    n = len(inventory_df)
    cap = min(max(1, max_tree_points), n)
    tree_sample = inventory_df.sample(n=cap, random_state=42)

    tree_points: list[dict[str, Any]] = []
    for _, trow in tree_sample.iterrows():
        tree_points.append(
            {
                "lat": float(trow["Latitude"]),
                "lon": float(trow["Longitude"]),
                "dbh": float(trow["DBH"]) if pd.notna(trow["DBH"]) else 0.0,
                "condition": str(trow["Condition"])
                if pd.notna(trow["Condition"])
                else "Unknown",
                "quarter_section": str(trow["Quarter Section"]),
            }
        )

    return {
        "geojson": geojson,
        "summary": summary,
        "tree_points": tree_points,
    }


@functions_framework.http
def getQuarterSectionMapData(request: Request):
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "GET":
        return (jsonify({"error": "Method not allowed"}), 405, CORS_HEADERS)

    _claims, auth_err = require_firebase_auth(request, CORS_HEADERS)
    if auth_err:
        return auth_err

    try:
        bucket_name, blob_name = _parse_inventory_location()
    except ValueError as e:
        return (jsonify({"error": str(e)}), 400, CORS_HEADERS)

    max_pts = _DEFAULT_MAX_TREE_POINTS
    raw_max = os.environ.get("MAX_TREE_POINTS", "").strip()
    if raw_max.isdigit():
        max_pts = max(1, int(raw_max))

    try:
        inventory_df = load_inventory_from_gcs(bucket_name, blob_name)
        payload = build_map_payload(inventory_df, max_tree_points=max_pts)
        return (jsonify(payload), 200, CORS_HEADERS)
    except Exception as exc:  # noqa: BLE001
        return (jsonify({"error": str(exc)}), 500, CORS_HEADERS)
