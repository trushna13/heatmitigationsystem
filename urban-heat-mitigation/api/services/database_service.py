"""
Database Service for Urban Heat Mitigation / HeatShield AI.
Single source of truth for PostgreSQL/PostGIS database access, city normalization,
raster metadata queries, statistics calculation, NoData/NaN handling, and caching.
"""

import os
import math
import logging
from contextlib import contextmanager
from typing import Optional, Dict, Any, List, Tuple
import psycopg2
from psycopg2 import pool

logger = logging.getLogger("heatshield.database")

from pipeline.config import CITIES

# ─── Database Configuration ──────────────────────────────────────
# Read from environment variables with sensible local defaults.
# Never expose credentials in logs.
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "heatshield")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "Nisha@2006")

# ─── Centralized City Alias Registry ─────────────────────────────
# Maps frontend city IDs and historical/display names to verified
# city names stored in the PostgreSQL public.city_rasters table.
CITY_ALIASES: Dict[str, str] = {
    # 20 Frontend Cities
    "ahmedabad": "Ahmedabad",
    "bengaluru": "Bengaluru",
    "bangalore": "Bengaluru",
    "bhopal": "Bhopal",
    "chandigarh": "Chandigarh",
    "chennai": "Chennai",
    "madras": "Chennai",
    "coimbatore": "Coimbatore",
    "guwahati": "Guwahati",
    "hyderabad": "Hyderabad",
    "jaipur": "Jaipur",
    "kochi": "Kochi",
    "cochin": "Kochi",
    "kolkata": "Kolkata",
    "calcutta": "Kolkata",
    "lucknow": "Lucknow",
    "mumbai": "Mumbai",
    "bombay": "Mumbai",
    "nagpur": "Nagpur",
    "new_delhi": "Delhi",
    "delhi": "Delhi",
    "patna": "Patna",
    "pune": "Pune",
    "poona": "Pune",
    "surat": "Surat",
    "vijayawada": "Vijayawada",
    "visakhapatnam": "Visakhapatnam",
    "vizag": "Visakhapatnam",
}

# Reverse lookup: Verified DB city name -> Canonical frontend city ID
DB_TO_FRONTEND_ID: Dict[str, str] = {
    "Ahmedabad": "ahmedabad",
    "Bengaluru": "bengaluru",
    "Bhopal": "bhopal",
    "Chandigarh": "chandigarh",
    "Chennai": "chennai",
    "Coimbatore": "coimbatore",
    "Guwahati": "guwahati",
    "Hyderabad": "hyderabad",
    "Jaipur": "jaipur",
    "Kochi": "kochi",
    "Kolkata": "kolkata",
    "Lucknow": "lucknow",
    "Mumbai": "mumbai",
    "Nagpur": "nagpur",
    "Delhi": "new_delhi",
    "Patna": "patna",
    "Pune": "pune",
    "Surat": "surat",
    "Vijayawada": "vijayawada",
    "Visakhapatnam": "visakhapatnam",
}

# Supported raster variables in city_rasters
SUPPORTED_VARIABLES = ("lst", "ndvi", "ndwi", "ndbi", "landcover")

# In-memory LRU / process cache for lightning-fast repeated queries
_IN_MEMORY_CACHE: Dict[str, Any] = {}

# Threaded connection pool
_CONNECTION_POOL: Optional[pool.ThreadedConnectionPool] = None


def get_connection_pool() -> pool.ThreadedConnectionPool:
    """Initialize or return the existing connection pool."""
    global _CONNECTION_POOL
    if _CONNECTION_POOL is None or _CONNECTION_POOL.closed:
        try:
            _CONNECTION_POOL = pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                host=DB_HOST,
                port=DB_PORT,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                connect_timeout=5,
            )
            logger.info("Initialized PostgreSQL connection pool (%s:%s/%s)", DB_HOST, DB_PORT, DB_NAME)
        except Exception as e:
            logger.error("Failed to initialize PostgreSQL connection pool: %s", str(e))
            raise
    return _CONNECTION_POOL


@contextmanager
def get_db_connection():
    """
    Context manager that acquires a connection from the pool and releases it back.
    Safely rolls back transactions on error.
    """
    conn = None
    try:
        p = get_connection_pool()
        conn = p.getconn()
        yield conn
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error("Database connection error: %s", str(e))
        raise
    finally:
        if conn:
            try:
                p = get_connection_pool()
                p.putconn(conn)
            except Exception:
                pass


