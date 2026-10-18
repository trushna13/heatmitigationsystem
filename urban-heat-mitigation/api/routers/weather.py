"""
Weather router — serves live air temperature, today's maximum and minimum,
humidity, and weather observations for the Heat section from Open-Meteo API.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from api.deps import get_city_id
from api.services.weather_service import get_city_weather, get_all_cities_weather

router = APIRouter(prefix="/api/v1/weather", tags=["weather"])


@router.get("")
async def get_weather(
    city_id: str = Depends(get_city_id),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """
    Returns live weather observations (air temperature, daily max/min, humidity)
    for a specific city from Open-Meteo.
    """
    weather = get_city_weather(city_id, force_refresh=refresh)
    if weather.get("status") == "unknown_city":
        raise HTTPException(
            status_code=404,
            detail=weather.get("message", f"Unknown city '{city_id}'"),
        )
    return weather


@router.get("/all")
async def get_all_weather(
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """
    Returns live weather observations for all 20 cities simultaneously
    for map markers, live ticker, and overview map layers.
    """
    return get_all_cities_weather(force_refresh=refresh)
