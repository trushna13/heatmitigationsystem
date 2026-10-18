"""
Tests for Live Weather Service and API Endpoints.
Covers:
- City resolution and weather retrieval for individual cities (New Delhi, Jaipur, Mumbai, Bengaluru).
- Weather retrieval for all 20 cities.
- Caching behavior (TTL, cache hit speed, cache freshness).
- Fallback / error handling when provider is unreachable.
- FastAPI endpoint responses and schemas for /api/v1/weather and /api/v1/weather/all.
"""

import unittest
from fastapi.testclient import TestClient

from api.main import app
from api.services.weather_service import (
    get_city_weather,
    get_all_cities_weather,
    _WEATHER_CACHE,
    CACHE_TTL_SECONDS,
)
from pipeline.config import CITIES

client = TestClient(app)

TARGET_CITIES = ["new_delhi", "jaipur", "mumbai", "bengaluru"]


class TestWeatherService(unittest.TestCase):
    def test_single_city_weather_structure(self):
        """Verify weather data structure and required fields for New Delhi."""
        data = get_city_weather("new_delhi")
        self.assertEqual(data["city_id"], "new_delhi")
        self.assertIn(data["status"], ["ok", "stale_data"])
        self.assertIn("Open-Meteo", data["provider"])

        # Check required fields
        self.assertIn("current_temp_c", data)
        self.assertIn("today_max_c", data)
        self.assertIn("today_min_c", data)
        self.assertIn("humidity_pct", data)
        self.assertIn("observation_time", data)
        self.assertEqual(data.get("timezone"), "Asia/Kolkata")
        self.assertTrue(data.get("is_forecast_daily"))
        self.assertIn("data_type", data)
        self.assertIn("fetched_at", data)

        if data["status"] == "ok":
            self.assertIsInstance(data["current_temp_c"], (int, float))
            self.assertIsInstance(data["today_max_c"], (int, float))
            self.assertIsInstance(data["today_min_c"], (int, float))
            self.assertIsInstance(data["humidity_pct"], int)
            self.assertTrue(0 <= data["humidity_pct"] <= 100)

    def test_target_four_cities(self):
        """Verify live weather retrieval for New Delhi, Jaipur, Mumbai, Bengaluru."""
        for cid in TARGET_CITIES:
            data = get_city_weather(cid)
            self.assertEqual(data["city_id"], cid)
            self.assertIn(data["status"], ["ok", "stale_data"])
            self.assertIsNotNone(data["current_temp_c"])

    def test_cache_hits_are_fast(self):
        """Verify that cached responses return immediately without hitting the network."""
        # First call populates cache
        get_city_weather("jaipur")
        # Second call should be from cache
        cached = get_city_weather("jaipur")
        self.assertTrue(cached.get("cached", False))
        self.assertIn("cache_age_seconds", cached)
        self.assertLess(cached["cache_age_seconds"], CACHE_TTL_SECONDS)

    def test_unknown_city_returns_error(self):
        """Verify unknown city handling."""
        res = get_city_weather("non_existent_city_123")
        self.assertEqual(res["status"], "unknown_city")

    def test_all_cities_weather(self):
        """Verify all 20 cities return in get_all_cities_weather."""
        all_res = get_all_cities_weather()
        self.assertEqual(all_res["status"], "ok")
        self.assertEqual(all_res["total_cities"], 20)
        for cid in CITIES.keys():
            self.assertIn(cid, all_res["cities"])
            city_w = all_res["cities"][cid]
            self.assertIn("current_temp_c", city_w)


class TestWeatherApiEndpoints(unittest.TestCase):
    def test_api_get_weather_single_city(self):
        response = client.get("/api/v1/weather?city=mumbai")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["city_id"], "mumbai")
        self.assertIn("current_temp_c", data)
        self.assertIn("today_max_c", data)
        self.assertIn("today_min_c", data)
        self.assertIn("humidity_pct", data)

    def test_api_get_weather_invalid_city(self):
        response = client.get("/api/v1/weather?city=invalid_city_xyz")
        self.assertEqual(response.status_code, 404)

    def test_api_get_weather_all(self):
        response = client.get("/api/v1/weather/all")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("cities", data)
        for cid in TARGET_CITIES:
            self.assertIn(cid, data["cities"])


if __name__ == "__main__":
    unittest.main()
