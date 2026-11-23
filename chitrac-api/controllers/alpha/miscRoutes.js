const { sessionMachineQuery, distinctSessionMachineIds } = require('../../utils/sessionIdentity');
const express = require("express");
const { formatHumanName } = require("../../utils/humanNames");

const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  formatDuration,
} = require("../../utils/time");

const {
  fetchStatesForOperator,
  groupStatesByOperator,
  getCompletedCyclesForOperator,
  groupStatesByOperatorAndSerial,
  fetchStatesForMachine,
  extractAllCyclesFromStates,
  groupStatesByMachine,
  processAllMachinesCycles,
  getAllMachinesFromStates,
  calculateHourlyStateDurations,
  extractFaultCycles,
} = require("../../utils/state");

const {
  getCountRecords,
  getOperatorItemMapFromCounts,
  getCountsForOperator,
  getValidCountsForOperator,
  getOperatorNameFromCount,
  processCountStatistics,
  groupCountsByOperatorAndMachine,
  getCountsForOperatorMachinePairs,
  getValidCounts,
} = require("../../utils/count");

const {
  buildSoftrolCycleSummary,
  assignOperatorsToRunningCyclesMulti,
  buildStationAlignedOperators,
} = require("../../utils/miscFunctions");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");

const { getBookendedStatesAndTimeRange } = require("../../utils/machineFunctions");

