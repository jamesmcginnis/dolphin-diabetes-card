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
    this._popupOverlay = null;
    this._popupHours = 3;
    this._predictionCache = null;      // { value, timestamp }
    this._predictionFetching = false;
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
      show_sensor_life: false,
      sensor_start_date: '',
      sensor_duration_days: 14,
      sensor_pill_bg: '#2c2c2e',
      sensor_pill_text: '#ffffff',
      sensor_pill_normal_color: '#34C759',
      sensor_pill_urgent_color: '#FF3B30',
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
      show_sensor_life: false,
      sensor_start_date: '',
      sensor_duration_days: 14,
      sensor_pill_bg: '#2c2c2e',
      sensor_pill_text: '#ffffff',
      sensor_pill_normal_color: '#34C759',
      sensor_pill_urgent_color: '#FF3B30',
      ...config
    };
    if (this.shadowRoot.innerHTML) this._render();
    this._predictionCache = null; // invalidate on config change
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

  _lo() { return parseFloat(this._config.low_threshold)  || (this._config.unit === 'mgdl' ? 70  : 3.9);  }
  _hi() { return parseFloat(this._config.high_threshold) || (this._config.unit === 'mgdl' ? 180 : 10.0); }

  _getSensorDaysLeft() {
    return this._getSensorStatus()?.daysLeft ?? null;
  }

  _getSensorStatus() {
    const { sensor_start_date, sensor_duration_days } = this._config;
    if (!sensor_start_date) return null;
    const start = new Date(sensor_start_date);
    if (isNaN(start.getTime())) return null;
    const duration       = parseInt(sensor_duration_days) || 14;
    const end            = new Date(start.getTime() + duration * 86400000);
    const msLeft         = end - Date.now();
    const daysLeft       = Math.floor(msLeft / 86400000); // FIX: was Math.ceil — caused days to read 1 too high
    const totalHoursLeft = msLeft / 3600000;
    const hoursOverdue   = msLeft < 0 ? Math.floor(-totalHoursLeft) : 0;
    const pct            = Math.max(0, Math.min(1, msLeft / (duration * 86400000)));
    return { start, end, duration, daysLeft, totalHoursLeft, hoursOverdue, pct };
  }

  _formatGlucose(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return '--';
    return this._config.unit === 'mgdl' ? Math.round(n).toString() : n.toFixed(1);
  }

  _unitLabel() {
    return this._config.unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  }

  _getStatusColor(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return this._config.accent_color;
    if (n < this._lo()) return this._config.low_color;
    if (n > this._hi()) return this._config.high_color;
    return this._config.normal_color;
  }

  _getStatusLabel(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return 'Unknown';
    if (n < this._lo()) return 'Low';
    if (n > this._hi()) return 'High';
    return 'In Range';
  }

  // ── 30-minute Glucose Prediction ──────────────────────────────────

  async _fetchPrediction() {
    if (!this._config.glucose_entity || !this._hass) return null;
    try {
      const end   = new Date();
      const start = new Date(end - 40 * 60000); // last 40 minutes
      const resp  = await this._hass.callApi('GET',
        `history/period/${start.toISOString()}?filter_entity_id=${this._config.glucose_entity}&end_time=${end.toISOString()}&minimal_response=true&no_attributes=true`
      );
      const raw  = resp?.[0] || [];
      const data = raw.filter(s => !isNaN(parseFloat(s.state)));
      if (data.length < 2) return null;

      // Build (t, v) pairs — t in minutes from first reading
      const t0     = new Date(data[0].last_changed || data[0].last_updated).getTime();
      const points = data.map(s => ({
        t: (new Date(s.last_changed || s.last_updated).getTime() - t0) / 60000,
        v: parseFloat(s.state),
      }));

      // Weighted linear regression — more recent points get higher weight
      const n   = points.length;
      let sw = 0, swt = 0, swv = 0, swtt = 0, swtv = 0;
      points.forEach((p, i) => {
        const w = (i + 1);           // linear ramp: newest = highest weight
        sw   += w;
        swt  += w * p.t;
        swv  += w * p.v;
        swtt += w * p.t * p.t;
        swtv += w * p.t * p.v;
      });
      const denom = sw * swtt - swt * swt;
      if (Math.abs(denom) < 1e-10) return null;

      const slope     = (sw * swtv - swt * swv) / denom;  // mmol (or mg/dL) per minute
      const intercept = (swv - slope * swt) / sw;

      // Predict at t = latest reading time + 30 min
      const tLast    = points[points.length - 1].t;
      const tPredict = tLast + 30;
      const predicted = intercept + slope * tPredict;

      // Sanity clamp: ±10 mmol/L or ±180 mg/dL from current
      const current = points[points.length - 1].v;
      const maxDelta = this._config.unit === 'mgdl' ? 180 : 10;
      return Math.max(current - maxDelta, Math.min(current + maxDelta, predicted));
    } catch {
      return null;
    }
  }

  _formatPrediction(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return '--';
    return this._config.unit === 'mgdl' ? Math.round(n).toString() : n.toFixed(1);
  }

  _getTrendInfo(trend) {
    if (!trend) return null;
    const t = trend.toString().toLowerCase();
    const make = (deg, label) => ({ deg, label });
    if ((t.includes('double') && t.includes('up'))     || t === 'doubleup')       return make(0,   'Rising Fast');
    if (t.includes('rising_quickly')                   || t === 'up_fast')        return make(0,   'Rising Fast');
    if ((t.includes('single') && t.includes('up'))     || t === 'singleup')       return make(45,  'Rising');
    if (t.includes('rising_slightly')                  || t === 'up_slight')      return make(67,  'Rising Slightly');
    if ((t.includes('fortyfive') && t.includes('up'))  || t === 'fortyfiveup')    return make(67,  'Rising Slightly');
    if (t.includes('rising')                           || t === 'up')             return make(45,  'Rising');
    if (t.includes('flat')                             || t === 'steady')         return make(90,  'Steady');
    if ((t.includes('fortyfive') && t.includes('down'))|| t === 'fortyfivedown')  return make(113, 'Falling Slightly');
    if (t.includes('falling_slightly')                 || t === 'down_slight')    return make(113, 'Falling Slightly');
    if ((t.includes('single') && t.includes('down'))   || t === 'singledown')    return make(135, 'Falling');
    if (t.includes('falling_quickly')                  || t === 'down_fast')      return make(180, 'Falling Fast');
    if ((t.includes('double') && t.includes('down'))   || t === 'doubledown')    return make(180, 'Falling Fast');
    if (t.includes('falling')                          || t === 'down')           return make(135, 'Falling');
    return null;
  }

  // ── Graph builder ─────────────────────────────────────────────────

  _buildGraph(glucoseValues, timestamps, popupMode = false) {
    if (!glucoseValues || glucoseValues.length < 2) {
      return `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.35);font-size:12px;">Not enough data</div>`;
    }
    const W = 400, H = popupMode ? 160 : 110;
    const pad = { top: 6, right: 8, bottom: 20, left: 30 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const lo = this._lo(), hi = this._hi();

    const rawMin = Math.min(...glucoseValues), rawMax = Math.max(...glucoseValues);
    const vpad = (rawMax - rawMin) * 0.15 || 1;
    const min = Math.min(rawMin - vpad, lo * 0.85);
    const max = Math.max(rawMax + vpad, hi * 1.1);
    const range = max - min;

    const xs = glucoseValues.map((_, i) => pad.left + (i / (glucoseValues.length - 1)) * plotW);
    const ys = glucoseValues.map(v => pad.top + plotH - ((v - min) / range) * plotH);
    const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const fillPath = linePath + ` L${xs[xs.length-1].toFixed(1)},${(pad.top+plotH).toFixed(1)} L${pad.left},${(pad.top+plotH).toFixed(1)} Z`;

    const clampY = v => Math.max(pad.top, Math.min(pad.top + plotH, pad.top + plotH - ((v - min) / range) * plotH));
    const loYc = clampY(lo), hiYc = clampY(hi);

    // Y-axis labels for the threshold lines
    const loLabel = this._config.unit === 'mgdl' ? Math.round(lo).toString() : lo.toFixed(1);
    const hiLabel = this._config.unit === 'mgdl' ? Math.round(hi).toString() : hi.toFixed(1);
    const yLabels = `
      <text x="${pad.left - 3}" y="${(loYc + 3).toFixed(1)}" fill="${this._config.low_color}" font-size="7" text-anchor="end" opacity="0.7">${loLabel}</text>
      <text x="${pad.left - 3}" y="${(hiYc + 3).toFixed(1)}" fill="${this._config.high_color}" font-size="7" text-anchor="end" opacity="0.7">${hiLabel}</text>`;

    let xLabels = '';
    if (timestamps && timestamps.length >= 2) {
      const fmt = ts => { try { const d = new Date(ts); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; } catch { return ''; } };
      xLabels = `<text x="${pad.left+2}" y="${H-9}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="start">${fmt(timestamps[0])}</text>
        <text x="${W-pad.right-2}" y="${H-9}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="end">${fmt(timestamps[timestamps.length-1])}</text>`;
    }

    const lastX = xs[xs.length-1], lastY = ys[ys.length-1];
    const dotColor = this._getStatusColor(glucoseValues[glucoseValues.length-1]);
    const gradId = popupMode ? 'dgFillP' : 'dgFillC';
    const clipId = popupMode ? 'dgClipP' : 'dgClipC';

    let segments = '';
    for (let i = 1; i < glucoseValues.length; i++) {
      const c = this._getStatusColor((glucoseValues[i-1] + glucoseValues[i]) / 2);
      segments += `<line x1="${xs[i-1].toFixed(1)}" y1="${ys[i-1].toFixed(1)}" x2="${xs[i].toFixed(1)}" y2="${ys[i].toFixed(1)}" stroke="${c}" stroke-width="${popupMode ? 2.5 : 2}" stroke-linecap="round"/>`;
    }

    // Current value label shown next to the last data point dot
    const currentVal = glucoseValues[glucoseValues.length - 1];
    const currentLabel = this._config.unit === 'mgdl' ? Math.round(currentVal).toString() : currentVal.toFixed(1);
    const valLabelX = lastX + (popupMode ? 9 : 7);
    const valLabelY = Math.max(pad.top + 7, Math.min(pad.top + plotH - 2, lastY + 3));
    const valueDotLabel = `<text x="${valLabelX.toFixed(1)}" y="${valLabelY.toFixed(1)}" fill="${dotColor}" font-size="${popupMode ? 9 : 8}" font-weight="700" text-anchor="start" opacity="0.9">${currentLabel}</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;display:block;">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${this._config.graph_fill_color}" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="${this._config.graph_fill_color}" stop-opacity="0.02"/>
        </linearGradient>
        <clipPath id="${clipId}"><rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}"/></clipPath>
      </defs>
      <line x1="${pad.left}" y1="${loYc.toFixed(1)}" x2="${W-pad.right}" y2="${loYc.toFixed(1)}" stroke="${this._config.low_color}" stroke-width="1" stroke-dasharray="4 3" opacity="0.45"/>
      <line x1="${pad.left}" y1="${hiYc.toFixed(1)}" x2="${W-pad.right}" y2="${hiYc.toFixed(1)}" stroke="${this._config.high_color}" stroke-width="1" stroke-dasharray="4 3" opacity="0.45"/>
      ${yLabels}
      <path d="${fillPath}" fill="url(#${gradId})" clip-path="url(#${clipId})"/>
      <g clip-path="url(#${clipId})">${segments}</g>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="${popupMode ? 5 : 3.5}" fill="${dotColor}" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
      ${valueDotLabel}
      ${xLabels}
    </svg>`;
  }

  // ── Popup ──────────────────────────────────────────────────────────

  _openPopup() {
    if (this._popupOverlay) return;

    const glucoseState = this._hass?.states[this._config.glucose_entity];
    const trendState   = this._hass?.states[this._config.trend_entity];
    const glucoseVal   = glucoseState?.state;
    const trendVal     = trendState?.state || trendState?.attributes?.trend || trendState?.attributes?.trend_description;
    const lastUpdate   = glucoseState?.last_changed || glucoseState?.last_updated;
    const statusColor  = this._getStatusColor(glucoseVal);
    const statusLabel  = this._getStatusLabel(glucoseVal);
    const trendInfo    = this._getTrendInfo(trendVal);
    const cfg          = this._config;

    this._popupHours = parseInt(cfg.graph_hours) || 3;

    const hexBg = cfg.card_bg || '#1c1c1e';
    let popupBg;
    if (/^#[0-9a-fA-F]{8}$/.test(hexBg)) {
      const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
      const aa = Math.min(1, parseInt(hexBg.slice(7,9),16) / 255 + 0.12);
      popupBg = `rgba(${Math.max(0,rr-6)},${Math.max(0,gg-6)},${Math.max(0,bb-6)},${aa.toFixed(3)})`;
    } else {
      const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
      const bgOpacity = (parseInt(cfg.card_bg_opacity) || 80) / 100;
      popupBg = `rgba(${Math.max(0,rr-6)},${Math.max(0,gg-6)},${Math.max(0,bb-6)},${Math.min(1, bgOpacity + 0.12)})`;
    }

    let timeAgoStr = '--';
    if (lastUpdate) {
      const mins = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000);
      timeAgoStr = mins < 1 ? 'Just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} mins ago` : `${Math.floor(mins/60)}h ago`;
    }
    const trendText = trendInfo?.label || (trendVal ? trendVal : '—');

    const overlay = document.createElement('div');
    overlay.id = 'dg-popup-overlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes dgFadeIn { from{opacity:0} to{opacity:1} }
      @keyframes dgSlideUp { from{transform:translateY(18px) scale(0.97);opacity:0} to{transform:none;opacity:1} }
      .dg-popup { animation: dgSlideUp 0.26s cubic-bezier(0.34,1.3,0.64,1); }
      #dg-popup-overlay { animation: dgFadeIn 0.2s ease; }
      .dg-seg-btn { flex:1;text-align:center;padding:7px 4px;font-size:12px;font-weight:600;border-radius:7px;cursor:pointer;color:rgba(255,255,255,0.55);border:none;background:none;transition:all 0.2s;font-family:inherit;touch-action:manipulation; }
      .dg-seg-btn.active { background:${cfg.accent_color};color:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.35); }
      .dg-close-btn:hover { background:rgba(255,255,255,0.22)!important; }
      .dg-info-row { display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.07); }
      .dg-info-row:last-child { border-bottom:none; }
      .dg-info-label { font-size:12px;color:rgba(255,255,255,0.45);font-weight:500; }
      .dg-info-value { font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);text-align:right; }
    `;

    const popup = document.createElement('div');
    popup.className = 'dg-popup';
    popup.style.cssText = `background:${popupBg};backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.15);border-radius:24px;box-shadow:0 24px 64px rgba(0,0,0,0.65);padding:20px;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;color:${cfg.text_color};`;
    popup.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    headerRow.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);">${cfg.title || 'Blood Sugar'}</span>
      <button class="dg-close-btn" style="background:rgba(255,255,255,0.1);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.65);font-size:15px;line-height:1;padding:0;transition:background 0.15s;flex-shrink:0;">✕</button>`;
    headerRow.querySelector('.dg-close-btn').addEventListener('click', () => this._closePopup());

    const readingRow = document.createElement('div');
    readingRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

    const readingLeft = document.createElement('div');
    readingLeft.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:6px;line-height:1;">
        <span style="font-size:54px;font-weight:700;letter-spacing:-3px;color:${statusColor};">${this._formatGlucose(glucoseVal)}</span>
        <span style="font-size:14px;color:rgba(255,255,255,0.4);font-weight:500;padding-bottom:5px;">${this._unitLabel()}</span>
      </div>
      <div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${statusLabel}</span>
        <span style="font-size:11px;color:rgba(255,255,255,0.35);">${timeAgoStr}</span>
      </div>`;

    const trendRight = document.createElement('div');
    trendRight.style.cssText = 'flex-shrink:0;margin-left:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:60px;';
    trendRight.innerHTML = `
      <span style="font-size:48px;line-height:1;color:${statusColor};">${trendInfo ? this._trendArrow(trendInfo.deg) : '—'}</span>
      <span style="font-size:11px;font-weight:600;color:${statusColor};text-align:center;">${trendText}</span>`;

    readingRow.appendChild(readingLeft);
    readingRow.appendChild(trendRight);

    const segWrap = document.createElement('div');
    segWrap.style.cssText = 'display:flex;background:rgba(118,118,128,0.2);border-radius:10px;padding:3px;gap:2px;margin-bottom:12px;';
    [1, 3, 6, 12, 24].forEach(h => {
      const btn = document.createElement('button');
      btn.className = 'dg-seg-btn' + (h === this._popupHours ? ' active' : '');
      btn.textContent = `${h}h`;
      btn.dataset.hours = h;
      const switchHours = (e) => {
        if (e.type === 'touchend') e.preventDefault(); // prevent ghost click after touchend
        this._popupHours = h;
        segWrap.querySelectorAll('.dg-seg-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.hours) === h));
        graphInner.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.25);font-size:12px;">Loading…</div>`;
        this._loadGraphInto(graphInner, true, h);
      };
      btn.addEventListener('click', switchHours);
      btn.addEventListener('touchend', switchHours);
      segWrap.appendChild(btn);
    });

    const graphInner = document.createElement('div');
    graphInner.style.cssText = 'height:130px;position:relative;margin-bottom:14px;';
    graphInner.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.25);font-size:12px;">Loading…</div>`;

    const infoWrap = document.createElement('div');
    const attrs = glucoseState?.attributes || {};
    const rows = [
      { label: 'Trend',        value: trendText },
      { label: 'Last reading', value: timeAgoStr },
    ];
    const delta = attrs.delta ?? attrs.glucose_delta;
    if (delta !== undefined) {
      const ds = (parseFloat(delta) >= 0 ? '+' : '') + parseFloat(delta).toFixed(this._config.unit === 'mgdl' ? 0 : 1);
      rows.push({ label: 'Change', value: `${ds} ${this._unitLabel()}` });
    }
    if (attrs.sensor_age     !== undefined) rows.push({ label: 'Sensor age',  value: attrs.sensor_age });
    if (attrs.transmitter_id !== undefined) rows.push({ label: 'Transmitter', value: attrs.transmitter_id });
    const batt = attrs.battery_level ?? attrs.battery;
    if (batt !== undefined) rows.push({ label: 'Battery', value: `${batt}%` });

    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'dg-info-row';
      row.innerHTML = `<span class="dg-info-label">${label}</span><span class="dg-info-value">${value}</span>`;
      infoWrap.appendChild(row);
    });

    popup.appendChild(style);
    popup.appendChild(headerRow);
    popup.appendChild(readingRow);
    popup.appendChild(segWrap);
    popup.appendChild(graphInner);
    popup.appendChild(infoWrap);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) this._closePopup(); });
    this._popupOverlay = overlay;
    this._loadGraphInto(graphInner, true, this._popupHours);
  }

  _closePopup() {
    if (!this._popupOverlay) return;
    this._popupOverlay.style.transition = 'opacity 0.18s ease';
    this._popupOverlay.style.opacity = '0';
    setTimeout(() => {
      if (this._popupOverlay?.parentNode) this._popupOverlay.parentNode.removeChild(this._popupOverlay);
      this._popupOverlay = null;
    }, 180);
  }

  // ── Shared popup scaffolding ───────────────────────────────────────

  _makePopupShell(titleText) {
    if (this._popupOverlay) this._closePopup();

    const cfg   = this._config;
    const hexBg = cfg.card_bg || '#1c1c1e';
    let popupBg;
    if (/^#[0-9a-fA-F]{8}$/.test(hexBg)) {
      const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
      const aa = Math.min(1, parseInt(hexBg.slice(7,9),16) / 255 + 0.12);
      popupBg = `rgba(${Math.max(0,rr-6)},${Math.max(0,gg-6)},${Math.max(0,bb-6)},${aa.toFixed(3)})`;
    } else {
      const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
      const bgOpacity = (parseInt(cfg.card_bg_opacity) || 80) / 100;
      popupBg = `rgba(${Math.max(0,rr-6)},${Math.max(0,gg-6)},${Math.max(0,bb-6)},${Math.min(1, bgOpacity + 0.12)})`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'dg-popup-overlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes dgFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes dgSlideUp { from{transform:translateY(18px) scale(0.97);opacity:0} to{transform:none;opacity:1} }
      .dg-popup  { animation: dgSlideUp 0.26s cubic-bezier(0.34,1.3,0.64,1); }
      #dg-popup-overlay { animation: dgFadeIn 0.2s ease; }
      .dg-close-btn:hover { background:rgba(255,255,255,0.22)!important; }
      .dg-info-row  { display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.07); }
      .dg-info-row:last-child { border-bottom:none; }
      .dg-info-label { font-size:12px;color:rgba(255,255,255,0.45);font-weight:500; }
      .dg-info-value { font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);text-align:right; }
      .dg-trend-hist-row { display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.07); }
      .dg-trend-hist-row:last-child { border-bottom:none; }
      .dg-trend-hist-time { font-size:12px;color:rgba(255,255,255,0.42);font-weight:500;font-variant-numeric:tabular-nums;min-width:110px;flex-shrink:0; }
      .dg-trend-hist-badge { display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700; }
      .dg-trend-arrow { font-size:15px;line-height:1; }
    `;

    const popup = document.createElement('div');
    popup.className = 'dg-popup';
    popup.style.cssText = `background:${popupBg};backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.15);border-radius:24px;box-shadow:0 24px 64px rgba(0,0,0,0.65);padding:20px;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;color:${cfg.text_color};`;
    popup.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    headerRow.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);">${titleText}</span>
      <button class="dg-close-btn" style="background:rgba(255,255,255,0.1);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.65);font-size:15px;line-height:1;padding:0;transition:background 0.15s;flex-shrink:0;">✕</button>`;
    headerRow.querySelector('.dg-close-btn').addEventListener('click', () => this._closePopup());

    popup.appendChild(style);
    popup.appendChild(headerRow);
    overlay.appendChild(popup);
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closePopup(); });
    document.body.appendChild(overlay);
    this._popupOverlay = overlay;

    return { popup, overlay };
  }

  // ── Trend History Popup ────────────────────────────────────────────

  _trendArrow(deg) {
    if (deg === 0)   return '↑↑';
    if (deg <= 45)   return '↑';
    if (deg <= 67)   return '↗';
    if (deg <= 90)   return '→';
    if (deg <= 113)  return '↘';
    if (deg <= 135)  return '↓';
    return '↓↓';
  }

  async _openTrendPopup() {
    const cfg = this._config;
    if (!cfg.trend_entity) return;

    const { popup } = this._makePopupShell('Trend History');
    const statusColor = this._getStatusColor(this._hass?.states[cfg.glucose_entity]?.state);

    const trendState = this._hass?.states[cfg.trend_entity];
    const trendVal   = trendState?.state || trendState?.attributes?.trend || trendState?.attributes?.trend_description;
    const trendInfo  = this._getTrendInfo(trendVal);
    const trendText  = trendInfo?.label || (trendVal ? trendVal : '—');
    const heroRow = document.createElement('div');
    heroRow.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:16px;';
    heroRow.innerHTML = `
      <span style="font-size:56px;line-height:1;color:${statusColor};flex-shrink:0;">${trendInfo ? this._trendArrow(trendInfo.deg) : '—'}</span>
      <div>
        <div style="font-size:18px;font-weight:700;color:${statusColor};letter-spacing:-0.3px;">${trendText}</div>
        <div style="margin-top:3px;font-size:11px;color:rgba(255,255,255,0.35);">Current trend</div>
      </div>`;
    popup.appendChild(heroRow);

    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin-bottom:12px;';
    popup.appendChild(divider);

    const histLabel = document.createElement('div');
    histLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:8px;';
    histLabel.textContent = 'Recent History';
    popup.appendChild(histLabel);

    const histWrap = document.createElement('div');
    histWrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:60px;color:rgba(255,255,255,0.25);font-size:12px;">Loading…</div>`;
    popup.appendChild(histWrap);

    try {
      const end  = new Date(), start = new Date(end - 24 * 3600000);
      const resp = await this._hass.callApi('GET',
        `history/period/${start.toISOString()}?filter_entity_id=${cfg.trend_entity}&end_time=${end.toISOString()}&minimal_response=false`
      );
      const data  = resp?.[0] || [];
      const valid = data.filter(s => s.state && s.state !== 'unavailable' && s.state !== 'unknown');

      if (valid.length === 0) {
        histWrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:60px;color:rgba(255,255,255,0.25);font-size:12px;">No history available</div>`;
      } else {
        const rows = [...valid].reverse().slice(0, 50);
        const fmtTime = ts => {
          const d = new Date(ts);
          const now = new Date();
          const isToday = d.toDateString() === now.toDateString();
          const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
          const isYesterday = d.toDateString() === yesterday.toDateString();
          const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
          if (isToday) return `Today, ${time}`;
          if (isYesterday) return `Yesterday, ${time}`;
          return `${d.toLocaleDateString('en-GB', {day:'numeric',month:'short'})}, ${time}`;
        };

        histWrap.innerHTML = '';
        rows.forEach((entry, idx) => {
          const ts    = entry.last_changed || entry.last_updated;
          const info  = this._getTrendInfo(entry.state);
          const label = info?.label || entry.state;
          const arrow = info ? this._trendArrow(info.deg) : '';
          const color = idx === 0 ? statusColor : 'rgba(255,255,255,0.6)';
          const bgCol = idx === 0 ? `${statusColor}18` : 'rgba(255,255,255,0.06)';
          const row   = document.createElement('div');
          row.className = 'dg-trend-hist-row';
          row.innerHTML = `
            <span class="dg-trend-hist-time">${fmtTime(ts)}</span>
            <span class="dg-trend-hist-badge" style="background:${bgCol};color:${color};border:1px solid ${idx===0?statusColor+'44':'rgba(255,255,255,0.1)'};">
              <span class="dg-trend-arrow">${arrow}</span>${label}
            </span>`;
          histWrap.appendChild(row);
        });
      }
    } catch {
      histWrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:60px;color:rgba(255,255,255,0.25);font-size:12px;">Could not load history</div>`;
    }
  }

  // ── Sensor Life Popup ──────────────────────────────────────────────

  _openSensorPopup() {
    const cfg = this._config;
    if (!cfg.show_sensor_life || !cfg.sensor_start_date) return;

    const status = this._getSensorStatus();
    if (!status) return;
    const { start: startDate, end: endDate, duration, daysLeft, hoursOverdue, totalHoursLeft, pct } = status;

    const normalColor = cfg.sensor_pill_normal_color || '#34C759';
    const urgentColor = cfg.sensor_pill_urgent_color || '#FF3B30';
    const isExpired   = daysLeft !== null && daysLeft <= 0;
    const isUrgent    = daysLeft !== null && daysLeft <= 1;
    const pillColor   = isUrgent ? urgentColor : normalColor;
    const circ        = 2 * Math.PI * 34;

    const fmtDate     = d => d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const fmtTime     = d => `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const fmtDateTime = d => `${fmtDate(d)} at ${fmtTime(d)}`;

    const hoursLeft = Math.max(0, Math.floor(totalHoursLeft % 24));

    let statusText, statusSub, statusBadge;
    if (daysLeft === null)   { statusText = '?';                     statusSub = 'Unknown';                statusBadge = 'Unknown'; }
    else if (isExpired)      { statusText = `${hoursOverdue}h over`; statusSub = 'Replace sensor';         statusBadge = 'Expired'; }
    else if (daysLeft === 1) { statusText = '1 day';                 statusSub = `${hoursLeft}h remaining`; statusBadge = 'Replace Soon'; }
    else                     { statusText = `${daysLeft} days`;      statusSub = `${hoursLeft}h remaining`; statusBadge = 'Active'; }

    const { popup } = this._makePopupShell('Sensor Life');

    const heroRow = document.createElement('div');
    heroRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    heroRow.innerHTML = `
      <div>
        <div style="font-size:34px;font-weight:700;letter-spacing:-1px;color:${pillColor};line-height:1;">${statusText}</div>
        <div style="margin-top:4px;font-size:12px;color:rgba(255,255,255,0.4);font-weight:500;">${statusSub}</div>
        <div style="margin-top:6px;">
          <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;background:${pillColor}22;color:${pillColor};border:1px solid ${pillColor}44;">
            ${statusBadge}
          </span>
        </div>
      </div>
      <div style="position:relative;width:72px;height:72px;flex-shrink:0;">
        <svg viewBox="0 0 88 88" width="72" height="72" style="position:absolute;top:0;left:0;">
          <circle cx="44" cy="44" r="34" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
          <circle cx="44" cy="44" r="34" fill="none" stroke="${pillColor}" stroke-width="5" stroke-linecap="round"
            style="stroke-dasharray:${circ};stroke-dashoffset:${(circ*(1-pct)).toFixed(2)};transform:rotate(-90deg);transform-origin:44px 44px;"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          ${isExpired
            ? `<span style="font-size:11px;font-weight:700;color:${pillColor};line-height:1;text-align:center;padding:4px;">${hoursOverdue}h<br><span style="font-size:7px;opacity:0.7;letter-spacing:0.04em;text-transform:uppercase;">over</span></span>`
            : `<span style="font-size:15px;font-weight:700;color:${pillColor};line-height:1;">${daysLeft ?? '?'}</span>
               <span style="font-size:8px;font-weight:600;color:${pillColor};opacity:0.7;margin-top:2px;text-transform:uppercase;letter-spacing:0.04em;">days</span>`
          }
        </div>
      </div>`;
    popup.appendChild(heroRow);

    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin-bottom:4px;';
    popup.appendChild(divider);

    const infoWrap = document.createElement('div');
    const rows = [
      { label: 'Applied',  value: fmtDateTime(startDate) },
      { label: 'Expires',  value: fmtDateTime(endDate)   },
      { label: 'Duration', value: `${duration} days`     },
    ];
    if (isExpired) {
      rows.push({ label: 'Overdue by', value: `${hoursOverdue} hour${hoursOverdue !== 1 ? 's' : ''}` });
    } else if (daysLeft !== null) {
      rows.push({ label: 'Time remaining', value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}, ${hoursLeft}h` });
    }
    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'dg-info-row';
      row.innerHTML = `<span class="dg-info-label">${label}</span><span class="dg-info-value">${value}</span>`;
      infoWrap.appendChild(row);
    });
    popup.appendChild(infoWrap);
  }

  // ── Prediction Popup ───────────────────────────────────────────────

  _openPredictionPopup() {
    const cfg        = this._config;
    const cache      = this._predictionCache;
    const predicted  = cache?.value ?? null;
    const current    = parseFloat(this._hass?.states[cfg.glucose_entity]?.state);
    const color      = predicted !== null ? this._getStatusColor(predicted) : cfg.accent_color;
    const lo         = this._lo();
    const hi         = this._hi();
    const unit       = this._unitLabel();
    const fmtVal     = predicted !== null ? this._formatPrediction(predicted) : '--';
    const isLow      = predicted !== null && predicted < lo;
    const isHigh     = predicted !== null && predicted > hi;
    const isInRange  = predicted !== null && !isLow && !isHigh;
    const noData     = predicted === null;

    let icon, headline, message, subMessage;

    if (noData) {
      icon       = '🔄';
      headline   = 'Calculating…';
      message    = 'Not enough recent data to estimate yet. Check back in a few minutes once more readings have come in.';
      subMessage = null;
    } else if (isLow) {
      icon       = '⚠️';
      headline   = 'Heads up — trending low';
      message    = "Your glucose looks like it could be heading lower over the next 30 minutes. Now\u2019s a good time to check in with yourself and have something nearby just in case.";
      subMessage = "If you\u2019re feeling any symptoms or are unsure, follow your personal care plan or speak with your healthcare team.";
    } else if (isHigh) {
      icon       = '💧';
      headline   = 'Trending a little high';
      message    = "It looks like your glucose may be on the higher side in 30 minutes. Staying hydrated and moving around a little can sometimes help \u2014 and it\u2019s worth keeping an eye on it.";
      subMessage = "If you\u2019re unsure what to do or this keeps happening, your healthcare team is the best person to ask.";
    } else {
      icon       = '✨';
      headline   = 'Looking good!';
      message    = "Your glucose looks like it should stay nicely in range over the next 30 minutes. Keep doing what you\u2019re doing!";
      subMessage = null;
    }

    const { popup } = this._makePopupShell('30‑Min Forecast');

    // ── Hero block ──
    const hero = document.createElement('div');
    hero.style.cssText = `display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;`;
    hero.innerHTML = `
      <div>
        <div style="font-size:38px;line-height:1;margin-bottom:6px;">${icon}</div>
        <div style="font-size:16px;font-weight:700;color:${color};letter-spacing:-0.3px;">${headline}</div>
        <div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.35);">Estimated in 30 minutes</div>
      </div>
      <div style="text-align:center;flex-shrink:0;margin-left:12px;">
        <div style="font-size:46px;font-weight:700;letter-spacing:-2px;line-height:1;color:${color};">${fmtVal}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:3px;">${unit}</div>
        ${predicted !== null ? `<div style="display:inline-block;margin-top:6px;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}44;">${isLow ? 'Low' : isHigh ? 'High' : 'In Range'}</div>` : ''}
      </div>`;
    popup.appendChild(hero);

    // ── Divider ──
    const div1 = document.createElement('div');
    div1.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin-bottom:14px;';
    popup.appendChild(div1);

    // ── Message card ──
    const msgCard = document.createElement('div');
    msgCard.style.cssText = `background:${color}12;border:1px solid ${color}30;border-radius:16px;padding:14px 16px;margin-bottom:${subMessage ? '10px' : '14px'};`;
    msgCard.innerHTML = `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.88);margin:0;">${message}</p>`;
    popup.appendChild(msgCard);

    if (subMessage) {
      const subCard = document.createElement('div');
      subCard.style.cssText = `background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:12px 16px;margin-bottom:14px;`;
      subCard.innerHTML = `<p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.50);margin:0;">${subMessage}</p>`;
      popup.appendChild(subCard);
    }

    // ── Info row: current vs predicted ──
    if (predicted !== null && !isNaN(current)) {
      const delta     = predicted - current;
      const deltaFmt  = (delta >= 0 ? '+' : '') + (cfg.unit === 'mgdl' ? Math.round(delta) : delta.toFixed(1));
      const infoWrap  = document.createElement('div');
      const rows = [
        { label: 'Current glucose', value: `${this._formatGlucose(current)} ${unit}` },
        { label: 'Estimated in 30 min', value: `${fmtVal} ${unit}` },
        { label: 'Projected change', value: `${deltaFmt} ${unit}` },
      ];
      rows.forEach(({ label, value }) => {
        const row = document.createElement('div');
        row.className = 'dg-info-row';
        row.innerHTML = `<span class="dg-info-label">${label}</span><span class="dg-info-value">${value}</span>`;
        infoWrap.appendChild(row);
      });
      popup.appendChild(infoWrap);
    }

    // ── Disclaimer ──
    const disc = document.createElement('div');
    disc.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);';
    disc.innerHTML = `<p style="font-size:10px;line-height:1.5;color:rgba(255,255,255,0.25);margin:0;text-align:center;">This is an estimate based on recent trends, not a medical reading. Always follow your personal care plan.</p>`;
    popup.appendChild(disc);
  }

  async _loadGraphInto(container, popupMode, hours) {
    if (!this._config.glucose_entity) return;
    const h = hours || this._config.graph_hours || 3;

    // Generation counter — discard responses that arrive after a newer request started
    if (!container._loadGen) container._loadGen = 0;
    const gen = ++container._loadGen;

    try {
      const end = new Date(), start = new Date(end - h * 3600000);
      const resp = await this._hass.callApi('GET',
        `history/period/${start.toISOString()}?filter_entity_id=${this._config.glucose_entity}&end_time=${end.toISOString()}&minimal_response=true&no_attributes=true`
      );
      if (container._loadGen !== gen) return; // a newer request is in flight — ignore this result
      if (resp?.[0]?.length > 0) {
        const data   = resp[0].filter(s => !isNaN(parseFloat(s.state)));
        const values = data.map(s => parseFloat(s.state));
        const times  = data.map(s => s.last_changed || s.last_updated);
        container.innerHTML = values.length >= 2 ? this._buildGraph(values, times, popupMode) : this._buildGraph([], [], popupMode);
        if (popupMode && values.length >= 2) {
          const svg = container.querySelector('svg');
          if (svg) this._attachGraphCrosshair(svg, values, times);
        }
      } else {
        container.innerHTML = this._buildGraph([], [], popupMode);
      }
    } catch {
      if (container._loadGen !== gen) return; // stale — ignore
      const cv = parseFloat(this._hass?.states[this._config.glucose_entity]?.state);
      container.innerHTML = !isNaN(cv)
        ? this._buildGraph(Array.from({length:20}, () => cv + (Math.random()-0.5)*0.5), null, popupMode)
        : this._buildGraph([], [], popupMode);
    }
  }

  // ── Graph crosshair (popup tap interaction) ───────────────────────

  _attachGraphCrosshair(svg, values, times) {
    const W    = 400, H = 160;
    const pad  = { top: 6, right: 8, bottom: 20, left: 30 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    const lo = this._lo(), hi = this._hi();
    const rawMin = Math.min(...values), rawMax = Math.max(...values);
    const vpad   = (rawMax - rawMin) * 0.15 || 1;
    const min    = Math.min(rawMin - vpad, lo * 0.85);
    const max    = Math.max(rawMax + vpad, hi * 1.1);
    const range  = max - min;

    let crosshairGroup = null;

    const fmtTime = ts => {
      if (!ts) return '';
      const d = new Date(ts);
      return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    };

    const clientXtoSvgX = clientX => {
      const rect   = svg.getBoundingClientRect();
      const scaleX = W / rect.width;
      return (clientX - rect.left) * scaleX;
    };

    const showCrosshair = svgX => {
      const cx       = Math.max(pad.left, Math.min(W - pad.right, svgX));
      const xRatio   = (cx - pad.left) / plotW;
      const exactIdx = xRatio * (values.length - 1);
      const lIdx     = Math.floor(exactIdx);
      const rIdx     = Math.min(lIdx + 1, values.length - 1);
      const frac     = exactIdx - lIdx;
      const val      = values[lIdx] + (values[rIdx] - values[lIdx]) * frac;
      const label    = this._config.unit === 'mgdl' ? Math.round(val).toString() : val.toFixed(1);
      const color    = this._getStatusColor(val);

      // Snap to nearest real data point for the timestamp
      const snapIdx  = frac < 0.5 ? lIdx : rIdx;
      const timeStr  = times ? fmtTime(times[snapIdx]) : '';
      const hasTime  = timeStr.length > 0;

      if (crosshairGroup) crosshairGroup.remove();
      crosshairGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      // Dotted vertical line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx.toFixed(1));
      line.setAttribute('y1', pad.top.toString());
      line.setAttribute('x2', cx.toFixed(1));
      line.setAttribute('y2', (pad.top + plotH).toString());
      line.setAttribute('stroke', 'rgba(255,255,255,0.75)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 3');

      // Pill dimensions — taller if we have a time row
      const lblW  = hasTime ? 52 : (this._config.unit === 'mgdl' ? 40 : 48);
      const lblH  = hasTime ? 34 : 20;
      const lblX  = Math.max(pad.left + lblW / 2, Math.min(W - pad.right - lblW / 2, cx));
      const lblY  = pad.top + 1;

      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('x',      (lblX - lblW / 2).toFixed(1));
      bgRect.setAttribute('y',      lblY.toFixed(1));
      bgRect.setAttribute('width',  lblW.toString());
      bgRect.setAttribute('height', lblH.toString());
      bgRect.setAttribute('rx',     '5');
      bgRect.setAttribute('fill',   'rgba(0,0,0,0.80)');
      bgRect.setAttribute('stroke', color);
      bgRect.setAttribute('stroke-width', '1.5');

      const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valText.setAttribute('x',           lblX.toFixed(1));
      valText.setAttribute('y',           (lblY + (hasTime ? 13 : 14)).toFixed(1));
      valText.setAttribute('fill',        color);
      valText.setAttribute('font-size',   '14');
      valText.setAttribute('font-weight', '700');
      valText.setAttribute('text-anchor', 'middle');
      valText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif");
      valText.textContent = label;

      crosshairGroup.appendChild(line);
      crosshairGroup.appendChild(bgRect);
      crosshairGroup.appendChild(valText);

      if (hasTime) {
        const timeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        timeText.setAttribute('x',           lblX.toFixed(1));
        timeText.setAttribute('y',           (lblY + 28).toFixed(1));
        timeText.setAttribute('fill',        'rgba(255,255,255,0.65)');
        timeText.setAttribute('font-size',   '10');
        timeText.setAttribute('font-weight', '500');
        timeText.setAttribute('text-anchor', 'middle');
        timeText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif");
        timeText.textContent = timeStr;
        crosshairGroup.appendChild(timeText);
      }

      svg.appendChild(crosshairGroup);
    };

    const clearCrosshair = () => {
      if (crosshairGroup) { crosshairGroup.remove(); crosshairGroup = null; }
    };

    svg.style.cursor = 'crosshair';

    svg.addEventListener('click', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < pad.left || svgX > W - pad.right) {
        clearCrosshair();
      } else {
        showCrosshair(svgX);
      }
    });

    svg.addEventListener('touchend', e => {
      e.stopPropagation();
      e.preventDefault();
      if (e.changedTouches.length > 0) {
        const svgX = clientXtoSvgX(e.changedTouches[0].clientX);
        if (svgX < pad.left || svgX > W - pad.right) {
          clearCrosshair();
        } else {
          showCrosshair(svgX);
        }
      }
    }, { passive: false });
  }

  // ── Render ─────────────────────────────────────────────────────────

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const accent = cfg.accent_color;
    const hexBg = cfg.card_bg || '#1c1c1e';
    let cardBgRgba;
    if (/^#[0-9a-fA-F]{8}$/.test(hexBg)) {
      const rr = parseInt(hexBg.slice(1,3),16), gg = parseInt(hexBg.slice(3,5),16), bb = parseInt(hexBg.slice(5,7),16);
      const aa = (parseInt(hexBg.slice(7,9),16) / 255).toFixed(3);
      cardBgRgba = `rgba(${rr},${gg},${bb},${aa})`;
    } else {
      const bgOpacity = (parseInt(cfg.card_bg_opacity) || 80) / 100;
      const rr = parseInt(hexBg.slice(1,3),16) || 0, gg = parseInt(hexBg.slice(3,5),16) || 0, bb = parseInt(hexBg.slice(5,7),16) || 0;
      cardBgRgba = `rgba(${rr},${gg},${bb},${bgOpacity})`;
    }
    const circ = 2 * Math.PI * 34;

    this.shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; }

        ha-card {
          background: ${cardBgRgba} !important;
          backdrop-filter: blur(40px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(40px) saturate(180%) !important;
          color: ${cfg.text_color} !important;
          border-radius: 20px !important;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
          border: 1px solid rgba(255,255,255,0.13) !important;
          box-shadow: 0 6px 24px rgba(0,0,0,0.35) !important;
          cursor: pointer;
          user-select: none; -webkit-user-select: none;
          transition: opacity 0.15s, transform 0.15s;
        }
        ha-card:active { transform: scale(0.993); opacity: 0.9; }

        .dg-inner { padding: 16px 20px 12px; }

        .dg-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .dg-title {
          font-size: 11px; font-weight: 700; letter-spacing: 0.07em;
          text-transform: uppercase; color: rgba(255,255,255,0.4);
        }
        .dg-time {
          font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.38);
          font-variant-numeric: tabular-nums; transition: color 0.4s;
        }

        /* Three-zone layout fills full card width */
        .dg-main-row {
          display: flex; align-items: center;
          justify-content: space-between;
        }

        /* LEFT ZONE */
        .dg-left-zone {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }
        .dg-ring-block {
          position: relative; flex-shrink: 0; width: 110px; height: 110px;
          cursor: pointer;
        }
        .dg-ring-block svg { position: absolute; top: 0; left: 0; }
        .dg-ring-center {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }
        .dg-glucose-num {
          font-size: 34px; font-weight: 700; letter-spacing: -2px;
          line-height: 1; transition: color 0.4s;
        }
        .dg-unit {
          font-size: 9px; font-weight: 600;
          color: rgba(255,255,255,0.38); margin-top: 3px;
        }
        .dg-status-badge {
          margin-top: 8px; padding: 3px 14px; border-radius: 20px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
          transition: background 0.4s, color 0.4s, border-color 0.4s;
        }

        /* Dividers between zones */
        .dg-divider {
          width: 1px; align-self: stretch;
          background: rgba(255,255,255,0.08);
          margin: 4px 0; flex-shrink: 0;
        }

        /* CENTRE ZONE — trend */
        .dg-centre-zone {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 4px;
          cursor: pointer; padding: 0 16px; gap: 6px;
        }
        .dg-trend-arrow {
          font-size: 44px; line-height: 1; transition: color 0.4s;
        }
        .dg-trend-label {
          font-size: 13px; font-weight: 600; transition: color 0.4s;
          text-align: center;
        }
        .dg-trend-sublabel {
          font-size: 10px; font-weight: 500;
          color: rgba(255,255,255,0.35); text-align: center;
        }

        /* RIGHT ZONE — pills stacked */
        .dg-right-zone {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px;
          padding: 0 16px;
        }
        .dg-sub-pill {
          display: flex; flex-direction: column; align-items: center;
          padding: 8px 20px; border-radius: 14px; width: auto;
          transition: background 0.4s, color 0.4s, border-color 0.4s;
          border: 1px solid rgba(255,255,255,0.10);
          cursor: pointer;
        }
        .dg-sub-pill-value {
          font-size: 22px; font-weight: 700; letter-spacing: -1px; line-height: 1;
        }
        .dg-sub-pill-label {
          font-size: 9px; font-weight: 600; letter-spacing: 0.05em;
          text-transform: uppercase; margin-top: 3px; opacity: 0.65;
        }

        .dg-graph-wrap {
          display: ${cfg.show_graph ? 'block' : 'none'};
          margin-top: 14px;
        }
        .dg-graph-inner { height: 90px; position: relative; overflow: visible; }
      </style>

      <ha-card id="dg-card">
        <div class="dg-inner">

          <div class="dg-header">
            <span class="dg-title" style="display:${cfg.show_title !== false ? '' : 'none'}">${cfg.title || 'Blood Sugar'}</span>
            <span class="dg-time" id="dg-time-ago">--</span>
          </div>

          <div class="dg-main-row">

            <!-- LEFT ZONE: glucose ring + status badge -->
            <div class="dg-left-zone">
              <div class="dg-ring-block">
                <svg viewBox="0 0 88 88" width="110" height="110">
                  <circle cx="44" cy="44" r="34" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
                  <circle id="dg-ring-arc" cx="44" cy="44" r="34"
                    fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"
                    style="stroke-dasharray:${circ};stroke-dashoffset:${circ*0.5};transform:rotate(-90deg);transform-origin:44px 44px;transition:stroke-dashoffset 0.7s ease,stroke 0.4s ease;"/>
                </svg>
                <div class="dg-ring-center">
                  <span class="dg-glucose-num" id="dg-glucose-num" style="color:${accent}"><span id="dg-glucose">--</span></span>
                  <span class="dg-unit" id="dg-unit">${this._unitLabel()}</span>
                </div>
              </div>
              <div class="dg-status-badge" id="dg-status-badge" style="background:${accent}22;color:${accent};border:1px solid ${accent}44;">--</div>
            </div>

            <div class="dg-divider"></div>

            <!-- CENTRE ZONE: trend arrow -->
            <div class="dg-centre-zone" id="dg-trend-row">
              <span class="dg-trend-arrow" id="dg-trend-arrow" style="color:rgba(255,255,255,0.25);">→</span>
              <div class="dg-trend-label" id="dg-trend-text" style="color:rgba(255,255,255,0.35);">--</div>
            </div>

            <div class="dg-divider"></div>

            <!-- RIGHT ZONE: pills stacked -->
            <div class="dg-right-zone">
              <div class="dg-sub-pill" id="dg-predict-pill" style="display:none;">
                <span class="dg-sub-pill-value" id="dg-predict-value">--</span>
                <span class="dg-sub-pill-label">30 min</span>
              </div>
              <div class="dg-sub-pill" id="dg-sensor-pill" style="display:none;">
                <span class="dg-sub-pill-value" id="dg-sensor-value">--</span>
                <span class="dg-sub-pill-label" id="dg-sensor-label">days left</span>
              </div>
            </div>

          </div>

          <div class="dg-graph-wrap" id="dg-graph-wrap">
            <div class="dg-graph-inner" id="dg-graph-inner">
              <div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.2);font-size:11px;">Loading…</div>
            </div>
          </div>

        </div>
      </ha-card>`;

    this._setupInteractions();
    this._updateCard();
  }

  // ── Interactions ──────────────────────────────────────────────────

  _setupInteractions() {
    const card = this.shadowRoot.getElementById('dg-card');
    if (!card) return;

    card.addEventListener('click', () => this._openPopup());

    const trendBlock = this.shadowRoot.getElementById('dg-trend-row');
    if (trendBlock) {
      trendBlock.addEventListener('click', e => { e.stopPropagation(); this._openTrendPopup(); });
    }

    const pillEl = this.shadowRoot.getElementById('dg-sensor-pill');
    if (pillEl) {
      pillEl.addEventListener('click', e => { e.stopPropagation(); this._openSensorPopup(); });
    }

    const predictPillEl = this.shadowRoot.getElementById('dg-predict-pill');
    if (predictPillEl) {
      predictPillEl.addEventListener('click', e => { e.stopPropagation(); this._openPredictionPopup(); });
    }
  }

  _fireMoreInfo() {
    const entityId = this._config.glucose_entity;
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
  }

  // ── Update ─────────────────────────────────────────────────────────

  _updateCard() {
    if (!this._hass || !this._config) return;
    const glucoseState = this._hass.states[this._config.glucose_entity];
    const trendState   = this._hass.states[this._config.trend_entity];
    const glucoseVal   = glucoseState?.state;
    const trendVal     = trendState?.state || trendState?.attributes?.trend || trendState?.attributes?.trend_description;
    const lastUpdate   = glucoseState?.last_changed || glucoseState?.last_updated;
    const root         = this.shadowRoot;
    const statusColor  = this._getStatusColor(glucoseVal);
    const trendInfo    = this._getTrendInfo(trendVal);
    const circ         = 2 * Math.PI * 34;

    const isUnavailable = !glucoseVal || glucoseVal === 'unavailable' || glucoseVal === 'unknown' || isNaN(parseFloat(glucoseVal));
    const displayColor  = isUnavailable ? 'rgba(255,255,255,0.28)' : statusColor;

    const glucoseEl = root.getElementById('dg-glucose');
    if (glucoseEl) glucoseEl.textContent = this._formatGlucose(glucoseVal);
    const numEl = root.getElementById('dg-glucose-num');
    if (numEl) numEl.style.color = displayColor;
    const unitEl = root.getElementById('dg-unit');
    if (unitEl) {
      unitEl.textContent = this._unitLabel();
      unitEl.style.color = isUnavailable ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.45)';
    }

    const ringEl    = root.getElementById('dg-ring-arc');
    const ringBlock = this.shadowRoot.querySelector('.dg-ring-block');
    if (ringEl && glucoseVal) {
      const n   = parseFloat(glucoseVal);
      const pct = Math.min(1, Math.max(0, (n - this._lo() * 0.6) / (this._hi() * 1.4 - this._lo() * 0.6)));
      ringEl.style.strokeDashoffset = circ * (1 - pct);
      ringEl.style.stroke = displayColor;
    }
    if (ringBlock) {
      ringBlock.style.setProperty('--dg-ring-color', displayColor);
    }

    const trendArrowEl = root.getElementById('dg-trend-arrow');
    const trendTextEl  = root.getElementById('dg-trend-text');
    if (trendArrowEl) {
      trendArrowEl.textContent = trendInfo ? this._trendArrow(trendInfo.deg) : '→';
      trendArrowEl.style.color = displayColor;
    }
    if (trendTextEl) {
      trendTextEl.textContent = trendInfo?.label || (trendVal ? trendVal : '--');
      trendTextEl.style.color = displayColor;
    }

    const badgeEl = root.getElementById('dg-status-badge');
    if (badgeEl) {
      badgeEl.textContent       = this._getStatusLabel(glucoseVal);
      badgeEl.style.background  = displayColor + '22';
      badgeEl.style.color       = displayColor;
      badgeEl.style.border      = `1px solid ${displayColor}44`;
    }

    const timeEl = root.getElementById('dg-time-ago');
    if (timeEl && lastUpdate) {
      const mins = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000);
      timeEl.textContent = mins < 1 ? 'Just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} mins ago` : `${Math.floor(mins/60)}h ago`;
      timeEl.style.color = mins > 15 ? this._config.high_color : 'rgba(255,255,255,0.38)';
    }

    // ── Sensor pill (centre, right pill) ────────────────────────────
    const sensorPillEl  = root.getElementById('dg-sensor-pill');
    const sensorValEl   = root.getElementById('dg-sensor-value');
    const sensorLblEl   = root.getElementById('dg-sensor-label');
    if (sensorPillEl) {
      const showPill = this._config.show_sensor_life && this._config.sensor_start_date;
      if (showPill) {
        const status       = this._getSensorStatus();
        const daysLeft     = status?.daysLeft ?? null;
        const hoursOverdue = status?.hoursOverdue ?? 0;
        const normalColor  = this._config.sensor_pill_normal_color || '#34C759';
        const urgentColor  = this._config.sensor_pill_urgent_color || '#FF3B30';
        const isExpired    = daysLeft !== null && daysLeft <= 0;
        const isUrgent     = daysLeft !== null && daysLeft <= 1;
        const pillCol      = isUrgent ? urgentColor : normalColor;
        const bg           = this._config.sensor_pill_bg || '#2c2c2e';
        let valTxt, lblTxt;
        if (daysLeft === null)  { valTxt = '?';                lblTxt = 'days left'; }
        else if (isExpired)     { valTxt = `${hoursOverdue}h`; lblTxt = 'overdue'; }
        else                    { valTxt = `${daysLeft}`;      lblTxt = 'days left'; }
        sensorPillEl.style.display     = 'flex';
        sensorPillEl.style.background  = bg;
        sensorPillEl.style.borderColor = pillCol + '55';
        if (sensorValEl) { sensorValEl.textContent = valTxt; sensorValEl.style.color = pillCol; }
        if (sensorLblEl) { sensorLblEl.textContent = lblTxt; sensorLblEl.style.color = pillCol; }
      } else {
        sensorPillEl.style.display = 'none';
      }
    }

    if (this._config.show_graph) {
      const graphInner = root.getElementById('dg-graph-inner');
      if (graphInner && !this._historyFetching) {
        this._historyFetching = true;
        this._loadGraphInto(graphInner, false, parseInt(this._config.graph_hours) || 3)
          .finally(() => { this._historyFetching = false; });
      }
    }

    // ── 30-minute prediction (centre, left pill) ─────────────────────
    const predictPill = root.getElementById('dg-predict-pill');
    const predictVal  = root.getElementById('dg-predict-value');
    if (predictPill && predictVal && this._config.glucose_entity) {
      predictPill.style.display = 'flex';
      const now = Date.now();
      const cacheAge = this._predictionCache ? now - this._predictionCache.timestamp : Infinity;
      if (this._predictionCache && cacheAge < 300000) {
        this._applyPredictionUI(predictPill, predictVal, this._predictionCache.value);
      } else if (!this._predictionFetching) {
        this._predictionFetching = true;
        this._fetchPrediction().then(val => {
          this._predictionCache = { value: val, timestamp: Date.now() };
          this._applyPredictionUI(predictPill, predictVal, val);
        }).finally(() => { this._predictionFetching = false; });
      }
    } else if (predictPill) {
      predictPill.style.display = 'none';
    }
  }

  _applyPredictionUI(pill, valEl, val) {
    const formatted = this._formatPrediction(val);
    valEl.textContent = formatted;
    if (val === null || isNaN(val)) {
      pill.style.background  = 'rgba(255,255,255,0.06)';
      pill.style.borderColor = 'rgba(255,255,255,0.10)';
      valEl.style.color = 'rgba(255,255,255,0.4)';
      const lbl = pill.querySelector('.dg-sub-pill-label');
      if (lbl) lbl.style.color = 'rgba(255,255,255,0.4)';
    } else {
      const color = this._getStatusColor(val);
      pill.style.background  = color + '1a';
      pill.style.borderColor = color + '55';
      valEl.style.color = color;
      const lbl = pill.querySelector('.dg-sub-pill-label');
      if (lbl) lbl.style.color = color;
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

    setVal('glucose_entity',       cfg.glucose_entity       || '');
    setVal('trend_entity',         cfg.trend_entity         || '');
    setVal('title',                cfg.title                || 'Blood Sugar');
    setVal('low_threshold',        cfg.low_threshold        ?? 3.9);
    setVal('high_threshold',       cfg.high_threshold       ?? 10.0);
    setVal('sensor_duration_days', cfg.sensor_duration_days ?? 14);

    const dtEl = root.getElementById('sensor_start_datetime');
    if (dtEl) {
      if (cfg.sensor_start_date) {
        const d = new Date(cfg.sensor_start_date);
        if (!isNaN(d.getTime())) {
          const pad = n => n.toString().padStart(2,'0');
          dtEl.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      } else {
        const now = new Date();
        const pad = n => n.toString().padStart(2,'0');
        dtEl.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
    }
    setChk('show_graph',       cfg.show_graph       !== false);
    setChk('show_title',       cfg.show_title       !== false);
    setChk('show_sensor_life', cfg.show_sensor_life === true);

    root.querySelectorAll('input[name="unit"]').forEach(r => { r.checked = r.value === (cfg.unit || 'mmol'); });
    root.querySelectorAll('input[name="graph_hours"]').forEach(r => { r.checked = parseInt(r.value) === parseInt(cfg.graph_hours || 3); });

    const graphSection  = root.getElementById('graph_hours_section');
    const sensorSection = root.getElementById('sensor_life_section');
    if (graphSection)  graphSection.style.display  = cfg.show_graph       !== false ? '' : 'none';
    if (sensorSection) sensorSection.style.display = cfg.show_sensor_life === true  ? '' : 'none';

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
      { key: 'accent_color',             label: 'Accent',             desc: 'Ring & icon highlight',                                                        default: '#007AFF', maxlen: 7 },
      { key: 'normal_color',             label: 'In Range',            desc: 'Colour when glucose is in range',                                              default: '#34C759', maxlen: 7 },
      { key: 'low_color',                label: 'Low Alert',           desc: 'Colour when glucose is low',                                                   default: '#FF3B30', maxlen: 7 },
      { key: 'high_color',               label: 'High Alert',          desc: 'Colour when glucose is high',                                                  default: '#FF9500', maxlen: 7 },
      { key: 'graph_line_color',         label: 'Graph Line',          desc: 'Graph line colour',                                                            default: '#007AFF', maxlen: 7 },
      { key: 'graph_fill_color',         label: 'Graph Fill',          desc: 'Graph area fill colour',                                                       default: '#007AFF', maxlen: 7 },
      { key: 'sensor_pill_bg',           label: 'Sensor Pill BG',      desc: 'Sensor life pill background',                                                  default: '#2c2c2e', maxlen: 9 },
      { key: 'sensor_pill_normal_color', label: 'Sensor — Normal',     desc: 'Pill text colour when days remain',                                            default: '#34C759', maxlen: 7 },
      { key: 'sensor_pill_urgent_color', label: 'Sensor — Last Day',   desc: 'Pill text colour when 1 day or less left',                                     default: '#FF3B30', maxlen: 7 },
      { key: 'card_bg',                  label: 'Card Background',     desc: '#00000000 = transparent glass. 8-digit hex for custom opacity — e.g. #1c1c1e80', default: '#1c1c1e', maxlen: 9 },
      { key: 'text_color',               label: 'Text Colour',         desc: 'Primary text colour',                                                          default: '#ffffff', maxlen: 7 },
    ];
  }

  _buildEditor() {
    const hass = this._hass, cfg = this._config;

    const glucoseKeywords = ['glucose', 'blood_sugar', 'blood sugar', 'cgm', 'dexcom', 'nightscout', 'xdrip', 'sugar', 'libre', 'mg_dl', 'mmol'];
    const trendKeywords   = ['trend', 'direction', 'arrow', 'slope'];

    const allEntities = Object.keys(hass.states).sort();

    const scoreEntity = (id, keywords) => {
      const name  = (hass.states[id]?.attributes?.friendly_name || '').toLowerCase();
      const idLow = id.toLowerCase();
      return keywords.reduce((s, k) => s + (idLow.includes(k) || name.includes(k) ? 1 : 0), 0);
    };

    const glucoseCandidates = allEntities
      .filter(e => e.startsWith('sensor.') && !isNaN(parseFloat(hass.states[e]?.state)))
      .map(e => ({ e, score: scoreEntity(e, glucoseKeywords) }))
      .sort((a, b) => b.score - a.score || a.e.localeCompare(b.e));

    const trendCandidates = allEntities
      .filter(e => e.startsWith('sensor.'))
      .map(e => ({ e, score: scoreEntity(e, trendKeywords) }))
      .sort((a, b) => b.score - a.score || a.e.localeCompare(b.e));

    let glucoseVal = cfg.glucose_entity || '';
    let trendVal   = cfg.trend_entity   || '';
    if (!glucoseVal && glucoseCandidates.length && glucoseCandidates[0].score > 0) {
      glucoseVal = glucoseCandidates[0].e;
      this._updateConfig('glucose_entity', glucoseVal);
    }
    if (!trendVal && trendCandidates.length && trendCandidates[0].score > 0) {
      trendVal = trendCandidates[0].e;
      this._updateConfig('trend_entity', trendVal);
    }

    const buildOptions = (candidates, allSensorEntities, selectedVal) => {
      const candidateIds = new Set(candidates.map(c => c.e));
      const suggested = candidates.map(({ e }) => {
        const name = hass.states[e]?.attributes?.friendly_name || e;
        return `<option value="${e}" ${e === selectedVal ? 'selected' : ''}>${name} (${e})</option>`;
      }).join('');
      const rest = allSensorEntities
        .filter(e => !candidateIds.has(e))
        .map(e => {
          const name = hass.states[e]?.attributes?.friendly_name || e;
          return `<option value="${e}" ${e === selectedVal ? 'selected' : ''}>${name} (${e})</option>`;
        }).join('');
      const divider = suggested && rest ? `<option disabled>──────────────────</option>` : '';
      return `<option value="">— None —</option>${suggested}${divider}${rest}`;
    };

    const allSensors     = allEntities.filter(e => e.startsWith('sensor.'));
    const glucoseOptions = buildOptions(glucoseCandidates, allSensors, glucoseVal);
    const trendOptions   = buildOptions(trendCandidates,   allSensors, trendVal);
    const COLOUR_FIELDS  = this._getColourFields();
    const isMMol         = cfg.unit !== 'mgdl';

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
        .entity-search {
          background: var(--secondary-background-color,rgba(0,0,0,0.06));
          color: var(--primary-text-color); border: 1px solid rgba(128,128,128,0.2);
          border-radius: 8px 8px 0 0; border-bottom: none;
          padding: 8px 12px; font-size: 12px; width: 100%;
          outline: none; font-family: inherit;
        }
        .entity-search::placeholder { color: rgba(128,128,128,0.6); }
        .entity-search + select { border-radius: 0 0 8px 8px; }
        select, input[type="text"], input[type="number"] {
          width: 100%; background: var(--secondary-background-color,rgba(0,0,0,0.06));
          color: var(--primary-text-color); border: 1px solid rgba(128,128,128,0.2);
          border-radius: 8px; padding: 9px 12px; font-size: 13px;
          -webkit-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
        }
        input[type="text"], input[type="number"] { background-image: none; padding-right: 12px; cursor: text; }
        input[type="date"], input[type="datetime-local"] {
          background-image: none; padding-right: 12px; cursor: pointer;
          -webkit-appearance: auto; appearance: auto; color-scheme: dark;
        }
        .sensor-confirm-btn {
          width: 100%; padding: 11px 16px; border-radius: 10px; border: none;
          background: #007AFF; color: #fff; font-size: 13px; font-weight: 700;
          cursor: pointer; font-family: inherit; letter-spacing: 0.02em;
          transition: background 0.15s, opacity 0.15s; margin-top: 6px;
          display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .sensor-confirm-btn:hover  { background: #0066d6; }
        .sensor-confirm-btn:active { opacity: 0.8; }
        .sensor-confirm-btn.saved  { background: #34C759; }
        .toggle-list { display: flex; flex-direction: column; }
        .toggle-item { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid rgba(128,128,128,0.1); min-height: 52px; }
        .toggle-item:last-child { border-bottom: none; }
        .toggle-label { font-size: 14px; font-weight: 500; flex: 1; padding-right: 12px; }
        .toggle-sublabel { font-size: 11px; color: #888; margin-top: 1px; }
        .toggle-switch { position: relative; width: 51px; height: 31px; flex-shrink: 0; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .toggle-track { position: absolute; inset: 0; border-radius: 31px; background: rgba(120,120,128,0.32); cursor: pointer; transition: background 0.25s; }
        .toggle-track::after { content:''; position:absolute; width:27px; height:27px; border-radius:50%; background:#fff; top:2px; left:2px; box-shadow:0 2px 6px rgba(0,0,0,0.3); transition:transform 0.25s; }
        .toggle-switch input:checked + .toggle-track { background:#34C759; }
        .toggle-switch input:checked + .toggle-track::after { transform:translateX(20px); }
        .segmented { display:flex; background:rgba(118,118,128,0.18); border-radius:9px; padding:2px; gap:2px; }
        .segmented input[type="radio"] { display:none; }
        .segmented label { flex:1; text-align:center; padding:8px 4px; font-size:13px; font-weight:500; border-radius:7px; cursor:pointer; color:var(--primary-text-color); transition:all 0.2s; }
        .segmented input[type="radio"]:checked + label { background:#007AFF; color:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.3); }
        .input-row { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .threshold-row { display:flex; gap:12px; }
        .threshold-row > div { flex:1; display:flex; flex-direction:column; gap:4px; }
        .threshold-row label { font-size:11px; font-weight:600; color:#888; }
        .colour-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .colour-card { border:1px solid var(--divider-color,rgba(0,0,0,0.12)); border-radius:10px; overflow:hidden; cursor:pointer; transition:box-shadow 0.15s,border-color 0.15s; }
        .colour-card:hover { box-shadow:0 2px 10px rgba(0,0,0,0.12); border-color:var(--primary-color,#007AFF); }
        .colour-swatch { height:44px; width:100%; display:block; position:relative; }
        .colour-swatch input[type="color"] { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:none; padding:0; }
        .colour-swatch-preview { position:absolute; inset:0; pointer-events:none; }
        .colour-swatch::before { content:''; position:absolute; inset:0; background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%); background-size:8px 8px; background-position:0 0,0 4px,4px -4px,-4px 0; opacity:0.3; pointer-events:none; }
        .colour-info { padding:6px 8px 7px; background:var(--card-background-color,#fff); }
        .colour-label { font-size:11px; font-weight:700; color:var(--primary-text-color); margin-bottom:1px; }
        .colour-desc { font-size:10px; color:var(--secondary-text-color,#6b7280); margin-bottom:4px; line-height:1.3; }
        .colour-hex-row { display:flex; align-items:center; gap:4px; }
        .colour-dot { width:12px; height:12px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); flex-shrink:0; }
        .colour-hex { flex:1; font-size:11px; font-family:monospace; border:none; background:none; color:var(--secondary-text-color,#6b7280); padding:0; width:0; min-width:0; }
        .colour-hex:focus { outline:none; color:var(--primary-text-color); }
        .colour-edit-icon { opacity:0; transition:opacity 0.15s; color:var(--secondary-text-color); font-size:14px; line-height:1; }
        .colour-card:hover .colour-edit-icon { opacity:1; }
        .opacity-row { padding:12px 16px; display:flex; align-items:center; gap:12px; }
        .opacity-row label { font-size:13px; font-weight:600; flex-shrink:0; }
        .opacity-row input[type="range"] { flex:1; height:5px; accent-color:#007AFF; background:none; border:none; padding:0; cursor:pointer; -webkit-appearance:auto; appearance:auto; background-image:none; }
        .opacity-val { font-size:12px; color:#888; font-variant-numeric:tabular-nums; width:32px; text-align:right; flex-shrink:0; }
      </style>

      <div class="container">

        <div>
          <div class="section-title">Sensor Entities</div>
          <div class="hint" style="margin-bottom:6px;">Suggested sensors appear first. Type to filter the list.</div>
          <div class="card-block">
            <div class="select-row">
              <label>Blood Glucose Sensor</label>
              <input class="entity-search" id="glucose_search" placeholder="🔍  Filter sensors…" autocomplete="off" spellcheck="false">
              <select id="glucose_entity">${glucoseOptions}</select>
            </div>
            <div class="select-row" style="border-top:1px solid rgba(128,128,128,0.1)">
              <label>Trend Sensor</label>
              <input class="entity-search" id="trend_search" placeholder="🔍  Filter sensors…" autocomplete="off" spellcheck="false">
              <select id="trend_entity">${trendOptions}</select>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Glucose Unit</div>
          <div class="card-block" style="padding:12px;">
            <div class="segmented">
              <input type="radio" name="unit" id="unit_mmol" value="mmol" ${isMMol ? 'checked' : ''}><label for="unit_mmol">mmol/L</label>
              <input type="radio" name="unit" id="unit_mgdl" value="mgdl" ${!isMMol ? 'checked' : ''}><label for="unit_mgdl">mg/dL</label>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Alert Thresholds</div>
          <div class="card-block">
            <div class="input-row">
              <div class="hint" style="margin-bottom:4px;">Readings outside these values trigger Low / High alert colours</div>
              <div class="threshold-row">
                <div>
                  <label>Low — below</label>
                  <input type="number" id="low_threshold" step="${isMMol ? '0.1' : '1'}" min="0" value="${cfg.low_threshold ?? (isMMol ? 3.9 : 70)}">
                </div>
                <div>
                  <label>High — above</label>
                  <input type="number" id="high_threshold" step="${isMMol ? '0.1' : '1'}" min="0" value="${cfg.high_threshold ?? (isMMol ? 10.0 : 180)}">
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Display Options</div>
          <div class="card-block">
            <div class="toggle-list">
              <div class="toggle-item">
                <div><div class="toggle-label">Show Title</div></div>
                <label class="toggle-switch">
                  <input type="checkbox" id="show_title" ${cfg.show_title !== false ? 'checked' : ''}><span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Show Blood Sugar Graph</div>
                  <div class="toggle-sublabel">Displays recent history on the card</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="show_graph" ${cfg.show_graph !== false ? 'checked' : ''}><span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Show Sensor Life</div>
                  <div class="toggle-sublabel">Days remaining pill between the two rings</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="show_sensor_life" ${cfg.show_sensor_life ? 'checked' : ''}><span class="toggle-track"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div id="sensor_life_section" style="${cfg.show_sensor_life ? '' : 'display:none'}">
          <div class="section-title">Sensor Life</div>
          <div class="card-block">
            <div class="input-row">
              <div class="hint" style="margin-bottom:8px;">Set the exact date and time you applied the sensor. Press <strong>Confirm</strong> to save — this prevents accidental changes while editing other settings.</div>
              <label style="font-size:11px;font-weight:600;color:#888;margin-bottom:4px;display:block;">Sensor applied (date &amp; time)</label>
              <input type="datetime-local" id="sensor_start_datetime">
              <label style="font-size:11px;font-weight:600;color:#888;margin-top:10px;margin-bottom:4px;display:block;">Sensor lasts (days)</label>
              <input type="number" id="sensor_duration_days" min="1" max="30" step="1" value="${cfg.sensor_duration_days ?? 14}">
              <button class="sensor-confirm-btn" id="sensor_confirm_btn">✓ &nbsp;Confirm sensor start time</button>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Card Title Text</div>
          <div class="card-block">
            <div class="input-row">
              <input type="text" id="title" placeholder="Blood Sugar" value="${cfg.title || 'Blood Sugar'}">
            </div>
          </div>
        </div>

        <div id="graph_hours_section" style="${cfg.show_graph !== false ? '' : 'display:none'}">
          <div class="section-title">Default Graph Time Range</div>
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

        <div>
          <div class="section-title">Colours</div>
          <div class="card-block" style="padding:10px;">
            <div class="colour-grid" id="colour-grid"></div>
          </div>
        </div>

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
            <input class="colour-hex" type="text" value="${savedVal}" maxlength="${field.maxlen || 7}" placeholder="${field.default}" spellcheck="false">
            <span class="colour-edit-icon">✎</span>
          </div>
        </div>`;
      const picker  = card.querySelector('input[type=color]');
      const hexIn   = card.querySelector('.colour-hex');
      const preview = card.querySelector('.colour-swatch-preview');
      const dot     = card.querySelector('.colour-dot');
      const apply = val => {
        preview.style.background = val; dot.style.background = val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) picker.value = val;
        hexIn.value = val;
        this._updateConfig(field.key, val);
      };
      picker.addEventListener('input',  () => apply(picker.value));
      picker.addEventListener('change', () => apply(picker.value));
      hexIn.addEventListener('input',   () => { const v = hexIn.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{8}$/.test(v)) apply(v); });
      hexIn.addEventListener('blur',    () => { const cur = this._config[field.key] || field.default; if (!/^#[0-9a-fA-F]{6,8}$/.test(hexIn.value.trim())) hexIn.value = cur; });
      hexIn.addEventListener('keydown', e => { if (e.key === 'Enter') hexIn.blur(); });
      grid.appendChild(card);
    }

    this._setupListeners();

    // Wire search filters
    const root2 = this.shadowRoot;
    const wireSearch = (searchId, selectId, allData) => {
      const searchEl = root2.getElementById(searchId);
      const selectEl = root2.getElementById(selectId);
      if (!searchEl || !selectEl) return;
      searchEl.addEventListener('input', () => {
        const term    = searchEl.value.toLowerCase().trim();
        const current = selectEl.value;
        const matches = term
          ? allData.filter(d => d.id.toLowerCase().includes(term) || d.name.toLowerCase().includes(term))
          : allData;
        selectEl.innerHTML = `<option value="">— None —</option>` +
          matches.map(d =>
            `<option value="${d.id}" ${d.id === current ? 'selected' : ''}>${d.suggested ? '★ ' : ''}${d.name} (${d.id})</option>`
          ).join('');
      });
    };

    const allSensors2  = Object.keys(hass.states)
      .filter(e => e.startsWith('sensor.')).sort()
      .map(e => ({ id: e, name: hass.states[e]?.attributes?.friendly_name || e, suggested: false }));
    const scoreKw      = (id, name, kws) => kws.reduce((s, k) => s + (id.includes(k) || name.includes(k) ? 1 : 0), 0);
    const glucoseKws   = ['glucose','blood_sugar','blood sugar','cgm','dexcom','nightscout','xdrip','sugar','libre','mg_dl','mmol'];
    const trendKws     = ['trend','direction','arrow','slope'];
    const glucoseData2 = allSensors2.map(d => ({ ...d, suggested: scoreKw(d.id.toLowerCase(), d.name.toLowerCase(), glucoseKws) > 0 }))
      .sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) || a.id.localeCompare(b.id));
    const trendData2   = allSensors2.map(d => ({ ...d, suggested: scoreKw(d.id.toLowerCase(), d.name.toLowerCase(), trendKws) > 0 }))
      .sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) || a.id.localeCompare(b.id));

    wireSearch('glucose_search', 'glucose_entity', glucoseData2);
    wireSearch('trend_search',   'trend_entity',   trendData2);

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
    get('show_sensor_life').onchange = e => {
      this._updateConfig('show_sensor_life', e.target.checked);
      const s = root.getElementById('sensor_life_section');
      if (s) s.style.display = e.target.checked ? '' : 'none';
      if (e.target.checked) {
        const dtEl = root.getElementById('sensor_start_datetime');
        if (dtEl && !this._config.sensor_start_date) {
          const now = new Date();
          const pad = n => n.toString().padStart(2,'0');
          dtEl.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        }
      }
    };

    const confirmBtn = root.getElementById('sensor_confirm_btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const dtEl = root.getElementById('sensor_start_datetime');
        if (!dtEl || !dtEl.value) return;
        const iso = new Date(dtEl.value).toISOString();
        this._updateConfig('sensor_start_date', iso);
        confirmBtn.classList.add('saved');
        confirmBtn.textContent = '✓  Saved!';
        setTimeout(() => { confirmBtn.classList.remove('saved'); confirmBtn.innerHTML = '✓ &nbsp;Confirm sensor start time'; }, 2000);
      });
    }

    get('sensor_duration_days').onchange = e => this._updateConfig('sensor_duration_days', parseInt(e.target.value));
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
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
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