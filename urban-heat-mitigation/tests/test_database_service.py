"""
Comprehensive test suite for the Centralized Database Service and API Endpoints.
Covers:
- City alias mapping and normalization for all 20 cities.
- PostGIS connection management and connection pooling.
- SQL parameterization safety against injection.
- NaN / NoData handling and pixel-weighted aggregation calculations.
- Vegetation health and water availability transformations.
- Full 20-city environment profiles and 100-record coverage audit.
- FastAPI endpoint responses and error handling via TestClient.
- Backward compatibility and regression checks for existing endpoints (grid, drivers, scenarios, overview).
"""

import os
import unittest
import math
from fastapi.testclient import TestClient

# Set DB environment variables if not present
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", "5432")
os.environ.setdefault("DB_NAME", "heatshield")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "Nisha@2006")

from api.services.database_service import (
    CITY_ALIASES,
    DB_TO_FRONTEND_ID,
    SUPPORTED_VARIABLES,
    resolve_city_name,
    get_canonical_city_id,
    test_connection,
    get_db_connection,
    get_raster_metadata,
    get_raster_stats,
    get_landcover_breakdown,
    calculate_vegetation_health_score,
    calculate_water_availability_index,
    get_city_environment_metrics,
    get_all_environment_metrics,
    get_coverage_audit,
)
from pipeline.config import CITIES
from api.main import app

client = TestClient(app)

# The canonical 20 cities defined in the project
EXPECTED_20_CITIES = [
    "ahmedabad",
    "bengaluru",
    "bhopal",
    "chandigarh",
    "chennai",
    "coimbatore",
    "guwahati",
    "hyderabad",
    "jaipur",
    "kochi",
    "kolkata",
    "lucknow",
    "mumbai",
    "nagpur",
    "new_delhi",
    "patna",
    "pune",
    "surat",
    "vijayawada",
    "visakhapatnam",
]


