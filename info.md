# 🐬 Dolphin Diabetes Card

A sleek Home Assistant dashboard card for monitoring blood glucose levels at a glance.

![Dolphin Diabetes Card preview](https://raw.githubusercontent.com/jamesmcginnis/dolphin-diabetes-card/main/preview.png)

---

## What it shows

- **Glucose ring** — animated ring on the left fills and colour-codes your current reading (green in range, red low, amber high), with an optional breathing glow. A status badge beneath the ring shows In Range, Low, or High at a glance
- **Trend arrow** — large directional arrow in the centre zone shows your current trend direction (↑↑ Rising Fast → → Steady → ↓↓ Falling Fast) with a label beneath; tap to view recent trend history
- **30-minute forecast pill** — estimates your glucose 30 minutes into the future using a weighted linear regression over recent readings; colour-coded to your configured thresholds; tap for a friendly contextual message
- **Sensor life pill** — optional countdown showing days remaining on your current sensor; turns red on the last day
- **History graph** — full-width colour-coded line segments with threshold guide lines, fetched from your HA history
- **Stale data warning** — the header timestamp turns amber if the reading is more than 15 minutes old
- **Sensor unavailable** — the whole card gracefully fades to grey when the sensor goes offline

## Layout

The card uses a three-zone layout designed for full-width dashboard panels:

- **Left zone** — glucose ring with status badge below
- **Centre zone** — trend arrow and direction label
- **Right zone** — 30-min forecast pill and sensor life pill stacked vertically

Thin dividers separate each zone, and a full-width history graph runs across the bottom of the card.

## Tap and long press

A single tap opens a detail popup with a large reading, trend arrow, a 1h/3h/6h/12h/24h time range selector for the graph, and any available sensor attributes such as delta, battery, and transmitter ID.

Tapping the **30-min pill** opens a forecast popup with your estimated glucose, projected change, and a short friendly message if things are heading low or high — without offering medical advice.

Tapping the **trend arrow** opens a trend history popup showing the last 50 readings with timestamps.

Tapping the **sensor pill** opens a sensor life popup with applied date, expiry, time remaining, and a progress ring.

A long press opens the native Home Assistant entity detail screen.

## 30-Minute Forecast

The forecast uses a weighted linear regression over the last 40 minutes of glucose history, giving more weight to the most recent readings. The result is colour-coded using your configured low and high thresholds and updates every 5 minutes. It is an estimate based on recent trends — not a clinical reading.

## Configuration

Everything is configurable through the built-in visual editor — no YAML needed. Options include sensor entity pickers, unit toggle (mmol/L or mg/dL), alert thresholds, show/hide graph with time range selector, breathing effect toggle, sensor life countdown with start date and duration, and full colour control across rings, graph, sensor pill, forecast pill, and card background.

## Supported integrations

Works with any numeric glucose sensor in Home Assistant, including Dexcom, Nightscout, xDrip+, and custom REST or MQTT sensors.