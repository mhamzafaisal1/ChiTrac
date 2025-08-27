# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

### Machine Analytics Routes

#### `/api/alpha/analytics/machines-summary`

Returns an array of per‑machine summaries over a time window.

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| `end` | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). If a future time is provided, it is clamped to the server "now". |

**Validation Rules**

- Both `start` and `end` must parse as valid dates.
- `start < end` must hold; otherwise a 400 is returned.

**Behavior & Notes**

- Only active machines (`active: true`) are included.
- Sessions are overlap‑matched (`start ∈ [S,E]` or `end ∈ [S,E]`). Open/overrunning sessions are clamped to the window.
- For sessions partially outside the window, per‑item counts and misfeeds are filtered to the clamped range, then KPIs are recomputed.
- Runtime is the sum of session durations (ms). Downtime = window length − runtime (ms), never negative.
- TotalTimeCredit (seconds) is computed per item using that item's standard pace (PPH). If a standard is less than 60, it is treated as pieces per minute and converted to PPH. Time credit per item = count / (PPH/3600).

**KPI Definitions** (all as fractions in `value` and as % strings in `percentage`):

- **Availability** = `runtimeMs / windowMs`
- **Throughput** = `goodCount / (goodCount + misfeedCount)`
- **Efficiency** = `totalTimeCreditSec / workTimeSec`
  - where `workTimeSec = runtimeSec × activeStations`
  - and `activeStations` are operators with a non‑dummy id (`id !== -1`) present in the session.
- **OEE** = `availability × throughput × efficiency`

This route returns an OEE-style summary for active machines over a requested time window. Sessions are clamped to the window; open sessions are closed at end for calculation. If a machine has no sessions in-window, a zeroed row is still returned.

**Example Request**

```
GET /api/alpha/analytics/machines-summary?start=2025-05-01T12:00:00.000Z&end=2025-05-01T13:00:00.000Z
```

**Example Response**

```json
[
  {
    "machine": {
      "serial": 63520,
      "name": "Flipper 1"
    },
    "currentStatus": {
      "code": 3,
      "name": "Stop"
    },
    "metrics": {
      "runtime": {
        "total": 1620000,
        "formatted": "00:27:00"
      },
      "downtime": {
        "total": 1800000,
        "formatted": "00:30:00"
      },
      "output": {
        "totalCount": 216,
        "misfeedCount": 4
      },
      "performance": {
        "availability": { "value": 0.473, "percentage": "47.30" },
        "throughput":   { "value": 0.9819, "percentage": "98.19" },
        "efficiency":   { "value": 0.8652, "percentage": "86.52" },
        "oee":          { "value": 0.402, "percentage": "40.20" }
      }
    },
    "timeRange": {
      "start": "2025-05-01T12:00:00.000Z",
      "end":   "2025-05-01T13:00:00.000Z"
    }
  }
]
```

**Field Reference**

- `machine.serial` (number) — Machine serial.
- `machine.name` (string) — Machine name.
- `currentStatus.code` (number) — Latest status code from ticker.
- `currentStatus.name` (string) — Latest status name from ticker.
- `metrics.runtime.total` (number, ms) — Total runtime within window.
- `metrics.runtime.formatted` (HH:MM:SS) — Human‑readable runtime.
- `metrics.downtime.total` (number, ms) — Window length − runtime.
- `metrics.output.totalCount` (number) — Good pieces (misfeeds excluded).
- `metrics.output.misfeedCount` (number) — Misfeeds.
- `metrics.performance.*.value` (number, 0–1) — Fraction.
- `metrics.performance.*.percentage` (string) — Fixed(2) percent text.
- `timeRange.start|end` (ISO string) — Effective window used (end may be clamped to now).

**Error Responses**

**400 Bad Request** — Missing/invalid dates; or start >= end.

```json
{ "error": "Start date must be before end date" }
```

**500 Internal Server Error**

```json
{ "error": "Failed to build machines summary" }
```

---

**Input Parameters**

| Label | Definition | Required |
|-------|------------|----------|
| start | Start timestamp of the query window (ISO 8601) | Yes |
| end | End timestamp of the query window (ISO 8601). If in the future, it is clamped to now | Yes |

Data Format:

[
  {
    "machine": {
      "serial": 63520,                                  Integer serial number of machine
      "name": "Flipper 1"                               String name of machine
    },
    "currentStatus": {
      "code": 3,                                        Integer unique status/fault code
      "name": "Stop"                                    String status/fault name
    },
    "metrics": {
      "runtime": {
        "total": 5400000,                               Integer runtime in milliseconds (clamped to window)
        "formatted": "01:30:00"                         String human-readable duration (HH:MM:SS)
      },
      "downtime": {
        "total": 3600000,                               Integer downtime in milliseconds (window - runtime)
        "formatted": "01:00:00"                         String human-readable duration (HH:MM:SS)
      },
      "output": {
        "totalCount": 216,                              Integer total pieces produced in-window
        "misfeedCount": 4                               Integer total misfeeds in-window
      },
      "performance": {
        "availability": {
          "value": 0.60,                                Float availability ratio = runtime/window
          "percentage": "60.00"                         String percentage with 2 decimals
        },
        "throughput": {
          "value": 0.9819,                              Float throughput = totalCount/(totalCount+misfeedCount)
          "percentage": "98.19"                         String percentage with 2 decimals
        },
        "efficiency": {
          "value": 0.92,                                Float efficiency = totalTimeCredit/workTimeSec
          "percentage": "92.00"                         String percentage with 2 decimals
        },
        "oee": {
          "value": 0.5427,                              Float OEE = availability*throughput*efficiency
          "percentage": "54.27"                         String percentage with 2 decimals
        }
      }
    },
    "timeRange": {
      "start": "2025-08-20T00:00:00.000Z",              String ISO start of window (echoed)
      "end": "2025-08-20T03:00:00.000Z"                 String ISO end of window (echoed; may be clamped to now)
    }
  }
]


Computation Notes (for clarity of fields above):

Sessions overlapping the window are truncated to [start, end]. Counts/misfeeds are filtered to the clamped window.

workTimeSec = runtime (sec) × number of active stations (operators with id !== -1).

totalTimeCredit = sum of per-item time credits using each item’s standard (converted to PPH; if <60, it is multiplied by 60) and actual item counts within the window.