const { recordTimestamp } = require("../../utils/records");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;


  router.get("/historic-data", async (req, res) => {
    try {
      // Use centralized time parser
      const { start, end } = parseAndValidateQueryParams(req);

      // Get latest state timestamp if end date is in the future
      const [latestState] = await db.collection('state')
        .find()
        .sort({ "timestamps.create": -1 })
        .limit(1)
        .toArray();

      const effectiveEnd = new Date(end) > new Date() 
        ? (recordTimestamp(latestState) || new Date())
        : end;

      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, effectiveEnd);

      // 1. Fetch and group states by operator and machine
      const allStates = await fetchStatesForOperator(
        db,
        null,
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // 2. Process completed cycles for each group
      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = { ...group, completedCycles };
        }
      }

      // 3. Get operator-machine pairs for count lookup
      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      // 4. Fetch and group counts
      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        end
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // 5. Process each group's cycles and counts
      const results = [];
      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [operatorId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${operatorId}-${machineSerial}`];
        if (!countGroup) continue;

        // Sort counts by timestamp for efficient processing
        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(recordTimestamp(a)) - new Date(recordTimestamp(b))
        );

        // Process each cycle
        for (const cycle of group.completedCycles) {
          const summary = buildSoftrolCycleSummary(
            cycle,
            sortedCounts,
            countGroup
          );
          
          if (summary) {
            results.push({
              operatorId: parseInt(operatorId),
              machineSerial: parseInt(machineSerial),
              ...summary
            });
          }
        }
      }

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  // Softrol Route end


  // Unused debug routes are preserved in arch/legacy-routes/misc-debug.js.


  router.get("/dryer/operator-cycles", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      // Get all valid count records for that machine
      const counts = await db.collection("count").find({
        "machine.serial": serialNum,
        "timestamps.create": { $gte: startDate, $lte: endDate },
        "operator.id": { $exists: true, $ne: -1 }
      }).sort({ "timestamps.create": 1 }).toArray();
  
      if (!counts.length) {
        return res.json({ serial: serialNum, operatorCycles: [] });
      }
  
      const cycles = [];
      let currentOperator = counts[0].operator;
      let currentStart = new Date(recordTimestamp(counts[0]));
  
      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const { operator } = count;
  
        if (!operator || operator.id !== currentOperator.id) {
          // End the current cycle
          const currentEnd = new Date(recordTimestamp(counts[i - 1]));
          cycles.push({
            operatorId: currentOperator.id,
            name: currentOperator.name || 'Unknown',
            start: currentStart,
            end: currentEnd
          });
  
          // Start a new cycle
          currentOperator = operator;
          currentStart = new Date(recordTimestamp(count));
        }
      }
  
      // Push the final cycle
      const lastTimestamp = new Date(recordTimestamp(counts.at(-1)));
      cycles.push({
        operatorId: currentOperator.id,
        name: currentOperator.name || 'Unknown',
        start: currentStart,
        end: lastTimestamp
      });
  
      res.json({
        serial: serialNum,
        operatorCycles: cycles
      });
    } catch (err) {
      logger.error("Error in /dryer/operator-cycles:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  

  router.get("/dryer/operator-cycles-dynamic", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      const counts = await db.collection("count").find({
        "machine.serial": serialNum,
        "timestamps.create": { $gte: startDate, $lte: endDate },
        "operator.id": { $exists: true, $ne: -1 }
      }).sort({ "timestamps.create": 1 }).toArray();
  
      if (counts.length === 0) {
        return res.json({ serial: serialNum, operatorCycles: [] });
      }
  
      const cycles = [];
      let currentOperator = counts[0].operator;
      let currentStart = new Date(recordTimestamp(counts[0]));
      let lastTimestamp = new Date(recordTimestamp(counts[0]));
  
      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(recordTimestamp(count));
  
        if (count.operator.id !== currentOperator.id) {
          // Close previous session
          cycles.push({
            operatorId: currentOperator.id,
            name: currentOperator.name,
            start: currentStart,
            end: lastTimestamp
          });
  
          // Start new session
          currentOperator = count.operator;
          currentStart = ts;
        }
  
        lastTimestamp = ts;
      }
  
      // Push final session
      cycles.push({
        operatorId: currentOperator.id,
        name: currentOperator.name,
        start: currentStart,
        end: lastTimestamp
      });
  
      res.json({
        serial: serialNum,
        operatorCycles: cycles
      });
    } catch (err) {
      logger.error("Error in /dryer/operator-cycles-dynamic:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dryer/running-cycles", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      const states = await fetchStatesForMachine(db, serialNum, startDate, endDate);
      const runningCycles = extractAllCyclesFromStates(states, startDate, endDate, "running");

      res.json({
        serial: serialNum,
        total: runningCycles.length,
        cycles: runningCycles
      });
    } catch (err) {
      logger.error("Error in /dryer/running-cycles:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });


router.get("/dryer/running-with-operators", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const startDate = new Date(start);
    const endDate = new Date(end);
    const serialNum = parseInt(serial);

    const states = await fetchStatesForMachine(db, serialNum, startDate, endDate);
    const runningCycles = extractAllCyclesFromStates(states, startDate, endDate, "running");

    const counts = await db.collection("count").find({
      "machine.serial": serialNum,
      "timestamps.create": { $gte: startDate, $lte: endDate },
      "operator.id": { $exists: true }
    }).sort({ "timestamps.create": 1 }).toArray();

    const operatorSessions = [];
    if (counts.length > 0) {
      let currentOperator = counts[0].operator;
      let currentStart = new Date(recordTimestamp(counts[0]));
      let lastTimestamp = currentStart;

      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(recordTimestamp(count));
        const id = count.operator?.id;

        if (id !== currentOperator.id) {
          operatorSessions.push({
            operatorId: currentOperator.id,
            name: currentOperator.name,
            start: currentStart,
            end: lastTimestamp
          });
          currentOperator = count.operator;
          currentStart = ts;
        }

        lastTimestamp = ts;
      }

      operatorSessions.push({
        operatorId: currentOperator.id,
        name: currentOperator.name,
        start: currentStart,
        end: lastTimestamp
      });
    }

    const paddingMs = 60 * 1000;

    // Final output array of modified state documents
    const updatedStateDocs = [];

    for (const cycle of runningCycles) {
      const runStart = new Date(cycle.start.getTime() - paddingMs);
      const runEnd = new Date(cycle.end.getTime() + paddingMs);

      const seen = new Set();
      const operators = [];

      for (const session of operatorSessions) {
        const opStart = new Date(session.start);
        const opEnd = new Date(session.end);
        const overlapStart = runStart > opStart ? runStart : opStart;
        const overlapEnd = runEnd < opEnd ? runEnd : opEnd;

        if (overlapEnd > overlapStart && !seen.has(session.operatorId)) {
          operators.push({
            id: session.operatorId,
            name: session.name
          });
          seen.add(session.operatorId);
        }

        if (operators.length >= 8) break;
      }

      while (operators.length < 8) {
        operators.push({ id: -1, name: "Offline" });
      }

      // Fetch all State records that fall within this cycle
      const statesInCycle = states.filter(s => {
        const ts = new Date(recordTimestamp(s));
        return ts >= cycle.start && ts <= cycle.end;
      });

      for (const state of statesInCycle) {
        const cloned = { ...state, operators };
        updatedStateDocs.push(cloned);
      }
    }

    res.json({
      serial: serialNum,
      total: updatedStateDocs.length,
      updatedStates: updatedStateDocs
    });

  } catch (err) {
    logger.error("Error in /dryer/running-with-operators:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Unused report variants are preserved in arch/legacy-routes/misc-legacy-reports.js.

// // FROM ITEMSESSIONS.JS

// // ---- /api/alpha/analytics/items-summary-daily-cached ----
// router.get("/analytics/items-summary-daily-cached", async (req, res) => {
//   try {
//     const { start, end, itemId } = parseAndValidateQueryParams(req);
    
//     // Get today's date string in Chicago timezone
//     const today = new Date();
//     const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
//     const dateStr = chicagoTime.toISOString().split('T')[0];
    
//     logger.info(`[itemSessions] Fetching daily cached items summary for date: ${dateStr}, itemId: ${itemId || 'all'}`);
    
//     // Build query filter for totals-daily collection
//     const filter = { 
//       entityType: 'machine-item',
//       date: dateStr
//     };
    
//     // Add item filter if specified
//     if (itemId) {
//       filter.itemId = parseInt(itemId);
//     }
    
//     // Query the totals-daily collection
//     const cacheRecords = await db.collection('totals-daily')
//       .find(filter)
//       .toArray();
    
//     if (cacheRecords.length === 0) {
//       logger.warn(`[itemSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`);
//       // Fallback to real-time calculation (items-summary route)
//       return res.json([]);
//     }
    
//     // Helper function to normalize PPH standards
//     const normalizePPH = (std) => {
//       const n = Number(std) || 0;
//       return n > 0 && n < 60 ? n * 60 : n; // PPM → PPH
//     };
    
//     // Group by item ID and aggregate metrics across machines
//     const itemMap = new Map();
    
//     for (const record of cacheRecords) {
//       const itmId = record.itemId;
      
//       if (!itemMap.has(itmId)) {
//         itemMap.set(itmId, {
//           itemId: record.itemId,
//           itemName: record.itemName,
//           standardRaw: record.itemStandard || 0,
//           count: 0,
//           workedSec: 0
//         });
//       }
      
//       const itemData = itemMap.get(itmId);
      
//       // Aggregate counts and worked time across all machines
//       itemData.count += record.totalCounts;
//       itemData.workedSec += (record.workedTimeMs / 1000);
      
//       // Update standard if not set
//       if (!itemData.standardRaw && record.itemStandard) {
//         itemData.standardRaw = record.itemStandard;
//       }
//     }
    
//     // Transform to expected format
//     const results = Array.from(itemMap.values()).map((entry) => {
//       const workedMs = Math.round(entry.workedSec * 1000);
//       const hours = workedMs / 3_600_000;
//       const pph = hours > 0 ? entry.count / hours : 0;
//       const stdPPH = normalizePPH(entry.standardRaw);
//       const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

//       return {
//         itemId: entry.itemId,
//         itemName: entry.itemName,
//         workedTimeFormatted: formatDuration(workedMs),
//         count: entry.count,
//         pph: Math.round(pph * 100) / 100,
//         standard: entry.standardRaw ?? 0,
//         efficiency: Math.round(efficiencyPct * 100) / 100,
//       };
//     });
    
//     logger.info(`[itemSessions] Retrieved ${results.length} daily cached item records for date: ${dateStr}`);
//     res.json(results);
    
//   } catch (err) {
//     logger.error(`[itemSessions] Error in daily cached items-summary route:`, err);
    
//     // Check if it's a validation error
//     if (err.message && (err.message.includes('Start and end dates are required') ||
//       err.message.includes('Invalid date format') ||
//       err.message.includes('Start date must be before end date'))) {
//       return res.status(400).json({ error: err.message });
//     }
    
//     // Return empty array on error (consistent with real-time route behavior)
//     logger.info(`[itemSessions] Returning empty array due to error`);
//     res.json([]);
//   }
// });

// // /analytics/item-dashboard-summary — sessions-based, using item-sessions and bookending helper
// router.get("/analytics/items-summary", async (req, res) => {
//   try {
//     const { start, end } = parseAndValidateQueryParams(req);

//     // 1) Same as old route: iterate active machines only, use bookending helper per serial
//     const machineSerials = await db
//       .collection(config.machineCollectionName || "machine")
//       .distinct("serial", { active: true });
//     const resultsMap = new Map();
//     const now = new Date();
//     const itemSessColl = db.collection(config.itemSessionCollectionName || "item-session");

//     const normalizePPH = (std) => {
//       const n = Number(std) || 0;
//       return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
//     };

//     for (const serial of machineSerials) {
//       const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
//       if (!bookended) continue;

//       const { sessionStart, sessionEnd } = bookended;

//       // 2) Pull item-sessions overlapping the bookended window for this machine
//       const sessions = await itemSessColl
//         .find({
//           "machine.serial": Number(serial),
//           "timestamps.start": { $lt: sessionEnd },
//           $or: [
//             { "timestamps.end": { $gt: sessionStart } },
//             { "timestamps.end": { $exists: false } },
//             { "timestamps.end": null },
//           ],
//         })
//         .project({
//           _id: 0,
//           item: 1, // { id, name, standard } (preferred)
//           items: 1, // single-item legacy fallback
//           counts: 1, // [{timestamp,...}] optional
//           totalCount: 1, // optional rollup
//           workTime: 1, // seconds (preferred)
//           runtime: 1, // seconds (fallback)
//           activeStations: 1,
//           operators: 1,
//           timestamps: 1, // nested doc with start/end
//         })
//         .toArray();

//       if (!sessions.length) continue;

//       for (const s of sessions) {
//         // 3) Resolve single item from session
//         const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
//         if (!itm || itm.id == null) continue;

//         // 4) Truncate to bookended window
//         const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
//         const sessEnd = new Date(s.timestamps?.end || now);
//         if (!sessStart || Number.isNaN(sessStart.getTime())) continue;
//         if (!sessEnd || Number.isNaN(sessEnd.getTime())) continue;
//         const ovStart = sessStart > sessionStart ? sessStart : sessionStart;
//         const ovEnd = sessEnd < sessionEnd ? sessEnd : sessionEnd;
//         if (!(ovEnd > ovStart)) continue;

//         const sessSec = Math.max(0, (sessEnd - sessStart) / 1000);
//         const ovSec = Math.max(0, (ovEnd - ovStart) / 1000);
//         if (sessSec === 0 || ovSec === 0) continue;

//         // 5) Worked time seconds (prefer workTime; else runtime * stations), prorated to overlap
//         const stations =
//           typeof s.activeStations === "number"
//             ? s.activeStations
//             : (Array.isArray(s.operators) ? s.operators.length : 0);
//         const baseWorkSec = typeof s.workTime === "number"
//           ? s.workTime
//           : typeof s.runtime === "number"
//             ? s.runtime * Math.max(1, stations)
//             : 0;
//         const workedSec = baseWorkSec > 0 ? baseWorkSec * (ovSec / sessSec) : 0;

//         // 6) Counts within overlap: use counts[] if present; else prorate totalCount
//         let countInWin = 0;
//         if (Array.isArray(s.counts) && s.counts.length) {
//           if (s.counts.length > 50000) {
//             // large array: fall back to prorating by overlap fraction
//             countInWin = typeof s.totalCount === "number" ? Math.round(s.totalCount * (ovSec / sessSec)) : 0;
//           } else {
//             countInWin = s.counts.reduce((acc, c) => {
//               const t = new Date(c.timestamp);
//               // (defensive) ensure item matches if present
//               const sameItem = !c.item?.id || c.item.id === itm.id;
//               return acc + (sameItem && t >= ovStart && t <= ovEnd ? 1 : 0);
//             }, 0);
//           }
//         } else if (typeof s.totalCount === "number") {
//           countInWin = Math.round(s.totalCount * (ovSec / sessSec));
//         }

//         // 7) Aggregate by itemId
//         const key = String(itm.id);
//         if (!resultsMap.has(key)) {
//           resultsMap.set(key, {
//             itemId: itm.id,
//             itemName: itm.name || "Unknown",
//             standardRaw: itm.standard ?? 0,
//             count: 0,
//             workedSec: 0,
//           });
//         }
//         const acc = resultsMap.get(key);
//         acc.count += countInWin;
//         acc.workedSec += workedSec;
//         if (!acc.itemName && itm.name) acc.itemName = itm.name;
//         if (!acc.standardRaw && itm.standard != null) acc.standardRaw = itm.standard;
//       }
//     }

//     // 8) Finalize metrics (same math as before)
//     const results = Array.from(resultsMap.values()).map((entry) => {
//       const workedMs = Math.round(entry.workedSec * 1000);
//       const hours = workedMs / 3_600_000;
//       const pph = hours > 0 ? entry.count / hours : 0;
//       const stdPPH = normalizePPH(entry.standardRaw);
//       const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

//       return {
//         itemId: entry.itemId,
//         itemName: entry.itemName,
//         workedTimeFormatted: formatDuration(workedMs),
//         count: entry.count,
//         pph: Math.round(pph * 100) / 100,
//         standard: entry.standardRaw ?? 0,
//         efficiency: Math.round(efficiencyPct * 100) / 100,
//       };
//     });

//     res.json(results);
//   } catch (err) {
//     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//     res.status(500).json({ error: "Failed to generate item dashboard summary" });
//   }
// });


// // FROM EFFICIENCYSCREENSESSIONROUTE.JS

// router.get('/analytics/machine-live-session-summary', async (req, res) => {
//   const routeStartTime = Date.now();
  
//   try {
//     const { serial, date } = req.query;
//     if (!serial || !date) {
//       return res.status(400).json({ error: 'Missing serial or date' });
//     }

//     const serialNum = Number(serial);
//     console.log(`[PERF] [${serialNum}] Route START - machine-live-session-summary`);
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
//         oee: {},
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

//     // If machine is NOT running, mirror existing route behavior by returning entries with 0% efficiency
//     // (we still include operator/machine/batch info for the screen to render cleanly)
//     if (statusCode !== 1) {
//       console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
//       const notRunningStartTime = Date.now();
//       const coll = db.collection(config.operatorSessionCollectionName);
//       const machineFilter = { $or: [{ 'machine.serial': serialNum }, { 'machine.id': serialNum }] };

//       const performanceData = await Promise.all(
//         onMachineOperators.map(async (op, idx) => {
//           // Elapsed from session start (machines may not emit ticker when paused/faulted)
//           const session =
//             (await coll.findOne(
//               { 'operator.id': op.id, ...machineFilter, 'timestamps.end': { $exists: false } },
//               { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
//             )) ||
//             (await coll.findOne(
//               { 'operator.id': op.id, ...machineFilter },
//               { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
//             ));
//           const sessionStart = session?.timestamps?.start;
//           const startDate = sessionStart ? (sessionStart instanceof Date ? sessionStart : new Date(sessionStart)) : null;
//           const elapsedInStateSec = startDate
//             ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000))
//             : 0;
//           const elapsedDisplay = formatElapsedDisplay(elapsedInStateSec);

//           const batchItem = (session?.items || [])
//             .map(it => it?.name)
//             .filter(Boolean);
//           const batchItemStr = [...new Set(batchItem)].join(' + ');

//           const operatorName = op.name?.first && op.name?.surname
//             ? `${op.name.first} ${op.name.surname}`
//             : (op.name || 'Unknown');
//           return {
//             status: ticker.status?.code ?? 0,
//             fault: ticker.status?.name ?? 'Unknown',
//             operator: operatorName,
//             operatorId: op.id,
//             machine: ticker.machine?.name || `Serial ${serialNum}`,
//             timers: { on: elapsedInStateSec, ready: 0 },
//             displayTimers: { on: elapsedDisplay, run: elapsedDisplay },
//             efficiency: buildZeroEfficiencyPayload(),
//             // keep the field to match the existing response shape; values not required in the new flow
//             oee: {},
//             batch: { item: batchItemStr, code: 10000001 }
//           };
//         })
//       );

//       console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
//       // Back-compat: preserve existing top-level shape/key
//       return res.json({ flipperData: performanceData });
//     }

//     // Running: compute performance from operator-sessions over four windows
//     console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators`);
//     const runningStartTime = Date.now();
    
//     const now = DateTime.now();
//     const frames = {
//       lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//       lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//       lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//       today: { start: now.startOf('day'), label: 'All Day' }
//     };

//     const performanceData = await Promise.all(
//       onMachineOperators.map(async (op, idx) => {
//         const operatorStartTime = Date.now();
//         console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);
        
//         // Run the four timeframe queries in parallel
//         const timeframeQueryStartTime = Date.now();
//         const results = await queryOperatorTimeframes(db, serialNum, op.id, frames, logger);
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} timeframe queries completed in ${Date.now() - timeframeQueryStartTime}ms`);

//         // Debug: Log session counts
//         console.log(`[PERF] [${serialNum}] Operator ${op.id}: sessions - 6min=${results.lastSixMinutes.length}, 15min=${results.lastFifteenMinutes.length}, 1hr=${results.lastHour.length}, today=${results.today.length}`);

//         // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
//         const hasEmpty = Object.values(results).some(arr => arr.length === 0);

//         if (hasEmpty) {
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} has empty timeframes - fetching open session`);
//           const openSessionStartTime = Date.now();
          
