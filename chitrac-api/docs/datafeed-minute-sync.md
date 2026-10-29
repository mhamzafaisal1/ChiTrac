# Live minute totals synchronization (CHITRAC-1200)

The datafeed API calculates totals-minute in memory. The server API is the sole writer of completed totals-minute buckets. Daily, hourly and shift totals keep their existing datafeed behavior.

## Configuration

Set the same `DATAFEED_SYNC_TOKEN` in both services' `.env` files. Use a randomly generated secret of at least 32 characters, for example the output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep this secret out of source control and browser configuration.

In the datafeed API, also set `SERVER_API_WS_URL` to the server API's reachable `/ws` endpoint, for example `ws://127.0.0.1:3000/ws`. Replace the example port with the server API's actual `PORT` (9090 on some development installations). Use `wss://` with the configured HTTPS port or a trusted reverse proxy for connections across hosts. Do not disable certificate verification. The client adds `?channel=datafeed-minute` itself.

The datafeed fails startup if its URL/token is absent or invalid. The server continues serving ordinary APIs/browser WebSockets without the token, but rejects service sync connections until a valid token is configured.

Deploy the server receiver before starting the new datafeed. Stop the old datafeed writer during cutover. Inspect/run the existing `scripts/migrate-totals-minute-ttl.js` migration as appropriate for the database before rollout; its default is a read-only report and `--apply` changes the indexes/legacy field. New completed records use the existing 48-hour `timestamps.update` TTL policy, with no `expiresAt` field. No migration is automatically run against existing data by this feature.

## Ownership and topology

Route each machine's ingestion to one authoritative datafeed process. Different datafeed processes can handle different machines. The receiver rejects overlapping connections for the same machine using Mongo-backed ownership leases, refreshed by WebSocket heartbeat. This does not make duplicate raw input delivery safe.

The configured URL must point to the authoritative server API process for live-minute reads. Independent API replicas do not share their in-memory overlays; deployments using multiple API processes need sticky routing or a shared live-cache/fan-out layer before enabling this feature across those replicas.

## Calculation and recovery

Machine status/count processing and rollover are serialized per machine. A warm accumulator observes acknowledged session writes and reuses the existing totals calculation (machine, operator-machine, machine-item, item and operator-item). It does not read minute/session history again per live count. Rollover runs on the next minute boundary, including machines that have not emitted counts. It catches up all missed minutes. A `Z` suffix namespaces the UTC bucket IDs away from legacy local-time IDs, so an old local-time record cannot be overwritten as a different UTC minute. UTC bucket IDs distinguish the repeated local minute during the autumn clock change; shift/break math remains in the plant timezone.

A snapshot carries version, machine ID, UTC minute start/end, revision, calculation time, completion flag and the complete entity set for that bucket. Incomplete snapshots update server memory only. A bucket is persistable only when its full minute has elapsed. The server replaces the bucket's entity set, removes stale entities and records a commit checkpoint before acknowledging it. Retries are idempotent; older revisions and partial snapshots cannot replace a committed bucket. There is no per-count checkpoint/lease write: ownership is cached between heartbeats, and checkpoint reads are cached per bucket.

The datafeed coalesces live snapshots and retains unacknowledged completions in memory. At most 64 completed snapshots retain full payloads (plus an in-flight reconstruction); older entries retain only small replay metadata and reconstruct their values from durable sessions before transmission. Replay metadata is limited to the existing 48-hour minute-retention window. It sends one snapshot at a time and replays after reconnect, interleaving live values with completed history so neither can starve the other. On process restart, it reconstructs the retained 48-hour source-session window, including late corrections older than the newest checkpoint. This intentionally permits idempotent replay of already completed buckets. Historical/backfilled session corrections use the same final writer; expired history outside the minute-retention window is not rebuilt.

The server merges memory and Mongo by bucket/entity identity. A committed overlay is retained until a Mongo read contains the matching revision, preventing missing or double-counted values during handover. Production stats refresh on incoming snapshots using cached history and an elapsed source-database clock reference; regular polling refreshes durable history/tickers/shifts. API/dashboard cache metadata includes `liveMinute.connected`, `liveMinute.stale` and `liveMinute.updatedAt`. A disconnected or old source is marked stale.

## Checks

Run `npm test` in both `chitrac-api` and `chitrac-datafeed-api`. Coverage includes no current-minute writes, existing totals formulas, concurrent event ordering, idle rollover, late corrections, restart recovery, DST, authenticated real WebSockets, ownership conflicts, acknowledgement loss/coalescing, failed writes and duplicate-free memory/Mongo handover.

For a reproducible cross-repository check, run `node scripts/verify-minute-sync.js <path-to-chitrac-server/chitrac-api>` from the datafeed checkout. It uses real local WebSockets with in-memory Mongo doubles and includes an outage that forces reconstruction of evicted payloads. Keep service clocks synchronized; future completed-minute boundaries are rejected.
