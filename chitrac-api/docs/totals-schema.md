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