//           // Try both machine.serial and machine.id
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
//             for (const k of Object.keys(results)) results[k] = [open];
//           }
//         }

//         // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} starting efficiency calculations for 4 timeframes`);
//         const efficiencyCalcStartTime = Date.now();
//         const efficiencyObj = {};
        
//         for (const [key, arr] of Object.entries(results)) {
//           const windowStartTime = Date.now();
//           const { start, label } = frames[key];
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} processing window: ${key}`);
          
//           // Extract counts from embedded session counts instead of querying count collection
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
          
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} TOTAL time: ${Date.now() - windowStartTime}ms`);
//         }
        
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} efficiency calculations completed in ${Date.now() - efficiencyCalcStartTime}ms`);

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
//           // keep the field to match the existing response shape; not required for the new flow
//           oee: {},
//           batch: { item: batchItem, code: 10000001 }
//         };
//       })
//     );

//     console.log(`[PERF] [${serialNum}] Running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
    
//     // Back-compat: preserve existing top-level shape/key
//     return res.json({ flipperData: performanceData });
//   } catch (err) {
//     console.error(`[PERF] [${serialNum || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
//     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
//   });

//   router.get('/machines/spf', async (req, res) => {
//     try {
//       const machines = await db.collection('machines')
//         .find({
//           $or: [
//             { name: { $regex: /^SPF/i } },
//             { type: 'SPF' }
//           ],
//           active: { $ne: false }
//         })
//         .project({ serial: 1, name: 1, active: 1 })
//         .sort({ name: 1 })
//         .toArray();
      
//       return res.json(machines);
//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//   });

//   // --- Operator Efficiency API (for cm-operator-efficiency component) ---

//   router.get('/analytics/machine-live-session-summary/operator', async (req, res) => {
//     try {
//       const { serial, station } = req.query;
//       if (!serial || !station) {
//         return res.status(400).json({ error: 'Missing serial or station' });
//       }

//       const serialNum = Number(serial);
//       const stationNum = Number(station);

//       // Get machine ticker to find operator at specified station
//       const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
//         .findOne(
//           { 'machine.id': serialNum },
//           {
//             projection: {
//               timestamp: 1,
//               machine: 1,
//               program: 1,
//               status: 1,
//               operators: 1
//             }
//           }
//         );

//       // No ticker: Machine offline
//       if (!ticker) {
//         return res.json({
//           status: { code: -1, name: 'Offline' },
//           fault: 'Offline',
//           operator: null,
//           machine: `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: buildZeroEfficiencyPayload(),
//           oee: {},
//           batch: { item: '', code: 10000001 }
//         });
//       }

//       // Check for blocked station (67801/67802 station 2 skip)
//       const blockedStation =
//         [67801, 67802].includes(serialNum) && stationNum === 2;

//       const operator = (Array.isArray(ticker.operators) ? ticker.operators : [])
//         .find(op => op && op.station === stationNum);

//       const hasOperator = !!operator && operator.id !== -1 && !blockedStation;

//       // No operator at station (or blocked station)
//       if (!hasOperator) {
//         // Status schema uses 'id', but legacy code used 'code' - support both
//         const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
//         // If not running: zeros like legacy behavior
//         if (statusCode !== 1) {
//           return res.json({
//             status: statusCode, // Use 'code' in API response for backward compatibility
//             fault: ticker.status?.name ?? 'Unknown',
//             operator: null,
//             machine: ticker.machine?.name || `Serial ${serialNum}`,
//             timers: { on: 0, ready: 0 },
//             displayTimers: { on: '', run: '' },
//             efficiency: buildZeroEfficiencyPayload(),
//             oee: {},
//             batch: { item: '', code: 10000001 }
//           });
//         }

//         // Running: compute efficiency from MACHINE sessions for this window set
//         const now = DateTime.now();
//         const frames = {
//           lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//           lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//           lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//           today: { start: now.startOf('day'), label: 'All Day' }
//         };

//         const results = await queryMachineTimeframes(db, serialNum, frames);

//         // Fallback: if any frame empty, reuse most recent open machine session for all
//         if (Object.values(results).some(arr => arr.length === 0)) {
//           const open = await db.collection(config.machineSessionCollectionName || 'machine-session')
//             .findOne(
//               {
//                 $or: [
//                   { 'machine.id': serialNum },
//                   { 'machine.serial': serialNum }
//                 ],
//                 'timestamps.end': { $exists: false }
//               },
//               { sort: { 'timestamps.start': -1 }, projection: projectMachineForPerf() }
//             );
//           if (open) for (const k of Object.keys(results)) results[k] = [open];
//         }

//         const effObj = {};
//         for (const [key, arr] of Object.entries(results)) {
//           const { start, label } = frames[key];
//           const { runtimeSec, timeCreditSec } = sumWindowMachine(arr, start, now);
//           const eff = runtimeSec > 0 ? Math.round((timeCreditSec / runtimeSec) * 100) : 0;
//           effObj[key] = { value: eff, label, color: eff >= 90 ? 'green' : eff >= 70 ? 'orange' : 'yellow' };
//         }

//         // Status schema uses 'id', but legacy code used 'code' - support both
//         const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
//         return res.json({
//           status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
//           fault: ticker.status?.name ?? 'Unknown',
//           operator: null,
//           machine: ticker.machine?.name || `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: effObj,
//           oee: {},
//           batch: { item: '', code: 10000001 }
//         });
//       }

//       // Status schema uses 'id', but legacy code used 'code' - support both
//       const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
//       // If machine is NOT running, return zero efficiency but keep operator info
//       if (statusCode !== 1) {
//         const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);
//         const operatorName = operator.name?.first && operator.name?.surname
//           ? `${operator.name.first} ${operator.name.surname}`
//           : (operator.name || 'Unknown');
//         return res.json({
//           status: statusCode, // Use 'code' in API response for backward compatibility
//           fault: ticker.status?.name ?? 'Unknown',
//           operator: operatorName,
//           operatorId: operator.id,
//           machine: ticker.machine?.name || `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: buildZeroEfficiencyPayload(),
//           oee: {},
//           batch: { item: batchItem, code: 10000001 }
//         });
//       }

//       // Running: compute performance from operator-sessions over four windows
//       const now = DateTime.now();
//       const frames = {
//         lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//         lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//         lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//         today: { start: now.startOf('day'), label: 'All Day' }
//       };

//       // Run the four timeframe queries in parallel
//       const results = await queryOperatorTimeframes(db, serialNum, operator.id, frames, logger);

//       // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
//       if (Object.values(results).some(arr => arr.length === 0)) {
//         // Try both machine.serial and machine.id
//         const open = await db.collection(config.operatorSessionCollectionName)
//           .findOne(
//             {
//               'operator.id': operator.id,
//               $or: [
//                 { 'machine.serial': serialNum },
//                 { 'machine.id': serialNum }
//               ],
//               'timestamps.end': { $exists: false }
//             },
//             { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
//           );
//         if (open) {
//           for (const k of Object.keys(results)) results[k] = [open];
//         }
//       }

//       // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
//       const efficiencyObj = {};
//       for (const [key, arr] of Object.entries(results)) {
//         const { start, label } = frames[key];
//         // Extract counts from embedded session counts instead of querying count collection
//         const windowStart = new Date(start.toISO());
//         const windowEnd = new Date(now.toISO());
//         const counts = extractCountsFromSessions(arr, windowStart, windowEnd, operator.id, serialNum);
        
//         const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
//         const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
//         efficiencyObj[key] = {
//           value: Math.round(eff * 100),
//           label,
//           color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
//         };
//       }

//       // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
//       const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);

//       const operatorName = operator.name?.first && operator.name?.surname
//         ? `${operator.name.first} ${operator.name.surname}`
//         : (operator.name || 'Unknown');

//       // Status schema uses 'id', but legacy code used 'code' - support both
//       const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
//       return res.json({
//         status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
//         fault: ticker.status?.name ?? 'Unknown',
//         operator: operatorName,
//         operatorId: operator.id,
//         machine: ticker.machine?.name || `Serial ${serialNum}`,
//         timers: { on: 0, ready: 0 },
//         displayTimers: { on: '', run: '' },
//         efficiency: efficiencyObj,
//         oee: {},
//         batch: { item: batchItem, code: 10000001 }
//       });

//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//   });

//   // FROM DAILYDASHBOARDSESSIONROUTESSPLIT.JS

//   // ---- INDIVIDUAL ROUTES ----

//   // Route 1: Machine Status Breakdowns
//   router.get('/analytics/daily/machine-status', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const machineStatus = await buildDailyMachineStatusFromSessions(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         machineStatus
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch machine status data" });
//     }
//   });

//   // Route 3: Item Hourly Production Data
//   router.get('/analytics/daily/item-hourly-production', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const itemHourlyStack = await buildDailyItemHourlyStack(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         itemHourlyStack
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch item hourly production data" });
//     }
//   });

//   // Route 3B: Item Hourly Production Data (Fast - using hourly-totals cache)
//   router.get('/analytics/hourly/item-hourly-production', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const itemHourlyStack = await buildItemHourlyStackFromCache(db, dayStart, dayEnd, logger);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         itemHourlyStack
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch item hourly production data from cache" });
//     }
//   });

//   // Route 4: Top Operator Rankings
//   router.get('/analytics/daily/top-operators', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const topOperators = await buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         topOperators
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch top operator data" });
//     }
//   });

//   // Route 4C: Top 10 Faults (plantwide, by fault code)
//   router.get('/analytics/daily/top-faults', async (req, res) => {
//     try {
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const fsColl = db.collection(config.faultSessionCollectionName);
//       const topFaults = await fsColl
//         .aggregate([
//           {
//             $match: {
//               "timestamps.start": { $lt: dayEnd },
//               $or: [
//                 { "timestamps.end": { $gte: dayStart } },
//                 { "timestamps.end": { $exists: false } },
//                 { "timestamps.end": null }
//               ]
//             }
//           },
//           {
//             $project: {
//               code: {
//                 $ifNull: [
//                   "$states.start.status.id",
//                   { $ifNull: ["$states.start.status.code", "$startState.status.code"] }
//                 ]
//               },
//               name: {
//                 $ifNull: [
//                   "$states.start.status.name",
//                   { $ifNull: ["$startState.status.name", "Fault"] }
//                 ]
//               }
//             }
//           },
//           { $match: { code: { $ne: null } } },
//           {
//             $group: {
//               _id: "$code",
//               name: { $first: "$name" },
//               count: { $sum: 1 }
//             }
//           },
//           { $sort: { count: -1 } },
//           { $limit: 10 },
//           {
//             $project: {
//               _id: 0,
//               code: "$_id",
//               name: 1,
//               count: 1
//             }
//           }
//         ])
//         .toArray();

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         topFaults
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch top faults data" });
//     }
//   });

