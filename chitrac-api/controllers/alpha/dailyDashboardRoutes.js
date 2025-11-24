// 📁 dailyDashboardRoutes.js
const express = require("express");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const {
    buildTopOperatorEfficiency,
    buildDailyMachineStatus,
    buildMachineOEE,
    buildDailyItemHourlyStack,
    buildPlantwideMetricsByHour,
    buildDailyCountTotals
  } = require('../../utils/dailyDashboardBuilder'); 

  const {
    getAllOperatorIds,
    buildOperatorPerformance,
    buildOperatorItemSummary,
    buildOperatorCountByItem,
    buildOperatorCyclePie,
    buildOperatorFaultHistory,
    buildOperatorEfficiencyLine,
  } = require("../../utils/operatorDashboardBuilder");

  const {
    buildMachinePerformance,
    buildMachineItemSummary,
    buildItemHourlyStack,
    buildFaultData,
    buildOperatorEfficiency
  } = require("../../utils/machineDashboardBuilder");

  const {
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    formatDuration
  } = require('../../utils/time');

  
  const {
    groupStatesByMachine,
    groupStatesByOperator,
    extractAllCyclesFromStates,
    extractFaultCycles,
    fetchAllStates,
    groupStatesByOperatorAndSerial,
    fetchStatesForMachine,
    getAllMachineSerials,
    fetchStatesForOperator
  } = require("../../utils/state");

  const {
    getCountsForOperator,
    getValidCountsForOperator,
    getOperatorNameFromCount,
    processCountStatistics,
    groupCountsByItem,
    extractItemNamesFromCounts,
    groupCountsByOperatorAndMachine,
    getCountsForOperatorMachinePairs,
    groupCountsByOperator,
    getCountsForMachine,
    getValidCounts,
    getMisfeedCounts,
  } = require("../../utils/count");

  const { calculateAvailability, calculateThroughput, calculateEfficiency, calculateOEE, calculatePiecesPerHour, calculateOperatorTimes } = require("../../utils/analytics");

  const { fetchGroupedAnalyticsData } = require("../../utils/fetchData");

  const {getBookendedStatesAndTimeRange} = require("../../utils/bookendingBuilder")

  const config = require('../../modules/config');

  router.get('/analytics/daily-dashboard/full', async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
  
      const [
        machineStatus,
        machineOee,
        itemHourlyStack,
        topOperators,
        plantwideMetrics,
        dailyCounts
      ] = await Promise.all([
        buildDailyMachineStatus(db, start, end),
        buildMachineOEE(db, start, end),
        buildDailyItemHourlyStack(db, start, end),
        buildTopOperatorEfficiency(db, start, end),
        buildPlantwideMetricsByHour(db, start, end),
        buildDailyCountTotals(db, start, end)
      ]);
  
      return res.json({
        timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
        machineStatus,
        machineOee,
        itemHourlyStack,
        topOperators,
        plantwideMetrics,
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch full daily dashboard data" });
    }
  });



  // ---------- tiny utils ----------
function isoHour(d) {
  // Normalize to hour ISO key (keeps stable sort across TZ)
  return new Date(d).toISOString().slice(0, 13) + ':00:00.000Z';
}

// Default efficiency if you don't inject your own.
// Replace with your real formula if you have item standards etc.
function defaultCalcEfficiency(runtimeMs, validCount) {
  if (!runtimeMs) return 0;
  // counts per hour scaled to [0..1] assuming 600 cph is ~100% (tune this)
  const cph = validCount * (3_600_000 / runtimeMs);
  return Math.min(1, cph / 600);
}

// ---------- 1) Item Hourly Stack ----------
/**
 * @param {Array<{_id:{item:string,hour:Date},count:number}>} itemHourlyStackRaw
 * @returns {{ title: string, data: { hours: string[], operators: Record<string, number[]> } }}
 */
function reshapeItemHourly(itemHourlyStackRaw) {
  const hourSet = new Set();
  const perItem = new Map();

  for (const row of itemHourlyStackRaw) {
    const item = row._id.item ?? 'Unknown';
    const hourKey = isoHour(row._id.hour);
    hourSet.add(hourKey);
    if (!perItem.has(item)) perItem.set(item, new Map());
    perItem.get(item).set(hourKey, row.count);
  }

  const hours = Array.from(hourSet).sort(); // ISO hours ascending
  const operators = {};
  for (const [item, m] of perItem) {
    operators[item] = hours.map(h => m.get(h) ?? 0);
  }

  return {
    title: 'Item Counts by Hour (All Machines)',
    data: { hours, operators }
  };
}

// ---------- 2) Top Operators ----------
/**
 * @param {Array<{id:number,name?:string,runtime:number}>} operatorRuntime  // from states facet
 * @param {Array<{id:number,name?:string,validCount:number}>} operatorCounts // from counts facet
 * @param {(runtimeMs:number, validCount:number)=>number} [calcEfficiencyFn] // return 0..1
 */
function buildTopOperators(operatorRuntime, operatorCounts, calcEfficiencyFn = defaultCalcEfficiency) {
  const countsById = new Map(operatorCounts.map(o => [Number(o.id), o]));
  const rows = [];

  for (const r of operatorRuntime) {
    const id = Number(r.id);
    const c = countsById.get(id) || { validCount: 0, name: r.name };
    const runtime = r.runtime || 0;
    const valid = c.validCount || 0;
    const eff01 = calcEfficiencyFn(runtime, valid);

    rows.push({
      id,
      name: c.name || r.name || 'Unknown',
      efficiency: +(eff01 * 100).toFixed(2),
      metrics: {
        runtime: { total: runtime, formatted: formatDuration(runtime) },
        output: { totalCount: valid, validCount: valid, misfeedCount: 0 }
      }
    });
  }

  rows.sort((a, b) => b.efficiency - a.efficiency);
  return rows.slice(0, 10);
}

// ---------- 3) Plantwide Hourly (weighted by runtime) ----------
/**
 * @param {Array<{serial:number,hour:Date,runtimeMs:number,runMs:number}>} hourlyRuntimeByMachine
 * @param {Array<{serial:number,hour:Date,valid:number}>} countsByMachineHour
 * @param {Array<{serial:number,hour:Date,misfeed:number}>} [misfeedsByMachineHour=[]]
 * @param {(runtimeMs:number, validCount:number)=>number} [calcEfficiencyFn]
 * @returns {Array<{hour:number,availability:number,efficiency:number,throughput:number,oee:number}>}
 */
function buildPlantwideHourly(
  hourlyRuntimeByMachine,
  countsByMachineHour,
  misfeedsByMachineHour = [],
  calcEfficiencyFn = defaultCalcEfficiency
) {
  // index counts/misfeeds by serial|hourKey
  const key = (serial, hour) => serial + '|' + isoHour(hour);
  const countsIdx = new Map();
  for (const r of countsByMachineHour) {
    countsIdx.set(key(r.serial, r.hour), r.valid || 0);
  }
  const misIdx = new Map();
  for (const r of misfeedsByMachineHour) {
    misIdx.set(key(r.serial, r.hour), r.misfeed || 0);
  }

  // group runtime by hourKey then aggregate with weights
  const byHour = new Map(); // hourKey -> array of machine rows in that hour
  for (const r of hourlyRuntimeByMachine) {
    const hourKey = isoHour(r.hour);
    if (!byHour.has(hourKey)) byHour.set(hourKey, []);
    byHour.get(hourKey).push(r);
  }

  const out = [];
  for (const [hourKey, rows] of byHour) {
    let totalRuntime = 0;
    let wAvail = 0, wEff = 0, wThru = 0, wOee = 0;

    for (const r of rows) {
      const k = key(r.serial, hourKey);
      const runtime = r.runtimeMs || 0;
      if (!runtime) continue;

      const runMs = r.runMs || 0;
      const valid = countsIdx.get(k) || 0;
      const mis = misIdx.get(k) || 0;
      const hourWindowMs = 3_600_000;

      const availability = hourWindowMs ? (runMs / hourWindowMs) : 0;             // 0..1
      const throughput   = (valid + mis) > 0 ? (valid / (valid + mis)) : 0;       // 0..1
      const efficiency   = calcEfficiencyFn(runtime, valid);                       // 0..1
      const oee          = availability * efficiency * throughput;                 // 0..1

      totalRuntime += runtime;
      wAvail += availability * runtime;
      wEff   += efficiency   * runtime;
      wThru  += throughput   * runtime;
      wOee   += oee          * runtime;
    }

    if (totalRuntime > 0) {
      out.push({
        hour: new Date(hourKey).getHours(),
        availability: +( (wAvail / totalRuntime) * 100 ).toFixed(2),
        efficiency:   +( (wEff   / totalRuntime) * 100 ).toFixed(2),
        throughput:   +( (wThru  / totalRuntime) * 100 ).toFixed(2),
        oee:          +( (wOee   / totalRuntime) * 100 ).toFixed(2)
      });
    }
  }

  // sort by hour ascending just in case
  out.sort((a, b) => a.hour - b.hour);
  return out;
}

