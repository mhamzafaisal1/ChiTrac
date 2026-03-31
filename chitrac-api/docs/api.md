# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.



---
## Available Routes

### Dashboard
- [/api/dashboard/analytics/daily-summary-dashboard/machines](#apidashboardanalyticsdaily-summary-dashboardmachines)
- [/api/dashboard/analytics/daily-summary-dashboard/operators](#apidashboardanalyticsdaily-summary-dashboardoperators)
- [/api/dashboard/analytics/daily-summary-dashboard/items](#apidashboardanalyticsdaily-summary-dashboarditems)
- [/api/dashboard/analytics/daily/machine-status-cache](#apidashboardanalyticsdailymachine-status-cache)
- [/api/dashboard/analytics/daily/machine-oee](#apidashboardanalyticsdailymachine-oee)
- [/api/dashboard/analytics/hourly/item-totals-by-type](#apidashboardanalyticshourlyitem-totals-by-type)
- [/api/dashboard/analytics/machines-group-summary-daily-cached](#apidashboardanalyticsmachines-group-summary-daily-cached)
- [/api/dashboard/analytics/daily/top-operators-cache](#apidashboardanalyticsdailytop-operators-cache)
- [/api/dashboard/analytics/daily/count-totals-cache](#apidashboardanalyticsdailycount-totals-cache)
- [/api/dashboard/analytics/daily/machine-live-session-summary](#apidashboardanalyticsdailymachine-live-session-summary)
- [/api/dashboard/analytics/machine-live-session-summary/machine](#apidashboardanalyticsmachine-live-session-summarymachine)

### Fault
- [/api/fault/analytics/fault-sessions-history](#apifaultanalyticsfault-sessions-history)
- [/api/fault/analytics/fault-report-summary](#apifaultanalyticsfault-report-summary)
- [/api/fault/analytics/fault-report-detailed](#apifaultanalyticsfault-report-detailed)

### Item
- [/api/item/config](#apiitemconfig)
- [/api/item/new-id](#apiitemnew-id)
- [/api/item/analytics/items-summary-daily-cache](#apiitemanalyticsitems-summary-daily-cache)
- [/api/items/config](#apiitemsconfig)

### Machine
- [/api/machine/levelone/:serialNumber](#apimachineleveloneserialnumber)
- [/api/machine/leveltwo/:serialNumber](#apimachineleveltwoserialnumber)
- [/api/machine/status/:serialNumber](#apimachinestatusserialnumber)
- [/api/machine/analytics/machines-summary-daily-cached](#apimachineanalyticsmachines-summary-daily-cached)
- [/api/machine/analytics/machine-dashboard-daily-cached](#apimachineanalyticsmachine-dashboard-daily-cached)
- [/api/machines/config](#apimachinesconfig)

### Operator
- [/api/operator/config](#apioperatorconfig)
- [/api/operator/new-id](#apioperatornew-id)
- [/api/operator/analytics/operators-summary-daily-cached](#apioperatoranalyticsoperators-summary-daily-cached)
- [/api/operator/analytics/operator-details-cached](#apioperatoranalyticsoperator-details-cached)
- [/api/operator/analytics/operator-machine-summary](#apioperatoranalyticsoperator-machine-summary)
- [/api/operators/config](#apioperatorsconfig)

### Reports
- [/api/reports/shifts](#apireportsshifts)
- [/api/reports/analytics/machine-report-cache](#apireportsanalyticsmachine-report-cache)
- [/api/reports/analytics/operator-item-sessions-summary-cache](#apireportsanalyticsoperator-item-sessions-summary-cache)
- [/api/reports/analytics/item-sessions-summary-daily-cache](#apireportsanalyticsitem-sessions-summary-daily-cache)

### Softrol
- [/api/softrol/historic-data](#apisoftrolhistoric-data)
- [/api/softrol/levelone/all](#apisoftrolleveloneall)
- [/api/softrol/leveltwo](#apisoftrolleveltwo)

### Alpha
- [/api/alpha/timestamp](#apialphatimestamp)
- [/api/alpha/currentTime/get](#apialphacurrenttimeget)
- [/api/alpha/ac360/get](#apialphaac360get)
- [/api/alpha/ac360/lastSession/get](#apialphaac360lastsessionget)
- [/api/alpha/ac360/post](#apialphaac360post)
- [/api/alpha/levelone/all](#apialphaleveloneall)
- [/api/alpha/production/statistics/machines/all](#apialphaproductionstatisticsmachinesall)
- [/api/alpha/ticker/all](#apialphatickerall)
- [/api/alpha/ticker/machines/all](#apialphatickermachinesall)
- [/api/alpha/counts/all](#apialphacountsall)
- [/api/alpha/machine/operator/lists](#apialphamachineoperatorlists)
- [/api/alpha/machine/operator/counts](#apialphamachineoperatorcounts)
- [/api/alpha/analytics/machine-performance](#apialphaanalyticsmachine-performance)
- [/api/alpha/analytics/machine-state-totals](#apialphaanalyticsmachine-state-totals)
- [/api/alpha/analytics/machine-hourly-states](#apialphaanalyticsmachine-hourly-states)
- [/api/alpha/analytics/machine-item-summary](#apialphaanalyticsmachine-item-summary)
- [/api/alpha/analytics/machine-item-hourly-item-stack](#apialphaanalyticsmachine-item-hourly-item-stack)
- [/api/alpha/analytics/machine/operator-efficiency](#apialphaanalyticsmachineoperator-efficiency)
- [/api/alpha/analytics/machine/operator-efficiency-fromSessions](#apialphaanalyticsmachineoperator-efficiency-fromsessions)
- [/api/alpha/analytics/machine-details](#apialphaanalyticsmachine-details)
- [/api/alpha/analytics/machine-item-sessions-summary](#apialphaanalyticsmachine-item-sessions-summary)
- [/api/alpha/analytics/machines-summary](#apialphaanalyticsmachines-summary)
- [/api/alpha/analytics/operator-performance](#apialphaanalyticsoperator-performance)
- [/api/alpha/analytics/operator-item-summary](#apialphaanalyticsoperator-item-summary)
- [/api/alpha/analytics/operator-countbyitem](#apialphaanalyticsoperator-countbyitem)
- [/api/alpha/analytics/operator-cycle-pie](#apialphaanalyticsoperator-cycle-pie)
- [/api/alpha/analytics/operator/daily-efficiency](#apialphaanalyticsoperatordaily-efficiency)
- [/api/alpha/analytics/operator-fault-history](#apialphaanalyticsoperator-fault-history)
- [/api/alpha/analytics/operator-details](#apialphaanalyticsoperator-details)
- [/api/alpha/analytics/operator-item-sessions-summary](#apialphaanalyticsoperator-item-sessions-summary)
- [/api/alpha/analytics/operator-summary](#apialphaanalyticsoperator-summary)
- [/api/alpha/analytics/item-summary](#apialphaanalyticsitem-summary)
- [/api/alpha/analytics/item-dashboard-summary](#apialphaanalyticsitem-dashboard-summary)
- [/api/alpha/analytics/item-sessions-summary](#apialphaanalyticsitem-sessions-summary)
- [/api/alpha/historic-data-test](#apialphahistoric-data-test)
- [/api/alpha/sample/machineOverview](#apialphasamplemachineoverview)


---

## Dashboard

### /api/dashboard/analytics/daily-summary-dashboard/machines

**Machine table** for the **Daily‑Summary** dashboard (and the parent row that opens the machine modal fed by `/api/machine/analytics/machine-dashboard-daily-cached`). Combines **`totals-daily`** (and related cached builders) for full calendar days and **session-based** aggregation for partial past days; supports **shift‑scoped** session mode when `shiftId` is set.

**Method:** GET  
**Auth:** Required (same as other authenticated `/api/*` JSON routes)  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. Validated with shared date rules; used for hybrid cache vs session selection. |
| end | ISO 8601 datetime | Yes | Window end. |
| serial | integer | No | Limit rows to one machine serial. |
| shiftId | string | No | MongoDB `ObjectId` of a shift. When set, **only** session data is used for the window, clipped to shift rules (invalid id → **400**, missing shift → **404**). |

**Behavior notes:**

- **Without `shiftId`:** If the range is a **partial calendar day** in the **past** (not today), results are computed with **`computeMachineResults`** (sessions). For **today** or **full days**, **`totals-daily`**-backed paths are used. Ranges **longer than 24 hours** use a **hybrid**: complete days from cache, partial days from sessions.
- **With `shiftId`:** Uses **`getSessionDataForPartialDays`** with the shift id; merges **live ticker** status for `currentStatus`. OEE percentage in this branch may be **0** in the simplified row shape.
- **`timeRange.total`** in the response is a server-side **duration string** for the request (debug/perf), not a business metric.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-02T05:00:00.000Z",
    "total": "2ms"
  },
  "machineResults": [
    {
      "machine": { "serial": 67808, "name": "SPF1" },
      "currentStatus": { "code": 1, "name": "Running", "color": "None" },
      "metrics": {
        "runtime": { "total": 14400000, "formatted": { "hours": 4, "minutes": 0 } },
        "downtime": { "total": 600000, "formatted": { "hours": 0, "minutes": 10 } },
        "output": { "totalCount": 1200, "misfeedCount": 12 },
        "performance": {
          "availability": { "value": 0.96, "percentage": "96.00" },
          "throughput": { "value": 0.99, "percentage": "99.00" },
          "efficiency": { "value": 0.87, "percentage": "87.00" },
          "oee": { "value": 0.83, "percentage": "83.00" }
        }
      },
      "timeRange": { "start": "2025-05-01T05:00:00.000Z", "end": "2025-05-02T05:00:00.000Z" }
    }
  ]
}
```

**Shift mode shape (illustrative):** entries may expose `performance.output`, `performance.oee`, and `performance.runtime` instead of full `metrics` when built from the shift/session fast path—UI should tolerate both.

**Field reference (non-shift cache/session merge path):**

| Path | Type | Description |
|------|------|-------------|
| `timeRange.start` / `end` | string | Echoed window bounds. |
| `timeRange.total` | string | Server formatting duration label. |
| `machineResults[].machine` | object | `serial`, `name`. |
| `machineResults[].currentStatus` | object | Ticker-derived status (`code`/`id` style may vary; includes `name`). |
| `machineResults[].metrics` | object | Runtime, downtime, output, performance (availability / throughput / efficiency / OEE). |

**Example Requests:**
```
GET /api/dashboard/analytics/daily-summary-dashboard/machines?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/dashboard/analytics/daily-summary-dashboard/machines?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&serial=67808
GET /api/dashboard/analytics/daily-summary-dashboard/machines?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&shiftId=674a1b2c3d4e5f6789012345
```

**Error Responses:**

**400 Bad Request** — invalid `shiftId` (malformed ObjectId)  
**404 Not Found** — shift document missing  
**500 Internal Server Error**
```json
{ "error": "Failed to generate machines summary" }
```

**Versioning & Stability:** Alpha; tolerate unknown keys.

---

### /api/dashboard/analytics/daily-summary-dashboard/operators

**Operator table** for the **Daily‑Summary** dashboard. Same **hybrid cache / session** strategy as the machines route, with a **shift** branch that uses **`getOperatorSessionDataForPartialDays`**.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |
| shiftId | string | No | Shift ObjectId; **400**/**404** same as machines route. |

**Behavior notes:**

- **Without `shiftId`:** Partial **past** days → **`computeOperatorResults`**; longer ranges → hybrid complete days from cache + partial sessions; single-day style ranges → **`getCachedOperatorResults`**.
- **With `shiftId`:** Returns **`operatorResults`** built only from session buckets; placeholder efficiency **0** and empty **`countByItem`** may appear in the simplified shape.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-02T05:00:00.000Z",
    "total": "1ms"
  },
  "operatorResults": [
    {
      "operator": { "id": 117811, "name": { "first": "Shaun", "surname": "White" } },
      "currentStatus": { "code": 1, "name": "Running" },
      "metrics": {
        "runtime": { "total": 12600000, "formatted": { "hours": 3, "minutes": 30 } },
        "downtime": { "total": 300000, "formatted": { "hours": 0, "minutes": 5 } },
        "output": { "totalCount": 950, "misfeedCount": 8 },
        "performance": {
          "availability": { "value": 0.94, "percentage": "94.00" },
          "throughput": { "value": 0.99, "percentage": "99.00" },
          "efficiency": { "value": 0.88, "percentage": "88.00" },
          "oee": { "value": 0.82, "percentage": "82.00" }
        }
      },
      "countByItem": {}
    }
  ]
}
```

**Example Requests:**
```
GET /api/dashboard/analytics/daily-summary-dashboard/operators?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/dashboard/analytics/daily-summary-dashboard/operators?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&shiftId=674a1b2c3d4e5f6789012345
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to generate operators summary" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily-summary-dashboard/items

**Item table** for the **Daily‑Summary** dashboard. Hybrid **cache + session** logic with optional **`serial`** filter and **`shiftId`** session mode.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |
| serial | integer | No | Limit item aggregation to one machine. |
| shiftId | string | No | Shift ObjectId; aggregates **`machineItems`** from session data into rows keyed by **`itemName`**. |

**Behavior notes:**

- **With `shiftId`:** Response **`items`** may use **zeroed** PPH/standard/efficiency placeholders; **`count`** is summed from session **`machineItems`** for the window.
- **Without `shiftId`:** Same partial‑day and **>24h hybrid** patterns as machines/operators.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-02T05:00:00.000Z",
    "total": "1ms"
  },
  "items": [
    {
      "itemName": "Pool Towel",
      "count": 1240,
      "pph": 330.67,
      "standard": 625,
      "efficiency": 52.91,
      "workedTimeFormatted": { "hours": 3, "minutes": 45 }
    }
  ]
}
```

**Example Requests:**
```
GET /api/dashboard/analytics/daily-summary-dashboard/items?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/dashboard/analytics/daily-summary-dashboard/items?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&serial=67808
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to generate items summary" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily/machine-status-cache

**Daily Dashboard (6 charts) — chart 1.** Fast **machine status** breakdown (**running / paused / faulted** time in ms) for **today** in **`America/Chicago`**, built from **daily totals** via **`buildMachineStatusFromDailyTotals`**.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:** None (window is **start of local day → now**).

**Behavior notes:**

- Not parameterized by user `start`/`end`; always “**today so far**” in the configured system timezone.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-01T15:30:00.000Z",
    "total": "10h 30m"
  },
  "machineStatus": [
    {
      "serial": 67808,
      "name": "SPF1",
      "runningMs": 25200000,
      "pausedMs": 1800000,
      "faultedMs": 600000
    }
  ]
}
```

**Example Request:**
```
GET /api/dashboard/analytics/daily/machine-status-cache
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch fast machine status data" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily/machine-oee

**Daily Dashboard — chart 2.** Cached **OEE per machine** for **today** (`buildMachineOEEFromDailyTotals`).

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:** None.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-01T15:30:00.000Z",
    "total": "10h 30m"
  },
  "machineOee": [
    { "serial": 67808, "name": "SPF1", "oee": 78.5 }
  ]
}
```

**Example Request:**
```
GET /api/dashboard/analytics/daily/machine-oee
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine OEE data" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/hourly/item-totals-by-type

**Daily Dashboard — chart 3 (“item totals by type”).** Hourly **stacked-style** item totals from cache (**`buildItemTotalsFromCache`**). If **`start`/`end` are omitted or invalid**, falls back to **today so far**.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | No | Window start. When both `start` and `end` parse successfully, they bound the query. |
| end | ISO 8601 datetime | No | Window end. |

**Behavior notes:**

- Invalid or missing params → **today** (local zone) as in the controller’s `catch` path.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-01T15:30:00.000Z",
    "total": "10h 30m"
  },
  "itemTotals": {
    "hours": [5, 6, 7, 8],
    "series": []
  }
}
```

*(The precise `itemTotals` object mirrors `buildItemTotalsFromCache`; integrators should tolerate extra keys.)*

**Example Requests:**
```
GET /api/dashboard/analytics/hourly/item-totals-by-type
GET /api/dashboard/analytics/hourly/item-totals-by-type?start=2025-05-01T05:00:00.000Z&end=2025-05-01T23:59:59.000Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch item totals by type from cache" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/machines-group-summary-daily-cached

**Daily Dashboard — chart 4 (machine groups / departments).** Reads **`totals-daily`** for **`entityType: machine`** on the **Chicago calendar date** derived from the request’s **`start`**, plus **yesterday** for **`efficiencyPreviousDay`** comparisons. Departments come from **`machine.groups.department`** against an internal allowlist.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Used with `end` for validation and window length; **date key** for cache is the Chicago date of `start`. |
| end | ISO 8601 datetime | Yes | Window end. |
| serial | integer | No | Restrict which machines contribute. |

**Behavior notes:**

- If **no cache** exists for that date, returns **`{ "data": [], "debug": { ... } }`** with diagnostic hints (not a 404).

**Data Format (success):**
```json
[
  {
    "department": "Towels",
    "machineCount": 4,
    "runtimeMs": 50000000,
    "efficiency": 82.3,
    "efficiencyPreviousDay": 79.1
  }
]
```

**Example Request:**
```
GET /api/dashboard/analytics/machines-group-summary-daily-cached?start=2025-05-01T05:00:00.000Z&end=2025-05-02T05:00:00.000Z
```

**Error Responses:**

**400 Bad Request** — invalid date range (via `parseAndValidateQueryParams`)

**500 Internal Server Error** — body is `{ "error": "<message>" }` where `message` is the server exception text (rare for this route).

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily/top-operators-cache

**Daily Dashboard — chart 5.** **Top operators** by efficiency for **today**, from **`buildTopOperatorEfficiencyFromCache`**; if cache yields empty/zero data, **falls back** to **`buildTopOperatorEfficiencyFromSessions`**.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:** None.

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T05:00:00.000Z",
    "end": "2025-05-01T15:30:00.000Z",
    "total": "10h 30m"
  },
  "topOperators": [
    {
      "operatorId": 117811,
      "name": "Shaun White",
      "efficiency": 91.2,
      "metrics": { "runtime": { "total": 14400000 } }
    }
  ]
}
```

**Example Request:**
```
GET /api/dashboard/analytics/daily/top-operators-cache
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch fast top operator data" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily/count-totals-cache

**Daily Dashboard — chart 6.** **Plant-wide count totals** for **today** from daily aggregates (**`buildCountTotalsFromDailyTotals`**). **`timeRange`** may only include **`end`** (now).

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:** None.

**Data Format:**
```json
{
  "timeRange": { "end": "2025-05-01T15:30:00.000Z" },
  "dailyCounts": [
    { "date": "2025-04-04T00:00:00.000Z", "count": 118000 },
    { "date": "2025-04-05T00:00:00.000Z", "count": 121500 }
  ]
}
```

**Field reference:** `dailyCounts[]` entries are **`{ date, count }`** sums of **`totalCounts`** from **`totals-daily`** **`entityType: machine`**, covering roughly the **last 28 days** through **`dayEnd`**.

**Example Request:**
```
GET /api/dashboard/analytics/daily/count-totals-cache
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch fast daily count totals data" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/daily/machine-live-session-summary

**Production / efficiency screens — “flipper” API (daily path).** Per‑**operator** **live** efficiency and OEE for **short windows** (6m / 15m / 1h) plus **all‑day** from **`totals-daily`** when the machine is **running**; uses **state ticker** and **operator sessions**. Used when the UI polls **without** a station id (legacy flipper behavior).

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | integer | Yes | Machine serial. |

**Behavior notes:**

- If **no ticker** exists, returns **offline** lane payload(s) with `status: -1`.
- **Blocked station** logic skips certain lanes on serials **67801** / **67802** station **2**.

**Data Format (abridged):**
```json
{
  "flipperData": [
    {
      "status": 1,
      "fault": "Running",
      "operator": "Shaun White",
      "operatorId": 117811,
      "machine": "SPF1",
      "timers": { "on": 0, "ready": 0 },
      "displayTimers": { "on": "", "run": "" },
      "efficiency": {
        "lastSixMinutes": { "value": 88, "label": "Last 6 Mins", "color": "green" },
        "lastFifteenMinutes": { "value": 85, "label": "Last 15 Mins", "color": "green" },
        "lastHour": { "value": 82, "label": "Last Hour", "color": "green" },
        "today": { "value": 79, "label": "All Day", "color": "orange" }
      },
      "oee": {
        "lastSixMinutes": { "value": 72, "label": "Last 6 Mins", "color": "orange" }
      },
      "batch": { "item": "Pool Towel", "code": 10000001 }
    }
  ]
}
```

**Example Request:**
```
GET /api/dashboard/analytics/daily/machine-live-session-summary?serial=67808
```

**Error Responses:**

**400 Bad Request** — missing `serial`  
**500 Internal Server Error**
```json
{ "error": "Internal server error" }
```

**Versioning & Stability:** Alpha.

---

### /api/dashboard/analytics/machine-live-session-summary/machine

**Production screens — machine‑wide variant** of the live session summary. Same **`flipperData[]` envelope** and query contract as **`daily/machine-live-session-summary`**, with implementation tuned for the **machine** production view.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | integer | Yes | Machine serial. |

**Example Request:**
```
GET /api/dashboard/analytics/machine-live-session-summary/machine?serial=67808
```

**Error Responses:** Same family as **`daily/machine-live-session-summary`**.

**Versioning & Stability:** Alpha.

---

## Fault

### /api/fault/analytics/fault-sessions-history

Returns fault session history over a time window, optionally scoped to a specific machine or operator. Designed for fault analytics and reporting: fault cycles, duration summaries, and work time impact analysis.

**Method:** GET  
**Auth:** Required  
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
GET /api/fault/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808
```

**Example Request with Include Parameter:**
```
GET /api/fault/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808&include=cycles
```

```
GET /api/fault/analytics/fault-sessions-history?start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&operatorId=135790&include=summaries
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
GET /api/fault/analytics/fault-sessions-history?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=135790
```

```
GET /api/fault/analytics/fault-sessions-history?start=2025-05-01T08:00:00.000Z&end=2025-05-01T16:00:00.000Z&serial=67808&operatorId=135790
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

**Versioning & Stability:** Alpha; tolerate unknown keys.

### /api/fault/analytics/fault-report-summary

Returns a fault report **summary** across all machines: faults grouped by fault code. Uses the `fault-session` collection (sessions, no cache). Intended for the Fault Report UI (summary view).

**Method:** `GET`

**Query Parameters:**

| Parameter | Type   | Required | Description        |
|-----------|--------|----------|--------------------|
| start     | string | Yes      | ISO start datetime |
| end       | string | Yes      | ISO end datetime   |

**Example:**
```
GET /api/fault/analytics/fault-report-summary?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Response:** `{ context: { start, end }, summaries: [{ code, name, count, totalDurationSeconds, formatted: { hours, minutes, seconds } }] }`

---

### /api/fault/analytics/fault-report-detailed

Returns a fault report **detailed** by machine then fault code. Uses the `fault-session` collection (sessions, no cache). Intended for the Fault Report UI (detailed view).

**Method:** `GET`

**Query Parameters:**

| Parameter | Type   | Required | Description        |
|-----------|--------|----------|--------------------|
| start     | string | Yes      | ISO start datetime |
| end       | string | Yes      | ISO end datetime   |

**Example:**
```
GET /api/fault/analytics/fault-report-detailed?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Response:** `{ context: { start, end }, details: [{ machineSerial, machineName, code, name, count, totalDurationSeconds, formatted: { hours, minutes, seconds } }] }`

---

## Item

### /api/item/analytics/items-summary-daily-cache

**Item Dashboard — main table.** Hybrid **cache + session** aggregation over `[start, end]`. Uses **`totals-daily`** item rows for **full-day / today** windows and **`getItemsSessionDataForPartialDays`** for **partial past days**; may combine **hybrid splits** for long multi-day ranges (>24h) similar to other item routes.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |

**Behavior notes:**

- **Partial day in the past** (not today) → **session-only** path for accurate clipping.
- **Standards:** values may be **PPH** or **PPM**; values **< 60** are treated as **PPM→PPH** when scoring efficiency.
- **`efficiency`** is a **percentage** (0–100 scale) comparing realized PPH to standard.

**Data Format:**
```json
[
  {
    "itemId": 4,
    "itemName": "Pool Towel",
    "workedTimeFormatted": { "hours": 3, "minutes":30 },
    "count": 1240,
    "pph": 330.67,
    "standard": 625,
    "efficiency": 52.91
  }
]
```

**Example Request:**
```
GET /api/item/analytics/items-summary-daily-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Error Responses:**

**400 Bad Request** — invalid `start` / `end` (from shared parser)  
**500 Internal Server Error**
```json
{ "error": "Failed to generate items summary from daily cache" }
```

**Versioning & Stability:** Alpha.

---

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

## Machine

### Cached dashboard analytics

### /api/machine/analytics/machines-summary-daily-cached

**Machine Dashboard — main table.** Returns **one row per machine** from **`totals-daily`** with **`entityType: machine`** for the **current calendar date in `America/Chicago`**. **`start` and `end`** are **validated** (required query params) and used when **falling back** to the real-time aggregator; the **happy path** ignores the requested calendar range and uses **“today”** cache rows only.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Required for validation / real-time fallback path. |
| end | ISO 8601 datetime | Yes | Required for validation / real-time fallback path. |
| serial | integer | No | When set, restricts cache rows to that **`machineSerial`**. |

**Behavior notes:**

- Loads live **state ticker** rows to populate **`currentStatus`** (code/name/color).
- If **no cache** exists for Chicago today, delegates to **`getMachinesSummaryRealTime`** (same query).
- Derives **availability**, **throughput**, **efficiency**, **OEE** from cached runtime / downtime / counts / time credit.
- On validation errors → **400** with `{ "error": "<message>" }`; on other errors → attempts real-time fallback.

**Data Format:**
```json
[
  {
    "machine": { "serial": 67808, "name": "SPF1" },
    "currentStatus": { "code": 1, "name": "Running", "color": "None" },
    "metrics": {
      "runtime": { "total": 14400000, "formatted": { "hours": 4, "minutes": 0 } },
      "downtime": { "total": 900000, "formatted": { "hours": 0, "minutes": 15 } },
      "output": { "totalCount": 1200, "misfeedCount": 12 },
      "performance": {
        "availability": { "value": 0.94, "percentage": "94.00" },
        "throughput": { "value": 0.99, "percentage": "99.00" },
        "efficiency": { "value": 0.87, "percentage": "87.00" },
        "oee": { "value": 0.80, "percentage": "80.00" }
      }
    },
    "timeRange": {
      "start": "2025-05-01T05:00:00.000Z",
      "end": "2025-05-01T18:00:00.000Z"
    }
  }
]
```

**Example Request:**
```
GET /api/machine/analytics/machines-summary-daily-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/machine/analytics/machines-summary-daily-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&serial=67808
```

**Error Responses:**

**400 Bad Request** — invalid or missing dates  
**500 Internal Server Error** — only if real-time fallback also fails (rare; message varies)

**Versioning & Stability:** Alpha.

---

### /api/machine/analytics/machine-dashboard-daily-cached

**Machine Dashboard modal** and **Daily‑Summary machine modal** payload. Built from **`totals-daily`** (**`machine`**, **`machine-item`**, **`operator-machine`**) and **`hourly-totals`** for the **same Chicago “today”** date as the summary route. **Does not** require `start`/`end` query params (only optional **`serial`**).

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| serial | integer | No | If set, only that machine’s dashboard object is returned. |

**Behavior notes:**

- **`faultData`** is present but populated with **empty** arrays in this cache route; the UI loads faults via **`/api/fault/analytics/fault-sessions-history`**.
- **`itemSummary`**, **`itemHourlyStack`**, **`operatorEfficiency`** are built from cached day records.
- **`currentOperators`** is resolved from DB helpers (live assignment).

**Data Format (per array element):**
```json
{
  "machine": { "serial": 67808, "name": "SPF1" },
  "currentStatus": { "code": 1, "name": "Running" },
  "performance": {
    "runtime": { "total": 14400000, "formatted": { "hours": 4, "minutes": 0 } },
    "downtime": { "total": 600000, "formatted": { "hours": 0, "minutes": 10 } },
    "output": { "totalCount": 1200, "misfeedCount": 12 },
    "performance": {
      "availability": { "value": 0.96, "percentage": "96.00%" },
      "throughput": { "value": 0.99, "percentage": "99.00%" },
      "efficiency": { "value": 0.87, "percentage": "87.00%" },
      "oee": { "value": 0.83, "percentage": "83.00%" }
    }
  },
  "itemSummary": [],
  "itemHourlyStack": [],
  "faultData": { "faultSummaries": [], "faultCycles": [] },
  "operatorEfficiency": [],
  "currentOperators": [],
  "timestamp": "2025-05-01T18:00:00.000Z",
  "sessionStart": "2025-05-01T05:00:00.000Z",
  "sessionEnd": "2025-05-01T18:00:00.000Z"
}
```

**Example Request:**
```
GET /api/machine/analytics/machine-dashboard-daily-cached
GET /api/machine/analytics/machine-dashboard-daily-cached?serial=67808
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to fetch machine dashboard daily cache" }
```

**Versioning & Stability:** Alpha.

---

### Live machine data (/api/machine/…)

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

## Machines

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

## Operator

### /api/operator/analytics/operators-summary-daily-cached

**Operator Dashboard — main table.** Mirrors the machine summary pattern: reads **`totals-daily`** with **`entityType: operator-machine`** for **today’s date in `America/Chicago`**, merges **live ticker** hints for **currentMachine** / **currentStatus**, aggregates metrics across all **operator-machine** rows for that operator id, and **filters out “phantom”** rows (requires runtime, production, and either a **current machine** or **≥ 1h** runtime). **`start`/`end`** are required for validation and **real-time fallback**.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Validated; used for fallback. |
| end | ISO 8601 datetime | Yes | Validated; used for fallback. |
| operatorId | integer | No | When set, restricts cache rows to that **`operatorId`**. |

**Behavior notes:**

- **Weighted efficiency** across machines uses **`workedTimeMs`** as weight before recomputing blended **OEE**.
- **`machines`** list on intermediate objects is **stripped** before respond (internal aggregation only).

**Data Format:**
```json
[
  {
    "operator": { "id": 117811, "name": "Shaun White" },
    "currentStatus": { "code": 1, "name": "Running" },
    "currentMachine": { "serial": 67808, "name": "SPF1" },
    "metrics": {
      "runtime": { "total": 14400000, "formatted": { "hours": 4, "minutes": 0 } },
      "downtime": { "total": 300000, "formatted": { "hours": 0, "minutes": 5 } },
      "output": { "totalCount": 950, "misfeedCount": 4 },
      "performance": {
        "availability": { "value": 0.95, "percentage": "95.00" },
        "throughput": { "value": 0.99, "percentage": "99.00" },
        "efficiency": { "value": 0.88, "percentage": "88.00" },
        "oee": { "value": 0.83, "percentage": "83.00" }
      }
    },
    "timeRange": {
      "start": "2025-05-01T05:00:00.000Z",
      "end": "2025-05-01T18:00:00.000Z"
    }
  }
]
```

**Example Request:**
```
GET /api/operator/analytics/operators-summary-daily-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/operator/analytics/operators-summary-daily-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=117811
```

**Error Responses:**

**400 Bad Request** — invalid dates  
**500 Internal Server Error** — rare; real-time fallback may still apply

**Versioning & Stability:** Alpha.

---

### /api/operator/analytics/operator-details-cached

**Operator Dashboard modal** and **Daily‑Summary operator modal.** Builds **`itemSummary`** rows, **`countByItem`**, **`cyclePie`**, and **`dailyEfficiency`** entirely from **cached** collections (**`totals-daily`**, **`hourly-totals`**, helpers in **`operatorFunctions`**), with optional **`serial`** scoping.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |
| operatorId | integer | Yes | Operator id. |
| serial | integer | No | Limit charts to one machine. |
| tz | string | No | IANA timezone for daily efficiency (default **`America/Chicago`**). |

**Data Format:**
```json
{
  "itemSummary": [
    {
      "operatorName": "Shaun White",
      "machineSerial": 67808,
      "machineName": "SPF1",
      "itemName": "Pool Towel",
      "count": 400,
      "misfeed": 0,
      "standard": 625,
      "valid": 400,
      "pph": 280.5,
      "efficiency": 44.9,
      "workedTimeFormatted": { "hours": 1, "minutes": 25 }
    }
  ],
  "countByItem": {},
  "cyclePie": {},
  "dailyEfficiency": {
    "operator": { "id": 117811, "name": "Shaun White" },
    "days": []
  }
}
```

*(Shapes of `countByItem`, `cyclePie`, and `dailyEfficiency` follow builder output; tolerate nesting and extra keys.)*

**Example Request:**
```
GET /api/operator/analytics/operator-details-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=117811
GET /api/operator/analytics/operator-details-cached?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=117811&serial=67808
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "start, end, and operatorId are required" }
```
```json
{ "error": "operatorId must be a valid number" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch operator details from cache" }
```

**Versioning & Stability:** Alpha.

---

### /api/operator/analytics/operator-machine-summary

**Inside the Operator Dashboard modal** when breaking totals down **by machine**. Aggregates **overlapping operator sessions** in the window, merges **per-item** production, and counts **fault sessions that overlap runtime intervals** (**`faultsWhileRunning`**).

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start (inclusive). |
| end | ISO 8601 datetime | Yes | Window end (exclusive). |
| operatorId | integer | Yes | Operator id. |

**Data Format:**
```json
{
  "context": {
    "operatorId": 117811,
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T18:00:00.000Z"
  },
  "machines": [
    {
      "machine": { "serial": 67808, "name": "SPF1" },
      "sessions": 3,
      "faultsWhileRunning": 1,
      "totals": {
        "totalCount": 400,
        "totalMisfeed": 2,
        "totalTimeCredit": 125000,
        "runtime": 10800000
      },
      "items": [
        {
          "id": 4,
          "name": "Pool Towel",
          "standard": 625,
          "totalCount": 400,
          "totalTimeCredit": 125000
        }
      ]
    }
  ]
}
```

**Example Request:**
```
GET /api/operator/analytics/operator-machine-summary?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&operatorId=117811
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "operatorId required and must be a number" }
```

**400 Bad Request** — invalid `start`/`end` (shared parser)

**500 Internal Server Error**
```json
{ "error": "Failed to build operator machine summary" }
```

**Versioning & Stability:** Alpha.

---

## Operators

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

## Reports

### /api/reports/shifts

Lists **active** shift definitions from the `shift` collection, sorted by name. Used by the shift-scoped machine report UI to populate the shift selector.

**Method:** GET  
**Auth:** Required  
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
GET /api/reports/shifts
```

**Error Responses:**

**500 Internal Server Error**
```json
{ "error": "Failed to list shifts" }
```

**Versioning & Stability:** Alpha; additive changes only where possible.

---

### /api/reports/analytics/machine-report-cache

JSON payload for the **Machine Report** and **Shift Machine Report** Angular tables. Primarily uses the `totals-daily` cache (`entityType` `machine` and `machine-item`), with session-based fallback when cache is empty for the requested window. When **`shiftId`** is present, data is computed from sessions for that shift and time window instead of daily cache.

Session-centric summaries that iterate raw machine/item sessions may expose **different shapes** and aggregation rules. **Integrators mirroring the HTML machine / shift reports should use this cache-first route.**

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. Parsed with server timezone rules; end may be clamped to now. |
| end | ISO 8601 datetime | Yes | Window end. |
| serial | integer | No | Limit to one machine serial. |
| shiftId | string | No | MongoDB ObjectId of a shift. When set, uses session data clipped to the window for that shift (see [`/api/reports/shifts`](#apireportsshifts)). |

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
GET /api/reports/analytics/machine-report-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/reports/analytics/machine-report-cache?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&serial=67808
GET /api/reports/analytics/machine-report-cache?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&shiftId=674a1b2c3d4e5f6789012345
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

### /api/reports/analytics/operator-item-sessions-summary-cache

JSON payload for the **Operator Report** Angular table. Uses **`totals-daily`** (**`operator-machine`**, **`operator-item`**) for complete calendar days with **hybrid** fill-in from **sessions** for partial ranges; if cache queries return **no documents**, the handler may **fall back to sessions for the entire range**. The cache-first response keeps **`sessions`** as an **empty array** placeholder for UI parity with older clients.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |
| operatorId | integer | No | Restrict aggregation to one operator. |

**Behavior notes:**

- **Luxon + `America/Chicago`:** day boundaries, “today since midnight”, and **full-day** detection drive whether **`splitTimeRangeForHybridReport`** or forced cache windows apply.
- **De-duplication:** operator-machine rows are **grouped by (operatorId, date)** before summing runtime/counts so one operator on multiple machines does not **multiply** runtime incorrectly.
- Item rows under **`operatorSummary.itemSummaries`** are keyed by a **normalized item name** (lowercase, trimmed); each value includes display **`name`**.
- Operators with **zero** total production are typically **omitted** from **`results`**.
- **`efficiency`** fields are **percentages** (PPH vs prorated standard); may be **`null`** when standard is missing or zero.

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

**Field reference:**

| Path | Type | Description |
|------|------|-------------|
| `timeRange` | object | Start/end of the normalized reporting window. |
| `results[].operator` | object | `id`, resolved display `name`. |
| `results[].sessions` | array | Always `[]` for this route; session detail is not embedded. |
| `results[].operatorSummary` | object | Totals, timings, PPH, prorated standard, top-level efficiency. |
| `results[].operatorSummary.itemSummaries` | object | Map keyed by normalized item name → per-item metrics. |

**Example Requests:**
```
GET /api/reports/analytics/operator-item-sessions-summary-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
GET /api/reports/analytics/operator-item-sessions-summary-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z&operatorId=117811
```

**Error Responses:**

**400 Bad Request** — invalid `start` / `end` (shared parser)

**500 Internal Server Error**
```json
{ "error": "Failed to generate cached operator item summary" }
```

**Versioning & Stability:** Alpha; additive changes preferred.

---

### /api/reports/analytics/item-sessions-summary-daily-cache

JSON **array** for the **Item Report** Angular table: one object per **`itemId`** after aggregation across the window. Reads **`totals-daily`** with **`entityType: item`** and **`source: simulator`** for cacheable full-day windows; **multi-day** requests beyond **24h** use a **hybrid** of cache (**complete days**) + **`getItemSessionDataForPartialDays`** for edge partials; **partial days in the past** (not including today) use **sessions only** for accurate clipping. **`itemName`** in session fallback rows replaces some paths that use **`name`** only—clients should read both if present.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**

| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 datetime | Yes | Window start. |
| end | ISO 8601 datetime | Yes | Window end. |

**Behavior notes:**

- Timezone normalization follows **`SYSTEM_TIMEZONE`** (**`America/Chicago`** in helpers) for partial-day detection.
- Standards: **`standard`** may be **PPH** or **PPM**; values **below 60** are treated as **PPM→PPH** for efficiency.
- **`efficiency`** is a **percentage** (0–100), rounded.

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
GET /api/reports/analytics/item-sessions-summary-daily-cache?start=2025-05-01T00:00:00.000Z&end=2025-05-02T00:00:00.000Z
```

**Error Responses:**

**400 Bad Request** — invalid `start` / `end`

**500 Internal Server Error**
```json
{ "error": "Failed to generate daily cached item summary" }
```

**Versioning & Stability:** Alpha; additive changes preferred.

---

## Softrol

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

## Alpha

### Utility Routes

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

### Legacy Routes

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

### Analytics routes (alpha-only)

### /api/alpha/historic-data-test

Test route for historic data pipelines (alpha). See server implementation for current behavior and parameters.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

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


