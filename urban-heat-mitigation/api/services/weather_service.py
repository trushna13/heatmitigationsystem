"""
Weather Service for Urban Heat Mitigation / HeatShield AI.
Integrates live weather observations from Open-Meteo API (open-meteo.com)
with server-side in-memory TTL caching, retry logic, and fallback safety.
"""

import os
import time
import json
import logging
import urllib.request
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor

from pipeline.config import CITIES
from api.services.database_service import resolve_city_name, get_canonical_city_id

logger = logging.getLogger("heatshield.weather")

# Cache TTL: 5 minutes (300 seconds)
CACHE_TTL_SECONDS = 300

# In-memory weather cache: { city_id: { "timestamp": float, "data": dict } }
_WEATHER_CACHE: Dict[str, Dict[str, Any]] = {}

# WMO Weather interpretation codes
WMO_DESCRIPTIONS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
}


def _fetch_open_meteo(lat: float, lon: float, timezone: str = "Asia/Kolkata") -> Optional[Dict[str, Any]]:
    """Fetch live weather metrics from Open-Meteo for a given latitude/longitude."""
    import urllib.parse
    tz_param = urllib.parse.quote(timezone)
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m"
        f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
        f"&timezone={tz_param}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanHeatMitigation/1.0 (Live Weather Service)"})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            logger.warning("Open-Meteo request attempt %d failed for (%s, %s): %s", attempt + 1, lat, lon, str(e))
            if attempt < 2:
                time.sleep(0.3 * (attempt + 1))
    return None