def test_connection() -> bool:
    """Test whether the database is reachable and PostGIS is enabled."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT PostGIS_Version();")
                version = cur.fetchone()[0]
                logger.info("Connected to PostGIS version: %s", version)
                return True
    except Exception as e:
        logger.warning("Database connection test failed: %s", str(e))
        return False


def resolve_city_name(city_id_or_name: str) -> Optional[str]:
    """
    Resolve any city identifier, name, or alias to the verified
    city name in the database.
    Examples:
      'new_delhi' -> 'Delhi'
      'Delhi' -> 'Delhi'
      'New Delhi' -> 'Delhi'
      'bengaluru' -> 'Bengaluru'
      'bangalore' -> 'Bengaluru'
    """
    if not city_id_or_name:
        return None
    cleaned = city_id_or_name.strip().lower().replace(" ", "_")
    if cleaned in CITY_ALIASES:
        return CITY_ALIASES[cleaned]

    # Try matching without underscores or direct name matching
    cleaned_space = city_id_or_name.strip().lower()
    for alias, db_name in CITY_ALIASES.items():
        if alias.replace("_", " ") == cleaned_space or db_name.lower() == cleaned_space:
            return db_name

    return None


def get_canonical_city_id(db_city: str) -> str:
    """Map verified DB city name to canonical frontend city ID."""
    return DB_TO_FRONTEND_ID.get(db_city, db_city.lower().replace(" ", "_"))


def get_raster_metadata(db_city: str, variable: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve raster spatial metadata (SRID, dimensions, pixel type, NoData value)
    for a given city and variable from public.city_rasters using a fast sample query.
    """
    cache_key = f"{db_city}:{variable}:meta"
    if cache_key in _IN_MEMORY_CACHE:
        return _IN_MEMORY_CACHE[cache_key]

    query = """
        SELECT
            ST_SRID(rast) AS srid,
            ST_Width(rast) AS width,
            ST_Height(rast) AS height,
            ST_BandPixelType(rast, 1) AS pixel_type,
            ST_BandNoDataValue(rast, 1) AS nodata_val,
            ST_ScaleX(rast) AS scale_x,
            ST_ScaleY(rast) AS scale_y
        FROM city_rasters
        WHERE city = %s AND variable = %s
        LIMIT 1;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (db_city, variable))
                row = cur.fetchone()
                if not row:
                    return None
                res = {
                    "srid": row[0],
                    "tile_width": row[1],
                    "tile_height": row[2],
                    "pixel_type": row[3],
                    "nodata_val": row[4],
                    "pixel_size_deg": abs(float(row[5])) if row[5] else None,
                }
                _IN_MEMORY_CACHE[cache_key] = res
                return res
    except Exception as e:
        logger.error("Error retrieving raster metadata for %s %s: %s", db_city, variable, str(e))
        return None


def get_raster_stats(db_city: str, variable: str, use_cache: bool = True) -> Optional[Dict[str, Any]]:
    """
    Calculate and return valid raster statistics (min, max, pixel-weighted mean, valid pixels).
    Uses public.environment_summary cache table when available, or calculates live from
    public.city_rasters using safe NoData/NaN masking.
    """
    cache_key = f"{db_city}:{variable}"
    if use_cache and cache_key in _IN_MEMORY_CACHE:
        return _IN_MEMORY_CACHE[cache_key]

    # 1. Check database summary cache table
    if use_cache:
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT min_value, max_value, mean_value, valid_pixels
                        FROM environment_summary
                        WHERE city = %s AND variable = %s;
                    """, (db_city, variable))
                    row = cur.fetchone()
                    if row and row[3] is not None and row[3] > 0:
                        res = {
                            "min": float(row[0]) if row[0] is not None else None,
                            "max": float(row[1]) if row[1] is not None else None,
                            "mean": float(row[2]) if row[2] is not None else None,
                            "valid_pixels": int(row[3]),
                            "source": "environment_summary",
                        }
                        _IN_MEMORY_CACHE[cache_key] = res
                        return res
        except Exception as e:
            logger.warning("Cache lookup failed for %s %s, falling back to raster calculation: %s", db_city, variable, str(e))

    # 2. Live Calculation from city_rasters using ST_SummaryStats with NaN exclusion
    # Note: %%BF escapes % for psycopg2
    calc_query = """
        SELECT
            MIN((stats).min)::float8 AS min_val,
            MAX((stats).max)::float8 AS max_val,
            (SUM((stats).sum) / NULLIF(SUM((stats).count), 0))::float8 AS mean_val,
            SUM((stats).count)::bigint AS valid_pixels
        FROM (
            SELECT ST_SummaryStats(
                CASE 
                    WHEN ST_BandPixelType(rast, 1) LIKE '%%BF' THEN ST_SetBandNoDataValue(rast, 'NaN'::float8)
                    ELSE ST_SetBandNoDataValue(rast, 0)
                END,
                1,
                TRUE
            ) AS stats
            FROM city_rasters
            WHERE city = %s AND variable = %s
        ) AS sub
        WHERE (stats).count > 0;
    """

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(calc_query, (db_city, variable))
                row = cur.fetchone()
                if not row or row[3] is None or row[3] == 0:
                    return None

                min_v = float(row[0]) if row[0] is not None and not math.isnan(row[0]) else None
                max_v = float(row[1]) if row[1] is not None and not math.isnan(row[1]) else None
                mean_v = float(row[2]) if row[2] is not None and not math.isnan(row[2]) else None
                valid_px = int(row[3])

                res = {
                    "min": min_v,
                    "max": max_v,
                    "mean": mean_v,
                    "valid_pixels": valid_px,
                    "source": "city_rasters_live",
                }

                # Save into cache table
                try:
                    cur.execute("""
                        INSERT INTO environment_summary (city, variable, min_value, max_value, mean_value, valid_pixels)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (city, variable)
                        DO UPDATE SET
                            min_value = EXCLUDED.min_value,
                            max_value = EXCLUDED.max_value,
                            mean_value = EXCLUDED.mean_value,
                            valid_pixels = EXCLUDED.valid_pixels;
                    """, (db_city, variable, min_v, max_v, mean_v, valid_px))
                    conn.commit()
                except Exception as save_err:
                    logger.warning("Could not persist stats to environment_summary: %s", str(save_err))

                _IN_MEMORY_CACHE[cache_key] = res
                return res

    except Exception as e:
        logger.error("Live raster stats calculation error for %s %s: %s", db_city, variable, str(e))
        return None


