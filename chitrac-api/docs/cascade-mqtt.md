# Cascade MQTT subscriber

Reads the Cascade PLC status published over MQTT and stores it in MongoDB.

**Path:** IDEC FC6A (192.168.70.177) → Mosquitto on the Pi (192.168.70.186:1883) → this subscriber → MongoDB

## Payload (published every 1 s on `chitrac/cascade/bench/status`)

```json
{"source":"cascade-bench","readyToStart":false,"paused":false,"running":false,"lowAir":false}
```

PLC devices: readyToStart = M2100, paused = M2101, running = M2102, lowAir = M2103.
`running` is the machine signal, not the PLC CPU RUN state. Values are retained as published. State conversion follows the existing ChiTrac status/alarm contract.

## Events and status

Each real signal change is parsed into events and a ChiTrac status (`modules/cascadeEvents.js`):

| Signal | Turns on | Turns off |
|---|---|---|
| running | `start` | `stop` |
| paused | `pause` | `resume` |
| lowAir | `fault` | `faultCleared` |
| readyToStart | `ready` | `notReady` |

Status (first match wins), following the datafeed-api contract (1 = run, 0 = paused/idle, >1 = fault via `config-alarm`):

| Condition | Status |
|---|---|
| lowAir | 19 Lo Air Pressure |
| running | 1 Run |
| paused | 0 Paused |
| otherwise | 0 Idle |

Alarm 19 is the existing active stopping fault in Alpha `config-alarm` (`fault: true`, `stop: true`).
Serial 90050 is registered in Alpha `config-machine` as **Cascade Bench**, type Cascade, one lane/station,
self-reporting (`polled: false`) and not simulated. Its PLC IP is 192.168.70.177.
No existing machine or alarm definitions were changed. Codes above 1 are resolved through `config-alarm`;
non-stopping alarms follow their configured flags rather than automatically stopping production.

## Datafeed forwarding (off unless configured)

When `CASCADE_DATAFEED_URL` is set, the first fresh snapshot, every **status change**, and a heartbeat
every 5 seconds while fresh PLC snapshots continue are POSTed to the datafeed-api. This keeps the standard
datafeed watchdog from marking an unchanged machine Offline. Heartbeats do not add duplicate transition events.
After a bridge restart, stored state is compared for changes but its current status is still initialized in the datafeed.
No heartbeat is generated from a timer after PLC messages disappear.

```json
{"machineInfo":{"serial":90050,"name":"Cascade"},"timestamp":"2026-11-19T14:00:00.000Z","status":{"code":1,"name":"Run"}}
```

Messages are sent one at a time in order, with a 30-second request timeout. Network errors, HTTP 408/429,
and 5xx responses are retried every 5 seconds; other 4xx responses are logged and dropped.
Up to 500 messages are held in memory while the datafeed is down. Overflow drops the oldest waiting
message and logs the loss; an in-flight request is never removed by overflow. The queue is lost on
restart; durable buffering is not implemented.

```
CASCADE_DATAFEED_URL=http://chitrac-alpha:50100/datafeed/post
CASCADE_MACHINE_SERIAL=90050
CASCADE_MACHINE_NAME=Cascade Bench
CASCADE_DATAFEED_HEARTBEAT_MS=5000
CASCADE_DATAFEED_TIMEOUT_MS=30000
```

Run only **one** subscriber per broker/database, or changes are logged and sent twice.
Enable these settings on the deployed subscriber, not on a second local subscriber.
The 5-second forwarding heartbeat is separate from the 10-second local Mongo heartbeat.
Keep the forwarding interval below the datafeed watchdog threshold (currently 10 seconds).

A finite integration check uses the real PLC snapshot and writes only serial 90050; it does not
force PLC I/O or invent running/fault transitions. Read history using datafeed-server time when
verifying remote records: the laptop and Alpha clocks may differ.

## Collections

| Collection | Contents |
|---|---|
| `state-cascade-mqtt` | One doc per `source`: `signals`, `lastChangedAt`, `lastSeenAt` (refreshed every 10 s while unchanged) |
| `log-cascade-mqtt` | One doc per signal change: `signals`, `previous`, `events`, `status`, `statusChanged`, `timestamp` |

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
node scripts/cascade-mqtt-subscriber.js --dry-run   # print only, no database; prints datafeed messages instead of sending
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
