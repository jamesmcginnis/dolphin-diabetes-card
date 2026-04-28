# 🐬 Dolphin Diabetes Card

A sleek Home Assistant dashboard card for monitoring blood glucose levels at a glance.

![Dolphin Diabetes Card preview](https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview.png)

---

## What it shows

- **Glucose ring** — animated ring on the left fills and colour-codes your current reading (green in range, red low, amber high). A status badge beneath the ring shows In Range, Low, or High at a glance
- **Trend arrow** — large directional arrow in the centre zone shows your current trend direction (↑↑ Rising Fast → Steady ↓↓ Falling Fast) with a label beneath; tap to view recent trend history with timestamps
- **30-minute forecast pill** — estimates your glucose 30 minutes into the future using a weighted linear regression over recent readings; colour-coded to your configured thresholds; always shown when a glucose entity is configured; tap for a friendly contextual message
- **Sensor life pill** — optional countdown showing time remaining on your current sensor. Three states: Active (green), Last Day (amber, ≤1 day remaining), and Expired (red, shows hours overdue)
- **History graph** — full-width colour-coded line segments with threshold guide lines, fetched from your HA history
- **Stale data warning** — the header timestamp turns amber if the reading is more than 15 minutes old
- **Sensor unavailable** — the whole card gracefully fades to grey when the sensor goes offline

## Layout

The card uses a three-zone layout designed for full-width dashboard panels:

- **Left zone** — glucose ring with status badge below
- **Centre zone** — trend arrow and direction label
- **Right zone** — 30-min forecast pill and sensor life pill stacked vertically

Thin dividers separate each zone, and a full-width history graph runs across the bottom of the card.

## Tap interactions

A single tap opens a detail popup with a large reading, trend arrow, a 1h/3h/6h/12h/24h time range selector for the graph, and any available sensor attributes such as delta, battery, and transmitter ID.

Inside the popup, **click or drag anywhere on the graph** to show a dotted vertical line at that position with the interpolated glucose reading and timestamp displayed near the top. Drag to scrub along the graph, or click outside the graph area to clear it.

Tapping the **30-min pill** opens a forecast popup with your estimated glucose, projected change, and a short friendly message if things are heading low or high — without offering medical advice.

Tapping the **trend arrow** opens a trend history popup showing recent trend readings with timestamps.

Tapping the **sensor pill** opens a sensor life popup with applied date, expiry, time remaining (or hours overdue), and a progress ring.

## 30-Minute Forecast

The forecast uses a weighted linear regression over the last 40 minutes of glucose history, giving more weight to the most recent readings. The result is colour-coded using your configured low and high thresholds and updates every 5 minutes. It is an estimate based on recent trends — not a clinical reading.

## Sensor Life States

The sensor pill has three distinct states:

- **Active** — sensor has more than one day remaining; shown in your configured active colour
- **Last Day** — one day or less remaining; shown in your configured urgent colour
- **Expired** — sensor life has passed; shown in your configured expired colour with hours overdue displayed

## Progressive Web App

This repository also includes a standalone Progressive Web App (`index.html`) that you can install on your phone's home screen for a native-feeling glucose monitor, independent of the HA dashboard.

The PWA connects directly to your Home Assistant instance and displays the glucose ring, trend arrow, forecast pill, sensor life pill, recent readings list, 3-hour average, time in range percentage, and a readings count. It uses WebSockets for live updates and falls back to polling every 60 seconds.

### Hosting via Nabu Casa

Copy `index.html`, `manifest.json`, and `icon-192.png` into your Home Assistant `www` folder (`/config/www/`). The PWA will then be available at:

```
https://<your-nabu-casa-id>.ui.nabu.casa/local/index.html
```

Open that URL in Safari or Chrome on your phone and use **Add to Home Screen** to install it as a standalone app.

### Setup

On first launch the app shows a setup screen. Tap **Open Settings** and enter:

- **HA URL** — your Nabu Casa or local Home Assistant URL
- **Access Token** — a Long-Lived Access Token from your HA profile (**Profile → Long-Lived Access Tokens**)
- **Glucose Entity** — e.g. `sensor.dexcom_blood_glucose`
- **Trend Entity** — optional, e.g. `sensor.dexcom_trend`
- Unit, decimal places, graph range, thresholds, and sensor life settings

All settings are saved in your browser and persist between sessions.

## Configuration

Everything is configurable through the built-in visual editor — no YAML needed. Options include sensor entity pickers with smart keyword scoring and live search, unit toggle (mmol/L or mg/dL), alert thresholds, show/hide graph with time range selector, sensor life countdown with start date and duration, and full colour control across rings, graph, sensor pill (including separate active, last-day, and expired colours), forecast pill, and card background.

## Supported integrations

This card is designed exclusively for use with the [Dexcom](https://www.home-assistant.io/integrations/dexcom/) integration, which is built into Home Assistant.