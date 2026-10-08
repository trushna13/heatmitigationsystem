"""
Environment endpoint — serves water and vegetation metrics for cities.
"""

import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException

from pipeline.config import CITIES, DATA_DIR, list_cities
from api.deps import get_city_id

router = APIRouter(prefix="/api/v1/environment", tags=["environment"])

WATER_FILE = DATA_DIR / "water_index.json"
VEG_FILE = DATA_DIR / "vegetation_index.json"


def _load_json(file_path: Path):
    if not file_path.exists():
        return {}
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("")
async def get_environment(city_id: str = Depends(get_city_id)):
    """
    Returns water and vegetation indicators for a specific city.
    """
    water_data = _load_json(WATER_FILE)
    veg_data = _load_json(VEG_FILE)

    city_water = water_data.get(city_id, {
        "availability_index": 50,
        "surface_water_pct": 20,
        "proximity_km": 20,
        "water_stress_index": 50,
        "is_mock": True
    })
    city_water["is_mock"] = True

    city_veg = veg_data.get(city_id, {
        "vegetation_health": 50,
        "green_cover_pct": 25,
        "ndvi": 0.45,
        "tree_density_index": 50,
        "is_mock": True
    })
    city_veg["is_mock"] = True

    return {
        "city_id": city_id,
        "water": city_water,
        "vegetation": city_veg,
    }


@router.get("/all")
async def get_all_environment():
    """
    Returns water and vegetation indicators for all 20 cities,
    including geographic coordinates for overview map markers.
    """
    water_data = _load_json(WATER_FILE)
    veg_data = _load_json(VEG_FILE)

    result = {}
    for city_id, city_meta in CITIES.items():
        lon, lat = city_meta["center"]
        w = water_data.get(city_id, {
            "availability_index": 50,
            "surface_water_pct": 20,
            "proximity_km": 20,
            "water_stress_index": 50,
        })
        v = veg_data.get(city_id, {
            "vegetation_health": 50,
            "green_cover_pct": 25,
            "ndvi": 0.45,
            "tree_density_index": 50,
        })

        # Calculate a baseline heat score based on air_temp_baseline and base_temp_c
        air_temp = city_meta.get("air_temp_baseline", 38.0)
        heat_score = min(100, max(0, int((air_temp - 30.0) * 5 + 30)))

        result[city_id] = {
            "id": city_id,
            "name": city_meta["name"],
            "state": city_meta["state"],
            "country": city_meta["country"],
            "lat": lat,
            "lon": lon,
            "air_temp_baseline": air_temp,
            "heat_score": heat_score,
            "water": w,
            "vegetation": v,
        }

    return {
        "cities": result
    }