// ---------- 4) Machine OEE from facet ----------
/**
 * @param {Array<{serial:number,name:string,run:number,pause:number,fault:number,totalRuntime:number}>} machineOeeBase
 */
function shapeMachineOee(machineOeeBase) {
  const list = machineOeeBase.map(m => {
    const total = m.totalRuntime || (m.run + m.pause + m.fault) || 0;
    const oee = total ? (m.run / total) * 100 : 0;
    return { serial: m.serial, name: m.name || 'Unknown', oee: +oee.toFixed(2) };
  });
  list.sort((a, b) => b.oee - a.oee);
  return list;
}

  

  router.get('/analytics/daily-dashboard/full/new', async (req, res) => {
    try {
      // Validate database connection
      if (!db) {
        return res.status(500).json({ 
          error: "Database connection not available",
          details: "Server configuration error"
        });
      }

      const { start, end } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
      
      const TZ = "America/Chicago";
  
      // Simplified aggregation pipeline for states - using basic operations for compatibility
      const statesAgg = [
        {$match: { timestamp: {$gte: paddedStart, $lte: paddedEnd} }},
        {$set: {
          code: "$status.code",
          serial: "$machine.serial",
          machineName: "$machine.name"
        }},
        // Group by machine and status to get status counts
        {$group: {
          _id: { 
            serial: "$serial", 
            code: "$code",
            machineName: "$machineName"
          },
          count: { $sum: 1 }
        }},
        // Calculate status buckets
        {$set: {
          bucket: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id.code", 1] }, then: "running" },
                { case: { $eq: ["$_id.code", 0] }, then: "paused" }
              ],
              default: "fault"
            }
          }
        }},
        // Group by machine to get status totals
        {$group: {
          _id: "$_id.serial",
          machineName: { $first: "$_id.machineName" },
          runningCount: {
            $sum: {
              $cond: [
                { $eq: ["$bucket", "running"] },
                "$count",
                0
              ]
            }
          },
          pausedCount: {
            $sum: {
              $cond: [
                { $eq: ["$bucket", "paused"] },
                "$count",
                0
              ]
            }
          },
          faultCount: {
            $sum: {
              $cond: [
                { $eq: ["$bucket", "fault"] },
                "$count",
                0
              ]
            }
          }
        }},
        // Convert counts to milliseconds (simplified approach)
        {$set: {
          runningMs: { $multiply: ["$runningCount", 60000] }, // 1 minute per count as proxy
          pausedMs: { $multiply: ["$pausedCount", 60000] },
          faultedMs: { $multiply: ["$faultCount", 60000] }
        }},
        {$project: {
          _id: 0,
          serial: "$_id",
          name: { $ifNull: ["$machineName", "Unknown"] },
          runningMs: 1,
          pausedMs: 1,
          faultedMs: 1
        }}
      ];

      // Simplified aggregation pipeline for counts
      const countsAgg = [
        {$match: {
          timestamp: {$gte: start, $lte: end},
          misfeed: { $ne: true },
          'operator.id': { $exists: true, $ne: -1 }
        }},
        {$set: {
          itemName: { $ifNull: ["$item.name", "Unknown"] },
          hour: { $hour: { date: "$timestamp", timezone: TZ } },
          day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          serial: "$machine.serial",
          operatorId: "$operator.id",
          operatorName: "$operator.name"
        }},
        {$facet: {
          // Item hourly stack
          itemHourlyStackRaw: [
            {$group: { 
              _id: { item: "$itemName", hour: "$hour" }, 
              count: { $sum: 1 } 
            }},
            {$sort: { "_id.item": 1, "_id.hour": 1 }}
          ],
      
          // Daily count totals (last 28 days)
          last28Days: [
            {$group: { _id: "$day", count: { $sum: 1 } }},
            {$sort: { "_id": 1 }},
            {$project: { _id: 0, date: "$_id", count: 1 }}
          ],
      
          // Operator counts
          operatorCounts: [
            {$group: {
              _id: "$operatorId",
              name: { $first: "$operatorName" },
              validCount: { $sum: 1 }
            }},
            {$project: { _id: 0, id: "$_id", name: { $ifNull: ["$name", "Unknown"] }, validCount: 1 }}
          ],
      
          // Per-machine, per-hour counts
          countsByMachineHour: [
            {$group: {
              _id: { serial: "$serial", hour: "$hour" },
              valid: { $sum: 1 }
            }},
            {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", valid: 1 }}
          ],
      
          // Per-machine, per-hour misfeeds
          misfeedsByMachineHour: [
            {$match: { misfeed: true }},
            {$set: { 
              hour: { $hour: { date: "$timestamp", timezone: TZ } }, 
              serial: "$machine.serial" 
            }},
            {$group: {
              _id: { serial: "$serial", hour: "$hour" },
              misfeed: { $sum: 1 }
            }},
            {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", misfeed: 1 }}
          ]
        }}
      ];

      // Execute aggregation queries with timeout
      const aggregationOptions = { 
        allowDiskUse: true,
        maxTimeMS: 300000 // 5 minute timeout
      };

      logger.info(`Executing states aggregation for ${start} to ${end}`);
      const [stateFacets] = await db.collection('state')
        .aggregate(statesAgg, aggregationOptions)
        .toArray();
      
      logger.info(`Executing counts aggregation for ${start} to ${end}`);
      const [countFacets] = await db.collection('count')
        .aggregate(countsAgg, aggregationOptions)
        .toArray();
  
      // Validate aggregation results
      if (!stateFacets || !countFacets) {
        logger.error('Aggregation returned null results', { stateFacets, countFacets });
        return res.status(500).json({ 
          error: "Failed to retrieve data from database",
          details: "Aggregation returned null results"
        });
      }

      logger.info(`States aggregation returned ${stateFacets.length} results`);
      logger.info(`Counts aggregation returned ${Object.keys(countFacets).length} facets`);

      // Transform data to match expected formats
      logger.info('Transforming machine status data...');
      const machineStatus = stateFacets || [];
      
      logger.info('Calculating machine OEE...');
      const machineOee = (stateFacets || [])
        .map(m => {
          const totalRuntime = (m.runningMs || 0) + (m.pausedMs || 0) + (m.faultedMs || 0);
          return {
            serial: m.serial,
            name: m.name,
            oee: totalRuntime ? +((m.runningMs / totalRuntime) * 100).toFixed(2) : 0
          };
        })
        .sort((a,b) => b.oee - a.oee);
  
      logger.info('Building item hourly stack...');
      const itemHourlyStack = reshapeItemHourly(countFacets.itemHourlyStackRaw || []);
  
      logger.info('Building top operators...');
      // Create operator runtime data from machine status (simplified approach)
      const operatorRuntime = (countFacets.operatorCounts || []).map(op => ({
        id: op.id,
        name: op.name,
        runtime: 0 // Simplified - would need actual state data for operators
      }));
  
      const topOperators = buildTopOperators(
        operatorRuntime,
        countFacets.operatorCounts || []
      );
  
      logger.info('Building plantwide metrics...');
      // Create hourly runtime data for plantwide metrics
      const hourlyRuntimeByMachine = (stateFacets || []).map(machine => {
        const totalRuntime = (machine.runningMs || 0) + (machine.pausedMs || 0) + (machine.faultedMs || 0);
        return {
          serial: machine.serial,
          hour: 0, // Default to hour 0 for now - would need actual hour data
          runtimeMs: totalRuntime,
          runMs: machine.runningMs || 0
        };
      });

      // Use the proper helper function for plantwide metrics
      const plantwideMetrics = buildPlantwideHourly(
        hourlyRuntimeByMachine,
        countFacets.countsByMachineHour || [],
        countFacets.misfeedsByMachineHour || []
      );
  
      logger.info('Building daily counts...');
      const dailyCounts = (countFacets.last28Days || []).map(d => ({
        date: d.date,
        count: d.count
      }));

      logger.info('Sending response...');
      return res.json({
        timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
        machineStatus,
        machineOee,
        itemHourlyStack,
        topOperators,
        plantwideMetrics,
        dailyCounts
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      
      res.status(500).json({ 
        error: "Failed to fetch full daily dashboard data",
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  });

  
// Bookending for daily-dashboard/full
// router.get('/analytics/daily-dashboard/full', async (req, res) => {
//   try {
//     const { start, end } = parseAndValidateQueryParams(req);
//     const bookended = await getBookendedStatesAndTimeRange(db, start, end);
//     if (!bookended) {
//       return res.status(200).json({
//         timeRange: { start, end },
//         machineStatus: [],
//         machineOee: [],
//         itemHourlyStack: [],
//         topOperators: [],
//         plantwideMetrics: [],
//         dailyCounts: []
//       });
//     }

//     const { sessionStart, sessionEnd } = bookended;

//     const [
//       machineStatus,
//       machineOee,
//       itemHourlyStack,
//       topOperators,
//       plantwideMetrics,
//       dailyCounts
//     ] = await Promise.all([
//       buildDailyMachineStatus(db, sessionStart, sessionEnd),
//       buildMachineOEE(db, sessionStart, sessionEnd),
//       buildDailyItemHourlyStack(db, sessionStart, sessionEnd),
//       buildTopOperatorEfficiency(db, sessionStart, sessionEnd),
//       buildPlantwideMetricsByHour(db, sessionStart, sessionEnd),
//       buildDailyCountTotals(db, sessionStart, sessionEnd)
//     ]);

//     return res.json({
//       timeRange: { start: sessionStart, end: sessionEnd, total: formatDuration(new Date(sessionEnd) - new Date(sessionStart)) },
//       machineStatus,
//       machineOee,
//       itemHourlyStack,
//       topOperators,
//       plantwideMetrics,
//       dailyCounts
//     });
//   } catch (error) {
//     logger.error("Error in /daily-dashboard/full:", error);
//     res.status(500).json({ error: "Failed to fetch full daily dashboard data" });
//   }
// });

//Bookending for daily-dashboard/full

  router.get('/analytics/daily-dashboard/daily-counts', async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const dailyCounts = await buildDailyCountTotals(db, start, end);
      
      return res.json({
        timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch daily count totals" });
    }
  });
  
  // router.get("/analytics/daily-summary-dashboard", async (req, res) => {
  //   try {
  //     const queryStartTime = Date.now();
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
  
  //     const targetSerials = serial ? [parseInt(serial)] : [];

  //     // ✅ MACHINE SECTION
  //     const machineGroupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "machine",
  //       { targetSerials }
  //     );

  //     const machineResults = [];

  //     for (const [serial, group] of Object.entries(machineGroupedData)) {
  //       const machineSerial = parseInt(serial);
  //       const { states, counts } = group;

  //       if (!states.length) continue;

  //       const performance = await buildMachinePerformance(
  //         states,
  //         counts.valid,
  //         counts.misfeed,
  //         start,
  //         end
  //       );
  //       const itemSummary = buildMachineItemSummary(states, counts.valid, start, end);
  //       const itemHourlyStack = buildItemHourlyStack(counts.valid, start, end);
  //       const faultData = buildFaultData(states, start, end);
  //       const operatorEfficiency = await buildOperatorEfficiency(states, counts.valid, start, end, machineSerial);

  //       const latestState = states[states.length - 1];
  //       const machineName = latestState.machine?.name || 'Unknown';
  //       const statusCode = latestState.status?.code || 0;
  //       const statusName = latestState.status?.name || 'Unknown';

  //       machineResults.push({
  //         machine: {
  //           serial: machineSerial,
  //           name: machineName
  //         },
  //         currentStatus: {
  //           code: statusCode,
  //           name: statusName
  //         },
  //         performance,
  //         itemSummary,
  //         itemHourlyStack,
  //         faultData,
  //         operatorEfficiency
  //       });
  //     }

  //     // === Operators ===
  //     const operatorGroupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "operator"
  //     );

  //     const operatorResults = [];

  //     for (const [operatorId, group] of Object.entries(operatorGroupedData)) {
  //       const numericOperatorId = parseInt(operatorId);
  //       const { states, counts } = group;

  //       if (!states.length && !counts.all.length) continue;

  //       const performance = await buildOperatorPerformance(
  //         states,
  //         counts.valid,
  //         counts.misfeed,
  //         start,
  //         end
  //       );

  //       const countByItem = await buildOperatorCountByItem(group, start, end);

  //       const operatorName =
  //         counts.valid[0]?.operator?.name ||
  //         counts.all[0]?.operator?.name ||
  //         "Unknown";

  //       const latest = states[states.length - 1] || {};

  //       operatorResults.push({
  //         operator: { 
  //           id: numericOperatorId, 
  //           name: operatorName 
  //         },
  //         currentStatus: {
  //           code: latest.status?.code || 0,
  //           name: latest.status?.name || "Unknown",
  //         },
  //         metrics: {
  //           runtime: {
  //             total: performance.runtime.total,
  //             formatted: performance.runtime.formatted
  //           },
  //           performance: {
  //             efficiency: {
  //               value: performance.performance.efficiency.value,
  //               percentage: performance.performance.efficiency.percentage
  //             }
  //           }
  //         },
  //         countByItem
  //       });
  //     }
  
  //     // === Items ===
  //     const items = [];
  //     for (const machineResult of machineResults) {
  //       const machineSerial = machineResult.machine.serial;
  //       const machineStates = await fetchStatesForMachine(db, machineSerial, paddedStart, paddedEnd);
  //       const machineCounts = await getCountsForMachine(db, machineSerial, paddedStart, paddedEnd);
  //       const runCycles = extractAllCyclesFromStates(machineStates, start, end).running;

  //       const machineSummary = {
  //         totalCount: 0,
  //         totalWorkedMs: 0,
  //         itemSummaries: {}
  //       };

  //       for (const cycle of runCycles) {
  //         const cycleStart = new Date(cycle.start);
  //         const cycleEnd = new Date(cycle.end);
  //         const cycleMs = cycleEnd - cycleStart;

  //         const cycleCounts = machineCounts.filter(c => {
  //           const ts = new Date(c.timestamp);
  //           return ts >= cycleStart && ts <= cycleEnd;
  //         });

  //         if (!cycleCounts.length) continue;

  //         const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
  //         const workedTimeMs = cycleMs * Math.max(1, operators.size);

  //         const itemGroups = groupCountsByItem(cycleCounts);

  //         for (const [itemId, group] of Object.entries(itemGroups)) {
  //           const countTotal = group.length;
  //           const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
  //           const name = group[0].item?.name || "Unknown";

  //           if (!machineSummary.itemSummaries[itemId]) {
  //             machineSummary.itemSummaries[itemId] = {
  //               count: 0,
  //               standard,
  //               workedTimeMs: 0,
  //               name
  //             };
  //           }

  //           machineSummary.itemSummaries[itemId].count += countTotal;
  //           machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
  //           machineSummary.totalCount += countTotal;
  //           machineSummary.totalWorkedMs += workedTimeMs;
  //         }
  //       }

  //       // Add per-item formatted metrics
  //       Object.entries(machineSummary.itemSummaries).forEach(([itemId, summary]) => {
  //         const workedTimeFormatted = formatDuration(summary.workedTimeMs);
  //         const totalHours = summary.workedTimeMs / 3600000;
  //         const pph = totalHours > 0 ? summary.count / totalHours : 0;
  //         const efficiency = summary.standard > 0 ? pph / summary.standard : 0;

  //         items.push({
  //           itemName: summary.name,
  //           workedTimeFormatted,
  //           count: summary.count,
  //           pph: Math.round(pph * 100) / 100,
  //           standard: summary.standard,
  //           efficiency: Math.round(efficiency * 10000) / 100
  //         });
  //       });
  //     }
  
  //     res.json({
  //       timeRange: { start, end, total: formatDuration(Date.now() - queryStartTime) },
  //       machineResults,
  //       operatorResults,
  //       items
  //     });
  //   } catch (error) {
  //     logger.error("Error in /analytics/daily-summary-dashboard:", error);
  //     res.status(500).json({ error: "Failed to generate daily summary dashboard" });
  //   }
  // });
  
  // router.get("/analytics/daily-summary-dashboard", async (req, res) => {
  //   try {
  //     const queryStartTime = Date.now();
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
  //     const targetSerials = serial ? [parseInt(serial)] : [];
  
  //     // === MACHINE DATA ===
  //     const machineGroupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "machine",
  //       { targetSerials }
  //     );
  
  //     const machineResults = await Promise.all(
  //       Object.entries(machineGroupedData).map(async ([serial, group]) => {
  //         const machineSerial = parseInt(serial);
  //         const { states, counts } = group;
  
  //         if (!states.length) return null;
  
  //         const performance = await buildMachinePerformance(
  //           states,
  //           counts.valid,
  //           counts.misfeed,
  //           start,
  //           end
  //         );
  //         const itemSummary = buildMachineItemSummary(states, counts.valid, start, end);
  //         const itemHourlyStack = buildItemHourlyStack(counts.valid, start, end);
  //         const faultData = buildFaultData(states, start, end);
  //         const operatorEfficiency = await buildOperatorEfficiency(states, counts.valid, start, end, machineSerial);
  
  //         const latestState = states[states.length - 1];
  //         const machineName = latestState.machine?.name || "Unknown";
  //         const statusCode = latestState.status?.code || 0;
  //         const statusName = latestState.status?.name || "Unknown";
  
  //         return {
  //           machine: { serial: machineSerial, name: machineName },
  //           currentStatus: { code: statusCode, name: statusName },
  //           performance,
  //           itemSummary,
  //           itemHourlyStack,
  //           faultData,
  //           operatorEfficiency
  //         };
  //       })
  //     );
  
  //     // === OPERATOR DATA ===
  //     const operatorGroupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "operator"
  //     );
  
  //     const operatorResults = await Promise.all(
  //       Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
  //         const numericOperatorId = parseInt(operatorId);
  //         const { states, counts } = group;
  
  //         if (!states.length && !counts.all.length) return null;
  
  //         const performance = await buildOperatorPerformance(
  //           states,
  //           counts.valid,
  //           counts.misfeed,
  //           start,
  //           end
  //         );
  
  //         const countByItem = await buildOperatorCountByItem(group, start, end);
  
  //         const operatorName =
  //           counts.valid[0]?.operator?.name ||
  //           counts.all[0]?.operator?.name ||
  //           "Unknown";
  
  //         const latest = states[states.length - 1] || {};
  
  //         return {
  //           operator: { id: numericOperatorId, name: operatorName },
  //           currentStatus: {
  //             code: latest.status?.code || 0,
  //             name: latest.status?.name || "Unknown"
  //           },
  //           metrics: {
  //             runtime: {
  //               total: performance.runtime.total,
  //               formatted: performance.runtime.formatted
  //             },
  //             performance: {
  //               efficiency: {
  //                 value: performance.performance.efficiency.value,
  //                 percentage: performance.performance.efficiency.percentage
  //               }
  //             }
  //           },
  //           countByItem
  //         };
  //       })
  //     );
  
  //     // === ITEM DATA ===
  //     const items = [];
  
  //     await Promise.all(
  //       Object.entries(machineGroupedData).map(async ([serial, group]) => {
  //         const machineSerial = parseInt(serial);
  //         const machineStates = group.states;
  //         const machineCounts = group.counts.valid;
  
  //         const runCycles = extractAllCyclesFromStates(machineStates, start, end).running;
  
  //         const machineSummary = {
  //           totalCount: 0,
  //           totalWorkedMs: 0,
  //           itemSummaries: {}
  //         };
  
  //         for (const cycle of runCycles) {
  //           const cycleStart = new Date(cycle.start);
  //           const cycleEnd = new Date(cycle.end);
  //           const cycleMs = cycleEnd - cycleStart;
  
  //           const cycleCounts = machineCounts.filter(c => {
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
  //       })
  //     );
  
  //     res.json({
  //       timeRange: { start, end, total: formatDuration(Date.now() - queryStartTime) },
  //       machineResults: machineResults.filter(Boolean),
  //       operatorResults: operatorResults.filter(Boolean),
  //       items
  //     });
  //   } catch (error) {
  //     logger.error("Error in /analytics/daily-summary-dashboard:", error);
  //     res.status(500).json({ error: "Failed to generate daily summary dashboard" });
  //   }
  // });

  //Bookending for daily-summary-dashboard

  router.get("/analytics/daily-summary-dashboard", async (req, res) => {
    try {
      const queryStartTime = Date.now();
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const targetSerials = serial ? [parseInt(serial)] : await db.collection("machine").distinct("serial");
  
      const machineResults = [];
      const items = [];
  
      for (const machineSerial of targetSerials) {
        const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
        if (!bookended) continue;
  
        const { sessionStart, sessionEnd, states } = bookended;
        const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
        const misfeeds = await getMisfeedCounts(db, machineSerial, sessionStart, sessionEnd);
  
        // ========== MACHINE RESULTS ==========
        const performance = await buildMachinePerformance(states, counts, misfeeds, sessionStart, sessionEnd);
        const itemSummary = buildMachineItemSummary(states, counts, sessionStart, sessionEnd);
        const itemHourlyStack = buildItemHourlyStack(counts, sessionStart, sessionEnd);
        const faultData = buildFaultData(states, sessionStart, sessionEnd);
        const operatorEfficiency = await buildOperatorEfficiency(states, counts, sessionStart, sessionEnd, machineSerial);
  
        const latestState = states.at(-1);
        const machineName = latestState?.machine?.name || "Unknown";
        const statusCode = latestState?.status?.code || 0;
        const statusName = latestState?.status?.name || "Unknown";
  
        machineResults.push({
          machine: { serial: machineSerial, name: machineName },
          currentStatus: { code: statusCode, name: statusName },
          performance,
          itemSummary,
          itemHourlyStack,
          faultData,
          operatorEfficiency
        });
  
        // ========== ITEM SUMMARY ==========
        const runCycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;
  
        const machineSummary = {
          totalCount: 0,
          totalWorkedMs: 0,
          itemSummaries: {}
        };
  
        for (const cycle of runCycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;
  
          const cycleCounts = counts.filter(c => {
            const ts = new Date(c.timestamp);
            return ts >= cycleStart && ts <= cycleEnd;
          });
          if (!cycleCounts.length) continue;
  
          const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
          const workedTimeMs = cycleMs * Math.max(1, operators.size);
          const itemGroups = groupCountsByItem(cycleCounts);
  
          for (const [itemId, group] of Object.entries(itemGroups)) {
            const countTotal = group.length;
            const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const name = group[0].item?.name || "Unknown";
  
            if (!machineSummary.itemSummaries[itemId]) {
              machineSummary.itemSummaries[itemId] = {
                count: 0,
                standard,
                workedTimeMs: 0,
                name
              };
            }
  
            machineSummary.itemSummaries[itemId].count += countTotal;
            machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
            machineSummary.totalCount += countTotal;
            machineSummary.totalWorkedMs += workedTimeMs;
          }
        }
  
        for (const summary of Object.values(machineSummary.itemSummaries)) {
          const workedTimeFormatted = formatDuration(summary.workedTimeMs);
          const totalHours = summary.workedTimeMs / 3600000;
          const pph = totalHours > 0 ? summary.count / totalHours : 0;
          const efficiency = summary.standard > 0 ? pph / summary.standard : 0;
  
          items.push({
            itemName: summary.name,
            workedTimeFormatted,
            count: summary.count,
            pph: Math.round(pph * 100) / 100,
            standard: summary.standard,
            efficiency: Math.round(efficiency * 10000) / 100
          });
        }
      }
  
      // ========== OPERATOR RESULTS ==========
      const operatorGroupedData = await fetchGroupedAnalyticsData(db, start, end, "operator");
      const operatorResults = await Promise.all(
        Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
          const numericOperatorId = parseInt(operatorId);
          const { states, counts } = group;
  
          if (!states.length && !counts.all.length) return null;
  
          const performance = await buildOperatorPerformance(states, counts.valid, counts.misfeed, start, end);
          const countByItem = await buildOperatorCountByItem(group, start, end);
          const operatorName =
            counts.valid[0]?.operator?.name ||
            counts.all[0]?.operator?.name ||
            "Unknown";
  
          const latest = states.at(-1) || {};
  
          return {
            operator: { id: numericOperatorId, name: operatorName },
            currentStatus: {
              code: latest.status?.code || 0,
              name: latest.status?.name || "Unknown"
            },
            metrics: {
              runtime: {
                total: performance.runtime.total,
                formatted: performance.runtime.formatted
              },
              performance: {
                efficiency: {
                  value: performance.performance.efficiency.value,
                  percentage: performance.performance.efficiency.percentage
                }
              }
            },
            countByItem
          };
        })
      );
  
      res.json({
        timeRange: { start, end, total: formatDuration(Date.now() - queryStartTime) },
        machineResults,
        operatorResults: operatorResults.filter(Boolean),
        items
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate daily summary dashboard" });
    }
  });

  //Bookending for daily-summary-dashboard end

  // Daily Summary Dashboard Split in three routes 


  // helpers reused by all three endpoints
async function computeMachineResults(db, start, end, serial) {
  const targetSerials = serial
    ? [serial]
    : await db.collection("machine").distinct("serial");

  const machineResults = [];

  for (const machineSerial of targetSerials) {
    const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
    if (!bookended) continue;

    const { sessionStart, sessionEnd, states } = bookended;
    const counts   = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
    const misfeeds = await getMisfeedCounts(db, machineSerial, sessionStart, sessionEnd);

    const performance        = await buildMachinePerformance(states, counts, misfeeds, sessionStart, sessionEnd);
    const itemSummary        = buildMachineItemSummary(states, counts, sessionStart, sessionEnd);
    const itemHourlyStack    = buildItemHourlyStack(counts, sessionStart, sessionEnd);
    const faultData          = buildFaultData(states, sessionStart, sessionEnd);
    const operatorEfficiency = await buildOperatorEfficiency(states, counts, sessionStart, sessionEnd, machineSerial);

    const latestState = states.at(-1);
    const machineName = latestState?.machine?.name || "Unknown";
    const statusCode  = latestState?.status?.code || 0;
    const statusName  = latestState?.status?.name || "Unknown";

    machineResults.push({
      machine: { serial: machineSerial, name: machineName },
      currentStatus: { code: statusCode, name: statusName },
      performance,
      itemSummary,
      itemHourlyStack,
      faultData,
      operatorEfficiency,
    });
  }

  return machineResults;
}

async function computeItemSummaries(db, start, end, serial) {
  const targetSerials = serial
    ? [serial]
    : await db.collection("machine").distinct("serial");

  const items = [];

  for (const machineSerial of targetSerials) {
    const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
    if (!bookended) continue;

    const { sessionStart, sessionEnd, states } = bookended;
    const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);

    const runCycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;

    const machineSummary = {
      totalCount: 0,
      totalWorkedMs: 0,
      itemSummaries: {},
    };

    for (const cycle of runCycles) {
      const cycleStart = new Date(cycle.start);
      const cycleEnd   = new Date(cycle.end);
      const cycleMs    = cycleEnd.getTime() - cycleStart.getTime();

      const cycleCounts = counts.filter(c => {
        const ts = new Date(c.timestamp);
        return ts >= cycleStart && ts <= cycleEnd;
      });
      if (!cycleCounts.length) continue;

      const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
      const workedTimeMs = cycleMs * Math.max(1, operators.size);
      const itemGroups = groupCountsByItem(cycleCounts);

      for (const [itemId, group] of Object.entries(itemGroups)) {
        const countTotal = group.length;
        const first = group[0];
        const standard = first?.item?.standard > 0 ? first.item.standard : 666;
        const name = first?.item?.name || "Unknown";

        if (!machineSummary.itemSummaries[itemId]) {
          machineSummary.itemSummaries[itemId] = { count: 0, standard, workedTimeMs: 0, name };
        }
        machineSummary.itemSummaries[itemId].count += countTotal;
        machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
        machineSummary.totalCount += countTotal;
        machineSummary.totalWorkedMs += workedTimeMs;
      }
    }

    for (const summary of Object.values(machineSummary.itemSummaries)) {
      const workedTimeFormatted = formatDuration(summary.workedTimeMs);
      const totalHours = summary.workedTimeMs / 3_600_000;
      const pph = totalHours > 0 ? summary.count / totalHours : 0;
      const efficiency = summary.standard > 0 ? pph / summary.standard : 0;

      items.push({
        itemName: summary.name,
        workedTimeFormatted,
        count: summary.count,
        pph: Math.round(pph * 100) / 100,
        standard: summary.standard,
        efficiency: Math.round(efficiency * 10000) / 100, // percentage number
      });
    }
  }

  return items;
}

async function computeOperatorResults(db, start, end) {
  const operatorGroupedData = await fetchGroupedAnalyticsData(db, start, end, "operator");

  const results = await Promise.all(
    Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
      const numericOperatorId = parseInt(operatorId, 10);
      const { states, counts } = group;
      if (!states.length && !counts.all.length) return null;

      const performance = await buildOperatorPerformance(states, counts.valid, counts.misfeed, start, end);
      const countByItem = await buildOperatorCountByItem(group, start, end);
      const operatorName =
        counts.valid[0]?.operator?.name ||
        counts.all[0]?.operator?.name ||
        "Unknown";

      const latest = states.at(-1) || {};

      return {
        operator: { id: numericOperatorId, name: operatorName },
        currentStatus: {
          code: latest.status?.code || 0,
          name: latest.status?.name || "Unknown",
        },
        metrics: {
          runtime: {
            total: performance.runtime.total,
            formatted: performance.runtime.formatted,
          },
          performance: {
            efficiency: {
              value: performance.performance.efficiency.value,
              percentage: performance.performance.efficiency.percentage,
            },
          },
        },
        countByItem,
      };
    })
  );

  return results.filter(Boolean);
}

// --- Hybrid Helper Functions ---

function splitTimeRangeForHybrid(exactStart, exactEnd) {
  const completeDays = [];
  const partialDays = [];
  
  const startOfDayStart = new Date(exactStart);
  startOfDayStart.setHours(0, 0, 0, 0);
  
  const startOfDayEnd = new Date(exactEnd);
  startOfDayEnd.setHours(0, 0, 0, 0);
  
  // Check if start time is at midnight
  const startIsFullDay = exactStart.getTime() === startOfDayStart.getTime();
  
  // Check if end time is at end of day (23:59:59.999)
  const endOfDayEnd = new Date(startOfDayEnd);
  endOfDayEnd.setHours(23, 59, 59, 999);
  const endIsFullDay = exactEnd.getTime() >= endOfDayEnd.getTime();
  
  // If start is not at midnight, add partial day for start
  if (!startIsFullDay) {
    const endOfStartDay = new Date(startOfDayStart);
    endOfStartDay.setHours(23, 59, 59, 999);
    partialDays.push({
      start: exactStart,
      end: exactEnd < endOfStartDay ? exactEnd : endOfStartDay
    });
    startOfDayStart.setDate(startOfDayStart.getDate() + 1);
  }
  
  // Add complete days
  const currentDay = new Date(startOfDayStart);
  while (currentDay < startOfDayEnd) {
    completeDays.push({
      dateStr: currentDay.toISOString().split('T')[0],
      start: new Date(currentDay),
      end: new Date(currentDay.getTime() + 24 * 60 * 60 * 1000 - 1)
    });
    currentDay.setDate(currentDay.getDate() + 1);
  }
  
  // If end is not at end of day and we're on a different day than start partial, add partial day for end
  if (!endIsFullDay && startOfDayEnd >= startOfDayStart) {
    const startOfEndDay = new Date(startOfDayEnd);
    startOfEndDay.setHours(0, 0, 0, 0);
    
    // Only add if not already covered by start partial day
    if (startOfEndDay.getTime() !== startOfDayStart.getTime() || startIsFullDay) {
      partialDays.push({
        start: startOfEndDay,
        end: exactEnd
      });
    }
  }
  
  return { completeDays, partialDays };
}

function isToday(dateStr) {
  const today = new Date();
  const todayDateStr = today.toISOString().split('T')[0];
  return dateStr === todayDateStr;
}

// --- Hybrid Helper Functions for Machines ---

async function getCachedMachineResults(db, completeDays, serial) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);
  
  // Query machine daily totals
  const machineQuery = {
    entityType: 'machine',
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { 
        $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
      }}
    ]
  };
  
  if (serial) {
    machineQuery.machineSerial = serial;
  }
  
  const machineTotals = await cacheCollection.find(machineQuery).toArray();
  
  // Transform cache records to match computeMachineResults format
  const machineResults = [];
  const machineMap = new Map();
  
  for (const record of machineTotals) {
    const serial = record.machineSerial;
    
    if (!machineMap.has(serial)) {
      machineMap.set(serial, {
        machine: { serial: serial, name: record.machineName || "Unknown" },
        currentStatus: { code: 0, name: "Unknown" }, // Will get from stateTicker
        performance: {
          output: {
            totalCount: 0,
            validCount: 0,
            misfeedCount: 0
          },
          runtime: {
            total: 0,
            formatted: { hours: 0, minutes: 0 }
          },
          workedTime: {
            total: 0,
            formatted: { hours: 0, minutes: 0 }
          },
          oee: {
            percentage: 0 // Will calculate after aggregation
          },
          // Track for OEE calculation
          totalTimeCreditMs: 0,
          pausedTimeMs: 0,
          faultTimeMs: 0,
          windowMs: 0 // Track total window time from all records
        },
        itemSummary: [],
        itemHourlyStack: [],
        faultData: {
          faultSummaries: [],
          faultCycles: []
        },
        operatorEfficiency: []
      });
    }
    
    const machine = machineMap.get(serial);
    // Aggregate across multiple days
    machine.performance.output.validCount += (record.totalCounts || 0);
    machine.performance.output.totalCount += (record.totalCounts || 0);
    machine.performance.output.misfeedCount += (record.totalMisfeeds || 0);
    machine.performance.runtime.total += (record.runtimeMs || 0);
    machine.performance.workedTime.total += (record.workedTimeMs || 0);
    machine.performance.totalTimeCreditMs += (record.totalTimeCreditMs || 0);
    machine.performance.pausedTimeMs += (record.pausedTimeMs || 0);
    machine.performance.faultTimeMs += (record.faultTimeMs || 0);
    
    // Calculate window time from each record's timeRange (like machines-summary-daily-cached)
    if (record.timeRange && record.timeRange.start && record.timeRange.end) {
      const recordWindowMs = new Date(record.timeRange.end) - new Date(record.timeRange.start);
      machine.performance.windowMs += recordWindowMs;
    }
  }
  
  // Get machine serials for stateTicker query
  const machineSerials = Array.from(machineMap.keys()).map(s => Number(s));
  
  // Get current status for each machine from stateTicker (using machine.id)
  const tickers = await db
    .collection(config.stateTickerCollectionName)
    .find({ "machine.id": { $in: machineSerials } })
    .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
    .toArray();
  
  // Deduplicate and keep only latest ticker per machine ID
  const latestTickers = new Map();
  tickers.forEach((ticker) => {
    const id = Number(ticker.machine?.id);
    const ts = new Date(ticker.timestamp || 0);
    const existing = latestTickers.get(id);
    if (!existing || ts > new Date(existing.timestamp || 0)) {
      latestTickers.set(id, ticker);
    }
  });
  
  // Build statusMap from deduplicated tickers
  const statusMap = new Map();
  for (const [id, ticker] of latestTickers) {
    statusMap.set(id, {
      code: ticker.status?.code || 0,
      name: ticker.status?.name || "Unknown",
      color: ticker.status?.softrolColor || "None",
    });
  }
  
  // Convert map to array, calculate OEE, and set status
  for (const [serial, machine] of machineMap) {
    // Get status from stateTicker using machine.id
    const currentStatus = statusMap.get(Number(serial)) || {
      code: 0,
      name: "Unknown",
    };
    machine.currentStatus = currentStatus;
    
    // Calculate OEE using aggregated metrics (same as machines-summary-daily-cached)
    // Use windowMs from accumulated timeRanges, fallback to runtime + downtime if not available
    const windowMs = machine.performance.windowMs || 
                     (machine.performance.runtime.total + machine.performance.pausedTimeMs + machine.performance.faultTimeMs);
    
    // Calculate availability: runtime / window time
    const availability = windowMs > 0 
      ? Math.min(Math.max(machine.performance.runtime.total / windowMs, 0), 1)
      : 0;
    
    // Calculate throughput: valid counts / total output
    const totalOutput = machine.performance.output.totalCount + machine.performance.output.misfeedCount;
    const throughput = totalOutput > 0 
      ? machine.performance.output.totalCount / totalOutput 
      : 0;
    
    // Calculate efficiency: time credit / worked time
    const workTimeSec = machine.performance.workedTime.total / 1000;
    const totalTimeCreditSec = machine.performance.totalTimeCreditMs / 1000;
    const efficiency = workTimeSec > 0 
      ? totalTimeCreditSec / workTimeSec 
      : 0;
    
    // OEE = availability * throughput * efficiency
    const oee = availability * throughput * efficiency;
    
    // Update formatted times
    machine.performance.runtime.formatted = formatDuration(machine.performance.runtime.total);
    machine.performance.workedTime.formatted = formatDuration(machine.performance.workedTime.total);
    
    // Set OEE percentage (convert to number)
    machine.performance.oee.percentage = parseFloat((oee * 100).toFixed(2));
    
    // Clean up temporary tracking fields
    delete machine.performance.totalTimeCreditMs;
    delete machine.performance.pausedTimeMs;
    delete machine.performance.faultTimeMs;
    delete machine.performance.windowMs;
    
    machineResults.push(machine);
  }
  
  return machineResults;
}