def get_city_weather(city_id: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Returns live weather observations (temperature, forecast max/min, humidity)
    for a specific city, backed by an in-memory TTL cache.
    """
    now = time.time()

    # Normalize city_id
    canonical_id = city_id
    if canonical_id not in CITIES:
        db_city = resolve_city_name(city_id)
        if db_city:
            canonical_id = get_canonical_city_id(db_city)

    if canonical_id not in CITIES:
        return {
            "city_id": city_id,
            "status": "unknown_city",
            "message": f"City '{city_id}' is not registered in the city registry.",
            "data_source": "None",
            "weather": None,
        }

    city_meta = CITIES[canonical_id]
    lon, lat = city_meta["center"]
    timezone = "Asia/Kolkata"

    # Check cache
    cached = _WEATHER_CACHE.get(canonical_id)
    if not force_refresh and cached and (now - cached["timestamp"] < CACHE_TTL_SECONDS):
        res = dict(cached["data"])
        res["cached"] = True
        res["cache_age_seconds"] = int(now - cached["timestamp"])
        return res

    # Fetch live from Open-Meteo
    raw = _fetch_open_meteo(lat, lon, timezone=timezone)
    if raw and "current" in raw:
        curr = raw.get("current", {})
        daily = raw.get("daily", {})

        current_temp = curr.get("temperature_2m")
        humidity = curr.get("relative_humidity_2m")
        apparent_temp = curr.get("apparent_temperature")
        weather_code = curr.get("weather_code", 0)
        precipitation = curr.get("precipitation")
        wind_speed = curr.get("wind_speed_10m")
        obs_time = curr.get("time")  # Local timezone model timestamp (e.g. 2026-10-16T22:00)

        max_temps = daily.get("temperature_2m_max", [])
        min_temps = daily.get("temperature_2m_min", [])
        daily_precip = daily.get("precipitation_sum", [])
        daily_times = daily.get("time", [])

        # Strict local calendar date match for today's forecast max and min
        target_date = obs_time.split("T")[0] if obs_time else None
        idx = 0
        if target_date and target_date in daily_times:
            idx = daily_times.index(target_date)

        today_max = max_temps[idx] if idx < len(max_temps) else (max_temps[0] if max_temps else None)
        today_min = min_temps[idx] if idx < len(min_temps) else (min_temps[0] if min_temps else None)
        today_precip_sum = daily_precip[idx] if idx < len(daily_precip) else (daily_precip[0] if daily_precip else None)

        data = {
            "city_id": canonical_id,
            "name": city_meta["name"],
            "state": city_meta["state"],
            "country": city_meta["country"],
            "lat": lat,
            "lon": lon,
            "status": "ok",
            "data_source": "Open-Meteo Live Weather API",
            "provider": "Open-Meteo (open-meteo.com)",
            "data_type": "NWP Model Analysis & Forecast",
            "timezone": timezone,
            "current_temp_c": round(current_temp, 1) if current_temp is not None else None,
            "apparent_temp_c": round(apparent_temp, 1) if apparent_temp is not None else None,
            "today_max_c": round(today_max, 1) if today_max is not None else None,
            "today_min_c": round(today_min, 1) if today_min is not None else None,
            "is_forecast_daily": True,
            "humidity_pct": int(humidity) if humidity is not None else None,
            "precipitation_mm": round(float(precipitation), 2) if precipitation is not None else 0.0,
            "wind_speed_kmh": round(float(wind_speed), 1) if wind_speed is not None else None,
            "today_precipitation_sum_mm": round(float(today_precip_sum), 2) if today_precip_sum is not None else None,
            "precipitation_label": "Current interval precipitation (mm)",
            "wind_speed_unit": "km/h",
            "weather_code": weather_code,
            "weather_description": WMO_DESCRIPTIONS.get(weather_code, "Fair"),
            "observation_time": obs_time,
            "model_interval_seconds": curr.get("interval", 900),
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "is_stale": False,
        }

        # Store in cache
        _WEATHER_CACHE[canonical_id] = {
            "timestamp": now,
            "data": data,
        }
        return data

    # Fallback to stale cache if API failed
    if cached:
        res = dict(cached["data"])
        res["status"] = "stale_data"
        res["is_stale"] = True
        res["warning"] = "Open-Meteo API unreachable. Serving last known weather observation."
        res["cache_age_seconds"] = int(now - cached["timestamp"])
        return res

    # Unavailable state — never invent fake numbers
    return {
        "city_id": canonical_id,
        "name": city_meta["name"],
        "state": city_meta["state"],
        "country": city_meta["country"],
        "lat": lat,
        "lon": lon,
        "status": "unavailable",
        "message": "Live weather observations currently unavailable from Open-Meteo.",
        "data_source": "Open-Meteo Live Weather API",
        "provider": "Open-Meteo (open-meteo.com)",
        "data_type": "NWP Model Analysis & Forecast",
        "timezone": timezone,
        "current_temp_c": None,
        "apparent_temp_c": None,
        "today_max_c": None,
        "today_min_c": None,
        "is_forecast_daily": True,
        "humidity_pct": None,
        "precipitation_mm": None,
        "wind_speed_kmh": None,
        "today_precipitation_sum_mm": None,
        "precipitation_label": "Current interval precipitation (mm)",
        "wind_speed_unit": "km/h",
        "weather_code": None,
        "weather_description": "Unavailable",
        "observation_time": None,
        "model_interval_seconds": None,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "is_stale": False,
    }


def get_all_cities_weather(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Returns live weather observations for all 20 cities simultaneously.
    Uses concurrent fetching with rate-limit friendly worker concurrency.
    """
    now = time.time()
    city_ids = list(CITIES.keys())

    # Check how many need fetching
    needed = []
    results = {}
    for cid in city_ids:
        cached = _WEATHER_CACHE.get(cid)
        if not force_refresh and cached and (now - cached["timestamp"] < CACHE_TTL_SECONDS):
            results[cid] = cached["data"]
        else:
            needed.append(cid)

    if needed:
        with ThreadPoolExecutor(max_workers=2) as executor:
            fetched = list(executor.map(lambda c: get_city_weather(c, force_refresh=True), needed))
            for item in fetched:
                cid = item["city_id"]
                results[cid] = item

    return {
        "status": "ok",
        "provider": "Open-Meteo (open-meteo.com)",
        "total_cities": len(results),
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "cities": results,
    }


# ─── Spatial Weather Grid Anchors (Bounded Spatial Point Resolution) ──

_SPATIAL_WEATHER_CACHE: Dict[str, Dict[str, Any]] = {}


def _fetch_open_meteo_multi(coords: List[Tuple[float, float]], timezone: str = "Asia/Kolkata") -> Optional[List[Dict[str, Any]]]:
    """Fetch live weather metrics for multiple lat/lon points in a single HTTP request."""
    import urllib.parse
    tz_param = urllib.parse.quote(timezone)
    lats = ",".join(f"{c[0]:.4f}" for c in coords)
    lons = ",".join(f"{c[1]:.4f}" for c in coords)
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lats}&longitude={lons}"
        f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code"
        f"&timezone={tz_param}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanHeatMitigation/1.0 (Live Weather Service)"})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        return [data]
                    return data
        except Exception as e:
            logger.warning("Open-Meteo multi-request attempt %d failed: %s", attempt + 1, str(e))
            if attempt < 2:
                time.sleep(0.3 * (attempt + 1))
    return None


