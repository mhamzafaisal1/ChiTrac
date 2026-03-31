# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.



---
## Available Routes

### alpha

#### Utility Routes
- [/api/alpha/timestamp](#apialphatimestamp)
- [/api/alpha/currentTime/get](#apialphacurrenttimeget)
- [/api/alpha/ac360/get](#apialphaac360get)
- [/api/alpha/ac360/lastSession/get](#apialphaac360lastsessionget)
- [/api/alpha/ac360/post](#apialphaac360post)

#### Legacy Routes
- [/api/alpha/levelone/all](#apialphaleveloneall)
- [/api/alpha/production/statistics/machines/all](#apialphaproductionstatisticsmachinesall)
- [/api/alpha/ticker/all](#apialphatickerall)
- [/api/alpha/ticker/machines/all](#apialphatickermachinesall)
- [/api/alpha/counts/all](#apialphacountsall)
- [/api/alpha/machine/operator/lists](#apialphamachineoperatorlists)
- [/api/alpha/machine/operator/counts](#apialphamachineoperatorcounts)


#### Analytics Routes - Machine
- [/api/alpha/analytics/machine-performance](#apialphaanalyticsmachine-performance)
- [/api/alpha/analytics/machine-state-totals](#apialphaanalyticsmachine-state-totals)
- [/api/alpha/analytics/machine-hourly-states](#apialphaanalyticsmachine-hourly-states)
- [/api/alpha/analytics/machine-item-summary](#apialphaanalyticsmachine-item-summary)
- [/api/alpha/analytics/machine-item-hourly-item-stack](#apialphaanalyticsmachine-item-hourly-item-stack)
- [/api/alpha/analytics/machine/operator-efficiency](#apialphaanalyticsmachineoperator-efficiency)
- [/api/alpha/analytics/machine/operator-efficiency-fromSessions](#apialphaanalyticsmachineoperator-efficiency-fromsessions)
- [/api/alpha/analytics/machine-sessions-summary](#apialphaanalyticsmachine-sessions-summary)
- [/api/alpha/analytics/machine-details](#apialphaanalyticsmachine-details)
- [/api/alpha/analytics/machine-item-sessions-summary](#apialphaanalyticsmachine-item-sessions-summary)
- [/api/alpha/analytics/machines-summary](#apialphaanalyticsmachines-summary)

#### Analytics Routes - Operator
- [/api/alpha/analytics/operator-performance](#apialphaanalyticsoperator-performance)
- [/api/alpha/analytics/operator-item-summary](#apialphaanalyticsoperator-item-summary)
- [/api/alpha/analytics/operator-countbyitem](#apialphaanalyticsoperator-countbyitem)
- [/api/alpha/analytics/operator-cycle-pie](#apialphaanalyticsoperator-cycle-pie)
- [/api/alpha/analytics/operator/daily-efficiency](#apialphaanalyticsoperatordaily-efficiency)
- [/api/alpha/analytics/operator-fault-history](#apialphaanalyticsoperator-fault-history)
- [/api/alpha/analytics/operator-details](#apialphaanalyticsoperator-details)
- [/api/alpha/analytics/operator-item-sessions-summary](#apialphaanalyticsoperator-item-sessions-summary)
- [/api/alpha/analytics/operator-summary](#apialphaanalyticsoperator-summary)
- [/api/alpha/analytics/operator-dashboard-agg](#apialphaanalyticsoperator-dashboard-agg)
- [/api/alpha/analytics/operator-performance-agg](#apialphaanalyticsoperator-performance-agg)

#### Analytics Routes - Item
- [/api/alpha/analytics/item-summary](#apialphaanalyticsitem-summary)
- [/api/alpha/analytics/item-dashboard-summary](#apialphaanalyticsitem-dashboard-summary)
- [/api/alpha/analytics/item-dashboard-summary-agg](#apialphaanalyticsitem-dashboard-summary-agg)
- [/api/alpha/analytics/item-sessions-summary](#apialphaanalyticsitem-sessions-summary)
- [/api/alpha/analytics/item-stacked-by-hour](#apialphaanalyticsitem-stacked-by-hour)

#### Analytics Routes - Fault
- [/api/alpha/analytics/fault-history](#apialphaanalyticsfault-history)
- [/api/alpha/analytics/fault-sessions-history](#apialphaanalyticsfault-sessions-history)
- [/api/alpha/analytics/fault-report-summary](#apialphaanalyticsfault-report-summary)
- [/api/alpha/analytics/fault-report-detailed](#apialphaanalyticsfault-report-detailed)

#### Analytics Routes - Dashboard
- [/api/alpha/analytics/daily-dashboard/daily-counts](#apialphaanalyticsdaily-dashboarddaily-counts)
- [/api/alpha/analytics/daily-dashboard/full](#apialphaanalyticsdaily-dashboardfull)
- [/api/alpha/analytics/daily-summary-dashboard](#apialphaanalyticsdaily-summary-dashboard)

#### Reports (Angular / HTML table data)
- [/api/alpha/shifts](#apialphashifts)
- [/api/alpha/analytics/machine-report-cache](#apialphaanalyticsmachine-report-cache)
- [/api/alpha/analytics/operator-item-sessions-summary-cache](#apialphaanalyticsoperator-item-sessions-summary-cache)
- [/api/alpha/analytics/item-sessions-summary-daily-cache](#apialphaanalyticsitem-sessions-summary-daily-cache)

#### Test Routes
- [/api/alpha/historic-data-test](#apialphahistoric-data-test)
- [/api/alpha/sample/machineOverview](#apialphasamplemachineoverview)


### items
- [/api/items/config](#apiitemsconfig)

### machine
- [/api/machine/levelone/:serialNumber](#apimachineleveloneserialnumber)
- [/api/machine/leveltwo/:serialNumber](#apimachineleveltwoserialnumber)
- [/api/machine/status/:serialNumber](#apimachinestatusserialnumber)

### machines
- [/api/machines/config](#apimachinesconfig)

### operators
- [/api/operators/config](#apioperatorsconfig)

### softrol
- [/api/softrol/historic-data](#apisoftrolhistoric-data)
- [/api/softrol/levelone/all](#apisoftrolleveloneall)
- [/api/softrol/leveltwo](#apisoftrolleveltwo)


---

## alpha

### /api/alpha/analytics/machines-summary-daily-cached

Returns **per‑machine daily summaries from cache**, used by the Machine Dashboard table.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Day start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Day end (exclusive). |
| serial | Integer | No | Optional machine serial filter. |

**Response (high‑level):** JSON array of machine summaries. Each entry includes machine identity, current status, runtime/downtime, counts, and OEE components.

---

### /api/alpha/analytics/machine-dashboard-daily-cached

Returns the **full machine dashboard payload for a day**, used by the Machine Dashboard modal and Daily‑Summary machine modal.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Day start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Day end (exclusive). |
| serial | Integer | No | Optional machine serial filter. |

**Response (high‑level):** JSON array where each element contains machine identity, current status, OEE metrics, item summary, hourly item stack, operator efficiency, and current operators.

---

### /api/alpha/analytics/operator-summary-daily-cached

Returns **per‑operator daily summaries from cache**, used by the Operator Dashboard table.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Day start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Day end (exclusive). |

**Response (high‑level):** JSON array of operator summaries including runtime, downtime, output, efficiency, OEE, and current machine/status.

---

### /api/alpha/analytics/operator-details-cached

Returns **full operator detail payload from cache**, used by the Operator Dashboard and Daily‑Summary operator modals.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label      | Type                    | Required | Description |
|------------|-------------------------|----------|-------------|
| start      | ISO 8601 timestamp (UTC)| Yes      | Window start (inclusive). |
| end        | ISO 8601 timestamp (UTC)| Yes      | Window end (exclusive). |
| operatorId | Integer                 | Yes      | Operator ID. |
| serial     | Integer                 | No       | Optional machine serial filter. |
| tz         | IANA TZ string          | No       | Timezone for daily bucketing (default `America/Chicago`). |

**Response (high‑level):** Object containing item summary rows, count‑by‑item data, cycle pie data, and daily efficiency series for the operator.

---

### /api/alpha/analytics/operator-machine-summary

Returns **per‑machine aggregates for a single operator**, used inside the Operator Dashboard modal.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label      | Type                    | Required | Description |
|------------|-------------------------|----------|-------------|
| start      | ISO 8601 timestamp (UTC)| Yes      | Window start (inclusive). |
| end        | ISO 8601 timestamp (UTC)| Yes      | Window end (exclusive). |
| operatorId | Integer                 | Yes      | Operator ID. |

**Response (high‑level):** Object with `context` (operator + window) and `machines[]`, each machine entry including sessions count, faults‑while‑running, totals, and item breakdown.

---

### /api/alpha/analytics/items-summary-daily-cached

Returns **per‑item daily summaries from cache**, used by the Item Dashboard table.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**Response (high‑level):** JSON array of items with worked time, total count, PPH, standard, and efficiency.

---

### /api/alpha/analytics/daily-summary-dashboard/machines

Machine table for the Daily‑Summary dashboard; documented earlier in this file. It uses the same query parameters and response shape already described for machineResults.

---

### /api/alpha/analytics/daily-summary-dashboard/operators

Returns the **operator table data** for the Daily‑Summary dashboard.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**Response (high‑level):** Object with `timeRange` and `operatorResults[]`, each entry containing operator identity plus aggregated metrics (runtime, counts, OEE components).

---

### /api/alpha/analytics/daily-summary-dashboard/items

Returns the **item table data** for the Daily‑Summary dashboard.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial| Integer                 | No  | Optional machine serial filter. |

**Response (high‑level):** Object with `timeRange` and `items[]`, each item including worked time, counts, PPH, standard, and efficiency.

---

### /api/alpha/analytics/daily/machine-status-cache

Returns a fast, cached snapshot of **machine status durations for today** (running/paused/faulted) across all machines; used by the Daily Dashboard status chart.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:** none – uses today in the system timezone.

**Response (high‑level):** Object with `timeRange` and `machineStatus[]` (serial, name, runningMs, pausedMs, faultedMs).

---

### /api/alpha/analytics/daily/machine-oee

Returns fast, cached **machine OEE for today** across all machines; used by the Daily Dashboard OEE chart.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:** none – uses today in the system timezone.

**Response (high‑level):** Object with `timeRange` and `machineOee[]` (serial, name, oee percentage).

---

### /api/alpha/analytics/hourly/item-totals-by-type

Returns **item totals per hour, by item type/name**, used by the Daily Dashboard “item totals by type” chart.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:** optional; if omitted, today is used.
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | No | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | No | Window end (exclusive). |

**Response (high‑level):** Object with `timeRange` and `itemTotals` containing hourly bins and per‑item counts.

---

### /api/alpha/analytics/machines-group-summary-daily-cached

Returns **department/machine‑group OEE and metrics for a day**, used by the Daily Dashboard machine‑groups chart.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Day start (interpreted in system timezone). |
| end   | ISO 8601 timestamp (UTC) | Yes | Day end. |
| serial| Integer                 | No  | Optional machine serial filter. |

**Response (high‑level):** Array of group entries with group name, runtime/downtime/output and OEE metrics; may include `efficiencyPreviousDay`.

---

### /api/alpha/analytics/daily/top-operators-cache

Returns **top operators by efficiency/OEE for today**, used by the Daily Dashboard top‑operators chart.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:** none – uses today in the system timezone.

**Response (high‑level):** Object with `timeRange` and `topOperators[]` (operator id, name, efficiency, and supporting metrics).

---

### /api/alpha/analytics/daily/count-totals-cache

Returns **cached daily count totals** for the Daily Dashboard “counts” chart; documented earlier in this file.

---

### /api/alpha/analytics/daily/machine-live-session-summary

Returns **per‑operator live session summary for a given machine**, used by production efficiency screens.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | Integer | Yes | Machine serial. |

**Response (high‑level):** Object with `flipperData[]`, each lane containing operator, status, timers, efficiency/OEE for recent windows (6m/15m/1h/today), and batch item.

---

### /api/alpha/analytics/machine-live-session-summary/machine

Returns a **machine‑centric variant of live session summary**, with the same payload shape as above but scoped for the machine‑level production screen.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | Integer | Yes | Machine serial. |

**Response (high‑level):** Same shape as `/api/alpha/analytics/daily/machine-live-session-summary`.

---

### /api/alpha/analytics/machine-report-cache

Returns **machine report data built entirely from cache (totals‑daily + machine‑item)**, used by the Machine Report page.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial| Integer                 | No  | Optional machine serial filter. |

**Response (high‑level):** Object with `timeRange` and `results[]`, each result including machine summary and item summaries (with Total row).

---

### /api/alpha/analytics/operator-item-sessions-summary-cache

Returns **operator‑item summary from cache + sessions**, used by the Operator Report.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label      | Type                    | Required | Description |
|------------|-------------------------|----------|-------------|
| start      | ISO 8601 timestamp (UTC)| Yes      | Window start (inclusive). |
| end        | ISO 8601 timestamp (UTC)| Yes      | Window end (exclusive). |
| operatorId | Integer                 | No       | Optional operator filter. |

**Response (high‑level):** Object with `timeRange` and `results[]`, each result containing operator summary and per‑item summaries (count, worked time, PPH, standard, efficiency).

---

### /api/alpha/analytics/item-sessions-summary-daily-cache

Returns **item‑centric daily summary built from cache (and sessions when needed)**, used by the Item Report.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end   | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**Response (high‑level):** JSON array of items with worked time, counts, PPH, standard, and efficiency (same shape as the item dashboard, but report‑oriented).

---

### /api/alpha/analytics/fault-sessions-history

Returns fault session history over a time window, optionally scoped to a specific machine or operator. Designed for fault analytics and reporting: fault cycles, duration summaries, and work time impact analysis.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial | Integer | No | Restrict analytics to a specific machine serial. |
| operatorId | Integer | No | Restrict analytics to a specific operator ID. |
| include | String | No | Specify which data to include: 'cycles', 'summaries', or 'both' (defaults to 'both'). |

**Validation Rules:**
- `start` and `end` are required.
- At least one of `serial` or `operatorId` must be provided.
- If provided, `serial` must be numeric.
- If provided, `operatorId` must be numeric.
- If provided, `include` must be one of: 'cycles', 'summaries', or 'both'.
- `start < end` must hold.

**Behavior & Notes:**
- Fault sessions are clipped to the requested time window.
- Duration calculations use the clipped (overlapped) time range.
- Work time missed is calculated as `activeStations × durationSeconds`.
- Fault summaries aggregate by fault code and name combination.
- Results are sorted chronologically by fault start time.
- The `include` parameter controls which data arrays are returned in the response:
  - `'cycles'`: Returns only `faultCycles` array
  - `'summaries'`: Returns only `faultSummaries` array  
  - `'both'`: Returns both arrays (default behavior)
  - If omitted, defaults to `'both'` for backward compatibility

**Example Request:**
```
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808
```

**Example Request with Include Parameter:**
```
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808&include=cycles
```

```
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&operatorId=135790&include=summaries
```

**Data Format:**
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

**Empty Data Response:**
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

**Field Reference:**

**context:**
- `start` (string): ISO 8601 timestamp of window start
- `end` (string): ISO 8601 timestamp of window end
- `serial` (integer|null): Machine serial if filtered by machine
- `machineName` (string|null): Machine name if available
- `operatorId` (integer|null): Operator ID if filtered by operator
- `operatorName` (string|null): Operator name if available

**faultCycles[]:**
Array of individual fault sessions clipped to the time window (only present when `include` is 'cycles' or 'both'):

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

**faultSummaries[]:**
Aggregated fault statistics by code and name (only present when `include` is 'summaries' or 'both'):

| Field | Type | Description |
|-------|------|-------------|
| code | integer|null | Fault code |
| name | string | Fault name |
| count | integer | Number of occurrences |
| totalDurationSeconds | integer | Total duration across all occurrences |
| totalWorkTimeMissedSeconds | integer | Total work time missed across all occurrences |
| formatted | object | Human-readable duration with hours, minutes, seconds |

**Additional Example Requests:**
```
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=135790
```

```
GET /api/alpha/analytics/fault-sessions-history?start=2025-05-01T08:00:00.000Z&end=2025-05-01T16:00:00.000Z&serial=67808&operatorId=135790
```

**Error Responses:**

**400 Bad Request:**
```json
{ "error": "Provide serial or operatorId" }
```

```json
{ "error": "serial and operatorId must be numbers when provided" }
```

```json
{ "error": "include parameter must be 'cycles', 'summaries', or 'both'" }
```

**500 Internal Server Error:**
```json
{ "error": "Failed to fetch fault history" }
```

### /api/alpha/analytics/fault-report-summary

Returns a fault report **summary** across all machines: faults grouped by fault code. Uses the `fault-session` collection (sessions, no cache). Intended for the Fault Report UI (summary view).

**Method:** `GET`

**Query Parameters:**

| Parameter | Type   | Required | Description        |
|-----------|--------|----------|--------------------|
| start     | string | Yes      | ISO start datetime |
| end       | string | Yes      | ISO end datetime   |

**Example:**
```
GET /api/alpha/analytics/fault-report-summary?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Response:** `{ context: { start, end }, summaries: [{ code, name, count, totalDurationSeconds, formatted: { hours, minutes, seconds } }] }`

---

### /api/alpha/analytics/fault-report-detailed

Returns a fault report **detailed** by machine then fault code. Uses the `fault-session` collection (sessions, no cache). Intended for the Fault Report UI (detailed view).

**Method:** `GET`

**Query Parameters:**

| Parameter | Type   | Required | Description        |
|-----------|--------|----------|--------------------|
| start     | string | Yes      | ISO start datetime |
| end       | string | Yes      | ISO end datetime   |

**Example:**
```
GET /api/alpha/analytics/fault-report-detailed?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Response:** `{ context: { start, end }, details: [{ machineSerial, machineName, code, name, count, totalDurationSeconds, formatted: { hours, minutes, seconds } }] }`

---

### /api/alpha/analytics/machine-details

Returns a full, multi-tab detail payload for a single machine over a time window, suitable for a dashboard "details" drawer/page. The response includes:

Current Operators (latest operator-session rows for operators on this machine)
Item Summary (item-level production & efficiency, prorated across mixed items)
Performance by Hour (hourly Availability / Throughput / Efficiency / OEE + per‑operator efficiency in-slot)
Fault Data (if available; bookended to the active time range)

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial | Integer | Yes | Machine serial to fetch details for. |

**Example Request:**
```
GET /api/alpha/analytics/machine-details?serial=67808&start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "serial is required" }
{ "error": "Start date must be before end date" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine details" }
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

### /api/alpha/analytics/machines-summary

Returns an array of per‑machine summaries over a time window.

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| `end` | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). If a future time is provided, it is clamped to the server "now". |

**KPI Definitions** (all as fractions in `value` and as % strings in `percentage`):
- **Availability** = `runtimeMs / windowMs`
- **Throughput** = `goodCount / (goodCount + misfeedCount)`
- **Efficiency** = `totalTimeCreditSec / workTimeSec`
- **OEE** = `availability × throughput × efficiency`

**Example Request:**
```
GET /api/alpha/analytics/machines-summary?start=2025-05-01T12:00:00.000Z&end=2025-05-01T13:00:00.000Z
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "Start date must be before end date" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to build machines summary" }
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

### /api/alpha/analytics/operator-details

Returns a full, multi‑tab detail payload for a single operator over a time window, optionally scoped to a machine. Designed for an operator "details" view: item production, hourly mix, cycle breakdown, fault history, and daily efficiency.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| operatorId | Integer | Yes | Operator ID to fetch. |
| serial | Integer | No | Restrict analytics to a specific machine serial. |
| tz | IANA TZ string | No | Timezone for daily bucketing; default: "America/Chicago". |

**Example Request:**
```
GET /api/alpha/analytics/operator-details?operatorId=135790&start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808&tz=America/Chicago
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "start, end, and operatorId are required" }
{ "error": "operatorId must be a valid number" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch operator details" }
```

**Versioning & Stability:**

This route is Alpha; fields may be extended. Additions will be backward‑compatible (additive).

### /api/alpha/analytics/operator-summary

Returns an array of operator summaries over a time window, including current machine assignment (from the most recent ticker).

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| `end` | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**KPI Definitions** (all as fractions in `value` and as % strings in `percentage`):
- **Availability** = `runtimeMs / (queryEnd − queryStart)`
- **Throughput** = `good / (good + misfeeds)`
- **Efficiency** = `totalTimeCreditSec / runtimeSec`
- **OEE** = `availability × throughput × efficiency`

**Example Request:**
```
GET /api/alpha/analytics/operator-summary?start=2025-05-01T12:00:00.000Z&end=2025-05-01T13:00:00.000Z
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "Start date must be before end date" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch operator dashboard summary data for /api/alpha/analytics/operator-summary?..." }
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

### /api/alpha/analytics/machine-item-sessions-summary

Returns per‑machine item performance for sessions overlapping a window. Each machine includes the clipped session slices in the window and an aggregate "machineSummary", with prorated standard and efficiency computed from item mix.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| serial | Integer | No | If present, only include sessions for this machine serial. |

**Example Request:**
```
GET /api/alpha/analytics/machine-item-sessions-summary?start=2025-05-01T12:00:00Z&end=2025-05-01T16:00:00Z&serial=67808
```

**Error Responses:**

**500 Internal Server Error**
```json
{"error":"Failed to generate machine item summary"}
```

**Versioning & Stability:**

All three routes are Alpha and may add fields (backward‑compatible). Existing semantics are stable; breaking changes will be versioned under a new path.

### /api/alpha/shifts

Lists **active** shift definitions from the `shift` collection, sorted by name. Used by the shift-scoped machine report UI to populate the shift selector.

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:** None.

**Data Format:**
```json
{
  "shifts": [
    {
      "_id": "674a1b2c3d4e5f6789012345",
      "name": "Day",
      "startTime": { "hour": 6, "minute": 0 },
      "endTime": { "hour": 14, "minute": 30 },
      "activeDays": [1, 2, 3, 4, 5],
      "active": true
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Shift document id (stringified for JSON). |
| `name` | string | Shift display name. |
| `startTime` / `endTime` | object | Local start/end time of shift (hour, minute). |
| `activeDays` | array | Days shift applies (convention is implementation-specific). |
| `active` | boolean | Only active shifts are returned. |

**Example Request:**
```
GET /api/alpha/shifts
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to list shifts" }
```

**Versioning & Stability:** Alpha; additive changes only where possible.

---

### /api/alpha/analytics/machine-report-cache

JSON payload for the **Machine Report** and **Shift Machine Report** Angular tables. Primarily uses the `totals-daily` cache (`entityType` `machine` and `machine-item`), with session-based fallback when cache is empty for the requested window. When **`shiftId`** is present, data is computed from sessions for that shift and time window instead of daily cache.

This route is separate from [`/api/alpha/analytics/machine-item-sessions-summary`](#apialphaanalyticsmachine-item-sessions-summary) (session-centric, different aggregation). Integrators mirroring the HTML report should call this path.

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. Parsed with server timezone rules; end may be clamped to now. |
| end | ISO 8601 datetime | Yes | Window end. |
| serial | integer | No | Limit to one machine serial. |
| shiftId | string | No | MongoDB ObjectId of a shift. When set, uses session data clipped to the window for that shift (see [`/api/alpha/shifts`](#apialphashifts)). |

**Behavior notes:**

- Time handling uses **`America/Chicago`** for normalization where applicable; **`end`** is not extended past server “now”.
- Without **`shiftId`**: full calendar days in range are read from `totals-daily` when available; otherwise the service falls back to **`getSessionDataForPartialDays`** for the same `start`/`end`.
- With **`shiftId`**: validates the id and loads the shift; **`404`** if missing, **`400`** if the id is not a valid ObjectId.
- **`itemSummaries`** includes a synthetic **`Total`** row (key `"Total"`) plus per-item rows keyed by **item id** (numeric). Per-item **runtime** used for PPH is allocated proportionally by count across items on that machine.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-02T05:00:00.000Z"
  },
  "results": [
    {
      "machine": {
        "name": "SPF1",
        "serial": 67808
      },
      "machineSummary": {
        "totalCount": 1200,
        "workedTimeMs": 14400000,
        "workedTimeFormatted": { "hours": 4, "minutes": 0 },
        "runtimeMs": 14400000,
        "runtimeFormatted": { "hours": 4, "minutes": 0 },
        "pph": 300.0,
        "proratedStandard": 580.25,
        "efficiency": 51.7,
        "itemSummaries": {
          "Total": {
            "name": "Total",
            "standard": 580.25,
            "countTotal": 1200,
            "workedTimeFormatted": { "hours": 4, "minutes": 0 },
            "pph": 300.0,
            "efficiency": 51.7
          },
          "4": {
            "name": "Pool Towel",
            "standard": 625,
            "countTotal": 800,
            "workedTimeFormatted": { "hours": 2, "minutes": 40 },
            "pph": 300.0,
            "efficiency": 48.0
          }
        }
      }
    }
  ]
}
```

| Path | Type | Description |
|------|------|-------------|
| `timeRange.start` / `end` | string | ISO timestamps describing the reported window (exact bounds depend on cache vs shift mode). |
| `results[].machine` | object | `name`, `serial`. |
| `results[].machineSummary` | object | Aggregates for the machine; `efficiency` is a **percentage** (0–100 scale). |
| `results[].machineSummary.itemSummaries` | object | Map: special key `Total`, then item ids as string keys. Each value: `name`, `standard`, `countTotal`, `workedTimeFormatted` (`hours`, `minutes`), `pph`, `efficiency` (%). |

**Example Requests:**
```
GET /api/alpha/analytics/machine-report-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/alpha/analytics/machine-report-cache?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&serial=67808
GET /api/alpha/analytics/machine-report-cache?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&shiftId=674a1b2c3d4e5f6789012345
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "Invalid shiftId" }
```

**404 Not Found**
```json
{ "error": "Shift not found" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to generate machine report from cache" }
```

**Versioning & Stability:** Alpha; fields may be extended. Integrators should tolerate unknown keys.

---

### /api/alpha/analytics/operator-item-sessions-summary-cache

JSON payload for the **Operator Report** Angular table. Uses `totals-daily` (`operator-machine`, `operator-item`) for complete days with hybrid/session fill-in for partial ranges; empty cache for a range may fall back to sessions. Shape aligns with the non-cache operator summary where possible, but **`sessions`** is always an **empty array** in this variant.

Related session-based route: [`/api/alpha/analytics/operator-item-sessions-summary`](#apialphaanalyticsoperator-item-sessions-summary).

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |
| operatorId | integer | No | Restrict to one operator. |

**Behavior notes:**

- Timezone-aware day splitting uses **`America/Chicago`**.
- Item rows under **`itemSummaries`** are keyed by a **normalized item name** (lowercase, trimmed); values expose display `name` in original casing.
- Operators with **zero** total production count are omitted from **`results`**.
- **`operatorSummary.efficiency`** and **`itemSummaries[*].efficiency`** are **percentages** (PPH vs prorated standard, scaled to a 0–100+ style number and rounded); either may be `null` when standard is missing or zero.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-02T05:00:00.000Z"
  },
  "results": [
    {
      "operator": { "id": 117811, "name": "Shaun White" },
      "sessions": [],
      "operatorSummary": {
        "totalCount": 950,
        "workedTimeMs": 12600000,
        "workedTimeFormatted": { "hours": 3, "minutes": 30 },
        "runtimeMs": 13000000,
        "runtimeFormatted": { "hours": 3, "minutes": 36 },
        "pph": 271.43,
        "proratedStandard": 600.0,
        "efficiency": 45.24,
        "itemSummaries": {
          "pool towel": {
            "name": "Pool Towel",
            "standard": 625.0,
            "countTotal": 600,
            "workedTimeFormatted": { "hours": 2, "minutes": 0 },
            "pph": 300.0,
            "efficiency": 48.0
          }
        }
      }
    }
  ]
}
```

**Example Request:**
```
GET /api/alpha/analytics/operator-item-sessions-summary-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/alpha/analytics/operator-item-sessions-summary-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=117811
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to generate cached operator item summary" }
```

**Versioning & Stability:** Alpha; additive changes preferred.

---

### /api/alpha/analytics/item-sessions-summary-daily-cache

JSON **array** for the **Item Report** Angular table: one object per item id after aggregation across the window. Uses `totals-daily` with `entityType: item` and `source: simulator` for cacheable windows; longer ranges may use a hybrid of cache + sessions; partial **past** days may use sessions only.

Related session-based route: [`/api/alpha/analytics/item-sessions-summary`](#apialphaanalyticsitem-sessions-summary).

**Method:** GET  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |

**Behavior notes:**

- Standards: values in **`standard`** may be PPH or PPM; the service normalizes small numeric standards (treating values below 60 as PPM→PPH) when computing **`efficiency`**.
- **`efficiency`** in each row is a **percentage** (0–100 scale, rounded).

**Data Format:** top-level JSON array:
```json
[
  {
    "itemName": "Pool Towel",
    "workedTimeFormatted": { "hours": 3, "minutes": 45 },
    "count": 1240,
    "pph": 330.67,
    "standard": 625,
    "efficiency": 52.91
  }
]
```

Empty window / no data:
```json
[]
```

**Example Request:**
```
GET /api/alpha/analytics/item-sessions-summary-daily-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to generate daily cached item summary" }
```

**Versioning & Stability:** Alpha; additive changes preferred.

---

### /api/alpha/analytics/item-sessions-summary

Returns an item‑centric summary across all active machines in the window, using item‑sessions and bookended machine running windows to avoid idle gaps. Each item includes total valid counts, worked time, PPH, standard, and efficiency.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |

**Example Request:**
```
GET /api/alpha/analytics/item-sessions-summary?start=2025-05-01T12:00:00Z&end=2025-05-01T18:00:00Z
```

**Error Responses:**

**416 Range Not Satisfiable**
```json
{"error":"start must be before end"}
```

**500 Internal Server Error**
```json
{"error":"Failed to generate item summary report"}
```

**Versioning & Stability:**

Alpha route; fields may be extended. Additions will be backward-compatible (additive).

### /api/alpha/analytics/operator-item-sessions-summary

Returns operator × machine × item rows for operator‑sessions overlapping the window, including valid counts, misfeeds, pph, and efficiency.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). |
| operatorId | Integer | No | Limit to a single operator. If omitted, returns rows for all operators active in window. |

**Example Request:**
```
GET /api/alpha/analytics/operator-item-sessions-summary?operatorId=135790&start=2025-05-01T12:00:00Z&end=2025-05-01T16:00:00Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{"error":"Failed to generate operator item summary report"}
```

**Versioning & Stability:**

All three routes are Alpha and may add fields (backward‑compatible). Existing semantics are stable; breaking changes will be versioned under a new path.

### /api/alpha/sample/machineOverview

Returns a comprehensive machine overview snapshot for a single machine using **today’s** date in the `America/Chicago` timezone. Data is sourced from the `totals-daily` cache, state ticker, and fault-session collections and is intended primarily as a sample/utility route for dashboards.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**

| Label  | Type    | Required | Description |
|--------|---------|----------|-------------|
| serial | Integer | No       | Machine serial to fetch. If omitted, the service will automatically select a machine using the latest ticker entry and return its overview. |

**Behavior Notes:**

- If `serial` is provided, the service attempts to resolve today’s `totals-daily` record for that machine; if none exists, it falls back to the latest ticker entry for that serial.
- If `serial` is omitted, the service finds the first available ticker entry and uses that machine’s serial.
- If no matching machine/ticker can be resolved, the service returns a `500` error with `"Failed to fetch machine overview data"`.
- Fault information is taken from the most recent open fault-session for the machine, or the most recent closed fault-session when no open session exists.

**Data Format:**
```json
{
  "machineInfo": {
    "serial": 63520,
    "name": "Flipper 1"
  },
  "fault": {
    "code": 3,
    "name": "Stop"
  },
  "status": {
    "code": 3,
    "name": "Stop",
    "color": "Red"
  },
  "timeOnTask": 360,
  "onTime": 360,
  "totalCount": 216,
  "operators": [
    {
      "id": 117811,
      "name": "Shaun White",
      "pace": 600,
      "timeOnTask": 360,
      "count": 60,
      "efficiency": 96,
      "station": 1,
      "tasks": [
        {
          "name": "Pool Towel",
          "standard": 625
        }
      ]
    }
  ],
  "items": [
    {
      "id": 4,
      "count": 600
    }
  ]
}
```

**Example Requests:**
```http
GET /api/alpha/sample/machineOverview
GET /api/alpha/sample/machineOverview?serial=63520
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch machine overview data"
}
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

---

## Utility Routes

### /api/alpha/timestamp

Returns the server startup timestamp.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:**
```json
"2025-05-01T12:00:00.000Z"
```

---

### /api/alpha/currentTime/get

Returns current server time in multiple formats.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:**
```json
{
  "currentTime": "2025-05-01-12:00:00.000",
  "currentLocalTime": "2025-05-01-07:00:00.000",
  "timezone": "UTC",
  "timezoneOffset": "+00:00"
}
```

---

### /api/alpha/ac360/get

Simple AC360 endpoint test.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:**
```json
"Hello AC360!"
```

---

### /api/alpha/ac360/lastSession/get

Returns the last session data for AC360 machine with serial 67421, including duration, counts, and stacks.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:**
```json
{
  "duration": "45 minutes",
  "countTotal": 120,
  "stackTotal": 5,
  "counts": [...],
  "stacks": [...]
}
```

---

### /api/alpha/ac360/post

See [api-ac360-post.md](./api-ac360-post.md) for detailed documentation.

---

## Legacy Routes

### /api/alpha/levelone/all

Returns level one data for all active machines, including current status, operators, and session information.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:**
```json
[
  {
    "status": {
      "code": 1,
      "name": "Running",
      "color": "Green"
    },
    "machineInfo": {
      "serial": 67808,
      "name": "SPF1"
    },
    "fault": null,
    "timeOnTask": 3600,
    "onTime": 3600,
    "totalCount": 216,
    "items": [...],
    "operators": [...]
  }
]
```

---

### /api/alpha/production/statistics/machines/all

Returns production statistics for all machines since the start of the current day.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Response:** Similar to `/api/alpha/levelone/all` but with statistics calculated from the start of the day.

---

### /api/alpha/ticker/all

Returns all ticker data.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

---

### /api/alpha/ticker/machines/all

Returns machine list from ticker.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

---

### /api/alpha/counts/all

Returns all operator counts.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

---


Returns comprehensive machine overview data including machine info, fault status, operator details, and item counts.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Data Format:**
```json
{
  "machineInfo": {
    "serial": 63520,
    "name": "Flipper 1"
  },
  "fault": {
    "code": 3,
    "name": "Stop"
  },
  "status": {
    "code": 3,
    "name": "Stop",
    "color": "Red"
  },
  "timeOnTask": 360,
  "onTime": 360,
  "totalCount": 216,
  "operators": [
    {
      "id": 117811,
      "name": "Shaun White",
      "pace": 600,
      "timeOnTask": 360,
      "count": 60,
      "efficiency": 96,
      "station": 1,
      "tasks": [
        {
          "name": "Pool Towel",
          "standard": 625
        }
      ]
    }
  ],
  "items": [
    {
      "id": 4,
      "count": 600
    }
  ]
}
```

**Example Request:**
```
GET /api/alpha/sample/machineOverview
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch machine overview data"
}
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

---

---

## items

### /api/items/config

This route provides configuration definition for all items in the system, as stored in the database.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Data Format:**
```json
{
  "items": [
    {
      "number": 1,
      "name": "Incontinent Pad",
      "pace": 720,
      "area": 1,
      "department": "Towels",
      "weight": null
    }
  ]
}
```

**Example Request:**
```
GET /api/items/config
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch items configuration"
}
```

---

## machine

### /api/machine/levelone/:serialNumber

Returns level one data for a specific machine including operator details, task information, and efficiency metrics.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Path Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serialNumber | Integer | Yes | Machine serial number |

**Data Format:**
```json
{
  "operator": {
    "id": null,
    "name": "None Entered"
  },
  "task": {
    "id": 24,
    "name": "BarMop"
  },
  "pace": {
    "standard": 1380,
    "current": 0
  },
  "timeOnTask": 0,
  "totalCount": 0,
  "efficiency": 0,
  "fault": {
    "code": 3,
    "name": "Stop"
  }
}
```

**Example Request:**
```
GET /api/machine/levelone/63520
```

**Error Responses:**

**404 Not Found**
```json
{ "error": "Machine not found" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine level one data" }
```

### /api/machine/leveltwo/:serialNumber

Returns level two data for a specific machine including timers, program information, and performance metrics.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Path Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serialNumber | Integer | Yes | Machine serial number |

**Data Format:**
```json
{
  "timers": {
    "run": 63,
    "down": 0,
    "total": 63
  },
  "programNumber": 2,
  "item": {
    "id": 1,
    "name": "Incontinent Pad"
  },
  "current": {
    "pace": 640,
    "count": 284
  },
  "totals": {
    "in": 2493,
    "out": 2384,
    "thru": 95.63,
    "faults": 3,
    "jams": 14
  },
  "availability": 86.55,
  "oee": 68.47,
  "operatorEfficiency": 68.47
}
```

**Example Request:**
```
GET /api/machine/leveltwo/63520
```

**Error Responses:**

**404 Not Found**
```json
{ "error": "Machine not found" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine level two data" }
```

### /api/machine/status/:serialNumber

Returns live status information for a specific machine including timers, energy usage, program details, and operator assignments.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Path Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serialNumber | Integer | Yes | Machine serial number |

**Data Format:**
```json
{
  "machine": {
    "serial": 63520,
    "type": 9000,
    "location": 1,
    "line": 5,
    "model": 3,
    "ipAddress": "192.168.0.31",
    "id": 14,
    "name": "Flipper 1",
    "lanes": 1
  },
  "status": 0,
  "timers": {
    "onTime": 87,
    "runTime": 0,
    "readyTime": 87,
    "brokeTime": 0,
    "emptyTime": 0,
    "onDuration": "00:01:27"
  },
  "energy": {
    "electric": 0,
    "pneumatic": 0,
    "fuel": 0,
    "fuelType": 0
  },
  "program": {
    "programNumber": 3,
    "batchNumber": 24,
    "accountNumber": 0,
    "speed": 160,
    "stations": 1
  },
  "totals": {
    "oneLane": 0,
    "twoLane": 0,
    "sp": 0,
    "drape": 0
  },
  "rejects": {
    "stain": 0,
    "tear": 0,
    "shape": 0,
    "lowQuality": 0
  },
  "lpOperators": [
    {
      "id": 0,
      "lane": 1
    }
  ],
  "items": [
    {
      "id": 24,
      "count": 0
    }
  ]
}
```

**Example Request:**
```
GET /api/machine/status/63520
```

**Error Responses:**

**404 Not Found**
```json
{ "error": "Machine not found" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine status" }
```

---

## machines

### /api/machines/config

This route provides configuration definition for all CD machines in the system, as stored in the database.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Data Format:**
```json
{
  "machines": [
    {
      "serial": 63520,
      "name": "Flipper 1",
      "ipAddress": "192.168.0.31",
      "lanes": 1
    }
  ]
}
```

**Example Request:**
```
GET /api/machines/config
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch machines configuration"
}
```

---

## operators

### /api/operators/config

This route provides configuration definition for all operators in the system, as stored in the database.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Data Format:**
```json
{
  "operators": [
    {
      "code": 117811,
      "name": "Brian Iguchi"
    }
  ]
}
```

**Example Request:**
```
GET /api/operators/config
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch operators configuration"
}
```

---

## softrol

### /api/softrol/historic-data

This route provides historic record of completed operator sessions on Chicago equipment. A start timestamp is required, if no end timestamp is provided, the end of the query window will default to now.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive) |
| end | ISO 8601 timestamp (UTC) | No | Window end (exclusive), defaults to now |

**Data Format:**
```json
[
  {
    "operatorId": 135797,
    "machineSerial": 67798,
    "startTimestamp": "2025-04-08T12:27:28.806Z",
    "endTimestamp": "2025-04-08T12:34:22.409Z",
    "totalCount": 51,
    "task": "None Entered",
    "standard": 444
  }
]
```

**Example Request:**
```
GET /api/softrol/historic-data?start=2025-04-08T12:00:00.000Z
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "start parameter is required" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch historic data" }
```

### /api/softrol/levelone/all

Returns level one data for all machines including machine info, fault status, operator details, and item counts.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Data Format:**
```json
{
  "machineInfo": {
    "serial": 63520,
    "name": "Flipper 1"
  },
  "fault": {
    "code": 3,
    "name": "Stop"
  },
  "status": {
    "code": 3,
    "name": "Stop",
    "color": "Red"
  },
  "timeOnTask": 360,
  "onTime": 712,
  "totalCount": 216,
  "operators": [
    {
      "id": 117811,
      "name": "Shaun White",
      "pace": 600,
      "timeOnTask": 360,
      "count": 60,
      "efficiency": 96,
      "station": 1,
      "tasks": [
        {
          "name": "Pool Towel",
          "standard": 625
        }
      ]
    }
  ],
  "items": [
    {
      "id": 4,
      "count": 600
    }
  ]
}
```

**Example Request:**
```
GET /api/softrol/levelone/all
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch level one data"
}
```

### /api/softrol/leveltwo

Returns level two data for a specific machine including timers, program information, and performance metrics.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | Integer | Yes | Machine serial number |

**Data Format:**
```json
{
  "timers": {
    "run": 63,
    "down": 17,
    "total": 80
  },
  "programNumber": 2,
  "item": {
    "id": 1,
    "name": "Incontinent Pad"
  },
  "totals": {
    "input": 2493,
    "out": 2384,
    "thru": 95.63,
    "faults": 15,
    "jams": 9
  },
  "availability": 86.55,
  "oee": 68.47,
  "operatorEfficiency": 78.61
}
```

**Example Request:**
```
GET /api/softrol/leveltwo?serial=63520
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "serial parameter is required" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch level two data" }
```