async function computeMachineResultsForPartialDays(db, partialDays, serial) {
  // Use existing computeMachineResults but only for partial day ranges
  // This will be called for each partial day range separately and combined
  let allResults = [];
  
  for (const partialDay of partialDays) {
    const results = await computeMachineResults(db, partialDay.start.toISOString(), partialDay.end.toISOString(), serial);
    allResults = combineMachineResults(allResults, results);
  }
  
  return allResults;
}

function combineMachineResults(cachedResults, sessionResults) {
  const machineMap = new Map();
  
  // Add cached results
  for (const machine of cachedResults) {
    machineMap.set(machine.machine.serial, { ...machine });
  }
  
  // Add/combine session results
  for (const machine of sessionResults) {
    const serial = machine.machine.serial;
    
    if (machineMap.has(serial)) {
      // Combine with existing cached data
      const existing = machineMap.get(serial);
      
      // Aggregate performance metrics
      existing.performance.output.totalCount += machine.performance?.output?.totalCount || 0;
      existing.performance.output.validCount += machine.performance?.output?.validCount || 0;
      existing.performance.output.misfeedCount += machine.performance?.output?.misfeedCount || 0;
      existing.performance.runtime.total += machine.performance?.runtime?.total || 0;
      existing.performance.workedTime.total += machine.performance?.workedTime?.total || 0;
      
      // Update formatted times
      existing.performance.runtime.formatted = formatDuration(existing.performance.runtime.total);
      existing.performance.workedTime.formatted = formatDuration(existing.performance.workedTime.total);
      
      // Merge itemSummary arrays (could be more sophisticated)
      if (machine.itemSummary && Array.isArray(machine.itemSummary)) {
        existing.itemSummary = existing.itemSummary || [];
        existing.itemSummary.push(...machine.itemSummary);
      }
      
      // Use latest status from session
      if (machine.currentStatus) {
        existing.currentStatus = machine.currentStatus;
      }
      
    } else {
      // New machine from session
      machineMap.set(serial, machine);
    }
  }
  
  return Array.from(machineMap.values());
}

