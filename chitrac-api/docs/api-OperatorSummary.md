# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

### Operator Analytics Routes

#### `/api/alpha/analytics/operator-summary`

Returns an array of operator summaries over a time window, including current machine assignment (from the most recent ticker).

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| `end` | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**Validation Rules**

- Both must be valid dates; `start < end`. Same 400 behavior as machines route.

**Behavior & Notes**

- The endpoint first determines active operators in the window.
- It constructs running cycles (operator "on task" periods) bounded to the window. If no running cycles exist for an operator, that operator is omitted from the result.
- For each running cycle, item counts/misfeeds are aggregated from the appropriate sharded collection (e.g., by day via `getCountCollectionName(start)`), filtered to the session bounds.
- TotalTimeCredit (seconds) is computed per item id using the session's recorded `item.standard` (converted to PPH if needed; < 60 means "per minute").
- Operator name is taken from count records (first available) as a fallback.
- Current machine (at time of query) is taken from the most recent stateTicker for that operator.

**KPI Definitions** (all as fractions in `value` and as % strings in `percentage`):

- **Availability** = `runtimeMs / (queryEnd − queryStart)` where `queryStart`/`queryEnd` are taken from the first/last running session for the operator (i.e., bookended range actually worked, not the global request window).
- **Throughput** = `good / (good + misfeeds)`.
- **Efficiency** = `totalTimeCreditSec / runtimeSec`.
- **OEE** = `availability × throughput × efficiency`.

Returns an OEE-style productivity summary per operator over a requested window. Running sessions are discovered from state history, clamped to the window, and item counts/misfeeds are tallied from time‑bucketed count collections. The most recent machine (serial/name) that the operator touched is also included.

**Example Request**

```
GET /api/alpha/analytics/operator-summary?start=2025-05-01T12:00:00.000Z&end=2025-05-01T13:00:00.000Z
```

**Example Response**

```json
[
  {
    "operator": {
      "id": 117811,
      "name": "Shaun White"
    },
    "currentStatus": {
      "code": 1,
      "name": "Running"
    },
    "currentMachine": {
      "serial": 63520,
      "name": "Flipper 1"
    },
    "metrics": {
      "runtime": {
        "total": 1500000,
        "formatted": "00:25:00"
      },
      "downtime": {
        "total": 300000,
        "formatted": "00:05:00"
      },
      "output": {
        "totalCount": 120,
        "misfeedCount": 2
      },
      "performance": {
        "availability": { "value": 0.8333, "percentage": "83.33" },
        "throughput":   { "value": 0.9836, "percentage": "98.36" },
        "efficiency":   { "value": 0.9120, "percentage": "91.20" },
        "oee":          { "value": 0.748,  "percentage": "74.80" }
      }
    },
    "timeRange": {
      "start": "2025-05-01T12:05:00.000Z",
      "end":   "2025-05-01T12:35:00.000Z"
    }
  }
]
```

**Field Reference**

- `operator.id` (number) — Operator code.
- `operator.name` (string) — Operator full name.
- `currentStatus.code|name` — From latest operator state.
- `currentMachine.serial|name` — From most recent ticker containing this operator.
- `metrics.runtime.total` (ms) — Sum of operator running cycles.
- `metrics.downtime.total` (ms) — `(timeRange.end − timeRange.start) − runtime`.
- `metrics.output.totalCount` (number) — Good pieces credited to operator.
- `metrics.output.misfeedCount` (number) — Misfeeds credited to operator.
- `metrics.performance.*` — Same semantics as machine route.
- `timeRange.start|end` (ISO string) — From the first/last running session for this operator in the window (i.e., the "bookended" active period).

**Error Responses**

**400 Bad Request** — Missing/invalid dates; or start >= end.

```json
{ "error": "Start date must be before end date" }
```

**500 Internal Server Error**

```json
{ "error": "Failed to fetch operator dashboard summary data for /api/alpha/analytics/operator-summary?..." }
```

**Edge Cases**

- If an operator has no running cycles in the window, they are not returned.
- If counts exist with `item.standard < 60`, the standard is treated as per‑minute and converted to PPH (×60) before computing time credit.
- If the latest ticker doesn't include a machine for the operator, `currentMachine` fields are null.

---

**Input Parameters**

| Label | Definition | Required |
|-------|------------|----------|
| start | Start timestamp of the query window (ISO 8601) | Yes |
| end | End timestamp of the query window (ISO 8601). If in the future, it is clamped to now | Yes |

Data Format:

[
  {
    "operator": {
      "id": 135799,                                   Integer operator ID
      "name": "Lilliana Ashca"                        String operator name (falls back to "Unknown")
    },
    "currentStatus": {
      "code": 3,                                      Integer latest status/fault code from states in-window
      "name": "Stop"                                  String latest status/fault name
    },
    "currentMachine": {
      "serial": 67808,                                Integer serial of most recent machine seen in stateTicker
      "name": "SPF1"                                  String machine name (nullable if unknown)
    },
    "metrics": {
      "runtime": {
        "total": 5400000,                             Integer runtime in milliseconds (sum of all run sessions)
        "formatted": "01:30:00"                       String human-readable duration (HH:MM:SS)
      },
      "downtime": {
        "total": 3600000,                             Integer downtime in milliseconds within operator’s window
        "formatted": "01:00:00"                       String human-readable duration (HH:MM:SS)
      },
      "output": {
        "totalCount": 216,                            Integer valid pieces (misfeed=false) during run sessions
        "misfeedCount": 4                             Integer misfeeds (misfeed=true) during run sessions
      },
      "performance": {
        "availability": {                             Availability = runtime / operatorWindow
          "value": 0.60,                              Float ratio
          "percentage": "60.00"                       String percentage with 2 decimals
        },
        "throughput": {                               Throughput = totalCount / (totalCount + misfeedCount)
          "value": 0.9819,
          "percentage": "98.19"
        },
        "efficiency": {                               Efficiency = totalTimeCredit / runtimeSeconds
          "value": 0.92,
          "percentage": "92.00"
        },
        "oee": {                                      OEE = availability * throughput * efficiency
          "value": 0.5427,
          "percentage": "54.27"
        }
      }
    },
    "timeRange": {
      "start": "2025-08-20T00:00:00.000Z",            String ISO start of operator window (first run session start)
      "end": "2025-08-20T03:00:00.000Z"               String ISO end of operator window (last run session end)
    }
  }
]


Computation details:

Active operator set is derived for the window; for each operator, running cycles are extracted from state history and clamped to [start,end].

totalCount/misfeedCount come from the appropriate time‑bucketed count collection(s) (via getCountCollectionName(session.start)), filtered by operator.id and session bounds.

totalTimeCredit is the sum over items of count / (PPH/3600), where PPH = standard (if <60, multiplied by 60 to convert from per‑minute to per‑hour). Misfeeds are excluded from time credit.

Operator window (timeRange.start/end) spans from the first run session’s start to the last run session’s end; downtime = window - runtime.

currentMachine is read from the latest stateTicker that includes this operator (most recent timestamp), and may be null if none found.

If an operator has no run sessions in the window, they’re omitted from the response.