# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

/api/alpha/analytics/machine-item-sessions-summary

Returns per‑machine item performance for sessions overlapping a window. Each machine includes the clipped session slices in the window and an aggregate “machineSummary”, with prorated standard and efficiency computed from item mix.

Method: GET
Auth: Same as other /api/alpha routes
Idempotent: Yes

Query Parameters
Label	Type	Required	Description
start	ISO 8601 timestamp (UTC)	Yes	Window start (inclusive).
end	ISO 8601 timestamp (UTC)	Yes	Window end (exclusive).
serial	Integer	No	If present, only include sessions for this machine serial.

Validation/behavior

start < end must hold.

Sessions where timestamps.end is missing are treated as ending at the request end.

A session contributes only if it overlaps [start,end).

Response

Array of per‑machine objects:

[
  {
    "machine": { "name": "SPF1", "serial": 67808 },
    "sessions": [
      {
        "start": "2025-05-01T12:00:00.000Z",
        "end":   "2025-05-01T12:30:00.000Z",
        "workedTimeMs": 1800000,
        "workedTimeFormatted": "00:30:00"
      }
      // ...one entry per overlapped slice
    ],
    "machineSummary": {
      "totalCount": 1240,
      "workedTimeMs": 14400000,
      "workedTimeFormatted": "04:00:00",
      "pph": 310,
      "proratedStandard": 355.5,
      "efficiency": 87.2,
      "itemSummaries": {
        "4": {
          "name": "Pool Towel",
          "standard": 625,
          "countTotal": 860,
          "workedTimeFormatted": "02:30:00",
          "pph": 344,
          "efficiency": 55.04
        },
        "7": {
          "name": "Sheets",
          "standard": 350,
          "countTotal": 380,
          "workedTimeFormatted": "01:30:00",
          "pph": 253.33,
          "efficiency": 72.38
        }
      }
    }
  }
]

Field reference

sessions[]

start, end — ISO strings of the overlap slice (session ∩ window).

workedTimeMs — slice duration × active stations (operators where id !== -1).

workedTimeFormatted — HH:MM:SS.

machineSummary

totalCount — sum of valid counts in the window (from per‑session, per‑item grouping).

workedTimeMs/Formated — sum of session slice worked times.

pph — totalCount / (workedTimeMs / 3_600_000).

proratedStandard — mix‑weighted average of item standards; weight = item.countTotal / totalCount.

efficiency — pph / proratedStandard × 100 (rounded to 2 decimals).

itemSummaries — map keyed by itemId with:

standard (PPH as stored; no sub‑60→PPH normalization in this route),

countTotal in window,

workedTimeFormatted,

pph and efficiency (= pph / standard × 100).

Computation notes

Overlap: For each machine‑session, the route computes ovStart = max(session.start, start) and ovEnd = min(session.end||end, end). Non‑overlaps are skipped.

Worked time: sliceMs × activeStations (station count inferred from operators[] where id !== -1).

Counts: The aggregation filters counts[] in Mongo to [start,end], then groups by item.id. Sessions without counts still contribute worked time.

Proration: None needed for counts (already window‑filtered). Worked time is slice‑based.

Multi‑machine: When serial is omitted, the array may include multiple machines.

Examples
GET /api/alpha/analytics/machine-item-sessions-summary?start=2025-05-01T12:00:00Z&end=2025-05-01T16:00:00Z&serial=67808

Errors

500
{"error":"Failed to generate machine item summary"}