/** When a state, count or session record was created. */
const recordTimestamp = (record) => record?.timestamps?.create;

/**
 * How much of a session [sStart, sEnd) falls inside the window [wStart, wEnd).
 * An open session (no sEnd) runs to the end of the window. A session with no
 * start contributes nothing. Seconds are returned because session totals are
 * stored in seconds; `factor` is the overlapping share of the whole session.
 */
function overlap(sStart, sEnd, wStart, wEnd) {
  if (!sStart) return { ovSec: 0, fullSec: 0, factor: 0, ovStart: wStart, ovEnd: wEnd };
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const factor = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor, ovStart: os, ovEnd: oe };
}

module.exports = { recordTimestamp, overlap };
