# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes


/api/alpha/analytics/operator-item-sessions-summary

Returns operator × machine × item rows for operator‑sessions overlapping the window, including valid counts, misfeeds, pph, and efficiency.

Method: GET
Auth: Same as other /api/alpha routes
Idempotent: Yes

Query Parameters
Label	Type	Required	Description
start	ISO 8601 timestamp (UTC)	Yes	Window start (inclusive).
end	ISO 8601 timestamp (UTC)	Yes	Window end (exclusive).
operatorId	Integer	No	Limit to a single operator. If omitted, returns rows for all operators active in window.

Validation/behavior

start < end must hold.

Sessions with no end are treated as ending at end.

A session contributes only if it overlaps [start,end).

Response

Array of rows (one per operator–machine–item observed in the window):

[
  {
    "operatorName": "Lilliana Ashca",
    "machineName": "SPF1",
    "itemName": "Pool Towel",
    "workedTimeFormatted": "01:15:00",
    "count": 420,
    "misfeed": 6,
    "pph": 336,
    "standard": 625,
    "efficiency": 53.76
  }
]

Field reference
Field	Type	Description
operatorName	string	From session.
machineName	string	Machine on which the operator session occurred.
workedTimeFormatted	string	Sum of operator‑session slice durations within window (HH:MM:SS).
count	int	Valid piece counts in window, filtered from counts[] by timestamp.
misfeed	int	Misfeeds in window, filtered from misfeeds[] by timestamp.
pph	number	count / (workedTimeMs / 3_600_000) for the operator on that machine/item.
standard	number	The item’s stored standard (PPH expected; no sub‑60 normalization here).
efficiency	number	(pph / standard) × 100 (rounded to 2 decimals).
Computation notes

Overlap: ovStart/ovEnd computed per operator‑session; slice length is sliceMs.

Worked time: For this route, an operator‑session represents operator run time; totalRunMs += sliceMs.

Filtering in Mongo: Both counts[] and misfeeds[] are filtered to [start,end] before summarizing.

Grouping: Aggregation key is operatorId + machineSerial; within each, counts grouped by item.id.

Defaults: If standard is missing/invalid, the code uses 666 as a fallback for efficiency math (document consumers should not rely on this sentinel).

Examples
GET /api/alpha/analytics/operator-item-sessions-summary?operatorId=135790&start=2025-05-01T12:00:00Z&end=2025-05-01T16:00:00Z

Errors

500
{"error":"Failed to generate operator item summary report"}