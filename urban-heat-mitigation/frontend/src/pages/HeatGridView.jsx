import { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { Info } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE } from '../api';
import { useTheme } from '../ThemeContext';
import LstExplainerModal from '../components/LstExplainerModal';
import ServerWakingNotice from '../components/ServerWakingNotice';
import ValidationBadge from '../components/ValidationBadge';
import './MapView.css';

// Reliable MapLibre Raster Styles (OSM Light & Carto Dark)
const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

const OSM_DARK_STYLE = {
  version: 8,
  sources: {
    'carto-dark-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'carto-dark-tiles-layer',
      type: 'raster',
      source: 'carto-dark-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

// Tier colors matching backend
const TIER_COLORS = {
  critical: [255, 23, 68],
  high: [255, 145, 0],
  moderate: [255, 214, 0],
  normal: [0, 200, 83],
  cool: [41, 121, 255]
};

export default function HeatGridView({ city, cityInfo }) {
  const { theme } = useTheme();
  const [gridData, setGridData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [envData, setEnvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLstInfo, setShowLstInfo] = useState(false);
  const [validation, setValidation] = useState(null);
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);

  // Auto-refresh live weather periodically (every 5 minutes) without reloading grid geometry or querying database
  useEffect(() => {
    const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const timer = setInterval(() => {
      setWeatherRefreshKey(k => k + 1);
    }, WEATHER_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // 1. Fetch grid geometry, overview, validation, and database environmental metrics when city changes
  useEffect(() => {
    if (!city) return;

    let cancelled = false;

    const fetchBaseData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [gridRes, overviewRes, envRes, validationRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/grid?city=${city}`),
          fetch(`${API_BASE}/api/v1/overview?city=${city}`),
          fetch(`${API_BASE}/api/v1/environment?city=${city}`).catch(() => null),
          fetch(`${API_BASE}/api/v1/validation?city=${city}`).catch(() => null),
        ]);

        if (cancelled) return;

        if (gridRes.ok) {
          const data = await gridRes.json();
          setGridData(data);
        }

        if (overviewRes.ok) {
          const data = await overviewRes.json();
          setOverview(data);
        }

        if (envRes && envRes.ok) {
          const data = await envRes.json();
          setEnvData(data);
        }

        if (validationRes && validationRes.ok) {
          const data = await validationRes.json();
          setValidation(data);
        } else {
          setValidation(null);
        }

        if (!gridRes.ok || !overviewRes.ok) {
          setError('Could not load 3D grid data for this city.');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch 3D grid data:', err);
          setError('Could not reach the server. Is the backend running?');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBaseData();
    return () => { cancelled = true; };
  }, [city]);

  // 2. Fetch live weather API separately (updates on city change or 5-min timer without touching DB/grid)
  useEffect(() => {
    if (!city) return;

    let cancelled = false;
    const fetchLiveWeather = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/weather?city=${city}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.city_id === city) {
            setWeatherData(data);
          }
        }
      } catch (err) {
        console.warn('Could not refresh live weather for Heat Grid:', err);
      }
    };

    fetchLiveWeather();
    return () => { cancelled = true; };
  }, [city, weatherRefreshKey]);

  // Layers for 3D LST grid with live air temperature microclimatic interpolation
  const layers = [
    new GeoJsonLayer({
      id: 'heat-grid-3d-layer',
      data: gridData,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: true,
      wireframe: true,
      lineWidthMinPixels: 1,
      getLineColor: [255, 255, 255, 25],
      getFillColor: d => {
        const tier = d.properties.tier;
        const color = TIER_COLORS[tier] || [128, 128, 128];
        return [...color, 180];
      },
      getElevation: d => {
        const temp = d.properties.estimated_air_temp ?? d.properties.lst_mean;
        return Math.max(0, (temp - 20) * 120);
      },
      transitions: {
        getFillColor: 500,
        getElevation: 500
      }
    })
  ];

  // Camera initial position centered on active city
  const [centerLon, centerLat] = cityInfo?.center || [77.20, 28.61];
  const initialViewState = {
    longitude: centerLon,
    latitude: centerLat,
    zoom: 10.5,
    pitch: 45,
    bearing: 0
  };

  const activeMapStyle = useMemo(() => {
    return theme === 'dark' ? OSM_DARK_STYLE : OSM_STYLE;
  }, [theme]);

  return (
    <div className="map-view-container animate-fade-in">
      <div className="map-wrapper">
        {loading && (
          <div className="loading-overlay">
            <ServerWakingNotice compact />
          </div>
        )}

        {!loading && error && (
          <div className="loading-overlay">
            <p>{error}</p>
          </div>
        )}

        <DeckGL
          key={`heat-grid-${city}-${theme}`}
          initialViewState={initialViewState}
          controller={true}
          layers={layers}
          getTooltip={({ object }) => {
            if (!object) return null;
            const p = object.properties;
            const liveTemp = p.live_air_temp_c != null ? `${p.live_air_temp_c.toFixed(1)}°C` : (p.estimated_air_temp != null ? `${p.estimated_air_temp.toFixed(1)}°C` : '—');
            const lstTemp = p.lst_mean != null ? `${p.lst_mean.toFixed(1)}°C` : '—';
            const vegPct = p.frac_vegetation != null ? `${(p.frac_vegetation * 100).toFixed(1)}%` : '—';
            const locality = p.locality ? ` · ${p.locality}` : '';
            const admin = p.admin_area || (cityInfo ? `${cityInfo.name}, ${cityInfo.state}` : city);
            const coords = p.formatted_coords || (p.cell_center_lat && p.cell_center_lon ? `${p.cell_center_lat.toFixed(4)}°N, ${p.cell_center_lon.toFixed(4)}°E` : '—');
            const coverage = p.coverage || '~500m × 500m (0.25 km²)';
            const obsTime = p.observation_time ? p.observation_time.replace('T', ' ') + ' IST' : 'Live NWP';
            const weatherPt = p.weather_point_label ? ` (${p.weather_point_label})` : '';
            const tierStr = p.tier ? p.tier.toUpperCase() : 'NORMAL';

            return `Cell: ${p.grid_id}${locality}
Area: ${admin}
Center: ${coords} · ${coverage}
Live Air Temp: ${liveTemp}${weatherPt}
Observation: ${obsTime} · ${p.weather_source || 'Open-Meteo High-Resolution NWP'}
Baseline LST: ${lstTemp} (Landsat Skin Temp)
Heat Tier: ${tierStr}
Vegetation: ${vegPct} (Database/NDVI)`;
          }}
        >
          <Map mapStyle={activeMapStyle} />
        </DeckGL>
      </div>

      {/* 3D Grid KPI Overlay: Hybrid Live Weather + PostGIS Environmental Metrics */}
      {overview && (
        <div className="kpi-overlay glass-panel">
          <div className="kpi-header">
            <div className="title-area">
              <h3>
                {overview.city}
                <button
                  className="info-trigger"
                  onClick={() => setShowLstInfo(true)}
                  aria-label="What does temperature mean?"
                >
                  <Info size={12} />
                </button>
              </h3>
              <span className="mode-tag">🔥 3D Heat Grid · Live Hybrid</span>
            </div>
            <span className="badge">
              {weatherData?.observation_time
                ? `Live ${weatherData.observation_time.split('T')[1] || weatherData.observation_time}`
                : overview.analysis_period}
            </span>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card" title="Current air temperature from Open-Meteo live API">
              <span className="kpi-label">Current Air Temp</span>
              <span className="kpi-value">
                {weatherData?.current_temp_c != null ? `${weatherData.current_temp_c.toFixed(1)}°C` : (
                  overview.mean_lst_c != null ? `${overview.mean_lst_c.toFixed(1)}°C` : '—'
                )}
              </span>
            </div>
            <div className="kpi-card" title="Vegetation health from PostgreSQL / PostGIS Sentinel-2 NDVI">
              <span className="kpi-label">Veg Health</span>
              <span className="kpi-value success">
                {envData?.vegetation?.vegetation_health != null ? `${envData.vegetation.vegetation_health}/100` : '—'}
              </span>
            </div>
            <div className="kpi-card" title="Baseline thermal hotspot area (Landsat LST-derived)">
              <span className="kpi-label">Hotspot Area (LST)</span>
              <span className="kpi-value warning">{overview.hotspot_area_km2.toFixed(1)} km²</span>
            </div>
            <div className="kpi-card" title="Baseline Urban Heat Island intensity (Landsat LST-derived)">
              <span className="kpi-label">UHI Intensity (LST)</span>
              <span className="kpi-value">+{overview.uhi_intensity_c.toFixed(1)}°C</span>
            </div>
          </div>

          <div className="legend">
            <h4>Heat Tiers</h4>
            <div className="legend-items">
              <div className="legend-item"><span className="color-box" style={{ background: 'rgb(255, 23, 68)' }}></span> Critical</div>
              <div className="legend-item"><span className="color-box" style={{ background: 'rgb(255, 145, 0)' }}></span> High</div>
              <div className="legend-item"><span className="color-box" style={{ background: 'rgb(255, 214, 0)' }}></span> Moderate</div>
              <div className="legend-item"><span className="color-box" style={{ background: 'rgb(0, 200, 83)' }}></span> Normal</div>
              <div className="legend-item"><span className="color-box" style={{ background: 'rgb(41, 121, 255)' }}></span> Cool</div>
            </div>
          </div>

          {/* Data Source Transparency Note */}
          <div className="data-note">
            🔥 <strong>Live Air Temp:</strong> Open-Meteo · 🌳 <strong>Vegetation:</strong> PostGIS NDVI
          </div>

          <ValidationBadge validation={validation} />
        </div>
      )}

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
    </div>
  );
}
