"""
Comparison router — serves combined live weather and satellite-derived environmental
metrics for 2 to 5 selected cities across the 20-city Indian registry.
"""

import time
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query

from pipeline.config import CITIES
from api.services.database_service import resolve_city_name, get_canonical_city_id, get_city_environment_metrics
from api.services.weather_service import get_city_weather

router = APIRouter(prefix="/api/v1/comparison", tags=["comparison"])


def parse_and_validate_cities(cities_param: str) -> List[str]:
    """
    Parse a comma-separated list of city IDs or names (or 'all'), validate them against
    the registry, reject duplicates, and ensure between 2 and all supported cities are requested.
    """
    if not cities_param or not cities_param.strip():
        raise HTTPException(
            status_code=400,
            detail="The 'cities' parameter is required. Provide between 2 and 20 comma-separated city IDs (or 'all').",
        )

    max_cities = len(CITIES)

    # Allow 'all' as shortcut for all registered cities
    if cities_param.strip().lower() == "all":
        return list(CITIES.keys())

    raw_items = [c.strip() for c in cities_param.split(",") if c.strip()]

    if len(raw_items) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"City comparison requires at least 2 cities, but only {len(raw_items)} was provided.",
        )

    if len(raw_items) > max_cities:
        raise HTTPException(
            status_code=400,
            detail=f"City comparison supports at most {max_cities} cities, but {len(raw_items)} were requested.",
        )

    canonical_ids = []
    seen = set()

    for item in raw_items:
        # Check direct canonical ID
        canonical_id = None
        if item in CITIES:
            canonical_id = item
        else:
            db_city = resolve_city_name(item)
            if db_city:
                candidate = get_canonical_city_id(db_city)
                if candidate in CITIES:
                    canonical_id = candidate

        if not canonical_id:
            available_list = ", ".join(sorted(CITIES.keys()))
            raise HTTPException(
                status_code=404,
                detail=f"Unknown city identifier or alias: '{item}'. Supported cities: {available_list}",
            )

        if canonical_id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate city '{item}' (resolved as '{canonical_id}') detected in comparison list. Each city must be unique.",
            )

        seen.add(canonical_id)
        canonical_ids.append(canonical_id)

    return canonical_ids


@router.get("")
async def get_comparison(
    cities: str = Query(
        "new_delhi,mumbai",
        description="Comma-separated city IDs or aliases to compare (between 2 and 20 cities, or 'all')",
    ),
    refresh: bool = Query(False, description="Force refresh live weather data cache"),
):
    """
    Returns comparative weather observations and environmental raster statistics
    for any number of selected cities (from 2 up to all 20 cities). Reuses the
    existing Open-Meteo weather service and PostgreSQL/PostGIS environmental service.
    """
    from concurrent.futures import ThreadPoolExecutor

    canonical_ids = parse_and_validate_cities(cities)

    def _fetch_city_data(city_id: str) -> Dict[str, Any]:
        city_meta = CITIES[city_id]
        lon, lat = city_meta["center"]

        # 1. Live Weather from Open-Meteo
        weather_res = get_city_weather(city_id, force_refresh=refresh)

        # 2. Environmental raster metrics from PostgreSQL/PostGIS
        env_res = get_city_environment_metrics(city_id)

        return {
            "city_id": city_id,
            "name": city_meta["name"],
            "state": city_meta["state"],
            "country": city_meta["country"],
            "lat": lat,
            "lon": lon,
            "coastal": city_meta.get("coastal", False),
            "season_label": city_meta.get("season_label", "2026"),
            "air_temp_baseline": city_meta.get("air_temp_baseline"),
            "weather": weather_res,
            "environment": env_res,
        }

    # Fetch concurrently for maximum efficiency when comparing up to 20 cities
    workers = min(len(canonical_ids), 6)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(_fetch_city_data, canonical_ids))

    return {
        "status": "ok",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selected_count": len(results),
        "cities": results,
    }