// --- Hybrid Helper Functions for Operators ---

async function getCachedOperatorResults(db, completeDays) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);
  
  // Query operator-machine daily totals (entityType: 'operator-machine')
  const operatorQuery = {
    entityType: 'operator-machine',
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { 
        $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
      }}
    ]
  };
  
  const cacheRecords = await cacheCollection.find(operatorQuery).toArray();
  
  if (cacheRecords.length === 0) {
    return [];
  }
  
  // Get unique machine serials from cache records
  const machineSerials = [
    ...new Set(
      cacheRecords
        .map(r => r.machineSerial)
        .filter(serial => serial !== null && serial !== undefined)
    )
  ];
  const tickerSerialFilter = [
    ...new Set([
      ...machineSerials,
      ...machineSerials.map(serial => serial.toString())
    ])
  ];
  
  // Get current machine statuses from stateTicker collection (same as operators-summary-daily-cached)
  const tickerQuery =
    tickerSerialFilter.length > 0
      ? {
          $or: [
            { "machine.serial": { $in: tickerSerialFilter } },
            { "machine.id": { $in: tickerSerialFilter } },
            {
              "machine.serial": {
                $in: tickerSerialFilter
                  .map(Number)
                  .filter(n => !Number.isNaN(n))
              }
            },
            {
              "machine.id": {
                $in: tickerSerialFilter
                  .map(Number)
                  .filter(n => !Number.isNaN(n))
              }
            }
          ]
        }
      : {};
  
  const stateTickerData = await db.collection(config.stateTickerCollectionName)
    .find(tickerQuery)
    .toArray();
  
  // Build a map of latest ticker context per operator (same as operators-summary-daily-cached)
  const operatorTickerMap = new Map();
  for (const stateRecord of stateTickerData) {
    const machine = stateRecord.machine || {};
    const status = stateRecord.status || {};
    const timestamp = new Date(
      status.timestamp ||
        stateRecord.timestamp ||
        (stateRecord.timestamps &&
          (stateRecord.timestamps.update ||
            stateRecord.timestamps.active ||
            stateRecord.timestamps.create)) ||
        0
    ).getTime();
  
    if (Array.isArray(stateRecord.operators)) {
      for (const op of stateRecord.operators) {
        if (!op || typeof op.id === "undefined" || op.id === null) {
          continue;
        }
  
        const operatorKey =
          typeof op.id === "string" ? Number.parseInt(op.id, 10) : op.id;
  
        if (Number.isNaN(operatorKey)) {
          continue;
        }
  
        const existing = operatorTickerMap.get(operatorKey);
        if (!existing || existing.timestamp < timestamp) {
          const serial =
            machine.serial ?? machine.id ?? machine.serialNumber ?? null;
          operatorTickerMap.set(operatorKey, {
            machine:
              serial !== null && serial !== undefined
                ? {
                    serial,
                    name: machine.name || null
                  }
                : null,
            status:
              typeof status.code !== "undefined" ||
              typeof status.name !== "undefined"
                ? {
                    code: status.code ?? null,
                    name: status.name ?? null
                  }
                : null,
            timestamp
          });
        }
      }
    }
  }
  
  // Group by operator ID and aggregate metrics across machines (same as operators-summary-daily-cached)
  const operatorMap = new Map();
  
  // Calculate total window time from completeDays (for multi-day queries)
  let totalWindowMs = 0;
  for (const day of completeDays) {
    const dayStart = new Date(day.start);
    const dayEnd = new Date(day.end);
    totalWindowMs += (dayEnd - dayStart);
  }
  
  for (const record of cacheRecords) {
    const opId = record.operatorId;
    
    if (!operatorMap.has(opId)) {
      operatorMap.set(opId, {
        operator: {
          id: record.operatorId,
          name: record.operatorName || "Unknown"
        },
        currentStatus: null,
        currentMachine: null,
        metrics: {
          runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          output: { totalCount: 0, misfeedCount: 0 },
          performance: {
            availability: { value: 0, percentage: "0.00" },
            throughput: { value: 0, percentage: "0.00" },
            efficiency: { value: 0, percentage: "0.00" },
            oee: { value: 0, percentage: "0.00" }
          }
        },
        totalWindowMs: totalWindowMs, // Store calculated window time
        efficiencyData: [] // Track efficiency per machine for weighted average
      });
    }
    
    const operatorData = operatorMap.get(opId);
    
    // Update current context from stateTicker (latest wins)
    const tickerContext = operatorTickerMap.get(opId);
    if (tickerContext) {
      operatorData.currentMachine = tickerContext.machine;
      operatorData.currentStatus = tickerContext.status;
    } else {
      operatorData.currentMachine = null;
      operatorData.currentStatus = null;
    }
    
    // Aggregate metrics (same as operators-summary-daily-cached)
    const downtimeMs = record.pausedTimeMs + record.faultTimeMs;
    operatorData.metrics.runtime.total += record.runtimeMs || 0;
    operatorData.metrics.downtime.total += downtimeMs;
    operatorData.metrics.output.totalCount += record.totalCounts || 0;
    operatorData.metrics.output.misfeedCount += record.totalMisfeeds || 0;
    
    // Track efficiency data for weighted average (same as operators-summary-daily-cached)
    const workTimeSec = (record.workedTimeMs || 0) / 1000;
    const timeCreditSec = (record.totalTimeCreditMs || 0) / 1000;
    const efficiency = workTimeSec > 0 ? timeCreditSec / workTimeSec : 0;
    
    operatorData.efficiencyData.push({
      efficiency: efficiency,
      weight: record.workedTimeMs || 0 // Use worked time as weight
    });
  }
  
  // Calculate aggregated performance metrics for each operator (same as operators-summary-daily-cached)
  const results = Array.from(operatorMap.values()).map(operatorData => {
    const { runtime, downtime, output } = operatorData.metrics;
    
    // Calculate window time from totalWindowMs (calculated from completeDays)
    // For operators, use runtime + downtime as fallback if windowMs not available
    const windowMs = operatorData.totalWindowMs || (runtime.total + downtime.total);
    
    // Calculate aggregated performance metrics
    const availability = windowMs > 0 ? runtime.total / windowMs : 0;
    const throughput = (output.totalCount + output.misfeedCount) > 0 ? 
      output.totalCount / (output.totalCount + output.misfeedCount) : 0;
    
    // Calculate weighted average efficiency
    let totalWeightedEfficiency = 0;
    let totalWeight = 0;
    
    for (const effData of operatorData.efficiencyData) {
      totalWeightedEfficiency += effData.efficiency * effData.weight;
      totalWeight += effData.weight;
    }
    
    const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
    const oee = availability * throughput * efficiency;
    
    // Update formatted times
    operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
    operatorData.metrics.downtime.formatted = formatDuration(downtime.total);
    
    // Update performance metrics (convert percentage to number for consistency with frontend)
    operatorData.metrics.performance = {
      availability: {
        value: availability,
        percentage: parseFloat((availability * 100).toFixed(2))
      },
      throughput: {
        value: throughput,
        percentage: parseFloat((throughput * 100).toFixed(2))
      },
      efficiency: {
        value: efficiency,
        percentage: parseFloat((efficiency * 100).toFixed(2))
      },
      oee: {
        value: oee,
        percentage: parseFloat((oee * 100).toFixed(2))
      }
    };
    
    // Clean up temporary data
    delete operatorData.efficiencyData;
    delete operatorData.totalWindowMs;
    
    return operatorData;
  });
  
  return results;
}

