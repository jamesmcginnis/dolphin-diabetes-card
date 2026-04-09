/**
 * Crab Camera Card
 * Scrollable camera card for Home Assistant
 * https://github.com/jamesmcginnis/crab-camera-card
 */

// ════════════════════════════════════════════════════════════════
//  SHARED LIVE-CAMERA FILTER
// ════════════════════════════════════════════════════════════════
function isLiveCamera(hass, id) {
  const state = hass?.states[id];
  if (!state) return false;
  const attrs      = state.attributes || {};
  const streamType = attrs.frontend_stream_type;

  if (streamType === 'hls' || streamType === 'web_rtc') return true;
  if (streamType !== undefined && streamType !== null && streamType !== '') return false;
  if (!attrs.access_token) return false;

  const eid  = id.toLowerCase();
  const name = (attrs.friendly_name || '').toLowerCase();
  const PATTERNS = [
    '_snapshot','_snapshots','_still','_stills',
    '_recording','_recordings','_clip','_clips',
    '_detection','_detections','_thumbnail','_thumbnails',
    '_last_','last_recording','_event',
  ];
  for (const p of PATTERNS) {
    if (eid.includes(p) || name.includes(p)) return false;
  }
  const WORDS  = ['snapshot','recording','detection','thumbnail','clip','still'];
  const tokens = name.split(/[\s_\-]+/);
  for (const w of WORDS) {
    if (tokens.includes(w)) return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
//  MAIN CARD
// ════════════════════════════════════════════════════════════════
class CrabCameraCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass           = null;
    this._config         = null;
    this._prevPictures   = {};  // last-seen entity_picture per camera
    this._popupEl        = null;
    this._popupKey       = null;
    this._popupMuted     = true;
    this._streamEl       = null;
    this._fsListeners    = null;
    this._pollTimer      = null;
    this._refreshTimer   = null;
    this._renderedMode   = null;
    this._renderedEnts   = null;
  }

  static getConfigElement() { return document.createElement('crab-camera-card-editor'); }

  static getStubConfig() {
    return {
      entities:          [],
      title:             'Cameras',
      show_title:        true,
      thumbnail_mode:    'still',
      show_camera_names: true,
      show_status_dot:   true,
      refresh_interval:  30,
    };
  }

  setConfig(config) {
    this._config = {
      title:             'Cameras',
      show_title:        true,
      thumbnail_mode:    'still',
      show_camera_names: true,
      show_status_dot:   true,
      refresh_interval:  30,
      ...config,
    };
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;

    const mode    = this._config?.thumbnail_mode || 'still';
    const entsKey = JSON.stringify(this._config?.entities || []);
    const needsRender =
      !this._renderedMode ||
      this._renderedMode !== mode ||
      this._renderedEnts !== entsKey;

    if (needsRender) {
      this._render();
    } else {
      this._updateLiveHass();
      this._updateStillImages();
      this._updateDots();
    }
  }

  connectedCallback()    { /* updates driven by hass */ }
  disconnectedCallback() { this._stopRefreshTimer(); this._destroyPopup(); }

  // ── URL helpers ──────────────────────────────────────────────
  _stillUrl(id) {
    const tok = this._hass?.states[id]?.attributes?.access_token || '';
    return `/api/camera_proxy/${id}?token=${tok}&_t=${Date.now()}`;
  }

  _imgId(id)    { return 'crab-img-'    + id.replace(/[.\-]/g, '_'); }
  _streamId(id) { return 'crab-stream-' + id.replace(/[.\-]/g, '_'); }
  _tsId(id)     { return 'crab-ts-'     + id.replace(/[.\-]/g, '_'); }

  // Return a short "HH:MM" time string for when the still image was last updated.
  // Watches the companion still entity if one exists, otherwise the live entity itself.
  _getLastUpdatedTime(id) {
    const stillId    = this._findStillEntity(id);
    const watchState = stillId
      ? this._hass?.states[stillId]
      : this._hass?.states[id];
    const raw = watchState?.last_updated;
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Find companion still/recording entity for a live camera ─────
  // Example: camera.back_yard_camara_live_view  →  camera.back_yard_camara_last_recording
  // Strategy: strip any known live suffix to get the shared base name,
  // then probe for known still suffixes on that base.
  _findStillEntity(liveId) {
    const states = this._hass?.states || {};
    const LIVE_SUFFIXES  = ['_live_view', '_live_feed', '_live_stream', '_live', '_stream'];
    const STILL_SUFFIXES = [
      '_last_recording', '_last_snapshot', '_snapshot',
      '_still', '_thumbnail', '_recording', '_clip', '_detection',
    ];

    // 1. Try still suffixes directly on the live id (simple naming schemes)
    for (const ss of STILL_SUFFIXES) {
      if (states[liveId + ss]) return liveId + ss;
    }

    // 2. Strip live suffix → base, then probe still suffixes
    for (const ls of LIVE_SUFFIXES) {
      if (liveId.endsWith(ls)) {
        const base = liveId.slice(0, -ls.length);
        for (const ss of STILL_SUFFIXES) {
          if (states[base + ss]) return base + ss;
        }
        break; // matched a live suffix, no point continuing
      }
    }

    return null;
  }

  // ── Build the still image src for a tile ─────────────────────
  // Uses the companion still entity's camera proxy URL (with cache-bust)
  // so the browser always fetches a fresh frame from HA.
  _stillSrc(liveId) {
    const stillId = this._findStillEntity(liveId);
    if (stillId) {
      const tok = this._hass?.states[stillId]?.attributes?.access_token || '';
      return `/api/camera_proxy/${stillId}?token=${tok}&_t=${Date.now()}`;
    }
    // Fallback: use the live camera's own proxy
    return this._stillUrl(liveId);
  }

  _dotClass(online) {
    if (!online) return 'offline';
    return this._config?.thumbnail_mode === 'live' ? 'live' : 'still';
  }

  // Strip common suffixes/prefixes that camera integrations append to friendly names,
  // e.g. "Kitchen Camera Live View" → "Kitchen Camera"
  _cleanName(raw) {
    return raw
      .replace(/[\s\-_]*(live\s*view|live\s*feed|live\s*stream|live)[\s\-_]*$/i, '')
      .replace(/[\s\-_]*(snapshot|still|recording|clip|thumbnail)[\s\-_]*$/i, '')
      .replace(/^\s+|\s+$/g, '') // trim
      || raw; // fallback to original if stripping removed everything
  }

  // ── Full render ──────────────────────────────────────────────
  _render() {
    if (!this._hass || !this._config) return;

    const { entities = [], show_title, title, thumbnail_mode } = this._config;
    const isLive = thumbnail_mode === 'live';

    this._renderedMode   = thumbnail_mode;
    this._renderedEnts   = JSON.stringify(entities);
    this._prevPictures   = {};

    // Seed _prevPictures so the first hass update after render doesn't
    // redundantly re-fetch images that haven't changed.
    // Watch the companion still entity (if found) rather than the live camera.
    if (!isLive) {
      entities.forEach(id => {
        const stillId    = this._findStillEntity(id);
        const watchState = stillId
          ? this._hass?.states[stillId]
          : this._hass?.states[id];
        if (watchState?.last_updated) this._prevPictures[id] = watchState.last_updated;
      });
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 12px 0; }

        .card-header {
          padding: 16px 16px 6px;
          font-size: 17px; font-weight: 600;
          color: var(--primary-text-color);
          letter-spacing: -0.3px;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
        }

        .scroll-wrap {
          display: flex; gap: 10px;
          overflow-x: auto; overflow-y: hidden;
          padding: 0 12px 0 0;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x proximity;
          scrollbar-width: none;
        }
        .scroll-wrap::-webkit-scrollbar { display: none; }
        .scroll-fade { position: relative; }
        .scroll-fade::after {
          content: ''; position: absolute;
          top: 0; right: 0; bottom: 0; width: 32px;
          background: linear-gradient(to right, transparent,
            var(--ha-card-background, var(--card-background-color, #1c1c1e)));
          pointer-events: none; z-index: 2;
          border-radius: 0 16px 16px 0;
        }

        .cam-tile {
          flex: 0 0 auto; width: 160px;
          display: flex; flex-direction: column; gap: 6px;
          cursor: pointer; scroll-snap-align: start;
          -webkit-tap-highlight-color: transparent;
          user-select: none; -webkit-user-select: none;
        }
        .cam-wrap {
          position: relative; width: 160px; height: 120px;
          border-radius: 13px; overflow: hidden; background: #111;
          transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.14s ease;
        }
        .cam-tile:active .cam-wrap {
          transform: scale(0.94);
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }

        /* Still-mode image */
        .cam-img {
          width: 100%; height: 100%;
          object-fit: cover; display: block;
          -webkit-touch-callout: none;
          user-select: none; -webkit-user-select: none;
          pointer-events: none;
        }
        .cam-img-shield {
          position: absolute; inset: 0; z-index: 1;
          -webkit-touch-callout: none;
          user-select: none; -webkit-user-select: none;
          pointer-events: none;
        }

        /* Live stream slot — suppress any internal text/labels from ha-camera-stream */
        .cam-stream-slot {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          background: #111;
          overflow: hidden;
        }
        /* Hide the "LIVE" badge / chip that ha-camera-stream renders internally.
           These selectors target the known internal class names. */
        .cam-stream-slot ha-camera-stream {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          display: block;
          pointer-events: none;
          --ha-camera-stream-background: #111;
          /* Suppress internal controls overlay */
          --ha-camera-stream-controls-display: none;
        }

        .cam-gradient {
          position: absolute; bottom: 0; left: 0; right: 0; height: 55%;
          background: linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%);
          pointer-events: none; z-index: 1;
        }

        .cam-dot {
          position: absolute; top: 8px; right: 8px;
          width: 8px; height: 8px; border-radius: 50%;
          z-index: 3; pointer-events: none;
        }
        .cam-dot.live    { background:#34C759; box-shadow:0 0 0 1.5px rgba(0,0,0,.4),0 0 8px rgba(52,199,89,.8); }
        .cam-dot.still   { background:#FFD60A; box-shadow:0 0 0 1.5px rgba(0,0,0,.4),0 0 7px rgba(255,214,10,.7); }
        .cam-dot.offline { background:#FF3B30; box-shadow:0 0 0 1.5px rgba(0,0,0,.4),0 0 7px rgba(255,59,48,.7); }

        .cam-name {
          font-size: 12px; font-weight: 500;
          color: var(--primary-text-color);
          text-align: center;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          opacity: .88; padding: 0 4px;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
        }

        .cam-offline {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px;
          background: rgba(12,12,12,.93);
        }
        .cam-offline-msg {
          font-size: 11px; font-weight: 700; color: #FF3B30;
          letter-spacing: .04em; text-align: center;
          padding: 0 10px; line-height: 1.4;
          word-break: break-word;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        }

        .cam-timestamp {
          position: absolute; top: 7px; right: 7px;
          z-index: 4; pointer-events: none;
          background: rgba(0,0,0,0.52);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          color: rgba(255,255,255,0.92);
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.02em;
          padding: 2px 7px;
          border-radius: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
          white-space: nowrap;
          border: 0.5px solid rgba(255,255,255,0.13);
        }

        .empty-msg {
          padding: 28px 16px; text-align: center;
          color: var(--secondary-text-color, rgba(255,255,255,.4));
          font-size: 14px;
        }
      </style>

      <ha-card style="padding-left:12px">
        ${show_title !== false && title ? `<div class="card-header">${title}</div>` : ''}
        ${entities.length === 0
          ? `<div class="empty-msg">No cameras configured — open the editor to add cameras.</div>`
          : `<div class="scroll-wrap scroll-fade" id="crabScroll">${entities.map(id => this._tileHtml(id, isLive)).join('')}</div>`}
      </ha-card>`;

    if (entities.length > 0) {
      if (isLive) this._mountLiveStreams();
      this._bindTiles();
    }
    this._startRefreshTimer();
  }

  // ── Tile HTML ────────────────────────────────────────────────
  _tileHtml(id, isLive) {
    const state    = this._hass?.states[id];
    const rawName  = state?.attributes?.friendly_name
                     || id.split('.').slice(1).join('.').replace(/_/g, ' ');
    const name     = this._cleanName(rawName);
    const online   = state && state.state !== 'unavailable';
    const showDot  = this._config.show_status_dot !== false;
    const showName = this._config.show_camera_names !== false;
    const dotCls   = this._dotClass(online);

    let inner;
    if (!state || !online) {
      // Offline overlay — no timestamp, no stream
      inner = `<div class="cam-offline">
        <span class="cam-offline-msg">Camera Offline</span>
      </div>`;
    } else if (isLive) {
      // Live mode — ha-camera-stream mounted programmatically after innerHTML is set.
      // No timestamp pill in live mode (stream is real-time).
      inner = `<div class="cam-stream-slot" id="${this._streamId(id)}"></div>`;
    } else {
      // Still mode — single-frame image.
      // onerror: if the image fails to load for any reason, replace the tile
      // with the "Camera Offline" overlay so no broken-image icon is ever shown.
      const ts = this._getLastUpdatedTime(id);
      inner = `
        <img class="cam-img" id="${this._imgId(id)}"
          src="${this._stillSrc(id)}" alt="${name}" draggable="false"
          onerror="var w=this.closest('.cam-wrap');if(w){w.innerHTML='<div class=\'cam-offline\'><span class=\'cam-offline-msg\'>Camera Offline</span></div>';}">
        <div class="cam-img-shield"></div>
        ${ts ? `<div class="cam-timestamp" id="${this._tsId(id)}">${ts}</div>` : `<div class="cam-timestamp" id="${this._tsId(id)}" style="display:none"></div>`}`;
    }

    return `
      <div class="cam-tile" data-entity="${id}">
        <div class="cam-wrap">
          ${inner}
          ${online ? '<div class="cam-gradient"></div>' : ''}
          ${showDot ? `<div class="cam-dot ${dotCls}"></div>` : ''}
        </div>
        ${showName ? `<div class="cam-name">${name}</div>` : ''}
      </div>`;
  }

  // ── Mount ha-camera-stream into each live tile slot ──────────
  _mountLiveStreams() {
    (this._config?.entities || []).forEach(id => {
      const state = this._hass?.states[id];
      if (!state || state.state === 'unavailable') return;
      const slot = this.shadowRoot.getElementById(this._streamId(id));
      if (!slot) return;

      const streamEl = document.createElement('ha-camera-stream');
      streamEl.hass     = this._hass;
      streamEl.stateObj = state;
      // Muted so browser allows autoplay
      streamEl.setAttribute('muted', '');
      streamEl.setAttribute('autoplay', '');
      streamEl.setAttribute('playsinline', '');
      // controls=false tells ha-camera-stream not to render its overlay UI
      streamEl.controls = false;
      streamEl.setAttribute('controls', 'false');
      streamEl.style.cssText = [
        'position:absolute', 'inset:0',
        'width:100%', 'height:100%',
        'display:block', 'pointer-events:none',
        '--ha-camera-stream-background:#111',
      ].join(';');

      slot.appendChild(streamEl);
      this._forceCoverVideo(streamEl);
    });
  }

  // Wait for the <video> element inside ha-camera-stream, then force cover sizing
  // and suppress any overlaid text labels the component may render
  _forceCoverVideo(streamEl) {
    const apply = vid => {
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      vid.muted = true;
      // Hide any sibling overlay elements (the "LIVE" chip) by walking the parent
      try {
        const parent = vid.parentElement;
        if (parent) {
          parent.querySelectorAll(':not(video)').forEach(el => {
            if (el.nodeType === 1) el.style.display = 'none';
          });
        }
      } catch (_) {}
    };

    const tryFind = () => {
      // Light DOM
      let v = streamEl.querySelector('video');
      if (v) { apply(v); return true; }
      // Shadow DOM of ha-camera-stream
      v = streamEl.shadowRoot?.querySelector('video');
      if (v) { apply(v); return true; }
      // Nested shadow DOM
      if (streamEl.shadowRoot) {
        for (const c of streamEl.shadowRoot.querySelectorAll('*')) {
          if (c.shadowRoot) {
            v = c.shadowRoot.querySelector('video');
            if (v) { apply(v); return true; }
          }
        }
      }
      return false;
    };

    if (tryFind()) return;
    let n = 0;
    const t = setInterval(() => { n++; if (tryFind() || n > 30) clearInterval(t); }, 200);
  }

  // ── Push updated hass to live stream tiles ───────────────────
  _updateLiveHass() {
    if (this._config?.thumbnail_mode !== 'live') return;
    (this._config?.entities || []).forEach(id => {
      const slot     = this.shadowRoot.getElementById(this._streamId(id));
      const streamEl = slot?.querySelector('ha-camera-stream');
      if (streamEl) streamEl.hass = this._hass;
    });
  }

  // ── Update still images when HA state changes ───────────────
  // Watches the companion still/recording entity (e.g. _last_recording) rather
  // than the live camera entity itself, because HA fires state updates on the
  // recording entity when a new clip arrives.
  _updateStillImages() {
    if (this._config?.thumbnail_mode !== 'still') return;
    (this._config?.entities || []).forEach(id => {
      const liveState = this._hass?.states[id];
      if (!liveState || liveState.state === 'unavailable') return;

      const stillId    = this._findStillEntity(id);
      const watchState = stillId ? this._hass?.states[stillId] : liveState;
      if (!watchState) return;

      const updated = watchState.last_updated;
      if (!updated || updated === this._prevPictures[id]) return;
      this._prevPictures[id] = updated;

      const img = this.shadowRoot?.getElementById(this._imgId(id));
      if (img) { img.style.opacity = '1'; img.src = this._stillSrc(id); }

      // Update the timestamp pill to reflect the new last_updated time
      const tsPill = this.shadowRoot?.getElementById(this._tsId(id));
      if (tsPill) {
        const t = this._getLastUpdatedTime(id);
        if (t) { tsPill.textContent = t; tsPill.style.display = ''; }
      }
    });
  }

  // ── Polling refresh timer ────────────────────────────────────
  _startRefreshTimer() {
    this._stopRefreshTimer();
    if (this._config?.thumbnail_mode !== 'still') return;
    const secs = Math.max(5, parseInt(this._config?.refresh_interval, 10) || 30);
    this._refreshTimer = setInterval(() => this._forceRefreshStillImages(), secs * 1000);
  }

  _stopRefreshTimer() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  }

  // Force-refresh every still tile regardless of state change detection.
  // Called by the polling timer and immediately after the popup closes.
  _forceRefreshStillImages() {
    if (this._config?.thumbnail_mode !== 'still') return;
    (this._config?.entities || []).forEach(id => {
      const liveState = this._hass?.states[id];
      if (!liveState || liveState.state === 'unavailable') return;
      const img = this.shadowRoot?.getElementById(this._imgId(id));
      if (img) {
        // Clear the change key so the next HA state update also triggers naturally
        this._prevPictures[id] = null;
        img.src = this._stillSrc(id);
      }

      // Also refresh the timestamp pill
      const tsPill = this.shadowRoot?.getElementById(this._tsId(id));
      if (tsPill) {
        const t = this._getLastUpdatedTime(id);
        if (t) { tsPill.textContent = t; tsPill.style.display = ''; }
      }
    });
  }

  // ── Tile gestures ────────────────────────────────────────────
  _bindTiles() {
    this.shadowRoot.querySelectorAll('.cam-tile').forEach(tile => {
      const id = tile.dataset.entity;
      let startX, startY, timer, fired;
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

      tile.addEventListener('pointerdown', e => {
        startX = e.clientX; startY = e.clientY; fired = false;
        timer = setTimeout(() => { fired = true; timer = null; this._onLongPress(id); }, 500);
      });
      tile.addEventListener('pointermove', e => {
        if (!timer) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 9) cancel();
      });
      tile.addEventListener('pointerup', () => {
        if (timer) { cancel(); if (!fired) this._onTap(id); }
      });
      tile.addEventListener('pointercancel', cancel);
      tile.addEventListener('contextmenu', e => e.preventDefault());
    });

    const scroll = this.shadowRoot.getElementById('crabScroll');
    if (scroll) {
      scroll.addEventListener('scroll', () => {
        this.shadowRoot.querySelectorAll('.cam-tile')
          .forEach(t => t.dispatchEvent(new Event('pointercancel')));
      }, { passive: true });
    }
  }

  _onTap(id) {
    this._openPopup(id);
  }
  _onLongPress(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId: id }, bubbles: true, composed: true,
    }));
  }

  // ── Dot update ───────────────────────────────────────────────
  _updateDots() {
    if (!this.shadowRoot) return;
    (this._config?.entities || []).forEach(id => {
      const dot = this.shadowRoot.querySelector(`.cam-tile[data-entity="${id}"] .cam-dot`);
      if (!dot) return;
      const online = this._hass?.states[id]?.state !== 'unavailable';
      dot.className = `cam-dot ${this._dotClass(online)}`;
    });
  }

  // ════════════════════════════════════════════════════════════
  //  POPUP
  // ════════════════════════════════════════════════════════════
  _openPopup(id) {
    this._destroyPopup();
    const state = this._hass?.states[id];
    if (!state || state.state === 'unavailable') return;
    const name = this._cleanName(
      state.attributes?.friendly_name
      || id.split('.').slice(1).join('.').replace(/_/g, ' ')
    );
    this._popupMuted = true;

    const el = document.createElement('div');
    el.id = 'crab-popup-root';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;';
    el.innerHTML = `
      <style>
        #crab-bd {
          position:fixed;inset:0;z-index:99999;
          background:rgba(0,0,0,.9);
          backdrop-filter:blur(32px) saturate(180%);
          -webkit-backdrop-filter:blur(32px) saturate(180%);
          display:flex;align-items:center;justify-content:center;
          padding:20px;box-sizing:border-box;
          animation:bdIn .2s ease forwards;
        }
        @keyframes bdIn{from{opacity:0}to{opacity:1}}
        .pc{
          width:100%;max-width:720px;
          background:rgba(28,28,30,.98);
          border-radius:22px;overflow:hidden;
          display:flex;flex-direction:column;
          box-shadow:0 32px 100px rgba(0,0,0,.85),0 0 0 .5px rgba(255,255,255,.07);
          animation:cardIn .28s cubic-bezier(.34,1.4,.64,1) forwards;
        }
        @keyframes cardIn{from{transform:translateY(40px) scale(.94);opacity:0}to{transform:none;opacity:1}}
        .ph{display:flex;align-items:center;padding:14px 16px 11px;gap:10px;}
        .pt{flex:1;font-size:16px;font-weight:600;color:#fff;letter-spacing:-.25px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;}
        .px{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.11);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.75);transition:background .15s,transform .1s;flex-shrink:0;}
        .px:hover{background:rgba(255,255,255,.2);}
        .px:active{transform:scale(.87);}
        .sv{position:relative;width:100%;background:#000;flex-shrink:0;}
        .sv::before{content:'';display:block;padding-top:56.25%;}
        .sv>ha-camera-stream{position:absolute;inset:0;width:100%;height:100%;display:block;--ha-camera-stream-background:#000;}
        .spin-wrap{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(0,0,0,.5);color:rgba(255,255,255,.3);font-size:13px;font-family:-apple-system,sans-serif;pointer-events:none;transition:opacity .4s ease;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin-ring{width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,255,255,.1);border-top-color:rgba(255,255,255,.6);animation:spin .8s linear infinite;}
        .acts{display:flex;align-items:center;justify-content:space-evenly;padding:16px 20px 22px;gap:8px;flex-shrink:0;}
        .ab{display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;-webkit-tap-highlight-color:transparent;min-width:64px;border:none;background:none;padding:0;}
        .ai{width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none;transition:background .15s,transform .12s cubic-bezier(.34,1.56,.64,1);}
        .ab:hover .ai{background:rgba(255,255,255,.18);}
        .ab:active .ai{transform:scale(.87);background:rgba(255,255,255,.06);}
        .ab.is-muted .ai{background:rgba(255,59,48,.22);color:#FF3B30;}
        .al{font-size:11px;font-weight:500;color:rgba(255,255,255,.42);pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;}
      </style>
      <div id="crab-bd">
        <div class="pc" id="crabCard">
          <div class="ph">
            <div class="pt">${name}</div>
            <button class="px" id="crabX" aria-label="Close">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          <div class="sv" id="crabSV">
            <div class="spin-wrap" id="crabSpinner">
              <div class="spin-ring"></div>
              <span>Connecting…</span>
            </div>
          </div>
          <div class="acts">
            <button class="ab is-muted" id="crabMuteBtn" aria-label="Toggle sound">
              <div class="ai">
                <svg id="crabMuteIco" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
                </svg>
              </div>
              <span class="al" id="crabMuteLbl">Muted</span>
            </button>
            <button class="ab" id="crabFullBtn" aria-label="Full screen">
              <div class="ai">
                <svg id="crabFsIco" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </div>
              <span class="al">Full Size</span>
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(el);
    this._popupEl = el;

    const sv       = el.querySelector('#crabSV');
    const spinner  = el.querySelector('#crabSpinner');
    const streamEl = document.createElement('ha-camera-stream');
    streamEl.hass     = this._hass;
    streamEl.stateObj = state;
    streamEl.setAttribute('autoplay', '');
    streamEl.setAttribute('playsinline', '');
    this._streamEl = streamEl;
    sv.appendChild(streamEl);

    let attempts = 0;
    this._pollTimer = setInterval(() => {
      attempts++;
      const vid = this._findVideo(streamEl);
      if (vid) {
        clearInterval(this._pollTimer); this._pollTimer = null;
        vid.muted = true;
        const hide = () => { spinner.style.opacity = '0'; spinner.style.pointerEvents = 'none'; };
        vid.addEventListener('playing',    hide, { once: true });
        vid.addEventListener('canplay',    hide, { once: true });
        vid.addEventListener('loadeddata', hide, { once: true });
        if (vid.readyState >= 2) hide();
      }
      if (attempts > 50) { clearInterval(this._pollTimer); this._pollTimer = null; spinner.style.opacity = '0'; }
    }, 200);

    el.querySelector('#crabX').addEventListener('click', () => this._destroyPopup());
    el.querySelector('#crab-bd').addEventListener('pointerdown', e => {
      if (e.target.id === 'crab-bd') this._destroyPopup();
    });
    el.querySelector('#crabMuteBtn').addEventListener('click', () => {
      this._popupMuted = !this._popupMuted;
      const vid = this._findVideo(this._streamEl);
      if (vid) vid.muted = this._popupMuted;
      this._syncMuteUI(el);
    });
    el.querySelector('#crabFullBtn').addEventListener('click', () => this._enterFullscreen(el));

    const onFsChange = () => {
      const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const ico  = el.querySelector('#crabFsIco');
      if (!ico) return;
      ico.innerHTML = inFs
        ? `<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>`
        : `<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>`;
    };
    document.addEventListener('fullscreenchange',       onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    this._fsListeners = () => {
      document.removeEventListener('fullscreenchange',       onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
    this._popupKey = e => { if (e.key === 'Escape') this._destroyPopup(); };
    document.addEventListener('keydown', this._popupKey);
  }

  _enterFullscreen(el) {
    const vid  = this._findVideo(this._streamEl);
    const card = el.querySelector('#crabCard');
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (vid?.webkitEnterFullscreen)   { vid.webkitEnterFullscreen(); return; }
    if (vid?.requestFullscreen)       { vid.requestFullscreen().catch(() => this._fsCard(card)); return; }
    if (vid?.webkitRequestFullscreen) { vid.webkitRequestFullscreen(); return; }
    this._fsCard(card);
  }

  _fsCard(card) {
    if (!card) return;
    (card.requestFullscreen?.bind(card) || card.webkitRequestFullscreen?.bind(card))?.()?.catch(() => {});
  }

  _findVideo(streamEl) {
    if (!streamEl) return null;
    let v = streamEl.querySelector('video');
    if (v) return v;
    v = streamEl.shadowRoot?.querySelector('video');
    if (v) return v;
    if (streamEl.shadowRoot) {
      for (const c of streamEl.shadowRoot.querySelectorAll('*')) {
        if (c.shadowRoot) { v = c.shadowRoot.querySelector('video'); if (v) return v; }
      }
    }
    return null;
  }

  _syncMuteUI(el) {
    const btn = el.querySelector('#crabMuteBtn');
    const ico = el.querySelector('#crabMuteIco');
    const lbl = el.querySelector('#crabMuteLbl');
    if (!btn || !ico || !lbl) return;
    btn.classList.toggle('is-muted', this._popupMuted);
    if (this._popupMuted) {
      ico.innerHTML = `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>`;
      lbl.textContent = 'Muted';
    } else {
      ico.innerHTML = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM18.5 12c0 2.77-1.5 5.19-3.78 6.54l1.42 1.42C19.04 18.12 21 15.26 21 12c0-3.26-1.96-6.12-4.86-7.96l-1.42 1.42C16.97 6.76 18.5 9.2 18.5 12z"/>`;
      lbl.textContent = 'Sound';
    }
  }

  _destroyPopup() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
    if (this._fsListeners) { this._fsListeners(); this._fsListeners = null; }
    this._popupEl?.remove();
    this._popupEl = null; this._streamEl = null;
    if (this._popupKey) { document.removeEventListener('keydown', this._popupKey); this._popupKey = null; }
    // Refresh still thumbnails after closing the live popup so the latest
    // recording frame is shown without waiting for the next polling tick.
    this._forceRefreshStillImages();
  }
}

// ════════════════════════════════════════════════════════════════
//  VISUAL EDITOR
// ════════════════════════════════════════════════════════════════
class CrabCameraCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config      = {};
    this._hass        = null;
    this._initialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) this._render();
  }

  setConfig(config) {
    const prev = this._config;
    this._config = config;
    if (!this._initialized && this._hass) {
      this._render();
    } else if (this._initialized) {
      const prevEnts = JSON.stringify(prev?.entities || []);
      const nextEnts = JSON.stringify(config?.entities || []);
      if (prevEnts !== nextEnts) this._syncCheckboxes();
      this._syncUI();
    }
  }

  _fire(key, value) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: { ...this._config, [key]: value } },
      bubbles: true, composed: true,
    }));
  }

  // Mirror the card's name-cleaning logic so the editor shows the same names
  _cleanName(raw) {
    return raw
      .replace(/[\s\-_]*(live\s*view|live\s*feed|live\s*stream|live)[\s\-_]*$/i, '')
      .replace(/[\s\-_]*(snapshot|still|recording|clip|thumbnail)[\s\-_]*$/i, '')
      .replace(/^\s+|\s+$/g, '')
      || raw;
  }

  _render() {
    if (!this._hass || !this._config) return;
    this._initialized = true;

    const selected    = this._config.entities || [];
    const liveCameras = Object.keys(this._hass.states)
      .filter(e => e.startsWith('camera.') && isLiveCamera(this._hass, e))
      .sort();
    const sorted = [
      ...selected.filter(e => liveCameras.includes(e)),
      ...liveCameras.filter(e => !selected.includes(e)),
    ];

    // Pre-compute cleaned display names so they're available inside the template
    const displayName = id => {
      const raw = this._hass.states[id]?.attributes?.friendly_name
                  || id.replace('camera.', '').replace(/_/g, ' ');
      return this._cleanName(raw);
    };

    this.shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .container { display:flex;flex-direction:column;gap:20px;padding:12px;color:var(--primary-text-color);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        .section-title { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px; }
        .card-block { background:var(--card-background-color);border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden; }
        .toggle-list { display:flex;flex-direction:column; }
        .toggle-item { display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.06);min-height:52px;gap:12px; }
        .toggle-item:last-child { border-bottom:none; }
        .toggle-label { font-size:14px;font-weight:500; }
        .toggle-switch { position:relative;width:51px;height:31px;flex-shrink:0; }
        .toggle-switch input { opacity:0;width:0;height:0;position:absolute; }
        .toggle-track { position:absolute;inset:0;border-radius:31px;background:rgba(120,120,128,.32);cursor:pointer;transition:background .25s ease; }
        .toggle-track::after { content:'';position:absolute;width:27px;height:27px;border-radius:50%;background:#fff;top:2px;left:2px;box-shadow:0 2px 6px rgba(0,0,0,.3);transition:transform .25s ease; }
        .toggle-switch input:checked + .toggle-track { background:#34C759; }
        .toggle-switch input:checked + .toggle-track::after { transform:translateX(20px); }
        .seg-wrap { padding:12px 16px; }
        .seg-label { font-size:14px;font-weight:500;margin-bottom:8px; }
        .segmented { display:flex;background:rgba(118,118,128,.2);border-radius:9px;padding:2px;gap:2px; }
        .segmented input[type="radio"] { display:none; }
        .segmented label { flex:1;text-align:center;padding:8px 4px;font-size:13px;font-weight:500;border-radius:7px;cursor:pointer;color:var(--primary-text-color);transition:all .2s ease;white-space:nowrap; }
        .segmented input[type="radio"]:checked + label { background:#007AFF;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3); }
        .input-row { padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06); }
        .input-row:last-child { border-bottom:none; }
        .input-row label { font-size:14px;font-weight:500;display:block;margin-bottom:7px; }
        input[type="text"] { width:100%;background:rgba(255,255,255,.07);color:var(--primary-text-color);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;transition:border-color .15s; }
        input[type="text"]:focus { border-color:#007AFF; }
        .search-pad { padding:10px 12px 0; }
        .checklist { max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch; }
        .check-item { display:flex;align-items:center;padding:10px 12px;gap:10px;border-bottom:1px solid rgba(255,255,255,.06);background:var(--card-background-color);min-height:52px; }
        .check-item:last-child { border-bottom:none; }
        .dragging { opacity:.4;background:rgba(255,255,255,.04) !important; }
        .drag-handle { cursor:grab;color:rgba(255,255,255,.28);display:flex;align-items:center;flex-shrink:0;padding:4px 2px;touch-action:none; }
        .cam-icon { flex-shrink:0;color:rgba(255,255,255,.32); }
        .ent-name { flex:1;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0; }
        .check-item .toggle-switch { width:44px;height:26px;flex-shrink:0; }
        .check-item .toggle-track  { border-radius:26px; }
        .check-item .toggle-track::after { width:22px;height:22px; }
        .check-item .toggle-switch input:checked + .toggle-track::after { transform:translateX(18px); }
        .no-cams { padding:22px 16px;text-align:center;color:rgba(255,255,255,.35);font-size:13px;line-height:1.6; }
        .dot-legend { display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px 13px;border-top:1px solid rgba(255,255,255,.06); }
        .dl { display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,.42); }
        .dd { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
        .dd.live    { background:#34C759;box-shadow:0 0 5px rgba(52,199,89,.7); }
        .dd.still   { background:#FFD60A;box-shadow:0 0 5px rgba(255,214,10,.6); }
        .dd.offline { background:#FF3B30;box-shadow:0 0 5px rgba(255,59,48,.6); }
      </style>

      <div class="container">

        <div>
          <div class="section-title">Live Cameras</div>
          <div class="card-block">
            <div class="search-pad">
              <input type="text" id="crabSearch" placeholder="Filter cameras…">
            </div>
            ${sorted.length === 0
              ? `<div class="no-cams">No live-stream cameras found.<br>Only HLS, WebRTC and MJPEG cameras are shown.<br>Snapshot, recording and sensor cameras are excluded.</div>`
              : `<div class="checklist" id="crabList">
                   ${sorted.map(ent => {
                     const sel  = selected.includes(ent);
                     const name = displayName(ent);
                     return `
                       <div class="check-item" data-id="${ent}" draggable="${sel}">
                         <div class="drag-handle">
                           <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                             <path d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7M9 11h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/>
                           </svg>
                         </div>
                         <svg class="cam-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                           <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5l4 4v-11l-4 4Z"/>
                         </svg>
                         <span class="ent-name">${name}</span>
                         <label class="toggle-switch">
                           <input type="checkbox" ${sel ? 'checked' : ''}>
                           <span class="toggle-track"></span>
                         </label>
                       </div>`;
                   }).join('')}
                 </div>`}
          </div>
        </div>

        <div>
          <div class="section-title">Display</div>
          <div class="card-block">
            <div class="input-row">
              <label for="crabTitle">Card Title</label>
              <input type="text" id="crabTitle" placeholder="Cameras">
            </div>
            <div class="toggle-list">
              <div class="toggle-item">
                <span class="toggle-label">Show Title</span>
                <label class="toggle-switch"><input type="checkbox" id="crabShowTitle"><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <span class="toggle-label">Show Camera Names</span>
                <label class="toggle-switch"><input type="checkbox" id="crabShowNames"><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <span class="toggle-label">Show Status Dot</span>
                <label class="toggle-switch"><input type="checkbox" id="crabShowDot"><span class="toggle-track"></span></label>
              </div>
            </div>
            <div class="dot-legend">
              <div class="dl"><div class="dd live"></div>Live mode · Online</div>
              <div class="dl"><div class="dd still"></div>Still mode · Online</div>
              <div class="dl"><div class="dd offline"></div>Camera Offline</div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Thumbnails</div>
          <div class="card-block">
            <div class="seg-wrap">
              <div class="seg-label">Image Mode</div>
              <div class="segmented">
                <input type="radio" name="crab_thumb" id="thumb_still" value="still">
                <label for="thumb_still">Still Image</label>
                <input type="radio" name="crab_thumb" id="thumb_live" value="live">
                <label for="thumb_live">Live Feed</label>
              </div>
            </div>
            <div class="input-row">
              <label for="crabRefresh">Still Image Refresh Interval (seconds)</label>
              <input type="number" id="crabRefresh" min="5" max="3600" step="5" placeholder="30">
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:5px;line-height:1.5">
                How often to poll for a new last-recording image. Min 5s. Also refreshes immediately after viewing the live feed.
              </div>
            </div>
          </div>
        </div>

      </div>`;

    this._syncUI();
    this._setupSearch();
    this._setupReorder();
    this._setupListeners();
  }

  _syncUI() {
    const r = this.shadowRoot;
    if (!r) return;
    const v = this._config, get = id => r.getElementById(id);
    if (get('crabTitle'))     get('crabTitle').value       = v.title || 'Cameras';
    if (get('crabShowTitle')) get('crabShowTitle').checked  = v.show_title !== false;
    if (get('crabShowNames')) get('crabShowNames').checked  = v.show_camera_names !== false;
    if (get('crabShowDot'))   get('crabShowDot').checked    = v.show_status_dot !== false;
    const mel = get('thumb_' + (v.thumbnail_mode || 'still'));
    if (mel) mel.checked = true;
    if (get('crabRefresh')) get('crabRefresh').value = v.refresh_interval ?? 30;
  }

  _syncCheckboxes() {
    const selected = this._config.entities || [];
    const list     = this.shadowRoot?.getElementById('crabList');
    if (!list) return;
    list.querySelectorAll('.check-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (!cb) return;
      const sel = selected.includes(item.getAttribute('data-id'));
      cb.checked = sel; item.draggable = sel;
    });
  }

  _setupSearch() {
    this.shadowRoot.getElementById('crabSearch')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      this.shadowRoot.querySelectorAll('.check-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    });
  }

  _setupReorder() {
    const list = this.shadowRoot.getElementById('crabList');
    if (!list) return;
    let dragged = null;
    list.addEventListener('dragstart', e => {
      dragged = e.target.closest('.check-item');
      if (!dragged?.querySelector('input[type="checkbox"]')?.checked) { e.preventDefault(); return; }
      dragged.classList.add('dragging');
    });
    list.addEventListener('dragover', e => {
      e.preventDefault();
      const after = this._afterEl(list, e.clientY);
      after == null ? list.appendChild(dragged) : list.insertBefore(dragged, after);
    });
    list.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); this._saveOrder(); });
    list.addEventListener('touchstart', e => {
      if (!e.target.closest('.drag-handle')) return;
      dragged = e.target.closest('.check-item');
      if (!dragged?.querySelector('input[type="checkbox"]')?.checked) { dragged = null; return; }
      dragged.classList.add('dragging');
    }, { passive: true });
    list.addEventListener('touchmove', e => {
      // Only intercept scroll when a drag is actually in progress
      if (!dragged) return;
      e.preventDefault();
      const after = this._afterEl(list, e.touches[0].clientY);
      after == null ? list.appendChild(dragged) : list.insertBefore(dragged, after);
    }, { passive: false });
    list.addEventListener('touchend', () => {
      dragged?.classList.remove('dragging'); dragged = null; this._saveOrder();
    });
  }

  _afterEl(container, y) {
    return [...container.querySelectorAll('.check-item:not(.dragging)')]
      .reduce((c, el) => {
        const box = el.getBoundingClientRect(), off = y - box.top - box.height / 2;
        return (off < 0 && off > c.offset) ? { offset: off, element: el } : c;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  _saveOrder() {
    const order = [...this.shadowRoot.querySelectorAll('.check-item')]
      .filter(i => i.querySelector('input[type="checkbox"]')?.checked)
      .map(i => i.getAttribute('data-id'));
    this._fire('entities', order);
  }

  _setupListeners() {
    const r    = this.shadowRoot;
    const list = r.getElementById('crabList');
    if (list) {
      list.addEventListener('change', e => {
        const cb   = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        const item = cb.closest('.check-item');
        if (!item) return;
        item.draggable = cb.checked;
        if (cb.checked) {
          const all  = [...list.querySelectorAll('.check-item')];
          const last = all.filter(i => i.querySelector('input[type="checkbox"]')?.checked && i !== item).pop();
          last ? last.after(item) : list.prepend(item);
        }
        this._saveOrder();
      });
    }
    r.getElementById('crabTitle')    ?.addEventListener('input',  e => this._fire('title', e.target.value));
    r.getElementById('crabShowTitle')?.addEventListener('change', e => this._fire('show_title',        e.target.checked));
    r.getElementById('crabShowNames')?.addEventListener('change', e => this._fire('show_camera_names', e.target.checked));
    r.getElementById('crabShowDot')  ?.addEventListener('change', e => this._fire('show_status_dot',   e.target.checked));
    ['still', 'live'].forEach(val => {
      r.getElementById('thumb_' + val)?.addEventListener('change', e => {
        if (e.target.checked) this._fire('thumbnail_mode', val);
      });
    });
    r.getElementById('crabRefresh')?.addEventListener('change', e => {
      const val = Math.max(5, parseInt(e.target.value, 10) || 30);
      e.target.value = val;
      this._fire('refresh_interval', val);
    });
  }
}

// ════════════════════════════════════════════════════════════════
//  REGISTRATION
// ════════════════════════════════════════════════════════════════
if (!customElements.get('crab-camera-card')) {
  customElements.define('crab-camera-card', CrabCameraCard);
}
if (!customElements.get('crab-camera-card-editor')) {
  customElements.define('crab-camera-card-editor', CrabCameraCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'crab-camera-card')) {
  window.customCards.push({
    type:        'crab-camera-card',
    name:        'Crab Camera Card',
    preview:     true,
    description: 'Scrollable camera card for Home Assistant with live feeds, still snapshots, and a full-screen popup viewer.',
  });
}
