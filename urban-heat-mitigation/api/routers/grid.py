"""
Grid data endpoint — serves a city's grid as GeoJSON with hybrid data architecture:
- Temperature: Live air temperature from Open-Meteo API with documented spatial microclimatic interpolation.
- Vegetation & land-use: Derived from PostgreSQL/PostGIS database and Sentinel-2 / Landsat raster pipeline.
"""

import json
from fastapi import APIRouter, Query, Depends
from typing import Optional, Dict, Any

from pipeline.config import city_grid_file, city_features_file
from api.deps import get_city_id
from api.services.weather_service import (
    get_city_weather,
    get_city_spatial_weather_anchors,
    resolve_cell_weather_anchor,
)
from api.services.locality_service import resolve_cell_locality

router = APIRouter(prefix="/api/v1/grid", tags=["grid"])

# In-memory GeoJSON cache to avoid repeatedly parsing large JSON files on disk
_GRID_CACHE: Dict[str, Dict[str, Any]] = {}


def _get_base_grid(city_id: str) -> Dict[str, Any]:
    """Retrieve base GeoJSON from memory cache or disk."""
    if city_id not in _GRID_CACHE:
        with open(city_grid_file(city_id), "r", encoding="utf-8") as f:
            _GRID_CACHE[city_id] = json.load(f)
    return _GRID_CACHE[city_id]


@router.get("")
async def get_grid(
    city_id: str = Depends(get_city_id),
    tier: Optional[str] = Query(None, description="Comma-separated tier filter"),
    bbox: Optional[str] = Query(None, description="west,south,east,north"),
):
    """
    Returns a city's full grid as GeoJSON FeatureCollection with hybrid data sources:
    - Locality and exact geographic coordinates for every cell.
    - Live air temperature from Open-Meteo's nearest spatial model grid point.
    - Preserved vegetation and land attributes from the database/pipeline.
    """
    base_geojson = _get_base_grid(city_id)
    features = base_geojson["features"]

    # Retrieve live weather and bounded spatial weather anchors
    weather = get_city_weather(city_id)
    live_temp = weather.get("current_temp_c")
    anchors = get_city_spatial_weather_anchors(city_id)

    # Baseline LST mean across cells for anomaly calculation
    total_lst = 0.0
    count_lst = 0
    for feat in features:
        val = feat["properties"].get("lst_mean")
        if val is not None:
            total_lst += val
            count_lst += 1
    baseline_mean_lst = (total_lst / count_lst) if count_lst > 0 else 35.0

    features_out = []
    for feat in features:
        props = dict(feat["properties"])
        coords = feat["geometry"]["coordinates"][0]

        # Compute centroid from vertices
        n_pts = len(coords) - 1 if len(coords) > 1 and coords[0] == coords[-1] else len(coords)
        c_lon = sum(c[0] for c in coords[:n_pts]) / n_pts
        c_lat = sum(c[1] for c in coords[:n_pts]) / n_pts

        # Resolve locality and geographic area
        loc_info = resolve_cell_locality(city_id, c_lat, c_lon)

        # Resolve spatial weather anchor for this specific cell's location
        cell_weather = resolve_cell_weather_anchor(c_lat, c_lon, anchors)
        cell_live_temp = cell_weather.get("temp_c") if cell_weather.get("temp_c") is not None else live_temp

        props["cell_center_lat"] = loc_info["center_lat"]
        props["cell_center_lon"] = loc_info["center_lon"]
        props["formatted_coords"] = loc_info["formatted_coordinates"]
        props["locality"] = loc_info["locality"]
        props["city_name"] = loc_info["city_name"]
        props["admin_area"] = loc_info["admin_area"]
        props["coverage"] = loc_info["coverage_footprint"]
        props["is_verified_landmark"] = loc_info["is_verified_landmark"]

        props["live_air_temp_c"] = cell_live_temp
        props["live_temp_baseline"] = live_temp
        props["humidity_pct"] = cell_weather.get("humidity_pct") or weather.get("humidity_pct")
        props["weather_point_label"] = f"{cell_weather.get('anchor_label', 'Weather Point')} ({cell_weather.get('model_coords', '')})"
        props["observation_time"] = cell_weather.get("observation_time") or weather.get("observation_time")
        props["weather_source"] = cell_weather.get("source", "Open-Meteo High-Resolution NWP")
        props["temp_source"] = f"{cell_weather.get('source', 'Open-Meteo High-Resolution NWP')} [{cell_weather.get('anchor_label', 'Weather Point')}]"

        # Microclimatic air temperature anomaly scaling (alpha = 0.35 air-to-surface scaling)
        cell_lst = props.get("lst_mean", baseline_mean_lst)
        if cell_lst is None:
            cell_lst = baseline_mean_lst
        if cell_live_temp is not None:
            estimated_air_temp = round(cell_live_temp + 0.35 * (cell_lst - baseline_mean_lst), 1)
        else:
            estimated_air_temp = cell_lst
        props["estimated_air_temp"] = estimated_air_temp

        props["temp_type"] = "Live Air Temperature (°C)"
        props["vegetation_source"] = "PostgreSQL / PostGIS Database"

        features_out.append({
            "type": feat.get("type", "Feature"),
            "geometry": feat["geometry"],
            "properties": props,
        })

    # Filter by tier
    if tier:
        tiers = [t.strip() for t in tier.split(",")]
        features_out = [f for f in features_out if f["properties"].get("tier") in tiers]

    # Filter by bbox
    if bbox:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) == 4:
            west, south, east, north = parts
            filtered = []
            for feat in features_out:
                c_lon = feat["properties"]["cell_center_lon"]
                c_lat = feat["properties"]["cell_center_lat"]
                if west <= c_lon <= east and south <= c_lat <= north:
                    filtered.append(feat)
            features_out = filtered

    return {
        "type": "FeatureCollection",
        "features": features_out,
        "metadata": {
            "city_id": city_id,
            "live_air_temp_c": live_temp,
            "weather_provider": weather.get("provider", "Open-Meteo"),
            "observation_time": weather.get("observation_time"),
            "temperature_metric": "Live Air Temperature (°C)",
            "vegetation_source": "PostgreSQL / PostGIS Database",
            "spatial_weather_anchors_count": len(anchors),
        },
    }


