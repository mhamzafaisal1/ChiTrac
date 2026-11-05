# API token usage and request logs

Every API request with a supported supplied credential is inspected once, including
public endpoints and requests made while `ENABLE_API_TOKEN_CHECK=false`. Only a
verified, active permanent token is attributed to an `auth-tokens` record. Optional
auditing does not grant controller permissions or change public/bypass access.

`usageCount` counts verified-token requests, including requests subsequently denied
by controller permissions or rejected by the handler. `lastUsed` and
`timestamps.update` advance atomically without moving backwards. Existing creation
and activation dates are preserved. A usage-write failure is reported separately;
it does not turn a valid credential into a 401. The request's
`authentication.usageRecorded` field indicates whether the update was recorded.
These counters are operational telemetry, not transactional billing records.

HTTP log documents contain `request` (method, path, status, total duration, aborted)
and `authentication` (mode, verification result, verified token ID/name when known).
No credential values, headers, bodies, or query strings are copied into HTTP logs.
Invalid/unknown tokens are never attributed using unverified JWT claims. JWT user
sessions do not increment permanent API token counters.

New MongoDB HTTP/error and WebSocket logs use BSON Date fields under `timestamps`
(`create`, `active`, `update`; HTTP logs also have `start` and `end`). WebSocket
protocol messages keep their existing wire-format timestamp. File/console output
continues through Winston. Mongo writes use a schema-aware transport; editing
`node_modules` is not required.

The log API reads both new records and legacy top-level `timestamp` records,
filters/counts them consistently, and sorts them together before pagination. Its
`timestamp` response field is a compatibility alias for the existing viewer;
structured request/authentication fields are also available in the viewer's details.
Old logs and missing historical usage are not rewritten or fabricated.

Before deployment, preview the new log indexes (no connection or writes):

    node scripts/ensure-log-indexes.js

During the deployment maintenance window, create them in the configured logging DB:

    node scripts/ensure-log-indexes.js --apply

The script is idempotent, retains existing indexes/retention rules, and never
rewrites or deletes log records. Index creation is explicit rather than an
unbounded startup task. Keep the legacy `timestamp` index while old logs remain.

To investigate Spindle, correlate a request time/path/response status with
`authentication.tokenId` in `api-http`, then inspect the matching `auth-tokens`
record. In bypass mode, a valid token is still tracked; an invalid token is logged
as invalid without changing bypass access. Requests to another server or requests
without a supplied permanent token cannot establish use of Spindle's token.
