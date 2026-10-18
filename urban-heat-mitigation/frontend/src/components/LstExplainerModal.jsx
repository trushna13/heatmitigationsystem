import { X, Thermometer, Sun, Wind } from 'lucide-react';
import './LstExplainerModal.css';

export default function LstExplainerModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="modal-icon">
          <Thermometer size={22} />
        </div>

        <h2>Understanding Temperatures on HeatShield AI</h2>
        <p className="modal-intro">
          This dashboard uses <strong>Live Air Temperature</strong> on the overview map and
          <strong> Satellite Land Surface Temperature (LST)</strong> in detailed thermal grid analysis.
          Here is how they differ and why readings may vary:
        </p>

        <div className="modal-compare">
          <div className="compare-card">
            <div className="compare-head">
              <Wind size={16} />
              <span>Live Air Temperature (Overview)</span>
            </div>
            <p>
              Air temperature at 2m height from Open-Meteo's high-resolution Numerical Weather Prediction (NWP) blend.
              Station providers (like Google Weather or MSN) report single point sensors (e.g., airport tarmac),
              which may differ by 1–3°C from regional spatial grid models.
            </p>
            <span className="compare-tag">Overview Map & Weather Cards</span>
          </div>

          <div className="compare-card">
            <div className="compare-head">
              <Sun size={16} />
              <span>Land Surface Temperature (LST)</span>
            </div>
            <p>
              The actual skin temperature of roads, rooftops, and bare ground measured from orbit by Landsat 8/9 satellites.
              Sunlit asphalt and rooftops often heat up 10–20°C hotter than the surrounding air.
            </p>
            <span className="compare-tag muted">Heat Grid & Scenarios</span>
          </div>
        </div>

        <p className="modal-footnote">
          Temperatures on the overview update live every 5 minutes from Open-Meteo's 15-minute assimilation timesteps.
          All daily highs and lows are local calendar date forecasts calculated in the <strong>Asia/Kolkata</strong> timezone.
        </p>
      </div>
    </div>
  );
}
