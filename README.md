# 🐬 Dolphin Diabetes Card

A sleek [Home Assistant](https://www.home-assistant.io/) dashboard card for monitoring blood glucose levels. Displays your current reading, trend direction with dynamic animated arrows, a status ring, and an optional historical graph.

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz)
[![HA Version](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white)](https://www.home-assistant.io/)
![Custom Card](https://img.shields.io/badge/Dashboard-Custom%20Card-white?style=for-the-badge&logo=homeassistant&logoColor=41BDF5)

---

![Preview 1](https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview1.png)

<p align="center">
  <img src="https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview2.png" width="48%" />
  &nbsp;
  <img src="https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview3.png" width="48%" />
</p>

---

## ✨ Features

- **Animated ring gauge** — fills and colours dynamically based on your low/high thresholds
- **Colour-coded readings** — green in range · red low · amber high, applied to the ring, number, trend arrow, and status pill
- **Dynamic trend arrows** — smooth CSS rotation supporting Dexcom, Nightscout, and plain-text trend states
- **Historical graph** — fetches real data from the HA history API with threshold guide lines and gradient fill
- **Stale reading warning** — timestamp turns amber when data is older than 15 minutes
- **Full visual editor** — no YAML required, configure everything from the UI

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

### Full Options

| Option | Type | Default | Description |
|---|---|---|---|
| `glucose_entity` | `string` | **required** | Entity ID of your glucose sensor |
| `trend_entity` | `string` | — | Entity ID of your trend direction sensor |
| `unit` | `mmol` \| `mgdl` | `mmol` | Glucose unit of measurement |
| `show_graph` | `boolean` | `true` | Show the historical blood sugar graph |
| `graph_hours` | `1\|3\|6\|12\|24` | `3` | How many hours of history to display |
| `low_threshold` | `number` | `3.9` | Low glucose threshold (mmol/L or mg/dL) |
| `high_threshold` | `number` | `10.0` | High glucose threshold |
| `show_title` | `boolean` | `true` | Show the card title |
| `title` | `string` | `Blood Sugar` | Card title text |
| `accent_color` | `string` | `#007AFF` | Ring and highlight colour |
| `normal_color` | `string` | `#34C759` | In-range reading colour |
| `low_color` | `string` | `#FF3B30` | Low reading colour |
| `high_color` | `string` | `#FF9500` | High reading colour |
| `graph_line_color` | `string` | `#007AFF` | Graph line colour |
| `graph_fill_color` | `string` | `#007AFF` | Graph area fill colour |
| `card_bg` | `string` | `#1c1c1e` | Card background colour |
| `card_bg_opacity` | `number` | `80` | Card background opacity (0–100) |
| `text_color` | `string` | `#ffffff` | Primary text colour |

### Example with all options

```yaml
type: custom:dolphin-diabetes-card
glucose_entity: sensor.dexcom_glucose
trend_entity: sensor.dexcom_trend
unit: mmol
show_graph: true
graph_hours: 3
low_threshold: 3.9
high_threshold: 10.0
title: Blood Sugar
accent_color: "#007AFF"
normal_color: "#34C759"
low_color: "#FF3B30"
high_color: "#FF9500"
graph_line_color: "#007AFF"
graph_fill_color: "#007AFF"
card_bg: "#1c1c1e"
card_bg_opacity: 80
text_color: "#ffffff"
```

---

## 🩸 Supported Integrations

The card works with any Home Assistant sensor that provides a numeric glucose value. Tested with:

- [Dexcom](https://www.home-assistant.io/integrations/dexcom/) (built-in HA integration)
- [Nightscout](https://github.com/dhomeier/nightscout-hacs) via HACS
- [xDrip+](https://github.com/blobsmith/xdrip) via MQTT or REST sensor
- Any `sensor` entity whose `state` is a numeric glucose value

### Trend State Values

The card automatically detects trend direction from state strings including:

`rising_quickly` · `rising` · `rising_slightly` · `flat` · `falling_slightly` · `falling` · `falling_quickly`

Dexcom-style values are also supported: `doubleUp` · `singleUp` · `fortyFiveUp` · `flat` · `fortyFiveDown` · `singleDown` · `doubleDown`

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<p align="center">
  Made with ❤️ for the diabetes community
</p>