//   // Route 5: Plant-wide Metrics
//   router.get('/analytics/daily/plantwide-metrics', async (req, res) => {
//     try {
//       // Parse query parameters, with fallback to today if not provided
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         // If query params are invalid or missing, default to today
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const plantwideMetrics = await buildPlantwideMetricsByHour(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         plantwideMetrics
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch plant-wide metrics data" });
//     }
//   }); 

//   // Route 5B: Plant-wide Metrics (Fast - using daily totals cache)
//   router.get('/analytics/daily/plantwide-metrics-cache', async (req, res) => {
//     try {
//       // Parse query parameters, with fallback to today if not provided
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         // If query params are invalid or missing, default to today
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const plantwideMetrics = await buildPlantwideMetricsByHourFromCache(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         plantwideMetrics
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch fast plant-wide metrics data" });
//     }
//   });

//   // Route 6: Daily Count Totals
//   router.get('/analytics/daily/count-totals', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayEnd = now.toJSDate();

//       const dailyCounts = await buildDailyCountTotals(db, null, dayEnd);

//       return res.json({
//         timeRange: { end: dayEnd },
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch daily count totals data" });
//     }
//   });

//   // Diagnostic route to check state collections
//   router.get('/analytics/daily/debug-collections', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();

//       // List all collections
//       const collections = await db.listCollections().toArray();
//       const stateCollections = collections.filter(c => c.name.includes('state'));

//       // Count documents in each state collection for today
//       const counts = {};
//       for (const coll of stateCollections) {
//         const count = await db.collection(coll.name).countDocuments({
//           timestamp: { $gte: dayStart }
//         });
//         counts[coll.name] = count;
//       }

//       // Get a sample document from state-machine-daily if it exists
//       let sampleDoc = null;
//       if (collections.find(c => c.name === 'state-machine-daily')) {
//         sampleDoc = await db.collection('state-machine-daily').findOne({
//           timestamp: { $gte: dayStart }
//         });
//       }

//       return res.json({
//         allStateCollections: stateCollections.map(c => c.name),
//         documentCounts: counts,
//         sampleDocument: sampleDoc,
//         queryDate: dayStart
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch debug info" });
//     }
//   });

//   // Legacy sessions-based daily dashboard helpers/routes removed

//   // FROM DAILYDASHBOARDROUTES.JS

//   router.get('/analytics/daily-dashboard/full', async (req, res) => {
//     try {
//       const { start, end } = parseAndValidateQueryParams(req);
  
//       const [
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       ] = await Promise.all([
//         buildDailyMachineStatus(db, start, end),
//         buildMachineOEE(db, start, end),
//         buildDailyItemHourlyStack(db, start, end),
//         buildTopOperatorEfficiency(db, start, end),
//         buildPlantwideMetricsByHour(db, start, end),
//         buildDailyCountTotals(db, start, end)
//       ]);
  
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch full daily dashboard data" });
//     }
//   });

//   router.get('/analytics/daily-dashboard/full/new', async (req, res) => {
//     try {
//       // Validate database connection
//       if (!db) {
//         return res.status(500).json({ 
//           error: "Database connection not available",
//           details: "Server configuration error"
//         });
//       }

//       const { start, end } = parseAndValidateQueryParams(req);
//       const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
      
//       const TZ = "America/Chicago";
  
//       // Simplified aggregation pipeline for states - using basic operations for compatibility
//       const statesAgg = [
//         {$match: { timestamp: {$gte: paddedStart, $lte: paddedEnd} }},
//         {$set: {
//           code: "$status.code",
//           serial: "$machine.serial",
//           machineName: "$machine.name"
//         }},
//         // Group by machine and status to get status counts
//         {$group: {
//           _id: { 
//             serial: "$serial", 
//             code: "$code",
//             machineName: "$machineName"
//           },
//           count: { $sum: 1 }
//         }},
//         // Calculate status buckets
//         {$set: {
//           bucket: {
//             $switch: {
//               branches: [
//                 { case: { $eq: ["$_id.code", 1] }, then: "running" },
//                 { case: { $eq: ["$_id.code", 0] }, then: "paused" }
//               ],
//               default: "fault"
//             }
//           }
//         }},
//         // Group by machine to get status totals
//         {$group: {
//           _id: "$_id.serial",
//           machineName: { $first: "$_id.machineName" },
//           runningCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "running"] },
//                 "$count",
//                 0
//               ]
//             }
//           },
//           pausedCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "paused"] },
//                 "$count",
//                 0
//               ]
//             }
//           },
//           faultCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "fault"] },
//                 "$count",
//                 0
//               ]
//             }
//           }
//         }},
//         // Convert counts to milliseconds (simplified approach)
//         {$set: {
//           runningMs: { $multiply: ["$runningCount", 60000] }, // 1 minute per count as proxy
//           pausedMs: { $multiply: ["$pausedCount", 60000] },
//           faultedMs: { $multiply: ["$faultCount", 60000] }
//         }},
//         {$project: {
//           _id: 0,
//           serial: "$_id",
//           name: { $ifNull: ["$machineName", "Unknown"] },
//           runningMs: 1,
//           pausedMs: 1,
//           faultedMs: 1
//         }}
//       ];

//       // Simplified aggregation pipeline for counts
//       const countsAgg = [
//         {$match: {
//           timestamp: {$gte: start, $lte: end},
//           misfeed: { $ne: true },
//           'operator.id': { $exists: true, $ne: -1 }
//         }},
//         {$set: {
//           itemName: { $ifNull: ["$item.name", "Unknown"] },
//           hour: { $hour: { date: "$timestamp", timezone: TZ } },
//           day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
//           serial: "$machine.serial",
//           operatorId: "$operator.id",
//           operatorName: "$operator.name"
//         }},
//         {$facet: {
//           // Item hourly stack
//           itemHourlyStackRaw: [
//             {$group: { 
//               _id: { item: "$itemName", hour: "$hour" }, 
//               count: { $sum: 1 } 
//             }},
//             {$sort: { "_id.item": 1, "_id.hour": 1 }}
//           ],
      
//           // Daily count totals (last 28 days)
//           last28Days: [
//             {$group: { _id: "$day", count: { $sum: 1 } }},
//             {$sort: { "_id": 1 }},
//             {$project: { _id: 0, date: "$_id", count: 1 }}
//           ],
      
//           // Operator counts
//           operatorCounts: [
//             {$group: {
//               _id: "$operatorId",
//               name: { $first: "$operatorName" },
//               validCount: { $sum: 1 }
//             }},
//             {$project: { _id: 0, id: "$_id", name: { $ifNull: ["$name", "Unknown"] }, validCount: 1 }}
//           ],
      
//           // Per-machine, per-hour counts
//           countsByMachineHour: [
//             {$group: {
//               _id: { serial: "$serial", hour: "$hour" },
//               valid: { $sum: 1 }
//             }},
//             {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", valid: 1 }}
//           ],
      
//           // Per-machine, per-hour misfeeds
//           misfeedsByMachineHour: [
//             {$match: { misfeed: true }},
//             {$set: { 
//               hour: { $hour: { date: "$timestamp", timezone: TZ } }, 
//               serial: "$machine.serial" 
//             }},
//             {$group: {
//               _id: { serial: "$serial", hour: "$hour" },
//               misfeed: { $sum: 1 }
//             }},
//             {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", misfeed: 1 }}
//           ]
//         }}
//       ];

//       // Execute aggregation queries with timeout
//       const aggregationOptions = { 
//         allowDiskUse: true,
//         maxTimeMS: 300000 // 5 minute timeout
//       };

//       logger.info(`Executing states aggregation for ${start} to ${end}`);
//       const [stateFacets] = await db.collection('state')
//         .aggregate(statesAgg, aggregationOptions)
//         .toArray();
      
//       logger.info(`Executing counts aggregation for ${start} to ${end}`);
//       const [countFacets] = await db.collection('count')
//         .aggregate(countsAgg, aggregationOptions)
//         .toArray();
  
//       // Validate aggregation results
//       if (!stateFacets || !countFacets) {
//         logger.error('Aggregation returned null results', { stateFacets, countFacets });
//         return res.status(500).json({ 
//           error: "Failed to retrieve data from database",
//           details: "Aggregation returned null results"
//         });
//       }

//       logger.info(`States aggregation returned ${stateFacets.length} results`);
//       logger.info(`Counts aggregation returned ${Object.keys(countFacets).length} facets`);

//       // Transform data to match expected formats
//       logger.info('Transforming machine status data...');
//       const machineStatus = stateFacets || [];
      
//       logger.info('Calculating machine OEE...');
//       const machineOee = (stateFacets || [])
//         .map(m => {
//           const totalRuntime = (m.runningMs || 0) + (m.pausedMs || 0) + (m.faultedMs || 0);
//           return {
//             serial: m.serial,
//             name: m.name,
//             oee: totalRuntime ? +((m.runningMs / totalRuntime) * 100).toFixed(2) : 0
//           };
//         })
//         .sort((a,b) => b.oee - a.oee);
  
//       logger.info('Building item hourly stack...');
//       const itemHourlyStack = reshapeItemHourly(countFacets.itemHourlyStackRaw || []);
  
//       logger.info('Building top operators...');
//       // Create operator runtime data from machine status (simplified approach)
//       const operatorRuntime = (countFacets.operatorCounts || []).map(op => ({
//         id: op.id,
//         name: op.name,
//         runtime: 0 // Simplified - would need actual state data for operators
//       }));
  
//       const topOperators = buildTopOperators(
//         operatorRuntime,
//         countFacets.operatorCounts || []
//       );
  
//       logger.info('Building plantwide metrics...');
//       // Create hourly runtime data for plantwide metrics
//       const hourlyRuntimeByMachine = (stateFacets || []).map(machine => {
//         const totalRuntime = (machine.runningMs || 0) + (machine.pausedMs || 0) + (machine.faultedMs || 0);
//         return {
//           serial: machine.serial,
//           hour: 0, // Default to hour 0 for now - would need actual hour data
//           runtimeMs: totalRuntime,
//           runMs: machine.runningMs || 0
//         };
//       });

//       // Use the proper helper function for plantwide metrics
//       const plantwideMetrics = buildPlantwideHourly(
//         hourlyRuntimeByMachine,
//         countFacets.countsByMachineHour || [],
//         countFacets.misfeedsByMachineHour || []
//       );
  
//       logger.info('Building daily counts...');
//       const dailyCounts = (countFacets.last28Days || []).map(d => ({
//         date: d.date,
//         count: d.count
//       }));

//       logger.info('Sending response...');
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       });
//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      
//       res.status(500).json({ 
//         error: "Failed to fetch full daily dashboard data",
//         details: process.env.NODE_ENV === 'development' ? err.message : undefined
//       });
//     }
//   });

//   router.get('/analytics/daily-dashboard/daily-counts', async (req, res) => {
//     try {
//       const { start, end } = parseAndValidateQueryParams(req);
//       const dailyCounts = await buildDailyCountTotals(db, start, end);
      
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch daily count totals" });
//     }
//   });

//   router.get("/analytics/daily-summary-dashboard", async (req, res) => {
//     try {
//       const queryStartTime = Date.now();
//       const { start, end, serial } = parseAndValidateQueryParams(req);
//       const targetSerials = serial ? [parseInt(serial)] : await db.collection("machine").distinct("serial");
  
//       const machineResults = [];
//       const items = [];
  
//       for (const machineSerial of targetSerials) {
//         const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
//         if (!bookended) continue;
  
//         const { sessionStart, sessionEnd, states } = bookended;
//         const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
//         const misfeeds = await getMisfeedCounts(db, machineSerial, sessionStart, sessionEnd);
  
//         // ========== MACHINE RESULTS ==========
//         const performance = await buildMachinePerformance(states, counts, misfeeds, sessionStart, sessionEnd);
//         const itemSummary = buildMachineItemSummary(states, counts, sessionStart, sessionEnd);
//         const itemHourlyStack = buildItemHourlyStack(counts, sessionStart, sessionEnd);
//         const faultData = buildFaultData(states, sessionStart, sessionEnd);
//         const operatorEfficiency = await buildOperatorEfficiency(states, counts, sessionStart, sessionEnd, machineSerial);
  
//         const latestState = states.at(-1);
//         const machineName = latestState?.machine?.name || "Unknown";
//         const statusCode = latestState?.status?.code || 0;
//         const statusName = latestState?.status?.name || "Unknown";
  
//         machineResults.push({
//           machine: { serial: machineSerial, name: machineName },
//           currentStatus: { code: statusCode, name: statusName },
//           performance,
//           itemSummary,
//           itemHourlyStack,
//           faultData,
//           operatorEfficiency
//         });
  
//         // ========== ITEM SUMMARY ==========
//         const runCycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;
  
//         const machineSummary = {
//           totalCount: 0,
//           totalWorkedMs: 0,
//           itemSummaries: {}
//         };
  
//         for (const cycle of runCycles) {
//           const cycleStart = new Date(cycle.start);
//           const cycleEnd = new Date(cycle.end);
//           const cycleMs = cycleEnd - cycleStart;
  
//           const cycleCounts = counts.filter(c => {
//             const ts = new Date(c.timestamp);
//             return ts >= cycleStart && ts <= cycleEnd;
//           });
//           if (!cycleCounts.length) continue;
  
//           const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
//           const workedTimeMs = cycleMs * Math.max(1, operators.size);
//           const itemGroups = groupCountsByItem(cycleCounts);
  
//           for (const [itemId, group] of Object.entries(itemGroups)) {
//             const countTotal = group.length;
//             const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
//             const name = group[0].item?.name || "Unknown";
  
//             if (!machineSummary.itemSummaries[itemId]) {
//               machineSummary.itemSummaries[itemId] = {
//                 count: 0,
//                 standard,
//                 workedTimeMs: 0,
//                 name
//               };
//             }
  
//             machineSummary.itemSummaries[itemId].count += countTotal;
//             machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
//             machineSummary.totalCount += countTotal;
//             machineSummary.totalWorkedMs += workedTimeMs;
//           }
//         }
  
//         for (const summary of Object.values(machineSummary.itemSummaries)) {
//           const workedTimeFormatted = formatDuration(summary.workedTimeMs);
//           const totalHours = summary.workedTimeMs / 3600000;
//           const pph = totalHours > 0 ? summary.count / totalHours : 0;
//           const efficiency = summary.standard > 0 ? pph / summary.standard : 0;
  
//           items.push({
//             itemName: summary.name,
//             workedTimeFormatted,
//             count: summary.count,
//             pph: Math.round(pph * 100) / 100,
//             standard: summary.standard,
//             efficiency: Math.round(efficiency * 10000) / 100
//           });
//         }
//       }
  
//       // ========== OPERATOR RESULTS ==========
//       const operatorGroupedData = await fetchGroupedAnalyticsData(db, start, end, "operator");
//       const operatorResults = await Promise.all(
//         Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
//           const numericOperatorId = parseInt(operatorId);
//           const { states, counts } = group;
  
//           if (!states.length && !counts.all.length) return null;
  
//           const performance = await buildOperatorPerformance(states, counts.valid, counts.misfeed, start, end);
//           const countByItem = await buildOperatorCountByItem(group, start, end);
//           const operatorName =
//             counts.valid[0]?.operator?.name ||
//             counts.all[0]?.operator?.name ||
//             "Unknown";
  
//           const latest = states.at(-1) || {};
  
//           return {
//             operator: { id: numericOperatorId, name: operatorName },
//             currentStatus: {
//               code: latest.status?.code || 0,
//               name: latest.status?.name || "Unknown"
//             },
//             metrics: {
//               runtime: {
//                 total: performance.runtime.total,
//                 formatted: performance.runtime.formatted
//               },
//               performance: {
//                 efficiency: {
//                   value: performance.performance.efficiency.value,
//                   percentage: performance.performance.efficiency.percentage
//                 }
//               }
//             },
//             countByItem
//           };
//         })
//       );
  
//       res.json({
//         timeRange: { start, end, total: formatDuration(Date.now() - queryStartTime) },
//         machineResults,
//         operatorResults: operatorResults.filter(Boolean),
//         items
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to generate daily summary dashboard" });
//     }
//   });


/*** Run Session Routes */
router.get("/run-session/state/cycles", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);

    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    // Step 3: Get all state records using state.js utility
    const states = await fetchStatesForMachine(
      db,
      serial,
      paddedStart,
      paddedEnd
    );

    // Step 4: Extract cycles using state.js utility
    const cycles = extractAllCyclesFromStates(states, start, end);
    const runningCycles = cycles.running;

    // Step 5: For each cycle, get count records using count.js utility
    for (const cycle of runningCycles) {
      const countData = await getCountRecords(
        db,
        serial,
        cycle.start,
        cycle.end
      );
      cycle.counts = countData;
    }

    res.json(runningCycles);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to fetch session cycles" });
  }
});

