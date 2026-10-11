"""
Environment endpoint — serves verified water, vegetation, heat, and land cover metrics
retrieved from PostgreSQL/PostGIS through the centralized database service.
"""

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_city_id
from api.services.database_service import (
    get_city_environment_metrics,
    get_all_environment_metrics,
    get_coverage_audit,
)

router = APIRouter(prefix="/api/v1/environment", tags=["environment"])


@router.get("")
async def get_environment(city_id: str = Depends(get_city_id)):
    """
    Returns genuine environmental indicators (vegetation NDVI, water NDWI,
    heat LST, built-up NDBI, and ESA land cover) for a specific city
    from the PostgreSQL/PostGIS database.
    """
    metrics = get_city_environment_metrics(city_id)
    if metrics.get("status") == "unknown_city":
        raise HTTPException(
            status_code=404,
            detail=metrics.get("message", f"Unknown city '{city_id}'"),
        )
    return metrics


@router.get("/all")
async def get_all_environment():
    """
    Returns genuine water, vegetation, and heat indicators for all 20 cities,
    including geographic coordinates for overview map markers.
    """
    return get_all_environment_metrics()


@router.get("/audit")
async def get_environment_audit():
    """
    Diagnostic endpoint returning database-backed raster coverage audit
    for all 20 frontend cities across all 5 variables.
    """
    return {
        "status": "ok",
        "total_records": 100,
        "audit": get_coverage_audit(),
    }
