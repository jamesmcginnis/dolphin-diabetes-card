# 🐬 Dolphin Diabetes Card

A sleek Home Assistant dashboard card for monitoring blood glucose levels at a glance.

![Preview 1](https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview1.png)

<p align="center">
  <img src="https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview2.png" width="48%" />
  &nbsp;
  <img src="https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview3.png" width="48%" />
</p>

---

## What it shows

- **Glucose ring** — animated ring on the left fills and colour-codes your current reading (green in range, red low, amber high), with a gentle breathing glow
- **Trend ring** — matching ring on the right shows direction (Rising Fast → Steady → Falling Fast) via fill level and label, no arrows
- **Sensor life pill** — optional countdown between the rings showing days remaining on your current sensor; turns red on the last day with its own breathing glow
- **History graph** — colour-coded line segments with threshold guide lines, fetched from your HA history
- **Stale data warning** — the header timestamp turns amber if the reading is more than 15 minutes old
- **Sensor unavailable** — the whole card gracefully fades to grey when the sensor goes offline

## Tap and long press

A single tap opens a detail popup with a large reading, trend ring, a 1h/3h/6h/12h/24h time range selector for the graph, and any available sensor attributes such as delta, battery, and transmitter ID. A long press opens the native Home Assistant entity detail screen.

## Configuration

Everything is configurable through the built-in visual editor — no YAML needed. Options include sensor entity pickers, unit toggle (mmol/L or mg/dL), alert thresholds, show/hide graph with time range selector, sensor life countdown with start date and duration, and full colour control across rings, graph, sensor pill, and card background.

## Supported integrations

Works with any numeric glucose sensor in Home Assistant, including Dexcom, Nightscout, xDrip+, and custom REST or MQTT sensors.
