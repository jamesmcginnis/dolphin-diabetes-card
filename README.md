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
- **Trend arrow** — large directional arrow (↑↑ → ↓↓) with direction label; tap to view the last 50 trend readings with timestamps
- **30-minute glucose forecast** — estimates where your glucose is likely to be in 30 minutes using a weighted linear regression over the last 40 minutes of readings; colour-coded to your configured thresholds
- **Forecast popup** — tap the 30-min pill for a friendly, contextual message depending on whether your estimated glucose is low, high, or in range, along with a projected change from current
- **Sensor life countdown** — optional pill showing days remaining on your current sensor, turns red on the last day
- **Sensor unavailable state** — everything fades to grey when the sensor is offline or unavailable
- **Tap for details** — single tap opens an elegant popup with a large reading, trend arrow, time range selector (1h–24h), history graph, and live sensor attributes
- **Long press for more info** — opens the native Home Assistant entity detail screen
- **Historical graph** — full-width colour-coded line segments, threshold guide lines, and gradient fill fetched directly from the HA history API
- **Stale reading warning** — timestamp in the header turns amber when data is older than 15 minutes
- **Full visual editor** — every option configurable from the UI, no YAML required

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

## 🛠️ Configuration

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
| `sensor_pill_normal_color` | `string` | `#34C759` | Sensor pill text colour when days remain |
| `sensor_pill_urgent_color` | `string` | `#FF3B30` | Sensor pill text colour on last day |
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
sensor_pill_urgent_color: "#FF3B30"
card_bg: "#1c1c1e"
card_bg_opacity: 80
text_color: "#ffffff"
```

---

## 👆 Interactions

| Gesture | Action |
|---|---|
| **Tap** | Opens a detail popup with large reading, trend arrow, selectable graph time range (1h–24h), and sensor attributes |
| **Tap 30-min pill** | Opens a friendly forecast popup showing your estimated glucose in 30 minutes, projected change, and contextual guidance if trending low or high |
| **Tap trend arrow** | Opens a trend history popup showing the last 50 trend readings with timestamps |
| **Tap sensor pill** | Opens a sensor life popup with applied date, expiry date, time remaining, and a progress ring |
| **Long press** | Opens the native Home Assistant more-info panel for the glucose entity |

---

## 🔮 30-Minute Glucose Forecast

The forecast pill sits in the right zone of the card and estimates where your glucose is likely to be in 30 minutes. It uses a **weighted linear regression** over the last 40 minutes of readings from the HA history API, giving more weight to the most recent data points. The result is clamped to a sensible range and colour-coded using your configured low and high thresholds.

Tapping the pill opens a friendly popup with:

- Your estimated glucose value and unit
- Whether it's projected to be low, in range, or high
- A projected change from your current reading
- A short, friendly message appropriate to the forecast — with a gentle reminder to follow your personal care plan if things look like they're heading out of range

> **Note:** This is an estimate based on recent trend data, not a clinical measurement. Always follow your personal diabetes management plan.

---

## 🩸 Supported Integrations

The card works with any Home Assistant sensor that provides a numeric glucose value. Tested with:

- [Dexcom](https://www.home-assistant.io/integrations/dexcom/) (built-in HA integration)
- [Nightscout](https://github.com/dhomeier/nightscout-hacs) via HACS
- [xDrip+](https://github.com/blobsmith/xdrip) via MQTT or REST sensor
- Any `sensor` entity whose `state` is a numeric glucose value

### Supported Trend Values

The card automatically detects trend direction from a wide range of state strings:

`rising_quickly` · `rising` · `rising_slightly` · `flat` · `falling_slightly` · `falling` · `falling_quickly`

Dexcom-style values are also supported: `doubleUp` · `singleUp` · `fortyFiveUp` · `flat` · `fortyFiveDown` · `singleDown` · `doubleDown`

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<p align="center">
  Made with ❤️ for the diabetes community
</p>