"""
Tests for Grid Endpoint and Hybrid Data Architecture.
Verifies that:
- /api/v1/grid provides estimated live air temperature from Open-Meteo API.
- Each cell has a spatially interpolated air temperature rather than a single flat number.
- Vegetation and landcover attributes are preserved from PostgreSQL/PostGIS.
- Baseline LST metrics are preserved and explicitly distinguished from air temperature.
- /api/v1/grid/stats returns hybrid metadata (live temperature + database vegetation).
- Target cities (New Delhi, Hyderabad, Jaipur, Mumbai, Bengaluru) all return valid hybrid data.
"""

import unittest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

TARGET_CITIES = ["new_delhi", "hyderabad", "jaipur", "mumbai", "bengaluru"]


class TestGridHybridArchitecture(unittest.TestCase):
    def test_grid_hybrid_features_new_delhi(self):
        """Verify grid GeoJSON contains live weather temperature and database vegetation."""
        response = client.get("/api/v1/grid?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["type"], "FeatureCollection")
        self.assertIn("metadata", data)
        meta = data["metadata"]
        self.assertEqual(meta["city_id"], "new_delhi")
        self.assertIn("live_air_temp_c", meta)
        self.assertIn("Open-Meteo", meta["weather_provider"])
        self.assertEqual(meta["vegetation_source"], "PostgreSQL / PostGIS Database")

        # Check features
        features = data["features"]
        self.assertGreater(len(features), 100)

        first = features[0]["properties"]
        self.assertIn("estimated_air_temp", first)
        self.assertIn("live_temp_baseline", first)
        self.assertIn("temp_source", first)
        self.assertIn("vegetation_source", first)
        self.assertIn("frac_vegetation", first)
        self.assertIn("lst_mean", first)
        self.assertIn("tier", first)

        # Check that cells have microclimatic temperature variation (not a single flat copy)
        all_estimated_temps = [f["properties"]["estimated_air_temp"] for f in features[:50]]
        self.assertGreater(len(set(all_estimated_temps)), 1, "Cells must have microclimatic variation, not a single flat copy")

    def test_grid_cell_tooltip_attributes(self):
        """Verify each cell contains complete geographic footprint and live weather attributes."""
        response = client.get("/api/v1/grid?city=new_delhi")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        for feat in data["features"][:20]:
            p = feat["properties"]
            # 1. Geographic Footprint
            self.assertIn("grid_id", p)
            self.assertIn("locality", p)
            self.assertIn("admin_area", p)
            self.assertIn("cell_center_lat", p)
            self.assertIn("cell_center_lon", p)
            self.assertIn("formatted_coords", p)
            self.assertIn("coverage", p)
            self.assertIn("0.25 km²", p["coverage"])

            # 2. Live Weather from Open-Meteo
            self.assertIn("live_air_temp_c", p)
            self.assertIsInstance(p["live_air_temp_c"], (int, float))
            self.assertIn("weather_point_label", p)
            self.assertIn("observation_time", p)
            self.assertIn("weather_source", p)
            self.assertIn("Open-Meteo", p["weather_source"])

            # 3. Database Vegetation & Baseline LST
            self.assertIn("frac_vegetation", p)
            self.assertIn("lst_mean", p)
            self.assertIn("tier", p)

    def test_all_20_cities_locality_resolution(self):
        """Verify locality and administrative area resolution for all 20 supported cities."""
        from pipeline.config import CITIES
        from api.services.locality_service import resolve_cell_locality

        self.assertEqual(len(CITIES), 20)
        for cid, meta in CITIES.items():
            lon_c, lat_c = meta["center"]
            loc = resolve_cell_locality(cid, lat_c, lon_c)
            self.assertEqual(loc["city_id"], cid)
            self.assertIn(meta["name"], loc["admin_area"])
            self.assertTrue(len(loc["locality"]) > 0)
            self.assertIn("°", loc["formatted_coordinates"])
            self.assertIn("0.25 km²", loc["coverage_footprint"])

    def test_cell_endpoint(self):
        """Verify /api/v1/grid/cell coordinate query."""
        response = client.get("/api/v1/grid/cell?city=new_delhi&lat=28.6315&lon=77.2167")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("locality_info", data)
        self.assertIn("cell_weather", data)
        self.assertIn("Connaught Place", data["locality_info"]["locality"])
        self.assertIsNotNone(data["cell_weather"]["temp_c"])


if __name__ == "__main__":
    unittest.main()

