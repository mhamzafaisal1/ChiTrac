# Alarm configuration

`schemas/alarm.js` extends the configuration fields historically shared by faults and statuses.
`fault` and `stop` are required booleans. `alarmCode` and `alarmValue` are optional numbers;
zero is valid. `fault` and `stop` are independent, including faults that do not stop the machine
and stopping alarms that are not faults. `config-alarm` is the authoritative configuration.

On startup, an empty or missing `config-alarm` is populated
from the site's `config-fault` records, retaining identifiers and timestamps and adding
`fault: true` and `stop: true`. If no faults are available, bundled alarm defaults are used.
Existing populated alarm configuration is left intact. The copy uses upserts and a unique ID index;
the original fault collection is retained only as a migration source, and is no longer seeded on boot.
This runs against the configured database at next boot;
no manual database migration is needed.

- `GET /api/alarm/config` and `GET /api/alarm/config/xml`
- `PUT /api/alarm/config/:id` (numeric ID or MongoDB ObjectId)
- `DELETE /api/alarm/config/:id`

PUT supports partial updates to existing alarms, validates the complete resulting record, and
returns HTTP 400 for invalid fields or HTTP 409 for a conflicting ID. New alarms require both flags.
Alarms participate in configuration websocket snapshots and configuration exports.
The former `/api/fault/config` and `/api/faults/config` routes are compatibility aliases to the same
alarm collection; their JSON and XML GET routes return only alarms with `fault: true`, regardless
of `stop`. The alarm GET routes return every alarm. Edits never diverge into `config-fault`. New records created through a legacy
route default to `fault: true, stop: true`; partial updates retain the existing flags.
Websocket configuration uses the `alarm` key, with no legacy `fault` alias. Physical `config-fault`
records are excluded from live configuration snapshots and exports. Frontend fault configuration reads filter
alarms by `fault: true`, while alarm reads and the export selector use the full alarm collection.

Deploy the server API first so `config-alarm` exists, followed by the datafeed API and simulator.
The datafeed accepts the new top-level `alarm` event object and legacy fault status payloads.
Stopping faults retain fault status codes; stopping non-fault alarms use paused status; non-stopping
alarms preserve the operating status and allow production counts to continue. Alarm identity and
BIKO fields remain available on recorded states and live tickers.
The datafeed response preserves producer status/alarm fields; normalized fields are used only for
derived state, session and ticker records. Operating alarms are restored into memory at datafeed
startup and carried through counts without an extra per-count MongoDB read.