async function computeOperatorResultsForPartialDays(db, partialDays) {
  let allResults = [];
  
  for (const partialDay of partialDays) {
    const results = await computeOperatorResults(db, partialDay.start.toISOString(), partialDay.end.toISOString());
    allResults = combineOperatorResults(allResults, results);
  }
  
  return allResults;
}

function combineOperatorResults(cachedResults, sessionResults) {
  const operatorMap = new Map();
  
  // Add cached results
  for (const operator of cachedResults) {
    operatorMap.set(operator.operator.id, { ...operator });
  }
  
  // Add/combine session results
  for (const operator of sessionResults) {
    const operatorId = operator.operator.id;
    
    if (operatorMap.has(operatorId)) {
      const existing = operatorMap.get(operatorId);
      
      // Aggregate metrics
      existing.metrics.runtime.total += operator.metrics?.runtime?.total || 0;
      existing.metrics.runtime.formatted = formatDuration(existing.metrics.runtime.total);
      
      // Use latest status from session
      if (operator.currentStatus) {
        existing.currentStatus = operator.currentStatus;
      }
      
      // Merge countByItem arrays
      if (operator.countByItem && Array.isArray(operator.countByItem)) {
        existing.countByItem = existing.countByItem || [];
        existing.countByItem.push(...operator.countByItem);
      }
    } else {
      operatorMap.set(operatorId, operator);
    }
  }
  
  return Array.from(operatorMap.values());
}

