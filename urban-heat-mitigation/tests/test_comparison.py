"""
Test suite for City Comparison endpoint and integrations:
- Tests city validation, 2-5 city constraints, alias resolution, duplicate prevention
- Tests weather metrics (temperature, humidity, precipitation, wind speed) from Open-Meteo
- Tests environmental metrics (NDVI, NDWI, NDBI, Land Cover) from PostgreSQL/PostGIS
- Regression protection for existing endpoints: /health, /api/v1/cities, /api/v1/weather, /api/v1/environment
"""

import pytest
from fastapi.testclient import TestClient
from api.main import app
from pipeline.config import CITIES

client = TestClient(app)


def test_health_check():
    """Verify health endpoint."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_cities_endpoint():
    """Verify city list endpoint returns all 20 cities."""
    resp = client.get("/api/v1/cities")
    assert resp.status_code == 200
    data = resp.json()
    assert "cities" in data
    assert "default_city" in data
    assert len(data["cities"]) == 20
    assert data["default_city"] == "new_delhi"


def test_comparison_default_cities():
    """Verify comparison with default cities (new_delhi, mumbai)."""
    resp = client.get("/api/v1/comparison?cities=new_delhi,mumbai")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["selected_count"] == 2
    assert len(data["cities"]) == 2

    # Check city structure
    delhi = data["cities"][0]
    mumbai = data["cities"][1]
    assert delhi["city_id"] == "new_delhi"
    assert mumbai["city_id"] == "mumbai"

    # Verify weather structure
    for c in (delhi, mumbai):
        assert "weather" in c
        w = c["weather"]
        assert "data_source" in w
        assert "Open-Meteo" in w["data_source"]
        assert "current_temp_c" in w
        assert "today_max_c" in w
        assert "today_min_c" in w
        assert "humidity_pct" in w
        assert "precipitation_mm" in w
        assert "wind_speed_kmh" in w

        # Verify environment structure
        assert "environment" in c
        env = c["environment"]
        assert "data_source" in env
        assert "vegetation" in env
        assert "water" in env
        assert "built_up" in env
        assert "heat" in env


def test_comparison_alias_resolution():
    """Verify aliases like 'delhi', 'bombay', 'bangalore' resolve correctly."""
    resp = client.get("/api/v1/comparison?cities=delhi,bombay,bangalore")
    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_count"] == 3
    city_ids = [c["city_id"] for c in data["cities"]]
    assert city_ids == ["new_delhi", "mumbai", "bengaluru"]


def test_comparison_minimum_cities_constraint():
    """Verify that fewer than 2 cities returns 400 Bad Request."""
    resp = client.get("/api/v1/comparison?cities=new_delhi")
    assert resp.status_code == 400
    assert "requires at least 2 cities" in resp.json()["detail"]


def test_comparison_six_cities_allowed():
    """Verify that comparing 6 cities succeeds now that the 5-city limit is removed."""
    resp = client.get("/api/v1/comparison?cities=new_delhi,mumbai,bengaluru,chennai,kolkata,hyderabad")
    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_count"] == 6
    assert len(data["cities"]) == 6


def test_comparison_all_twenty_cities_simultaneously():
    """Verify that comparing all 20 supported cities simultaneously succeeds."""
    all_city_ids = list(CITIES.keys())
    assert len(all_city_ids) == 20
    cities_param = ",".join(all_city_ids)
    resp = client.get(f"/api/v1/comparison?cities={cities_param}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_count"] == 20
    assert len(data["cities"]) == 20


def test_comparison_all_shortcut():
    """Verify that ?cities=all returns all 20 cities."""
    resp = client.get("/api/v1/comparison?cities=all")
    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_count"] == 20
    assert len(data["cities"]) == 20


def test_comparison_exceeding_max_cities_constraint():
    """Verify that requesting more than the 20 supported cities returns 400 Bad Request."""
    too_many = list(CITIES.keys()) + ["new_delhi"]
    cities_param = ",".join(too_many)
    resp = client.get(f"/api/v1/comparison?cities={cities_param}")
    assert resp.status_code == 400
    assert "supports at most 20 cities" in resp.json()["detail"]


def test_comparison_duplicate_city_rejection():
    """Verify that duplicate cities are rejected with 400 Bad Request."""
    resp = client.get("/api/v1/comparison?cities=delhi,new_delhi")
    assert resp.status_code == 400
    assert "Duplicate city" in resp.json()["detail"]


def test_comparison_unknown_city():
    """Verify that an unknown city returns 404 Not Found."""
    resp = client.get("/api/v1/comparison?cities=atlantis,mumbai")
    assert resp.status_code == 404
    assert "Unknown city" in resp.json()["detail"]


def test_weather_endpoint_regression():
    """Verify existing GET /api/v1/weather endpoint still functions with new fields."""
    resp = client.get("/api/v1/weather?city=mumbai")
    assert resp.status_code == 200
    data = resp.json()
    assert data["city_id"] == "mumbai"
    assert "current_temp_c" in data
    assert "precipitation_mm" in data
    assert "wind_speed_kmh" in data


def test_environment_endpoint_regression():
    """Verify existing GET /api/v1/environment endpoint still functions."""
    resp = client.get("/api/v1/environment?city=new_delhi")
    assert resp.status_code == 200
    data = resp.json()
    assert data["city_id"] == "new_delhi"
    assert "vegetation" in data
    assert "water" in data
    assert "built_up" in data
    assert "heat" in data
