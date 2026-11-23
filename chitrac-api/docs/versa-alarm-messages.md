# Versa alarm messages

`POST /api/biko/versa` recognizes an alarm when the incoming `status` object has
an `alarmCode` field. `status.code` and `status.alarmValue` are preserved; neither
is used as a truthiness-based alarm discriminator. Code zero and alarm value zero
are valid, and enrichment is applied regardless of the alarm value.

The route looks up `config-alarm-versa.id` using the numeric alarm code, then copies
only the definition's `stop` and `name` into `status`. These configured values
override producer-supplied values for the same fields. Other message fields are
preserved, including the original alarm code type. Existing timestamp conversion
to a BSON Date and response formats are retained.

Example incoming status:

```json
{"status":{"code":0,"alarmCode":0,"alarmValue":1}}
```

With definition `{ "id": 0, "stop": true, "name": "Emergency stop" }`, the stored
status and JSON response's `receivedBody.status` become:

```json
{"code":0,"alarmCode":0,"alarmValue":1,"stop":true,"name":"Emergency stop"}
```

Non-alarm messages skip the lookup. Unknown alarms, including IDs 24, 68 and 85
while their definitions are omitted, are stored without enrichment and generate
a warning. No name or stop classification is invented. Incoming fields, if present,
are retained in this case. A missing catalog therefore behaves like an unmatched
code; deploy and run the [alarm import](versa-alarm-import.md) before enabling
traffic that requires enrichment.

Alarm codes eligible for enrichment must be nonnegative safe integers or strings
containing only decimal digits. Malformed codes skip the lookup, generate a warning,
and are stored without enrichment. Matched definitions missing a boolean `stop` or
a nonempty string `name` also generate a warning and leave the message intact;
neither enrichment field is copied when either definition field is invalid.

Actual lookup and insertion failures are forwarded to the application's error
handler. The route does not acknowledge successful ingestion when database access
fails. Successful responses for malformed codes or invalid definitions mean the
original message was saved, not that enrichment succeeded.

All messages continue to be stored only in `versa`. There is no fallback to
Chicago's `config-alarm`, no historical backfill, and no changes to the datafeed,
simulator, sessions, or other machine alarm catalogs. Future BIKO integrations
must choose their own catalog rather than assuming numeric IDs are globally unique.
