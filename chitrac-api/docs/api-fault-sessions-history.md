/api/alpha/analytics/fault-sessions-history

Returns fault session history over a time window, optionally scoped to a specific machine or operator. Designed for fault analytics and reporting: fault cycles, duration summaries, and work time impact analysis.

**Method:** GET
**Auth:** Same as other /api/alpha routes
**Idempotent:** Yes

**Query Parameters**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial | Integer | No | Restrict analytics to a specific machine serial. |
| operatorId | Integer | No | Restrict analytics to a specific operator ID. |

**Validation Rules**

- `start` and `end` are required.
- At least one of `serial` or `operatorId` must be provided.
- If provided, `serial` must be numeric.
- If provided, `operatorId` must be numeric.
- `start < end` must hold.

**Behavior & Notes**

- Fault sessions are clipped to the requested time window.
- Duration calculations use the clipped (overlapped) time range.
- Work time missed is calculated as `activeStations × durationSeconds`.
- Fault summaries aggregate by fault code and name combination.
- Results are sorted chronologically by fault start time.

**Example Request**

```json
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808
```

**Example Response**

```json
{
  "context": {
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T14:00:00.000Z",
    "serial": 67808,
    "machineName": "SPF1",
    "operatorId": null,
    "operatorName": null
  },
  "faultCycles": [
    {
      "id": "64f8a1b2c3d4e5f6a7b8c9d0",
      "start": "2025-05-01T12:15:30.000Z",
      "end": "2025-05-01T12:20:45.000Z",
      "durationSeconds": 315,
      "code": 24,
      "name": "Feeder Right Inlet Jam",
      "machineSerial": 67808,
      "machineName": "SPF1",
      "operators": [
        {
          "id": 135790,
          "name": "Lilliana Ashca",
          "station": 1
        }
      ],
      "items": [],
      "activeStations": 1,
      "workTimeMissedSeconds": 315
    }
  ],
  "faultSummaries": [
    {
      "code": 24,
      "name": "Feeder Right Inlet Jam",
      "count": 1,
      "totalDurationSeconds": 315,
      "totalWorkTimeMissedSeconds": 315,
      "formatted": {
        "hours": 0,
        "minutes": 5,
        "seconds": 15
      }
    }
  ]
}
```

**Empty Data Response**

```json
{
  "context": {
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T14:00:00.000Z",
    "serial": 67808,
    "operatorId": null
  },
  "faultCycles": [],
  "faultSummaries": []
}
```

**Field Reference**

**context**
- `start` (string): ISO 8601 timestamp of window start
- `end` (string): ISO 8601 timestamp of window end
- `serial` (integer|null): Machine serial if filtered by machine
- `machineName` (string|null): Machine name if available
- `operatorId` (integer|null): Operator ID if filtered by operator
- `operatorName` (string|null): Operator name if available

**faultCycles[]**
Array of individual fault sessions clipped to the time window:

| Field | Type | Description |
|-------|------|-------------|
| id | string | MongoDB ObjectId of the fault session |
| start | string | ISO 8601 timestamp of fault start (clipped to window) |
| end | string | ISO 8601 timestamp of fault end (clipped to window) |
| durationSeconds | integer | Duration in seconds (clipped to window) |
| code | integer|null | Fault code from start state |
| name | string | Fault name from start state |
| machineSerial | integer|null | Machine serial number |
| machineName | string|null | Machine name |
| operators | array | Array of operator objects with id, name, and station |
| items | array | Array of items affected during fault |
| activeStations | integer | Number of active stations during fault |
| workTimeMissedSeconds | integer | Total work time missed (activeStations × duration) |

**faultSummaries[]**
Aggregated fault statistics by code and name:

| Field | Type | Description |
|-------|------|-------------|
| code | integer|null | Fault code |
| name | string | Fault name |
| count | integer | Number of occurrences |
| totalDurationSeconds | integer | Total duration across all occurrences |
| totalWorkTimeMissedSeconds | integer | Total work time missed across all occurrences |
| formatted | object | Human-readable duration with hours, minutes, seconds |

**Additional Example Requests**

```json
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=135790
```

```json
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T08:00:00.000Z&end=2025-05-01T16:00:00.000Z&serial=67808&operatorId=135790
```

**Error Responses**

**400 Bad Request**

```json
{ "error": "Provide serial or operatorId" }
```

```json
{ "error": "serial and operatorId must be numbers when provided" }
```

**500 Internal Server Error**

```json
{ "error": "Failed to fetch fault history" }
```

---

**Input Parameters**

| Parameter | Type | Required | Validation |
|-----------|------|----------|------------|
| start | ISO 8601 timestamp | Yes | Must be valid date, start < end |
| end | ISO 8601 timestamp | Yes | Must be valid date, start < end |
| serial | Integer | No* | Must be numeric if provided |
| operatorId | Integer | No* | Must be numeric if provided |

*At least one of serial or operatorId must be provided.

**Data Format**

The route processes fault sessions from the `faultSessionCollectionName` collection:

```json
{
  "timestamps": {
    "start": "2025-05-01T12:15:30.000Z",
    "end": "2025-05-01T12:20:45.000Z"
  },
  "machine": {
    "serial": 67808,
    "name": "SPF1"
  },
  "operators": [
    {
      "id": 135790,
      "name": "Lilliana Ashca",
      "station": 1
    }
  ],
  "startState": {
    "status": {
      "code": 24,
      "name": "Feeder Right Inlet Jam"
    }
  },
  "activeStations": 1
}
```

**Computation Notes**

- **Time Clipping**: Fault sessions are clipped to the requested window using `ovStart` and `ovEnd` fields
- **Duration Calculation**: Uses clipped time range: `Math.max(0, Math.floor((ovEnd - ovStart) / 1000))`
- **Work Time Impact**: Calculated as `activeStations × durationSeconds` to account for multi-station operations
- **Fault Aggregation**: Summaries group by fault code and name combination for statistical analysis
- **Name Resolution**: Machine and operator names are resolved from the fault session data with fallbacks

**Versioning & Stability**

This route is Alpha; fields may be extended. Additions will be backward-compatible (additive).

Semantics of existing fields are stable; any breaking change will be versioned under a new path.
