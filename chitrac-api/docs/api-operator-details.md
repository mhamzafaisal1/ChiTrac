/api/alpha/analytics/operator-details

Returns a full, multi‑tab detail payload for a single operator over a time window, optionally scoped to a machine. Designed for an operator “details” view: item production, hourly mix, cycle breakdown, fault history, and daily efficiency.

Method: GET
Auth: Same as other /api/alpha routes
Idempotent: Yes

Query Parameters
Label	Type	Required	Description
start	ISO 8601 timestamp (UTC)	Yes	Window start (inclusive).
end	ISO 8601 timestamp (UTC)	Yes	Window end (exclusive).
operatorId	Integer	Yes	Operator ID to fetch.
serial	Integer	No	Restrict analytics to a specific machine serial.
tz	IANA TZ string	No	Timezone for daily bucketing; default: "America/Chicago".
Validation

start, end, operatorId are required.

operatorId must be numeric.

If provided, serial must be numeric.

start < end must hold.

Response Shape
{
  "itemSummary": [
    {
      "operatorName": "Lilliana Ashca",
      "machineSerial": 67808,
      "machineName": "SPF1",
      "itemName": "Pool Towel",
      "count": 124,
      "misfeed": 0,
      "standard": 625,
      "valid": 124,
      "pph": 520,
      "efficiency": 83.2,
      "workedTimeFormatted": "00:14:18"
    }
    // ...more rows (one per (session×item) overlap)
  ],
  "countByItem": {
    "title": "Operator Counts by item",
    "data": {
      "hours": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
      "operators": {
        "Pool Towel":  [0,0,0,0,0,0,0,0,12,18,24,22,20,15,8,0,0,0,0,0,0,0,0,0],
        "Bath Towel":  [0,0,0,0,0,0,0,0, 0, 2, 8,14,10, 6,3,0,0,0,0,0,0,0,0,0]
        // key = itemName; value = 24-length array of valid counts in each hour of the day
      }
    }
  },
  "cyclePie": {
    "title": "Operator Cycle Breakdown",
    "slices": [
      { "label": "Running", "value": 62.5 },
      { "label": "Ready",   "value": 22.1 },
      { "label": "Down",    "value": 15.4 }
    ],
    "units": "percent"
  },
  "faultHistory": {
    "faultCycles": [
      {
        "faultType": "Feeder Right Inlet Jam",
        "faultCode": 24,
        "start": "2025-05-01T12:56:38.199Z",
        "end": "2025-05-01T12:56:58.797Z",
        "duration": 20598,
        "machineName": "SPF1",
        "machineSerial": 67808,
        "operatorName": "Lilliana Ashca",
        "operatorId": 135790,
        "states": [
          {
            "timestamp": "2025-05-01T12:56:38.199Z",
            "machine": { "serial": 67808, "name": "SPF1" },
            "program": { "mode": "largePiece" },
            "operators": [{ "id": 135790, "station": 1 }],
            "status": { "code": 141, "name": "Feeder Right Inlet Jam" }
          }
        ]
      }
    ],
    "faultSummaries": [
      {
        "faultType": "Feeder Right Inlet Jam",
        "faultCode": 24,
        "totalDuration": 44619,
        "count": 3,
        "formatted": { "hours": 0, "minutes": 0, "seconds": 44 }
      }
    ]
  },
  "dailyEfficiency": {
    "operator": { "id": 135790, "name": "Lilliana Ashca" },
    "timeRange": {
      "start": "2025-04-26T00:00:00.000Z",
      "end": "2025-05-02T23:59:59.999Z",
      "totalDays": 7
    },
    "data": [
      { "date": "2025-04-26", "efficiency": 78.12 },
      { "date": "2025-04-27", "efficiency": 81.44 },
      { "date": "2025-04-28", "efficiency": 76.03 }
      // ... one row per day in TZ buckets
    ]
  }
}


Field presence notes:
• machineSerial/machineName in itemSummary are drawn from each item-session’s machine (helpful when not scoping to a single machine).
• cyclePie and faultHistory depend on state availability in the window.

