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
    buildDailyCountTotals,
    splitTimeRangeForHybrid,
    isToday,
    computeMachineResults,
    computeItemSummaries,
    computeOperatorResults,
    getCachedMachineResults,
    getCachedOperatorResults,
    getCachedItemResults,
    computeMachineResultsForPartialDays,
    computeOperatorResultsForPartialDays,
    computeItemResultsForPartialDays,
    combineMachineResults,
    combineOperatorResults,
    combineItemResults,
    isoHour,
    defaultCalcEfficiency,
    reshapeItemHourly,
    buildTopOperators,
    buildPlantwideHourly,
    shapeMachineOee
  } = require('../../utils/dashboardFunctions');

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