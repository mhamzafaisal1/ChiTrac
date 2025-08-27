# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

[/api/alpha/analytics/daily-dashboard/full](#apialphaanalyticsdaily-dashboardfull)

[/api/alpha/analytics/daily-dashboard/daily-counts](#apialphaanalyticsdaily-dashboarddaily-counts)

[/api/alpha/analytics/daily-summary-dashboard](#apialphaanalyticsdaily-summary-dashboard)

## Daily Summary Dashboard Route

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
      },
      "itemSummary": {
        "sessions": [
          {
            "start": "2025-05-01T12:00:00.000Z",			ISO timestamp of session start
            "end": "2025-05-01T12:30:00.000Z",				ISO timestamp of session end
            "workedTimeMs": 1800000,							Integer worked time in milliseconds
            "workedTimeFormatted": "00:30:00",				String formatted worked time
            "items": [
              {
                "itemId": 4,									Integer item ID
                "name": "Pool Towel",							String item name
                "countTotal": 210,							Integer total count for this session
                "standard": 625,								Integer item standard PPH
                "pph": 504,									Integer actual PPH achieved
                "efficiency": 80.64							Float efficiency percentage
              }
            ]
          }
        ],
        "machineSummary": {
          "totalCount": 520,									Integer total count across all sessions
          "workedTimeMs": 3600000,							Integer total worked time in milliseconds
          "workedTimeFormatted": "01:00:00",					String formatted total worked time
          "pph": 520,										Integer overall PPH achieved
          "proratedStandard": 610.5,							Float weighted average standard PPH
          "efficiency": 85.2,								Float overall efficiency percentage
          "itemSummaries": {
            "4": {
              "name": "Pool Towel",							String item name
              "standard": 625,								Integer item standard PPH
              "countTotal": 360,								Integer total count for this item
              "workedTimeFormatted": "00:40:00",				String formatted worked time for this item
              "pph": 540,									Integer PPH achieved for this item
              "efficiency": 86.4								Float efficiency percentage for this item
            }
          }
        }
      },
      "itemHourlyStack": {
        "title": "Item Counts by Hour",						String chart title
        "data": {
          "hours": ["12:00", "13:00", "14:00"],				Array of hour labels
          "operators": {										Object keyed by item name
            "Pool Towel": [120, 135, 98],					Array of counts per hour
            "Bath Towel": [45, 67, 89]
          }
        }
      },
      "faultData": {
        "faultCycles": [
          {
            "faultType": "Feeder Right Inlet Jam",			String fault type name
            "faultCode": 24,									Integer fault code
            "start": "2025-05-01T12:56:38.199Z",			ISO timestamp of fault start
            "states": [
              {
                "timestamp": "2025-05-01T12:56:38.199Z",	ISO timestamp of state change
                "machine": {
                  "serial": 67808,							Integer machine serial
                  "name": "SPF1"								String machine name
                },
                "program": {
                  "mode": "largePiece"						String program mode
                },
                "operators": [
                  {
                    "id": 117811,							Integer operator ID
                    "station": 1								Integer station number
                  }
                ],
                "status": {
                  "code": 141,								Integer status code
                  "name": "Feeder Right Inlet Jam"			String status name
                }
              }
            ],
            "end": "2025-05-01T12:56:58.797Z",				ISO timestamp of fault end
            "duration": 20598									Integer duration in milliseconds
          }
        ],
        "faultSummaries": [
          {
            "faultType": "Feeder Right Inlet Jam",			String fault type name
            "faultCode": 24,									Integer fault code
            "totalDuration": 44619,							Integer total duration in milliseconds
            "count": 3										Integer number of occurrences
          }
        ]
      },
      "operatorEfficiency": [
        {
          "operatorId": 117811,								Integer operator ID
          "operatorName": "Shaun White",						String operator name
          "machineSerial": 67808,							Integer machine serial
          "machineName": "SPF1",								String machine name
          "session": {
            "start": "2025-05-01T12:17:00.000Z",			ISO timestamp of session start
            "end": "2025-05-01T12:46:30.000Z"				ISO timestamp of session end
          },
          "metrics": {
            "workedTimeMs": 1770000,							Integer worked time in milliseconds
            "workedTimeFormatted": "00:29:30",				String formatted worked time
            "totalCount": 124,								Integer total count processed
            "validCount": 122,								Integer valid count processed
            "misfeedCount": 2,								Integer misfeed count
            "efficiencyPct": 92.15							Float efficiency percentage
          }
        }
      ]
    }
  ],
  "operatorResults": [
    {
      "operator": {
        "id": 117811,										Integer operator ID
        "name": "Shaun White"								String operator full name
      },
      "currentStatus": {
        "code": 1,											Integer status code
        "name": "Running"									String status name
      },
      "metrics": {
        "runtime": {
          "total": 14400000,									Integer total runtime in milliseconds
          "formatted": "04:00:00"							String formatted runtime
        },
        "performance": {
          "efficiency": {
            "value": 0.92,									Float efficiency ratio (0-1)
            "percentage": 92.0								Float efficiency percentage
          }
        }
      },
      "countByItem": [
        {
          "itemName": "Pool Towel",							String item name
          "count": 1240,									Integer count for this item
          "percentage": 85.5									Float percentage of total count
        }
      ]
    }
  ],
  "items": [
    {
      "itemName": "Pool Towel",								String item name
      "workedTimeFormatted": "03:45:00",						String formatted worked time
      "count": 1240,										Integer total count
      "pph": 330.67,										Float pieces per hour achieved
      "standard": 625,										Integer standard PPH
      "efficiency": 52.91									Float efficiency percentage
    }
  ]
}
```

**Field Reference:**

**timeRange:**
- `start` (string) — ISO 8601 timestamp of window start
- `end` (string) — ISO 8601 timestamp of window end
- `total` (string) — Formatted query execution time (HH:MM:SS)

**machineResults[]:**
- `machine.serial` (integer) — Machine serial number
- `machine.name` (string) — Machine name
- `currentStatus.code` (integer) — Status code (1=running, 0=paused, other=fault)
- `currentStatus.name` (string) — Status name
- `performance.runtime.total` (integer) — Total runtime in milliseconds
- `performance.runtime.formatted` (string) — Formatted runtime string
- `performance.availability.value` (float) — Availability ratio (0-1)
- `performance.availability.percentage` (float) — Availability percentage
- `performance.efficiency.value` (float) — Efficiency ratio (0-1)
- `performance.efficiency.percentage` (float) — Efficiency percentage
- `performance.throughput.value` (float) — Throughput ratio (0-1)
- `performance.throughput.percentage` (float) — Throughput percentage
- `performance.oee.value` (float) — OEE ratio (0-1)
- `performance.oee.percentage` (float) — OEE percentage

**itemSummary.sessions[]:**
- `start, end` (string) — ISO timestamps for session bounds
- `workedTimeMs` (integer) — Worked time in milliseconds
- `workedTimeFormatted` (string) — Formatted worked time
- `items[].itemId` (integer) — Item ID
- `items[].name` (string) — Item name
- `items[].countTotal` (integer) — Count for this session
- `items[].standard` (integer) — Item standard PPH
- `items[].pph` (integer) — Actual PPH achieved
- `items[].efficiency` (float) — Efficiency percentage

**itemSummary.machineSummary:**
- `totalCount` (integer) — Total count across all sessions
- `workedTimeMs` (integer) — Total worked time in milliseconds
- `workedTimeFormatted` (string) — Formatted total worked time
- `pph` (integer) — Overall PPH achieved
- `proratedStandard` (float) — Weighted average standard PPH
- `efficiency` (float) — Overall efficiency percentage
- `itemSummaries` (object) — Per-item summaries keyed by item ID

**faultData.faultCycles[]:**
- `faultType` (string) — Fault type name
- `faultCode` (integer) — Fault code
- `start, end` (string) — ISO timestamps for fault bounds
- `duration` (integer) — Fault duration in milliseconds
- `states[]` (array) — Array of fault state snapshots

**faultData.faultSummaries[]:**
- `faultType` (string) — Fault type name
- `faultCode` (integer) — Fault code
- `totalDuration` (integer) — Total duration in milliseconds
- `count` (integer) — Number of occurrences

**operatorEfficiency[]:**
- `operatorId` (integer) — Operator ID
- `operatorName` (string) — Operator name
- `machineSerial` (integer) — Machine serial
- `machineName` (string) — Machine name
- `session.start, end` (string) — Session bounds
- `metrics.workedTimeMs` (integer) — Worked time in milliseconds
- `metrics.workedTimeFormatted` (string) — Formatted worked time
- `metrics.totalCount` (integer) — Total count processed
- `metrics.validCount` (integer) — Valid count processed
- `metrics.misfeedCount` (integer) — Misfeed count
- `metrics.efficiencyPct` (float) — Efficiency percentage

**operatorResults[]:**
- `operator.id` (integer) — Operator ID
- `operator.name` (string) — Operator name
- `currentStatus.code` (integer) — Status code
- `currentStatus.name` (string) — Status name
- `metrics.runtime.total` (integer) — Total runtime in milliseconds
- `metrics.runtime.formatted` (string) — Formatted runtime
- `metrics.performance.efficiency.value` (float) — Efficiency ratio (0-1)
- `metrics.performance.efficiency.percentage` (float) — Efficiency percentage
- `countByItem[].itemName` (string) — Item name
- `countByItem[].count` (integer) — Count for this item
- `countByItem[].percentage` (float) — Percentage of total count

**items[]:**
- `itemName` (string) — Item name
- `workedTimeFormatted` (string) — Formatted worked time
- `count` (integer) — Total count
- `pph` (float) — Pieces per hour achieved
- `standard` (integer) — Standard PPH
- `efficiency` (float) — Efficiency percentage

**Example Request:**
```
GET /api/alpha/analytics/daily-summary-dashboard?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z
```

**Example Request with Machine Filter:**
```
GET /api/alpha/analytics/daily-summary-dashboard?start=2025-05-01T12:00:00.000Z&end=2025-05-01T18:00:00.000Z&serial=67808
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
