# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

/api/alpha/analytics/machine-details

Returns a full, multi-tab detail payload for a single machine over a time window, suitable for a dashboard “details” drawer/page. The response includes:

Current Operators (latest operator-session rows for operators on this machine)

Item Summary (item-level production & efficiency, prorated across mixed items)

Performance by Hour (hourly Availability / Throughput / Efficiency / OEE + per‑operator efficiency in-slot)

Fault Data (if available; bookended to the active time range)

Method: GET
Auth: Same as other /api/alpha routes
Idempotent: Yes

Query Parameters
Label	Type	Required	Description
start	ISO 8601 timestamp (UTC)	Yes	Window start (inclusive).
end	ISO 8601 timestamp (UTC)	Yes	Window end (exclusive).
serial	Integer	Yes	Machine serial to fetch details for.
Validation & General Rules

start and end must parse as valid dates and satisfy start < end; otherwise a 400 is returned.

serial must be present and numeric; otherwise a 400 is returned.

When computing in-window metrics, sessions are overlap‑matched to the window and truncated to the overlapped portion before aggregations.

Response Shape
{
  "machine": {
    "serial": 67808,
    "name": "SPF1"
  },
  "tabs": {
    "currentOperators": [
      {
        "operatorId": 117811,
        "operatorName": "Shaun White",
        "machineSerial": 67808,
        "machineName": "SPF1",
        "session": {
          "start": "2025-05-01T12:17:00.000Z",
          "end": "2025-05-01T12:46:30.000Z"
        },
        "metrics": {
          "workedTimeMs": 1770000,
          "workedTimeFormatted": "00:29:30",
          "totalCount": 124,
          "validCount": 122,
          "misfeedCount": 2,
          "efficiencyPct": 92.15
        }
      }
    ],
    "itemSummary": {
      "sessions": [
        {
          "start": "2025-05-01T12:00:00.000Z",
          "end": "2025-05-01T12:30:00.000Z",
          "workedTimeMs": 1500000,
          "workedTimeFormatted": "00:25:00",
          "items": [
            {
              "itemId": 4,
              "name": "Pool Towel",
              "countTotal": 210,
              "standard": 625,
              "pph": 504,
              "efficiency": 80.64
            }
          ]
        }
      ],
      "machineSummary": {
        "totalCount": 520,
        "workedTimeMs": 3600000,
        "workedTimeFormatted": "01:00:00",
        "pph": 520,
        "proratedStandard": 610.5,
        "efficiency": 85.2,
        "itemSummaries": {
          "4": {
            "name": "Pool Towel",
            "standard": 625,
            "countTotal": 360,
            "workedTimeFormatted": "00:40:00",
            "pph": 540,
            "efficiency": 86.4
          },
          "5": {
            "name": "Bath Towel",
            "standard": 600,
            "countTotal": 160,
            "workedTimeFormatted": "00:20:00",
            "pph": 480,
            "efficiency": 80
          }
        }
      }
    },
    "performanceByHour": [
      {
        "hourStart": "2025-05-01T12:00:00.000Z",
        "hourEnd": "2025-05-01T12:59:59.999Z",
        "machine": {
          "availabilityPct": 72.5,
          "efficiencyPct": 88.1,
          "throughputPct": 98.3,
          "oeePct": 62.9
        },
        "operators": [
          { "id": 117811, "name": "Shaun White", "efficiency": 91.2 },
          { "id": 118347, "name": "Hannah Teter", "efficiency": 85.7 }
        ]
      }
    ]
  },
  "faultData": {
    "faultCycles": [
      {
        "faultType": "Feeder Right Inlet Jam",
        "faultCode": 24,
        "start": "2025-05-01T12:56:38.199Z",
        "states": [
          {
            "timestamp": "2025-05-01T12:56:38.199Z",
            "machine": { "serial": 67808, "name": "SPF1" },
            "program": { "mode": "largePiece" },
            "operators": [
              { "id": 117811, "station": 1 },
              { "id": -1, "station": 2 }
            ],
            "status": { "code": 141, "name": "Feeder Right Inlet Jam" }
          }
        ],
        "end": "2025-05-01T12:56:58.797Z",
        "duration": 20598
      }
    ],
    "faultSummaries": [
      { "faultType": "Feeder Right Inlet Jam", "faultCode": 24, "totalDuration": 44619, "count": 3 }
    ]
  }
}


Note: faultData is included only when fault states are available for the bookended time span. If none are present, the faultData property is omitted.

Field Reference
Top-level

machine.serial (integer) — Machine serial.

machine.name (string) — Resolved from latest machine-session; falls back to "Serial <serial>" if unavailable.

tabs.currentOperators[]

