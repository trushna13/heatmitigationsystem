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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLstInfo, setShowLstInfo] = useState(false);
  const [validation, setValidation] = useState(null);

  useEffect(() => {
    if (!city) return;

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [gridRes, overviewRes, validationRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/grid?city=${city}`),
          fetch(`${API_BASE}/api/v1/overview?city=${city}`),
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

    fetchData();
    return () => { cancelled = true; };
  }, [city]);

  // Layers for 3D LST grid
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
        return Math.max(0, (d.properties.lst_mean - 35) * 100);
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
          getTooltip={({ object }) => object && (
            `Cell: ${object.properties.grid_id}
LST: ${object.properties.lst_mean.toFixed(1)}°C
Tier: ${object.properties.tier ? object.properties.tier.toUpperCase() : 'NORMAL'}
Vegetation: ${(object.properties.frac_vegetation * 100).toFixed(1)}%`
          )}
        >
          <Map mapStyle={activeMapStyle} />
        </DeckGL>
      </div>

      {/* 3D Grid KPI Overlay */}
      {overview && (
        <div className="kpi-overlay glass-panel">
          <div className="kpi-header">
            <div className="title-area">
              <h3>
                {overview.city}
                <button
                  className="info-trigger"
                  onClick={() => setShowLstInfo(true)}
                  aria-label="What does LST mean?"
                >
                  <Info size={12} />
                </button>
              </h3>
              <span className="mode-tag">🔥 3D Extruded LST Grid</span>
            </div>
            <span className="badge">{overview.analysis_period}</span>
          </div>

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

          <ValidationBadge validation={validation} />
        </div>
      )}

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
    </div>
  );
}