router.get("/run-session/state/operator-cycles", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);

    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    // Step 3: Get all state records using state.js utility
    const states = await fetchStatesForMachine(
      db,
      serial,
      paddedStart,
      paddedEnd
    );
    // Step 4: Group states by machine using state.js utility
    const groupedByMachine = groupStatesByMachine(states);

    const allResults = [];

    for (const machineKey of Object.keys(groupedByMachine)) {
      const group = groupedByMachine[machineKey];
      const { serial: machineSerial, mode: machineMode } = group.machine;
      const isAc360 = machineMode === "ac360";

      // Step 5: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(group.states, start, end);
      const runningCycles = cycles.running;

      // Step 6: For each cycle, get count records and process operators
      for (const cycle of runningCycles) {
        const countRecords = await getCountRecords(
          db,
          machineSerial,
          cycle.start,
          cycle.end
        );

        // Step 7: Get operator-item mapping using count.js utility
        const operatorMap = getOperatorItemMapFromCounts(countRecords);

        // Step 8: Format operators data
        cycle.operators = Object.entries(operatorMap).map(([opId, data]) => {
          const items = Object.entries(data.items).map(
            ([itemId, itemArray]) => ({
              id: itemArray[0].id,
              name: itemArray[0].name,
              standard: itemArray[0].standard,
              count: itemArray.length,
            })
          );

          return {
            id: parseInt(opId),
            name: data.name,
            items,
          };
        });
      }

      allResults.push({
        machine: group.machine,
        cycles: runningCycles,
      });
    }

    res.json(allResults);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch operator-based session cycles" });
  }
});


router.get("/analytics/machine-state-totals", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);
    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    let results;

    if (serial) {
      // If serial provided, process single machine
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Extract all types of cycles
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      // Calculate total durations
      const runningTime = runningCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const pausedTime = pausedCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const faultedTime = faultCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );

      // Helper function to format duration with hours, minutes, and seconds
      const formatDurationWithSeconds = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return {
          hours,
          minutes,
          seconds,
        };
      };

      // Format response for this machine
      results = [
        {
          machine: {
            name: states[0].machine?.name || "Unknown",
            serial: parseInt(serial),
          },
          timeTotals: {
            running: {
              total: runningTime,
              formatted: formatDurationWithSeconds(runningTime),
              cycles: runningCycles,
            },
            paused: {
              total: pausedTime,
              formatted: formatDurationWithSeconds(pausedTime),
              cycles: pausedCycles,
            },
            faulted: {
              total: faultedTime,
              formatted: formatDurationWithSeconds(faultedTime),
              cycles: faultCycles,
            },
          },
          timeRange: {
            start: start,
            end: end,
            total: formatDurationWithSeconds(new Date(end) - new Date(start)),
          },
        },
      ];
    } else {
      // If no serial provided, process all machines
      results = await processAllMachinesCycles(db, paddedStart, paddedEnd);
    }

    res.json(results);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch machine state time totals" });
  }
});

