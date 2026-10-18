import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  ArrowLeftRight,
  Search,
  X,
  RotateCw,
  Download,
  Thermometer,
  Droplets,
  CloudRain,
  Wind,
  Trees,
  Building2,
  Sparkles,
  Info,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Database,
  Radio,
} from 'lucide-react';
import { API_BASE } from '../api';
import { useTheme } from '../ThemeContext';
import './CityComparison.css';

// Distinct palette for all 20 comparison cities
const CITY_COLORS = [
  '#3b82f6', // Blue
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#8b5cf6', // Violet
  '#f43f5e', // Rose
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#d97706', // Warm Amber
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#a855f7', // Purple
  '#e11d48', // Crimson
  '#22c55e', // Green
  '#0284c7', // Sky Blue
  '#eab308', // Yellow
  '#78716c', // Stone
  '#4f46e5', // Deep Indigo
  '#059669', // Deep Emerald
];

export default function CityComparison({ cities = [], onSelectCity }) {
  const { theme } = useTheme();

  // Total available cities from registry
  const totalCitiesCount = cities.length || 20;

  // Selected cities: default to Delhi ('new_delhi') and Mumbai ('mumbai')
  const [selectedCityIds, setSelectedCityIds] = useState(['new_delhi', 'mumbai']);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Active view tabs
  const [weatherMetric, setWeatherMetric] = useState('temperature'); // 'temperature' | 'humidity' | 'precipitation' | 'wind'
  const [envMetricView, setEnvMetricView] = useState('indices'); // 'indices' | 'landcover'

  // Data states
  const [comparisonData, setComparisonData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch comparison data from backend
  useEffect(() => {
    if (selectedCityIds.length < 2) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchComparison = async () => {
      try {
        const queryParam = encodeURIComponent(selectedCityIds.join(','));
        const isForceRefresh = refreshKey > 0;
        const res = await fetch(
          `${API_BASE}/api/v1/comparison?cities=${queryParam}${isForceRefresh ? '&refresh=true' : ''}`
        );

        if (cancelled) return;

        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json.cities) {
            setComparisonData(json.cities);
            setLastUpdated(json.timestamp || new Date().toISOString());
          }
        } else {
          // If combined endpoint returns an error, fallback to parallel fetching
          const fallbackResults = await Promise.all(
            selectedCityIds.map(async (cid) => {
              const [wRes, eRes] = await Promise.all([
                fetch(`${API_BASE}/api/v1/weather?city=${cid}`).catch(() => null),
                fetch(`${API_BASE}/api/v1/environment?city=${cid}`).catch(() => null),
              ]);
              const weather = wRes && wRes.ok ? await wRes.json() : null;
              const environment = eRes && eRes.ok ? await eRes.json() : null;
              const cityMeta = cities.find((c) => c.id === cid) || {};
              return {
                city_id: cid,
                name: cityMeta.name || cid,
                state: cityMeta.state || '',
                country: cityMeta.country || 'India',
                lat: cityMeta.center ? cityMeta.center[1] : 0,
                lon: cityMeta.center ? cityMeta.center[0] : 0,
                coastal: !!cityMeta.coastal,
                season_label: cityMeta.season_label || '2026',
                weather: weather || { status: 'unavailable', current_temp_c: null },
                environment: environment || { status: 'unavailable' },
              };
            })
          );
          if (!cancelled) {
            setComparisonData(fallbackResults);
            setLastUpdated(new Date().toISOString());
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch city comparison data:', err);
          setError('Failed to load city comparison data. Please verify your connection.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    fetchComparison();

    return () => {
      cancelled = true;
    };
  }, [selectedCityIds, refreshKey, cities]);

  // Handle city addition
  const handleAddCity = (cityId) => {
    // Use functional state update to avoid stale closure issues and enforce limits safely
    setSelectedCityIds((prev) => {
      if (prev.includes(cityId)) return prev;
      return [...prev, cityId];
    });
    setSearchQuery('');
    setSearchOpen(false);
  };

  // Handle adding all supported cities (up to 20 cities simultaneously)
  const handleAddAllCities = () => {
    if (cities.length > 0) {
      setSelectedCityIds(cities.map((c) => c.id));
    }
    setSearchQuery('');
    setSearchOpen(false);
  };

  // Handle city removal
  const handleRemoveCity = (cityId) => {
    if (selectedCityIds.length <= 2) return; // Keep minimum 2 cities
    setSelectedCityIds(selectedCityIds.filter((id) => id !== cityId));
  };

  // Reset to default selection
  const handleReset = () => {
    setSelectedCityIds(['new_delhi', 'mumbai']);
    setSearchQuery('');
    setSearchOpen(false);
  };

  // Force refresh
  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  };

  // Filter available cities for adding
  const availableCities = useMemo(() => {
    return cities.filter((c) => {
      if (selectedCityIds.includes(c.id)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.state && c.state.toLowerCase().includes(q))
      );
    });
  }, [cities, selectedCityIds, searchQuery]);

  // CSV Export handler
  const handleExportCSV = () => {
    if (!comparisonData || comparisonData.length === 0) return;

    const headers = [
      'City',
      'State',
      'Country',
      'Latitude',
      'Longitude',
      'Coastal',
      'Live Weather Source',
      'Weather Observation Time',
      'Current Temp (°C)',
      'Today Max Temp (°C)',
      'Today Min Temp (°C)',
      'Humidity (%)',
      'Current Precipitation (mm)',
      'Today Precipitation Sum (mm)',
      'Wind Speed (km/h)',
      'Weather Condition',
      'Environmental Data Source',
      'Raster Analysis Period',
      'Mean LST (°C)',
      'Min LST (°C)',
      'Max LST (°C)',
      'Valid LST Pixels',
      'Mean NDVI',
      'Green Cover (%)',
      'Tree Cover (%)',
      'Mean NDWI',
      'Surface Water (%)',
      'Mean NDBI',
      'Built-up (%)',
      'Derived Heat Vulnerability Score (0-100)',
    ];

    const rows = comparisonData.map((item) => {
      const w = item.weather || {};
      const env = item.environment || {};
      const veg = env.vegetation || {};
      const water = env.water || {};
      const heat = env.heat || {};
      const built = env.built_up || {};
      const lc = env.landcover || {};

      // Derived vulnerability score calculation
      let vulScore = 'N/A';
      if (heat.mean_lst_c != null && veg.mean_ndvi != null && built.mean_ndbi != null) {
        const normLst = Math.min(1, Math.max(0, (heat.mean_lst_c - 20) / 25));
        const normBuilt = Math.min(1, Math.max(0, (built.mean_ndbi + 0.3) / 0.8));
        const normVegDeficit = Math.min(1, Math.max(0, (0.7 - veg.mean_ndvi) / 0.7));
        vulScore = Math.round((normLst * 0.4 + normBuilt * 0.35 + normVegDeficit * 0.25) * 100);
      }

      return [
        `"${item.name || ''}"`,
        `"${item.state || ''}"`,
        `"${item.country || 'India'}"`,
        item.lat ?? '',
        item.lon ?? '',
        item.coastal ? 'Yes' : 'No',
        `"${w.data_source || 'Open-Meteo Live Weather API'}"`,
        `"${w.observation_time || ''}"`,
        w.current_temp_c ?? 'N/A',
        w.today_max_c ?? 'N/A',
        w.today_min_c ?? 'N/A',
        w.humidity_pct ?? 'N/A',
        w.precipitation_mm ?? '0.0',
        w.today_precipitation_sum_mm ?? 'N/A',
        w.wind_speed_kmh ?? 'N/A',
        `"${w.weather_description || 'N/A'}"`,
        `"${env.data_source || 'PostgreSQL / PostGIS (table: city_rasters)'}"`,
        `"${item.season_label || heat.observation_period || 'Apr–Jun 2026'}"`,
        heat.mean_lst_c ?? 'N/A',
        heat.min_lst_c ?? 'N/A',
        heat.max_lst_c ?? 'N/A',
        heat.valid_pixels ?? 'N/A',
        veg.ndvi ?? veg.mean_ndvi ?? 'N/A',
        veg.green_cover_pct ?? lc.green_cover_pct ?? 'N/A',
        lc.tree_cover_pct ?? 'N/A',
        water.mean_ndwi ?? 'N/A',
        water.surface_water_pct ?? lc.surface_water_pct ?? 'N/A',
        built.mean_ndbi ?? 'N/A',
        built.built_up_pct ?? lc.built_up_pct ?? 'N/A',
        vulScore,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `city_comparison_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Weather chart data transformation
  const weatherChartData = useMemo(() => {
    return comparisonData.map((item, idx) => {
      const w = item.weather || {};
      return {
        city: item.name,
        cityId: item.city_id,
        color: CITY_COLORS[idx % CITY_COLORS.length],
        currentTemp: w.current_temp_c != null ? Number(w.current_temp_c) : null,
        maxTemp: w.today_max_c != null ? Number(w.today_max_c) : null,
        minTemp: w.today_min_c != null ? Number(w.today_min_c) : null,
        apparentTemp: w.apparent_temp_c != null ? Number(w.apparent_temp_c) : null,
        humidity: w.humidity_pct != null ? Number(w.humidity_pct) : null,
        precipitation: w.precipitation_mm != null ? Number(w.precipitation_mm) : 0,
        precipSum: w.today_precipitation_sum_mm != null ? Number(w.today_precipitation_sum_mm) : 0,
        windSpeed: w.wind_speed_kmh != null ? Number(w.wind_speed_kmh) : null,
        condition: w.weather_description || 'N/A',
        obsTime: w.observation_time || 'Recent',
      };
    });
  }, [comparisonData]);

  // Environmental chart data transformation
  const envChartData = useMemo(() => {
    return comparisonData.map((item, idx) => {
      const env = item.environment || {};
      const veg = env.vegetation || {};
      const water = env.water || {};
      const built = env.built_up || {};
      const heat = env.heat || {};
      const lc = env.landcover || {};

      return {
        city: item.name,
        cityId: item.city_id,
        color: CITY_COLORS[idx % CITY_COLORS.length],
        meanLst: heat.mean_lst_c != null ? Number(heat.mean_lst_c) : null,
        ndvi: veg.ndvi != null ? Number(veg.ndvi) : (veg.mean_ndvi != null ? Number(veg.mean_ndvi) : null),
        ndwi: water.mean_ndwi != null ? Number(water.mean_ndwi) : null,
        ndbi: built.mean_ndbi != null ? Number(built.mean_ndbi) : null,
        greenCoverPct: veg.green_cover_pct != null ? Number(veg.green_cover_pct) : (lc.green_cover_pct != null ? Number(lc.green_cover_pct) : null),
        builtUpPct: built.built_up_pct != null ? Number(built.built_up_pct) : (lc.built_up_pct != null ? Number(lc.built_up_pct) : null),
        waterPct: water.surface_water_pct != null ? Number(water.surface_water_pct) : (lc.surface_water_pct != null ? Number(lc.surface_water_pct) : null),
      };
    });
  }, [comparisonData]);

  // Dynamic Insights calculation
  const insights = useMemo(() => {
    if (!comparisonData || comparisonData.length < 2) return null;

    let highestTempCity = null;
    let lowestTempCity = null;
    let highestHumidityCity = null;
    let highestNdviCity = null;
    let highestNdbiCity = null;
    let highestWaterCity = null;

    comparisonData.forEach((item) => {
      const w = item.weather || {};
      const env = item.environment || {};
      const veg = env.vegetation || {};
      const built = env.built_up || {};
      const water = env.water || {};

      const currentTemp = w.current_temp_c;
      if (currentTemp != null) {
        if (!highestTempCity || currentTemp > highestTempCity.val) {
          highestTempCity = { name: item.name, val: currentTemp };
        }
        if (!lowestTempCity || currentTemp < lowestTempCity.val) {
          lowestTempCity = { name: item.name, val: currentTemp };
        }
      }

      const hum = w.humidity_pct;
      if (hum != null) {
        if (!highestHumidityCity || hum > highestHumidityCity.val) {
          highestHumidityCity = { name: item.name, val: hum };
        }
      }

      const ndvi = veg.ndvi != null ? veg.ndvi : veg.mean_ndvi;
      if (ndvi != null) {
        if (!highestNdviCity || ndvi > highestNdviCity.val) {
          highestNdviCity = { name: item.name, val: ndvi };
        }
      }

      const ndbi = built.mean_ndbi;
      if (ndbi != null) {
        if (!highestNdbiCity || ndbi > highestNdbiCity.val) {
          highestNdbiCity = { name: item.name, val: ndbi };
        }
      }

      const waterPct = water.surface_water_pct;
      if (waterPct != null) {
        if (!highestWaterCity || waterPct > highestWaterCity.val) {
          highestWaterCity = { name: item.name, val: waterPct };
        }
      }
    });

    // Formulate a dynamic analytical synthesis text
    let narrative = '';
    if (highestTempCity && lowestTempCity && highestTempCity.name !== lowestTempCity.name) {
      narrative += `${highestTempCity.name} currently experiences the warmest air temperature (${highestTempCity.val}°C) among selected cities, while ${lowestTempCity.name} is the mildest (${lowestTempCity.val}°C). `;
    }
    if (highestHumidityCity) {
      narrative += `${highestHumidityCity.name} records the highest atmospheric moisture at ${highestHumidityCity.val}% relative humidity. `;
    }
    if (highestNdviCity && highestNdbiCity) {
      narrative += `In satellite environmental indices, ${highestNdviCity.name} exhibits the densest vegetative coverage (NDVI ${highestNdviCity.val.toFixed(2)}), whereas ${highestNdbiCity.name} has the highest built-up density (NDBI ${highestNdbiCity.val.toFixed(2)}).`;
    }

    return {
      highestTempCity,
      lowestTempCity,
      highestHumidityCity,
      highestNdviCity,
      highestNdbiCity,
      highestWaterCity,
      narrative,
    };
  }, [comparisonData]);

  // Theme-aware styles for charts
  const chartThemeStyles = useMemo(() => {
    const isLight = theme === 'light';
    return {
      gridStroke: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)',
      textColor: isLight ? '#4b5563' : '#94a3b8',
      tooltipBg: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(19, 22, 28, 0.96)',
      tooltipBorder: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.12)',
      tooltipText: isLight ? '#1f2937' : '#f8fafc',
    };
  }, [theme]);

  // Dynamic sizing based on number of selected cities (2 to 20)
  const isLargeCitySet = comparisonData.length > 6;
  const isVeryLargeCitySet = comparisonData.length > 12;
  const chartHeight = comparisonData.length > 10 ? 380 : 320;
  const envChartHeight = comparisonData.length > 10 ? 400 : 340;
  const groupedBarSize = isVeryLargeCitySet ? 7 : (isLargeCitySet ? 12 : 24);
  const singleBarSize = isVeryLargeCitySet ? 14 : (isLargeCitySet ? 22 : 36);

  const xAxisProps = {
    dataKey: 'city',
    tick: {
      fill: chartThemeStyles.textColor,
      fontSize: isVeryLargeCitySet ? 10 : (isLargeCitySet ? 11 : 13),
    },
    angle: isLargeCitySet ? -35 : 0,
    textAnchor: isLargeCitySet ? 'end' : 'middle',
    interval: 0,
    height: isLargeCitySet ? 60 : 30,
    axisLine: false,
    tickLine: false,
  };

  return (
    <div className="page-container animate-fade-in city-comparison-page">
      <div className="page-content">
        {/* ─── Header Section ───────────────────────────────────── */}
        <div className="comparison-header-wrap">
          <div className="page-header">
            <div className="title-row">
              <div className="icon-badge">
                <ArrowLeftRight size={22} className="header-icon" />
              </div>
              <div>
                <h1>City Comparison</h1>
                <p>Compare live weather and environmental indicators across Indian cities</p>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <div className="city-count-pill">
              <span className="count-number">{selectedCityIds.length}</span> / {totalCitiesCount} Cities
            </div>

            {lastUpdated && (
              <span className="last-updated-text" title={`Updated: ${lastUpdated}`}>
                Observed: {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}

            <button
              className={`action-btn-secondary ${refreshing ? 'spinning' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh live weather observations"
            >
              <RotateCw size={15} />
              <span>Refresh</span>
            </button>

            <button
              className="action-btn-primary"
              onClick={handleExportCSV}
              disabled={loading || comparisonData.length === 0}
              title="Download comparison dataset as CSV"
            >
              <Download size={15} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* ─── City Selection & Chips Bar ────────────────────────── */}
        <div className="selection-card glass-panel">
          <div className="selection-bar">
            <div className="chips-container">
              <span className="selection-label">Comparing:</span>
              {selectedCityIds.map((cid, idx) => {
                const cMeta = cities.find((c) => c.id === cid) || { name: cid };
                const color = CITY_COLORS[idx % CITY_COLORS.length];
                const canRemove = selectedCityIds.length > 2;

                return (
                  <div
                    key={cid}
                    className="city-chip"
                    style={{ borderLeftColor: color }}
                  >
                    <span className="chip-color-dot" style={{ backgroundColor: color }} />
                    <span className="chip-name">{cMeta.name}</span>
                    {cMeta.state && <span className="chip-state">{cMeta.state}</span>}
                    <button
                      className="chip-remove"
                      onClick={() => handleRemoveCity(cid)}
                      disabled={!canRemove}
                      title={canRemove ? `Remove ${cMeta.name}` : 'At least 2 cities required for comparison'}
                      aria-label={`Remove ${cMeta.name}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="selection-controls">
              {/* Search & Add Dropdown */}
              <div className="search-dropdown-wrap">
                <div className="search-input-box">
                  <Search size={15} className="search-icon" />
                  <input
                    type="text"
                    placeholder={
                      selectedCityIds.length >= totalCitiesCount
                        ? 'All cities selected'
                        : 'Search city to add...'
                    }
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    disabled={selectedCityIds.length >= totalCitiesCount}
                  />
                  {searchQuery && (
                    <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
                      <X size={13} />
                    </button>
                  )}
                </div>

                {searchOpen && availableCities.length > 0 && selectedCityIds.length < totalCitiesCount && (
                  <div className="search-dropdown glass-panel">
                    <div className="dropdown-header">Available Cities ({availableCities.length})</div>
                    <div className="dropdown-list">
                      {availableCities.map((city) => (
                        <button
                          key={city.id}
                          className="dropdown-item"
                          onMouseDown={(e) => { e.preventDefault(); handleAddCity(city.id); }}
                        >
                          <span className="city-title">{city.name}</span>
                          <span className="city-sub">{city.state}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedCityIds.length < totalCitiesCount && (
                <button
                  className="action-btn-secondary btn-sm"
                  onClick={handleAddAllCities}
                  title="Compare all 20 cities simultaneously"
                >
                  Compare All ({totalCitiesCount})
                </button>
              )}

              {selectedCityIds.length !== 2 && (
                <button className="reset-btn" onClick={handleReset} title="Reset to Delhi and Mumbai">
                  Reset (2)
                </button>
              )}
            </div>
          </div>

          {selectedCityIds.length <= 2 && (
            <div className="selection-hint">
              <Info size={13} />
              <span>Select between 2 and {totalCitiesCount} cities to compare weather and environmental patterns.</span>
            </div>
          )}
        </div>

        {/* ─── Error Alert ──────────────────────────────────────── */}
        {error && (
          <div className="alert-card glass-panel error">
            <AlertTriangle size={18} />
            <div className="alert-body">
              <strong>Error Loading Comparison</strong>
              <p>{error}</p>
            </div>
            <button className="action-btn-secondary btn-sm" onClick={handleRefresh}>
              Retry
            </button>
          </div>
        )}

        {/* ─── Loading Skeleton ─────────────────────────────────── */}
        {loading && (
          <div className="loading-state glass-panel">
            <div className="loading-spinner" />
            <p>Loading multi-city weather and satellite environmental data...</p>
          </div>
        )}

        {/* ─── Main Comparison Content ──────────────────────────── */}
        {!loading && comparisonData.length > 0 && (
          <div className="comparison-sections">
            {/* 1. Dynamic Heat & Environmental Insights */}
            {insights && (
              <div className="insights-card glass-panel">
                <div className="section-header-row">
                  <div className="section-title-group">
                    <Sparkles size={18} className="section-icon text-accent" />
                    <h3>Comparative Heat & Environmental Insights</h3>
                  </div>
                  <span className="provenance-tag">Real-Time Synthesis</span>
                </div>

                <div className="insights-grid">
                  {insights.highestTempCity && (
                    <div className="insight-badge-card warm">
                      <div className="badge-icon">
                        <Thermometer size={16} />
                      </div>
                      <div className="badge-content">
                        <span className="badge-label">Highest Air Temp</span>
                        <strong className="badge-val">{insights.highestTempCity.name}</strong>
                        <span className="badge-sub">{insights.highestTempCity.val} °C</span>
                      </div>
                    </div>
                  )}

                  {insights.lowestTempCity && (
                    <div className="insight-badge-card cool">
                      <div className="badge-icon">
                        <Thermometer size={16} />
                      </div>
                      <div className="badge-content">
                        <span className="badge-label">Lowest Air Temp</span>
                        <strong className="badge-val">{insights.lowestTempCity.name}</strong>
                        <span className="badge-sub">{insights.lowestTempCity.val} °C</span>
                      </div>
                    </div>
                  )}

                  {insights.highestHumidityCity && (
                    <div className="insight-badge-card moisture">
                      <div className="badge-icon">
                        <Droplets size={16} />
                      </div>
                      <div className="badge-content">
                        <span className="badge-label">Highest Humidity</span>
                        <strong className="badge-val">{insights.highestHumidityCity.name}</strong>
                        <span className="badge-sub">{insights.highestHumidityCity.val} %</span>
                      </div>
                    </div>
                  )}

                  {insights.highestNdviCity && (
                    <div className="insight-badge-card veg">
                      <div className="badge-icon">
                        <Trees size={16} />
                      </div>
                      <div className="badge-content">
                        <span className="badge-label">Dense Vegetation</span>
                        <strong className="badge-val">{insights.highestNdviCity.name}</strong>
                        <span className="badge-sub">NDVI {insights.highestNdviCity.val.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {insights.highestNdbiCity && (
                    <div className="insight-badge-card built">
                      <div className="badge-icon">
                        <Building2 size={16} />
                      </div>
                      <div className="badge-content">
                        <span className="badge-label">Built-Up Density</span>
                        <strong className="badge-val">{insights.highestNdbiCity.name}</strong>
                        <span className="badge-sub">NDBI {insights.highestNdbiCity.val.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {insights.narrative && (
                  <p className="insights-narrative">{insights.narrative}</p>
                )}
              </div>
            )}

            {/* 2. Live Meteorological Observations */}
            <div className="comparison-section glass-panel">
              <div className="section-header-row">
                <div className="section-title-group">
                  <Radio size={18} className="section-icon text-blue" />
                  <div>
                    <h3>Live Weather Comparison</h3>
                    <p className="section-subtitle">
                      Current air temperature, daily forecast range, humidity, precipitation, and wind
                    </p>
                  </div>
                </div>

                <div className="source-and-tabs">
                  <span className="provenance-tag weather-tag">
                    Open-Meteo · Live Weather
                  </span>

                  <div className="metric-toggle-group">
                    <button
                      className={`metric-tab ${weatherMetric === 'temperature' ? 'active' : ''}`}
                      onClick={() => setWeatherMetric('temperature')}
                    >
                      <Thermometer size={14} />
                      <span>Temperature</span>
                    </button>
                    <button
                      className={`metric-tab ${weatherMetric === 'humidity' ? 'active' : ''}`}
                      onClick={() => setWeatherMetric('humidity')}
                    >
                      <Droplets size={14} />
                      <span>Humidity</span>
                    </button>
                    <button
                      className={`metric-tab ${weatherMetric === 'precipitation' ? 'active' : ''}`}
                      onClick={() => setWeatherMetric('precipitation')}
                    >
                      <CloudRain size={14} />
                      <span>Precipitation</span>
                    </button>
                    <button
                      className={`metric-tab ${weatherMetric === 'wind' ? 'active' : ''}`}
                      onClick={() => setWeatherMetric('wind')}
                    >
                      <Wind size={14} />
                      <span>Wind Speed</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Live Weather City Cards Grid */}
              <div className="metric-cards-grid">
                {comparisonData.map((item, idx) => {
                  const w = item.weather || {};
                  const color = CITY_COLORS[idx % CITY_COLORS.length];

                  return (
                    <div
                      key={item.city_id}
                      className="metric-city-card"
                      style={{ borderTop: `3px solid ${color}` }}
                    >
                      <div className="city-card-header">
                        <div>
                          <strong className="city-card-name">{item.name}</strong>
                          <span className="city-card-state">{item.state}</span>
                        </div>
                        <span className="condition-pill">{w.weather_description || 'Clear'}</span>
                      </div>

                      <div className="city-card-metric-main">
                        {weatherMetric === 'temperature' && (
                          <>
                            <div className="primary-metric-val">
                              {w.current_temp_c != null ? `${w.current_temp_c}°C` : 'N/A'}
                            </div>
                            <div className="secondary-metric-details">
                              <span>Max: {w.today_max_c != null ? `${w.today_max_c}°C` : 'N/A'}</span>
                              <span>Min: {w.today_min_c != null ? `${w.today_min_c}°C` : 'N/A'}</span>
                            </div>
                          </>
                        )}

                        {weatherMetric === 'humidity' && (
                          <>
                            <div className="primary-metric-val">
                              {w.humidity_pct != null ? `${w.humidity_pct}%` : 'N/A'}
                            </div>
                            <div className="secondary-metric-details">
                              <span>Feels like: {w.apparent_temp_c != null ? `${w.apparent_temp_c}°C` : 'N/A'}</span>
                            </div>
                          </>
                        )}

                        {weatherMetric === 'precipitation' && (
                          <>
                            <div className="primary-metric-val">
                              {w.precipitation_mm != null ? `${w.precipitation_mm} mm` : '0.0 mm'}
                            </div>
                            <div className="secondary-metric-details">
                              <span>Today's Total: {w.today_precipitation_sum_mm != null ? `${w.today_precipitation_sum_mm} mm` : '0.0 mm'}</span>
                            </div>
                          </>
                        )}

                        {weatherMetric === 'wind' && (
                          <>
                            <div className="primary-metric-val">
                              {w.wind_speed_kmh != null ? `${w.wind_speed_kmh} km/h` : 'N/A'}
                            </div>
                            <div className="secondary-metric-details">
                              <span>Direction: 10m Wind Speed</span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="city-card-footer">
                        <span>Observed: {w.observation_time ? w.observation_time.replace('T', ' ') : 'Live'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Weather Comparison Chart */}
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={chartHeight}>
                  {weatherMetric === 'temperature' ? (
                    <BarChart data={weatherChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis
                        tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }}
                        unit="°C"
                        domain={['auto', 'auto']}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val, name) => [`${val} °C`, name]}
                      />
                      <Legend wrapperStyle={{ paddingTop: 10 }} />
                      <Bar dataKey="currentTemp" name="Current Temp" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="maxTemp" name="Today Max (Forecast)" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="minTemp" name="Today Min (Forecast)" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                    </BarChart>
                  ) : weatherMetric === 'humidity' ? (
                    <BarChart data={weatherChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }} unit="%" domain={[0, 100]} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val) => [`${val} %`, 'Relative Humidity']}
                      />
                      <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'High Comfort Threshold (60%)', fill: '#f59e0b', fontSize: 11 }} />
                      <Bar dataKey="humidity" name="Relative Humidity (%)" radius={[6, 6, 0, 0]} barSize={singleBarSize}>
                        {weatherChartData.map((entry, index) => (
                          <Cell key={`cell-hum-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  ) : weatherMetric === 'precipitation' ? (
                    <BarChart data={weatherChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }} unit="mm" axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val, name) => [`${val} mm`, name]}
                      />
                      <Legend wrapperStyle={{ paddingTop: 10 }} />
                      <Bar dataKey="precipitation" name="Current Precipitation (mm)" fill="#0284c7" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="precipSum" name="Today's Total Sum (mm)" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                    </BarChart>
                  ) : (
                    <BarChart data={weatherChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }} unit="km/h" axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val) => [`${val} km/h`, 'Wind Speed']}
                      />
                      <Bar dataKey="windSpeed" name="10m Wind Speed (km/h)" radius={[6, 6, 0, 0]} barSize={singleBarSize}>
                        {weatherChartData.map((entry, index) => (
                          <Cell key={`cell-wind-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3. Satellite-Derived Environmental Metrics */}
            <div className="comparison-section glass-panel">
              <div className="section-header-row">
                <div className="section-title-group">
                  <Database size={18} className="section-icon text-emerald" />
                  <div>
                    <h3>Environmental & Land Surface Dataset Comparison</h3>
                    <p className="section-subtitle">
                      PostgreSQL/PostGIS raster analysis · NDVI (Vegetation), NDWI (Water), NDBI (Built-up), & Land Cover
                    </p>
                  </div>
                </div>

                <div className="source-and-tabs">
                  <span className="provenance-tag env-tag">
                    PostgreSQL / PostGIS · Raster Dataset
                  </span>

                  <div className="metric-toggle-group">
                    <button
                      className={`metric-tab ${envMetricView === 'indices' ? 'active' : ''}`}
                      onClick={() => setEnvMetricView('indices')}
                    >
                      <Layers size={14} />
                      <span>Spectral Indices (NDVI / NDWI / NDBI)</span>
                    </button>
                    <button
                      className={`metric-tab ${envMetricView === 'landcover' ? 'active' : ''}`}
                      onClick={() => setEnvMetricView('landcover')}
                    >
                      <Trees size={14} />
                      <span>Land Cover (%)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Environmental Chart */}
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={envChartHeight}>
                  {envMetricView === 'indices' ? (
                    <BarChart data={envChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis
                        tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }}
                        domain={[-0.8, 0.8]}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val, name) => [typeof val === 'number' ? val.toFixed(3) : 'N/A', name]}
                      />
                      <Legend wrapperStyle={{ paddingTop: 10 }} />
                      <ReferenceLine y={0} stroke={chartThemeStyles.textColor} strokeWidth={1} />
                      <Bar dataKey="ndvi" name="NDVI (Vegetation Index)" fill="#16a34a" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="ndwi" name="NDWI (Water Index)" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="ndbi" name="NDBI (Built-Up Index)" fill="#ea580c" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                    </BarChart>
                  ) : (
                    <BarChart data={envChartData} margin={{ top: 20, right: 30, left: 10, bottom: isLargeCitySet ? 50 : 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartThemeStyles.gridStroke} vertical={false} />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: chartThemeStyles.textColor, fontSize: 12 }} unit="%" domain={[0, 100]} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartThemeStyles.tooltipBg,
                          borderColor: chartThemeStyles.tooltipBorder,
                          color: chartThemeStyles.tooltipText,
                          borderRadius: '8px',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                        formatter={(val, name) => [`${val != null ? val : 'N/A'}%`, name]}
                      />
                      <Legend wrapperStyle={{ paddingTop: 10 }} />
                      <Bar dataKey="greenCoverPct" name="Green Cover (%)" fill="#16a34a" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="builtUpPct" name="Built-Up Surface (%)" fill="#ea580c" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                      <Bar dataKey="waterPct" name="Surface Water (%)" fill="#0284c7" radius={[4, 4, 0, 0]} barSize={groupedBarSize} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>

              <div className="section-footer-note">
                <Info size={14} />
                <span>
                  Indices are normalized ratios [-1.0 to 1.0] derived from Sentinel-2 & Landsat-8 scenes (Apr–Jun 2026). Land cover distribution is computed from ESA WorldCover 10m high-resolution classification.
                </span>
              </div>
            </div>

            {/* 4. Complete City Comparison Table */}
            <div className="comparison-section glass-panel">
              <div className="section-header-row">
                <div className="section-title-group">
                  <Layers size={18} className="section-icon text-accent" />
                  <div>
                    <h3>Comprehensive Multi-Metric Comparison Table</h3>
                    <p className="section-subtitle">
                      Side-by-side verification of live meteorological observations and satellite raster indicators
                    </p>
                  </div>
                </div>
              </div>

              <div className="table-responsive">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">City</th>
                      <th colSpan="5" className="group-header weather-group">
                        Live Weather (Open-Meteo)
                      </th>
                      <th colSpan="7" className="group-header env-group">
                        Environmental Rasters (PostGIS / ESA)
                      </th>
                      <th className="group-header meta-group">Derived Score</th>
                    </tr>
                    <tr>
                      <th className="sticky-col">Name & State</th>
                      <th>Air Temp (°C)</th>
                      <th>Today Max / Min (°C)</th>
                      <th>Humidity (%)</th>
                      <th>Precip (mm)</th>
                      <th>Wind (km/h)</th>
                      <th>Mean LST (°C)</th>
                      <th>NDVI (Veg)</th>
                      <th>Green Cover</th>
                      <th>NDWI (Water)</th>
                      <th>Surface Water</th>
                      <th>NDBI (Built)</th>
                      <th>Built-up</th>
                      <th title="Derived relative planning indicator (0-100)">
                        Heat Vulnerability*
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.map((item, idx) => {
                      const w = item.weather || {};
                      const env = item.environment || {};
                      const veg = env.vegetation || {};
                      const water = env.water || {};
                      const built = env.built_up || {};
                      const heat = env.heat || {};
                      const lc = env.landcover || {};
                      const color = CITY_COLORS[idx % CITY_COLORS.length];

                      // Derived planning indicator
                      let vulScore = null;
                      if (heat.mean_lst_c != null && veg.mean_ndvi != null && built.mean_ndbi != null) {
                        const normLst = Math.min(1, Math.max(0, (heat.mean_lst_c - 20) / 25));
                        const normBuilt = Math.min(1, Math.max(0, (built.mean_ndbi + 0.3) / 0.8));
                        const normVegDeficit = Math.min(1, Math.max(0, (0.7 - veg.mean_ndvi) / 0.7));
                        vulScore = Math.round((normLst * 0.4 + normBuilt * 0.35 + normVegDeficit * 0.25) * 100);
                      }

                      return (
                        <tr key={item.city_id}>
                          <td className="sticky-col cell-city">
                            <span className="row-color-dot" style={{ backgroundColor: color }} />
                            <div>
                              <strong>{item.name}</strong>
                              <span className="cell-state">{item.state}</span>
                            </div>
                          </td>
                          <td className="cell-num">
                            {w.current_temp_c != null ? `${w.current_temp_c}°` : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num">
                            {w.today_max_c != null && w.today_min_c != null
                              ? `${w.today_max_c}° / ${w.today_min_c}°`
                              : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num">
                            {w.humidity_pct != null ? `${w.humidity_pct}%` : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num">
                            {w.precipitation_mm != null ? `${w.precipitation_mm}` : '0.0'}
                          </td>
                          <td className="cell-num">
                            {w.wind_speed_kmh != null ? `${w.wind_speed_kmh}` : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num font-medium">
                            {heat.mean_lst_c != null ? `${heat.mean_lst_c}°C` : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num text-emerald">
                            {veg.ndvi != null
                              ? Number(veg.ndvi).toFixed(3)
                              : (veg.mean_ndvi != null ? Number(veg.mean_ndvi).toFixed(3) : <span className="na-text">N/A</span>)}
                          </td>
                          <td className="cell-num">
                            {veg.green_cover_pct != null
                              ? `${veg.green_cover_pct}%`
                              : (lc.green_cover_pct != null ? `${lc.green_cover_pct}%` : <span className="na-text">N/A</span>)}
                          </td>
                          <td className="cell-num text-blue">
                            {water.mean_ndwi != null ? Number(water.mean_ndwi).toFixed(3) : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num">
                            {water.surface_water_pct != null
                              ? `${water.surface_water_pct}%`
                              : (lc.surface_water_pct != null ? `${lc.surface_water_pct}%` : <span className="na-text">N/A</span>)}
                          </td>
                          <td className="cell-num text-orange">
                            {built.mean_ndbi != null ? Number(built.mean_ndbi).toFixed(3) : <span className="na-text">N/A</span>}
                          </td>
                          <td className="cell-num">
                            {built.built_up_pct != null
                              ? `${built.built_up_pct}%`
                              : (lc.built_up_pct != null ? `${lc.built_up_pct}%` : <span className="na-text">N/A</span>)}
                          </td>
                          <td className="cell-num">
                            {vulScore != null ? (
                              <span className={`vul-pill ${vulScore >= 65 ? 'high' : vulScore >= 45 ? 'med' : 'low'}`}>
                                {vulScore} / 100
                              </span>
                            ) : (
                              <span className="na-text">N/A</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="table-footer-explanation">
                <p>
                  * <strong>Derived Heat Vulnerability Score:</strong> A transparent normalized planning indicator (0–100) combining surface thermal exposure (40%), built-up density (35%), and vegetation deficit (25%). Intended strictly for urban cooling intervention planning, not an official health warning.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
