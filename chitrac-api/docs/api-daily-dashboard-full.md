# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

[/api/alpha/analytics/daily-dashboard/full](#apialphaanalyticsdaily-dashboardfull)

[/api/alpha/analytics/daily-dashboard/daily-counts](#apialphaanalyticsdaily-dashboarddaily-counts)

[/api/alpha/analytics/daily-summary-dashboard](#apialphaanalyticsdaily-summary-dashboard)

## Daily Dashboard Routes

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

**Field Reference:**

**timeRange:**
- `start` (string) — ISO 8601 timestamp of window start
- `end` (string) — ISO 8601 timestamp of window end  
- `total` (string) — Formatted duration string (HH:MM:SS)

**machineStatus[]:**
- `serial` (integer) — Machine serial number
- `name` (string) — Machine name
- `runningMs` (integer) — Total running time in milliseconds
- `pausedMs` (integer) — Total paused time in milliseconds
- `faultedMs` (integer) — Total faulted time in milliseconds

**machineOee[]:**
- `serial` (integer) — Machine serial number
- `name` (string) — Machine name
- `oee` (float) — Overall Equipment Efficiency percentage

**itemHourlyStack:**
- `title` (string) — Chart title
- `data.hours[]` (string[]) — Array of ISO hour timestamps
- `data.operators` (object) — Item counts by hour, keyed by item name

**topOperators[]:**
- `id` (integer) — Operator ID
- `name` (string) — Operator full name
- `efficiency` (float) — Efficiency percentage
- `metrics.runtime.total` (integer) — Total runtime in milliseconds
- `metrics.runtime.formatted` (string) — Formatted runtime string
- `metrics.output.totalCount` (integer) — Total pieces processed
- `metrics.output.validCount` (integer) — Valid pieces processed
- `metrics.output.misfeedCount` (integer) — Misfeed pieces

**plantwideMetrics[]:**
- `hour` (integer) — Hour of day (0-23)
- `availability` (float) — Plantwide availability percentage
- `efficiency` (float) — Plantwide efficiency percentage
- `throughput` (float) — Plantwide throughput percentage
- `oee` (float) — Plantwide OEE percentage

**dailyCounts[]:**
- `date` (string) — Date in YYYY-MM-DD format
- `count` (integer) — Total count for that date

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