def get_city_spatial_weather_anchors(city_id: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Returns 5 bounded spatial weather anchors (Center, North, South, East, West) across
    the city's bounding box from Open-Meteo API, cached with 5-minute TTL.
    """
    now = time.time()
    canonical_id = city_id
    if canonical_id not in CITIES:
        db_city = resolve_city_name(city_id)
        if db_city:
            canonical_id = get_canonical_city_id(db_city)

    if canonical_id not in CITIES:
        return []

    cached = _SPATIAL_WEATHER_CACHE.get(canonical_id)
    if not force_refresh and cached and (now - cached["timestamp"] < CACHE_TTL_SECONDS):
        return cached["anchors"]

    city_meta = CITIES[canonical_id]
    lon_c, lat_c = city_meta["center"]
    bbox = city_meta["bbox"]
    d_lat = (bbox["north"] - bbox["south"]) * 0.28
    d_lon = (bbox["east"] - bbox["west"]) * 0.28

    coords = [
        (lat_c, lon_c),            # Center
        (lat_c + d_lat, lon_c),    # North
        (lat_c - d_lat, lon_c),    # South
        (lat_c, lon_c + d_lon),    # East
        (lat_c, lon_c - d_lon),    # West
    ]
    labels = ["Center", "North Sector", "South Sector", "East Sector", "West Sector"]

    results = _fetch_open_meteo_multi(coords, timezone="Asia/Kolkata")
    anchors = []

    if results and len(results) == len(coords):
        for idx, item in enumerate(results):
            curr = item.get("current", {})
            t = curr.get("temperature_2m")
            rh = curr.get("relative_humidity_2m")
            weather_code = curr.get("weather_code", 0)
            obs_time = curr.get("time")

            anchors.append({
                "label": labels[idx],
                "query_lat": coords[idx][0],
                "query_lon": coords[idx][1],
                "model_lat": item.get("latitude", coords[idx][0]),
                "model_lon": item.get("longitude", coords[idx][1]),
                "temp_c": round(t, 1) if t is not None else None,
                "humidity_pct": int(rh) if rh is not None else None,
                "weather_code": weather_code,
                "weather_description": WMO_DESCRIPTIONS.get(weather_code, "Fair"),
                "observation_time": obs_time,
                "provider": "Open-Meteo High-Resolution NWP",
            })
    else:
        # Fallback to single city weather if multi failed
        city_w = get_city_weather(canonical_id)
        anchors = [{
            "label": "City Center",
            "query_lat": lat_c,
            "query_lon": lon_c,
            "model_lat": lat_c,
            "model_lon": lon_c,
            "temp_c": city_w.get("current_temp_c"),
            "humidity_pct": city_w.get("humidity_pct"),
            "weather_code": city_w.get("weather_code", 0),
            "weather_description": city_w.get("weather_description", "Fair"),
            "observation_time": city_w.get("observation_time"),
            "provider": "Open-Meteo High-Resolution NWP",
        }]

    _SPATIAL_WEATHER_CACHE[canonical_id] = {
        "timestamp": now,
        "anchors": anchors
    }
    return anchors


def resolve_cell_weather_anchor(centroid_lat: float, centroid_lon: float, anchors: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Finds the closest spatial weather anchor point for a cell's coordinates."""
    if not anchors:
        return {
            "temp_c": None,
            "humidity_pct": None,
            "anchor_label": "Unknown",
            "model_coords": "—",
            "observation_time": None,
            "source": "Open-Meteo NWP",
        }

    # Find nearest anchor by squared Euclidean distance in degrees
    best = min(
        anchors,
        key=lambda a: (a["query_lat"] - centroid_lat)**2 + (a["query_lon"] - centroid_lon)**2
    )

    model_lat = best.get("model_lat", best["query_lat"])
    model_lon = best.get("model_lon", best["query_lon"])
    coords_fmt = f"{abs(model_lat):.3f}°{'N' if model_lat >= 0 else 'S'}, {abs(model_lon):.3f}°{'E' if model_lon >= 0 else 'W'}"

    return {
        "temp_c": best["temp_c"],
        "humidity_pct": best["humidity_pct"],
        "anchor_label": best["label"],
        "model_coords": coords_fmt,
        "observation_time": best["observation_time"],
        "source": best.get("provider", "Open-Meteo High-Resolution NWP"),
    }
