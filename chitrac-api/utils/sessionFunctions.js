/**
 * Functions for session data (running, paused, fault) not specific to dashboards or reports.

 *
 * Extracted from controllers/alpha/efficiencyScreenSessionRoute.js
 */

const config = require('../modules/config');

/* ==========================================================================
 *  Shared utility
 * ========================================================================== */

/**
 * Round a number to two decimal places.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ==========================================================================
 *  Operator efficiency helpers
 * ========================================================================== */

/**
 * Projection object for operator-session queries used by the efficiency screen.
 * @returns {object} MongoDB projection document
 */
function projectSessionForPerf() {
  return {
    timestamps: 1,
    items: 1,
    machine: 1,
    operator: 1,
    counts: 1
  };
}

/**
 * Query all four time windows in parallel for a single operator.
 * @param {import('mongodb').Db} db   - Mongo database handle
 * @param {number} serialNum          - Machine serial number
 * @param {*} operatorId              - Operator identifier
 * @param {object} frames             - Object with lastSixMinutes, lastFifteenMinutes, lastHour, today (each with .start)
 * @param {object} logger             - Logger instance (e.g. server.logger)
 * @returns {Promise<object>}         - { lastSixMinutes, lastFifteenMinutes, lastHour, today } arrays of session docs
 */
async function queryOperatorTimeframes(db, serialNum, operatorId, frames, logger) {
  const queryStartTime = Date.now();
  const coll = db.collection(config.operatorSessionCollectionName);
  const nowJs = new Date();

  // Build the overlap filter template: (start < now) AND (end >= windowStart OR end missing)
  // Support both machine.serial and machine.id for backward compatibility
  const buildFilter = (windowStart) => ({
    'operator.id': operatorId,
    $and: [
      {
        $or: [
          { 'machine.serial': serialNum },
          { 'machine.id': serialNum }
        ]
      },
      {
        'timestamps.start': { $lt: nowJs },
        $or: [
          { 'timestamps.end': { $exists: false } },
          { 'timestamps.end': { $gte: new Date(windowStart.toISO()) } }
        ]
      }
    ]
  });

  try {
    console.log(`[PERF] [${serialNum}] Operator ${operatorId} - Starting 4 parallel session queries (no limit/timeout)...`);
    const parallelQueryStartTime = Date.now();

    const [six, fifteen, hour, today] = await Promise.all([
      coll.find(buildFilter(frames.lastSixMinutes.start), projectSessionForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
      coll.find(buildFilter(frames.lastFifteenMinutes.start), projectSessionForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
      coll.find(buildFilter(frames.lastHour.start), projectSessionForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
      coll.find(buildFilter(frames.today.start), projectSessionForPerf()).sort({ 'timestamps.start': -1 }).toArray()
    ]);

    console.log(`[PERF] [${serialNum}] Operator ${operatorId} - All 4 session queries completed in ${Date.now() - parallelQueryStartTime}ms (results: 6min=${six.length}, 15min=${fifteen.length}, 1hr=${hour.length}, today=${today.length})`);

    return {
      lastSixMinutes: six,
      lastFifteenMinutes: fifteen,
      lastHour: hour,
      today
    };
  } catch (err) {
    console.error(`[PERF] [${serialNum}] Operator ${operatorId} - Query error after ${Date.now() - queryStartTime}ms:`, err.message);
    logger.error('[queryOperatorTimeframes] Query error:', err);
    // Return empty results on timeout
    return {
      lastSixMinutes: [],
      lastFifteenMinutes: [],
      lastHour: [],
      today: []
    };
  }
}

/**
 * Extract valid (non-misfeed) counts from embedded session counts for a given time window.
 * @param {Array} sessions    - Array of session documents
 * @param {Date} windowStart  - JS Date for window start
 * @param {Date} windowEnd    - JS Date for window end
 * @param {*} operatorId      - Operator identifier
 * @param {number} serialNum  - Machine serial number
 * @returns {Array}           - Array of count documents within the window
 */
function extractCountsFromSessions(sessions, windowStart, windowEnd, operatorId, serialNum) {
  const counts = [];

  for (const session of sessions) {
    if (!session) continue;

    // Handle both array format and object format for counts
    let sessionCounts = [];
    if (Array.isArray(session.counts)) {
      sessionCounts = session.counts;
    } else if (session.counts && Array.isArray(session.counts.valid)) {
      sessionCounts = session.counts.valid;
    }

    for (const count of sessionCounts) {
      if (!count || count.misfeed === true) continue;

      // Get timestamp from count (support multiple formats)
      const ts = count.timestamps?.create || count.timestamp;
      if (!ts) continue;

      const countTime = new Date(ts);
      if (countTime < windowStart || countTime > windowEnd) continue;

      // Verify operator and machine match
      const countOpId = count.operator?.id;
      const countMachineSerial = count.machine?.serial || count.machine?.id;

      if (countOpId === operatorId && countMachineSerial === serialNum) {
        counts.push(count);
      }
    }
  }

  return counts;
}

/**
 * Get valid and misfeed counts in window for OEE throughput (operator-sessions).
 * Handles session.counts as array (each c may have c.misfeed) or { valid: [], misfeed: [] }.
 * @param {Array} sessions    - Array of session documents
 * @param {Date} windowStart  - JS Date for window start
 * @param {Date} windowEnd    - JS Date for window end
 * @param {*} operatorId      - Operator identifier
 * @param {number} serialNum  - Machine serial number
 * @returns {{ validCount: number, misfeedCount: number }}
 */
function getValidAndMisfeedCountsInWindow(sessions, windowStart, windowEnd, operatorId, serialNum) {
  let validCount = 0;
  let misfeedCount = 0;

  const inWindow = (c) => {
    if (!c) return false;
    const ts = c.timestamps?.create || c.timestamp;
    if (!ts) return false;
    const t = new Date(ts);
    if (t < windowStart || t > windowEnd) return false;
    const countOpId = c.operator?.id;
    const countMachineSerial = c.machine?.serial ?? c.machine?.id;
    if (countOpId != null && countOpId != operatorId) return false;
    if (countMachineSerial != null && countMachineSerial != serialNum) return false;
    return true;
  };

  for (const session of sessions) {
    if (!session) continue;
    if (Array.isArray(session.counts)) {
      for (const c of session.counts) {
        if (!inWindow(c)) continue;
        if (c.misfeed === true) misfeedCount++; else validCount++;
      }
    } else if (session.counts && typeof session.counts === 'object') {
      const v = session.counts.valid || [];
      const m = session.counts.misfeed || [];
      for (const c of v) { if (inWindow(c)) validCount++; }
      for (const c of m) { if (inWindow(c)) misfeedCount++; }
    }
  }
  return { validCount, misfeedCount };
}

/**
 * Sum runtime + time credit for a given window across an array of operator sessions.
 * Uses counts extracted from session documents (faster than querying count collection).
 * @param {Array} sessions           - Array of session documents
 * @param {Array} counts             - Array of count documents (pre-extracted)
 * @param {import('luxon').DateTime} windowStartDT - Luxon DateTime for window start
 * @param {import('luxon').DateTime} windowEndDT   - Luxon DateTime for window end
 * @returns {{ runtimeSec: number, totalTimeCreditSec: number }}
 */
function sumWindowWithCounts(sessions, counts, windowStartDT, windowEndDT) {
  const windowStart = new Date(windowStartDT.toISO());
  const windowEnd = new Date(windowEndDT.toISO());

  let runtimeSec = 0;
  let totalTimeCreditSec = 0;

  // Calculate runtime from sessions
  for (const s of sessions) {
    const sStart = new Date(s.timestamps.start);
    const sEnd = s.timestamps.end ? new Date(s.timestamps.end) : windowEnd;

    const effStart = sStart < windowStart ? windowStart : sStart;  // truncate first session if needed
    const effEnd = sEnd > windowEnd ? windowEnd : sEnd;

    if (effEnd <= effStart) continue;

    runtimeSec += (effEnd - effStart) / 1000;
  }

  // Filter counts to only those within the window (already filtered but double-check)
  const inWindowCounts = counts.filter(c => {
    if (!c) return false;
    const ts = c.timestamps?.create || c.timestamp;
    if (!ts) return false;
    const t = new Date(ts);
    return t >= windowStart && t <= windowEnd;
  });

  totalTimeCreditSec = calculateTotalTimeCredit(inWindowCounts);

  return { runtimeSec: Math.round(runtimeSec), totalTimeCreditSec: totalTimeCreditSec };
}

/**
 * Resolve batch item name string from the most recent operator session (concatenate with " + " if multiple).
 * @param {import('mongodb').Db} db   - Mongo database handle
 * @param {number} serialNum          - Machine serial number
 * @param {*} operatorId              - Operator identifier
 * @returns {Promise<string>}         - Item name(s) joined by " + "
 */
async function resolveBatchItemFromSessions(db, serialNum, operatorId) {
  const coll = db.collection(config.operatorSessionCollectionName);
  // Prefer the most recent open session; else latest any session
  const session =
    (await coll.findOne(
      { 'operator.id': operatorId, 'machine.serial': serialNum, 'timestamps.end': { $exists: false } },
      { sort: { 'timestamps.start': -1 }, projection: { items: 1 } }
    )) ||
    (await coll.findOne(
      { 'operator.id': operatorId, 'machine.serial': serialNum },
      { sort: { 'timestamps.start': -1 }, projection: { items: 1 } }
    ));

  const names = new Set(
    (session?.items || [])
      .map(it => it?.name)
      .filter(Boolean)
  );

  return [...names].join(' + ');
}

/**
 * Build a zeroed efficiency map (for non-running statuses).
 * @returns {object} Efficiency payload with all windows at 0
 */
function buildZeroEfficiencyPayload() {
  return {
    lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'yellow' },
    lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'yellow' },
    lastHour: { value: 0, label: 'Last Hour', color: 'yellow' },
    today: { value: 0, label: 'All Day', color: 'yellow' }
  };
}

/**
 * Format seconds as "Xh Ym Zs" for Elapsed Time display (non-running state).
 * @param {number} totalSec - Total elapsed seconds
 * @returns {string}
 */
function formatElapsedDisplay(totalSec) {
  if (totalSec <= 0) return '0s';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Calculate total time credit (in seconds) from an array of count records,
 * grouping by item and applying the standard-rate formula.
 * @param {Array} countRecords - Array of count documents with item.id and item.standard
 * @returns {number}           - Total time credit in seconds (rounded to 2 decimals)
 */
function calculateTotalTimeCredit(countRecords) {
  if (!Array.isArray(countRecords) || countRecords.length === 0) return 0;

  const byItem = {};
  for (const r of countRecords) {
    const it = r.item || {};
    const key = `${it.id}`;
    if (!byItem[key]) byItem[key] = { count: 0, standard: Number(it.standard) || 0 };
    byItem[key].count += 1;
  }

  let total = 0;
  for (const { count, standard } of Object.values(byItem)) {
    const perHour = standard > 0 && standard < 60 ? standard * 60 : standard; // treat <60 as PPM
    if (perHour > 0) {
      total += count / (perHour / 3600); // seconds of time credit
    }
  }
  return round2(total);
}

/* ==========================================================================
 *  Machine efficiency helpers
 * ========================================================================== */

/**
 * Projection object for machine-session queries used by the efficiency screen.
 * @returns {object} MongoDB projection document
 */
function projectMachineForPerf() {
  return {
    timestamps: 1,
    items: 1,
    machine: 1,
    // Use session-embedded counts to avoid double-counting across operators
    counts: 1
  };
}

/**
 * Query all four time windows in parallel for machine-level sessions.
 * @param {import('mongodb').Db} db   - Mongo database handle
 * @param {number} serialNum          - Machine serial number
 * @param {object} frames             - Object with lastSixMinutes, lastFifteenMinutes, lastHour, today (each with .start)
 * @returns {Promise<object>}         - { lastSixMinutes, lastFifteenMinutes, lastHour, today } arrays of session docs
 */
async function queryMachineTimeframes(db, serialNum, frames) {
  const coll = db.collection(config.machineSessionCollectionName || 'machine-session');
  const nowJs = new Date();

  // Support both machine.id and machine.serial for backward compatibility
  const buildFilter = (windowStart) => ({
    $and: [
      {
        $or: [
          { 'machine.id': serialNum },
          { 'machine.serial': serialNum }
        ]
      },
      {
        'timestamps.start': { $lt: nowJs }, // started before now
        $or: [
          { 'timestamps.end': { $exists: false } },                // still open
          { 'timestamps.end': { $gte: new Date(windowStart.toISO()) } } // or overlaps window
        ]
      }
    ]
  });

  const [six, fifteen, hour, today] = await Promise.all([
    coll.find(buildFilter(frames.lastSixMinutes.start), projectMachineForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
    coll.find(buildFilter(frames.lastFifteenMinutes.start), projectMachineForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
    coll.find(buildFilter(frames.lastHour.start), projectMachineForPerf()).sort({ 'timestamps.start': 1 }).toArray(),
    coll.find(buildFilter(frames.today.start), projectMachineForPerf()).sort({ 'timestamps.start': 1 }).toArray()
  ]);

  return {
    lastSixMinutes: six,
    lastFifteenMinutes: fifteen,
    lastHour: hour,
    today
  };
}

/**
 * Sum runtime, time credit, valid counts, and misfeed counts for a given window
 * across an array of machine sessions.
 * @param {Array} sessions           - Array of machine-session documents
 * @param {import('luxon').DateTime} windowStartDT - Luxon DateTime for window start
 * @param {import('luxon').DateTime} windowEndDT   - Luxon DateTime for window end
 * @returns {{ runtimeSec: number, timeCreditSec: number, validCount: number, misfeedCount: number }}
 */
function sumWindowMachine(sessions, windowStartDT, windowEndDT) {
  const windowStart = new Date(windowStartDT.toISO());
  const windowEnd = new Date(windowEndDT.toISO());

  let runtimeSec = 0;
  let timeCreditSec = 0;
  let validCount = 0;
  let misfeedCount = 0;

  for (const s of sessions) {
    const sStart = new Date(s.timestamps.start);
    const sEnd = s.timestamps.end ? new Date(s.timestamps.end) : windowEnd;

    const effStart = sStart < windowStart ? windowStart : sStart;
    const effEnd = sEnd > windowEnd ? windowEnd : sEnd;
    if (effEnd <= effStart) continue;

    // Machine runtime in window. Machine-sessions are non-overlapping, so no double count.
    runtimeSec += (effEnd - effStart) / 1000;

    // Handle both old format (counts as array) and new format (counts.valid / counts.misfeed)
    let allCounts = [];
    if (Array.isArray(s.counts)) {
      allCounts = s.counts;
    } else if (s.counts && typeof s.counts === 'object') {
      const v = s.counts.valid || [];
      const mRaw = s.counts.misfeed || [];
      const m = mRaw.map(c => (c && typeof c === 'object' ? { ...c, misfeed: true } : null)).filter(Boolean);
      allCounts = [...v, ...m];
    }

    // In-window valid counts (for time credit and throughput)
    // Filter by actual window boundaries, not session boundaries
    const inWindowValid = allCounts.filter(c => {
      if (!c) return false;
      const ts = c.timestamp || c.timestamps?.create;
      if (!ts) return false;
      const t = new Date(ts);
      return t >= windowStart && t <= windowEnd && !c.misfeed;
    });
    timeCreditSec += calcTimeCredit(inWindowValid);
    validCount += inWindowValid.length;

    // In-window misfeed counts (for throughput)
    // Filter by actual window boundaries, not session boundaries
    const inWindowMisfeed = allCounts.filter(c => {
      if (!c) return false;
      const ts = c.timestamp || c.timestamps?.create;
      if (!ts) return false;
      const t = new Date(ts);
      return t >= windowStart && t <= windowEnd && !!c.misfeed;
    });
    misfeedCount += inWindowMisfeed.length;
  }

  return {
    runtimeSec: Math.round(runtimeSec),
    timeCreditSec: round2(timeCreditSec),
    validCount,
    misfeedCount
  };
}

/**
 * Calculate time credit from an array of count documents (machine-level variant).
 * Same formula as calculateTotalTimeCredit but uses shorter variable names.
 * @param {Array} counts - Array of count documents
 * @returns {number}     - Time credit in seconds (not rounded)
 */
function calcTimeCredit(counts) {
  if (!Array.isArray(counts) || counts.length === 0) return 0;
  const byItem = {};
  for (const r of counts) {
    const it = r.item || {};
    const key = `${it.id}`;
    if (!byItem[key]) byItem[key] = { n: 0, std: Number(it.standard) || 0 };
    byItem[key].n += 1;
  }
  let total = 0;
  for (const { n, std } of Object.values(byItem)) {
    const perHour = std > 0 && std < 60 ? std * 60 : std; // treat <60 as PPM
    if (perHour > 0) total += n / (perHour / 3600); // seconds
  }
  return total;
}

/**
 * Build a zeroed efficiency map (machine-level alias for buildZeroEfficiencyPayload).
 * @returns {object} Efficiency payload with all windows at 0
 */
function zeroEff() {
  return {
    lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'yellow' },
    lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'yellow' },
    lastHour: { value: 0, label: 'Last Hour', color: 'yellow' },
    today: { value: 0, label: 'All Day', color: 'yellow' }
  };
}

/* ==========================================================================
 *  Exports
 * ========================================================================== */

module.exports = {
  // Shared
  round2,

  // Operator efficiency helpers
  projectSessionForPerf,
  queryOperatorTimeframes,
  extractCountsFromSessions,
  getValidAndMisfeedCountsInWindow,
  sumWindowWithCounts,
  resolveBatchItemFromSessions,
  buildZeroEfficiencyPayload,
  formatElapsedDisplay,
  calculateTotalTimeCredit,

  // Machine efficiency helpers
  projectMachineForPerf,
  queryMachineTimeframes,
  sumWindowMachine,
  calcTimeCredit,
  zeroEff
};