router.get("/analytics/machine-hourly-states", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    let machines;
    if (serial) {
      machines = [{ serial: parseInt(serial) }];
    } else {
      machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
    }

    const startDate = new Date(end);
    const titleDate = startDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });

    const results = [];

    for (const machine of machines) {
      const states = await fetchStatesForMachine(
        db,
        machine.serial,
        paddedStart,
        paddedEnd
      );
      if (!states.length) continue;

      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      const runningHours = calculateHourlyStateDurations(
        runningCycles,
        start,
        end,
        "Running"
      );
      const pausedHours = calculateHourlyStateDurations(
        pausedCycles,
        start,
        end,
        "Paused"
      );
      const faultedHours = calculateHourlyStateDurations(
        faultCycles,
        start,
        end,
        "Faulted"
      );

      results.push({
        title: `Machine Activity - ${titleDate}`,
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          series: {
            Running: runningHours,
            Paused: pausedHours,
            Faulted: faultedHours,
          },
        },
        machine: {
          name: states[0].machine?.name || "Unknown",
          serial: machine.serial,
        },
      });
    }

    res.json(results);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch machine state time totals" });
  }
});


  /*** Analytics Routes: Machine dashboard old route using state and count collections */ 

  router.get("/analytics/machine-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);
      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (serial) {
        // If serial provided, get states for just that machine
        const machineStates = await fetchStatesForMachine(
          db,
          serial,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this machine
        groupedStates = {
          [serial]: {
            machine: {
              serial: serial,
              name: machineStates[0]?.machine?.name || null,
              mode: machineStates[0]?.program?.mode || null,
            },
            states: machineStates,
          },
        };
      } else {
        // If no serial, get all states and group them
        const allStates = await fetchStatesForMachine(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByMachine(allStates);
      }

      const results = [];

      // Process each machine's states
      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const states = group.states;

        // Skip if no states found for this machine
        if (!states.length) continue;

        // Extract all types of cycles
        const cycles = extractAllCyclesFromStates(states, start, end);
        const runningCycles = cycles.running;

        // Get counts for this machine
        const validCounts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        // Get misfeed counts for this machine
        const misfeedCounts = await getMisfeedCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );

        // Calculate metrics for this machine
        const totalQueryMs = new Date(end) - new Date(start);
        const runtimeMs = runningCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );
        const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);
        const totalCount = calculateTotalCount(validCounts, misfeedCounts);
        const misfeedCount = calculateMisfeeds(misfeedCounts);
        const availability = calculateAvailability(
          runtimeMs,
          downtimeMs,
          totalQueryMs
        );
        const throughput = calculateThroughput(totalCount, misfeedCount);
        const efficiency = calculateEfficiency(
          runtimeMs,
          totalCount,
          validCounts
        );
        const oee = calculateOEE(availability, efficiency, throughput);

        // Get current status for this machine
        const currentState = states[states.length - 1] || {};

        // Format response for this machine
        const machineResponse = {
          machine: {
            name: currentState.machine?.name || "Unknown",
            serial: currentState.machine?.serial || parseInt(machineSerial),
          },
          currentStatus: {
            code: currentState.status?.code || 0,
            name: currentState.status?.name || "Unknown",
          },
          metrics: {
            runtime: {
              total: runtimeMs,
              formatted: formatDuration(runtimeMs),
            },
            downtime: {
              total: downtimeMs,
              formatted: formatDuration(downtimeMs),
            },
            output: {
              totalCount,
              misfeedCount,
            },
            performance: {
              availability: {
                value: availability,
                percentage: (availability * 100).toFixed(2) + "%",
              },
              throughput: {
                value: throughput,
                percentage: (throughput * 100).toFixed(2) + "%",
              },
              efficiency: {
                value: efficiency,
                percentage: (efficiency * 100).toFixed(2) + "%",
              },
              oee: {
                value: oee,
                percentage: (oee * 100).toFixed(2) + "%",
              },
            },
          },
          timeRange: {
            start: start,
            end: end,
            total: formatDuration(totalQueryMs),
          },
        };

        results.push(machineResponse);
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch machine performance metrics" });
    }
  });


