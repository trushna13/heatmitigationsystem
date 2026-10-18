import { useState, useEffect, useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import {
  Info,
  Search,
  Flame,
  Droplets,
  Trees,
  MapPin,
  Layers,
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE } from '../api';
import { useTheme } from '../ThemeContext';
import LstExplainerModal from '../components/LstExplainerModal';
import ServerWakingNotice from '../components/ServerWakingNotice';
import ValidationBadge from '../components/ValidationBadge';
import './MapView.css';

// Reliable MapLibre Raster Styles (OSM Standard Tiles & Esri World Imagery)
const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19
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

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community',
      maxzoom: 19
    }
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-world-imagery',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

// Color functions for Water, Vegetation, and Heat modes
function getWaterIndexColor(index) {
  if (index >= 75) return [30, 64, 175];   // #1e40af High
  if (index >= 50) return [59, 130, 246];  // #3b82f6 Moderate
  if (index >= 25) return [96, 165, 250];  // #60a5fa Low
  return [191, 219, 254];                 // #bfdbfe Very Low
}

function getVegIndexColor(index) {
  if (index >= 75) return [21, 128, 61];   // #15803d Dense
  if (index >= 50) return [34, 197, 94];   // #22c55e Moderate
  if (index >= 25) return [134, 239, 172]; // #86efac Light
  return [220, 252, 231];                 // #dcfce7 Sparse
}

// Color function for Live Air Temperature Heat Mode
// Extreme: >= 40°C, High: 35–39.9°C, Warm: 30–34.9°C, Mild: 25–29.9°C, Cool: < 25°C
function getHeatScoreColor(temp) {
  if (temp == null) return [148, 163, 184];
  if (temp >= 40) return [192, 39, 31];
  if (temp >= 35) return [240, 85, 90];
  if (temp >= 30) return [240, 128, 58];
  if (temp >= 25) return [245, 165, 66];
  return [245, 210, 100];
}