def get_landcover_breakdown(db_city: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve real ESA WorldCover land cover class distribution for a city:
    Class 10: Tree cover
    Class 20: Shrubland
    Class 30: Grassland
    Class 40: Cropland
    Class 50: Built-up
    Class 60: Bare / sparse vegetation
    Class 80: Permanent water bodies
    Class 90: Herbaceous wetland
    Class 95: Mangroves
    """
    cache_key = f"{db_city}:landcover_breakdown"
    if cache_key in _IN_MEMORY_CACHE:
        return _IN_MEMORY_CACHE[cache_key]

    query = """
        SELECT (pvc).value::int AS class_code, SUM((pvc).count)::bigint AS pixel_count
        FROM (
            SELECT ST_ValueCount(rast, 1, false) AS pvc
            FROM city_rasters
            WHERE city = %s AND variable = 'landcover'
        ) sub
        WHERE (pvc).value > 0
        GROUP BY (pvc).value
        ORDER BY (pvc).value;
    """

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (db_city,))
                rows = cur.fetchall()
                if not rows:
                    return None

                total = sum(r[1] for r in rows)
                if total == 0:
                    return None

                class_counts = {r[0]: r[1] for r in rows}

                tree_px = class_counts.get(10, 0)
                shrub_px = class_counts.get(20, 0)
                grass_px = class_counts.get(30, 0)
                crop_px = class_counts.get(40, 0)
                built_px = class_counts.get(50, 0)
                bare_px = class_counts.get(60, 0)
                water_px = class_counts.get(80, 0)
                wetland_px = class_counts.get(90, 0) + class_counts.get(95, 0)

                green_px = tree_px + shrub_px + grass_px + crop_px

                res = {
                    "total_classified_pixels": total,
                    "tree_cover_pct": round((tree_px / total) * 100, 2),
                    "green_cover_pct": round((green_px / total) * 100, 2),
                    "built_up_pct": round((built_px / total) * 100, 2),
                    "surface_water_pct": round((water_px / total) * 100, 2),
                    "bare_soil_pct": round((bare_px / total) * 100, 2),
                    "cropland_pct": round((crop_px / total) * 100, 2),
                    "classes": class_counts,
                }
                _IN_MEMORY_CACHE[cache_key] = res
                return res

    except Exception as e:
        logger.error("Landcover breakdown query error for %s: %s", db_city, str(e))
        return None


# ─── Environmental Metrics Calculation ───────────────────────────

def calculate_vegetation_health_score(mean_ndvi: Optional[float]) -> int:
    """
    Documented transformation converting mean NDVI (-1.0 to 1.0) into
    a standard 0-100 vegetation health score.
    In urban climates, vegetation NDVI typically spans 0.05 to 0.75:
      NDVI <= 0.05 -> score 0 (barren / impervious)
      NDVI >= 0.70 -> score 100 (dense healthy canopy)
    """
    if mean_ndvi is None or math.isnan(mean_ndvi):
        return 50
    # Linear rescale: NDVI [0.05, 0.70] -> [0, 100]
    scaled = (mean_ndvi - 0.05) / (0.70 - 0.05) * 100.0
    return int(max(0, min(100, round(scaled))))


def calculate_water_availability_index(mean_ndwi: Optional[float], water_pct: Optional[float] = None) -> int:
    """
    Documented transformation converting mean NDWI (-1.0 to 1.0) and
    land cover surface water percentage into a 0-100 water availability score.
    NDWI typically spans -0.75 to +0.30 in Indian city bounds:
      NDWI <= -0.70 -> 0 (extremely dry / no open water)
      NDWI >= 0.20  -> 100 (abundant surface water bodies)
    """
    if mean_ndwi is None or math.isnan(mean_ndwi):
        return 50

    base_score = (mean_ndwi + 0.70) / (0.20 + 0.70) * 85.0
    if water_pct is not None:
        base_score += min(15.0, water_pct * 3.0)

    return int(max(0, min(100, round(base_score))))


def get_city_environment_metrics(city_id: str) -> Dict[str, Any]:
    """
    Build a complete, verified environmental profile for a single city.
    Returns backward-compatible structure expected by the frontend MapView
    plus full raw statistics, pixel counts, units, and data source details.
    """
    db_city = resolve_city_name(city_id)
    if not db_city:
        return {
            "city_id": city_id,
            "status": "unknown_city",
            "message": f"City '{city_id}' could not be resolved to a database city.",
            "data_source": "None",
            "water": None,
            "vegetation": None,
            "heat": None,
            "built_up": None,
        }

    # Fetch real stats for all variables
    lst_stats = get_raster_stats(db_city, "lst")
    ndvi_stats = get_raster_stats(db_city, "ndvi")
    ndwi_stats = get_raster_stats(db_city, "ndwi")
    ndbi_stats = get_raster_stats(db_city, "ndbi")
    landcover = get_landcover_breakdown(db_city)

    # Determine status
    has_any = any([lst_stats, ndvi_stats, ndwi_stats, ndbi_stats])
    has_all = all([lst_stats, ndvi_stats, ndwi_stats, ndbi_stats])
    status = "ok" if has_all else ("partial_data" if has_any else "no_valid_raster_data")

    warnings = []
    if not has_all:
        missing = [v for v, s in [("lst", lst_stats), ("ndvi", ndvi_stats), ("ndwi", ndwi_stats), ("ndbi", ndbi_stats)] if not s]
        warnings.append(f"Missing raster variables in database: {', '.join(missing)}")

    # Derived scores
    mean_ndvi = ndvi_stats["mean"] if ndvi_stats else None
    mean_ndwi = ndwi_stats["mean"] if ndwi_stats else None
    mean_ndbi = ndbi_stats["mean"] if ndbi_stats else None
    mean_lst = lst_stats["mean"] if lst_stats else None

    veg_health = calculate_vegetation_health_score(mean_ndvi)
    green_pct = landcover["green_cover_pct"] if landcover else (round(max(0, mean_ndvi * 50), 1) if mean_ndvi else 25.0)
    tree_density = landcover["tree_cover_pct"] if landcover else (round(max(0, mean_ndvi * 60), 1) if mean_ndvi else 20.0)

    water_pct = landcover["surface_water_pct"] if landcover else 0.5
    water_index = calculate_water_availability_index(mean_ndwi, water_pct)
    water_stress = max(0, 100 - water_index)

    return {
        "city_id": city_id,
        "database_city": db_city,
        "status": status,
        "data_source": "PostgreSQL / PostGIS (table: city_rasters)",
        "warnings": warnings,
        "vegetation": {
            "vegetation_health": veg_health,
            "green_cover_pct": green_pct,
            "tree_density_index": int(tree_density),
            "ndvi": round(mean_ndvi, 3) if mean_ndvi is not None else None,
            "mean_ndvi": mean_ndvi,
            "min_ndvi": ndvi_stats["min"] if ndvi_stats else None,
            "max_ndvi": ndvi_stats["max"] if ndvi_stats else None,
            "valid_pixels": ndvi_stats["valid_pixels"] if ndvi_stats else 0,
            "unit": "NDVI [-1.0, 1.0]",
            "is_mock": False,
        },
        "water": {
            "availability_index": water_index,
            "surface_water_pct": water_pct,
            "proximity_km": 5.0,
            "water_stress_index": water_stress,
            "mean_ndwi": round(mean_ndwi, 3) if mean_ndwi is not None else None,
            "min_ndwi": ndwi_stats["min"] if ndwi_stats else None,
            "max_ndwi": ndwi_stats["max"] if ndwi_stats else None,
            "valid_pixels": ndwi_stats["valid_pixels"] if ndwi_stats else 0,
            "unit": "NDWI [-1.0, 1.0]",
            "is_mock": False,
        },
        "heat": {
            "mean_lst_c": round(mean_lst, 1) if mean_lst is not None else None,
            "min_lst_c": round(lst_stats["min"], 1) if lst_stats and lst_stats["min"] is not None else None,
            "max_lst_c": round(lst_stats["max"], 1) if lst_stats and lst_stats["max"] is not None else None,
            "valid_pixels": lst_stats["valid_pixels"] if lst_stats else 0,
            "observation_period": CITIES.get(city_id, {}).get("season_label") if city_id in CITIES else None,
            "unit": "°C",
            "is_mock": False,
        },
        "built_up": {
            "mean_ndbi": round(mean_ndbi, 3) if mean_ndbi is not None else None,
            "min_ndbi": ndbi_stats["min"] if ndbi_stats else None,
            "max_ndbi": ndbi_stats["max"] if ndbi_stats else None,
            "built_up_pct": landcover["built_up_pct"] if landcover else None,
            "valid_pixels": ndbi_stats["valid_pixels"] if ndbi_stats else 0,
            "unit": "NDBI [-1.0, 1.0]",
            "is_mock": False,
        },
        "landcover": landcover,
    }


def get_all_environment_metrics() -> Dict[str, Any]:
    """
    Returns environmental metrics for all 20 cities for map markers,
    live ticker, and global overviews. Fully backward-compatible with
    the existing frontend API contract.
    """
    from pipeline.config import CITIES

    result = {}
    for city_id, city_meta in CITIES.items():
        metrics = get_city_environment_metrics(city_id)
        lon, lat = city_meta["center"]

        mean_lst = metrics["heat"]["mean_lst_c"] if metrics["heat"] and metrics["heat"]["mean_lst_c"] is not None else None
        heat_score = min(100, max(0, int((mean_lst - 25.0) * 4))) if mean_lst is not None else None
        air_temp = city_meta.get("air_temp_baseline", 38.0)

        result[city_id] = {
            "id": city_id,
            "name": city_meta["name"],
            "state": city_meta["state"],
            "country": city_meta["country"],
            "lat": lat,
            "lon": lon,
            "air_temp_baseline": air_temp,
            "mean_lst_c": mean_lst,
            "heat_score": heat_score,
            "water": metrics["water"],
            "vegetation": metrics["vegetation"],
            "heat": metrics["heat"],
            "built_up": metrics["built_up"],
            "status": metrics["status"],
            "data_source": metrics["data_source"],
        }

    return {"cities": result}


def get_coverage_audit() -> List[Dict[str, Any]]:
    """
    Generates a full database-backed audit for all 20 frontend cities
    and all 5 variables (100 city-variable pairs).
    """
    from pipeline.config import CITIES

    units_map = {
        "lst": "°C (Land Surface Temperature)",
        "ndvi": "Index [-1.0, 1.0] (Normalized Difference Vegetation Index)",
        "ndwi": "Index [-1.0, 1.0] (Normalized Difference Water Index)",
        "ndbi": "Index [-1.0, 1.0] (Normalized Difference Built-up Index)",
        "landcover": "ESA WorldCover Class Codes (10=Tree, 50=Built, 80=Water)",
    }

    audit_records = []
    for city_id, city_meta in sorted(CITIES.items(), key=lambda kv: kv[1]["name"]):
        db_city = resolve_city_name(city_id)
        for var in SUPPORTED_VARIABLES:
            stats = get_raster_stats(db_city, var)
            meta = get_raster_metadata(db_city, var)

            record = {
                "frontend_city_id": city_id,
                "display_name": city_meta["name"],
                "database_city": db_city,
                "variable": var,
                "units": units_map.get(var, "unknown"),
                "pixel_type": meta["pixel_type"] if meta else None,
                "srid": meta["srid"] if meta else 4326,
                "valid_pixels": stats["valid_pixels"] if stats else 0,
                "min": stats["min"] if stats else None,
                "max": stats["max"] if stats else None,
                "mean": stats["mean"] if stats else None,
                "status": "available" if stats and stats["valid_pixels"] > 0 else "unavailable",
                "source": stats.get("source") if stats else None,
            }
            audit_records.append(record)

    return audit_records