// Old route for operator dashboard using state and count collections
  
  router.get("/analytics/operator-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (operatorId) {
        // If operatorId provided, get states for just that operator
        states = await fetchStatesForOperator(
          db,
          operatorId,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this operator
        groupedStates = {
          [operatorId]: {
            operator: {
              id: operatorId,
              name: await getOperatorNameFromCount(db, operatorId),
            },
            states: states,
          },
        };
      } else {
        // If no operatorId, get all states and group them by operator
        const allStates = await fetchStatesForOperator(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByOperator(allStates);

        // Update operator names for all groups
        for (const [opId, group] of Object.entries(groupedStates)) {
          group.operator.name = await getOperatorNameFromCount(db, opId);
        }
      }

      // Step 3: Get all operator IDs for count query
      const operatorIds = Object.keys(groupedStates).map((id) => parseInt(id));

      // Get counts for all operators in a single query
      const allCounts = await db
        .collection("count")
        .find({
          "operator.id": { $in: operatorIds },
          "timestamps.create": { $gte: new Date(start), $lte: new Date(end) },
        })
        .sort({ "timestamps.create": 1 })
        .toArray();

      // Group counts by operator
      const operatorCounts = {};
      for (const count of allCounts) {
        const opId = count.operator?.id;
        if (!opId) continue;

        if (!operatorCounts[opId]) {
          operatorCounts[opId] = {
            counts: [],
            validCounts: [],
            misfeedCounts: [],
          };
        }

        operatorCounts[opId].counts.push(count);
        if (count.misfeed) {
          operatorCounts[opId].misfeedCounts.push(count);
        } else {
          operatorCounts[opId].validCounts.push(count);
        }
      }

      const results = [];

      // Step 4: Process each operator's data in parallel
      const operatorResults = await Promise.all(
        Object.entries(groupedStates).map(async ([operatorId, group]) => {
          const states = group.states;

          // Skip if no states found for this operator
          if (!states.length) return null;

          // Get counts for this operator
          const counts = operatorCounts[parseInt(operatorId)];
          if (!counts) return null;

          // Process count statistics using the new utility function
          const stats = processCountStatistics(counts.counts);

          // Calculate metrics for this operator
          const totalQueryMs = new Date(end) - new Date(start);
          const {
            runtime: runtimeMs,
            pausedTime: pausedTimeMs,
            faultTime: faultTimeMs,
          } = calculateOperatorTimes(states, start, end);

          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            counts.validCounts
          );

          // Get current status for this operator
          const currentState = states[states.length - 1] || {};

          // Format response for this operator
          return {
            operator: {
              id: parseInt(operatorId),
              name: group.operator.name || "Unknown",
            },
            currentStatus: {
              code: currentState.status?.code || 0,
              name: currentState.status?.name || "Unknown",
            },
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              pausedTime: {
                total: pausedTimeMs,
                formatted: formatDuration(pausedTimeMs),
              },
              faultTime: {
                total: faultTimeMs,
                formatted: formatDuration(faultTimeMs),
              },
              output: {
                totalCount: stats.total,
                misfeedCount: stats.misfeeds,
                validCount: stats.valid,
              },
              performance: {
                piecesPerHour: {
                  value: piecesPerHour,
                  formatted: Math.round(piecesPerHour).toString(),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2) + "%",
                },
              },
            },
            timeRange: {
              start: start,
              end: end,
              total: formatDuration(totalQueryMs),
            },
          };
        })
      );

      // Filter out null results and send response
      res.json(operatorResults.filter((result) => result !== null));
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator performance metrics" });
    }
  });


  router.get("/analytics/machine/operator-efficiency", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Step 3: Get hourly intervals
      const hourlyIntervals = getHourlyIntervals(paddedStart, paddedEnd);
      // Availability is runtime over scheduled shift time, matching the production stats cache.
      const activeShifts = await loadActiveShifts(db).catch(() => []);

      // Step 4: Get states and counts for the entire period
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );
      const counts = await getCountsForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 5: Process each hour
      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          // Filter states and counts for this hour
          const hourStates = states.filter((state) => {
            const stateTime = new Date(recordTimestamp(state));
            return stateTime >= interval.start && stateTime <= interval.end;
          });

          const hourCounts = counts.filter((count) => {
            const countTime = new Date(recordTimestamp(count));
            return countTime >= interval.start && countTime <= interval.end;
          });

          // Group counts by operator and machine
          const groupedCounts = groupCountsByOperatorAndMachine(hourCounts);

          // Calculate metrics for each operator
          const operatorMetrics = {};

          // Get unique operator IDs from counts
          const operatorIds = new Set();
          hourCounts.forEach((count) => {
            if (count.operator && count.operator.id) {
              operatorIds.add(count.operator.id);
            }
          });

          // Calculate total runtime for the hour from states
          const { runtime: totalRuntime } = calculateOperatorTimes(
            hourStates,
            interval.start,
            interval.end
          );

          // Process each operator
          for (const operatorId of operatorIds) {
            const countGroup = groupedCounts[`${operatorId}-${serial}`];
            if (!countGroup) continue;

            // Get operator name from first count
            const operatorName =
              countGroup.counts[0]?.operator?.name || "Unknown";

            // Process count statistics
            const stats = processCountStatistics(countGroup.counts);

            // Calculate efficiency
            const efficiency = calculateEfficiency(
              totalRuntime,
              stats.total,
              countGroup.validCounts
            );

            operatorMetrics[operatorId] = {
              name: operatorName,
              runTime: totalRuntime,
              validCounts: stats.valid,
              totalCounts: stats.total,
              efficiency: efficiency * 100, // Convert to percentage
            };
          }

          // Calculate OEE for this hour (shift-aware denominator)
          const shiftElapsedMs = computeShiftElapsedMs(activeShifts, interval.start, interval.end);
          const availability = shiftElapsedMs > 0 ? (totalRuntime / shiftElapsedMs) * 100 : 0;

          const avgEfficiency =
            Object.values(operatorMetrics).length > 0
              ? Object.values(operatorMetrics).reduce(
                (sum, op) => sum + op.efficiency,
                0
              ) / Object.keys(operatorMetrics).length
              : 0;

          const totalValidCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.validCounts,
            0
          );
          const totalCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.totalCounts,
            0
          );
          const throughput =
            totalCounts > 0 ? (totalValidCounts / totalCounts) * 100 : 0;

          const oee =
            calculateOEE(
              availability / 100,
              avgEfficiency / 100,
              throughput / 100
            ) * 100;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(oee * 100) / 100,
            operators: Object.entries(operatorMetrics).map(([id, metrics]) => ({
              id: parseInt(id),
              name: metrics.name,
              efficiency: Math.round(metrics.efficiency * 100) / 100,
            })),
          };
        })
      );

      // Step 6: Format response
      const response = {
        machine: {
          serial: parseInt(serial),
          name: states[0]?.machine?.name || "Unknown",
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        hourlyData,
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to calculate operator efficiency" });
    }
  });

  // New route using buildTopOperatorEfficiencyFromSessions function
  router.get("/analytics/machine/operator-efficiency-fromSessions", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Step 2: Create time range
      const dayStart = new Date(start);
      const dayEnd = new Date(end);

      // Step 3: Get machine information from states collection
      const statesColl = db.collection(config.stateCollectionName);
      const machineInfo = await statesColl.findOne({
        "machine.serial": parseInt(serial)
      });

      if (!machineInfo) {
        return res.status(404).json({ error: "Machine not found" });
      }

      // Step 4: Get hourly intervals
      const hourlyIntervals = getHourlyIntervals(dayStart, dayEnd);

      // Step 5: Process each hour using operator sessions
      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          // Get operator efficiency data for this hour using the session-based function
          const operatorData = await dailyDashboardSessionRoutesSplit.buildTopOperatorEfficiencyFromSessions(db, interval.start, interval.end);

          // Get operator sessions for this specific machine and hour
          const osColl = db.collection(config.operatorSessionCollectionName);
          const machineOperatorSessions = await osColl.find({
            "machine.serial": parseInt(serial),
            "timestamps.start": { $lt: interval.end },
            $or: [
              { "timestamps.end": { $gt: interval.start } },
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": null }
            ],
            "operator.id": { $exists: true, $ne: -1 }
          }).toArray();

          // Group by operator and calculate efficiency for this machine
          const operatorMap = new Map();

          for (const session of machineOperatorSessions) {
            const opId = session.operator.id;
            const opName = session.operator.name || `#${opId}`;

            if (!operatorMap.has(opId)) {
              operatorMap.set(opId, {
                id: opId,
                name: opName,
                workTime: 0,
                timeCredit: 0,
                totalCount: 0,
                misfeedCount: 0
              });
            }

            const op = operatorMap.get(opId);
            const { factor } = calculateOverlapFactor(session.timestamps?.start, session.timestamps?.end, interval.start, interval.end);

            op.workTime += (session.workTime || 0) * factor;
            op.timeCredit += (session.totalTimeCredit || 0) * factor;
            op.totalCount += (session.totalCount || 0) * factor;
            op.misfeedCount += (session.misfeedCount || 0) * factor;
          }

          // Calculate efficiency for each operator
          const operators = Array.from(operatorMap.values()).map(op => {
            const efficiency = op.workTime > 0 ? (op.timeCredit / op.workTime) : 0;
            return {
              id: op.id,
              name: op.name,
              efficiency: Math.round(efficiency * 10000) / 100 // Round to 2 decimal places
            };
          });

          // Calculate average OEE for this hour
          const avgEfficiency = operators.length > 0
            ? operators.reduce((sum, op) => sum + op.efficiency, 0) / operators.length
            : 0;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(avgEfficiency * 100) / 100,
            operators: operators
          };
        })
      );

      // Step 6: Format response to match original route structure
      const response = {
        machine: {
          serial: parseInt(serial),
          name: machineInfo.machine?.name || "Unknown",
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        hourlyData,
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to calculate operator efficiency from sessions" });
    }
  });

  function calculateOverlapFactor(sStart, sEnd, wStart, wEnd) {
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const f = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor: f };
  }

  router.get("/analytics/operator-countbyitem", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      // Validate start
      if (!start)
        return res
          .status(400)
          .json({ error: "Start time parameter is required" });
      const startDate = new Date(start);
      if (isNaN(startDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid start time format. Use ISO string" });
      }

      // Validate operatorId
      if (!operatorId || isNaN(parseInt(operatorId))) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      // Validate end
      let endDate;
      if (end) {
        endDate = new Date(end);
        if (isNaN(endDate.getTime())) {
          return res
            .status(400)
            .json({ error: "Invalid end time format. Use ISO string" });
        }
      }

      const [latestState] = await Promise.all([
        db
          .collection("state")
          .find()
          .sort({ "timestamps.create": -1 })
          .limit(1)
          .toArray(),
      ]);

      const finalEnd = endDate
        ? endDate.toISOString()
        : recordTimestamp(latestState) || new Date().toISOString();
      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        new Date(finalEnd)
      );

      // Fetch states for specific operator
      const allStates = await fetchStatesForOperator(
        db,
        parseInt(operatorId),
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = {
            ...group,
            completedCycles,
          };
        }
      }

      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        finalEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      const results = [];

      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [opId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${opId}-${machineSerial}`];
        if (!countGroup) continue;

        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(recordTimestamp(a)) - new Date(recordTimestamp(b))
        );
        let countIndex = 0;

        for (const cycle of group.completedCycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleCounts = [];

          while (countIndex < sortedCounts.length) {
            const currentCount = sortedCounts[countIndex];
            const countTimestamp = new Date(recordTimestamp(currentCount));

            if (countTimestamp < cycleStart) {
              countIndex++;
              continue;
            }
            if (countTimestamp > cycleEnd) break;

            cycleCounts.push(currentCount);
            countIndex++;
          }

          if (!cycleCounts.length) continue;

          const stats = processCountStatistics(cycleCounts);
          const { runtime: runtimeMs } = calculateOperatorTimes(
            cycle.states,
            cycleStart,
            cycleEnd
          );
          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            countGroup.validCounts
          );
          const itemNames = extractItemNamesFromCounts(cycleCounts);

          results.push({
            operatorId: parseInt(opId),
            machineSerial: parseInt(machineSerial),
            startTimestamp: cycleStart.toISOString(),
            endTimestamp: cycleEnd.toISOString(),
            totalCount: stats.valid,
            task: itemNames,
            standard: Math.round(piecesPerHour * efficiency),
          });
        }
      }

      // === Post-process results into hourly stacked bar chart format ===
      const hourItemMap = {};
      const itemsSet = new Set();

      // Distribute counts evenly per task per hour
      for (const entry of results) {
        const ts = new Date(entry.startTimestamp);
        const hour = ts.getHours();

        const tasks =
          typeof entry.task === "string"
            ? entry.task.split(",").map((t) => t.trim())
            : [];
        const perItemCount = Math.floor(entry.totalCount / tasks.length);

        tasks.forEach((item) => {
          itemsSet.add(item);
          if (!hourItemMap[hour]) hourItemMap[hour] = {};
          if (!hourItemMap[hour][item]) hourItemMap[hour][item] = 0;
          hourItemMap[hour][item] += perItemCount;
        });
      }

      // Build full list of hour integers between start and end
      const fullHourRange = [];
      const temp = new Date(startDate);
      temp.setMinutes(0, 0, 0);
      const endHourDate = new Date(endDate);
      endHourDate.setMinutes(0, 0, 0);

      while (temp <= endHourDate) {
        fullHourRange.push(temp.getHours());
        temp.setHours(temp.getHours() + 1);
      }

      // Format hours to '1am', '12pm', etc.
      function formatHour(hour) {
        if (hour === 0) return "12am";
        if (hour === 12) return "12pm";
        if (hour < 12) return `${hour}am`;
        return `${hour - 12}pm`;
      }

      const formattedHours = fullHourRange.map(formatHour);

      // Ensure operator/item counts match the full hour list
      const allItems = Array.from(itemsSet).sort();
      const operators = {};
      for (const item of allItems) {
        operators[item] = fullHourRange.map(
          (hour) => hourItemMap[hour]?.[item] || 0
        );
      }

      // Final response
      const response = {
        title: "Operator Counts by item",
        data: {
          hours: fullHourRange,
          operators,
        },
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to process data for operator" });
    }
  });


  // Old fault history route using state collection

  
  router.get("/analytics/fault-history", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Fetch states for the specified machine
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummary: [] });
      }

      // Extract fault cycles
      const { faultCycles, faultSummaries } = extractFaultCycles(
        states,
        start,
        end
      );

      res.json({
        faultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  router.get("/analytics/operator-fault-history", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      if (!start || !end || !operatorId) {
        return res
          .status(400)
          .json({ error: "Start time, end time, and operatorId are required" });
      }

      // Convert string dates to Date objects
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Please use ISO date strings" });
      }

      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        endDate
      );
      const parsedOperatorId = parseInt(operatorId);

      if (isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Invalid operatorId" });
      }

      // Get all machine states where this operator was present
      const states = await fetchStatesForOperator(
        db,
        parsedOperatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummaries: [] });
      }

      // Group states by machine to process each machine's fault cycles separately
      const groupedStates = groupStatesByOperatorAndSerial(states);
      const allFaultCycles = [];
      const faultTypeMap = new Map(); // For aggregating fault summaries

      // Process each machine's states
      for (const [key, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";

        // Extract fault cycles for this machine
        const { faultCycles, faultSummaries } = extractFaultCycles(
          machineStates,
          startDate,
          endDate
        );

        // Add machine info to each fault cycle
        const machineFaultCycles = faultCycles.map((cycle) => ({
          ...cycle,
          machineName,
          machineSerial: group.machine?.serial,
        }));

        allFaultCycles.push(...machineFaultCycles);

        // Aggregate fault summaries
        for (const summary of faultSummaries) {
          const key = summary.faultType;
          if (!faultTypeMap.has(key)) {
            faultTypeMap.set(key, {
              faultType: key,
              count: 0,
              totalDuration: 0,
            });
          }
          const existing = faultTypeMap.get(key);
          existing.count += summary.count;
          existing.totalDuration += summary.totalDuration;
        }
      }

      // Convert fault summaries to array and format durations
      const faultSummaries = Array.from(faultTypeMap.values()).map(
        (summary) => {
          const totalSeconds = Math.floor(summary.totalDuration / 1000);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          return {
            ...summary,
            formatted: {
              hours,
              minutes,
              seconds,
            },
          };
        }
      );

      // Sort fault cycles by start time
      allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));

      res.json({
        faultCycles: allFaultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator fault history" });
    }
  });


  //Old routes that use state and count collections


  router.get("/analytics/machine-item-summary", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        serial || null,
        paddedStart,
        paddedEnd
      );
      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByMachine(allStates);

      const results = await Promise.all(
        Object.entries(groupedStates).map(async ([machineSerial, group]) => {
          const machineName = group.machine?.name || "Unknown";
          const machineStates = group.states;

          const cycles = extractAllCyclesFromStates(
            machineStates,
            start,
            end
          ).running;

          if (!cycles.length) {
            return {
              machine: {
                name: machineName,
                serial: parseInt(machineSerial),
              },
              sessions: [],
              machineSummary: {
                totalCount: 0,
                workedTimeMs: 0,
                workedTimeFormatted: "0m",
                pph: 0,
                proratedStandard: 0,
                efficiency: 0,
                itemSummaries: {},
              },
            };
          }

          const allCounts = await getValidCounts(
            db,
            parseInt(machineSerial),
            start,
            end
          );

          let totalCount = 0;
          let totalWorkedMs = 0;
          const itemSummaries = {};
          const sessions = [];

          for (const cycle of cycles) {
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            const cycleMs = cycleEnd - cycleStart;

            const cycleCounts = allCounts.filter((c) => {
              const ts = new Date(recordTimestamp(c));
              return ts >= cycleStart && ts <= cycleEnd;
            });

            if (!cycleCounts.length) continue;

            const uniqueOperatorIds = new Set(
              cycleCounts.map((c) => c.operator?.id).filter(Boolean)
            );
            const workedTimeMs = cycleMs * Math.max(1, uniqueOperatorIds.size);

            const groupedCounts = groupCountsByItem(cycleCounts);

            for (const [itemId, records] of Object.entries(groupedCounts)) {
              const count = records.length;
              const standard = records[0].item?.standard || 666;
              const name = records[0].item?.name || "Unknown";

              if (!itemSummaries[itemId]) {
                itemSummaries[itemId] = {
                  name,
                  standard,
                  count: 0,
                  workedTimeMs: 0,
                };
              }

              itemSummaries[itemId].count += count;
              itemSummaries[itemId].workedTimeMs += workedTimeMs;
              totalCount += count;
              totalWorkedMs += workedTimeMs;
            }

            sessions.push({
              start: cycleStart.toISOString(),
              end: cycleEnd.toISOString(),
              workedTimeMs,
              workedTimeFormatted: formatDuration(workedTimeMs),
            });
          }

          // Final aggregation (1-pass)
          let proratedStandard = 0;
          const itemSummariesFormatted = {};

          for (const [itemId, summary] of Object.entries(itemSummaries)) {
            const hours = summary.workedTimeMs / 3600000;
            const pph = hours > 0 ? summary.count / hours : 0;
            const efficiency =
              summary.standard > 0 ? pph / summary.standard : 0;

            const weight = totalCount > 0 ? summary.count / totalCount : 0;
            proratedStandard += weight * summary.standard;

            itemSummariesFormatted[itemId] = {
              name: summary.name,
              standard: summary.standard,
              countTotal: summary.count,
              workedTimeFormatted: formatDuration(summary.workedTimeMs),
              pph: Math.round(pph * 100) / 100,
              efficiency: Math.round(efficiency * 10000) / 100,
            };
          }

          const totalHours = totalWorkedMs / 3600000;
          const machinePph = totalHours > 0 ? totalCount / totalHours : 0;
          const machineEff =
            proratedStandard > 0 ? machinePph / proratedStandard : 0;

          return {
            machine: {
              name: machineName,
              serial: parseInt(machineSerial),
            },
            sessions,
            machineSummary: {
              totalCount,
              workedTimeMs: totalWorkedMs,
              workedTimeFormatted: formatDuration(totalWorkedMs),
              pph: Math.round(machinePph * 100) / 100,
              proratedStandard: Math.round(proratedStandard * 100) / 100,
              efficiency: Math.round(machineEff * 10000) / 100,
              itemSummaries: itemSummariesFormatted,
            },
          };
        })
      );

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to generate machine item summary" });
    }
  });

  router.get("/analytics/operator-item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId
        ? parseInt(req.query.operatorId)
        : null;
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      // Fetch states filtered by operatorId if present
      const allStates = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // Filter operator-machine pairs by operatorId if present
      const allOperatorMachinePairs = Object.keys(groupedStates)
        .map((key) => {
          const [opId, machineSerial] = key.split("-").map(Number);
          return { operatorId: opId, machineSerial };
        })
        .filter((pair) => !operatorId || pair.operatorId === operatorId);

      if (!allOperatorMachinePairs.length) return res.json([]);

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        allOperatorMachinePairs,
        paddedStart,
        paddedEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // Process each operator-machine pair in parallel
      const results = await Promise.all(
        Object.entries(groupedCounts).map(async ([key, countGroup]) => {
          const { operator, machine, validCounts, misfeedCounts } = countGroup;

          // Skip if operatorId is provided and doesn't match
          if (operatorId && operator?.id !== operatorId) return null;

          const states = groupedStates[key]?.states || [];
          if (!states.length) return null;

          const runCycles = getCompletedCyclesForOperator(states);
          if (!runCycles.length) return null;

          const totalRunMs = runCycles.reduce(
            (acc, cycle) => acc + (cycle.duration || 0),
            0
          );

          const itemMap = groupCountsByItem(validCounts);
          if (!Object.keys(itemMap).length) return null;

          // Pre-calculate misfeed counts by item for efficiency
          const misfeedByItem = {};
          for (const misfeed of misfeedCounts) {
            const itemId = misfeed.item?.id;
            if (itemId) {
              misfeedByItem[itemId] = (misfeedByItem[itemId] || 0) + 1;
            }
          }

          const hours = totalRunMs / 3600000;
          const workedTimeFormatted = formatDuration(totalRunMs);

          // Process all items for this operator-machine pair
          const itemResults = [];
          for (const [itemId, group] of Object.entries(itemMap)) {
            const item = group[0]?.item || {};
            const count = group.length;
            const misfeeds = misfeedByItem[parseInt(itemId)] || 0;
            const pph = hours > 0 ? count / hours : 0;
            const standard = item.standard > 0 ? item.standard : 666;
            const efficiency = standard > 0 ? pph / standard : 0;

            itemResults.push({
              operatorName: operator?.name || "Unknown",
              machineName: machine?.name || "Unknown",
              itemName: item?.name || "Unknown",
              workedTimeFormatted,
              count,
              misfeed: misfeeds,
              pph: Math.round(pph * 100) / 100,
              standard,
              efficiency: Math.round(efficiency * 10000) / 100,
            });
          }

          return itemResults;
        })
      );

      // Flatten results and consolidate duplicates in a single pass
      const consolidated = {};
      const flatResults = results.filter(Boolean).flat();

      for (const row of flatResults) {
        const key = `${row.operatorName}-${row.machineName}-${row.itemName}`;

        if (!consolidated[key]) {
          consolidated[key] = { ...row };
        } else {
          const existing = consolidated[key];
          existing.count += row.count;
          existing.misfeed += row.misfeed;

          // Convert formatted time back to milliseconds for calculation
          const existingMs =
            (existing.workedTimeFormatted.hours * 60 +
              existing.workedTimeFormatted.minutes) *
            60000;
          const newMs =
            (row.workedTimeFormatted.hours * 60 +
              row.workedTimeFormatted.minutes) *
            60000;
          const totalMs = existingMs + newMs;

          // Recalculate metrics
          const totalHours = totalMs / 3600000;
          const totalPph = totalHours > 0 ? existing.count / totalHours : 0;
          const totalEfficiency =
            existing.standard > 0 ? totalPph / existing.standard : 0;

          existing.workedTimeFormatted = formatDuration(totalMs);
          existing.pph = Math.round(totalPph * 100) / 100;
          existing.efficiency = Math.round(totalEfficiency * 10000) / 100;
        }
      }

      res.json(Object.values(consolidated));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate operator item summary report" });
    }
  });

  router.get("/analytics/item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        null,
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByMachine(allStates);

      const resultsMap = new Map();

      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";
        const cycles = extractAllCyclesFromStates(
          machineStates,
          start,
          end
        ).running;

        const counts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        if (!counts.length || !cycles.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(recordTimestamp(c));
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: parseInt(itemId),
                name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency = entry.standard > 0 ? pph / entry.standard : 0;

        return {
          itemName: entry.name,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 10000) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate item summary report" });
    }
  });

  router.get("/analytics/machine-item-hourly-item-stack", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      const counts = await getValidCounts(db, parseInt(serial), start, end);
      if (!counts.length)
        return res.json({
          title: "No data",
          data: { hours: [], operators: {} },
        });

      // Normalize counts into hour buckets
      const hourMap = new Map(); // hourIndex => { itemName => count }

      for (const count of counts) {
        const ts = new Date(recordTimestamp(count));
        const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000)); // hour offset since start
        const itemName = count.item?.name || "Unknown";

        if (!hourMap.has(hourIndex)) hourMap.set(hourIndex, {});
        const hourEntry = hourMap.get(hourIndex);
        hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
      }

      // Build structure: hours[], and for each item: count array by hour
      const maxHour = Math.max(...hourMap.keys());
      const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);
      const itemNames = new Set();

      // Collect all item names
      for (const hourEntry of hourMap.values()) {
        Object.keys(hourEntry).forEach((name) => itemNames.add(name));
      }

      // Initialize operator structure
      const operators = {};
      for (const name of itemNames) {
        operators[name] = Array(maxHour + 1).fill(0);
      }

      // Fill operator counts
      for (const [hourIndex, itemCounts] of hourMap.entries()) {
        for (const [itemName, count] of Object.entries(itemCounts)) {
          operators[itemName][hourIndex] = count;
        }
      }

      res.json({
        title: `Item Stacked Count Chart for Machine ${serial}`,
        data: {
          hours,
          operators,
        },
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to build item/hour stacked data" });
    }
  });

  router.get("/analytics/operator-cycle-pie", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!operatorId) {
        return res.status(400).json({ error: "Operator ID is required" });
      }

      // Step 3: Get all state records using state.js utility
      const states = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 4: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      // Calculate total durations
      const runningTime = runningCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const pausedTime = pausedCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const faultedTime = faultCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );

      const totalTime = runningTime + pausedTime + faultedTime;

      // Format response
      const response = [
        {
          name: "Running",
          value: Math.round((runningTime / totalTime) * 100),
        },
        {
          name: "Paused",
          value: Math.round((pausedTime / totalTime) * 100),
        },
        {
          name: "Faulted",
          value: Math.round((faultedTime / totalTime) * 100),
        },
      ];

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator cycle pie data" });
    }
  });
  router.get("/analytics/operator/daily-efficiency", async (req, res) => {
    try {
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
      const parsedOperatorId = parseInt(operatorId);

      if (!parsedOperatorId || isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);
      const days = [];
      let cursor = new Date(startDate);

      while (cursor <= endDate) {
        const startOfDay = new Date(cursor);
        const endOfDay = new Date(startOfDay);
        endOfDay.setUTCHours(23, 59, 59, 999);

        days.push({ start: new Date(startOfDay), end: new Date(endOfDay) });

        cursor.setUTCDate(cursor.getUTCDate() + 1); // Move to next day
      }

      const results = [];

      for (const day of days) {
        // 1. Get states for this day
        const dayStates = await fetchStatesForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );
        const runCycles = getCompletedCyclesForOperator(dayStates);
        const totalRunTimeMs = runCycles.reduce(
          (sum, cycle) => sum + cycle.duration,
          0
        );

        // 2. Get valid counts
        const validCounts = await getValidCountsForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );

        // 3. Estimate average standard from item data
        let avgStandard = 666; // default fallback
        if (validCounts.length > 0) {
          const standards = validCounts
            .map((c) => c.item?.standard)
            .filter((s) => typeof s === "number" && s > 0);

          if (standards.length > 0) {
            avgStandard =
              standards.reduce((sum, s) => sum + s, 0) / standards.length;
          }
        }

        // 4. Calculate PPH
        const hours = totalRunTimeMs / 3600000;
        const pph = hours > 0 ? validCounts.length / hours : 0;

        // 5. Calculate efficiency
        const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;

        results.push({
          date: day.start.toISOString().split("T")[0],
          efficiency: Math.round(efficiency * 100) / 100,
        });
      }

      const operatorName = await getOperatorNameFromCount(db, parsedOperatorId);

      res.json({
        operator: {
          id: parsedOperatorId,
          name: operatorName || "Unknown",
        },
        timeRange: {
          start,
          end,
          totalDays: results.length,
        },
        data: results,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to compute daily efficiency" });
    }
  });

  router.get("/analytics/item-dashboard-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      const machineSerials = await db.collection("machine").distinct("serial");

      const resultsMap = new Map();

      for (const serial of machineSerials) {
        const bookended = await getBookendedStatesAndTimeRange(
          db,
          serial,
          start,
          end
        );
        if (!bookended) continue;

        const { sessionStart, sessionEnd, states } = bookended;
        const cycles = extractAllCyclesFromStates(
          states,
          sessionStart,
          sessionEnd
        ).running;
        if (!cycles.length) continue;

        const counts = await getValidCounts(
          db,
          serial,
          sessionStart,
          sessionEnd
        );
        if (!counts.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(recordTimestamp(c));
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const itemIdNum = parseInt(itemId);
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: itemIdNum,
                itemName: name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency =
          entry.standard > 0 ? (pph / entry.standard) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 100) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate item dashboard summary" });
    }
  });

return router;

};