export default function MapView({ city, cityInfo, onSelectCity, cities = [] }) {
  const { theme } = useTheme();

  // Mode state: 'heat', 'vegetation', 'water'
  const [activeMode, setActiveMode] = useState('heat');

  // Basemap switcher state: 'default' or 'satellite'
  const [mapType, setMapType] = useState('default');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Data states
  const [weatherData, setWeatherData] = useState(null);
  const [allWeatherData, setAllWeatherData] = useState(null);
  const [envData, setEnvData] = useState(null);
  const [allEnvData, setAllEnvData] = useState(null);
  const [validation, setValidation] = useState(null);

  // Loading & Error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setWeatherRefreshKey(k => k + 1);
    setManualRefreshKey(k => k + 1);
  }, []);

  // Periodic weather auto-refresh every 5 minutes (300,000 ms) — ONLY updates weather, never queries DB
  useEffect(() => {
    const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const timer = setInterval(() => {
      setWeatherRefreshKey(k => k + 1);
    }, WEATHER_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Modal state
  const [showLstInfo, setShowLstInfo] = useState(false);

  // 1. Database Environmental Metrics (Vegetation & Water from PostgreSQL/PostGIS)
  // Runs ONLY when selected city changes or manual retry is clicked — NEVER on 5-min weather ticks
  useEffect(() => {
    if (!city) return;

    let cancelled = false;

    const loadEnvData = async () => {
      try {
        const [envRes, allEnvRes, valRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/environment?city=${city}`).catch(() => null),
          fetch(`${API_BASE}/api/v1/environment/all`).catch(() => null),
          fetch(`${API_BASE}/api/v1/validation?city=${city}`).catch(() => null),
        ]);

        if (cancelled) return;

        if (envRes && envRes.ok) {
          const data = await envRes.json();
          if (!cancelled && data.city_id === city) {
            setEnvData(data);
          }
        }

        if (allEnvRes && allEnvRes.ok) {
          const data = await allEnvRes.json();
          if (!cancelled) {
            setAllEnvData(data.cities || {});
          }
        }

        if (valRes && valRes.ok) {
          const data = await valRes.json();
          if (!cancelled) {
            setValidation(data);
          }
        } else if (!cancelled) {
          setValidation(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load database environmental data:', err);
        }
      }
    };

    loadEnvData();
    return () => { cancelled = true; };
  }, [city, manualRefreshKey]);

  // 2. Live Weather API (Temperature & Humidity from Open-Meteo)
  // Updates when city changes or on 5-minute background tick — NEVER overwrites vegetation/water
  useEffect(() => {
    if (!city) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadWeatherData = async () => {
      try {
        const [weatherRes, allWeatherRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/weather?city=${city}`).catch(() => null),
          fetch(`${API_BASE}/api/v1/weather/all`).catch(() => null),
        ]);

        if (cancelled) return;

        if (weatherRes && weatherRes.ok) {
          const data = await weatherRes.json();
          if (!cancelled && data.city_id === city) {
            setWeatherData(data);
          }
        } else if (!cancelled && activeMode === 'heat') {
          setError('Could not load live weather data for this city.');
        }

        if (allWeatherRes && allWeatherRes.ok) {
          const data = await allWeatherRes.json();
          if (!cancelled) {
            setAllWeatherData(data.cities || {});
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load live weather data:', err);
          if (activeMode === 'heat') {
            setError('Could not connect to live weather service.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadWeatherData();
    return () => { cancelled = true; };
  }, [city, weatherRefreshKey, activeMode]);

  // Selected city center coordinates
  const selectedCenter = useMemo(() => {
    if (cityInfo?.center && cityInfo.center.length === 2) {
      return cityInfo.center;
    }
    const found = cities.find(c => c.id === city);
    if (found?.center && found.center.length === 2) {
      return found.center;
    }
    return [77.20, 28.61];
  }, [cityInfo, cities, city]);

  // Initial camera view centered on the active city
  const initialViewState = useMemo(() => {
    return {
      longitude: selectedCenter[0],
      latitude: selectedCenter[1],
      zoom: 11,
      pitch: 0,
      bearing: 0
    };
  }, [selectedCenter]);

  // Cities list for overview markers & search (combining live weather with environmental indicators)
  const citiesList = useMemo(() => {
    return cities.map(c => {
      const env = allEnvData ? allEnvData[c.id] : null;
      const weather = allWeatherData ? allWeatherData[c.id] : null;
      return {
        id: c.id,
        name: c.name,
        state: c.state,
        country: c.country,
        lat: c.center ? c.center[1] : 28.61,
        lon: c.center ? c.center[0] : 77.20,
        weather: weather || null,
        water: env?.water || null,
        vegetation: env?.vegetation || null,
      };
    });
  }, [allEnvData, allWeatherData, cities]);

  // Filtered search results
  const filteredCities = useMemo(() => {
    if (!searchQuery.trim()) return citiesList;
    const q = searchQuery.toLowerCase();
    return citiesList.filter(
      c => c.name.toLowerCase().includes(q) || (c.state && c.state.toLowerCase().includes(q))
    );
  }, [searchQuery, citiesList]);

  // India Overview Deck.gl Layers (Markers + City Text Labels)
  const layers = useMemo(() => {
    const list = [];

    if (citiesList.length > 0) {
      // 1. City Marker Pins
      list.push(
        new ScatterplotLayer({
          id: `india-city-markers-${activeMode}`,
          data: citiesList,
          pickable: true,
          opacity: 0.95,
          stroked: true,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 10,
          radiusMaxPixels: 22,
          lineWidthMinPixels: 2,
          getPosition: d => [d.lon, d.lat],
          getRadius: d => (d.id === city ? 24000 : 18000),
          getFillColor: d => {
            if (activeMode === 'water') {
              const v = d.water?.availability_index ?? 50;
              return getWaterIndexColor(v);
            } else if (activeMode === 'vegetation') {
              const v = d.vegetation?.vegetation_health ?? 50;
              return getVegIndexColor(v);
            } else {
              const temp = d.weather?.current_temp_c;
              return getHeatScoreColor(temp);
            }
          },
          getLineColor: d => (d.id === city ? [255, 255, 255, 255] : [15, 23, 42, 200]),
          onClick: info => {
            if (info.object && onSelectCity) {
              onSelectCity(info.object.id);
            }
          },
          transitions: {
            getFillColor: 300
          }
        })
      );

      // 2. City Text Labels
      list.push(
        new TextLayer({
          id: 'india-city-labels',
          data: citiesList,
          pickable: false,
          getPosition: d => [d.lon, d.lat],
          getText: d => d.name,
          getSize: 12,
          getAngle: 0,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          getPixelOffset: [0, 14],
          getColor: theme === 'light' ? [15, 23, 42, 240] : [248, 250, 252, 240],
          backgroundColor: theme === 'light' ? [255, 255, 255, 190] : [15, 23, 42, 190],
          fontFamily: 'Inter, sans-serif',
          fontWeight: '600'
        })
      );
    }

    return list;
  }, [citiesList, activeMode, city, theme, onSelectCity]);

  // Basemap style selection (Default: OpenStreetMap standard tiles, Satellite: Esri World Imagery)
  const activeMapStyle = useMemo(() => {
    return mapType === 'satellite' ? SATELLITE_STYLE : OSM_STYLE;
  }, [mapType]);

  // Live Ticker text
  const tickerText = useMemo(() => {
    if (!citiesList || citiesList.length === 0) return 'Loading city metrics…';

    const items = citiesList.map(c => {
      if (activeMode === 'water') {
        const val = c.water?.availability_index;
        return val != null ? `${c.name} · Water Index: ${val}/100` : null;
      } else if (activeMode === 'vegetation') {
        const val = c.vegetation?.vegetation_health;
        return val != null ? `${c.name} · Green Health: ${val}/100` : null;
      } else {
        const temp = c.weather?.current_temp_c;
        const hum = c.weather?.humidity_pct;
        return temp != null
          ? `${c.name} · ${temp}°C${hum != null ? ` (${hum}% RH)` : ''}`
          : null;
      }
    }).filter(Boolean);

    return items.join('   ·   ') + '   ·   ';
  }, [citiesList, activeMode]);

  return (
    <div className="map-view-container animate-fade-in">
      {/* Top Controls Bar */}
      <div className="map-top-bar glass-panel">
        {/* Mode Switcher inside Heat Map */}
        <div className="mode-tabs">
          <button
            className={`mode-tab heat ${activeMode === 'heat' ? 'active' : ''}`}
            onClick={() => setActiveMode('heat')}
          >
            <Flame size={16} />
            <span>🔥 Heat</span>
          </button>
          <button
            className={`mode-tab vegetation ${activeMode === 'vegetation' ? 'active' : ''}`}
            onClick={() => setActiveMode('vegetation')}
          >
            <Trees size={16} />
            <span>🌳 Vegetation</span>
          </button>
          <button
            className={`mode-tab water ${activeMode === 'water' ? 'active' : ''}`}
            onClick={() => setActiveMode('water')}
          >
            <Droplets size={16} />
            <span>💧 Water</span>
          </button>
        </div>

        {/* City Search & Jump */}
        <div className="search-jump-wrap">
          <div className="search-input-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Jump to a city…"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
            />
          </div>

          {searchOpen && filteredCities.length > 0 && (
            <div className="search-dropdown glass-panel">
              {filteredCities.map(c => (
                <button
                  key={c.id}
                  className={`search-result-item ${c.id === city ? 'selected' : ''}`}
                  onClick={() => {
                    if (onSelectCity) onSelectCity(c.id);
                    setSearchQuery('');
                    setSearchOpen(false);
                  }}
                >
                  <MapPin size={14} />
                  <span className="city-name">{c.name}</span>
                  <span className="city-state">{c.state}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Basemap Switcher: Default / Satellite */}
        <div className="map-controls-group">
          <button
            className={`control-btn ${mapType === 'default' ? 'active' : ''}`}
            onClick={() => setMapType('default')}
          >
            <span>Default</span>
          </button>
          <button
            className={`control-btn ${mapType === 'satellite' ? 'active' : ''}`}
            onClick={() => setMapType('satellite')}
          >
            <Layers size={14} />
            <span>Satellite</span>
          </button>
        </div>
      </div>

      {/* Live Ticker Strip */}
      <div className="ticker-bar glass-panel">
        <span className="live-badge">
          <span className="live-pulse"></span> Live 20-City Overview
        </span>
        <div className="ticker-track-wrap">
          <div className="ticker-track">
            <span>{tickerText}</span>
            <span>{tickerText}</span>
          </div>
        </div>
      </div>

      {/* Main Map Canvas */}
      <div className="map-wrapper">
        {loading && (
          <div className="loading-overlay">
            <ServerWakingNotice compact onRetry={handleRefresh} />
          </div>
        )}

        {!loading && error && (
          <div className="loading-overlay">
            <ServerWakingNotice compact error={error} onRetry={handleRefresh} />
          </div>
        )}

        <DeckGL
          key={`heat-map-${city}`}
          initialViewState={initialViewState}
          controller={true}
          layers={layers}
          getTooltip={({ object }) => {
            if (!object) return null;
            if (activeMode === 'heat') {
              const w = object.weather;
              const currTemp = w?.current_temp_c != null ? `${w.current_temp_c}°C` : 'Unavailable';
              const maxTemp = w?.today_max_c != null ? `${w.today_max_c}°C` : '—';
              const minTemp = w?.today_min_c != null ? `${w.today_min_c}°C` : '—';
              const hum = w?.humidity_pct != null ? `${w.humidity_pct}%` : '—';
              const cond = w?.weather_description || '—';
              const obs = w?.observation_time ? w.observation_time.replace('T', ' ') : '—';
              return `${object.name}, ${object.state}
Current Air Temp: ${currTemp} (${cond})
Today's Forecast High: ${maxTemp}
Today's Forecast Low: ${minTemp}
Relative Humidity: ${hum}
Model Timestep: ${obs} IST`;
            } else if (activeMode === 'vegetation') {
              const v = object.vegetation?.vegetation_health ?? '—';
              const g = object.vegetation?.green_cover_pct != null ? `${object.vegetation.green_cover_pct}%` : '—';
              return `${object.name}, ${object.state}
Green Health: ${v}/100
Green Cover: ${g}`;
            } else {
              const w = object.water?.availability_index ?? '—';
              const sw = object.water?.surface_water_pct != null ? `${object.water.surface_water_pct}%` : '—';
              return `${object.name}, ${object.state}
Water Index: ${w}/100
Surface Water: ${sw}`;
            }
          }}
        >
          <Map mapStyle={activeMapStyle} />
        </DeckGL>
      </div>

      {/* KPI & Summary Overlay for Selected City */}
      <div className="kpi-overlay glass-panel">
        <div className="kpi-header">
          <div className="title-area">
            <h3>
              {cityInfo ? `${cityInfo.name}, ${cityInfo.state}` : city}
              {activeMode === 'heat' && (
                <button
                  className="info-trigger"
                  onClick={() => setShowLstInfo(true)}
                  aria-label="What does LST mean?"
                >
                  <Info size={13} />
                </button>
              )}
            </h3>
            <span className="mode-tag">
              {activeMode === 'heat' && '🔥 Live Weather & Air Temp'}
              {activeMode === 'vegetation' && '🌳 Vegetation Health'}
              {activeMode === 'water' && '💧 Water Availability'}
            </span>
          </div>
          <span className="badge" title="Numerical Weather Prediction (NWP) model timestep">
            {activeMode === 'heat'
              ? (weatherData?.observation_time ? `Model ${weatherData.observation_time.split('T')[1] || weatherData.observation_time}` : 'Live Weather')
              : (cityInfo?.season_label || 'Apr–Jun 2026')}
          </span>
        </div>

        {/* Heat Overview KPIs: Live Weather Air Temperature */}
        {activeMode === 'heat' && (
          <div className="kpi-grid">
            <div className="kpi-card" title="Air temperature at 2m from Open-Meteo NWP assimilation">
              <span className="kpi-label">Current Air Temp</span>
              <span className="kpi-value">
                {weatherData?.current_temp_c != null ? `${weatherData.current_temp_c.toFixed(1)}°C` : '—'}
              </span>
            </div>
            <div className="kpi-card" title="Today's maximum forecast temperature (Asia/Kolkata)">
              <span className="kpi-label">Today's Forecast High</span>
              <span className="kpi-value danger">
                {weatherData?.today_max_c != null ? `${weatherData.today_max_c.toFixed(1)}°C` : '—'}
              </span>
            </div>
            <div className="kpi-card" title="Today's minimum forecast temperature (Asia/Kolkata)">
              <span className="kpi-label">Today's Forecast Low</span>
              <span className="kpi-value">
                {weatherData?.today_min_c != null ? `${weatherData.today_min_c.toFixed(1)}°C` : '—'}
              </span>
            </div>
            <div className="kpi-card" title="Current relative humidity">
              <span className="kpi-label">Relative Humidity</span>
              <span className="kpi-value warning">
                {weatherData?.humidity_pct != null ? `${weatherData.humidity_pct}%` : '—'}
              </span>
            </div>
          </div>
        )}

        {/* Water Overview KPIs */}
        {/* Water Overview KPIs */}
        {activeMode === 'water' && envData && (
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Availability Index</span>
              <span className="kpi-value info">{envData.water.availability_index}/100</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Surface Water</span>
              <span className="kpi-value">{envData.water.surface_water_pct}%</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Mean NDWI</span>
              <span className="kpi-value info">{envData.water.mean_ndwi != null ? envData.water.mean_ndwi : '—'}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Water Stress</span>
              <span className="kpi-value warning">{envData.water.water_stress_index}/100</span>
            </div>
          </div>
        )}

        {/* Vegetation Overview KPIs */}
        {activeMode === 'vegetation' && envData && (
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Veg Health</span>
              <span className="kpi-value success">{envData.vegetation.vegetation_health}/100</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Green Cover</span>
              <span className="kpi-value">{envData.vegetation.green_cover_pct}%</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Mean NDVI</span>
              <span className="kpi-value">{envData.vegetation.ndvi != null ? envData.vegetation.ndvi : '—'}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Tree Canopy</span>
              <span className="kpi-value success">{envData.vegetation.tree_density_index}%</span>
            </div>
          </div>
        )}

        {/* Dynamic Legend */}
        <div className="legend">
          <h4>
            {activeMode === 'heat' && 'Air Temperature Scale'}
            {activeMode === 'vegetation' && 'Vegetation Health Scale'}
            {activeMode === 'water' && 'Water Availability Scale'}
          </h4>

          {activeMode === 'heat' && (
            <div className="legend-items">
              <div className="legend-item"><span className="color-box" style={{ background: '#c0271f' }}></span> 40°C+ · Extreme</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f0555a' }}></span> 35–39°C · High</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f0803a' }}></span> 30–34°C · Warm</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f5a542' }}></span> 25–29°C · Mild</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f5d264' }}></span> &lt;25°C · Cool</div>
            </div>
          )}

          {activeMode === 'vegetation' && (
            <div className="legend-items">
              <div className="legend-item"><span className="color-box" style={{ background: '#dcfce7' }}></span> 0–24 · Sparse</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#86efac' }}></span> 25–49 · Light</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#22c55e' }}></span> 50–74 · Moderate</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#15803d' }}></span> 75–100 · Dense</div>
            </div>
          )}

          {activeMode === 'water' && (
            <div className="legend-items">
              <div className="legend-item"><span className="color-box" style={{ background: '#bfdbfe' }}></span> 0–24 · Very Low</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#60a5fa' }}></span> 25–49 · Low</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#3b82f6' }}></span> 50–74 · Moderate</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#1e40af' }}></span> 75–100 · High</div>
            </div>
          )}
        </div>

        {/* Dataset Note / Attribution */}
        {activeMode === 'heat' && (
          <div className="data-note">
            🔥 <strong>Open-Meteo Live Weather API</strong> (NWP Blend)
            {weatherData?.observation_time ? ` · Timestep: ${weatherData.observation_time.replace('T', ' ')} IST` : ''}
            {weatherData?.is_stale && ' · Cached Observation'}
          </div>
        )}
        {activeMode === 'water' && (
          <div className="data-note">
            💧 <strong>PostgreSQL / PostGIS Sentinel-2 NDWI</strong>
            {envData?.water?.valid_pixels ? ` · ${envData.water.valid_pixels.toLocaleString()} pixels` : ''}
            {envData?.status === 'partial_data' && ' · Partial Coverage'}
          </div>
        )}
        {activeMode === 'vegetation' && (
          <div className="data-note">
            🌳 <strong>PostgreSQL / PostGIS Sentinel-2 NDVI & ESA Land Cover</strong>
            {envData?.vegetation?.valid_pixels ? ` · ${envData.vegetation.valid_pixels.toLocaleString()} pixels` : ''}
            {envData?.status === 'partial_data' && ' · Partial Coverage'}
          </div>
        )}
      </div>

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
    </div>
  );
}