@router.get("/cell")
async def get_cell_info(
    city_id: str = Depends(get_city_id),
    lat: float = Query(..., description="Latitude of cell center"),
    lon: float = Query(..., description="Longitude of cell center"),
):
    """
    Returns verified locality and live spatial weather for a specific coordinate.
    """
    loc_info = resolve_cell_locality(city_id, lat, lon)
    anchors = get_city_spatial_weather_anchors(city_id)
    cell_weather = resolve_cell_weather_anchor(lat, lon, anchors)
    return {
        "locality_info": loc_info,
        "cell_weather": cell_weather,
    }


@router.get("/stats")
async def get_grid_stats(city_id: str = Depends(get_city_id)):
    """Return summary statistics about a city's grid with hybrid data metrics."""
    import pandas as pd

    df = pd.read_parquet(city_features_file(city_id))
    weather = get_city_weather(city_id)
    live_temp = weather.get("current_temp_c")

    mean_lst = float(df["lst_mean"].mean())
    return {
        "total_cells": len(df),
        "live_air_temp_c": live_temp,
        "weather_provider": weather.get("provider", "Open-Meteo"),
        "observation_time": weather.get("observation_time"),
        "temperature_source": "Open-Meteo Live API",
        "vegetation_source": "PostgreSQL / PostGIS Database",
        "baseline_lst_mean": round(mean_lst, 2),
        "baseline_lst_std": round(float(df["lst_mean"].std()), 2),
        "baseline_lst_min": round(float(df["lst_mean"].min()), 2),
        "baseline_lst_max": round(float(df["lst_mean"].max()), 2),
        "tier_distribution": df["tier"].value_counts().to_dict(),
    }
