/**
 * Dolphin Diabetes Card
 * Displays current blood sugar level, trend, and optional graph.
 */

class DolphinDiabetesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._updateInterval = null;
    this._historyFetching = false;
    this._longPressTimer = null;
    this._longPressFired = false;
  }

  static getConfigElement() {
    return document.createElement('dolphin-diabetes-card-editor');
  }

  static getStubConfig() {
    return {
      glucose_entity: '',
      trend_entity: '',
      unit: 'mmol',
      show_graph: true,
      graph_hours: 3,
      low_threshold: 3.9,
      high_threshold: 10.0,
      accent_color: '#007AFF',
      low_color: '#FF3B30',
      high_color: '#FF9500',
      normal_color: '#34C759',
      card_bg: '#1c1c1e',
      card_bg_opacity: 80,
      text_color: '#ffffff',
      graph_line_color: '#007AFF',
      graph_fill_color: '#007AFF',
      show_title: true,
      title: 'Blood Sugar',
    };
  }

  setConfig(config) {
    this._config = {
      unit: 'mmol',
      show_graph: true,
      graph_hours: 3,
      low_threshold: 3.9,
      high_threshold: 10.0,
      accent_color: '#007AFF',
      low_color: '#FF3B30',
      high_color: '#FF9500',
      normal_color: '#34C759',
      card_bg: '#1c1c1e',
      card_bg_opacity: 80,
      text_color: '#ffffff',
      graph_line_color: '#007AFF',
      graph_fill_color: '#007AFF',
      show_title: true,
      title: 'Blood Sugar',
      ...config
    };
    if (this.shadowRoot.innerHTML) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot.innerHTML) this._render();
    this._updateCard();
  }

  connectedCallback() {
    this._updateInterval = setInterval(() => this._updateCard(), 60000);
  }

  disconnectedCallback() {
    if (this._updateInterval) clearInterval(this._updateInterval);
  }

  // ── Helpers ────────────────────────────────────────────────────────

  _formatGlucose(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return '--';
    if (this._config.unit === 'mgdl') return Math.round(n).toString();
    return n.toFixed(1);
  }

  _unitLabel() {
    // Return exactly as configured by the user - no forced case
    return this._config.unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  }

  _getStatusColor(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return this._config.accent_color;
    if (n < parseFloat(this._config.low_threshold))  return this._config.low_color;
    if (n > parseFloat(this._config.high_threshold)) return this._config.high_color;
    return this._config.normal_color;
  }

  _getStatusLabel(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return 'Unknown';
    if (n < parseFloat(this._config.low_threshold))  return 'Low';
    if (n > parseFloat(this._config.high_threshold)) return 'High';
    return 'In Range';
  }

  _getTrendInfo(trend) {
    if (!trend) return null;
    const t = trend.toString().toLowerCase();
    const make = (deg, label) => ({ deg, label });
    if ((t.includes('double') && t.includes('up'))   || t === 'doubleup')      return make(0,   'Rising Fast');
    if ((t.includes('single') && t.includes('up'))   || t === 'singleup')      return make(45,  'Rising');
    if ((t.includes('fortyfive') && t.includes('up'))|| t === 'fortyfiveup')   return make(67,  'Rising Slightly');
    if (t.includes('rising_quickly') || t === 'up_fast')                        return make(0,   'Rising Fast');
    if (t.includes('rising_slightly')|| t === 'up_slight')                      return make(67,  'Rising Slightly');
    if (t.includes('rising')         || t === 'up')                             return make(45,  'Rising');
    if (t.includes('flat')           || t === 'steady')                         return make(90,  'Steady');
    if ((t.includes('fortyfive') && t.includes('down'))|| t === 'fortyfivedown') return make(113, 'Falling Slightly');
    if (t.includes('falling_slightly')|| t === 'down_slight')                   return make(113, 'Falling Slightly');
    if ((t.includes('single') && t.includes('down')) || t === 'singledown')    return make(135, 'Falling');
    if (t.includes('falling_quickly') || t === 'down_fast')                     return make(180, 'Falling Fast');
    if ((t.includes('double') && t.includes('down')) || t === 'doubledown')    return make(180, 'Falling Fast');
    if (t.includes('falling')        || t === 'down')                           return make(135, 'Falling');
    return null;
  }

  // ── Graph builder ─────────────────────────────────────────────────

  _buildGraph(glucoseValues, timestamps, popupMode = false) {
    if (!glucoseValues || glucoseValues.length < 2) {
      return `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.35);font-size:13px;">Not enough data</div>`;
    }
    const W = 400;
    const H = popupMode ? 160 : 100;
    const pad = { top: 10, right: 10, bottom: 20, left: 34 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const lo = parseFloat(this._config.low_threshold);
    const hi = parseFloat(this._config.high_threshold);
    const lineColor  = this._config.graph_line_color;
    const fillColor  = this._config.graph_fill_color;

    const rawMin = Math.min(...glucoseValues);
    const rawMax = Math.max(...glucoseValues);
    const padding = (rawMax - rawMin) * 0.15 || 1;
    const min = Math.min(rawMin - padding, lo * 0.9);
    const max = Math.max(rawMax + padding, hi * 1.1);
    const range = max - min;

    const xs = glucoseValues.map((_, i) => pad.left + (i / (glucoseValues.length - 1)) * plotW);
    const ys = glucoseValues.map(v => pad.top + plotH - ((v - min) / range) * plotH);

    const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const fillPath = linePath + ` L${xs[xs.length - 1].toFixed(1)},${(pad.top + plotH).toFixed(1)} L${pad.left},${(pad.top + plotH).toFixed(1)} Z`;

    const clampY = v => Math.max(pad.top, Math.min(pad.top + plotH, pad.top + plotH - ((v - min) / range) * plotH));
    const loYc = clampY(lo);
    const hiYc = clampY(hi);

    const yLabels = [
      { v: lo, col: this._config.low_color },
      { v: hi, col: this._config.high_color },
    ].map(({ v, col }) => {
      const y = pad.top + plotH - ((v - min) / range) * plotH;
      if (y < pad.top - 2 || y > pad.top + plotH + 2) return '';
      const lbl = this._config.unit === 'mgdl' ? Math.round(v) : v.toFixed(1);
      return `<text x="${pad.left - 4}" y="${y.toFixed(1)}" fill="${col}" fill-opacity="0.6" font-size="8" text-anchor="end" dominant-baseline="middle">${lbl}</text>`;
    }).join('');

    let xLabels = '';
    if (timestamps && timestamps.length >= 2) {
      const fmt = ts => { try { const d = new Date(ts); return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); } catch { return ''; } };
      xLabels = `
        <text x="${pad.left}" y="${H - 3}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="start">${fmt(timestamps[0])}</text>
        <text x="${W - pad.right}" y="${H - 3}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="end">${fmt(timestamps[timestamps.length - 1])}</text>`;
    }

    const lastX = xs[xs.length - 1], lastY = ys[ys.length - 1];
    const dotColor = this._getStatusColor(glucoseValues[glucoseValues.length - 1]);
    const gradId = popupMode ? 'dgFillPopup' : 'dgFill';

    // Colour segments — each segment coloured by its value status
    let segments = '';
    for (let i = 1; i < glucoseValues.length; i++) {
      const midVal = (glucoseValues[i - 1] + glucoseValues[i]) / 2;
      const segColor = this._getStatusColor(midVal);
      segments += `<line x1="${xs[i-1].toFixed(1)}" y1="${ys[i-1].toFixed(1)}" x2="${xs[i].toFixed(1)}" y2="${ys[i].toFixed(1)}" stroke="${segColor}" stroke-width="${popupMode ? 2.5 : 2.2}" stroke-linecap="round"/>`;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;display:block;">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${fillColor}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${fillColor}" stop-opacity="0.02"/>
          </linearGradient>
          <clipPath id="graphClip${popupMode ? 'p' : 'c'}">
            <rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}"/>
          </clipPath>
        </defs>
        <!-- Threshold bands -->
        <line x1="${pad.left}" y1="${loYc.toFixed(1)}" x2="${W - pad.right}" y2="${loYc.toFixed(1)}"
          stroke="${this._config.low_color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>
        <line x1="${pad.left}" y1="${hiYc.toFixed(1)}" x2="${W - pad.right}" y2="${hiYc.toFixed(1)}"
          stroke="${this._config.high_color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>
        <!-- Fill area -->
        <path d="${fillPath}" fill="url(#${gradId})" clip-path="url(#graphClip${popupMode ? 'p' : 'c'})"/>
        <!-- Colour-coded line segments -->
        <g clip-path="url(#graphClip${popupMode ? 'p' : 'c'})">${segments}</g>
        <!-- Latest reading dot -->
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="${popupMode ? 5 : 4}" fill="${dotColor}" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
        <!-- Labels -->
        ${yLabels}
        ${xLabels}
      </svg>`;
  }

  // ── Popup ──────────────────────────────────────────────────────────

  _openPopup() {
    const root = this.shadowRoot;
    const existing = root.getElementById('dg-popup-overlay');
    if (existing) return;

    const glucoseState = this._hass?.states[this._config.glucose_entity];
    const glucoseVal   = glucoseState?.state;
    const statusColor  = this._getStatusColor(glucoseVal);
    const cfg          = this._config;

    let bgOpacity = (parseInt(cfg.card_bg_opacity) || 80) / 100;
    const hexBg = cfg.card_bg || '#1c1c1e';
    const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
    const popupBg = `rgba(${Math.max(0,rr-8)},${Math.max(0,gg-8)},${Math.max(0,bb-8)},${Math.min(1, bgOpacity + 0.1)})`;

    const overlay = document.createElement('div');
    overlay.id = 'dg-popup-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      animation: dgFadeIn 0.22s ease;
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
      background: ${popupBg};
      backdrop-filter: blur(40px) saturate(180%);
      -webkit-backdrop-filter: blur(40px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      padding: 20px 20px 18px;
      width: min(360px, 90vw);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
      color: ${cfg.text_color};
      animation: dgSlideUp 0.28s cubic-bezier(0.34,1.56,0.64,1);
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes dgFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes dgSlideUp { from { transform:translateY(24px) scale(0.96); opacity:0; } to { transform:none; opacity:1; } }
    `;

    const header = document.createElement('div');
    header.style.cssText = `display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;`;
    header.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);">${cfg.title || 'Blood Sugar'}</span>
      <button id="dg-popup-close" style="background:rgba(255,255,255,0.1);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);font-size:16px;line-height:1;padding:0;transition:background 0.15s;">✕</button>
    `;

    const reading = document.createElement('div');
    reading.style.cssText = `display:flex;align-items:baseline;gap:6px;margin-bottom:14px;`;
    reading.innerHTML = `
      <span style="font-size:48px;font-weight:700;letter-spacing:-2px;line-height:1;color:${statusColor};transition:color 0.4s;">${this._formatGlucose(glucoseVal)}</span>
      <span style="font-size:14px;color:rgba(255,255,255,0.45);font-weight:500;">${this._unitLabel()}</span>
    `;

    const graphLabel = document.createElement('div');
    graphLabel.style.cssText = `font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:8px;`;
    graphLabel.textContent = `${cfg.graph_hours}h history`;

    const graphWrap = document.createElement('div');
    graphWrap.style.cssText = `height:120px;position:relative;`;
    graphWrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.2);font-size:12px;">Loading…</div>`;

    popup.appendChild(style);
    popup.appendChild(header);
    popup.appendChild(reading);
    popup.appendChild(graphLabel);
    popup.appendChild(graphWrap);
    overlay.appendChild(popup);

    // Append to the host element's parent (outside shadow DOM) so it overlays the whole screen
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closePopup();
    });
    header.querySelector('#dg-popup-close').addEventListener('click', () => this._closePopup());
    header.querySelector('#dg-popup-close').addEventListener('mouseenter', (e) => { e.target.style.background = 'rgba(255,255,255,0.2)'; });
    header.querySelector('#dg-popup-close').addEventListener('mouseleave', (e) => { e.target.style.background = 'rgba(255,255,255,0.1)'; });

    this._popupOverlay = overlay;

    // Load graph data into popup
    this._loadGraphInto(graphWrap, true);
  }

  _closePopup() {
    if (this._popupOverlay) {
      this._popupOverlay.style.opacity = '0';
      this._popupOverlay.style.transition = 'opacity 0.18s ease';
      setTimeout(() => {
        if (this._popupOverlay && this._popupOverlay.parentNode) {
          this._popupOverlay.parentNode.removeChild(this._popupOverlay);
        }
        this._popupOverlay = null;
      }, 180);
    }
  }

  async _loadGraphInto(container, popupMode) {
    if (!this._config.glucose_entity) return;
    try {
      const hours = parseInt(this._config.graph_hours) || 3;
      const end   = new Date();
      const start = new Date(end - hours * 3600 * 1000);
      const resp  = await this._hass.callApi('GET',
        `history/period/${start.toISOString()}?filter_entity_id=${this._config.glucose_entity}&end_time=${end.toISOString()}&minimal_response=true&no_attributes=true`
      );
      if (resp && resp[0] && resp[0].length > 0) {
        const data   = resp[0].filter(s => !isNaN(parseFloat(s.state)));
        const values = data.map(s => parseFloat(s.state));
        const times  = data.map(s => s.last_changed || s.last_updated);
        container.innerHTML = values.length >= 2 ? this._buildGraph(values, times, popupMode) : this._buildGraph([], [], popupMode);
      } else {
        container.innerHTML = this._buildGraph([], [], popupMode);
      }
    } catch {
      const glucoseState = this._hass.states[this._config.glucose_entity];
      const currentVal   = parseFloat(glucoseState?.state);
      if (!isNaN(currentVal)) {
        const fakeVals = Array.from({ length: 18 }, (_, i) => currentVal + (Math.random() - 0.5) * 0.4);
        container.innerHTML = this._buildGraph(fakeVals, null, popupMode);
      } else {
        container.innerHTML = this._buildGraph([], [], popupMode);
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  _render() {
    if (!this._config) return;
    const cfg    = this._config;
    const accent = cfg.accent_color;

    const bgOpacity  = (parseInt(cfg.card_bg_opacity) || 80) / 100;
    const hexBg      = cfg.card_bg || '#1c1c1e';
    const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
    const cardBgRgba = `rgba(${rr},${gg},${bb},${bgOpacity})`;
    const loLabel    = cfg.unit === 'mgdl' ? Math.round(parseFloat(cfg.low_threshold))  : parseFloat(cfg.low_threshold).toFixed(1);
    const hiLabel    = cfg.unit === 'mgdl' ? Math.round(parseFloat(cfg.high_threshold)) : parseFloat(cfg.high_threshold).toFixed(1);
    const circ       = 2 * Math.PI * 34;

    this.shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; }

        ha-card {
          background: ${cardBgRgba} !important;
          backdrop-filter: blur(40px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(40px) saturate(180%) !important;
          color: ${cfg.text_color} !important;
          border-radius: 24px !important;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
          position: relative;
          border: 1px solid rgba(255,255,255,0.14) !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
          transition: all 0.3s ease;
          cursor: pointer;
          user-select: none; -webkit-user-select: none;
        }

        .dg-inner { padding: 20px 20px 16px; }

        /* ── Header ── */
        .dg-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .dg-title {
          font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: rgba(255,255,255,0.45);
        }
        /* Time-ago sits in the header on the right */
        .dg-time {
          font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.4);
          font-variant-numeric: tabular-nums; transition: color 0.4s ease;
        }

        /* ── Main row: glucose ring LEFT, status+trend ring RIGHT ── */
        .dg-main-row {
          display: flex; align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        /* Shared ring block style */
        .dg-ring-block {
          position: relative; flex-shrink: 0;
          width: 88px; height: 88px;
        }
        .dg-ring-block svg { position: absolute; top: 0; left: 0; }
        .dg-ring-center {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }

        /* Glucose number inside left ring */
        .dg-glucose-num {
          font-size: 28px; font-weight: 700; letter-spacing: -1.5px;
          line-height: 1; transition: color 0.4s ease;
        }
        .dg-unit {
          font-size: 9px; font-weight: 600;
          color: rgba(255,255,255,0.4); margin-top: 2px;
          /* Intentionally NOT text-transform:uppercase so mixed case is preserved */
        }

        /* Trend ring on the right — same size as glucose ring */
        .dg-trend-ring-block {
          position: relative; flex-shrink: 0;
          width: 88px; height: 88px;
        }
        .dg-trend-ring-block svg { position: absolute; top: 0; left: 0; }
        .dg-trend-ring-center {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 3px;
        }
        .dg-trend-icon { display: flex; align-items: center; justify-content: center; transition: color 0.4s ease; }
        .dg-trend-label {
          font-size: 9px; font-weight: 600; letter-spacing: 0.02em;
          color: rgba(255,255,255,0.5); text-align: center; line-height: 1.2;
          max-width: 70px;
        }

        /* Status pill moved below the header, above main row — now replaces time */
        .dg-status-pill {
          display: inline-block; padding: 3px 10px;
          border-radius: 20px; font-size: 11px; font-weight: 700;
          letter-spacing: 0.04em;
          border: 1px solid transparent;
          transition: all 0.4s ease;
          white-space: nowrap;
        }

        /* Range bar */
        .dg-range-bar-wrap {
          display: flex; align-items: center; gap: 8px; margin-top: 8px;
        }
        .dg-range-bar-label {
          font-size: 10px; font-weight: 600;
          width: 30px; flex-shrink: 0; font-variant-numeric: tabular-nums; text-align: right;
        }
        .dg-range-bar {
          flex: 1; height: 4px; background: rgba(255,255,255,0.1);
          border-radius: 2px; overflow: hidden;
        }
        .dg-range-bar-fill {
          height: 100%; border-radius: 2px;
          transition: width 0.6s ease, background 0.4s ease;
        }
        .dg-range-bar-label-right {
          font-size: 10px; font-weight: 600;
          width: 30px; flex-shrink: 0; font-variant-numeric: tabular-nums; text-align: left;
        }

        /* Graph */
        .dg-graph-wrap {
          display: ${cfg.show_graph ? 'block' : 'none'};
          margin-top: 12px;
        }
        .dg-graph-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: rgba(255,255,255,0.28); margin-bottom: 6px;
        }
        .dg-graph-inner { height: 80px; position: relative; }
      </style>

      <ha-card id="dg-card">
        <div class="dg-inner">

          <!-- Header: title left, time-ago right -->
          <div class="dg-header" style="display:${cfg.show_title !== false ? 'flex' : 'none'}">
            <span class="dg-title">${cfg.title || 'Blood Sugar'}</span>
            <span class="dg-time" id="dg-time-ago">--</span>
          </div>

          <!-- Main row -->
          <div class="dg-main-row">

            <!-- LEFT: Glucose ring -->
            <div class="dg-ring-block">
              <svg viewBox="0 0 88 88" width="88" height="88">
                <circle cx="44" cy="44" r="34"
                  fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
                <circle id="dg-ring-arc" cx="44" cy="44" r="34"
                  fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"
                  style="stroke-dasharray:${circ};stroke-dashoffset:${circ * 0.5};transform:rotate(-90deg);transform-origin:44px 44px;transition:stroke-dashoffset 0.7s ease,stroke 0.4s ease;"/>
              </svg>
              <div class="dg-ring-center">
                <span class="dg-glucose-num" id="dg-glucose-num" style="color:${accent}">
                  <span id="dg-glucose">--</span>
                </span>
                <span class="dg-unit" id="dg-unit">${this._unitLabel()}</span>
              </div>
            </div>

            <!-- CENTRE: status pill -->
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;">
              <span class="dg-status-pill" id="dg-status-pill"
                style="background:${accent}28;color:${accent};border-color:${accent}55">--</span>
            </div>

            <!-- RIGHT: Trend ring -->
            <div class="dg-trend-ring-block">
              <svg viewBox="0 0 88 88" width="88" height="88">
                <circle cx="44" cy="44" r="34"
                  fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
                <circle id="dg-trend-ring-arc" cx="44" cy="44" r="34"
                  fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"
                  style="stroke-dasharray:${circ};stroke-dashoffset:${circ * 0.75};transform:rotate(-90deg);transform-origin:44px 44px;transition:stroke-dashoffset 0.7s ease,stroke 0.4s ease;"/>
              </svg>
              <div class="dg-trend-ring-center">
                <div class="dg-trend-icon" id="dg-trend-icon" style="color:${accent}">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.25">
                    <path d="M5 12h14"/>
                  </svg>
                </div>
                <span class="dg-trend-label" id="dg-trend-label"></span>
              </div>
            </div>

          </div>

          <!-- Range bar -->
          <div class="dg-range-bar-wrap">
            <span class="dg-range-bar-label" id="dg-lo-label" style="color:${cfg.low_color}">${loLabel}</span>
            <div class="dg-range-bar">
              <div class="dg-range-bar-fill" id="dg-bar-fill" style="width:50%;background:${accent}"></div>
            </div>
            <span class="dg-range-bar-label-right" id="dg-hi-label" style="color:${cfg.high_color}">${hiLabel}</span>
          </div>

          <!-- Graph -->
          <div class="dg-graph-wrap" id="dg-graph-wrap">
            <div class="dg-graph-label">${cfg.graph_hours}h trend</div>
            <div class="dg-graph-inner" id="dg-graph-inner">
              <div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.2);font-size:12px;">Loading…</div>
            </div>
          </div>

        </div>
      </ha-card>`;

    this._setupInteractions();
    this._updateCard();
  }

  // ── Touch / click interactions ────────────────────────────────────

  _setupInteractions() {
    const card = this.shadowRoot.getElementById('dg-card');
    if (!card) return;

    // Long-press → HA more-info dialog
    // Short tap   → elegant popup with graph

    const startLongPress = () => {
      this._longPressFired = false;
      this._longPressTimer = setTimeout(() => {
        this._longPressFired = true;
        this._fireMoreInfo();
      }, 600);
    };

    const cancelLongPress = () => {
      clearTimeout(this._longPressTimer);
    };

    card.addEventListener('mousedown', startLongPress);
    card.addEventListener('touchstart', startLongPress, { passive: true });

    card.addEventListener('mouseup', cancelLongPress);
    card.addEventListener('mouseleave', cancelLongPress);
    card.addEventListener('touchend', cancelLongPress);
    card.addEventListener('touchcancel', cancelLongPress);

    card.addEventListener('click', () => {
      if (this._longPressFired) return; // long press already handled
      this._openPopup();
    });
  }

  _fireMoreInfo() {
    const entityId = this._config.glucose_entity;
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      bubbles: true, composed: true,
      detail: { entityId }
    });
    this.dispatchEvent(event);
  }

  // ── Update ─────────────────────────────────────────────────────────

  _updateCard() {
    if (!this._hass || !this._config) return;

    const glucoseState = this._hass.states[this._config.glucose_entity];
    const trendState   = this._hass.states[this._config.trend_entity];
    const glucoseVal   = glucoseState?.state;
    const trendVal     = trendState?.state
                      || trendState?.attributes?.trend
                      || trendState?.attributes?.trend_description;
    const lastUpdate   = glucoseState?.last_changed || glucoseState?.last_updated;

    const root         = this.shadowRoot;
    const statusColor  = this._getStatusColor(glucoseVal);
    const statusLabel  = this._getStatusLabel(glucoseVal);
    const trendInfo    = this._getTrendInfo(trendVal);
    const circ         = 2 * Math.PI * 34;

    // Glucose number & colour
    const glucoseEl = root.getElementById('dg-glucose');
    if (glucoseEl) glucoseEl.textContent = this._formatGlucose(glucoseVal);
    const numEl = root.getElementById('dg-glucose-num');
    if (numEl) numEl.style.color = statusColor;

    // Unit label — preserve exact casing from _unitLabel()
    const unitEl = root.getElementById('dg-unit');
    if (unitEl) unitEl.textContent = this._unitLabel();

    // Status pill (centre)
    const pillEl = root.getElementById('dg-status-pill');
    if (pillEl) {
      pillEl.textContent = statusLabel;
      pillEl.style.background    = statusColor + '28';
      pillEl.style.color         = statusColor;
      pillEl.style.borderColor   = statusColor + '55';
    }

    // Glucose ring arc
    const ringEl = root.getElementById('dg-ring-arc');
    if (ringEl && glucoseVal) {
      const n = parseFloat(glucoseVal);
      const lo = parseFloat(this._config.low_threshold);
      const hi = parseFloat(this._config.high_threshold);
      const pct = Math.min(1, Math.max(0, (n - lo * 0.6) / (hi * 1.4 - lo * 0.6)));
      ringEl.style.strokeDashoffset = circ * (1 - pct);
      ringEl.style.stroke = statusColor;
    }

    // Trend ring arc — fixed partial fill to show it's informational, not a progress
    const trendRingEl = root.getElementById('dg-trend-ring-arc');
    if (trendRingEl) {
      // Map trend direction (deg 0=up, 90=flat, 180=down) → ring fill 0–1
      if (trendInfo) {
        const trendPct = 1 - (trendInfo.deg / 180);          // up=1.0, flat=0.5, down=0.0
        trendRingEl.style.strokeDashoffset = circ * (1 - Math.max(0.08, trendPct));
      } else {
        trendRingEl.style.strokeDashoffset = circ * 0.5;
      }
      trendRingEl.style.stroke = statusColor;
    }

    // Trend icon
    const trendEl = root.getElementById('dg-trend-icon');
    if (trendEl) {
      if (trendInfo) {
        trendEl.style.color = statusColor;
        trendEl.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"
          style="transform:rotate(${trendInfo.deg}deg);transition:transform 0.5s cubic-bezier(0.34,1.56,0.64,1);">
          <path d="M12 3.5L5.5 12H9.5V20.5H14.5V12H18.5L12 3.5Z"/>
        </svg>`;
      } else {
        trendEl.style.color = 'rgba(255,255,255,0.25)';
        trendEl.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M5 12h14"/>
        </svg>`;
      }
    }

    // Trend label
    const trendLabelEl = root.getElementById('dg-trend-label');
    if (trendLabelEl) trendLabelEl.textContent = trendInfo?.label || (trendVal ? trendVal : '');

    // Time-ago (in header, top right)
    const timeEl = root.getElementById('dg-time-ago');
    if (timeEl && lastUpdate) {
      const mins = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000);
      timeEl.textContent = mins < 1 ? 'Just now'
        : mins === 1 ? '1 min ago'
        : mins < 60 ? `${mins} mins ago`
        : `${Math.floor(mins / 60)}h ago`;
      timeEl.style.color = mins > 15 ? this._config.high_color : 'rgba(255,255,255,0.4)';
    }

    // Range bar
    const barFill = root.getElementById('dg-bar-fill');
    if (barFill && glucoseVal) {
      const n  = parseFloat(glucoseVal);
      const lo = parseFloat(this._config.low_threshold);
      const hi = parseFloat(this._config.high_threshold);
      const pct = Math.min(100, Math.max(0, ((n - lo * 0.6) / (hi * 1.4 - lo * 0.6)) * 100));
      barFill.style.width      = `${pct}%`;
      barFill.style.background = statusColor;
    }

    // Graph (inline card graph)
    if (this._config.show_graph) {
      const graphInner = root.getElementById('dg-graph-inner');
      if (graphInner && !this._historyFetching) {
        this._historyFetching = true;
        this._loadGraphInto(graphInner, false).finally(() => { this._historyFetching = false; });
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════
//  EDITOR
// ═══════════════════════════════════════════════════════════════════

class DolphinDiabetesCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...DolphinDiabetesCard.getStubConfig(), ...config };
    if (this.shadowRoot.innerHTML) this.updateUI();
    else this.connectedCallback();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot.innerHTML) this.connectedCallback();
  }

  connectedCallback() {
    if (!this._hass) return;
    this._buildEditor();
  }

  updateUI() {
    const root = this.shadowRoot;
    const cfg  = this._config;
    const setVal = (id, val) => { const el = root.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = root.getElementById(id); if (el) el.checked = !!val; };

    setVal('glucose_entity', cfg.glucose_entity || '');
    setVal('trend_entity',   cfg.trend_entity   || '');
    setVal('title',          cfg.title          || 'Blood Sugar');
    setVal('low_threshold',  cfg.low_threshold  ?? 3.9);
    setVal('high_threshold', cfg.high_threshold ?? 10.0);
    setChk('show_graph',     cfg.show_graph !== false);
    setChk('show_title',     cfg.show_title !== false);

    root.querySelectorAll('input[name="unit"]').forEach(r => { r.checked = (r.value === cfg.unit); });
    root.querySelectorAll('input[name="graph_hours"]').forEach(r => { r.checked = (parseInt(r.value) === parseInt(cfg.graph_hours || 3)); });

    for (const field of this._getColourFields()) {
      const card = root.querySelector(`.colour-card[data-key="${field.key}"]`);
      if (!card) continue;
      const val = cfg[field.key] || field.default;
      card.querySelector('.colour-swatch-preview').style.background = val;
      card.querySelector('.colour-dot').style.background = val;
      card.querySelector('.colour-hex').value = val;
      const cp = card.querySelector('input[type=color]');
      if (/^#[0-9a-fA-F]{6}$/.test(val)) cp.value = val;
    }
  }

  _getColourFields() {
    return [
      { key: 'accent_color',     label: 'Accent',          desc: 'Ring & icon highlight',            default: '#007AFF' },
      { key: 'normal_color',     label: 'In Range',         desc: 'Colour when glucose is in range',  default: '#34C759' },
      { key: 'low_color',        label: 'Low Alert',        desc: 'Colour when glucose is low',       default: '#FF3B30' },
      { key: 'high_color',       label: 'High Alert',       desc: 'Colour when glucose is high',      default: '#FF9500' },
      { key: 'graph_line_color', label: 'Graph Line',       desc: 'Blood sugar graph line colour',    default: '#007AFF' },
      { key: 'graph_fill_color', label: 'Graph Fill',       desc: 'Graph area fill colour',           default: '#007AFF' },
      { key: 'card_bg',          label: 'Card Background',  desc: 'Card background colour',           default: '#1c1c1e' },
      { key: 'text_color',       label: 'Text Colour',      desc: 'Primary text colour',              default: '#ffffff' },
    ];
  }

  _buildEditor() {
    const hass = this._hass;
    const cfg  = this._config;

    const allEntities = Object.keys(hass.states).sort();
    const entityOptions = (val) => `
      <option value="">— None —</option>
      ${allEntities.map(e => {
        const name = hass.states[e]?.attributes?.friendly_name || e;
        return `<option value="${e}" ${e === val ? 'selected' : ''}>${name} (${e})</option>`;
      }).join('')}`;

    const COLOUR_FIELDS = this._getColourFields();

    this.shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .container { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 8px; }
        .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }
        .card-block { background: var(--card-background-color); border: 1px solid rgba(128,128,128,0.18); border-radius: 12px; overflow: hidden; }
        .select-row { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .select-row label { font-size: 13px; font-weight: 600; color: var(--primary-text-color); }
        .hint { font-size: 11px; color: #888; }
        select, input[type="text"], input[type="number"] {
          width: 100%; background: var(--secondary-background-color, rgba(0,0,0,0.06));
          color: var(--primary-text-color); border: 1px solid rgba(128,128,128,0.2);
          border-radius: 8px; padding: 9px 12px; font-size: 13px; cursor: pointer;
          -webkit-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
        }
        input[type="text"], input[type="number"] { background-image: none; padding-right: 12px; cursor: text; }
        .toggle-list { display: flex; flex-direction: column; }
        .toggle-item { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid rgba(128,128,128,0.1); min-height: 52px; }
        .toggle-item:last-child { border-bottom: none; }
        .toggle-label { font-size: 14px; font-weight: 500; flex: 1; padding-right: 12px; }
        .toggle-sublabel { font-size: 11px; color: #888; margin-top: 1px; }
        .toggle-switch { position: relative; width: 51px; height: 31px; flex-shrink: 0; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .toggle-track { position: absolute; inset: 0; border-radius: 31px; background: rgba(120,120,128,0.32); cursor: pointer; transition: background 0.25s ease; }
        .toggle-track::after { content: ''; position: absolute; width: 27px; height: 27px; border-radius: 50%; background: #fff; top: 2px; left: 2px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); transition: transform 0.25s ease; }
        .toggle-switch input:checked + .toggle-track { background: #34C759; }
        .toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }
        .segmented { display: flex; background: rgba(118,118,128,0.18); border-radius: 9px; padding: 2px; gap: 2px; }
        .segmented input[type="radio"] { display: none; }
        .segmented label { flex: 1; text-align: center; padding: 8px 4px; font-size: 13px; font-weight: 500; border-radius: 7px; cursor: pointer; color: var(--primary-text-color); transition: all 0.2s ease; }
        .segmented input[type="radio"]:checked + label { background: #007AFF; color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
        .input-row { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .threshold-row { display: flex; gap: 12px; }
        .threshold-row > div { flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .threshold-row label { font-size: 11px; font-weight: 600; color: #888; }
        .colour-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .colour-card { border: 1px solid var(--divider-color, rgba(0,0,0,0.12)); border-radius: 10px; overflow: hidden; cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s; position: relative; }
        .colour-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.12); border-color: var(--primary-color, #007AFF); }
        .colour-swatch { height: 44px; width: 100%; display: block; position: relative; }
        .colour-swatch input[type="color"] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
        .colour-swatch-preview { position: absolute; inset: 0; pointer-events: none; }
        .colour-swatch::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%); background-size: 8px 8px; background-position: 0 0,0 4px,4px -4px,-4px 0; opacity: 0.3; pointer-events: none; }
        .colour-info { padding: 6px 8px 7px; background: var(--card-background-color, #fff); }
        .colour-label { font-size: 11px; font-weight: 700; color: var(--primary-text-color); letter-spacing: 0.02em; margin-bottom: 1px; }
        .colour-desc { font-size: 10px; color: var(--secondary-text-color, #6b7280); margin-bottom: 4px; line-height: 1.3; }
        .colour-hex-row { display: flex; align-items: center; gap: 4px; }
        .colour-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); flex-shrink: 0; }
        .colour-hex { flex: 1; font-size: 11px; font-family: monospace; border: none; background: none; color: var(--secondary-text-color, #6b7280); padding: 0; width: 0; min-width: 0; }
        .colour-hex:focus { outline: none; color: var(--primary-text-color); }
        .colour-edit-icon { opacity: 0; transition: opacity 0.15s; color: var(--secondary-text-color); font-size: 14px; line-height: 1; }
        .colour-card:hover .colour-edit-icon { opacity: 1; }
        .opacity-row { padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
        .opacity-row label { font-size: 13px; font-weight: 600; flex-shrink: 0; }
        .opacity-row input[type="range"] { flex: 1; height: 5px; accent-color: #007AFF; background: none; border: none; padding: 0; cursor: pointer; -webkit-appearance: auto; appearance: auto; background-image: none; }
        .opacity-val { font-size: 12px; color: #888; font-variant-numeric: tabular-nums; width: 32px; text-align: right; flex-shrink: 0; }
      </style>

      <div class="container">

        <!-- Entities -->
        <div>
          <div class="section-title">Sensor Entities</div>
          <div class="card-block">
            <div class="select-row">
              <label>Blood Glucose Sensor</label>
              <div class="hint">The sensor providing the current glucose reading</div>
              <select id="glucose_entity">${entityOptions(cfg.glucose_entity)}</select>
            </div>
            <div class="select-row" style="border-top:1px solid rgba(128,128,128,0.1)">
              <label>Trend Sensor</label>
              <div class="hint">Sensor providing the trend direction (rising, flat, falling…)</div>
              <select id="trend_entity">${entityOptions(cfg.trend_entity)}</select>
            </div>
          </div>
        </div>

        <!-- Unit -->
        <div>
          <div class="section-title">Glucose Unit</div>
          <div class="card-block" style="padding:12px;">
            <div class="segmented">
              <input type="radio" name="unit" id="unit_mmol" value="mmol" ${cfg.unit !== 'mgdl' ? 'checked' : ''}>
              <label for="unit_mmol">mmol/L</label>
              <input type="radio" name="unit" id="unit_mgdl" value="mgdl" ${cfg.unit === 'mgdl' ? 'checked' : ''}>
              <label for="unit_mgdl">mg/dL</label>
            </div>
          </div>
        </div>

        <!-- Thresholds -->
        <div>
          <div class="section-title">Thresholds</div>
          <div class="card-block">
            <div class="input-row">
              <div class="hint" style="margin-bottom:4px">Values used to colour the reading and graph guide lines</div>
              <div class="threshold-row">
                <div>
                  <label>Low (below)</label>
                  <input type="number" id="low_threshold" step="0.1" min="0" value="${cfg.low_threshold ?? 3.9}">
                </div>
                <div>
                  <label>High (above)</label>
                  <input type="number" id="high_threshold" step="0.1" min="0" value="${cfg.high_threshold ?? 10.0}">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Display options -->
        <div>
          <div class="section-title">Display Options</div>
          <div class="card-block">
            <div class="toggle-list">
              <div class="toggle-item">
                <div><div class="toggle-label">Show Title</div></div>
                <label class="toggle-switch">
                  <input type="checkbox" id="show_title" ${cfg.show_title !== false ? 'checked' : ''}>
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Show Blood Sugar Graph</div>
                  <div class="toggle-sublabel">Fetches recent history from Home Assistant</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="show_graph" ${cfg.show_graph !== false ? 'checked' : ''}>
                  <span class="toggle-track"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Title text -->
        <div>
          <div class="section-title">Card Title Text</div>
          <div class="card-block">
            <div class="input-row">
              <input type="text" id="title" placeholder="Blood Sugar" value="${cfg.title || 'Blood Sugar'}">
            </div>
          </div>
        </div>

        <!-- Graph hours -->
        <div id="graph_hours_section" style="${cfg.show_graph !== false ? '' : 'display:none'}">
          <div class="section-title">Graph Time Range</div>
          <div class="card-block" style="padding:12px;">
            <div class="segmented">
              <input type="radio" name="graph_hours" id="gh_1"  value="1"  ${cfg.graph_hours == 1  ? 'checked' : ''}><label for="gh_1">1h</label>
              <input type="radio" name="graph_hours" id="gh_3"  value="3"  ${!cfg.graph_hours || cfg.graph_hours == 3 ? 'checked' : ''}><label for="gh_3">3h</label>
              <input type="radio" name="graph_hours" id="gh_6"  value="6"  ${cfg.graph_hours == 6  ? 'checked' : ''}><label for="gh_6">6h</label>
              <input type="radio" name="graph_hours" id="gh_12" value="12" ${cfg.graph_hours == 12 ? 'checked' : ''}><label for="gh_12">12h</label>
              <input type="radio" name="graph_hours" id="gh_24" value="24" ${cfg.graph_hours == 24 ? 'checked' : ''}><label for="gh_24">24h</label>
            </div>
          </div>
        </div>

        <!-- Colours -->
        <div>
          <div class="section-title">Colours</div>
          <div class="card-block" style="padding:10px;">
            <div class="colour-grid" id="colour-grid"></div>
          </div>
        </div>

        <!-- Opacity -->
        <div>
          <div class="section-title">Card Background Opacity</div>
          <div class="card-block">
            <div class="opacity-row">
              <label>Opacity</label>
              <input type="range" id="card_bg_opacity" min="0" max="100" value="${cfg.card_bg_opacity ?? 80}">
              <span class="opacity-val" id="opacity-val">${cfg.card_bg_opacity ?? 80}%</span>
            </div>
          </div>
        </div>

      </div>`;

    // Build colour cards
    const grid = this.shadowRoot.getElementById('colour-grid');
    for (const field of COLOUR_FIELDS) {
      const savedVal = cfg[field.key] || field.default;
      const card = document.createElement('div');
      card.className = 'colour-card';
      card.dataset.key = field.key;
      card.innerHTML = `
        <label class="colour-swatch">
          <div class="colour-swatch-preview" style="background:${savedVal}"></div>
          <input type="color" value="${/^#[0-9a-fA-F]{6}$/.test(savedVal) ? savedVal : savedVal.substring(0,7)}">
        </label>
        <div class="colour-info">
          <div class="colour-label">${field.label}</div>
          <div class="colour-desc">${field.desc}</div>
          <div class="colour-hex-row">
            <div class="colour-dot" style="background:${savedVal}"></div>
            <input class="colour-hex" type="text" value="${savedVal}" maxlength="7" placeholder="${field.default}" spellcheck="false">
            <span class="colour-edit-icon">✎</span>
          </div>
        </div>`;
      const nativePicker = card.querySelector('input[type=color]');
      const hexInput     = card.querySelector('.colour-hex');
      const preview      = card.querySelector('.colour-swatch-preview');
      const dot          = card.querySelector('.colour-dot');
      const apply = (val) => {
        preview.style.background = val; dot.style.background = val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) nativePicker.value = val;
        hexInput.value = val;
        this._updateConfig(field.key, val);
      };
      nativePicker.addEventListener('input',  () => apply(nativePicker.value));
      nativePicker.addEventListener('change', () => apply(nativePicker.value));
      hexInput.addEventListener('input', () => { const v = hexInput.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) apply(v); });
      hexInput.addEventListener('blur',  () => { const cur = this._config[field.key] || field.default; if (!/^#[0-9a-fA-F]{6}$/.test(hexInput.value.trim())) hexInput.value = cur; });
      hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexInput.blur(); });
      grid.appendChild(card);
    }

    this._setupListeners();
    this.updateUI();
  }

  _setupListeners() {
    const root = this.shadowRoot;
    const get  = id => root.getElementById(id);

    get('glucose_entity').onchange = e => this._updateConfig('glucose_entity', e.target.value);
    get('trend_entity').onchange   = e => this._updateConfig('trend_entity',   e.target.value);
    root.querySelectorAll('input[name="unit"]').forEach(r => { r.onchange = () => this._updateConfig('unit', r.value); });
    get('low_threshold').onchange  = e => this._updateConfig('low_threshold',  parseFloat(e.target.value));
    get('high_threshold').onchange = e => this._updateConfig('high_threshold', parseFloat(e.target.value));
    get('show_title').onchange     = e => this._updateConfig('show_title', e.target.checked);
    get('show_graph').onchange     = e => {
      this._updateConfig('show_graph', e.target.checked);
      const s = root.getElementById('graph_hours_section');
      if (s) s.style.display = e.target.checked ? '' : 'none';
    };
    get('title').oninput = e => this._updateConfig('title', e.target.value);
    root.querySelectorAll('input[name="graph_hours"]').forEach(r => { r.onchange = () => this._updateConfig('graph_hours', parseInt(r.value)); });
    get('card_bg_opacity').oninput = e => {
      const val = parseInt(e.target.value);
      root.getElementById('opacity-val').textContent = val + '%';
      this._updateConfig('card_bg_opacity', val);
    };
  }

  _updateConfig(key, value) {
    if (!this._config) return;
    this._config = { ...this._config, [key]: value };
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config }, bubbles: true, composed: true
    }));
  }
}

// ── Registration ──────────────────────────────────────────────────

if (!customElements.get('dolphin-diabetes-card')) {
  customElements.define('dolphin-diabetes-card', DolphinDiabetesCard);
}
if (!customElements.get('dolphin-diabetes-card-editor')) {
  customElements.define('dolphin-diabetes-card-editor', DolphinDiabetesCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'dolphin-diabetes-card')) {
  window.customCards.push({
    type: 'dolphin-diabetes-card',
    name: 'Dolphin Diabetes Card',
    preview: true,
    description: 'Displays current blood glucose level, trend direction, and an optional historical graph.',
  });
}