Field Reference
itemSummary[] (operator‑focused item sessions, truncated to the window)

Flattened rows derived from item-sessions where this operator was present and overlapping [start,end):

Field	Type	Description
operatorName	string	Resolved from latest operator-session; fallback Operator <operatorId>.
machineSerial, machineName	integer, string	Machine attributed to that overlapped item-session.
itemName	string	Item name.
count	integer	Pieces attributed to the operator in the overlapped sub-interval. If per-count operator attribution exists, only those with operator.id == operatorId are included; else pro‑rated by overlap share.
misfeed	integer	Always 0 in this array (valid pieces only).
standard	number	Item standard as stored (PPH; if 0<standard<60, treated as PPM and converted to PPH internally).
valid	integer	Equal to count (valid pieces).
pph	number	Pieces per hour in overlapped sub-interval.
efficiency	number	(pph / standardPPH) × 100, rounded to 2 decimals.
workedTimeFormatted	string	HH:MM:SS worked time attributed to the operator in the sub-interval.

Attribution rules:
• If counts[] exist and are reasonably sized (≤ 50k), counts are filtered by timestamp, item, and operator.id.
• Otherwise, totalCount is pro‑rated by the overlap factor (session∩window).

countByItem

Hourly valid-piece mix for the operator, built from the count collection of the request’s start month.

title (string) — Always "Operator Counts by item".

data.hours (int[24]) — 0..23.

data.operators (object) — Map: itemName -> int[24] where each element is valid counts in that clock hour (UTC hour of the timestamp used).

cyclePie

High-level cycle distribution for the operator in the window (percentages).
Shape:

Field	Type	Description
title	string	Always "Operator Cycle Breakdown".
slices[]	array	Items like `{ label: "Running"
units	string	"percent".
faultHistory

Operator‑scoped fault episodes intersecting the window.

faultCycles[]: Each episode with start, end, duration (ms), fault metadata, snapshots (states[]), and echo of operator/machine identity.

faultSummaries[]: One per (faultType, faultCode) aggregate with totalDuration (ms), count, plus formatted H:M:S convenience.

dailyEfficiency

Daily (TZ‑aware) efficiency series computed from operator‑sessions overlapping the window. If the requested range is <7 days, a 7‑day window ending at end is enforced for continuity.

Field	Type	Description
operator	object	{ id, name }.
timeRange	object	{ start, end, totalDays } (ISO strings; TZ bucketing applied internally).
data[]	array	{ date: "yyyy-MM-dd", efficiency: number } per day in tz. Efficiency is (totalTimeCreditSec / workTimeSec) × 100 aggregated per day by proportional overlap.
Computation Details & Edge Cases

Overlap & Truncation: Any session [S,E] is truncated to [max(S,start), min(E or end, end)]. An overlap factor ov = overlappedSec / fullSec scales durations and (if needed) counts.

Standards Normalization: 0 < standard < 60 is treated as PPM and converted to PPH (×60) before efficiency.

Counts Preference: Timestamp‑filtering is preferred (precise); if counts[] is too large/missing, pro‑rate.

Worked Time Basis: Uses workTime seconds when present; otherwise runtime seconds (and, for item‑sessions, multiplied by active stations when needed).

Throughput in dailyEfficiencyByHour (internal): Computed but only efficiencyPct and throughputPct are returned in that hourly series object.

Zero Denominators: Any division by zero yields 0 (never NaN/Infinity).

Timezone: Daily buckets use tz (default "America/Chicago"). Hours in countByItem are from the count timestamps’ hour (0–23).

Example Request
GET /api/alpha/analytics/operator-details?operatorId=135790&start=2025-05-01T12:00:00.000Z&end=2025-05-01T14:00:00.000Z&serial=67808&tz=America/Chicago

Error Responses

400 Bad Request

{ "error": "start, end, and operatorId are required" }

{ "error": "operatorId must be a valid number" }


500 Internal Server Error

{ "error": "Failed to fetch operator details" }

Versioning & Stability

This route is Alpha; fields may be extended. Additions will be backward‑compatible (additive).

Semantics of existing fields are stable; any breaking change will be versioned under a new path.