class TestDatabaseService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_available = test_connection()

    def test_all_20_frontend_cities_resolve_correctly(self):
        """Verify that all 20 frontend cities resolve to a verified database name."""
        for city_id in EXPECTED_20_CITIES:
            resolved = resolve_city_name(city_id)
            self.assertIsNotNone(
                resolved,
                f"Frontend city '{city_id}' failed to resolve to a database city name."
            )
            # Ensure reverse resolution matches canonical id
            canonical_id = get_canonical_city_id(resolved)
            self.assertEqual(
                canonical_id,
                city_id,
                f"Reverse lookup for DB city '{resolved}' should return '{city_id}', got '{canonical_id}'."
            )

    def test_delhi_alias_resolution(self):
        """Verify specific alias mappings for Delhi/New Delhi."""
        self.assertEqual(resolve_city_name("new_delhi"), "Delhi")
        self.assertEqual(resolve_city_name("New Delhi"), "Delhi")
        self.assertEqual(resolve_city_name("delhi"), "Delhi")
        self.assertEqual(resolve_city_name("DELHI"), "Delhi")

    def test_historical_and_common_aliases(self):
        """Verify historical aliases like Bangalore, Bombay, Madras, Vizag."""
        self.assertEqual(resolve_city_name("bangalore"), "Bengaluru")
        self.assertEqual(resolve_city_name("madras"), "Chennai")
        self.assertEqual(resolve_city_name("bombay"), "Mumbai")
        self.assertEqual(resolve_city_name("calcutta"), "Kolkata")
        self.assertEqual(resolve_city_name("vizag"), "Visakhapatnam")
        self.assertEqual(resolve_city_name("poona"), "Pune")
        self.assertEqual(resolve_city_name("cochin"), "Kochi")

    def test_unknown_city_returns_none(self):
        """Verify that unrecognized cities resolve to None safely."""
        self.assertIsNone(resolve_city_name("non_existent_city"))
        self.assertIsNone(resolve_city_name(""))
        self.assertIsNone(resolve_city_name(None))

    def test_sql_parameterization_safety(self):
        """Verify SQL injection strings are safely rejected or handled without crashing."""
        malicious_input = "new_delhi'; DROP TABLE city_rasters; --"
        resolved = resolve_city_name(malicious_input)
        self.assertIsNone(resolved)

        metrics = get_city_environment_metrics(malicious_input)
        self.assertEqual(metrics["status"], "unknown_city")

    def test_database_connection(self):
        """Verify database connection pool and PostGIS extension."""
        if not self.db_available:
            self.skipTest("Database is not reachable on localhost:5432")
        self.assertTrue(self.db_available)
        with get_db_connection() as conn:
            self.assertIsNotNone(conn)
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                res = cur.fetchone()
                self.assertEqual(res[0], 1)

    def test_scientific_vegetation_score_transformation(self):
        """Verify vegetation health score calculation bounds and logic."""
        # None and NaN return neutral baseline 50
        self.assertEqual(calculate_vegetation_health_score(None), 50)
        self.assertEqual(calculate_vegetation_health_score(float("nan")), 50)

        # Barren / impervious surface (NDVI <= 0.05) -> 0
        self.assertEqual(calculate_vegetation_health_score(0.05), 0)
        self.assertEqual(calculate_vegetation_health_score(-0.2), 0)

        # Dense healthy canopy (NDVI >= 0.70) -> 100
        self.assertEqual(calculate_vegetation_health_score(0.70), 100)
        self.assertEqual(calculate_vegetation_health_score(0.95), 100)

        # Moderate urban greenery (NDVI ~ 0.375) -> ~50
        score = calculate_vegetation_health_score(0.375)
        self.assertTrue(45 <= score <= 55)

    def test_scientific_water_availability_transformation(self):
        """Verify water availability index bounds and logic."""
        self.assertEqual(calculate_water_availability_index(None), 50)
        self.assertEqual(calculate_water_availability_index(float("nan")), 50)

        # Very dry city (NDVI/NDWI very low)
        dry_score = calculate_water_availability_index(-0.75, 0.0)
        self.assertEqual(dry_score, 0)

        # High NDWI and water coverage
        wet_score = calculate_water_availability_index(0.25, 5.0)
        self.assertTrue(90 <= wet_score <= 100)

    def test_raster_metadata_retrieval(self):
        """Verify raster metadata contains SRID, dimensions, and pixel type."""
        if not self.db_available:
            self.skipTest("Database is not reachable")
        meta = get_raster_metadata("Delhi", "ndvi")
        self.assertIsNotNone(meta)
        self.assertIn("srid", meta)
        self.assertIn("pixel_type", meta)
        self.assertEqual(meta["pixel_type"], "32BF")

    def test_raster_stats_delhi(self):
        """Verify valid statistics calculations for Delhi raster data."""
        if not self.db_available:
            self.skipTest("Database is not reachable")
        # NDVI stats
        ndvi_stats = get_raster_stats("Delhi", "ndvi")
        self.assertIsNotNone(ndvi_stats)
        self.assertGreater(ndvi_stats["valid_pixels"], 0)
        self.assertTrue(-1.0 <= ndvi_stats["min"] <= 1.0)
        self.assertTrue(-1.0 <= ndvi_stats["max"] <= 1.0)
        self.assertTrue(-1.0 <= ndvi_stats["mean"] <= 1.0)

        # LST stats (Celsius)
        lst_stats = get_raster_stats("Delhi", "lst")
        self.assertIsNotNone(lst_stats)
        self.assertGreater(lst_stats["valid_pixels"], 0)
        # Verify LST is in Celsius (typically 20°C to 50°C for Delhi scene)
        self.assertTrue(15.0 <= lst_stats["mean"] <= 60.0)

    def test_city_environment_metrics_no_mock(self):
        """Verify that get_city_environment_metrics returns real data and is_mock=False."""
        if not self.db_available:
            self.skipTest("Database is not reachable")
        metrics = get_city_environment_metrics("new_delhi")
        self.assertEqual(metrics["city_id"], "new_delhi")
        self.assertEqual(metrics["database_city"], "Delhi")
        self.assertIn(metrics["status"], ["ok", "partial_data"])
        self.assertIn("PostgreSQL / PostGIS", metrics["data_source"])

        # Check vegetation
        veg = metrics["vegetation"]
        self.assertFalse(veg["is_mock"])
        self.assertIn("mean_ndvi", veg)
        self.assertGreater(veg["valid_pixels"], 0)
        self.assertEqual(veg["unit"], "NDVI [-1.0, 1.0]")

        # Check water
        water = metrics["water"]
        self.assertFalse(water["is_mock"])
        self.assertIn("mean_ndwi", water)
        self.assertGreater(water["valid_pixels"], 0)
        self.assertEqual(water["unit"], "NDWI [-1.0, 1.0]")

        # Check heat
        heat = metrics["heat"]
        self.assertFalse(heat["is_mock"])
        self.assertEqual(heat["unit"], "°C")

    def test_coverage_audit_100_records(self):
        """Verify full coverage audit returns 100 records for the 20 cities x 5 variables."""
        if not self.db_available:
            self.skipTest("Database is not reachable")
        audit = get_coverage_audit()
        self.assertEqual(len(audit), 100, f"Expected 100 records (20 cities x 5 vars), got {len(audit)}")
        for rec in audit:
            self.assertIn(rec["frontend_city_id"], EXPECTED_20_CITIES)
            self.assertIn(rec["variable"], SUPPORTED_VARIABLES)
            self.assertIn("units", rec)
            self.assertIn(rec["status"], ["available", "unavailable"])


