// --- SPL Efficiency Screen API (sessions-powered) ---

const express = require('express');
const { DateTime } = require('luxon');
const {
  fetchStatesForMachine,
  extractAllCyclesFromStates,
} = require('../../utils/state');
const {
  getCountsForMachine,
  groupCountsByOperatorAndMachine,
  groupCountsByItem,
} = require('../../utils/count');

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const config = require('../../modules/config');
  const {
    round2,
    projectSessionForPerf,
    queryOperatorTimeframes,
    extractCountsFromSessions,
    getValidAndMisfeedCountsInWindow,
    sumWindowWithCounts,
    resolveBatchItemFromSessions,
    buildZeroEfficiencyPayload,
    formatElapsedDisplay,
    calculateTotalTimeCredit,
    projectMachineForPerf,
    queryMachineTimeframes,
    sumWindowMachine,
    calcTimeCredit,
    zeroEff
  } = require('../../utils/sessionFunctions');

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
        const results = await queryOperatorTimeframes(db, serialNum, op.id, frames, logger);
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

  // --- Daily Machine Live Session Summary API (sessions + totals-daily) ---

  router.get('/analytics/daily/machine-live-session-summary', async (req, res) => {
    const routeStartTime = Date.now();
    
    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: 'Missing serial' });
      }

      const serialNum = Number(serial);
      console.log(`[PERF] [${serialNum}] Route START - daily/machine-live-session-summary`);
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
          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday, logger);
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

  // --- Daily Machine Live State Summary API (state + count) ---

  router.get('/analytics/daily/machine-live-state-summary', async (req, res) => {
    const routeStartTime = Date.now();

    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: 'Missing serial' });
      }

      const serialNum = Number(serial);
      console.log(`[PERF] [${serialNum}] Route START - daily/machine-live-state-summary`);
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
              item: 1,
              status: 1,
              operators: 1
            }
          }
        );

      console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

      // No ticker: Offline - but still return flipperData structure
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

        return res.json({ flipperData: offlineLanes });
      }

      // Build list of active operators from ticker (skip dummies; preserve existing station 2 skip for 67801/67802)
      const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .filter(op => op && op.id !== -1)
        .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));

      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

      const nowLuxon = DateTime.now();

      // If machine is NOT running, mirror behavior with 0% efficiency/OEE but use ticker for batch
      if (statusCode !== 1) {
        console.log(`[PERF] [${serialNum}] Machine NOT running (state-based) - processing ${onMachineOperators.length} operators`);
        const notRunningStartTime = Date.now();

        const currentItemName =
          ticker.item?.name ||
          (Array.isArray(ticker.program?.items) && ticker.program.items[0]?.name) ||
          '';

        const performanceData = onMachineOperators.map(op => {
          const operatorName = op.name?.first && op.name?.surname
            ? `${op.name.first} ${op.name.surname}`
            : (op.name || 'Unknown');

          return {
            status: statusCode,
            fault: ticker.status?.name ?? 'Unknown',
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: '', run: '' },
            efficiency: buildZeroEfficiencyPayload(),
            oee: buildZeroEfficiencyPayload(),
            batch: { item: currentItemName, code: 10000001 }
          };
        });

        console.log(`[PERF] [${serialNum}] Non-running state-based path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
        return res.json({ flipperData: performanceData });
      }

      // Running: compute performance directly from state + count collections
      console.log(`[PERF] [${serialNum}] Machine RUNNING (state-based) - processing ${onMachineOperators.length} operators`);
      const runningStartTime = Date.now();

      const frames = {
        lastSixMinutes: { start: nowLuxon.minus({ minutes: 6 }), label: 'Last 6 Mins' },
        lastFifteenMinutes: { start: nowLuxon.minus({ minutes: 15 }), label: 'Last 15 Mins' },
        lastHour: { start: nowLuxon.minus({ hours: 1 }), label: 'Last Hour' },
        today: { start: nowLuxon.startOf('day'), label: 'All Day' }
      };

      async function computeWindowFromStateAndCount(operatorId, frameKey) {
        const frame = frames[frameKey];
        const windowStart = frame.start.toJSDate();
        const windowEnd = nowLuxon.toJSDate();

        // Fetch counts for this machine/operator in window
        const allCounts = await getCountsForMachine(
          db,
          serialNum,
          windowStart,
          windowEnd,
          operatorId
        );
        const groupedCounts = groupCountsByOperatorAndMachine(allCounts);
        const key = `${operatorId}-${serialNum}`;
        const validCounts = groupedCounts[key]?.validCounts || [];
        const misfeedCounts = groupedCounts[key]?.misfeedCounts || [];

        // Fetch states for this machine in window and filter by operator
        const machineStates = await fetchStatesForMachine(db, serialNum, windowStart, windowEnd);
        const operatorStates = machineStates.filter(s =>
          Array.isArray(s.operators) &&
          s.operators.some(op => Number(op.id) === Number(operatorId))
        );

        const runningCycles = extractAllCyclesFromStates(operatorStates, windowStart, windowEnd).running;
        const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);
        const runtimeSec = runtimeMs / 1000;

        // Time credit from standards in count records
        const itemGroups = groupCountsByItem(validCounts);
        let totalTimeCreditSec = 0;
        for (const group of Object.values(itemGroups)) {
          if (!Array.isArray(group) || !group.length) continue;
          const first = group[0];
          const standard = Number(first.item?.standard) || 0;
          if (standard > 0) {
            totalTimeCreditSec += (group.length / standard) * 3600;
          }
        }

        const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
        const efficiencyPct = Math.round(efficiencyRatio * 100);

        const windowSec = (windowEnd.getTime() - windowStart.getTime()) / 1000;
        const availability = windowSec > 0 ? runtimeSec / windowSec : 0;

        const validCount = validCounts.length;
        const misfeedCount = misfeedCounts.length;
        const throughput =
          validCount + misfeedCount > 0 ? validCount / (validCount + misfeedCount) : 0;

        const oeeVal = availability * efficiencyRatio * throughput;
        const oeePct = Math.round(oeeVal * 100);

        const color =
          efficiencyRatio >= 0.9 ? 'green' :
          efficiencyRatio >= 0.7 ? 'orange' :
          'yellow';

        return {
          efficiency: {
            value: efficiencyPct,
            label: frame.label,
            color
          },
          oee: {
            value: oeePct,
            label: frame.label,
            color
          }
        };
      }

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op, idx) => {
          const operatorStartTime = Date.now();
          console.log(`[PERF] [${serialNum}] [STATE] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);

          const efficiencyObj = {};
          const oeeObj = {};

          for (const frameKey of ['lastSixMinutes', 'lastFifteenMinutes', 'lastHour', 'today']) {
            const { efficiency, oee } = await computeWindowFromStateAndCount(op.id, frameKey);
            efficiencyObj[frameKey] = efficiency;
            oeeObj[frameKey] = oee;
          }

          const currentItemName =
            ticker.item?.name ||
            (Array.isArray(ticker.program?.items) && ticker.program.items[0]?.name) ||
            '';

          const operatorName = op.name?.first && op.name?.surname
            ? `${op.name.first} ${op.name.surname}`
            : (op.name || 'Unknown');

          const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;

          const operatorTotalTime = Date.now() - operatorStartTime;
          console.log(`[PERF] [${serialNum}] [STATE] Operator ${op.id} COMPLETED - Total time: ${operatorTotalTime}ms`);

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
            batch: { item: currentItemName, code: 10000001 }
          };
        })
      );

      console.log(`[PERF] [${serialNum}] State-based running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
      return res.json({ flipperData: performanceData });
    } catch (err) {
      console.error(`[PERF] [state-based ${req.query.serial || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  
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
          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday, logger);
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
      const results = await queryOperatorTimeframes(db, serialNum, operator.id, frames, logger);

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