// --- Hybrid Helper Functions for Items ---

async function getCachedItemResults(db, completeDays, serial) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);
  
  // Query item daily totals (entityType: 'item' for plant-wide aggregation)
  const itemQuery = {
    entityType: 'item',
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { 
        $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
      }}
    ]
  };
  
  const itemTotals = await cacheCollection.find(itemQuery).toArray();
  
  // Transform cache records to match computeItemSummaries format
  const itemMap = new Map();
  
  for (const record of itemTotals) {
    const itemId = record.itemId;
    
    if (!itemMap.has(itemId)) {
      itemMap.set(itemId, {
        itemName: record.itemName || "Unknown",
        workedTimeFormatted: formatDuration(record.workedTimeMs || 0),
        count: 0,
        pph: 0,
        standard: record.itemStandard || 0,
        efficiency: 0
      });
    }
    
    const item = itemMap.get(itemId);
    // Aggregate across multiple days
    item.count += (record.totalCounts || 0);
    
    // Recalculate metrics
    const workedMs = (record.workedTimeMs || 0);
    const totalHours = workedMs / 3600000;
    item.pph = totalHours > 0 ? item.count / totalHours : 0;
    item.workedTimeFormatted = formatDuration(workedMs);
    item.efficiency = item.standard > 0 ? (item.pph / item.standard) * 100 : 0;
    
    item.pph = Math.round(item.pph * 100) / 100;
    item.efficiency = Math.round(item.efficiency * 100) / 100;
  }
  
  return Array.from(itemMap.values());
}