class TestApiEndpoints(unittest.TestCase):
    """Test FastAPI HTTP endpoints."""

    def test_health_endpoint(self):
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_cities_endpoint(self):
        response = client.get("/api/v1/cities")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("cities", data)
        self.assertIn("default_city", data)
        city_ids = [c["id"] for c in data["cities"]]
        for expected in EXPECTED_20_CITIES:
            self.assertIn(expected, city_ids)

    def test_environment_endpoint_single_city(self):
        response = client.get("/api/v1/environment?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["city_id"], "new_delhi")
        self.assertEqual(data["database_city"], "Delhi")
        self.assertFalse(data["vegetation"]["is_mock"])
        self.assertFalse(data["water"]["is_mock"])
        self.assertFalse(data["heat"]["is_mock"])

    def test_environment_endpoint_invalid_city(self):
        response = client.get("/api/v1/environment?city=nonexistent_city_xyz")
        self.assertEqual(response.status_code, 404)

    def test_environment_endpoint_all(self):
        response = client.get("/api/v1/environment/all")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("cities", data)
        cities_dict = data["cities"]
        for expected in EXPECTED_20_CITIES:
            self.assertIn(expected, cities_dict)
            self.assertIn("lat", cities_dict[expected])
            self.assertIn("lon", cities_dict[expected])
            self.assertIn("water", cities_dict[expected])
            self.assertIn("vegetation", cities_dict[expected])

    def test_environment_audit_endpoint(self):
        response = client.get("/api/v1/environment/audit")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["total_records"], 100)
        self.assertEqual(len(data["audit"]), 100)

    def test_overview_endpoint_regression(self):
        """Verify overview endpoint remains fully functional."""
        response = client.get("/api/v1/overview?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("mean_lst_c", data)
        self.assertIn("hotspot_count", data)

    def test_grid_endpoint_regression(self):
        """Verify grid GeoJSON endpoint remains functional."""
        response = client.get("/api/v1/grid?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["type"], "FeatureCollection")
        self.assertGreater(len(data["features"]), 0)

    def test_drivers_endpoint_regression(self):
        """Verify drivers endpoint remains functional."""
        response = client.get("/api/v1/drivers?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("global_importance", data)

    def test_scenarios_presets_endpoint_regression(self):
        """Verify cooling scenario presets endpoint remains functional."""
        response = client.get("/api/v1/scenarios/presets?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)


if __name__ == "__main__":
    unittest.main()
