// --- SPL Efficiency Screen API (sessions-powered) ---

const express = require('express');
const { DateTime } = require('luxon');

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const config = require('../../modules/config');

  router.get('/analytics/machine-live-session-summary', async (req, res) => {
  const routeStartTime = Date.now();
  
  try {
    const { serial, date } = req.query;
    if (!serial || !date) {
      return res.status(400).json({ error: 'Missing serial or date' });
    }

    const serialNum = Number(serial);
    console.log(`[PERF] [${serialNum}] Route START - machine-live-session-summary`);
    console.log(`[PERF] [${serialNum}] Fetching ticker...`);
    const tickerStartTime = Date.now();
    
    const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
      .findOne(
        { 'machine.id': serialNum },
        {
          projection: {
            timestamp: 1,
            machine: 1,
            program: 1,
            status: 1,
            operators: 1
          }
        }
      );
    
    console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

    // No ticker: Offline - but still return flipperData structure
    if (!ticker) {
      // Fetch machine configuration to get machine name
      const machineConfig = await db.collection('machines').findOne(
        { serial: serialNum },
        { projection: { name: 1 } }
      );

      const machineName = machineConfig?.name || `Serial ${serialNum}`;

      // Return a single offline lane entry for full-height display
      const offlineLanes = [{
        status: -1,
        fault: 'Offline',
        operator: null,
        operatorId: null,
        machine: machineName,
        timers: { on: 0, ready: 0 },
        displayTimers: { on: '', run: '' },
        efficiency: buildZeroEfficiencyPayload(),
        oee: {},
        batch: { item: '', code: 0 }
      }];

      return res.json({ flipperData: offlineLanes });
    }

    // Build list of active operators from ticker (skip dummies; preserve existing station 2 skip for 67801/67802)
    const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
      .filter(op => op && op.id !== -1)
      .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));
    
    // Status schema uses 'id', but legacy code used 'code' - support both
    const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
    console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

    // If machine is NOT running, mirror existing route behavior by returning entries with 0% efficiency
    // (we still include operator/machine/batch info for the screen to render cleanly)
    if (statusCode !== 1) {
      console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
      const notRunningStartTime = Date.now();
      const coll = db.collection(config.operatorSessionCollectionName);
      const machineFilter = { $or: [{ 'machine.serial': serialNum }, { 'machine.id': serialNum }] };

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op, idx) => {
          // Elapsed from session start (machines may not emit ticker when paused/faulted)
          const session =
            (await coll.findOne(
              { 'operator.id': op.id, ...machineFilter, 'timestamps.end': { $exists: false } },
              { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
            )) ||
            (await coll.findOne(
              { 'operator.id': op.id, ...machineFilter },
              { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
            ));
          const sessionStart = session?.timestamps?.start;
          const startDate = sessionStart ? (sessionStart instanceof Date ? sessionStart : new Date(sessionStart)) : null;
          const elapsedInStateSec = startDate
            ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000))
            : 0;
          const elapsedDisplay = formatElapsedDisplay(elapsedInStateSec);

          const batchItem = (session?.items || [])
            .map(it => it?.name)
            .filter(Boolean);
          const batchItemStr = [...new Set(batchItem)].join(' + ');

          const operatorName = op.name?.first && op.name?.surname
            ? `${op.name.first} ${op.name.surname}`
            : (op.name || 'Unknown');
          return {
            status: ticker.status?.code ?? 0,
            fault: ticker.status?.name ?? 'Unknown',
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: elapsedInStateSec, ready: 0 },
            displayTimers: { on: elapsedDisplay, run: elapsedDisplay },
            efficiency: buildZeroEfficiencyPayload(),
            // keep the field to match the existing response shape; values not required in the new flow
            oee: {},
            batch: { item: batchItemStr, code: 10000001 }
          };
        })
      );

      console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
      // Back-compat: preserve existing top-level shape/key
      return res.json({ flipperData: performanceData });
    }

    // Running: compute performance from operator-sessions over four windows
    console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators`);
    const runningStartTime = Date.now();
    
    const now = DateTime.now();
    const frames = {
      lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
      lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
      lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
      today: { start: now.startOf('day'), label: 'All Day' }
    };

    const performanceData = await Promise.all(
      onMachineOperators.map(async (op, idx) => {
        const operatorStartTime = Date.now();
        console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);
        
        // Run the four timeframe queries in parallel
        const timeframeQueryStartTime = Date.now();
        const results = await queryOperatorTimeframes(db, serialNum, op.id, frames);
        console.log(`[PERF] [${serialNum}] Operator ${op.id} timeframe queries completed in ${Date.now() - timeframeQueryStartTime}ms`);

        // Debug: Log session counts
        console.log(`[PERF] [${serialNum}] Operator ${op.id}: sessions - 6min=${results.lastSixMinutes.length}, 15min=${results.lastFifteenMinutes.length}, 1hr=${results.lastHour.length}, today=${results.today.length}`);

        // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
        const hasEmpty = Object.values(results).some(arr => arr.length === 0);

        if (hasEmpty) {
          console.log(`[PERF] [${serialNum}] Operator ${op.id} has empty timeframes - fetching open session`);
          const openSessionStartTime = Date.now();
          
          // Try both machine.serial and machine.id
          const open = await db.collection(config.operatorSessionCollectionName)
            .findOne(
              {
                'operator.id': op.id,
                $or: [
                  { 'machine.serial': serialNum },
                  { 'machine.id': serialNum }
                ],
                'timestamps.end': { $exists: false }
              },
              { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
            );
          console.log(`[PERF] [${serialNum}] Operator ${op.id} open session query completed in ${Date.now() - openSessionStartTime}ms`);
          
          if (open) {
            for (const k of Object.keys(results)) results[k] = [open];
          }
        }

        // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
        console.log(`[PERF] [${serialNum}] Operator ${op.id} starting efficiency calculations for 4 timeframes`);
        const efficiencyCalcStartTime = Date.now();
        const efficiencyObj = {};
        
        for (const [key, arr] of Object.entries(results)) {
          const windowStartTime = Date.now();
          const { start, label } = frames[key];
          console.log(`[PERF] [${serialNum}] Operator ${op.id} processing window: ${key}`);
          
          // Extract counts from embedded session counts instead of querying count collection
          const windowStart = new Date(start.toISO());
          const windowEnd = new Date(now.toISO());
          
          const countExtractStartTime = Date.now();
          const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
          console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - extracted ${counts.length} counts from sessions in ${Date.now() - countExtractStartTime}ms`);
          
          const sumWindowStartTime = Date.now();
          const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
          const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
          console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - sumWindowWithCounts completed in ${Date.now() - sumWindowStartTime}ms (runtime=${runtimeSec}s, timeCredit=${totalTimeCreditSec}s, eff=${Math.round(eff * 100)}%)`);
          
          efficiencyObj[key] = {
            value: Math.round(eff * 100),
            label,
            color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
          };
          
          console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} TOTAL time: ${Date.now() - windowStartTime}ms`);
        }
        
        console.log(`[PERF] [${serialNum}] Operator ${op.id} efficiency calculations completed in ${Date.now() - efficiencyCalcStartTime}ms`);

        // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
        const batchItemStartTime = Date.now();
        const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
        console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
        
        const operatorTotalTime = Date.now() - operatorStartTime;
        console.log(`[PERF] [${serialNum}] Operator ${op.id} COMPLETED - Total time: ${operatorTotalTime}ms`);

        const operatorName = op.name?.first && op.name?.surname
          ? `${op.name.first} ${op.name.surname}`
          : (op.name || 'Unknown');

        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
        return {
          status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
          fault: ticker.status?.name ?? 'Unknown',
          operator: operatorName,
          operatorId: op.id,
          machine: ticker.machine?.name || `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: efficiencyObj,
          // keep the field to match the existing response shape; not required for the new flow
          oee: {},
          batch: { item: batchItem, code: 10000001 }
        };
      })
    );

    console.log(`[PERF] [${serialNum}] Running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
    
    // Back-compat: preserve existing top-level shape/key
    return res.json({ flipperData: performanceData });
  } catch (err) {
    console.error(`[PERF] [${serialNum || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  });

  /* -------------------------- helpers (local) -------------------------- */

// Projection for operator-session queries used by this route
  function projectSessionForPerf() {
    return {
      timestamps: 1,
      items: 1,
      machine: 1,
      operator: 1,
      counts: 1
    };
  }

// Query all four time windows in parallel for a single operator
  async function queryOperatorTimeframes(db, serialNum, operatorId, frames) {
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

// Extract counts from embedded session counts for a given time window
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

// Get valid and misfeed counts in window for OEE throughput (operator-sessions).
// Handles session.counts as array (each c may have c.misfeed) or { valid: [], misfeed: [] }.
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

// Sum runtime + time credit for a given window across an array of sessions
// Uses counts extracted from session documents (faster than querying count collection)
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

// Resolve batch item name string (concatenate with " + " if multiple)
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

// Build a zeroed efficiency map (for non-running statuses)
  function buildZeroEfficiencyPayload() {
    return {
      lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'yellow' },
      lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'yellow' },
      lastHour: { value: 0, label: 'Last Hour', color: 'yellow' },
      today: { value: 0, label: 'All Day', color: 'yellow' }
    };
  }

// Format seconds as "Xh Ym Zs" for Elapsed Time display (non-running state)
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

// ---- time-credit helpers (same math used elsewhere) ----
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

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // end of helper functions ----

  // end of route ----

  // --- Daily Machine Live Session Summary API (sessions + totals-daily) ---

  // router.get('/analytics/daily/machine-live-session-summary', async (req, res) => {
  //   const routeStartTime = Date.now();
    
  //   try {
  //     const { serial } = req.query;
  //     if (!serial) {
  //       return res.status(400).json({ error: 'Missing serial' });
  //     }

  //     const serialNum = Number(serial);
  //     console.log(`[PERF] [${serialNum}] Route START - daily/machine-live-session-summary`);
  //     console.log(`[PERF] [${serialNum}] Fetching ticker...`);
  //     const tickerStartTime = Date.now();
      
  //     const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
  //       .findOne(
  //         { 'machine.id': serialNum },
  //         {
  //           projection: {
  //             timestamp: 1,
  //             machine: 1,
  //             program: 1,
  //             status: 1,
  //             operators: 1
  //           }
  //         }
  //       );
      
  //     console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

  //     // No ticker: Offline - but still return flipperData structure
  //     if (!ticker) {
  //       // Fetch machine configuration to get machine name
  //       const machineConfig = await db.collection('machines').findOne(
  //         { serial: serialNum },
  //         { projection: { name: 1 } }
  //       );

  //       const machineName = machineConfig?.name || `Serial ${serialNum}`;

  //       // Return a single offline lane entry for full-height display
  //       const offlineLanes = [{
  //         status: -1,
  //         fault: 'Offline',
  //         operator: null,
  //         operatorId: null,
  //         machine: machineName,
  //         timers: { on: 0, ready: 0 },
  //         displayTimers: { on: '', run: '' },
  //         efficiency: buildZeroEfficiencyPayload(),
  //         oee: buildZeroEfficiencyPayload(),
  //         batch: { item: '', code: 0 }
  //       }];

  //       return res.json({ flipperData: offlineLanes });
  //     }

  //     // Build list of active operators from ticker (skip dummies; preserve existing station 2 skip for 67801/67802)
  //     const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
  //       .filter(op => op && op.id !== -1)
  //       .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));
      
  //     // Status schema uses 'id', but legacy code used 'code' - support both
  //     const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
  //     console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

  //     // Get today's date string for totals-daily query
  //     const now = DateTime.now();
  //     const todayDateStr = now.toFormat('yyyy-MM-dd');

  //     // If machine is NOT running, mirror existing route behavior by returning entries with 0% efficiency
  //     // (we still include operator/machine/batch info for the screen to render cleanly)
  //     if (statusCode !== 1) {
  //       console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
  //       const notRunningStartTime = Date.now();
        
  //       const performanceData = await Promise.all(
  //         onMachineOperators.map(async (op, idx) => {
  //           const batchItemStartTime = Date.now();
  //           const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
  //           const operatorName = op.name?.first && op.name?.surname
  //             ? `${op.name.first} ${op.name.surname}`
  //             : (op.name || 'Unknown');
  //           return {
  //             status: statusCode, // Use 'code' in API response for backward compatibility
  //             fault: ticker.status?.name ?? 'Unknown',
  //             operator: operatorName,
  //             operatorId: op.id,
  //             machine: ticker.machine?.name || `Serial ${serialNum}`,
  //             timers: { on: 0, ready: 0 },
  //             displayTimers: { on: '', run: '' },
  //             efficiency: buildZeroEfficiencyPayload(),
  //             oee: buildZeroEfficiencyPayload(),
  //             batch: { item: batchItem, code: 10000001 }
  //           };
  //         })
  //       );

  //       console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
  //       return res.json({ flipperData: performanceData });
  //     }

  //     // Running: compute performance from operator-sessions for short windows, totals-daily for today
  //     console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators`);
  //     const runningStartTime = Date.now();
      
  //     // Define time frames for short windows (today will come from totals-daily)
  //     const shortFrames = {
  //       lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
  //       lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
  //       lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' }
  //     };

  //     // Fetch all daily totals for this machine and today in one query
  //     const dailyTotalsStartTime = Date.now();
  //     const dailyTotalsColl = db.collection('totals-daily');
  //     const dailyTotals = await dailyTotalsColl.find({
  //       entityType: 'operator-machine',
  //       machineSerial: serialNum,
  //       date: todayDateStr
  //     }).toArray();
  //     console.log(`[PERF] [${serialNum}] Daily totals query completed in ${Date.now() - dailyTotalsStartTime}ms (found ${dailyTotals.length} records)`);

  //     // Create a map for quick lookup: operatorId -> daily total
  //     const dailyTotalsMap = new Map();
  //     for (const total of dailyTotals) {
  //       if (total.operatorId) {
  //         dailyTotalsMap.set(total.operatorId, total);
  //       }
  //     }

  //     const performanceData = await Promise.all(
  //       onMachineOperators.map(async (op, idx) => {
  //         const operatorStartTime = Date.now();
  //         console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);
          
  //         // Calculate short windows (6 min, 15 min, 1 hour) from operator-sessions
  //         const shortFramesWithToday = {
  //           ...shortFrames,
  //           today: { start: now.startOf('day'), label: 'All Day' }
  //         };
          
  //         const timeframeQueryStartTime = Date.now();
  //         const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday);
  //         console.log(`[PERF] [${serialNum}] Operator ${op.id} timeframe queries completed in ${Date.now() - timeframeQueryStartTime}ms`);

  //         // If ANY short timeframe came back empty, fetch most recent OPEN session and use it for all frames
  //         const hasEmpty = Object.values({
  //           lastSixMinutes: results.lastSixMinutes,
  //           lastFifteenMinutes: results.lastFifteenMinutes,
  //           lastHour: results.lastHour
  //         }).some(arr => arr.length === 0);

  //         if (hasEmpty) {
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} has empty short timeframes - fetching open session`);
  //           const openSessionStartTime = Date.now();
            
  //           const open = await db.collection(config.operatorSessionCollectionName)
  //             .findOne(
  //               {
  //                 'operator.id': op.id,
  //                 $or: [
  //                   { 'machine.serial': serialNum },
  //                   { 'machine.id': serialNum }
  //                 ],
  //                 'timestamps.end': { $exists: false }
  //               },
  //               { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
  //             );
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} open session query completed in ${Date.now() - openSessionStartTime}ms`);
            
  //           if (open) {
  //             results.lastSixMinutes = [open];
  //             results.lastFifteenMinutes = [open];
  //             results.lastHour = [open];
  //           }
  //         }

  //         // Compute efficiency% and OEE for short windows from sessions
  //         console.log(`[PERF] [${serialNum}] Operator ${op.id} starting efficiency and OEE calculations for short windows`);
  //         const efficiencyCalcStartTime = Date.now();
  //         const efficiencyObj = {};
  //         const oeeObj = {};
          
  //         // Process short windows (6 min, 15 min, 1 hour) from sessions
  //         for (const [key, arr] of Object.entries({
  //           lastSixMinutes: results.lastSixMinutes,
  //           lastFifteenMinutes: results.lastFifteenMinutes,
  //           lastHour: results.lastHour
  //         })) {
  //           const windowStartTime = Date.now();
  //           const { start, label } = shortFrames[key];
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} processing window: ${key}`);
            
  //           const windowStart = new Date(start.toISO());
  //           const windowEnd = new Date(now.toISO());
            
  //           const countExtractStartTime = Date.now();
  //           const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - extracted ${counts.length} counts from sessions in ${Date.now() - countExtractStartTime}ms`);
            
  //           const sumWindowStartTime = Date.now();
  //           const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
  //           const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - sumWindowWithCounts completed in ${Date.now() - sumWindowStartTime}ms (runtime=${runtimeSec}s, timeCredit=${totalTimeCreditSec}s, eff=${Math.round(eff * 100)}%)`);
            
  //           efficiencyObj[key] = {
  //             value: Math.round(eff * 100),
  //             label,
  //             color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
  //           };

  //           // OEE = availability * efficiency * throughput
  //           const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(arr, windowStart, windowEnd, op.id, serialNum);
  //           const windowSec = (now.toMillis() - start.toMillis()) / 1000;
  //           const availability = windowSec > 0 ? runtimeSec / windowSec : 0;
  //           const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
  //           const throughput = (validCount + misfeedCount) > 0 ? validCount / (validCount + misfeedCount) : 0;
  //           const oeeVal = availability * efficiencyRatio * throughput;
  //           const oeePct = Math.round(oeeVal * 100);
  //           oeeObj[key] = { value: oeePct, label, color: oeeVal >= 0.9 ? 'green' : oeeVal >= 0.7 ? 'orange' : 'yellow' };
            
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} TOTAL time: ${Date.now() - windowStartTime}ms`);
  //         }

  //         // Get today's efficiency and OEE from totals-daily
  //         const dailyTotal = dailyTotalsMap.get(op.id);
  //         let todayEfficiency = 0;
  //         let todayOee = 0;
          
  //         if (dailyTotal && dailyTotal.runtimeMs > 0) {
  //           // Calculate efficiency from daily totals (both in milliseconds)
  //           const runtimeSec = dailyTotal.runtimeMs / 1000;
  //           const timeCreditSec = (dailyTotal.totalTimeCreditMs || 0) / 1000;
  //           todayEfficiency = timeCreditSec / runtimeSec;
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} today efficiency from daily totals: runtime=${runtimeSec}s, timeCredit=${timeCreditSec}s, eff=${Math.round(todayEfficiency * 100)}%`);

  //           // OEE for today: availability * efficiency * throughput
  //           const windowMs = now.toMillis() - now.startOf('day').toMillis();
  //           const availability = windowMs > 0 ? (dailyTotal.runtimeMs / windowMs) : 0;
  //           const efficiencyRatio = todayEfficiency;
  //           const totalCounts = dailyTotal.totalCounts || 0;
  //           const totalMisfeeds = dailyTotal.totalMisfeeds || 0;
  //           const throughput = (totalCounts + totalMisfeeds) > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
  //           todayOee = availability * efficiencyRatio * throughput;
  //         } else {
  //           console.log(`[PERF] [${serialNum}] Operator ${op.id} no daily total found or zero runtime, using 0% for today`);
  //         }

  //         efficiencyObj.today = {
  //           value: Math.round(todayEfficiency * 100),
  //           label: 'All Day',
  //           color: todayEfficiency >= 0.9 ? 'green' : todayEfficiency >= 0.7 ? 'orange' : 'yellow'
  //         };
  //         oeeObj.today = {
  //           value: Math.round(todayOee * 100),
  //           label: 'All Day',
  //           color: todayOee >= 0.9 ? 'green' : todayOee >= 0.7 ? 'orange' : 'yellow'
  //         };
          
  //         console.log(`[PERF] [${serialNum}] Operator ${op.id} efficiency and OEE calculations completed in ${Date.now() - efficiencyCalcStartTime}ms`);

  //         // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
  //         const batchItemStartTime = Date.now();
  //         const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
  //         console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
          
  //         const operatorTotalTime = Date.now() - operatorStartTime;
  //         console.log(`[PERF] [${serialNum}] Operator ${op.id} COMPLETED - Total time: ${operatorTotalTime}ms`);

  //         const operatorName = op.name?.first && op.name?.surname
  //           ? `${op.name.first} ${op.name.surname}`
  //           : (op.name || 'Unknown');

  //         // Status schema uses 'id', but legacy code used 'code' - support both
  //         const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
  //         return {
  //           status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
  //           fault: ticker.status?.name ?? 'Unknown',
  //           operator: operatorName,
  //           operatorId: op.id,
  //           machine: ticker.machine?.name || `Serial ${serialNum}`,
  //           timers: { on: 0, ready: 0 },
  //           displayTimers: { on: '', run: '' },
  //           efficiency: efficiencyObj,
  //           oee: oeeObj,
  //           batch: { item: batchItem, code: 10000001 }
  //         };
  //       })
  //     );

  //     console.log(`[PERF] [${serialNum}] Running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
      
  //     return res.json({ flipperData: performanceData });
  //   } catch (err) {
  //     console.error(`[PERF] [${serialNum || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
  //     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //     return res.status(500).json({ error: 'Internal server error' });
  //   }
  // });

  // --- Daily Machine Live Session Summary (sessions-only: operator-sessions for all windows, including all of today) ---

  router.get('/analytics/daily/machine-live-session-summary', async (req, res) => {
    const routeStartTime = Date.now();

    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: 'Missing serial' });
      }

      const serialNum = Number(serial);
      console.log(`[PERF] [${serialNum}] Route START - daily/machine-live-session-summary-sessions (sessions-only)`);
      const tickerStartTime = Date.now();

      const [ticker, latestFault] = await Promise.all([
        db.collection(config.stateTickerCollectionName || 'stateTicker').findOne(
          { 'machine.id': serialNum },
          {
            projection: {
              timestamp: 1,
              machine: 1,
              program: 1,
              status: 1,
              operators: 1
            }
          }
        ),
        db.collection(config.faultSessionCollectionName || 'fault-session').findOne(
          { $or: [{ 'machine.serial': serialNum }, { 'machine.id': serialNum }] },
          { sort: { 'timestamps.start': -1 }, projection: { 'timestamps.start': 1 } }
        )
      ]);

      console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

      const latestFaultStart = latestFault?.timestamps?.start
        ? (latestFault.timestamps.start instanceof Date
          ? latestFault.timestamps.start.toISOString()
          : latestFault.timestamps.start)
        : null;

      if (!ticker) {
        const machineConfig = await db.collection('machines').findOne(
          { serial: serialNum },
          { projection: { name: 1 } }
        );
        const machineName = machineConfig?.name || `Serial ${serialNum}`;
        const offlineLanes = [{
          status: -1,
          fault: 'Offline',
          operator: null,
          operatorId: null,
          machine: machineName,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: buildZeroEfficiencyPayload(),
          oee: buildZeroEfficiencyPayload(),
          batch: { item: '', code: 0 }
        }];
        return res.json({ flipperData: offlineLanes, latestFaultStart });
      }

      const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .filter(op => op && op.id !== -1)
        .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));

      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

      const now = DateTime.now();
      const todayDateStr = now.toFormat('yyyy-MM-dd');

      if (statusCode !== 1) {
        console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
        const notRunningStartTime = Date.now();
        const coll = db.collection(config.operatorSessionCollectionName);
        const machineFilter = { $or: [{ 'machine.serial': serialNum }, { 'machine.id': serialNum }] };

        const performanceData = await Promise.all(
          onMachineOperators.map(async (op) => {
            // Elapsed from session start (machines may not emit ticker when paused/faulted)
            const session =
              (await coll.findOne(
                { 'operator.id': op.id, ...machineFilter, 'timestamps.end': { $exists: false } },
                { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
              )) ||
              (await coll.findOne(
                { 'operator.id': op.id, ...machineFilter },
                { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
              ));
            const sessionStart = session?.timestamps?.start;
            const startDate = sessionStart ? (sessionStart instanceof Date ? sessionStart : new Date(sessionStart)) : null;
            const elapsedInStateSec = startDate
              ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000))
              : 0;
            const elapsedDisplay = formatElapsedDisplay(elapsedInStateSec);

            const batchItem = (session?.items || [])
              .map(it => it?.name)
              .filter(Boolean);
            const batchItemStr = [...new Set(batchItem)].join(' + ');

            const operatorName = op.name?.first && op.name?.surname
              ? `${op.name.first} ${op.name.surname}`
              : (op.name || 'Unknown');
            return {
              status: statusCode,
              fault: ticker.status?.name ?? 'Unknown',
              operator: operatorName,
              operatorId: op.id,
              machine: ticker.machine?.name || `Serial ${serialNum}`,
              timers: { on: elapsedInStateSec, ready: 0 },
              displayTimers: { on: elapsedDisplay, run: elapsedDisplay },
              efficiency: buildZeroEfficiencyPayload(),
              oee: buildZeroEfficiencyPayload(),
              batch: { item: batchItemStr, code: 10000001 }
            };
          })
        );
        console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
        return res.json({ flipperData: performanceData, latestFaultStart });
      }

      // Running: all windows from operator-sessions only; today uses all sessions for the day (no limit)
      console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators (sessions-only)`);
      const runningStartTime = Date.now();

      const shortFrames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
        lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
        today: { start: now.startOf('day'), label: 'All Day' }
      };

      const coll = db.collection(config.operatorSessionCollectionName);
      const nowJs = new Date();
      const startOfDayJs = new Date(shortFrames.today.start.toISO());

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op, idx) => {
          const operatorStartTime = Date.now();
          console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length}) - sessions-only`);

          // Short windows (6, 15, 60 min) via shared helper; today fetched separately with all sessions
          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFrames);

          // Fetch all of today's sessions for this operator (no limit)
          const todayFilter = {
            'operator.id': op.id,
            'timestamps.start': { $lt: nowJs },
            $and: [
              {
                $or: [
                  { 'machine.serial': serialNum },
                  { 'machine.id': serialNum }
                ]
              },
              {
                $or: [
                  { 'timestamps.end': { $exists: false } },
                  { 'timestamps.end': { $gte: startOfDayJs } }
                ]
              }
            ]
          };
          const todaySessionsStartTime = Date.now();
          const todaySessions = await coll
            .find(todayFilter, projectSessionForPerf())
            .sort({ 'timestamps.start': 1 })
            .toArray();
          console.log(`[PERF] [${serialNum}] Operator ${op.id} today sessions (all) completed in ${Date.now() - todaySessionsStartTime}ms (found ${todaySessions.length})`);
          results.today = todaySessions;

          // If any short timeframe is empty, use open session for short windows only (today stays as-is; empty => 0%)
          const hasEmptyShort = [results.lastSixMinutes, results.lastFifteenMinutes, results.lastHour].some(arr => arr.length === 0);
          if (hasEmptyShort) {
            const open = await coll.findOne(
              {
                'operator.id': op.id,
                $or: [
                  { 'machine.serial': serialNum },
                  { 'machine.id': serialNum }
                ],
                'timestamps.end': { $exists: false }
              },
              { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
            );
            if (open) {
              results.lastSixMinutes = [open];
              results.lastFifteenMinutes = [open];
              results.lastHour = [open];
            }
          }

          const efficiencyObj = {};
          const oeeObj = {};
          const framesToProcess = {
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour,
            today: results.today
          };

          for (const [key, arr] of Object.entries(framesToProcess)) {
            const { start, label } = shortFrames[key];
            const windowStart = new Date(start.toISO());
            const windowEnd = new Date(now.toISO());

            const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
            const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
            const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            efficiencyObj[key] = {
              value: Math.round(eff * 100),
              label,
              color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
            };

            const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(arr, windowStart, windowEnd, op.id, serialNum);
            const windowSec = (now.toMillis() - start.toMillis()) / 1000;
            const availability = windowSec > 0 ? runtimeSec / windowSec : 0;
            const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            const throughput = (validCount + misfeedCount) > 0 ? validCount / (validCount + misfeedCount) : 0;
            const oeeVal = availability * efficiencyRatio * throughput;
            oeeObj[key] = {
              value: Math.round(oeeVal * 100),
              label,
              color: oeeVal >= 0.9 ? 'green' : oeeVal >= 0.7 ? 'orange' : 'yellow'
            };
          }

          const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
          const operatorName = op.name?.first && op.name?.surname
            ? `${op.name.first} ${op.name.surname}`
            : (op.name || 'Unknown');
          const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;

          console.log(`[PERF] [${serialNum}] Operator ${op.id} COMPLETED in ${Date.now() - operatorStartTime}ms (sessions-only)`);

          return {
            status: statusCodeForResponse,
            fault: ticker.status?.name ?? 'Unknown',
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: '', run: '' },
            efficiency: efficiencyObj,
            oee: oeeObj,
            batch: { item: batchItem, code: 10000001 }
          };
        })
      );

      console.log(`[PERF] [${serialNum}] Running path (sessions-only) completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
      return res.json({ flipperData: performanceData, latestFaultStart });
    } catch (err) {
      const serialLabel = req.query.serial != null ? req.query.serial : 'unknown';
      console.error(`[PERF] [${serialLabel}] ERROR daily/machine-live-session-summary-sessions after ${Date.now() - routeStartTime}ms:`, err);
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Get SPF Machines API ---

  router.get('/machines/spf', async (req, res) => {
    try {
      const machines = await db.collection('machines')
        .find({
          $or: [
            { name: { $regex: /^SPF/i } },
            { type: 'SPF' }
          ],
          active: { $ne: false }
        })
        .project({ serial: 1, name: 1, active: 1 })
        .sort({ name: 1 })
        .toArray();
      
      return res.json(machines);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Machine-wide Efficiency Screen API (sessions-powered) ---


  router.get('/analytics/machine-live-session-summary/machine', async (req, res) => {
    const routeStartTime = Date.now();
    
    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: 'Missing serial' });
      }

      const serialNum = Number(serial);
      console.log(`[PERF] [${serialNum}] Route START - machine-live-session-summary/machine`);
      console.log(`[PERF] [${serialNum}] Fetching ticker...`);
      const tickerStartTime = Date.now();
      
      const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
        .findOne(
          { 'machine.id': serialNum },
          {
            projection: {
              timestamp: 1,
              machine: 1,
              program: 1,
              status: 1,
              operators: 1
            }
          }
        );
      
      console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

      // No ticker: Offline - but still return flipperData structure
      if (!ticker) {
        // Fetch machine configuration to get machine name
        const machineConfig = await db.collection('machines').findOne(
          { serial: serialNum },
          { projection: { name: 1 } }
        );

        const machineName = machineConfig?.name || `Serial ${serialNum}`;

        // Return a single offline lane entry for full-height display
        const offlineLanes = [{
          status: -1,
          fault: 'Offline',
          operator: null,
          operatorId: null,
          machine: machineName,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: buildZeroEfficiencyPayload(),
          oee: buildZeroEfficiencyPayload(),
          batch: { item: '', code: 0 }
        }];

        return res.json({ flipperData: offlineLanes });
      }

      // Build list of active operators from ticker (skip dummies; preserve existing station 2 skip for 67801/67802)
      const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .filter(op => op && op.id !== -1)
        .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));
      
      // Status schema uses 'id', but legacy code used 'code' - support both
      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

      // Get today's date string for totals-daily query
      const now = DateTime.now();
      const todayDateStr = now.toFormat('yyyy-MM-dd');

      // If machine is NOT running, mirror existing route behavior by returning entries with 0% efficiency
      // (we still include operator/machine/batch info for the screen to render cleanly)
      if (statusCode !== 1) {
        console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
        const notRunningStartTime = Date.now();
        
        const performanceData = await Promise.all(
          onMachineOperators.map(async (op, idx) => {
            const batchItemStartTime = Date.now();
            const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
            console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
            const operatorName = op.name?.first && op.name?.surname
              ? `${op.name.first} ${op.name.surname}`
              : (op.name || 'Unknown');
            return {
              status: statusCode, // Use 'code' in API response for backward compatibility
              fault: ticker.status?.name ?? 'Unknown',
              operator: operatorName,
              operatorId: op.id,
              machine: ticker.machine?.name || `Serial ${serialNum}`,
              timers: { on: 0, ready: 0 },
              displayTimers: { on: '', run: '' },
              efficiency: buildZeroEfficiencyPayload(),
              oee: buildZeroEfficiencyPayload(),
              batch: { item: batchItem, code: 10000001 }
            };
          })
        );

        console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
        return res.json({ flipperData: performanceData });
      }

      // Running: compute performance from operator-sessions for short windows, totals-daily for today
      console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators`);
      const runningStartTime = Date.now();
      
      // Define time frames for short windows (today will come from totals-daily)
      const shortFrames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
        lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' }
      };

      // Fetch all daily totals for this machine and today in one query
      const dailyTotalsStartTime = Date.now();
      const dailyTotalsColl = db.collection('totals-daily');
      const dailyTotals = await dailyTotalsColl.find({
        entityType: 'operator-machine',
        machineSerial: serialNum,
        date: todayDateStr
      }).toArray();
      console.log(`[PERF] [${serialNum}] Daily totals query completed in ${Date.now() - dailyTotalsStartTime}ms (found ${dailyTotals.length} records)`);

      // Create a map for quick lookup: operatorId -> daily total
      const dailyTotalsMap = new Map();
      for (const total of dailyTotals) {
        if (total.operatorId) {
          dailyTotalsMap.set(total.operatorId, total);
        }
      }

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op, idx) => {
          const operatorStartTime = Date.now();
          console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);
          
          // Calculate short windows (6 min, 15 min, 1 hour) from operator-sessions
          const shortFramesWithToday = {
            ...shortFrames,
            today: { start: now.startOf('day'), label: 'All Day' }
          };
          
          const timeframeQueryStartTime = Date.now();
          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday);
          console.log(`[PERF] [${serialNum}] Operator ${op.id} timeframe queries completed in ${Date.now() - timeframeQueryStartTime}ms`);

          // If ANY short timeframe came back empty, fetch most recent OPEN session and use it for all frames
          const hasEmpty = Object.values({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour
          }).some(arr => arr.length === 0);

          if (hasEmpty) {
            console.log(`[PERF] [${serialNum}] Operator ${op.id} has empty short timeframes - fetching open session`);
            const openSessionStartTime = Date.now();
            
            const open = await db.collection(config.operatorSessionCollectionName)
              .findOne(
                {
                  'operator.id': op.id,
                  $or: [
                    { 'machine.serial': serialNum },
                    { 'machine.id': serialNum }
                  ],
                  'timestamps.end': { $exists: false }
                },
                { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
              );
            console.log(`[PERF] [${serialNum}] Operator ${op.id} open session query completed in ${Date.now() - openSessionStartTime}ms`);
            
            if (open) {
              results.lastSixMinutes = [open];
              results.lastFifteenMinutes = [open];
              results.lastHour = [open];
            }
          }

          // Compute efficiency% and OEE for short windows from sessions
          console.log(`[PERF] [${serialNum}] Operator ${op.id} starting efficiency and OEE calculations for short windows`);
          const efficiencyCalcStartTime = Date.now();
          const efficiencyObj = {};
          const oeeObj = {};
          
          // Process short windows (6 min, 15 min, 1 hour) from sessions
          for (const [key, arr] of Object.entries({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour
          })) {
            const windowStartTime = Date.now();
            const { start, label } = shortFrames[key];
            console.log(`[PERF] [${serialNum}] Operator ${op.id} processing window: ${key}`);
            
            const windowStart = new Date(start.toISO());
            const windowEnd = new Date(now.toISO());
            
            const countExtractStartTime = Date.now();
            const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
            console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - extracted ${counts.length} counts from sessions in ${Date.now() - countExtractStartTime}ms`);
            
            const sumWindowStartTime = Date.now();
            const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
            const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - sumWindowWithCounts completed in ${Date.now() - sumWindowStartTime}ms (runtime=${runtimeSec}s, timeCredit=${totalTimeCreditSec}s, eff=${Math.round(eff * 100)}%)`);
            
            efficiencyObj[key] = {
              value: Math.round(eff * 100),
              label,
              color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
            };

            // OEE = availability * efficiency * throughput
            const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(arr, windowStart, windowEnd, op.id, serialNum);
            const windowSec = (now.toMillis() - start.toMillis()) / 1000;
            const availability = windowSec > 0 ? runtimeSec / windowSec : 0;
            const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            const throughput = (validCount + misfeedCount) > 0 ? validCount / (validCount + misfeedCount) : 0;
            const oeeVal = availability * efficiencyRatio * throughput;
            const oeePct = Math.round(oeeVal * 100);
            oeeObj[key] = { value: oeePct, label, color: oeeVal >= 0.9 ? 'green' : oeeVal >= 0.7 ? 'orange' : 'yellow' };
            
            console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} TOTAL time: ${Date.now() - windowStartTime}ms`);
          }

          // Get today's efficiency and OEE from totals-daily
          const dailyTotal = dailyTotalsMap.get(op.id);
          let todayEfficiency = 0;
          let todayOee = 0;
          
          if (dailyTotal && dailyTotal.runtimeMs > 0) {
            // Calculate efficiency from daily totals (both in milliseconds)
            const runtimeSec = dailyTotal.runtimeMs / 1000;
            const timeCreditSec = (dailyTotal.totalTimeCreditMs || 0) / 1000;
            todayEfficiency = timeCreditSec / runtimeSec;
            console.log(`[PERF] [${serialNum}] Operator ${op.id} today efficiency from daily totals: runtime=${runtimeSec}s, timeCredit=${timeCreditSec}s, eff=${Math.round(todayEfficiency * 100)}%`);

            // OEE for today: availability * efficiency * throughput
            const windowMs = now.toMillis() - now.startOf('day').toMillis();
            const availability = windowMs > 0 ? (dailyTotal.runtimeMs / windowMs) : 0;
            const efficiencyRatio = todayEfficiency;
            const totalCounts = dailyTotal.totalCounts || 0;
            const totalMisfeeds = dailyTotal.totalMisfeeds || 0;
            const throughput = (totalCounts + totalMisfeeds) > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
            todayOee = availability * efficiencyRatio * throughput;
          } else {
            console.log(`[PERF] [${serialNum}] Operator ${op.id} no daily total found or zero runtime, using 0% for today`);
          }

          efficiencyObj.today = {
            value: Math.round(todayEfficiency * 100),
            label: 'All Day',
            color: todayEfficiency >= 0.9 ? 'green' : todayEfficiency >= 0.7 ? 'orange' : 'yellow'
          };
          oeeObj.today = {
            value: Math.round(todayOee * 100),
            label: 'All Day',
            color: todayOee >= 0.9 ? 'green' : todayOee >= 0.7 ? 'orange' : 'yellow'
          };
          
          console.log(`[PERF] [${serialNum}] Operator ${op.id} efficiency and OEE calculations completed in ${Date.now() - efficiencyCalcStartTime}ms`);

          // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
          const batchItemStartTime = Date.now();
          const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
          console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
          
          const operatorTotalTime = Date.now() - operatorStartTime;
          console.log(`[PERF] [${serialNum}] Operator ${op.id} COMPLETED - Total time: ${operatorTotalTime}ms`);

          const operatorName = op.name?.first && op.name?.surname
            ? `${op.name.first} ${op.name.surname}`
            : (op.name || 'Unknown');

          // Status schema uses 'id', but legacy code used 'code' - support both
          const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
          return {
            status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
            fault: ticker.status?.name ?? 'Unknown',
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: '', run: '' },
            efficiency: efficiencyObj,
            oee: oeeObj,
            batch: { item: batchItem, code: 10000001 }
          };
        })
      );

      console.log(`[PERF] [${serialNum}] Running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
      
      return res.json({ flipperData: performanceData });
    } catch (err) {
      console.error(`[PERF] [${serialNum || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /* ---------------------------- helpers ---------------------------- */

  function projectMachineForPerf() {
    return {
      timestamps: 1,
      items: 1,
      machine: 1,
      // Use session-embedded counts to avoid double-counting across operators
      counts: 1
    };
  }

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

  function zeroEff() {
    return {
      lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'yellow' },
      lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'yellow' },
      lastHour: { value: 0, label: 'Last Hour', color: 'yellow' },
      today: { value: 0, label: 'All Day', color: 'yellow' }
    };
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // --- Operator Efficiency API (for cm-operator-efficiency component) ---

  router.get('/analytics/machine-live-session-summary/operator', async (req, res) => {
    try {
      const { serial, station } = req.query;
      if (!serial || !station) {
        return res.status(400).json({ error: 'Missing serial or station' });
      }

      const serialNum = Number(serial);
      const stationNum = Number(station);

      // Get machine ticker to find operator at specified station
      const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
        .findOne(
          { 'machine.id': serialNum },
          {
            projection: {
              timestamp: 1,
              machine: 1,
              program: 1,
              status: 1,
              operators: 1
            }
          }
        );

      // No ticker: Machine offline
      if (!ticker) {
        return res.json({
          status: { code: -1, name: 'Offline' },
          fault: 'Offline',
          operator: null,
          machine: `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: buildZeroEfficiencyPayload(),
          oee: {},
          batch: { item: '', code: 10000001 }
        });
      }

      // Check for blocked station (67801/67802 station 2 skip)
      const blockedStation =
        [67801, 67802].includes(serialNum) && stationNum === 2;

      const operator = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .find(op => op && op.station === stationNum);

      const hasOperator = !!operator && operator.id !== -1 && !blockedStation;

      // No operator at station (or blocked station)
      if (!hasOperator) {
        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
        // If not running: zeros like legacy behavior
        if (statusCode !== 1) {
          return res.json({
            status: statusCode, // Use 'code' in API response for backward compatibility
            fault: ticker.status?.name ?? 'Unknown',
            operator: null,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: '', run: '' },
            efficiency: buildZeroEfficiencyPayload(),
            oee: {},
            batch: { item: '', code: 10000001 }
          });
        }

        // Running: compute efficiency from MACHINE sessions for this window set
        const now = DateTime.now();
        const frames = {
          lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
          lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
          lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
          today: { start: now.startOf('day'), label: 'All Day' }
        };

        const results = await queryMachineTimeframes(db, serialNum, frames);

        // Fallback: if any frame empty, reuse most recent open machine session for all
        if (Object.values(results).some(arr => arr.length === 0)) {
          const open = await db.collection(config.machineSessionCollectionName || 'machine-session')
            .findOne(
              {
                $or: [
                  { 'machine.id': serialNum },
                  { 'machine.serial': serialNum }
                ],
                'timestamps.end': { $exists: false }
              },
              { sort: { 'timestamps.start': -1 }, projection: projectMachineForPerf() }
            );
          if (open) for (const k of Object.keys(results)) results[k] = [open];
        }

        const effObj = {};
        for (const [key, arr] of Object.entries(results)) {
          const { start, label } = frames[key];
          const { runtimeSec, timeCreditSec } = sumWindowMachine(arr, start, now);
          const eff = runtimeSec > 0 ? Math.round((timeCreditSec / runtimeSec) * 100) : 0;
          effObj[key] = { value: eff, label, color: eff >= 90 ? 'green' : eff >= 70 ? 'orange' : 'yellow' };
        }

        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
        return res.json({
          status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
          fault: ticker.status?.name ?? 'Unknown',
          operator: null,
          machine: ticker.machine?.name || `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: effObj,
          oee: {},
          batch: { item: '', code: 10000001 }
        });
      }

      // Status schema uses 'id', but legacy code used 'code' - support both
      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      // If machine is NOT running, return zero efficiency but keep operator info
      if (statusCode !== 1) {
        const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);
        const operatorName = operator.name?.first && operator.name?.surname
          ? `${operator.name.first} ${operator.name.surname}`
          : (operator.name || 'Unknown');
        return res.json({
          status: statusCode, // Use 'code' in API response for backward compatibility
          fault: ticker.status?.name ?? 'Unknown',
          operator: operatorName,
          operatorId: operator.id,
          machine: ticker.machine?.name || `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: '', run: '' },
          efficiency: buildZeroEfficiencyPayload(),
          oee: {},
          batch: { item: batchItem, code: 10000001 }
        });
      }

      // Running: compute performance from operator-sessions over four windows
      const now = DateTime.now();
      const frames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
        lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
        today: { start: now.startOf('day'), label: 'All Day' }
      };

      // Run the four timeframe queries in parallel
      const results = await queryOperatorTimeframes(db, serialNum, operator.id, frames);

      // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
      if (Object.values(results).some(arr => arr.length === 0)) {
        // Try both machine.serial and machine.id
        const open = await db.collection(config.operatorSessionCollectionName)
          .findOne(
            {
              'operator.id': operator.id,
              $or: [
                { 'machine.serial': serialNum },
                { 'machine.id': serialNum }
              ],
              'timestamps.end': { $exists: false }
            },
            { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
          );
        if (open) {
          for (const k of Object.keys(results)) results[k] = [open];
        }
      }

      // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
      const efficiencyObj = {};
      for (const [key, arr] of Object.entries(results)) {
        const { start, label } = frames[key];
        // Extract counts from embedded session counts instead of querying count collection
        const windowStart = new Date(start.toISO());
        const windowEnd = new Date(now.toISO());
        const counts = extractCountsFromSessions(arr, windowStart, windowEnd, operator.id, serialNum);
        
        const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
        const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
        efficiencyObj[key] = {
          value: Math.round(eff * 100),
          label,
          color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
        };
      }

      // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
      const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);

      const operatorName = operator.name?.first && operator.name?.surname
        ? `${operator.name.first} ${operator.name.surname}`
        : (operator.name || 'Unknown');

      // Status schema uses 'id', but legacy code used 'code' - support both
      const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
      return res.json({
        status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
        fault: ticker.status?.name ?? 'Unknown',
        operator: operatorName,
        operatorId: operator.id,
        machine: ticker.machine?.name || `Serial ${serialNum}`,
        timers: { on: 0, ready: 0 },
        displayTimers: { on: '', run: '' },
        efficiency: efficiencyObj,
        oee: {},
        batch: { item: batchItem, code: 10000001 }
      });

    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
