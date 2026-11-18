# Cascade MQTT subscriber

Reads the Cascade PLC status published over MQTT and stores it in MongoDB.

**Path:** IDEC FC6A (192.168.70.177) → Mosquitto on the Pi (192.168.70.186:1883) → this subscriber → MongoDB

## Payload (published every 1 s on `chitrac/cascade/bench/status`)

```json
{"source":"cascade-bench","readyToStart":false,"paused":false,"running":false,"lowAir":false}
```

PLC devices: readyToStart = M2100, paused = M2101, running = M2102, lowAir = M2103.
`running` is the machine signal, not the PLC CPU RUN state. Polarity and full
machine-state meaning are not confirmed with controls yet, so values are stored as published.

## Collections

| Collection | Contents |
|---|---|
| `state-cascade-mqtt` | One doc per `source`: `signals`, `lastChangedAt`, `lastSeenAt` (refreshed every 10 s while unchanged) |
| `log-cascade-mqtt` | One doc per signal change: `signals`, `previous`, `timestamp` |

Treat the current state as stale if `lastSeenAt` is older than ~30 s (`isCascadeStatusStale()`).

## Settings (`chitrac-api/.env`)

```
CASCADE_MQTT_URL=mqtt://192.168.70.186:1883
CASCADE_MQTT_USERNAME=cascade-plc
CASCADE_MQTT_PASSWORD=...
# optional
CASCADE_MQTT_TOPIC=chitrac/cascade/bench/status
CASCADE_MQTT_HEARTBEAT_MS=10000
CASCADE_MQTT_STALE_AFTER_MS=30000
```

## Running

The API server starts the subscriber automatically when `CASCADE_MQTT_URL` is set
(see `index.js`). If it can't start, the error is logged and the rest of ChiTrac keeps running.

For testing without the server:

```
node scripts/cascade-mqtt-subscriber.js --dry-run   # print only, no database
node scripts/cascade-mqtt-subscriber.js             # store to MONGO_CONN_STRING
```

Don't run the standalone script and the server against the same database at the same time.

## API (JWT required, like other ChiTrac APIs)

- `GET /api/cascade/status` → `{ enabled, staleAfterMs, sources: [{ source, signals, lastChangedAt, lastSeenAt, stale }] }`
- `GET /api/cascade/events?limit=50` → `{ events: [...] }` newest first, max 500

## UI

Dashboards → **Cascade (MQTT)** (`/ng/cascade-status`): live signal tiles, a Live / No data badge,
and the most recent changes. Refreshes every 5 s.

The client reconnects automatically every 5 s if the broker or network drops.
