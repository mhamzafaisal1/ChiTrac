# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

### Item Analytics Routes

#### `/api/alpha/analytics/item-stacked-by-hour`

Returns stacked item counts per hour within a time window, scoped by operator, machine, or both. Counts are clipped to the window and misfeeds are excluded.

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| `end` | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). If a future time is provided, it is clamped to server "now". |
| `operatorId` | Integer | At least one of `operatorId` or `serial` | Scope to a specific operator's sessions. |
| `serial` | Integer | At least one of `operatorId` or `serial` | Scope to a specific machine serial. |

**Validation Rules**

- Both `start` and `end` must parse as valid dates.
- At least one of `operatorId` or `serial` must be provided.
- `start < end` must hold; otherwise a 400 is returned.

**Behavior & Notes**

- If `operatorId` is provided (alone or with `serial`), data is sourced from operator-sessions; otherwise from machine-sessions.
- Sessions must overlap the `[start, end)` window.
- Only counts with timestamps inside the window are included; misfeeds are excluded.
- If both `operatorId` and `serial` are provided, counts are further restricted to that machine serial.
- Item name falls back to "Unknown" when missing.
- Hours are returned as relative 1-hour bins from the start of the window: 0 = first hour, 1 = second hour, etc.

**Example Request**

```
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&operatorId=117811
```

**Example Response**

```json
{
  "title": "Item Stacked Count Chart",
  "data": {
    "hours": [0, 1, 2, 3],
    "operators": {
      "Pool Towel": [120, 135, 98, 110],
      "Bath Towel": [45, 67, 89, 72]
    }
  },
  "meta": {
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T16:00:00.000Z",
    "serial": 67808,
    "operatorId": 117811,
    "mode": "both"
  }
}
```

**Field Reference**

- `title` (string) — Chart title or "No data" if empty.
- `data.hours` (array of integers) — Hour indices from start of window (0 = first hour, 1 = second hour, etc.).
- `data.operators` (object) — Item names mapped to arrays of counts per hour.
- `meta.start` (ISO string) — Window start timestamp.
- `meta.end` (ISO string) — Window end timestamp (may be clamped to now).
- `meta.serial` (number, optional) — Machine serial if specified.
- `meta.operatorId` (number, optional) — Operator ID if specified.
- `meta.mode` (string) — Scope mode: "operator", "machine", or "both".

**Empty Data Response**

If no data falls in the window, the service returns:

```json
{
  "title": "No data",
  "data": {
    "hours": [],
    "operators": {}
  },
  "meta": {
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T16:00:00.000Z",
    "serial": 67808,
    "operatorId": 117811,
    "mode": "both"
  }
}
```

**Additional Example Requests**

```
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&serial=67808
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&operatorId=117811&serial=67808
```

**Error Responses**

**400 Bad Request** — Missing required parameters.

```json
{ "error": "Provide serial or operatorId" }
```

**500 Internal Server Error**

```json
{ "error": "Failed to build item stacked chart" }
```

---

**Input Parameters**

| Label | Definition | Required |
|-------|------------|----------|
| start | Start timestamp of the query window (ISO 8601) | Yes |
| end | End timestamp of the query window (ISO 8601). If in the future, it is clamped to now | Yes |
| operatorId | Operator ID to scope the data | At least one of operatorId or serial |
| serial | Machine serial to scope the data | At least one of operatorId or serial |

**Data Format**

```json
{
  "title": "Item Stacked Count Chart",                    String chart title
  "data": {
    "hours": [0, 1, 2, 3],                               Array of hour indices from window start
    "operators": {
      "Pool Towel": [120, 135, 98, 110],                 Item name mapped to hourly counts
      "Bath Towel": [45, 67, 89, 72]                     Item name mapped to hourly counts
    }
  },
  "meta": {
    "start": "2025-05-01T12:00:00.000Z",                 String ISO start of window
    "end": "2025-05-01T16:00:00.000Z",                   String ISO end of window (may be clamped)
    "serial": 67808,                                      Integer machine serial (if specified)
    "operatorId": 117811,                                 Integer operator ID (if specified)
    "mode": "both"                                        String scope mode
  }
}
```

**Computation Notes**

- Sessions overlapping the window are truncated to `[start, end)`.
- Counts are filtered to the clamped window; misfeeds are excluded.
- Hour bins are relative to window start: hour 0 = first hour of window, hour 1 = second hour, etc.
- If both `operatorId` and `serial` are provided, data is restricted to that specific operator on that specific machine.
- Item names default to "Unknown" when the item information is missing from the session data.