async function computeItemResultsForPartialDays(db, partialDays, serial) {
  let allResults = [];
  
  for (const partialDay of partialDays) {
    const results = await computeItemSummaries(db, partialDay.start.toISOString(), partialDay.end.toISOString(), serial);
    allResults = combineItemResults(allResults, results);
  }
  
  return allResults;
}

function combineItemResults(cachedResults, sessionResults) {
  const itemMap = new Map();
  
  // Add cached results
  for (const item of cachedResults) {
    const key = item.itemName || item.itemId;
    itemMap.set(key, { ...item });
  }
  
  // Add/combine session results
  for (const item of sessionResults) {
    const key = item.itemName || item.itemId;
    
    if (itemMap.has(key)) {
      const existing = itemMap.get(key);
      
      // Aggregate counts and worked time
      existing.count += item.count || 0;
      
      // Recalculate metrics
      const workedMs = (parseInt(existing.workedTimeFormatted) || 0) + (parseInt(item.workedTimeFormatted) || 0);
      const totalHours = workedMs / 3600000;
      existing.pph = totalHours > 0 ? existing.count / totalHours : 0;
      existing.efficiency = existing.standard > 0 ? (existing.pph / existing.standard) * 100 : 0;
      
      existing.pph = Math.round(existing.pph * 100) / 100;
      existing.efficiency = Math.round(existing.efficiency * 100) / 100;
    } else {
      itemMap.set(key, item);
    }
  }
  
  return Array.from(itemMap.values());
}

// --- Routes ---

