# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.



---
## Available Routes

### alpha
- [/api/alpha/analytics/daily-dashboard/daily-counts](#apialphaanalyticsdaily-dashboarddaily-counts)
- [/api/alpha/analytics/daily-dashboard/full](#apialphaanalyticsdaily-dashboardfull)
- [/api/alpha/analytics/daily-summary-dashboard](#apialphaanalyticsdaily-summary-dashboard)
- [/api/alpha/analytics/item-sessions-summary](#apialphaanalyticsitem-sessions-summary)
- [/api/alpha/analytics/item-stacked-by-hour](#apialphaanalyticsitem-stacked-by-hour)
- [/api/alpha/analytics/machine-details](#apialphaanalyticsmachine-details)
- [/api/alpha/analytics/machine-item-sessions-summary](#apialphaanalyticsmachine-item-sessions-summary)
- [/api/alpha/analytics/machines-summary](#apialphaanalyticsmachines-summary)
- [/api/alpha/analytics/operator-details](#apialphaanalyticsoperator-details)
- [/api/alpha/analytics/operator-item-sessions-summary](#apialphaanalyticsoperator-item-sessions-summary)
- [/api/alpha/analytics/operator-summary](#apialphaanalyticsoperator-summary)
- [/api/alpha/sample/machineOverview](#apialphasamplemachineoverview)

### history
- [/api/history/machine/faults](#apihistorymachinefaults)

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

### /api/alpha/analytics/daily-dashboard/full

This route provides a comprehensive daily dashboard with aggregated metrics across all machines, operators, and items for a specified time window. It returns machine status, OEE metrics, item hourly stacks, top operator performance, plantwide metrics, and daily count totals.

|  | Input Parameters |  |
| --- | --- | --- |
| Label | Definition | Required |
| start | Start timestamp of the query window | Yes |
| end | End timestamp of the query window | Yes |

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T12:00:00.000Z",					ISO timestamp of window start
    "end": "2025-05-01T18:00:00.000Z",						ISO timestamp of window end
    "total": "06:00:00"										String formatted duration of window
  },
  "machineStatus": [
    {
      "serial": 67808,										Integer serial number of machine
      "name": "SPF1",										String name of machine
      "runningMs": 14400000,									Integer running time in milliseconds
      "pausedMs": 3600000,									Integer paused time in milliseconds
      "faultedMs": 1800000									Integer faulted time in milliseconds
    }
  ],
  "machineOee": [
    {
      "serial": 67808,										Integer serial number of machine
      "name": "SPF1",										String name of machine
      "oee": 72.73											Float OEE percentage (rounded to 2 decimals)
    }
  ],
  "itemHourlyStack": {
    "title": "Item Counts by Hour (All Machines)",			String title of the chart
    "data": {
      "hours": ["2025-05-01T12:00:00.000Z", ...],			Array of ISO hour timestamps
      "operators": {											Object keyed by item name
        "Pool Towel": [120, 135, 98, ...],					Array of counts per hour
        "Bath Towel": [45, 67, 89, ...]
      }
    }
  },
  "topOperators": [
    {
      "id": 117811,											Integer operator ID
      "name": "Shaun White",									String operator full name
      "efficiency": 96.15,									Float efficiency percentage (rounded to 2 decimals)
      "metrics": {
        "runtime": {
          "total": 14400000,									Integer total runtime in milliseconds
          "formatted": "04:00:00"							String formatted runtime (HH:MM:SS)
        },
        "output": {
          "totalCount": 1240,								Integer total pieces processed
          "validCount": 1220,								Integer valid pieces processed
          "misfeedCount": 20									Integer misfeed pieces
        }
      }
    }
  ],
  "plantwideMetrics": [
    {
      "hour": 12,											Integer hour of day (0-23)
      "availability": 85.5,									Float availability percentage (rounded to 2 decimals)
      "efficiency": 88.2,									Float efficiency percentage (rounded to 2 decimals)
      "throughput": 95.8,									Float throughput percentage (rounded to 2 decimals)
      "oee": 72.1											Float OEE percentage (rounded to 2 decimals)
    }
  ],
  "dailyCounts": [
    {
      "date": "2025-05-01",									String date in YYYY-MM-DD format
      "count": 12450											Integer total count for that date
    }
  ]
}
```

**Example Request:**
```
GET /api/alpha/analytics/daily-dashboard/full?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch full daily dashboard data"
}
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

### /api/alpha/analytics/daily-dashboard/daily-counts

Returns daily count totals for all machines over a specified time window.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive) |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive) |

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T12:00:00.000Z",
    "end": "2025-05-01T18:00:00.000Z",
    "total": "06:00:00"
  },
  "dailyCounts": [
    {
      "date": "2025-05-01",
      "count": 12450
    }
  ]
}
```

**Example Request:**
```
GET /api/alpha/analytics/daily-dashboard/daily-counts?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch daily counts data"
}
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

### /api/alpha/analytics/daily-summary-dashboard

This route provides a comprehensive daily summary dashboard with detailed machine, operator, and item analytics for a specified time window. It returns machine performance metrics, operator efficiency data, and item production summaries across all active machines.

|  | Input Parameters |  |
| --- | --- | --- |
| Label | Definition | Required |
| start | Start timestamp of the query window | Yes |
| end | End timestamp of the query window | Yes |
| serial | Machine serial number (optional) | No |

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Data Format:**
```json
{
  "timeRange": {
    "start": "2025-05-01T12:00:00.000Z",					ISO timestamp of window start
    "end": "2025-05-01T18:00:00.000Z",						ISO timestamp of window end
    "total": "00:00:15"										String formatted query execution time
  },
  "machineResults": [
    {
      "machine": {
        "serial": 67808,										Integer serial number of machine
        "name": "SPF1"										String name of machine
      },
      "currentStatus": {
        "code": 1,											Integer status code (1=running, 0=paused, other=fault)
        "name": "Running"									String status name
      },
      "performance": {
        "runtime": {
          "total": 14400000,									Integer total runtime in milliseconds
          "formatted": "04:00:00"							String formatted runtime (HH:MM:SS)
        },
        "availability": {
          "value": 0.85,									Float availability ratio (0-1)
          "percentage": 85.0									Float availability percentage
        },
        "efficiency": {
          "value": 0.92,									Float efficiency ratio (0-1)
          "percentage": 92.0									Float efficiency percentage
        },
        "throughput": {
          "value": 0.96,									Float throughput ratio (0-1)
          "percentage": 96.0									Float throughput percentage
        },
        "oee": {
          "value": 0.75,									Float OEE ratio (0-1)
          "percentage": 75.0									Float OEE percentage
        }
      }
    }
  ]
}
```

**Example Request:**
```
GET /api/alpha/analytics/daily-summary-dashboard?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z
```

**Error Responses:**

**500 Internal Server Error**
```json
{
  "error": "Failed to generate daily summary dashboard"
}
```

**Versioning & Stability:**

Route path and response shape are Alpha and may evolve. New fields will be additive; existing fields will maintain types and semantics.

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

All three routes are Alpha and may add fields (backward‑compatible). Existing semantics are stable; breaking changes will be versioned under a new path.

### /api/alpha/analytics/item-stacked-by-hour

Returns stacked item counts per hour within a time window, scoped by operator, machine, or both. Counts are clipped to the window and misfeeds are excluded.

**Method:** GET  
**Auth:** Same as other /api/alpha routes  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive). |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive). If a future time is provided, it is clamped to server "now". |
| operatorId | Integer | At least one of operatorId or serial | Scope to a specific operator's sessions. |
| serial | Integer | At least one of operatorId or serial | Scope to a specific machine serial. |

**Behavior Notes:**

- If operatorId is provided (alone or with serial), data is sourced from operator-sessions; otherwise from machine-sessions.
- Sessions must overlap the [start, end) window.
- Only counts with timestamps inside the window are included; misfeeds are excluded.
- If both operatorId and serial are provided, counts are further restricted to that machine serial.
- Item name falls back to "Unknown" when missing.
- Hours are returned as relative 1-hour bins from the start of the window: 0 = first hour, 1 = second hour, etc.

**Data Format:**
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

If no data falls in the window, the service returns:

```json
{ 
  "title": "No data", 
  "data": { 
    "hours": [], 
    "operators": {} 
  }, 
  "meta": { "...": "..." } 
}
```

**Example Request:**
```
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&operatorId=117811
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&serial=67808
GET /api/alpha/analytics/item-stacked-by-hour?start=2025-05-01T12:00:00.000Z&end=2025-05-01T16:00:00.000Z&operatorId=117811&serial=67808
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "Provide serial or operatorId" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to build item stacked chart" }
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

## history

### /api/history/machine/faults

This route provides historical fault data for a specific machine over a time window.

**Method:** GET  
**Auth:** Required  
**Idempotent:** Yes

**Query Parameters:**
| Label | Type | Required | Description |
|-------|------|----------|-------------|
| start | ISO 8601 timestamp (UTC) | Yes | Window start (inclusive) |
| end | ISO 8601 timestamp (UTC) | Yes | Window end (exclusive) |
| serial | Integer | Yes | Machine serial number |

**Data Format:**
```json
{
  "faultCycles": [
    {
      "faultType": "Feeder Right Inlet Jam",
      "faultCode": 24,
      "start": "2025-05-01T12:56:38.199Z",
      "states": [
        {
          "timestamp": "2025-05-01T12:56:38.199Z",
          "machine": {
            "serial": 67802,
            "name": "Blanket2"
          },
          "program": {
            "mode": "largePiece"
          },
          "operators": [
            {
              "id": 135799,
              "station": 1
            }
          ],
          "status": {
            "code": 141,
            "name": "Feeder Right Inlet Jam"
          }
        }
      ],
      "end": "2025-05-01T12:56:58.797Z",
      "duration": 20598
    }
  ],
  "faultSummaries": [
    {
      "faultType": "Feeder Right Inlet Jam",
      "faultCode": 24,
      "totalDuration": 44619,
      "count": 3
    }
  ]
}
```

**Example Request:**
```
GET /api/history/machine/faults?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&serial=67802
```

**Error Responses:**

**400 Bad Request**
```json
{ "error": "start, end, and serial are required" }
```

**500 Internal Server Error**
```json
{ "error": "Failed to fetch fault history" }

```
{
    "faultCycles": [													Array of objects describing each fault session which occurred during the query timeframe
        {
            "faultType": "Feeder Right Inlet Jam",						String name of the fault
			"faultCode": 24,											Integer Fault code
            "start": "2025-05-01T12:56:38.199Z",						String timestamp in ISO Standard UTC format of when fault session began
            "states": [													Array of all fault state objects which occurred during this session
                {
                    "timestamp": "2025-05-01T12:56:38.199Z",			String timestamp in ISO Standard UTC format of when this state change was recorded
                    "machine": {
                        "serial": 67802,								Integer serial number of machine
                        "name": "Blanket2"								String name of machine
                    },
                    "program": {
                        "mode": "largePiece"							String name of program mode on machine
                    },
                    "operators": [										Array of operators currently logged into machine
                        {
                            "id": 135799,								Integer operator ID (-1 indicates an inactive station, ID beginning in 9 indicates no logged in operator)
                            "station": 1								Integer station number
                        }
                    ],
                    "status": {
                        "code": 141,									Integer fault code
                        "name": "Feeder Right Inlet Jam"				String fault name
                    }
                }
            ],
            "end": "2025-05-01T12:56:38.199Z",							String timestamp in ISO Standard UTC format of when fault session ended
            "duration": 20598											Integer duration of the fault session in milliseconds
        }
    ],
    "faultSummaries": [													Array of objects representing a summary of faults which occurred during the query timeframe
        {
            "faultType": "Feeder Right Inlet Jam",						String name of fault
			"faultCode": 24,											Integer Fault code
            "totalDuration": 44619,										Integer duration of all fault sessions of this type during the query timeframe
            "count": 3													Integer number of fault sessions of this type during the query timeframe
        }
    ]
}
```

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
