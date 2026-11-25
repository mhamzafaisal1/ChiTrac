'use strict';

/**
 * Effective end time of a fault session that has not closed yet
 * (timestamps.end null or missing).
 *
 * The datafeed refreshes timestamps.update on every status event it processes
 * for the open session. A session that is still being reported on therefore
 * runs up to the end of the requested range ("now" for live views). One that
 * has not been updated for OPEN_FAULT_SESSION_STALE_MS is treated as orphaned
 * (for example after a crash) and capped at last update + that window, so it
 * cannot grow into a 10+ hour phantom fault.
 *
 * The JavaScript and MongoDB versions below must stay equivalent: they are used
 * by the dashboard cache, the machine modal and the fault history/report APIs.
 */
const OPEN_FAULT_SESSION_STALE_MS = 5 * 60 * 1000;

function toDate(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function effectiveFaultSessionEnd(session, rangeEnd) {
  const storedEnd = toDate(session?.timestamps?.end);
  if (storedEnd) return storedEnd;

  const start = toDate(session?.timestamps?.start);
  if (!start) return null;
  const update = toDate(session?.timestamps?.update);
  const lastSeen = update && update > start ? update : start;
  const staleCap = new Date(lastSeen.getTime() + OPEN_FAULT_SESSION_STALE_MS);
  const end = toDate(rangeEnd);
  return end && end < staleCap ? end : staleCap;
}

function effectiveFaultSessionEndExpression(rangeEnd) {
  return {
    $ifNull: [
      "$timestamps.end",
      {
        $min: [
          {
            $add: [
              { $max: ["$timestamps.start", { $ifNull: ["$timestamps.update", "$timestamps.start"] }] },
              OPEN_FAULT_SESSION_STALE_MS,
            ],
          },
          rangeEnd,
        ],
      },
    ],
  };
}

module.exports = {
  OPEN_FAULT_SESSION_STALE_MS,
  effectiveFaultSessionEnd,
  effectiveFaultSessionEndExpression,
};