// 1) Machines summary
router.get("/analytics/daily-summary-dashboard/machines", async (req, res) => {
  try {
    const started = Date.now();
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    
    // Check if querying today
    const today = new Date();
    const todayDateStr = today.toISOString().split('T')[0];
    const startDateStr = exactStart.toISOString().split('T')[0];
    const endDateStr = exactEnd.toISOString().split('T')[0];
    const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;
    
    // Check if partial day (same day but not full day boundaries)
    const startOfDayStart = new Date(exactStart);
    startOfDayStart.setHours(0, 0, 0, 0);
    const endOfDayEnd = new Date(exactEnd);
    endOfDayEnd.setHours(23, 59, 59, 999);
    const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
    const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
    const isSameDay = startDateStr === endDateStr;
    const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);
    
    // If partial day and NOT today, use session-based calculation
    if (isPartialDay && !isToday) {
      logger.info(`[machines-summary] Partial day (not today) - using session-based calculation`);
      const machineResults = await computeMachineResults(db, start, end, serial ? parseInt(serial) : undefined);
      return res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, machineResults });
    }
    
    // Hybrid query configuration
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
    
    logger.info(`[machines-summary] Strategy: ${useHybrid ? 'HYBRID' : 'CACHE ONLY'}, time range: ${timeRangeHours.toFixed(2)} hours, isToday: ${isToday}`);
    
    let machineResults = [];
    
    if (useHybrid) {
      // Split time range into complete days and partial days
      const { completeDays, partialDays } = splitTimeRangeForHybrid(exactStart, exactEnd);
      
      // Separate partial days into today and non-today
      const today = new Date();
      const todayDateStr = today.toISOString().split('T')[0];
      
      const partialDaysToday = [];
      const partialDaysNotToday = [];
      
      for (const partialDay of partialDays) {
        const partialDayDateStr = new Date(partialDay.start).toISOString().split('T')[0];
        if (partialDayDateStr === todayDateStr) {
          // If partial day is today, treat it as a complete day and use cache
          partialDaysToday.push({
            dateStr: partialDayDateStr,
            start: new Date(partialDayDateStr + 'T00:00:00.000Z'),
            end: new Date(partialDayDateStr + 'T23:59:59.999Z')
          });
        } else {
          // If partial day is not today, use sessions
          partialDaysNotToday.push(partialDay);
        }
      }
      
      // Combine complete days with today's partial days (both use cache)
      const daysForCache = [...completeDays, ...partialDaysToday];
      
      // Get data from daily cache for complete days AND today's partial days
      if (daysForCache.length > 0) {
        const cacheResults = await getCachedMachineResults(db, daysForCache, serial ? parseInt(serial) : undefined);
        machineResults = cacheResults;
        logger.info(`[machines-summary] Retrieved ${machineResults.length} machine results from cache for complete days + today`);
      }
      
      // Get data from sessions for partial days that are NOT today
      if (partialDaysNotToday.length > 0) {
        const sessionResults = await computeMachineResultsForPartialDays(db, partialDaysNotToday, serial ? parseInt(serial) : undefined);
        machineResults = combineMachineResults(machineResults, sessionResults);
        logger.info(`[machines-summary] Combined with ${sessionResults.length} session results, total: ${machineResults.length} machines`);
      }
    } else {
      // Cache-only mode - query totals-daily for complete days
      const startDate = exactStart.toISOString().split('T')[0];
      const endDate = exactEnd.toISOString().split('T')[0];
      
      const daysForCache = [{
        dateStr: startDate,
        start: startOfDayStart,
        end: endOfDayEnd
      }];
      
      machineResults = await getCachedMachineResults(db, daysForCache, serial ? parseInt(serial) : undefined);
      logger.info(`[machines-summary] Retrieved ${machineResults.length} machine results from cache`);
    }
    
    res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, machineResults });
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate machines summary" });
  }
});

// 2) Operators summary
router.get("/analytics/daily-summary-dashboard/operators", async (req, res) => {
  try {
    const started = Date.now();
    const { start, end } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    
    // Check if querying today
    const today = new Date();
    const todayDateStr = today.toISOString().split('T')[0];
    const startDateStr = exactStart.toISOString().split('T')[0];
    const endDateStr = exactEnd.toISOString().split('T')[0];
    const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;
    
    // Check if partial day
    const startOfDayStart = new Date(exactStart);
    startOfDayStart.setHours(0, 0, 0, 0);
    const endOfDayEnd = new Date(exactEnd);
    endOfDayEnd.setHours(23, 59, 59, 999);
    const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
    const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
    const isSameDay = startDateStr === endDateStr;
    const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);
    
    // If partial day and NOT today, use session-based calculation
    if (isPartialDay && !isToday) {
      logger.info(`[operators-summary] Partial day (not today) - using session-based calculation`);
      const operatorResults = await computeOperatorResults(db, start, end);
      return res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, operatorResults });
    }
    
    // Hybrid query configuration
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
    
    logger.info(`[operators-summary] Strategy: ${useHybrid ? 'HYBRID' : 'CACHE ONLY'}, time range: ${timeRangeHours.toFixed(2)} hours, isToday: ${isToday}`);
    
    let operatorResults = [];
    
    if (useHybrid) {
      // Split time range into complete days and partial days
      const { completeDays, partialDays } = splitTimeRangeForHybrid(exactStart, exactEnd);
      
      // Separate partial days into today and non-today
      const partialDaysToday = [];
      const partialDaysNotToday = [];
      
      for (const partialDay of partialDays) {
        const partialDayDateStr = new Date(partialDay.start).toISOString().split('T')[0];
        if (partialDayDateStr === todayDateStr) {
          partialDaysToday.push({
            dateStr: partialDayDateStr,
            start: new Date(partialDayDateStr + 'T00:00:00.000Z'),
            end: new Date(partialDayDateStr + 'T23:59:59.999Z')
          });
        } else {
          partialDaysNotToday.push(partialDay);
        }
      }
      
      // Combine complete days with today's partial days
      const daysForCache = [...completeDays, ...partialDaysToday];
      
      // Get data from cache for complete days AND today
      if (daysForCache.length > 0) {
        const cacheResults = await getCachedOperatorResults(db, daysForCache);
        operatorResults = cacheResults;
        logger.info(`[operators-summary] Retrieved ${operatorResults.length} operator results from cache`);
      }
      
      // Get data from sessions for partial days that are NOT today
      if (partialDaysNotToday.length > 0) {
        const sessionResults = await computeOperatorResultsForPartialDays(db, partialDaysNotToday);
        operatorResults = combineOperatorResults(operatorResults, sessionResults);
        logger.info(`[operators-summary] Combined with ${sessionResults.length} session results`);
      }
    } else {
      // Cache-only mode
      const startDate = exactStart.toISOString().split('T')[0];
      const daysForCache = [{
        dateStr: startDate,
        start: startOfDayStart,
        end: endOfDayEnd
      }];
      
      operatorResults = await getCachedOperatorResults(db, daysForCache);
      logger.info(`[operators-summary] Retrieved ${operatorResults.length} operator results from cache`);
    }
    
    res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, operatorResults });
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate operators summary" });
  }
});

// 3) Items summary
router.get("/analytics/daily-summary-dashboard/items", async (req, res) => {
  try {
    const started = Date.now();
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    
    // Check if querying today
    const today = new Date();
    const todayDateStr = today.toISOString().split('T')[0];
    const startDateStr = exactStart.toISOString().split('T')[0];
    const endDateStr = exactEnd.toISOString().split('T')[0];
    const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;
    
    // Check if partial day
    const startOfDayStart = new Date(exactStart);
    startOfDayStart.setHours(0, 0, 0, 0);
    const endOfDayEnd = new Date(exactEnd);
    endOfDayEnd.setHours(23, 59, 59, 999);
    const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
    const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
    const isSameDay = startDateStr === endDateStr;
    const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);
    
    // If partial day and NOT today, use session-based calculation
    if (isPartialDay && !isToday) {
      logger.info(`[items-summary] Partial day (not today) - using session-based calculation`);
      const items = await computeItemSummaries(db, start, end, serial ? parseInt(serial) : undefined);
      return res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, items });
    }
    
    // Hybrid query configuration
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
    
    logger.info(`[items-summary] Strategy: ${useHybrid ? 'HYBRID' : 'CACHE ONLY'}, time range: ${timeRangeHours.toFixed(2)} hours, isToday: ${isToday}`);
    
    let items = [];
    
    if (useHybrid) {
      // Split time range into complete days and partial days
      const { completeDays, partialDays } = splitTimeRangeForHybrid(exactStart, exactEnd);
      
      // Separate partial days into today and non-today
      const partialDaysToday = [];
      const partialDaysNotToday = [];
      
      for (const partialDay of partialDays) {
        const partialDayDateStr = new Date(partialDay.start).toISOString().split('T')[0];
        if (partialDayDateStr === todayDateStr) {
          partialDaysToday.push({
            dateStr: partialDayDateStr,
            start: new Date(partialDayDateStr + 'T00:00:00.000Z'),
            end: new Date(partialDayDateStr + 'T23:59:59.999Z')
          });
        } else {
          partialDaysNotToday.push(partialDay);
        }
      }
      
      // Combine complete days with today's partial days
      const daysForCache = [...completeDays, ...partialDaysToday];
      
      // Get data from cache for complete days AND today
      if (daysForCache.length > 0) {
        const cacheResults = await getCachedItemResults(db, daysForCache, serial ? parseInt(serial) : undefined);
        items = cacheResults;
        logger.info(`[items-summary] Retrieved ${items.length} item results from cache`);
      }
      
      // Get data from sessions for partial days that are NOT today
      if (partialDaysNotToday.length > 0) {
        const sessionResults = await computeItemResultsForPartialDays(db, partialDaysNotToday, serial ? parseInt(serial) : undefined);
        items = combineItemResults(items, sessionResults);
        logger.info(`[items-summary] Combined with ${sessionResults.length} session results`);
      }
    } else {
      // Cache-only mode
      const startDate = exactStart.toISOString().split('T')[0];
      const daysForCache = [{
        dateStr: startDate,
        start: startOfDayStart,
        end: endOfDayEnd
      }];
      
      items = await getCachedItemResults(db, daysForCache, serial ? parseInt(serial) : undefined);
      logger.info(`[items-summary] Retrieved ${items.length} item results from cache`);
    }
    
    res.json({ timeRange: { start, end, total: formatDuration(Date.now() - started) }, items });
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate items summary" });
  }
});


  




  

  return router;

}