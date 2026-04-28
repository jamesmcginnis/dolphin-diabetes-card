# 🐬 Dolphin Diabetes Card

A sleek [Home Assistant](https://www.home-assistant.io/) dashboard card for monitoring blood glucose levels. Displays your current reading, trend direction, a 30-minute glucose forecast, a sensor life countdown, and an optional historical graph — all configurable without writing a single line of YAML.

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz)
[![HA Version](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white)](https://www.home-assistant.io/)
![Custom Card](https://img.shields.io/badge/Dashboard-Custom%20Card-white?style=for-the-badge&logo=homeassistant&logoColor=41BDF5)

---

![Dolphin Diabetes Card preview](https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview.png)

---

## ✨ Features

- **Three-zone layout** — designed for full-width dashboard panels; glucose ring on the left, trend arrow in the centre, forecast and sensor pills on the right, with a full-width history graph below
- **Animated glucose ring** — fills and colour-codes your current reading; a status badge beneath the ring shows In Range, Low, or High at a glance
- **Colour-coded readings** — green in range · red when low · amber when high, applied to the ring, glucose number, status badge, and trend arrow
- **Trend arrow** — large directional arrow (↑↑ → ↓↓) with direction label; tap to view recent trend history with timestamps
- **30-minute glucose forecast** — estimates where your glucose is likely to be in 30 minutes using a weighted linear regression over the last 40 minutes of readings; colour-coded to your configured thresholds; always shown when a glucose entity is configured
- **Forecast popup** — tap the 30-min pill for a friendly, contextual message depending on whether your estimated glucose is low, high, or in range, along with a projected change from current
- **Sensor life countdown** — optional pill showing time remaining on your current sensor; three states: Active (green), Last Day (amber), and Expired (red with overdue hours shown)
- **Sensor unavailable state** — everything fades to grey when the sensor is offline or unavailable
- **Tap for details** — single tap opens an elegant popup with a large reading, trend arrow, time range selector (1h–24h), interactive history graph, and live sensor attributes
- **Interactive graph crosshair** — click or drag anywhere on the popup graph to pin a dotted vertical line showing the interpolated glucose value and timestamp at that point; tap/click outside the graph area to clear
- **Historical graph** — full-width colour-coded line segments, threshold guide lines, and gradient fill fetched directly from the HA history API
- **Stale reading warning** — timestamp in the header turns amber when data is older than 15 minutes
- **Smart entity picker** — the visual editor scores and surfaces your most likely glucose and trend sensors at the top, with a live search filter across all sensors
- **Full visual editor** — every option configurable from the UI, no YAML required
- **Progressive Web App** — a standalone mobile app (`index.html`) you can install on your phone home screen for a native-feeling glucose monitor, independent of the HA dashboard

---

## 🚀 Installation

### Via HACS (Recommended)

Click the button below to add this repository to HACS:

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jamesmcginnis&repository=dolphin-diabetes-card&category=plugin)

Then:

1. Open **HACS** in Home Assistant
2. Go to **Frontend**
3. Search for **Dolphin Diabetes Card**
4. Click **Download**
5. Reload your browser

### Manual Installation

1. Download `dolphin-diabetes-card.js` from the [latest release](../../releases/latest)
2. Copy it to `/config/www/dolphin-diabetes-card.js`
3. In Home Assistant go to **Settings → Dashboards → Resources**
4. Add a new resource:
   - URL: `/local/dolphin-diabetes-card.js`
   - Type: **JavaScript module**
5. Reload your browser

---

## 📱 Progressive Web App (PWA)

In addition to the dashboard card, this repository includes a standalone Progressive Web App — `index.html` — that you can install on your phone's home screen for a native-feeling glucose monitor.

The PWA connects directly to your Home Assistant instance via its REST API and WebSocket, and displays the same glucose ring, trend arrow, 30-minute forecast, sensor life countdown, recent readings list, and stats bar as the dashboard card. It works entirely in your browser with no additional server or app store required.

### What the PWA shows

- **Glucose ring** — animated ring with current reading, colour-coded to your thresholds
- **Trend arrow** — current direction with label; tap for recent trend history
- **30-min forecast pill** — weighted linear regression estimate, colour-coded to your thresholds
- **Sensor life pill** — optional countdown in Active / Last Day / Expired states
- **Stats bar** — 3-hour average, time in range percentage, and total readings count
- **Recent readings list** — scrollable list of recent readings with timestamps and status badges
- **Live WebSocket updates** — readings update in real time without manual refresh
- **Stale data warning** — timestamp turns amber when data is more than 15 minutes old

### Hosting the PWA via Nabu Casa (Recommended)

[Nabu Casa](https://www.nabucasa.com/) provides a secure remote URL for your Home Assistant instance. The simplest way to host the PWA is to place it in your Home Assistant `www` folder, which makes it available at your Nabu Casa URL — no separate hosting required.

1. **Download** `index.html`, `manifest.json`, and `icon-192.png` from the [latest release](../../releases/latest)
2. **Copy all three files** into your Home Assistant `www` folder:
   ```
   /config/www/index.html
   /config/www/manifest.json
   /config/www/icon-192.png
   ```
3. The PWA will now be accessible at:
   ```
   https://<your-nabu-casa-id>.ui.nabu.casa/local/index.html
   ```
   Replace `<your-nabu-casa-id>` with your own Nabu Casa subdomain, which you can find in **Settings → Home Assistant Cloud**.

4. **Open that URL on your phone** and follow the steps below to add it to your home screen.

> **Tip:** If you are on your home network, you can also access the PWA locally at `http://homeassistant.local:8123/local/index.html`.

### Adding to Your Home Screen

#### iPhone / iPad (Safari)
1. Open the PWA URL in **Safari**
2. Tap the **Share** button (the box with an arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Give it a name (e.g. *Dolphin Diabetes*) and tap **Add**

#### Android (Chrome)
1. Open the PWA URL in **Chrome**
2. Tap the **three-dot menu** (⋮) in the top-right corner
3. Tap **Add to Home screen**
4. Confirm by tapping **Add**

Once installed, the app opens full-screen without any browser chrome, just like a native app.

### Configuring the PWA

The first time you open the PWA you will see a setup screen. Tap **Open Settings** and fill in:

| Setting | Description |
|---|---|
| **HA URL** | Your Home Assistant URL — either your Nabu Casa URL (`https://<id>.ui.nabu.casa`) or your local address (`http://homeassistant.local:8123`) |
| **Access Token** | A Long-Lived Access Token from your HA profile — go to your **Profile → Long-Lived Access Tokens → Create Token** |
| **Glucose Entity** | Entity ID of your Dexcom glucose sensor, e.g. `sensor.dexcom_blood_glucose` |
| **Trend Entity** | Optional — entity ID of your Dexcom trend sensor, e.g. `sensor.dexcom_trend` |
| **Unit** | `mmol/L` or `mg/dL` |
| **Decimal Places** | Display precision for mmol/L readings (0, 1, or 2) |
| **Default Graph Range** | How many hours of history to show by default (1h, 3h, 6h, 12h, or 24h) |
| **Low / High Thresholds** | Your personal glucose target range |
| **Sensor Life** | Optional — toggle on and enter the date you applied your current sensor and its duration in days |

All settings are saved locally in your browser and persist across sessions.

> **Security note:** Your access token is stored in your browser's local storage on your device. Use a dedicated token for the PWA and never share the URL with others, particularly if you are using your public Nabu Casa address.

---

## 🛠️ Dashboard Card Configuration

Add a new card to your dashboard, choose **Manual** and use:

```yaml
type: custom:dolphin-diabetes-card
glucose_entity: sensor.your_glucose_sensor
trend_entity: sensor.your_trend_sensor
```

Everything else can be configured through the built-in visual editor. For manual YAML, all options are listed below.

### Full Options

| Option | Type | Default | Description |
|---|---|---|---|
| `glucose_entity` | `string` | **required** | Entity ID of your glucose sensor |
| `trend_entity` | `string` | — | Entity ID of your trend direction sensor |
| `unit` | `mmol` \| `mgdl` | `mmol` | Glucose unit of measurement |
| `low_threshold` | `number` | `3.9` | Low glucose threshold (mmol/L or mg/dL) |
| `high_threshold` | `number` | `10.0` | High glucose threshold |
| `show_title` | `boolean` | `true` | Show the card title |
| `title` | `string` | `Blood Sugar` | Card title text |
| `show_graph` | `boolean` | `true` | Show the historical blood sugar graph on the card |
| `graph_hours` | `1\|3\|6\|12\|24` | `3` | Default hours of history to display |
| `show_sensor_life` | `boolean` | `false` | Show the sensor life countdown pill |
| `sensor_start_date` | `string` | — | ISO datetime when you applied the current sensor |
| `sensor_duration_days` | `number` | `14` | How many days the sensor lasts |
| `accent_color` | `string` | `#007AFF` | Ring and highlight colour |
| `normal_color` | `string` | `#34C759` | In-range reading colour |
| `low_color` | `string` | `#FF3B30` | Low reading colour |
| `high_color` | `string` | `#FF9500` | High reading colour |
| `graph_line_color` | `string` | `#007AFF` | Graph line colour |
| `graph_fill_color` | `string` | `#007AFF` | Graph area fill colour |
| `sensor_pill_bg` | `string` | `#2c2c2e` | Sensor life pill background colour |
| `sensor_pill_normal_color` | `string` | `#34C759` | Sensor pill colour when days remain (Active) |
| `sensor_pill_urgent_color` | `string` | `#FF9500` | Sensor pill colour when 1 day or less remains (Last Day) |
| `sensor_pill_expired_color` | `string` | `#FF3B30` | Sensor pill colour when the sensor life has expired (Expired) |
| `card_bg` | `string` | `#1c1c1e` | Card background colour (use 8-digit hex for custom opacity, e.g. `#1c1c1e80`) |
| `card_bg_opacity` | `number` | `80` | Card background opacity (0–100) |
| `text_color` | `string` | `#ffffff` | Primary text colour |

### Example with all options

```yaml
type: custom:dolphin-diabetes-card
glucose_entity: sensor.dexcom_glucose
trend_entity: sensor.dexcom_trend
unit: mmol
low_threshold: 3.9
high_threshold: 10.0
show_title: true
title: Blood Sugar
show_graph: true
graph_hours: 3
show_sensor_life: true
sensor_start_date: "2026-03-14T09:00:00.000Z"
sensor_duration_days: 14
accent_color: "#007AFF"
normal_color: "#34C759"
low_color: "#FF3B30"
high_color: "#FF9500"
graph_line_color: "#007AFF"
graph_fill_color: "#007AFF"
sensor_pill_bg: "#2c2c2e"
sensor_pill_normal_color: "#34C759"
sensor_pill_urgent_color: "#FF9500"
sensor_pill_expired_color: "#FF3B30"
card_bg: "#1c1c1e"
card_bg_opacity: 80
text_color: "#ffffff"
```

---

## 👆 Interactions

| Gesture | Action |
|---|---|
| **Tap card** | Opens a detail popup with a large reading, trend arrow, selectable graph time range (1h–24h), interactive history graph, and sensor attributes |
| **Click or drag on graph (in popup)** | Pins a dotted crosshair line at that position showing the interpolated glucose value and timestamp; drag to scrub along the graph, or click outside the graph area to clear |
| **Tap 30-min pill** | Opens a friendly forecast popup showing your estimated glucose in 30 minutes, projected change, and contextual guidance if trending low or high |
| **Tap trend arrow** | Opens a trend history popup showing recent trend readings with timestamps |
| **Tap sensor pill** | Opens a sensor life popup with applied date, expiry date, time remaining, and a progress ring |

---

## 🔮 30-Minute Glucose Forecast

The forecast pill sits in the right zone of the card and estimates where your glucose is likely to be in 30 minutes. It uses a **weighted linear regression** over the last 40 minutes of readings from the HA history API, giving more weight to the most recent data points. The result is clamped to a sensible range and colour-coded using your configured low and high thresholds. The forecast updates every 5 minutes and is always shown when a glucose entity is configured.

Tapping the pill opens a friendly popup with:

- Your estimated glucose value and unit
- Whether it's projected to be low, in range, or high
- A projected change from your current reading
- A contextual message appropriate to the forecast — with gentle guidance if things look like they're heading out of range

> **Note:** This is an estimate based on recent trend data, not a clinical measurement. Always follow your personal diabetes management plan.

---

## 🩹 Sensor Life Countdown

When enabled, the sensor pill in the right zone shows the remaining life of your current sensor and cycles through three states:

- **Active** — days remaining, shown in your configured active colour (default green)
- **Last Day** — 1 day or less remaining, shown in your configured urgent colour (default amber)
- **Expired** — sensor life has passed, shown in your configured expired colour (default red) with the number of hours overdue displayed

Tapping the pill opens a detailed popup with the applied date, expiry date, exact time remaining or overdue, and a circular progress ring.

---

## 🩸 Supported Integrations

This card is designed exclusively for use with the [Dexcom](https://www.home-assistant.io/integrations/dexcom/) integration, which is built into Home Assistant.

### Supported Trend Values

`doubleUp` · `singleUp` · `fortyFiveUp` · `flat` · `fortyFiveDown` · `singleDown` · `doubleDown`

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<p align="center">
  Made with ❤️ for the diabetes community
</p>