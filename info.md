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

- **Current glucose reading** with an animated colour-coded ring gauge
- **Trend direction** with a dynamic arrow — rising fast, steady, falling, and everything in between
- **Status pill** — In Range · Low · High, coloured to match
- **Historical graph** pulling real data from your Home Assistant history
- **Stale data warning** — the timestamp turns amber if the reading is more than 15 minutes old

## Configuration

Everything can be configured through the built-in visual editor — no YAML needed. Options include:

- Glucose and trend sensor entity pickers
- Unit toggle (mmol/L or mg/dL)
- Low and high threshold values
- Show or hide the historical graph, with time range selection (1h · 3h · 6h · 12h · 24h)
- Full colour control — ring, status colours, graph line, card background, and more

## Supported integrations

Works with any numeric glucose sensor in Home Assistant, including Dexcom, Nightscout, xDrip+, and custom REST or MQTT sensors.