Derived from the most recent operator-session per operator on this machine (latest by timestamps.start):

Field	Type	Description
operatorId	integer	Operator ID (dummy/inactive IDs such as -1 are excluded).
operatorName	string	From operator-session ("Unknown" fallback).
machineSerial, machineName	integer, string	Echo the host machine for this operator-session.
session.start, session.end	ISO timestamp	Raw operator-session bounds.
metrics.workedTimeMs	number (ms)	Total worked time (seconds from session, converted to ms).
metrics.workedTimeFormatted	string	HH:MM:SS formatting of worked time.
metrics.totalCount	integer	valid + misfeed.
metrics.validCount	integer	Valid pieces.
metrics.misfeedCount	integer	Misfeeds.
metrics.efficiencyPct	number	(totalTimeCreditSec / workTimeSec) × 100, rounded to 2 decimals.
tabs.itemSummary

Sessions come from item-sessions overlapping the window and are truncated to the overlapped portion before calculating counts and times.

Per-session rows:

start, end — ISO strings for overlapped sub-interval.

workedTimeMs, workedTimeFormatted — Worked time within sub-interval.

items[] — One entry per dominant item in that sub-interval:

itemId, name — Item identity.

countTotal — Counts within the overlapped sub-interval.

standard — Item standard (as stored; see normalization below).

pph — Production rate (pieces per hour) in sub-interval.

efficiency — (pph / standardPPH) × 100, rounded to 2 decimals.

machineSummary:

totalCount — Sum of valid counts across all overlapped item-sessions.

workedTimeMs, workedTimeFormatted — Total worked time (ms & formatted) across overlapped item-sessions.

pph — totalCount / totalHours.

proratedStandard — Weighted average standard PPH across items (weights = item share of valid counts).

efficiency — (pph / proratedStandard) × 100, rounded to 2 decimals.

itemSummaries — Map keyed by itemId with:

name, standard

countTotal

workedTimeFormatted

pph, efficiency

Standards normalization: If an item standard is 0 < standard < 60, it is treated as pieces per minute, then converted to PPH by multiplying by 60.

Counts selection:

If counts[] are present and not excessively large (≤ 50,000), counts are filtered by timestamp to the overlapped window.

Otherwise, totalCount is pro‑rated by the overlap factor.

tabs.performanceByHour[]

For each hourly slot spanning [start, end] (inclusive hours), the route aggregates both machine-sessions and operator-sessions that overlap the slot, truncates them to the hour, and computes:

machine.availabilityPct — (runtimeSec / 3600) × 100

machine.efficiencyPct — (timeCreditSec / workSec) × 100

machine.throughputPct — (valid / (valid + mis)) × 100

machine.oeePct — availability × efficiency × throughput × 100

Operator panel for the hour:

operators[] with { id, name, efficiency } where efficiency = (creditSec / workSec) × 100 based on that operator’s operator-sessions truncated to the hour.

faultData (optional)

If bookended machine states are available in the window, a fault block is included with:

faultCycles[] — Each discrete fault episode:

faultType (string), faultCode (integer)

start, end (ISO strings), duration (ms)

states[] — Raw state snapshots during the cycle (timestamp, machine, program, operators[], status)

faultSummaries[] — Per fault type (code): totalDuration (ms), count (episodes)

This schema matches the History › Faults response your docs already define for /api/history/machine/faults.

Computation Details & Edge Cases

Overlap/Truncation: For any session [S, E] vs. window [Wₛ, Wₑ], the overlapped sub-interval is [max(S, Wₛ), min(E or Wₑ, Wₑ)] with overlap factor ov = overlappedSec / fullSec. All duration and count fields are either filtered by timestamps (preferred) or scaled by ov when filtering is not possible.

Worked Time: When explicit workTime is present, it is used; otherwise, runtime × activeStations is used for item-sessions.

Active Stations: Operators with id !== -1 are treated as active.

Throughput: valid / (valid + misfeeds). If denominator is zero, result is 0.

Division by Zero: Any metric with a zero denominator resolves to 0 (not NaN/Infinity).

Large Count Arrays: If counts[] is extremely large, the implementation falls back to pro‑rating (totalCount × overlapFactor) to avoid heavy scanning.

Example Request
GET /api/alpha/analytics/machine-details?serial=67808&start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z

Error Responses

400 Bad Request

Missing/invalid dates, start >= end, or missing serial.

{ "error": "serial is required" }

{ "error": "Start date must be before end date" }


500 Internal Server Error

{ "error": "Failed to fetch machine details" }

Versioning & Stability

Route path and response shape are Alpha and may evolve.

New fields will be additive; existing fields will maintain types and semantics.