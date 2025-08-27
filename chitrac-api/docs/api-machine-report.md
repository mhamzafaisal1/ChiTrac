# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes


/api/alpha/analytics/item-sessions-summary

Returns an item‑centric summary across all active machines in the window, using item‑sessions and bookended machine running windows to avoid idle gaps. Each item includes total valid counts, worked time, PPH, standard, and efficiency.

Method: GET
Auth: Same as other /api/alpha routes
Idempotent: Yes

Query Parameters
Label	Type	Required	Description
start	ISO 8601 timestamp (UTC)	Yes	Window start (inclusive).
end	ISO 8601 timestamp (UTC)	Yes	Window end (exclusive).

Validation/behavior

If end is in the future, it is clamped to now.

Returns 416 if start >= end.

For each active machine, the route computes a bookended time range [sessionStart, sessionEnd] using state history, and only counts item‑sessions overlapping that machine’s bookended range.

Response

Array of item summaries:

[
  {
    "itemName": "Pool Towel",
    "workedTimeFormatted": "03:45:00",
    "count": 1240,
    "pph": 330.67,
    "standard": 625,
    "efficiency": 52.91
  }
]

Field reference
Field	Type	Description
itemName	string	Item name.
workedTimeFormatted	string	Sum of prorated worked time from overlapped item‑sessions (HH:MM:SS).
count	int	Valid counts in the window (from counts[] when feasible, else prorated from totalCount).
pph	number	count / (workedTimeMs / 3_600_000).
standard	number	Item standard (stored).
efficiency	number	(pph / normalizedStandardPPH) × 100, with PPM→PPH normalization. See below.
Computation details

Active machines only: machine.active == true via config collection.

Bookending: For each serial, getBookendedStatesAndTimeRange yields [sessionStart, sessionEnd]. Only item‑sessions overlapping this range are considered.

Overlap per session:
ovStart = max(itemSession.start, sessionStart)
ovEnd = min(itemSession.end||sessionEnd, sessionEnd)
ovFrac = overlappedSec / fullSessionSec.

Worked time per session: Prefer workTime (seconds). Else use runtime × activeStations (inferred from operators[], excluding id === -1). Multiply by ovFrac.

Counts per session:

If counts[] present and length ≤ 50,000: filter by timestamp and (when present) by item.id.

Else, if totalCount present: prorate as round(totalCount × ovFrac).

Standard normalization:
This route converts sub‑60 standards to PPH (assumed PPM) via:
normalizedPPH = (standard > 0 && standard < 60) ? standard * 60 : standard.

Efficiency: efficiency = (pph / normalizedPPH) × 100 (rounded to 2 decimals).

Zero guards: Non‑finite values are treated as 0.

Examples
GET /api/alpha/analytics/item-sessions-summary?start=2025-05-01T12:00:00Z&end=2025-05-01T18:00:00Z

Errors

416
{"error":"start must be before end"}

500
{"error":"Failed to generate item summary report"}

Versioning

All three routes are Alpha and may add fields (backward‑compatible).

Existing semantics are stable; breaking changes will be versioned under a new path.