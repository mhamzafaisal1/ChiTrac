# Totals collections schema

`totals-daily`, `totals-hourly`, and `totals-shift` use the same canonical
document shape. MongoDB owns `_id`; `id` is the deterministic cache key.

```js
{
  _id: ObjectId,
  id: "operator-item-173878-42-99003-2026-07-06",
  type: "operator-item",
  timestamps: {
    create: Date,
    active: Date,
    update: Date,
    start: Date,
    end: Date
  },
  machine: { id: 99003, name: "Machine 3" },
  operator: { id: 173878, name: { first: "A", surname: "Operator" } },
  item: { id: 42, name: "Item 42", standard: 120 },
  shift: { _id: ObjectId, id: "optional-domain-id", name: "First" },
  totals: {
    runtimeMs: 0,
    faultTimeMs: 0,
    workedTimeMs: 0,
    pausedTimeMs: 0,
    breakTimeMs: 0,
    faults: 0,
    count: 0,
    misfeeds: 0,
    timeCreditMs: 0
  },
  source: "simulator"
}
```

Identity objects are present when applicable. Shift objects are stored only in
`totals-shift`.

Calendar queries use half-open BSON date ranges on `timestamps.create` in
`America/Chicago`. MongoDB grouping uses `$dateTrunc` with the same timezone.
The stored `totals.breakTimeMs` value is authoritative. Raw-session fallback
paths may calculate break overlap when no totals document exists.

The API may continue returning established response names such as
`machineSerial` or `totalCount`; those are response DTO fields and are not
stored totals fields.

## Minute totals expiry (CHITRAC-1190)

`totals-minute` uses `timestamps.update` as its TTL date, with a 48-hour
retention period (`expireAfterSeconds: 172800`). The redundant top-level
`expiresAt` field is removed. Rebuilding a bucket advances its last-update
date and therefore its expiry; the migration preserves existing timestamps.

Run the server-side migration from `chitrac-api`. It uses the server's configured
MongoDB connection and minute-totals collection name and defaults to a dry run:

```powershell
npm run migrate:totals-minute-ttl
npm run migrate:totals-minute-ttl -- --apply
```

The migration refuses to apply if any minute record lacks a BSON Date
`timestamps.update`. It installs the new TTL index before dropping legacy TTL
indexes on `expiresAt`, then unsets only that field. Existing single-field
indexes on `timestamps.update` are reused; changing their TTL option requires
MongoDB 5.1 or newer (see the [MongoDB TTL documentation](https://www.mongodb.com/docs/manual/core/index-ttl/)).
Document IDs, totals, and timestamps are preserved.
Repeated runs are safe. Other totals collections and password-reset expiry
are unaffected.

This is an explicit deployment migration, not an automatic server-startup
operation: enabling the new TTL can expire records last updated over 48 hours
ago. Coordinate with processes that write this shared collection so they do not
reintroduce `expiresAt` or its legacy TTL index after migration. This change
does not modify the datafeed repository.
