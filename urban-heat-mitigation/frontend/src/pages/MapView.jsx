import { useState, useEffect, useMemo } from 'react';
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

// Reliable MapLibre Raster Styles (OSM, Carto Dark, Esri Satellite)
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

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community'
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

function getHeatScoreColor(score) {
  if (score >= 80) return [192, 39, 31];
  if (score >= 62) return [240, 85, 90];
  if (score >= 46) return [240, 128, 58];
  if (score >= 30) return [245, 165, 66];
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
  const [overview, setOverview] = useState(null);
  const [envData, setEnvData] = useState(null);
  const [allEnvData, setAllEnvData] = useState(null);
  const [validation, setValidation] = useState(null);

  // Loading & Error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state
  const [showLstInfo, setShowLstInfo] = useState(false);

  // Fetch data for selected city & India overview
  useEffect(() => {
    if (!city) return;

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [overviewRes, envRes, allEnvRes, valRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/overview?city=${city}`).catch(() => null),
          fetch(`${API_BASE}/api/v1/environment?city=${city}`).catch(() => null),
          fetch(`${API_BASE}/api/v1/environment/all`).catch(() => null),
          fetch(`${API_BASE}/api/v1/validation?city=${city}`).catch(() => null),
        ]);

        if (cancelled) return;

        if (overviewRes && overviewRes.ok) {
          const data = await overviewRes.json();
          setOverview(data);
        }

        if (envRes && envRes.ok) {
          const data = await envRes.json();
          setEnvData(data);
        }

        if (allEnvRes && allEnvRes.ok) {
          const data = await allEnvRes.json();
          setAllEnvData(data.cities || {});
        }

        if (valRes && valRes.ok) {
          const data = await valRes.json();
          setValidation(data);
        } else {
          setValidation(null);
        }

        if (!overviewRes?.ok) {
          setError('Could not load Heat Map data for this city.');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load Heat Map data:', err);
          setError('Could not connect to backend server.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [city]);

  // Initial camera view focused on India map overview
  const initialViewState = useMemo(() => {
    return {
      longitude: 78.9629,
      latitude: 22.5937,
      zoom: 4.6,
      pitch: 0,
      bearing: 0
    };
  }, []);

  // Cities list for overview markers & search
  const citiesList = useMemo(() => {
    if (allEnvData) {
      return Object.values(allEnvData);
    }
    return cities.map(c => ({
      id: c.id,
      name: c.name,
      state: c.state,
      country: c.country,
      lat: c.center ? c.center[1] : 28.61,
      lon: c.center ? c.center[0] : 77.20,
      heat_score: 65,
      water: { availability_index: 50 },
      vegetation: { vegetation_health: 50 },
    }));
  }, [allEnvData, cities]);

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
              const s = d.heat_score ?? 65;
              return getHeatScoreColor(s);
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

  // Basemap style selection
  const activeMapStyle = useMemo(() => {
    if (mapType === 'satellite') return SATELLITE_STYLE;
    return theme === 'dark' ? OSM_DARK_STYLE : OSM_STYLE;
  }, [mapType, theme]);

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
        const temp = c.air_temp_baseline;
        return temp ? `${c.name} · ${temp}°C` : `${c.name} · Score ${c.heat_score}`;
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
            <ServerWakingNotice compact />
          </div>
        )}

        {!loading && error && (
          <div className="loading-overlay">
            <p>{error}</p>
          </div>
        )}

        <DeckGL
          key={`heat-map-india-${mapType}-${theme}`}
          initialViewState={initialViewState}
          controller={true}
          layers={layers}
          getTooltip={({ object }) => {
            if (!object) return null;
            const w = object.water?.availability_index ?? '—';
            const v = object.vegetation?.vegetation_health ?? '—';
            return `${object.name}, ${object.state}
Air Temp Baseline: ${object.air_temp_baseline}°C
Water Index: ${w}/100
Green Health: ${v}/100`;
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
              {activeMode === 'heat' && '🔥 Heat Intensity'}
              {activeMode === 'vegetation' && '🌳 Vegetation Health'}
              {activeMode === 'water' && '💧 Water Availability'}
            </span>
          </div>
          <span className="badge">{cityInfo?.season_label || 'Apr–Jun 2026'}</span>
        </div>

        {/* Heat Overview KPIs */}
        {activeMode === 'heat' && overview && (
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Mean LST</span>
              <span className="kpi-value">{overview.mean_lst_c.toFixed(1)}°C</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Max LST</span>
              <span className="kpi-value danger">{overview.max_lst_c.toFixed(1)}°C</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Hotspot Area</span>
              <span className="kpi-value warning">{overview.hotspot_area_km2.toFixed(1)} km²</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">UHI Intensity</span>
              <span className="kpi-value">+{overview.uhi_intensity_c.toFixed(1)}°C</span>
            </div>
          </div>
        )}

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
              <span className="kpi-label">Nearest Water Body</span>
              <span className="kpi-value">{envData.water.proximity_km} km</span>
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
              <span className="kpi-value">{envData.vegetation.ndvi}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Tree Density</span>
              <span className="kpi-value success">{envData.vegetation.tree_density_index}/100</span>
            </div>
          </div>
        )}

        {/* Dynamic Legend */}
        <div className="legend">
          <h4>
            {activeMode === 'heat' && 'Heat Intensity Scale'}
            {activeMode === 'vegetation' && 'Vegetation Health Scale'}
            {activeMode === 'water' && 'Water Availability Scale'}
          </h4>

          {activeMode === 'heat' && (
            <div className="legend-items">
              <div className="legend-item"><span className="color-box" style={{ background: '#c0271f' }}></span> 80+ · Extreme</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f0555a' }}></span> 62–79 · High</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f0803a' }}></span> 46–61 · Moderate</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f5a542' }}></span> 30–45 · Warm</div>
              <div className="legend-item"><span className="color-box" style={{ background: '#f5d264' }}></span> &lt;30 · Milder</div>
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

        {/* Dataset Note / Validation Badge */}
        {activeMode === 'heat' && <ValidationBadge validation={validation} />}
        {activeMode === 'water' && (
          <div className="data-note">
            💧 Illustrative hydrology dataset (mock values adapted for 20 cities)
          </div>
        )}
        {activeMode === 'vegetation' && (
          <div className="data-note">
            🌳 Illustrative vegetation dataset (mock values adapted for 20 cities)
          </div>
        )}
      </div>

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
    </div>
  );
}
