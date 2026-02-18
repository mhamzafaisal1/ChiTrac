const express = require("express");
const { DateTime } = require("luxon");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // Utility imports
  const {
    parseAndValidateQueryParams,
    formatDuration,
    getCountCollectionName,
  } = require("../../utils/time");

  const {
    getBookendedStatesAndTimeRange,
    getBookendedOperatorStatesAndTimeRange,
  } = require("../../utils/bookendingBuilder");

  const {
    extractAllCyclesFromStates,
    fetchStatesForMachine,
  } = require("../../utils/state");

  const {
    groupCountsByOperatorAndMachine,
    processCountStatistics,
    getCountsForMachine,
  } = require("../../utils/count");

  const {
    buildMachinePerformance,
    buildMachineItemSummary,
    buildItemHourlyStack,
    buildFaultData,
    buildOperatorEfficiency,
  } = require("../../utils/machineDashboardBuilder");

  const {
    calculateDowntime,
    calculateAvailability,
    calculateEfficiency,
    calculateOEE,
    calculateThroughput,
    calculateTotalCount,
    calculateOperatorTimes,
    calculateMisfeeds,
    calculatePiecesPerHour,
  } = require("../../utils/analytics");

  const {
    getActiveMachineSerials,
    extractAllCyclesFromStatesForDashboard,
    formatItemSummaryFromAggregation,
    formatItemHourlyStackFromAggregation,
  } = require("../../utils/machineFunctions");

  const {
    getActiveOperatorIds,
    buildOperatorCyclePie,
    buildOptimizedOperatorFaultHistorySingle,
  } = require("../../utils/operatorFunctions");

  const {
    fetchStatesForOperator,
    getCompletedCyclesForOperator,
  } = require("../../utils/state");

  const {
    getMostRecentStateForMachine,
    buildInitialFlipperOutputs,
  } = require("../../utils/demoFlipperBuilder");

  //   router.get("/analytics/machine-dashboard-sessions", async (req, res) => {
  //     try {
  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeSerials = await getActiveMachineSerials(db, start, end);

  //       const results = await Promise.all(
  //         activeSerials.map(async (serial) => {
  //           const bookended = await getBookendedStatesAndTimeRange(
  //             db,
  //             serial,
  //             start,
  //             end
  //           );
  //           if (!bookended) return null;

  //           const { states, sessionStart, sessionEnd } = bookended;
  //           const runSessions = extractAllCyclesFromStatesForDashboard(
  //             states,
  //             sessionStart,
  //             sessionEnd
  //           ).running;

  //           if (!runSessions.length) return null;

  //           const machineName = states.at(-1)?.machine?.name || "Unknown";
  //           const statusCode = states.at(-1)?.status?.code || 0;
  //           const statusName = states.at(-1)?.status?.name || "Unknown";

  //           const sessionResults = await Promise.all(
  //             runSessions.map(async (session) => {
  //               const counts = await db
  //                 .collection("count")
  //                 .find({
  //                   "machine.serial": serial,
  //                   timestamp: { $gte: session.start, $lte: session.end },
  //                 })
  //                 .project({
  //                   timestamp: 1,
  //                   "machine.serial": 1,
  //                   "operator.id": 1,
  //                   "operator.name": 1,
  //                   "item.id": 1,
  //                   "item.name": 1,
  //                   "item.standard": 1,
  //                   misfeed: 1,
  //                 })
  //                 .sort({ timestamp: 1 })
  //                 .toArray();

  //               const valid = counts.filter(
  //                 (c) => !c.misfeed && c.operator?.id !== -1
  //               );
  //               const misfeed = counts.filter((c) => c.misfeed === true);

  //               const [
  //                 performance,
  //                 itemSummary,
  //                 itemHourlyStack,
  //                 faultData,
  //                 operatorEfficiency,
  //               ] = await Promise.all([
  //                 buildMachinePerformance(
  //                   states,
  //                   valid,
  //                   misfeed,
  //                   session.start,
  //                   session.end
  //                 ),
  //                 buildMachineItemSummary(
  //                   states,
  //                   valid,
  //                   session.start,
  //                   session.end
  //                 ),
  //                 buildItemHourlyStack(valid, session.start, session.end),
  //                 buildFaultData(states, session.start, session.end),
  //                 buildOperatorEfficiency(
  //                   states,
  //                   valid,
  //                   session.start,
  //                   session.end,
  //                   serial
  //                 ),
  //               ]);

  //               return {
  //                 sessionStart: session.start,
  //                 sessionEnd: session.end,
  //                 performance,
  //                 itemSummary,
  //                 itemHourlyStack,
  //                 faultData,
  //                 operatorEfficiency,
  //               };
  //             })
  //           );

  //           return {
  //             machine: {
  //               serial,
  //               name: machineName,
  //             },
  //             currentStatus: {
  //               code: statusCode,
  //               name: statusName,
  //             },
  //             sessions: sessionResults.filter(Boolean),
  //           };
  //         })
  //       );

  //         res.json(results.filter(Boolean));
  //     //   res.json(activeSerials);
  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res
  //         .status(500)
  //         .json({
  //           error: "Failed to fetch session-based machine dashboard data",
  //         });
  //     }
  //   });

  // Route for machine dashboard sessions for entire time range

  // router.get("/analytics/machine-dashboard-sessions", async (req, res) => {
  //     try {
  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeSerials = await getActiveMachineSerials(db, start, end);
  //       const results = await Promise.all(
  //         activeSerials.map(async (serial) => {
  //           const bookended = await getBookendedStatesAndTimeRange(
  //             db,
  //             serial,
  //             start,
  //             end
  //           );
  //           if (!bookended) return null;

  //           const { states, sessionStart, sessionEnd } = bookended;
  //           const machineName = states.at(-1)?.machine?.name || "Unknown";
  //           const statusCode = states.at(-1)?.status?.code || 0;
  //           const statusName = states.at(-1)?.status?.name || "Unknown";

  //           // Aggregate analytics for the entire time range (not per session)
  //           const [aggResult] = await db.collection("count").aggregate([
  //             { $match: {
  //                 "machine.serial": serial,
  //                 timestamp: { $gte: sessionStart, $lte: sessionEnd }
  //             }},
  //             { $facet: {
  //                 performance: [
  //                   { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                   { $count: "totalCount" }
  //                 ],
  //                 misfeeds: [
  //                   { $match: { misfeed: true } },
  //                   { $count: "misfeedCount" }
  //                 ],
  //                 itemSummary: [
  //                   { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                   { $group: {
  //                       _id: "$item.id",
  //                       name: { $first: "$item.name" },
  //                       standard: { $first: "$item.standard" },
  //                       count: { $sum: 1 }
  //                   }}
  //                 ],
  //                 hourlyStack: [
  //                   { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                   { $project: {
  //                       hour: { $hour: "$timestamp" },
  //                       itemId: "$item.id"
  //                   }},
  //                   { $group: {
  //                       _id: { hour: "$hour", itemId: "$itemId" },
  //                       count: { $sum: 1 }
  //                   }},
  //                   { $project: {
  //                       hour: "$_id.hour",
  //                       itemId: "$_id.itemId",
  //                       count: 1,
  //                       _id: 0
  //                   }}
  //                 ],
  //                 timeCredit: [
  //                   { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                   { $group: {
  //                       _id: { id: "$item.id", name: "$item.name" },
  //                       standard: { $first: "$item.standard" },
  //                       count: { $sum: 1 }
  //                   }},
  //                   { $addFields: {
  //                       standardPerHour: {
  //                         $cond: [
  //                           { $lt: ["$standard", 60] },
  //                           { $multiply: ["$standard", 60] },
  //                           "$standard"
  //                         ]
  //                       }
  //                   }},
  //                   { $addFields: {
  //                       timeCredit: {
  //                         $cond: [
  //                           { $gt: ["$standardPerHour", 0] },
  //                           { $divide: ["$count", { $divide: ["$standardPerHour", 3600] }] },
  //                           0
  //                         ]
  //                       }
  //                   }},
  //                   { $group: {
  //                       _id: null,
  //                       totalTimeCredit: { $sum: "$timeCredit" }
  //                   }}
  //                 ]
  //             }}
  //           ]).toArray();

  //           const totalCount = aggResult.performance?.[0]?.totalCount || 0;
  //           const misfeedCount = aggResult.misfeeds?.[0]?.misfeedCount || 0;
  //           const totalTimeCredit = aggResult.timeCredit?.[0]?.totalTimeCredit || 0;
  //           const runtimeMs = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running
  //             .reduce((sum, c) => sum + c.duration, 0);
  //           const totalQueryMs = new Date(sessionEnd) - new Date(sessionStart);
  //           const downtimeMs = totalQueryMs - runtimeMs;
  //           const runtimeSeconds = runtimeMs / 1000;

  //           const availability = calculateAvailability(runtimeMs, downtimeMs, totalQueryMs);
  //           const throughput = calculateThroughput(totalCount, misfeedCount);
  //           const efficiency = runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
  //           const oee = calculateOEE(availability, efficiency, throughput);

  //           const performance = {
  //             runtime: { total: runtimeMs, formatted: formatDuration(runtimeMs) },
  //             downtime: { total: downtimeMs, formatted: formatDuration(downtimeMs) },
  //             output: { totalCount, misfeedCount },
  //             performance: {
  //               availability: { value: availability, percentage: (availability * 100).toFixed(2) + "%" },
  //               throughput: { value: throughput, percentage: (throughput * 100).toFixed(2) + "%" },
  //               efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) + "%" },
  //               oee: { value: oee, percentage: (oee * 100).toFixed(2) + "%" }
  //             }
  //           };

  //           const itemSummary = formatItemSummaryFromAggregation(aggResult.itemSummary || []);
  //           const itemHourlyStack = formatItemHourlyStackFromAggregation(aggResult.hourlyStack || []);

  //           const faultData = buildFaultData(states, sessionStart, sessionEnd); // still JS-based
  //           const operatorEfficiency = await buildOperatorEfficiency(states, [], sessionStart, sessionEnd, serial);

  //           return {
  //             machine: {
  //               serial,
  //               name: machineName
  //             },
  //             currentStatus: {
  //               code: statusCode,
  //               name: statusName
  //             },
  //             performance,
  //             itemSummary,
  //             itemHourlyStack,
  //             faultData,
  //             operatorEfficiency
  //           };
  //         })
  //       );

  //       res.json(results.filter(Boolean));
  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res
  //         .status(500)
  //         .json({
  //           error: "Failed to fetch session-based machine dashboard data",
  //         });
  //     }
  //   });

  // Route for machine dashboard sessions for each session

  // router.get("/analytics/machine-dashboard-sessions", async (req, res) => {
  //     try {

  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeSerials = await getActiveMachineSerials(db, start, end);
  //       const results = await Promise.all(
  //         activeSerials.map(async (serial) => {
  //           const bookended = await getBookendedStatesAndTimeRange(
  //             db,
  //             serial,
  //             start,
  //             end
  //           );
  //           if (!bookended) return null;

  //           const { states, sessionStart, sessionEnd } = bookended;
  //           const runSessions = extractAllCyclesFromStatesForDashboard(
  //             states,
  //             sessionStart,
  //             sessionEnd
  //           ).running;

  //           if (!runSessions.length) return null;

  //           const machineName = states.at(-1)?.machine?.name || "Unknown";
  //           const statusCode = states.at(-1)?.status?.code || 0;
  //           const statusName = states.at(-1)?.status?.name || "Unknown";

  //           const sessionResults = await Promise.all(
  //             runSessions.map(async (session) => {
  //               const [aggResult] = await db.collection("count").aggregate([
  //                 { $match: {
  //                     "machine.serial": serial,
  //                     timestamp: { $gte: session.start, $lte: session.end }
  //                 }},
  //                 { $facet: {
  //                     performance: [
  //                       { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                       { $count: "totalCount" }
  //                     ],
  //                     misfeeds: [
  //                       { $match: { misfeed: true } },
  //                       { $count: "misfeedCount" }
  //                     ],
  //                     itemSummary: [
  //                       { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                       { $group: {
  //                           _id: "$item.id",
  //                           name: { $first: "$item.name" },
  //                           standard: { $first: "$item.standard" },
  //                           count: { $sum: 1 }
  //                       }}
  //                     ],
  //                     hourlyStack: [
  //                       { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                       { $project: {
  //                           hour: { $hour: "$timestamp" },
  //                           itemId: "$item.id"
  //                       }},
  //                       { $group: {
  //                           _id: { hour: "$hour", itemId: "$itemId" },
  //                           count: { $sum: 1 }
  //                       }},
  //                       { $project: {
  //                           hour: "$_id.hour",
  //                           itemId: "$_id.itemId",
  //                           count: 1,
  //                           _id: 0
  //                       }}
  //                     ],
  //                     timeCredit: [
  //                       { $match: { misfeed: { $ne: true }, "operator.id": { $ne: -1 } } },
  //                       { $group: {
  //                           _id: { id: "$item.id", name: "$item.name" },
  //                           standard: { $first: "$item.standard" },
  //                           count: { $sum: 1 }
  //                       }},
  //                       { $addFields: {
  //                           standardPerHour: {
  //                             $cond: [
  //                               { $lt: ["$standard", 60] },
  //                               { $multiply: ["$standard", 60] },
  //                               "$standard"
  //                             ]
  //                           }
  //                       }},
  //                       { $addFields: {
  //                           timeCredit: {
  //                             $cond: [
  //                               { $gt: ["$standardPerHour", 0] },
  //                               { $divide: ["$count", { $divide: ["$standardPerHour", 3600] }] },
  //                               0
  //                             ]
  //                           }
  //                       }},
  //                       { $group: {
  //                           _id: null,
  //                           totalTimeCredit: { $sum: "$timeCredit" }
  //                       }}
  //                     ]
  //                 }}
  //               ]).toArray();

  //               const totalCount = aggResult.performance?.[0]?.totalCount || 0;
  //               const misfeedCount = aggResult.misfeeds?.[0]?.misfeedCount || 0;
  //               const totalTimeCredit = aggResult.timeCredit?.[0]?.totalTimeCredit || 0;
  //               const runtimeMs = extractAllCyclesFromStates(states, session.start, session.end).running
  //                 .reduce((sum, c) => sum + c.duration, 0);
  //               const totalQueryMs = new Date(session.end) - new Date(session.start);
  //               const downtimeMs = totalQueryMs - runtimeMs;
  //               const runtimeSeconds = runtimeMs / 1000;

  //               const availability = calculateAvailability(runtimeMs, downtimeMs, totalQueryMs);
  //               const throughput = calculateThroughput(totalCount, misfeedCount);
  //               const efficiency = runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
  //               const oee = calculateOEE(availability, efficiency, throughput);

  //               const performance = {
  //                 runtime: { total: runtimeMs, formatted: formatDuration(runtimeMs) },
  //                 downtime: { total: downtimeMs, formatted: formatDuration(downtimeMs) },
  //                 output: { totalCount, misfeedCount },
  //                 performance: {
  //                   availability: { value: availability, percentage: (availability * 100).toFixed(2) + "%" },
  //                   throughput: { value: throughput, percentage: (throughput * 100).toFixed(2) + "%" },
  //                   efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) + "%" },
  //                   oee: { value: oee, percentage: (oee * 100).toFixed(2) + "%" }
  //                 }
  //               };

  //               const itemSummary = formatItemSummaryFromAggregation(aggResult.itemSummary || []);
  //               const itemHourlyStack = formatItemHourlyStackFromAggregation(aggResult.hourlyStack || []);

  //               const faultData = buildFaultData(states, session.start, session.end); // still JS-based
  //               const operatorEfficiency = await buildOperatorEfficiency(states, [], session.start, session.end, serial);

  //               return {
  //                 performance,
  //                 itemSummary,
  //                 itemHourlyStack,
  //                 faultData,
  //                 operatorEfficiency
  //               };
  //             })
  //           );

  //           // Aggregate all sessionResults into a single summary
  //           const summary = sessionResults.reduce((acc, curr) => {
  //             // Sum performance fields
  //             if (!acc.performance) acc.performance = { ...curr.performance };
  //             else {
  //               acc.performance.runtime.total += curr.performance.runtime.total;
  //               acc.performance.downtime.total += curr.performance.downtime.total;
  //               acc.performance.output.totalCount += curr.performance.output.totalCount;
  //               acc.performance.output.misfeedCount += curr.performance.output.misfeedCount;
  //               // For percentages, you may want to recalculate after summing
  //             }
  //             // Merge itemSummary
  //             if (!acc.itemSummary) acc.itemSummary = { ...curr.itemSummary };
  //             else {
  //               for (const key in curr.itemSummary) {
  //                 if (!acc.itemSummary[key]) acc.itemSummary[key] = { ...curr.itemSummary[key] };
  //                 else {
  //                   acc.itemSummary[key].countTotal += curr.itemSummary[key].countTotal;
  //                 }
  //               }
  //             }
  //             // Merge itemHourlyStack (append data)
  //             if (!acc.itemHourlyStack) acc.itemHourlyStack = Array.isArray(curr.itemHourlyStack) ? [...curr.itemHourlyStack] : curr.itemHourlyStack;
  //             else if (Array.isArray(acc.itemHourlyStack) && Array.isArray(curr.itemHourlyStack)) {
  //               acc.itemHourlyStack = acc.itemHourlyStack.concat(curr.itemHourlyStack);
  //             }
  //             // Merge faultData (object with arrays inside)
  //             if (!acc.faultData) acc.faultData = { ...curr.faultData };
  //             else {
  //               // Merge faultCycles
  //               acc.faultData.faultCycles = [
  //                 ...(acc.faultData.faultCycles || []),
  //                 ...(curr.faultData.faultCycles || [])
  //               ];
  //               // Merge faultSummaries by faultCode and faultType
  //               const summaryMap = {};
  //               for (const s of [...(acc.faultData.faultSummaries || []), ...(curr.faultData.faultSummaries || [])]) {
  //                 const key = `${s.faultCode}_${s.faultType}`;
  //                 if (!summaryMap[key]) summaryMap[key] = { ...s };
  //                 else {
  //                   summaryMap[key].totalDuration += s.totalDuration;
  //                   summaryMap[key].count += s.count;
  //                   // Optionally merge formatted, etc.
  //                 }
  //               }
  //               acc.faultData.faultSummaries = Object.values(summaryMap);
  //             }
  //             // Merge operatorEfficiency
  //             if (!acc.operatorEfficiency) acc.operatorEfficiency = { ...curr.operatorEfficiency };
  //             else {
  //               for (const key in curr.operatorEfficiency) {
  //                 if (!acc.operatorEfficiency[key]) acc.operatorEfficiency[key] = { ...curr.operatorEfficiency[key] };
  //                 else {
  //                   acc.operatorEfficiency[key].count += curr.operatorEfficiency[key].count;
  //                 }
  //               }
  //             }
  //             return acc;
  //           }, {});

  //           // Limit the faultCycles array in the merged faultData to the first 100 records per machine in the final API response.
  //           if (summary.faultData && Array.isArray(summary.faultData.faultCycles)) {
  //             summary.faultData.faultCycles = summary.faultData.faultCycles.slice(0, 100);
  //           }

  //           return {
  //             machine: {
  //               serial,
  //               name: machineName
  //             },
  //             currentStatus: {
  //               code: statusCode,
  //               name: statusName
  //             },
  //             ...summary
  //           };
  //         })
  //       );

  //       res.json(results.filter(Boolean));

  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res
  //         .status(500)
  //         .json({
  //           error: `Failed to fetch machine dashboard data for ${req.url}`,
  //         });
  //     }
  //   });

  //Correct working route but item summary not in correct format
  // router.get("/analytics/machine-dashboard-sessions", async (req, res) => {
  //     try {
  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeSerials = await getActiveMachineSerials(db, start, end);

  //       const results = await Promise.all(
  //         activeSerials.map(async (serial) => {
  //           const bookended = await getBookendedStatesAndTimeRange(
  //             db,
  //             serial,
  //             start,
  //             end
  //           );
  //           if (!bookended) return null;

  //           const { states, sessionStart, sessionEnd } = bookended;
  //           const runSessions = extractAllCyclesFromStatesForDashboard(
  //             states,
  //             sessionStart,
  //             sessionEnd
  //           ).running;
  //           if (!runSessions.length) return null;

  //           const machineName = states.at(-1)?.machine?.name || "Unknown";
  //           const statusCode = states.at(-1)?.status?.code || 0;
  //           const statusName = states.at(-1)?.status?.name || "Unknown";

  //           let totalRuntimeMs = 0;
  //           let totalCount = 0;
  //           let misfeedCount = 0;
  //           let totalTimeCredit = 0;
  //           let totalWorkedTimeMs = 0;

  //           const itemSummaryAccumulator = {};
  //           const validCountsAccumulator = [];
  //           const allCountsAccumulator = [];

  //           const totalQueryStart = runSessions[0].start;
  //           const totalQueryEnd = runSessions.at(-1).end;

  //           for (const session of runSessions) {
  //             const [aggResult, sessionValidCounts, sessionAllCounts] = await Promise.all([
  //               db.collection("count").aggregate([
  //                 {
  //                   $match: {
  //                     "machine.serial": serial,
  //                     timestamp: { $gte: session.start, $lte: session.end },
  //                     misfeed: { $ne: true },
  //                     "operator.id": { $ne: -1 },
  //                   },
  //                 },
  //                 {
  //                   $group: {
  //                     _id: {
  //                       itemId: "$item.id",
  //                       operatorId: "$operator.id",
  //                     },
  //                     itemName: { $first: "$item.name" },
  //                     standard: { $first: "$item.standard" },
  //                     count: { $sum: 1 },
  //                   },
  //                 },
  //                 {
  //                   $group: {
  //                     _id: "$_id.itemId",
  //                     name: { $first: "$itemName" },
  //                     standard: { $first: "$standard" },
  //                     count: { $sum: "$count" },
  //                     operators: { $addToSet: "$_id.operatorId" },
  //                   },
  //                 },
  //                 {
  //                   $project: {
  //                     name: 1,
  //                     standard: 1,
  //                     count: 1,
  //                     operatorCount: { $size: "$operators" },
  //                   },
  //                 },
  //               ]).toArray(),

  //               db.collection("count").find({
  //                 "machine.serial": serial,
  //                 timestamp: { $gte: session.start, $lte: session.end },
  //                 misfeed: { $ne: true },
  //                 "operator.id": { $ne: -1 },
  //               }).project({
  //                 timestamp: 1,
  //                 "item.name": 1,
  //                 "item.standard": 1,
  //                 "operator.id": 1,
  //                 "operator.name": 1,
  //                 "machine.serial": 1,
  //                 misfeed: 1,
  //               }).toArray(),

  //               db.collection("count").find({
  //                 "machine.serial": serial,
  //                 timestamp: { $gte: session.start, $lte: session.end },
  //               }).project({
  //                 timestamp: 1,
  //                 misfeed: 1,
  //                 "item.standard": 1,
  //                 "item.id": 1,
  //                 "operator.id": 1,
  //                 "operator.name": 1,
  //                 "machine.serial": 1,
  //               }).toArray(),
  //             ]);

  //             validCountsAccumulator.push(...sessionValidCounts);
  //             allCountsAccumulator.push(...sessionAllCounts);

  //             const runtimeMs = session.end - session.start;
  //             totalRuntimeMs += runtimeMs;

  //             for (const row of aggResult) {
  //               const itemId = row._id;
  //               const name = row.name;
  //               const standard = row.standard || 666;
  //               const count = row.count;
  //               const operatorCount = row.operatorCount || 1;
  //               const workedTimeMs = runtimeMs * operatorCount;
  //               const hours = workedTimeMs / 3600000;
  //               const pph = hours > 0 ? count / hours : 0;
  //               const efficiency = standard > 0 ? pph / standard : 0;

  //               totalWorkedTimeMs += workedTimeMs;
  //               totalCount += count;

  //               if (!itemSummaryAccumulator[itemId]) {
  //                 itemSummaryAccumulator[itemId] = {
  //                   name,
  //                   standard,
  //                   countTotal: 0,
  //                   workedTimeMs: 0,
  //                 };
  //               }

  //               itemSummaryAccumulator[itemId].countTotal += count;
  //               itemSummaryAccumulator[itemId].workedTimeMs += workedTimeMs;
  //             }

  //             const [countAgg] = await db.collection("count").aggregate([
  //               {
  //                 $match: {
  //                   "machine.serial": serial,
  //                   timestamp: { $gte: session.start, $lte: session.end },
  //                 },
  //               },
  //               {
  //                 $facet: {
  //                   misfeeds: [
  //                     { $match: { misfeed: true } },
  //                     { $count: "misfeedCount" },
  //                   ],
  //                   timeCredit: [
  //                     {
  //                       $match: {
  //                         misfeed: { $ne: true },
  //                         "operator.id": { $ne: -1 },
  //                       },
  //                     },
  //                     {
  //                       $group: {
  //                         _id: { id: "$item.id" },
  //                         standard: { $first: "$item.standard" },
  //                         count: { $sum: 1 },
  //                       },
  //                     },
  //                     {
  //                       $addFields: {
  //                         standardPerHour: {
  //                           $cond: [
  //                             { $lt: ["$standard", 60] },
  //                             { $multiply: ["$standard", 60] },
  //                             "$standard",
  //                           ],
  //                         },
  //                       },
  //                     },
  //                     {
  //                       $addFields: {
  //                         timeCredit: {
  //                           $cond: [
  //                             { $gt: ["$standardPerHour", 0] },
  //                             {
  //                               $divide: [
  //                                 "$count",
  //                                 { $divide: ["$standardPerHour", 3600] },
  //                               ],
  //                             },
  //                             0,
  //                           ],
  //                         },
  //                       },
  //                     },
  //                     {
  //                       $group: {
  //                         _id: null,
  //                         totalTimeCredit: { $sum: "$timeCredit" },
  //                       },
  //                     },
  //                   ],
  //                 },
  //               },
  //             ]).toArray();

  //             misfeedCount += countAgg?.misfeeds?.[0]?.misfeedCount || 0;
  //             totalTimeCredit += countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;
  //           }

  //           // Final metrics
  //           const totalQueryMs = totalQueryEnd - totalQueryStart;
  //           const downtimeMs = totalQueryMs - totalRuntimeMs;
  //           const runtimeSeconds = totalRuntimeMs / 1000;

  //           const availability = calculateAvailability(
  //             totalRuntimeMs,
  //             downtimeMs,
  //             totalQueryMs
  //           );
  //           const throughput = calculateThroughput(totalCount, misfeedCount);
  //           const efficiency = runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
  //           const oee = calculateOEE(availability, efficiency, throughput);

  //           const machineHours = totalWorkedTimeMs / 3600000;
  //           const machinePPH = machineHours > 0 ? totalCount / machineHours : 0;
  //           const proratedStandard =
  //             totalCount > 0
  //               ? Object.values(itemSummaryAccumulator).reduce((acc, item) => {
  //                   const weight = item.countTotal / totalCount;
  //                   return acc + weight * item.standard;
  //                 }, 0)
  //               : 0;
  //           const machineEfficiency =
  //             proratedStandard > 0 ? machinePPH / proratedStandard : 0;

  //           const formattedItemSummaries = {};
  //           for (const [itemId, item] of Object.entries(itemSummaryAccumulator)) {
  //             const hours = item.workedTimeMs / 3600000;
  //             const pph = hours > 0 ? item.countTotal / hours : 0;
  //             const eff = item.standard > 0 ? pph / item.standard : 0;

  //             formattedItemSummaries[itemId] = {
  //               name: item.name,
  //               standard: item.standard,
  //               countTotal: item.countTotal,
  //               workedTimeFormatted: formatDuration(item.workedTimeMs),
  //               pph: Math.round(pph * 100) / 100,
  //               efficiency: Math.round(eff * 10000) / 100,
  //             };
  //           }

  //           const performance = {
  //             runtime: {
  //               total: totalRuntimeMs,
  //               formatted: formatDuration(totalRuntimeMs),
  //             },
  //             downtime: {
  //               total: downtimeMs,
  //               formatted: formatDuration(downtimeMs),
  //             },
  //             output: {
  //               totalCount,
  //               misfeedCount,
  //             },
  //             performance: {
  //               availability: {
  //                 value: availability,
  //                 percentage: (availability * 100).toFixed(2) + "%",
  //               },
  //               throughput: {
  //                 value: throughput,
  //                 percentage: (throughput * 100).toFixed(2) + "%",
  //               },
  //               efficiency: {
  //                 value: efficiency,
  //                 percentage: (efficiency * 100).toFixed(2) + "%",
  //               },
  //               oee: {
  //                 value: oee,
  //                 percentage: (oee * 100).toFixed(2) + "%",
  //               },
  //             },
  //           };

  //           const itemSummary = {
  //             totalCount,
  //             workedTimeMs: totalWorkedTimeMs,
  //             workedTimeFormatted: formatDuration(totalWorkedTimeMs),
  //             pph: Math.round(machinePPH * 100) / 100,
  //             proratedStandard: Math.round(proratedStandard * 100) / 100,
  //             efficiency: Math.round(machineEfficiency * 10000) / 100,
  //             itemSummaries: formattedItemSummaries,
  //           };

  //           const itemHourlyStack = buildItemHourlyStack(
  //             validCountsAccumulator,
  //             totalQueryStart,
  //             totalQueryEnd
  //           );

  //           const faultData = buildFaultData(states, sessionStart, sessionEnd);

  //           const operatorEfficiency = await buildOperatorEfficiency(
  //             states,
  //             allCountsAccumulator,
  //             sessionStart,
  //             sessionEnd,
  //             serial
  //           );

  //           return {
  //             machine: {
  //               serial,
  //               name: machineName,
  //             },
  //             currentStatus: {
  //               code: statusCode,
  //               name: statusName,
  //             },
  //             performance,
  //             itemSummary,
  //             itemHourlyStack,
  //             faultData,
  //             operatorEfficiency,
  //           };
  //         })
  //       );

  //       res.json(results.filter(Boolean));
  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res.status(500).json({
  //         error: `Failed to fetch machine dashboard data for ${req.url}`,
  //       });
  //     }
  //   });

  //FINAL VERSION OF MACHINE DASHBOARD SESSIONS
  router.get("/analytics/machine-dashboard-sessions", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const activeSerials = await getActiveMachineSerials(db, start, end);

      const results = await Promise.all(
        activeSerials.map(async (serial) => {
          const bookended = await getBookendedStatesAndTimeRange(
            db,
            serial,
            start,
            end
          );
          if (!bookended) return null;

          const { states, sessionStart, sessionEnd } = bookended;
          const runSessions = extractAllCyclesFromStatesForDashboard(
            states,
            sessionStart,
            sessionEnd
          ).running;
          if (!runSessions.length) return null;

          const machineName = states.at(-1)?.machine?.name || "Unknown";
          const statusCode = states.at(-1)?.status?.code || 0;
          const statusName = states.at(-1)?.status?.name || "Unknown";

          let totalRuntimeMs = 0;
          let totalCount = 0;
          let misfeedCount = 0;
          let totalTimeCredit = 0;
          let operatorName = "Unknown";

          const totalQueryStart = runSessions[0].start;
          const totalQueryEnd = runSessions.at(-1).end;

          for (const session of runSessions) {
            totalRuntimeMs += session.end - session.start;

            const [countAgg] = await db
              .collection("count")
              .aggregate([
                {
                  $match: {
                    "operator.id": operatorId,
                    timestamp: { $gte: session.start, $lte: session.end },
                  },
                },
                {
                  $facet: {
                    validCounts: [
                      { $match: { misfeed: { $ne: true } } },
                      { $count: "count" },
                    ],
                    misfeeds: [
                      { $match: { misfeed: true } },
                      { $count: "misfeedCount" },
                    ],
                    timeCredit: [
                      { $match: { misfeed: { $ne: true } } },
                      {
                        $group: {
                          _id: "$item.id",
                          standard: { $first: "$item.standard" },
                          count: { $sum: 1 },
                        },
                      },
                      {
                        $addFields: {
                          standardPerHour: {
                            $cond: [
                              { $lt: ["$standard", 60] },
                              { $multiply: ["$standard", 60] },
                              "$standard",
                            ],
                          },
                        },
                      },
                      {
                        $addFields: {
                          timeCredit: {
                            $cond: [
                              { $gt: ["$standardPerHour", 0] },
                              {
                                $divide: [
                                  "$count",
                                  { $divide: ["$standardPerHour", 3600] },
                                ],
                              },
                              0,
                            ],
                          },
                        },
                      },
                      {
                        $group: {
                          _id: null,
                          totalTimeCredit: { $sum: "$timeCredit" },
                        },
                      },
                    ],
                    operatorInfo: [
                      { $limit: 1 },
                      {
                        $project: {
                          operatorName: "$operator.name",
                        },
                      },
                    ],
                  },
                },
              ])
              .toArray();

            totalCount += countAgg?.validCounts?.[0]?.count || 0;
            misfeedCount += countAgg?.misfeeds?.[0]?.misfeedCount || 0;
            totalTimeCredit += countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;

            // Get operator name from the aggregation results (use first session's result)
            if (
              operatorName === "Unknown" &&
              countAgg?.operatorInfo?.[0]?.operatorName
            ) {
              operatorName = countAgg.operatorInfo[0].operatorName;
            }
          }

          const totalQueryMs = totalQueryEnd - totalQueryStart;
          const downtimeMs = totalQueryMs - totalRuntimeMs;
          const runtimeSeconds = totalRuntimeMs / 1000;

          const availability = calculateAvailability(
            totalRuntimeMs,
            downtimeMs,
            totalQueryMs
          );
          const throughput = calculateThroughput(totalCount, misfeedCount);
          const efficiency =
            runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
          const oee = calculateOEE(availability, efficiency, throughput);

          return {
            machine: {
              serial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            metrics: {
              runtime: {
                total: totalRuntimeMs,
                formatted: formatDuration(totalRuntimeMs),
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
                  percentage: (availability * 100).toFixed(2),
                },
                throughput: {
                  value: throughput,
                  percentage: (throughput * 100).toFixed(2),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2),
                },
                oee: {
                  value: oee,
                  percentage: (oee * 100).toFixed(2),
                },
              },
            },
            timeRange: {
              start: totalQueryStart,
              end: totalQueryEnd,
            },
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch machine dashboard data for ${req.url}`,
      });
    }
  });
//Working machine summary route without station efficiency logic
  // router.get("/analytics/machine-summary", async (req, res) => {
  //   try {
  //     const { start, end } = parseAndValidateQueryParams(req);
  //     const activeSerials = await getActiveMachineSerials(db, start, end);

  //     const results = await Promise.all(
  //       activeSerials.map(async (serial) => {
  //         const bookended = await getBookendedStatesAndTimeRange(
  //           db,
  //           serial,
  //           start,
  //           end
  //         );
  //         if (!bookended) return null;

  //         const { states, sessionStart, sessionEnd } = bookended;
  //         const runSessions = extractAllCyclesFromStatesForDashboard(
  //           states,
  //           sessionStart,
  //           sessionEnd
  //         ).running;
  //         if (!runSessions.length) return null;

  //         const machineName = states.at(-1)?.machine?.name || "Unknown";
  //         const statusCode = states.at(-1)?.status?.code || 0;
  //         const statusName = states.at(-1)?.status?.name || "Unknown";

  //         let totalRuntimeMs = 0;
  //         let totalCount = 0;
  //         let misfeedCount = 0;
  //         let totalTimeCredit = 0;

  //         const totalQueryStart = runSessions[0].start;
  //         const totalQueryEnd = runSessions.at(-1).end;

  //         for (const session of runSessions) {
  //           totalRuntimeMs += session.end - session.start;

  //           const [countAgg] = await db
  //             .collection("count")
  //             .aggregate([
  //               {
  //                 $match: {
  //                   "machine.serial": serial,
  //                   timestamp: { $gte: session.start, $lte: session.end },
  //                 },
  //               },
  //               {
  //                 $facet: {
  //                   validCounts: [
  //                     {
  //                       $match: {
  //                         misfeed: { $ne: true },
  //                         "operator.id": { $ne: -1 },
  //                       },
  //                     },
  //                     { $count: "count" },
  //                   ],
  //                   misfeeds: [
  //                     { $match: { misfeed: true } },
  //                     { $count: "misfeedCount" },
  //                   ],
  //                   timeCredit: [
  //                     {
  //                       $match: {
  //                         misfeed: { $ne: true },
  //                         "operator.id": { $ne: -1 },
  //                       },
  //                     },
  //                     {
  //                       $group: {
  //                         _id: "$item.id",
  //                         standard: { $first: "$item.standard" },
  //                         count: { $sum: 1 },
  //                       },
  //                     },
  //                     {
  //                       $addFields: {
  //                         standardPerHour: {
  //                           $cond: [
  //                             { $lt: ["$standard", 60] },
  //                             { $multiply: ["$standard", 60] },
  //                             "$standard",
  //                           ],
  //                         },
  //                       },
  //                     },
  //                     {
  //                       $addFields: {
  //                         timeCredit: {
  //                           $cond: [
  //                             { $gt: ["$standardPerHour", 0] },
  //                             {
  //                               $divide: [
  //                                 "$count",
  //                                 { $divide: ["$standardPerHour", 3600] },
  //                               ],
  //                             },
  //                             0,
  //                           ],
  //                         },
  //                       },
  //                     },
  //                     {
  //                       $group: {
  //                         _id: null,
  //                         totalTimeCredit: { $sum: "$timeCredit" },
  //                       },
  //                     },
  //                   ],
  //                 },
  //               },
  //             ])
  //             .toArray();

  //           totalCount += countAgg?.validCounts?.[0]?.count || 0;
  //           misfeedCount += countAgg?.misfeeds?.[0]?.misfeedCount || 0;
  //           totalTimeCredit += countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;
  //         }

  //         const totalQueryMs = totalQueryEnd - totalQueryStart;
  //         const downtimeMs = totalQueryMs - totalRuntimeMs;
  //         const runtimeSeconds = totalRuntimeMs / 1000;

  //         const availability = calculateAvailability(
  //           totalRuntimeMs,
  //           downtimeMs,
  //           totalQueryMs
  //         );
  //         const throughput = calculateThroughput(totalCount, misfeedCount);
  //         const efficiency =
  //           runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
  //         const oee = calculateOEE(availability, efficiency, throughput);

  //         return {
  //           machine: {
  //             serial,
  //             name: machineName,
  //           },
  //           currentStatus: {
  //             code: statusCode,
  //             name: statusName,
  //           },
  //           metrics: {
  //             runtime: {
  //               total: totalRuntimeMs,
  //               formatted: formatDuration(totalRuntimeMs),
  //             },
  //             downtime: {
  //               total: downtimeMs,
  //               formatted: formatDuration(downtimeMs),
  //             },
  //             output: {
  //               totalCount,
  //               misfeedCount,
  //             },
  //             performance: {
  //               availability: {
  //                 value: availability,
  //                 percentage: (availability * 100).toFixed(2),
  //               },
  //               throughput: {
  //                 value: throughput,
  //                 percentage: (throughput * 100).toFixed(2),
  //               },
  //               efficiency: {
  //                 value: efficiency,
  //                 percentage: (efficiency * 100).toFixed(2),
  //               },
  //               oee: {
  //                 value: oee,
  //                 percentage: (oee * 100).toFixed(2),
  //               },
  //             },
  //           },
  //           timeRange: {
  //             start: totalQueryStart,
  //             end: totalQueryEnd,
  //           },
  //         };
  //       })
  //     );

  //     res.json(results.filter(Boolean));
  //   } catch (err) {
  //     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //     res.status(500).json({
  //       error: `Failed to fetch machine dashboard summary data for ${req.url}`,
  //     });
  //   }
  // });

  //Updated machine summary route with station efficiency logic\
  router.get("/analytics/machine-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const activeSerials = await getActiveMachineSerials(db, start, end);
  
      const results = await Promise.all(
        activeSerials.map(async (serial) => {
          const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
          if (!bookended) return null;
  
          const { states, sessionStart, sessionEnd } = bookended;
          const runSessions = extractAllCyclesFromStatesForDashboard(states, sessionStart, sessionEnd).running;
          if (!runSessions.length) return null;
  
          const machineName = states.at(-1)?.machine?.name || "Unknown";
          const statusCode = states.at(-1)?.status?.code || 0;
          const statusName = states.at(-1)?.status?.name || "Unknown";
  
          let totalRuntimeMs = 0;
          let totalCount = 0;
          let misfeedCount = 0;
          let totalTimeCredit = 0;
          let totalAdjustedRuntimeSeconds = 0;
  
          const totalQueryStart = runSessions[0].start;
          const totalQueryEnd = runSessions.at(-1).end;
  
          for (const session of runSessions) {
            const sessionRuntimeMs = session.end - session.start;
            totalRuntimeMs += sessionRuntimeMs;
  
            // Aggregation to get counts and active station count
            const countCollection = getCountCollectionName(session.start);
            const [countAgg] = await db.collection(countCollection).aggregate([
              {
                $match: {
                  "machine.serial": serial,
                  timestamp: { $gte: session.start, $lte: session.end }
                }
              },
              {
                $facet: {
                  validCounts: [
                    {
                      $match: {
                        misfeed: { $ne: true },
                        "operator.id": { $ne: -1 }
                      }
                    },
                    { $count: "count" }
                  ],
                  misfeeds: [
                    { $match: { misfeed: true } },
                    { $count: "misfeedCount" }
                  ],
                  timeCredit: [
                    {
                      $match: {
                        misfeed: { $ne: true },
                        "operator.id": { $ne: -1 }
                      }
                    },
                    {
                      $group: {
                        _id: "$item.id",
                        standard: { $first: "$item.standard" },
                        count: { $sum: 1 }
                      }
                    },
                    {
                      $addFields: {
                        standardPerHour: {
                          $cond: [
                            { $lt: ["$standard", 60] },
                            { $multiply: ["$standard", 60] },
                            "$standard"
                          ]
                        }
                      }
                    },
                    {
                      $addFields: {
                        timeCredit: {
                          $cond: [
                            { $gt: ["$standardPerHour", 0] },
                            {
                              $divide: ["$count", { $divide: ["$standardPerHour", 3600] }]
                            },
                            0
                          ]
                        }
                      }
                    },
                    {
                      $group: {
                        _id: null,
                        totalTimeCredit: { $sum: "$timeCredit" }
                      }
                    }
                  ],
                  stationCount: [
                    {
                      $match: {
                        misfeed: { $ne: true },
                        "operator.id": { $ne: -1 },
                        station: { $ne: null }
                      }
                    },
                    {
                      $group: { _id: "$station" }
                    },
                    {
                      $count: "activeStations"
                    }
                  ]
                }
              }
            ]).toArray();
  
            const validCount = countAgg?.validCounts?.[0]?.count || 0;
            const misfeeds = countAgg?.misfeeds?.[0]?.misfeedCount || 0;
            const timeCredit = countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;
            const activeStations = countAgg?.stationCount?.[0]?.activeStations || 1;
  
            totalCount += validCount;
            misfeedCount += misfeeds;
            totalTimeCredit += timeCredit;
  
            // Add adjusted runtime based on active stations
            const sessionSeconds = sessionRuntimeMs / 1000;
            totalAdjustedRuntimeSeconds += sessionSeconds * activeStations;
          }
  
          const totalQueryMs = totalQueryEnd - totalQueryStart;
          const downtimeMs = totalQueryMs - totalRuntimeMs;
  
          const availability = calculateAvailability(totalRuntimeMs, downtimeMs, totalQueryMs);
          const throughput = calculateThroughput(totalCount, misfeedCount);
          const efficiency =
            totalAdjustedRuntimeSeconds > 0
              ? totalTimeCredit / totalAdjustedRuntimeSeconds
              : 0;
          const oee = calculateOEE(availability, efficiency, throughput);
  
          return {
            machine: {
              serial,
              name: machineName
            },
            currentStatus: {
              code: statusCode,
              name: statusName
            },
            metrics: {
              runtime: {
                total: totalRuntimeMs,
                formatted: formatDuration(totalRuntimeMs)
              },
              downtime: {
                total: downtimeMs,
                formatted: formatDuration(downtimeMs)
              },
              output: {
                totalCount,
                misfeedCount
              },
              performance: {
                availability: {
                  value: availability,
                  percentage: (availability * 100).toFixed(2)
                },
                throughput: {
                  value: throughput,
                  percentage: (throughput * 100).toFixed(2)
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2)
                },
                oee: {
                  value: oee,
                  percentage: (oee * 100).toFixed(2)
                }
              }
            },
            timeRange: {
              start: totalQueryStart,
              end: totalQueryEnd
            }
          };
        })
      );
  
      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch machine dashboard summary data for ${req.url}`
      });
    }
  });
  

  // router.get("/analytics/machine-summary/details", async (req, res) => {
  //   try {
  //     const { start, end } = parseAndValidateQueryParams(req);
  //     const serial = req.query.serial;
  //     if (!serial) {
  //       return res.status(400).json({ error: "Missing required query parameter: serial" });
  //     }

  //     const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
  //     if (!bookended) return res.status(404).json({ error: "No state data found for machine" });

  //     const { states, sessionStart, sessionEnd } = bookended;
  //     const runSessions = extractAllCyclesFromStatesForDashboard(states, sessionStart, sessionEnd).running;
  //     if (!runSessions.length) return res.status(404).json({ error: "No valid run sessions found for machine" });

  //     const machineName = states.at(-1)?.machine?.name || "Unknown";
  //     const statusCode = states.at(-1)?.status?.code || 0;
  //     const statusName = states.at(-1)?.status?.name || "Unknown";

  //     let totalRuntimeMs = 0;
  //     let totalCount = 0;
  //     let misfeedCount = 0;
  //     let totalTimeCredit = 0;
  //     let totalWorkedTimeMs = 0;

  //     const itemSummaryAccumulator = {};
  //     const validCountsAccumulator = [];
  //     const allCountsAccumulator = [];
  //     const itemSummarySessions = [];

  //     const totalQueryStart = runSessions[0].start;
  //     const totalQueryEnd = runSessions.at(-1).end;

  //     for (const session of runSessions) {
  //       const [aggResult, sessionValidCounts, sessionAllCounts] = await Promise.all([
  //         db.collection("count").aggregate([
  //           {
  //             $match: {
  //               "machine.serial": serial,
  //               timestamp: { $gte: session.start, $lte: session.end },
  //               misfeed: { $ne: true },
  //               "operator.id": { $ne: -1 },
  //             },
  //           },
  //           {
  //             $group: {
  //               _id: {
  //                 itemId: "$item.id",
  //                 operatorId: "$operator.id",
  //               },
  //               itemName: { $first: "$item.name" },
  //               standard: { $first: "$item.standard" },
  //               count: { $sum: 1 },
  //             },
  //           },
  //           {
  //             $group: {
  //               _id: "$_id.itemId",
  //               name: { $first: "$itemName" },
  //               standard: { $first: "$standard" },
  //               count: { $sum: "$count" },
  //               operators: { $addToSet: "$_id.operatorId" },
  //             },
  //           },
  //           {
  //             $project: {
  //               name: 1,
  //               standard: 1,
  //               count: 1,
  //               operatorCount: { $size: "$operators" },
  //             },
  //           },
  //         ]).toArray(),

  //         db.collection("count").find({
  //           "machine.serial": serial,
  //           timestamp: { $gte: session.start, $lte: session.end },
  //           misfeed: { $ne: true },
  //           "operator.id": { $ne: -1 },
  //         }).project({
  //           timestamp: 1,
  //           "item.name": 1,
  //           "item.standard": 1,
  //           "operator.id": 1,
  //           "operator.name": 1,
  //           "machine.serial": 1,
  //           misfeed: 1,
  //         }).toArray(),

  //         db.collection("count").find({
  //           "machine.serial": serial,
  //           timestamp: { $gte: session.start, $lte: session.end },
  //         }).project({
  //           timestamp: 1,
  //           misfeed: 1,
  //           "item.standard": 1,
  //           "item.id": 1,
  //           "operator.id": 1,
  //           "operator.name": 1,
  //           "machine.serial": 1,
  //         }).toArray(),
  //       ]);

  //       validCountsAccumulator.push(...sessionValidCounts);
  //       allCountsAccumulator.push(...sessionAllCounts);

  //       const runtimeMs = session.end - session.start;
  //       totalRuntimeMs += runtimeMs;

  //       const sessionItems = [];
  //       const sessionWorkedTimeMs = runtimeMs;

  //       for (const row of aggResult) {
  //         const itemId = row._id;
  //         const name = row.name;
  //         const standard = row.standard || 666;
  //         const count = row.count;
  //         const operatorCount = row.operatorCount || 1;
  //         const workedTimeMs = sessionWorkedTimeMs * operatorCount;
  //         const hours = workedTimeMs / 3600000;
  //         const pph = hours > 0 ? count / hours : 0;
  //         const efficiency = standard > 0 ? pph / standard : 0;

  //         totalWorkedTimeMs += workedTimeMs;
  //         totalCount += count;

  //         if (!itemSummaryAccumulator[itemId]) {
  //           itemSummaryAccumulator[itemId] = {
  //             name,
  //             standard,
  //             countTotal: 0,
  //             workedTimeMs: 0,
  //           };
  //         }

  //         itemSummaryAccumulator[itemId].countTotal += count;
  //         itemSummaryAccumulator[itemId].workedTimeMs += workedTimeMs;

  //         sessionItems.push({
  //           itemId,
  //           name,
  //           countTotal: count,
  //           standard,
  //           pph: Math.round(pph * 100) / 100,
  //           efficiency: Math.round(efficiency * 10000) / 100,
  //         });
  //       }

  //       itemSummarySessions.push({
  //         start: session.start,
  //         end: session.end,
  //         workedTimeMs: sessionWorkedTimeMs,
  //         workedTimeFormatted: formatDuration(sessionWorkedTimeMs),
  //         items: sessionItems,
  //       });

  //       const [countAgg] = await db.collection("count").aggregate([
  //         {
  //           $match: {
  //             "machine.serial": serial,
  //             timestamp: { $gte: session.start, $lte: session.end },
  //           },
  //         },
  //         {
  //           $facet: {
  //             misfeeds: [
  //               { $match: { misfeed: true } },
  //               { $count: "misfeedCount" },
  //             ],
  //             timeCredit: [
  //               {
  //                 $match: {
  //                   misfeed: { $ne: true },
  //                   "operator.id": { $ne: -1 },
  //                 },
  //               },
  //               {
  //                 $group: {
  //                   _id: { id: "$item.id" },
  //                   standard: { $first: "$item.standard" },
  //                   count: { $sum: 1 },
  //                 },
  //               },
  //               {
  //                 $addFields: {
  //                   standardPerHour: {
  //                     $cond: [
  //                       { $lt: ["$standard", 60] },
  //                       { $multiply: ["$standard", 60] },
  //                       "$standard",
  //                     ],
  //                   },
  //                 },
  //               },
  //               {
  //                 $addFields: {
  //                   timeCredit: {
  //                     $cond: [
  //                       { $gt: ["$standardPerHour", 0] },
  //                       {
  //                         $divide: [
  //                           "$count",
  //                           { $divide: ["$standardPerHour", 3600] },
  //                         ],
  //                       },
  //                       0,
  //                     ],
  //                   },
  //                 },
  //               },
  //               {
  //                 $group: {
  //                   _id: null,
  //                   totalTimeCredit: { $sum: "$timeCredit" },
  //                 },
  //               },
  //             ],
  //           },
  //         },
  //       ]).toArray();

  //       misfeedCount += countAgg?.misfeeds?.[0]?.misfeedCount || 0;
  //       totalTimeCredit += countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;
  //     }

  //     const totalQueryMs = totalQueryEnd - totalQueryStart;
  //     const downtimeMs = totalQueryMs - totalRuntimeMs;
  //     const runtimeSeconds = totalRuntimeMs / 1000;

  //     const availability = calculateAvailability(totalRuntimeMs, downtimeMs, totalQueryMs);
  //     const throughput = calculateThroughput(totalCount, misfeedCount);
  //     const efficiency = runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
  //     const oee = calculateOEE(availability, efficiency, throughput);

  //     const performance = {
  //       runtime: {
  //         total: totalRuntimeMs,
  //         formatted: formatDuration(totalRuntimeMs),
  //       },
  //       downtime: {
  //         total: downtimeMs,
  //         formatted: formatDuration(downtimeMs),
  //       },
  //       output: {
  //         totalCount,
  //         misfeedCount,
  //       },
  //       performance: {
  //         availability: {
  //           value: availability,
  //           percentage: (availability * 100).toFixed(2) + "%",
  //         },
  //         throughput: {
  //           value: throughput,
  //           percentage: (throughput * 100).toFixed(2) + "%",
  //         },
  //         efficiency: {
  //           value: efficiency,
  //           percentage: (efficiency * 100).toFixed(2) + "%",
  //         },
  //         oee: {
  //           value: oee,
  //           percentage: (oee * 100).toFixed(2) + "%",
  //         },
  //       },
  //     };

  //     const totalHours = totalWorkedTimeMs / 3600000;
  //     const machinePph = totalHours > 0 ? totalCount / totalHours : 0;
  //     const proratedStandard = totalCount > 0
  //       ? Object.values(itemSummaryAccumulator).reduce((acc, item) => {
  //           const weight = item.countTotal / totalCount;
  //           return acc + weight * item.standard;
  //         }, 0)
  //       : 0;
  //     const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

  //     const formattedItemSummaries = {};
  //     for (const [itemId, item] of Object.entries(itemSummaryAccumulator)) {
  //       const hours = item.workedTimeMs / 3600000;
  //       const pph = hours ? item.countTotal / hours : 0;
  //       const efficiency = item.standard ? pph / item.standard : 0;

  //       formattedItemSummaries[itemId] = {
  //         name: item.name,
  //         standard: item.standard,
  //         countTotal: item.countTotal,
  //         workedTimeFormatted: formatDuration(item.workedTimeMs),
  //         pph: Math.round(pph * 100) / 100,
  //         efficiency: Math.round(efficiency * 10000) / 100,
  //       };
  //     }

  //     const itemSummary = {
  //       sessions: itemSummarySessions,
  //       machineSummary: {
  //         totalCount,
  //         workedTimeMs: totalWorkedTimeMs,
  //         workedTimeFormatted: formatDuration(totalWorkedTimeMs),
  //         pph: Math.round(machinePph * 100) / 100,
  //         proratedStandard: Math.round(proratedStandard * 100) / 100,
  //         efficiency: Math.round(machineEff * 10000) / 100,
  //         itemSummaries: formattedItemSummaries,
  //       },
  //     };

  //     const itemHourlyStack = buildItemHourlyStack(
  //       validCountsAccumulator,
  //       totalQueryStart,
  //       totalQueryEnd
  //     );

  //     const faultData = buildFaultData(states, sessionStart, sessionEnd);

  //     const operatorEfficiency = await buildOperatorEfficiency(
  //       states,
  //       allCountsAccumulator,
  //       sessionStart,
  //       sessionEnd,
  //       serial
  //     );

  //     res.json({
  //       machine: { serial, name: machineName },
  //       currentStatus: { code: statusCode, name: statusName },
  //       performance,
  //       itemSummary,
  //       itemHourlyStack,
  //       faultData,
  //       operatorEfficiency,
  //     });
  //   } catch (err) {
  //     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //     res.status(500).json({ error: `Failed to fetch detailed machine data for ${req.url}` });
  //   }
  // });

  // Route for operator dashboard sessions

  // router.get("/analytics/operator-dashboard-sessions", async (req, res) => {
  //     try {
  //         const { start, end } = parseAndValidateQueryParams(req);
  //         const activeOperatorIds = await getActiveOperatorIds(db, start, end);

  //         const data = [];

  //         const results = await Promise.all(
  //             activeOperatorIds.map(async (operatorId) => {
  //                 const bookended = await getBookendedOperatorStatesAndTimeRange(
  //                     db,
  //                     operatorId,
  //                     start,
  //                     end
  //                   );

  //                   if (!bookended) return null;

  //                   const { states: operatorStates, sessionStart, sessionEnd } = bookended;

  //               if (!operatorStates.length) return null;

  //               const runSessions = extractAllCyclesFromStatesForDashboard(
  //                 operatorStates,
  //                 sessionStart,
  //                 sessionEnd
  //               ).running;

  //               if (!runSessions.length) return null;

  //             }))

  //         res.json(data);
  //     } catch (err) {
  //         logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //         res.status(500).json({
  //             error: `Failed to fetch operator dashboard data for ${req.url}`,
  //         });
  //     }
  // });

  // router.get("/analytics/operator-dashboard-sessions", async (req, res) => {
  //     try {
  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeOperatorIds = await getActiveOperatorIds(db, start, end);

  //       const results = await Promise.all(
  //         activeOperatorIds.map(async (operatorId) => {
  //           const bookended = await getBookendedOperatorStatesAndTimeRange(
  //             db,
  //             operatorId,
  //             start,
  //             end
  //           );

  //           if (!bookended) return null;

  //           const { states: operatorStates, sessionStart, sessionEnd } = bookended;
  //           if (!operatorStates.length) return null;

  //           const runSessions = extractAllCyclesFromStatesForDashboard(
  //             operatorStates,
  //             sessionStart,
  //             sessionEnd
  //           ).running;

  //           if (!runSessions.length) return null;

  //           // Get all counts for this operator only within session windows
  //           const sessionWindows = runSessions.map(({ start, end }) => ({
  //             $and: [
  //               { timestamp: { $gte: new Date(start), $lte: new Date(end) } },
  //               { "operator.id": operatorId },
  //             ],
  //           }));

  //           const counts = await db
  //             .collection("count")
  //             .find({ $or: sessionWindows })
  //             .project({
  //               timestamp: 1,
  //               "item.id": 1,
  //               "item.name": 1,
  //               "item.standard": 1,
  //               misfeed: 1,
  //               operator: 1,
  //             })
  //             .sort({ timestamp: 1 })
  //             .toArray();

  //           const groupedCounts = groupCountsByOperatorAndMachine(counts);
  //           const key = `${operatorId}-*`; // wildcard machine if you need machine grouping
  //           const validCounts = counts.filter((c) => !c.misfeed);
  //           const misfeedCounts = counts.filter((c) => c.misfeed);

  //           const stats = processCountStatistics(counts);

  //           const { runtime, pausedTime, faultTime } = calculateOperatorTimes(
  //             operatorStates,
  //             sessionStart,
  //             sessionEnd
  //           );

  //           const pph = calculatePiecesPerHour(stats.total, runtime);
  //           const efficiency = calculateEfficiency(runtime, stats.total, validCounts);

  //           const latestState = operatorStates.at(-1);

  //           return {
  //             operator: {
  //               id: operatorId,
  //               name: counts[0]?.operator?.name || "Unknown",
  //             },
  //             currentStatus: {
  //               code: latestState?.status?.code || 0,
  //               name: latestState?.status?.name || "Unknown",
  //             },
  //             runtime: {
  //               total: runtime,
  //               formatted: formatDuration(runtime),
  //             },
  //             pausedTime: {
  //               total: pausedTime,
  //               formatted: formatDuration(pausedTime),
  //             },
  //             faultTime: {
  //               total: faultTime,
  //               formatted: formatDuration(faultTime),
  //             },
  //             output: {
  //               totalCount: stats.total,
  //               misfeedCount: stats.misfeeds,
  //               validCount: stats.valid,
  //             },
  //             performance: {
  //               piecesPerHour: {
  //                 value: pph,
  //                 formatted: Math.round(pph).toString(),
  //               },
  //               efficiency: {
  //                 value: efficiency,
  //                 percentage: (efficiency * 100).toFixed(2) + "%",
  //               },
  //             },
  //           };
  //         })
  //       );

  //       res.json(results.filter(Boolean));
  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res.status(500).json({
  //         error: `Failed to fetch operator dashboard data for ${req.url}`,
  //       });
  //     }
  //   });

  // Current working route for operator dashboard sessions
  router.get("/analytics/operator-dashboard-sessions", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const activeOperatorIds = await getActiveOperatorIds(db, start, end);

      const results = await Promise.all(
        activeOperatorIds.map(async (operatorId) => {
          const bookended = await getBookendedOperatorStatesAndTimeRange(
            db,
            operatorId,
            start,
            end
          );
          if (!bookended) return null;

          const { states, sessionStart, sessionEnd } = bookended;
          const cyclePie = buildOperatorCyclePie(
            states,
            sessionStart,
            sessionEnd
          );

          if (!states.length) return null;

          const runSessions = extractAllCyclesFromStatesForDashboard(
            states,
            sessionStart,
            sessionEnd
          ).running;
          if (!runSessions.length) return null;

          const totalRunMs = runSessions.reduce(
            (sum, s) => sum + (s.duration || 0),
            0
          );
          const totalHours = totalRunMs / 3600000;

          const sessionWindows = runSessions.map(({ start, end }) => ({
            timestamp: { $gte: new Date(start), $lte: new Date(end) },
          }));

          const pipeline = [
            {
              $match: {
                "operator.id": operatorId,
                $or: sessionWindows,
              },
            },
            {
              $project: {
                misfeed: 1,
                timestamp: 1,
                hour: { $hour: "$timestamp" },
                "item.id": 1,
                "item.name": 1,
                "item.standard": 1,
                "operator.name": 1,
                "machine.serial": 1,
                "machine.name": 1,
              },
            },
            {
              $facet: {
                itemDetails: [
                  {
                    $group: {
                      _id: {
                        itemName: "$item.name",
                        itemId: "$item.id",
                        machineSerial: "$machine.serial",
                        machineName: "$machine.name",
                        operatorName: "$operator.name",
                      },
                      count: { $sum: 1 },
                      misfeed: { $sum: { $cond: ["$misfeed", 1, 0] } },
                      standard: { $first: "$item.standard" },
                    },
                  },
                  {
                    $addFields: {
                      valid: { $subtract: ["$count", "$misfeed"] },
                      standard: { $ifNull: ["$standard", 666] },
                    },
                  },
                  {
                    $addFields: {
                      pph: {
                        $cond: [
                          { $gt: [totalHours, 0] },
                          { $divide: ["$valid", totalHours] },
                          0,
                        ],
                      },
                      efficiency: {
                        $cond: [
                          { $gt: ["$standard", 0] },
                          {
                            $divide: [
                              {
                                $cond: [
                                  { $gt: [totalHours, 0] },
                                  { $divide: ["$valid", totalHours] },
                                  0,
                                ],
                              },
                              "$standard",
                            ],
                          },
                          0,
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      operatorName: "$_id.operatorName",
                      machineSerial: "$_id.machineSerial",
                      machineName: "$_id.machineName",
                      itemName: "$_id.itemName",
                      count: 1,
                      misfeed: 1,
                      standard: 1,
                      pph: { $round: ["$pph", 2] },
                      efficiency: {
                        $round: [{ $multiply: ["$efficiency", 100] }, 2],
                      },
                    },
                  },
                  { $sort: { itemName: 1 } },
                ],
                totals: [
                  {
                    $project: {
                      count: { $literal: 1 },
                      misfeed: { $cond: ["$misfeed", 1, 0] },
                      "item.standard": 1,
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      totalValid: { $sum: { $cond: ["$misfeed", 0, 1] } },
                      totalMisfeed: { $sum: "$misfeed" },
                      totalCount: { $sum: "$count" },
                      avgStandard: {
                        $avg: { $ifNull: ["$item.standard", 666] },
                      },
                    },
                  },
                ],
                hourlyItemBreakdown: [
                  {
                    $group: {
                      _id: {
                        hour: "$hour",
                        itemName: "$item.name",
                      },
                      count: { $sum: 1 },
                    },
                  },
                  {
                    $group: {
                      _id: "$_id.itemName",
                      hourlyCounts: {
                        $push: {
                          k: { $toString: "$_id.hour" },
                          v: "$count",
                        },
                      },
                    },
                  },
                  {
                    $project: {
                      item: "$_id",
                      hourlyCounts: {
                        $arrayToObject: "$hourlyCounts",
                      },
                    },
                  },
                ],
              },
            },
          ];

          const [result] = await db
            .collection("count")
            .aggregate(pipeline)
            .toArray();

          // Get latest machine from most recent stateTicker for operator
          const latestStateTicker = await db
            .collection("stateTicker")
            .find({
              "operators.id": operatorId,
            })
            .project({
              "machine.serial": 1,
              "machine.name": 1,
              "status.timestamp": 1,
            })
            .sort({ "status.timestamp": -1 })
            .limit(1)
            .toArray();

          const currentMachineSerial =
            latestStateTicker[0]?.machine?.serial || null;
          const currentMachineName =
            latestStateTicker[0]?.machine?.name || "Unknown";

          const totals = result.totals[0] || {
            totalValid: 0,
            totalMisfeed: 0,
            totalCount: 0,
            avgStandard: 666,
          };

          const itemDetails = result.itemDetails || [];
          const breakdown = result.hourlyItemBreakdown || [];

          const operatorName = itemDetails[0]?.operatorName || "Unknown";
          const machineSerial = itemDetails[0]?.machineSerial || "Unknown";
          const machineName = itemDetails[0]?.machineName || "Unknown";

          // Calculate runtime, pausedTime, faultTime from states
          const cycles = extractAllCyclesFromStates(
            states,
            sessionStart,
            sessionEnd
          );
          const runtimeMs = cycles.running.reduce(
            (sum, c) => sum + c.duration,
            0
          );
          const pausedMs = cycles.paused.reduce(
            (sum, c) => sum + c.duration,
            0
          );
          const faultMs = cycles.fault.reduce((sum, c) => sum + c.duration, 0);

          // Format durations as { hours, minutes }
          function formatHM(ms) {
            const totalMinutes = Math.floor(ms / 60000);
            return {
              hours: Math.floor(totalMinutes / 60),
              minutes: totalMinutes % 60,
            };
          }

          // Calculate output counts from itemDetails
          const totalCount = totals.totalCount || 0;
          const misfeedCount = totals.totalMisfeed || 0;
          const validCount = totals.totalValid || 0;

          // Calculate piecesPerHour and efficiency
          const runtimeHours = runtimeMs / 3600000;
          const piecesPerHour =
            runtimeHours > 0 ? validCount / runtimeHours : 0;
          const avgStandard = totals.avgStandard > 0 ? totals.avgStandard : 666;
          const efficiencyVal =
            avgStandard > 0 ? piecesPerHour / avgStandard : 0;

          // Build the detailed performance object
          const performance = {
            runtime: {
              total: runtimeMs,
              formatted: formatHM(runtimeMs),
            },
            pausedTime: {
              total: pausedMs,
              formatted: formatHM(pausedMs),
            },
            faultTime: {
              total: faultMs,
              formatted: formatHM(faultMs),
            },
            output: {
              totalCount,
              misfeedCount,
              validCount,
            },
            performance: {
              piecesPerHour: {
                value: piecesPerHour,
                formatted: Math.round(piecesPerHour).toString(),
              },
              efficiency: {
                value: efficiencyVal,
                percentage: (efficiencyVal * 100).toFixed(2) + "%",
              },
            },
          };

          // Step 1: Calculate local startDate and endDate for daily efficiency
          const originalEndDate = new Date(end);
          let efficiencyStartDate = new Date(start);
          if (originalEndDate - efficiencyStartDate < 7 * 86400000) {
            efficiencyStartDate = new Date(originalEndDate);
            efficiencyStartDate.setDate(originalEndDate.getDate() - 6);
            efficiencyStartDate.setHours(0, 0, 0, 0);
          }

          // Step 2: Run aggregation pipeline for daily valid count totals and avg standards
          const dailyCountsPipeline = [
            {
              $match: {
                "operator.id": operatorId,
                misfeed: { $ne: true },
                timestamp: { $gte: efficiencyStartDate, $lte: originalEndDate },
              },
            },
            {
              $project: {
                timestamp: 1,
                day: {
                  $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
                },
                "item.standard": 1,
              },
            },
            {
              $group: {
                _id: "$day",
                count: { $sum: 1 },
                avgStandard: {
                  $avg: {
                    $cond: [
                      { $gt: ["$item.standard", 0] },
                      "$item.standard",
                      666,
                    ],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ];
          const dailyCountsResult = await db
            .collection("count")
            .aggregate(dailyCountsPipeline)
            .toArray();

          // Step 3: Fetch all states for this operator, just for the daily efficiency time window
          const operatorStates = await fetchStatesForOperator(
            db,
            operatorId,
            efficiencyStartDate,
            originalEndDate
          );

          // Step 4: Extract completed Run cycles and calculate run time per day
          const runCycles = getCompletedCyclesForOperator(operatorStates);
          const runTimeByDay = {};
          for (const cycle of runCycles) {
            const dateKey = new Date(cycle.start).toISOString().split("T")[0];
            runTimeByDay[dateKey] =
              (runTimeByDay[dateKey] || 0) + (cycle.duration || 0);
          }

          // Step 5: Build the dailyEfficiency array from both sources
          const dailyEfficiencyArr = dailyCountsResult.map((day) => {
            const runMs = runTimeByDay[day._id] || 0;
            const runHours = runMs / 3600000;
            const pph = runHours > 0 ? day.count / runHours : 0;
            const efficiency =
              day.avgStandard > 0 ? (pph / day.avgStandard) * 100 : 0;
            return {
              date: day._id,
              efficiency: Math.round(efficiency * 100) / 100,
            };
          });

          // Build countsByItem for stacked chart
          const countsByItem = {
            title: "Operator Counts by item",
            data: {
              hours: Array.from({ length: 24 }, (_, i) => i),
              operators: {},
            },
          };
          for (const row of breakdown) {
            const hourly = Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
              hourly[h] = row.hourlyCounts?.[h.toString()] || 0;
            }
            countsByItem.data.operators[row.item] = hourly;
          }

          const faultHistory = buildOptimizedOperatorFaultHistorySingle(
            operatorId,
            operatorName,
            machineSerial,
            machineName,
            states,
            sessionStart,
            sessionEnd
          );

          return {
            operator: {
              id: operatorId,
              name: operatorName,
            },
            currentStatus: {
              code: states.at(-1)?.status?.code || 0,
              name: states.at(-1)?.status?.name || "Unknown",
            },
            currentMachine: {
              serial: currentMachineSerial,
              name: currentMachineName,
            },
            performance: performance,
            itemSummary: itemDetails.map((item) => ({
              ...item,
              workedTimeFormatted: formatDuration(totalRunMs),
            })),
            countByItem: countsByItem, // renamed from countByItemStacked
            cyclePie: cyclePie,
            faultHistory: faultHistory,
            dailyEfficiency: {
              operator: {
                id: operatorId,
                name: operatorName,
              },
              timeRange: {
                start: efficiencyStartDate.toISOString(),
                end: originalEndDate.toISOString(),
                totalDays: dailyEfficiencyArr.length,
              },
              data: dailyEfficiencyArr,
            },
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch operator dashboard data for ${req.url}`,
      });
    }
  });

  // Route without operator efficiency line
  // router.get("/analytics/operator-dashboard-sessions", async (req, res) => {
  //     try {
  //       const { start, end } = parseAndValidateQueryParams(req);
  //       const activeOperatorIds = await getActiveOperatorIds(db, start, end);

  //       const results = await Promise.all(
  //         activeOperatorIds.map(async (operatorId) => {
  //           const bookended = await getBookendedOperatorStatesAndTimeRange(
  //             db,
  //             operatorId,
  //             start,
  //             end
  //           );
  //           if (!bookended) return null;

  //           const { states, sessionStart, sessionEnd } = bookended;
  //           const cyclePie = buildOperatorCyclePie(states, sessionStart, sessionEnd);

  //           if (!states.length) return null;

  //           const runSessions = extractAllCyclesFromStatesForDashboard(
  //             states,
  //             sessionStart,
  //             sessionEnd
  //           ).running;
  //           if (!runSessions.length) return null;

  //                     const totalRunMs = runSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  //           const totalHours = totalRunMs / 3600000;

  //           const sessionWindows = runSessions.map(({ start, end }) => ({
  //             timestamp: { $gte: new Date(start), $lte: new Date(end) }
  //           }));

  //           const pipeline = [
  //             {
  //               $match: {
  //                 "operator.id": operatorId,
  //                 $or: sessionWindows
  //               }
  //             },
  //             {
  //               $project: {
  //                 misfeed: 1,
  //                 timestamp: 1,
  //                 hour: { $hour: "$timestamp" },
  //                 "item.id": 1,
  //                 "item.name": 1,
  //                 "item.standard": 1,
  //                 "operator.name": 1,
  //                 "machine.serial": 1,
  //                 "machine.name": 1
  //               }
  //             },
  //             {
  //               $facet: {
  //                 itemDetails: [
  //                   {
  //                     $group: {
  //                       _id: {
  //                         itemName: "$item.name",
  //                         itemId: "$item.id",
  //                         machineSerial: "$machine.serial",
  //                         machineName: "$machine.name",
  //                         operatorName: "$operator.name"
  //                       },
  //                       count: { $sum: 1 },
  //                       misfeed: { $sum: { $cond: ["$misfeed", 1, 0] } },
  //                       standard: { $first: "$item.standard" }
  //                     }
  //                   },
  //                   {
  //                     $addFields: {
  //                       valid: { $subtract: ["$count", "$misfeed"] },
  //                       standard: { $ifNull: ["$standard", 666] }
  //                     }
  //                   },
  //                   {
  //                     $addFields: {
  //                       pph: {
  //                         $cond: [
  //                           { $gt: [totalHours, 0] },
  //                           { $divide: ["$valid", totalHours] },
  //                           0
  //                         ]
  //                       },
  //                       efficiency: {
  //                         $cond: [
  //                           { $gt: ["$standard", 0] },
  //                           { $divide: [
  //                             {
  //                               $cond: [
  //                                 { $gt: [totalHours, 0] },
  //                                 { $divide: ["$valid", totalHours] },
  //                                 0
  //                               ]
  //                             },
  //                             "$standard"
  //                           ]},
  //                           0
  //                         ]
  //                       }
  //                     }
  //                   },
  //                   {
  //                     $project: {
  //                       operatorName: "$_id.operatorName",
  //                       machineSerial: "$_id.machineSerial",
  //                       machineName: "$_id.machineName",
  //                       itemName: "$_id.itemName",
  //                       count: 1,
  //                       misfeed: 1,
  //                       standard: 1,
  //                       pph: { $round: ["$pph", 2] },
  //                       efficiency: { $round: [{ $multiply: ["$efficiency", 100] }, 2] }
  //                     }
  //                   },
  //                   { $sort: { itemName: 1 } }
  //                 ],
  //                 totals: [
  //                   {
  //                     $group: {
  //                       _id: null,
  //                       totalValid: { $sum: { $subtract: ["$count", "$misfeed"] } },
  //                       totalMisfeed: { $sum: "$misfeed" },
  //                       totalCount: { $sum: "$count" },
  //                       avgStandard: { $avg: { $ifNull: ["$item.standard", 666] } }
  //                     }
  //                   }
  //                 ],
  //                 hourlyItemBreakdown: [
  //                   {
  //                     $group: {
  //                       _id: {
  //                         hour: "$hour",
  //                         itemName: "$item.name"
  //                       },
  //                       count: { $sum: 1 }
  //                     }
  //                   },
  //                   {
  //                     $group: {
  //                       _id: "$_id.itemName",
  //                       hourlyCounts: {
  //                         $push: {
  //                           k: { $toString: "$_id.hour" },
  //                           v: "$count"
  //                         }
  //                       }
  //                     }
  //                   },
  //                   {
  //                     $project: {
  //                       item: "$_id",
  //                       hourlyCounts: {
  //                         $arrayToObject: "$hourlyCounts"
  //                       }
  //                     }
  //                   }
  //                 ]
  //               }
  //             }
  //           ];

  //           const [result] = await db.collection("count").aggregate(pipeline).toArray();

  //           const totals = result.totals[0] || {
  //             totalValid: 0,
  //             totalMisfeed: 0,
  //             totalCount: 0,
  //             avgStandard: 666
  //           };

  //           const itemDetails = result.itemDetails || [];
  //           const breakdown = result.hourlyItemBreakdown || [];

  //           const pph = totalHours > 0 ? totals.totalValid / totalHours : 0;
  //           const efficiency = totals.avgStandard > 0 ? pph / totals.avgStandard : 0;

  //           // Build countsByItem for stacked chart
  //           const countsByItem = {
  //             title: "Operator Counts by item",
  //             data: {
  //               hours: Array.from({ length: 24 }, (_, i) => i),
  //               operators: {}
  //             }
  //           };
  //           for (const row of breakdown) {
  //             const hourly = Array(24).fill(0);
  //             for (let h = 0; h < 24; h++) {
  //               hourly[h] = row.hourlyCounts?.[h.toString()] || 0;
  //             }
  //             countsByItem.data.operators[row.item] = hourly;
  //           }

  //           return {
  //             operator: {
  //               id: operatorId,
  //               name: itemDetails[0]?.operatorName || "Unknown"
  //             },
  //             performance: {
  //               piecesPerHour: {
  //                 value: pph,
  //                 formatted: Math.round(pph).toString()
  //               },
  //               efficiency: {
  //                 value: efficiency,
  //                 percentage: (efficiency * 100).toFixed(2) + "%"
  //               }
  //             },
  //             output: {
  //               totalCount: totals.totalCount,
  //               validCount: totals.totalValid,
  //               misfeedCount: totals.totalMisfeed
  //             },
  //             itemSummary: itemDetails.map(item => ({
  //               ...item,
  //               workedTimeFormatted: formatDuration(totalRunMs)
  //             })),
  //             countByItemStacked: countsByItem,
  //             cyclePie: cyclePie
  //           };
  //         })
  //       );

  //       res.json(results.filter(Boolean));
  //     } catch (err) {
  //       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //       res.status(500).json({
  //         error: `Failed to fetch operator dashboard data for ${req.url}`
  //       });
  //     }
  //   });

  router.get("/analytics/operator-dashboard-sessions2", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const activeOperatorIds = await getActiveOperatorIds(db, start, end);

      const results = await Promise.all(
        activeOperatorIds.map(async (operatorId) => {
          const bookended = await getBookendedOperatorStatesAndTimeRange(
            db,
            operatorId,
            start,
            end
          );

          if (!bookended) return null;

          const {
            states: operatorStates,
            sessionStart,
            sessionEnd,
          } = bookended;
          if (!operatorStates.length) return null;

          const runSessions = extractAllCyclesFromStatesForDashboard(
            operatorStates,
            sessionStart,
            sessionEnd
          ).running;

          if (!runSessions.length) return null;

          // Get all counts for this operator only within session windows
          const sessionWindows = runSessions.map(({ start, end }) => ({
            $and: [
              { timestamp: { $gte: new Date(start), $lte: new Date(end) } },
              { "operator.id": operatorId },
            ],
          }));

          const counts = await db
            .collection("count")
            .find({ $or: sessionWindows })
            .project({
              timestamp: 1,
              "item.id": 1,
              "item.name": 1,
              "item.standard": 1,
              misfeed: 1,
              operator: 1,
            })
            .sort({ timestamp: 1 })
            .toArray();

          const groupedCounts = groupCountsByOperatorAndMachine(counts);
          const validCounts = counts.filter((c) => !c.misfeed);
          const misfeedCounts = counts.filter((c) => c.misfeed);

          const stats = processCountStatistics(counts);

          const { runtime, pausedTime, faultTime } = calculateOperatorTimes(
            operatorStates,
            sessionStart,
            sessionEnd
          );

          const pph = calculatePiecesPerHour(stats.total, runtime);
          const efficiency = calculateEfficiency(
            runtime,
            stats.total,
            validCounts
          );

          const latestState = operatorStates.at(-1);

          return {
            operator: {
              id: operatorId,
              name: counts[0]?.operator?.name || "Unknown",
            },
            currentStatus: {
              code: latestState?.status?.code || 0,
              name: latestState?.status?.name || "Unknown",
            },
            runtime: {
              total: runtime,
              formatted: formatDuration(runtime),
            },
            pausedTime: {
              total: pausedTime,
              formatted: formatDuration(pausedTime),
            },
            faultTime: {
              total: faultTime,
              formatted: formatDuration(faultTime),
            },
            output: {
              totalCount: stats.total,
              misfeedCount: stats.misfeeds,
              validCount: stats.valid,
            },
            performance: {
              piecesPerHour: {
                value: pph,
                formatted: Math.round(pph).toString(),
              },
              efficiency: {
                value: efficiency,
                percentage: (efficiency * 100).toFixed(2) + "%",
              },
            },
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch operator dashboard data for ${req.url}`,
      });
    }
  });

  // Operator summary route - similar to machine-summary but for operators
  router.get("/analytics/operator-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const activeOperatorIds = await getActiveOperatorIds(db, start, end);

      const results = await Promise.all(
        activeOperatorIds.map(async (operatorId) => {
          const bookended = await getBookendedOperatorStatesAndTimeRange(
            db,
            operatorId,
            start,
            end
          );
          if (!bookended) return null;

          const { states, sessionStart, sessionEnd } = bookended;
          const runSessions = extractAllCyclesFromStatesForDashboard(
            states,
            sessionStart,
            sessionEnd
          ).running;
          if (!runSessions.length) return null;

          let operatorName = "Unknown";
          const statusCode = states.at(-1)?.status?.code || 0;
          const statusName = states.at(-1)?.status?.name || "Unknown";

          let totalRuntimeMs = 0;
          let totalCount = 0;
          let misfeedCount = 0;
          let totalTimeCredit = 0;

          const totalQueryStart = runSessions[0].start;
          const totalQueryEnd = runSessions.at(-1).end;

          // Get latest machine from most recent stateTicker for operator
          const latestStateTicker = await db
            .collection("stateTicker")
            .find({
              "operators.id": operatorId,
            })
            .project({
              "machine.serial": 1,
              "machine.name": 1,
              "status.timestamp": 1,
            })
            .sort({ "status.timestamp": -1 })
            .limit(1)
            .toArray();

          const currentMachineSerial =
            latestStateTicker[0]?.machine?.serial || null;
          const currentMachineName =
            latestStateTicker[0]?.machine?.name || null;

          for (const session of runSessions) {
            totalRuntimeMs += session.end - session.start;

            const countCollection = getCountCollectionName(session.start);
            const [countAgg] = await db
              .collection(countCollection)
              .aggregate([
                {
                  $match: {
                    "operator.id": operatorId,
                    timestamp: { $gte: session.start, $lte: session.end },
                  },
                },
                {
                  $facet: {
                    validCounts: [
                      { $match: { misfeed: { $ne: true } } },
                      { $count: "count" },
                    ],
                    misfeeds: [
                      { $match: { misfeed: true } },
                      { $count: "misfeedCount" },
                    ],
                    timeCredit: [
                      { $match: { misfeed: { $ne: true } } },
                      {
                        $group: {
                          _id: "$item.id",
                          standard: { $first: "$item.standard" },
                          count: { $sum: 1 },
                        },
                      },
                      {
                        $addFields: {
                          standardPerHour: {
                            $cond: [
                              { $lt: ["$standard", 60] },
                              { $multiply: ["$standard", 60] },
                              "$standard",
                            ],
                          },
                        },
                      },
                      {
                        $addFields: {
                          timeCredit: {
                            $cond: [
                              { $gt: ["$standardPerHour", 0] },
                              {
                                $divide: [
                                  "$count",
                                  { $divide: ["$standardPerHour", 3600] },
                                ],
                              },
                              0,
                            ],
                          },
                        },
                      },
                      {
                        $group: {
                          _id: null,
                          totalTimeCredit: { $sum: "$timeCredit" },
                        },
                      },
                    ],
                    operatorInfo: [
                      { $limit: 1 },
                      {
                        $project: {
                          operatorName: "$operator.name",
                        },
                      },
                    ],
                  },
                },
              ])
              .toArray();

            totalCount += countAgg?.validCounts?.[0]?.count || 0;
            misfeedCount += countAgg?.misfeeds?.[0]?.misfeedCount || 0;
            totalTimeCredit += countAgg?.timeCredit?.[0]?.totalTimeCredit || 0;

            // Get operator name from the aggregation results (use first session's result)
            if (
              operatorName === "Unknown" &&
              countAgg?.operatorInfo?.[0]?.operatorName
            ) {
              operatorName = countAgg.operatorInfo[0].operatorName;
            }
          }

          const totalQueryMs = totalQueryEnd - totalQueryStart;
          const downtimeMs = totalQueryMs - totalRuntimeMs;
          const runtimeSeconds = totalRuntimeMs / 1000;

          const availability = calculateAvailability(
            totalRuntimeMs,
            downtimeMs,
            totalQueryMs
          );
          const throughput = calculateThroughput(totalCount, misfeedCount);
          const efficiency =
            runtimeSeconds > 0 ? totalTimeCredit / runtimeSeconds : 0;
          const oee = calculateOEE(availability, efficiency, throughput);

          return {
            operator: {
              id: operatorId,
              name: operatorName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            currentMachine: {
              serial: currentMachineSerial,
              name: currentMachineName,
            },
            metrics: {
              runtime: {
                total: totalRuntimeMs,
                formatted: formatDuration(totalRuntimeMs),
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
                  percentage: (availability * 100).toFixed(2),
                },
                throughput: {
                  value: throughput,
                  percentage: (throughput * 100).toFixed(2),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2),
                },
                oee: {
                  value: oee,
                  percentage: (oee * 100).toFixed(2),
                },
              },
            },
            timeRange: {
              start: totalQueryStart,
              end: totalQueryEnd,
            },
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch operator dashboard summary data for ${req.url}`,
      });
    }
  });

  // router.get("/analytics/operator-info", async (req, res) => {
  //   try {
  //     const { start, end, operatorId } = parseAndValidateQueryParams(req);
  //     if (!operatorId) {
  //       return res.status(400).json({ error: "Missing required operatorId parameter" });
  //     }

  //     const numericOperatorId = parseInt(operatorId);
  //     const bookended = await getBookendedOperatorStatesAndTimeRange(db, numericOperatorId, start, end);
  //     if (!bookended) return res.json(null);

  //     const { states, sessionStart, sessionEnd } = bookended;

  //     const runSessions = extractAllCyclesFromStatesForDashboard(states, sessionStart, sessionEnd).running;
  //     if (!runSessions.length) return res.json(null);

  //     const totalRunMs = runSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  //     const totalHours = totalRunMs / 3600000;

  //     const sessionWindows = runSessions.map(({ start, end }) => ({
  //       timestamp: { $gte: new Date(start), $lte: new Date(end) }
  //     }));

  //     const pipeline = [
  //       {
  //         $match: {
  //           "operator.id": numericOperatorId,
  //           $or: sessionWindows
  //         }
  //       },
  //       {
  //         $project: {
  //           misfeed: 1,
  //           timestamp: 1,
  //           hour: { $hour: "$timestamp" },
  //           "item.id": 1,
  //           "item.name": 1,
  //           "item.standard": 1,
  //           "operator.name": 1,
  //           "machine.serial": 1,
  //           "machine.name": 1
  //         }
  //       },
  //       {
  //         $facet: {
  //           itemDetails: [
  //             {
  //               $group: {
  //                 _id: {
  //                   itemName: "$item.name",
  //                   itemId: "$item.id",
  //                   machineSerial: "$machine.serial",
  //                   machineName: "$machine.name",
  //                   operatorName: "$operator.name"
  //                 },
  //                 count: { $sum: 1 },
  //                 misfeed: { $sum: { $cond: ["$misfeed", 1, 0] } },
  //                 standard: { $first: "$item.standard" }
  //               }
  //             },
  //             {
  //               $addFields: {
  //                 valid: { $subtract: ["$count", "$misfeed"] },
  //                 standard: { $ifNull: ["$standard", 666] }
  //               }
  //             },
  //             {
  //               $addFields: {
  //                 pph: {
  //                   $cond: [
  //                     { $gt: [totalHours, 0] },
  //                     { $divide: ["$valid", totalHours] },
  //                     0
  //                   ]
  //                 },
  //                 efficiency: {
  //                   $cond: [
  //                     { $gt: ["$standard", 0] },
  //                     {
  //                       $divide: [
  //                         {
  //                           $cond: [
  //                             { $gt: [totalHours, 0] },
  //                             { $divide: ["$valid", totalHours] },
  //                             0
  //                           ]
  //                         },
  //                         "$standard"
  //                       ]
  //                     },
  //                     0
  //                   ]
  //                 }
  //               }
  //             },
  //             {
  //               $project: {
  //                 operatorName: "$_id.operatorName",
  //                 machineSerial: "$_id.machineSerial",
  //                 machineName: "$_id.machineName",
  //                 itemName: "$_id.itemName",
  //                 count: 1,
  //                 misfeed: 1,
  //                 standard: 1,
  //                 pph: { $round: ["$pph", 2] },
  //                 efficiency: { $round: [{ $multiply: ["$efficiency", 100] }, 2] }
  //               }
  //             },
  //             { $sort: { itemName: 1 } }
  //           ],
  //           totals: [
  //             {
  //               $project: {
  //                 count: { $literal: 1 },
  //                 misfeed: { $cond: ["$misfeed", 1, 0] },
  //                 "item.standard": 1
  //               }
  //             },
  //             {
  //               $group: {
  //                 _id: null,
  //                 totalValid: { $sum: { $cond: ["$misfeed", 0, 1] } },
  //                 totalMisfeed: { $sum: "$misfeed" },
  //                 totalCount: { $sum: "$count" },
  //                 avgStandard: { $avg: { $ifNull: ["$item.standard", 666] } }
  //               }
  //             }
  //           ],
  //           hourlyItemBreakdown: [
  //             {
  //               $group: {
  //                 _id: {
  //                   hour: "$hour",
  //                   itemName: "$item.name"
  //                 },
  //                 count: { $sum: 1 }
  //               }
  //             },
  //             {
  //               $group: {
  //                 _id: "$_id.itemName",
  //                 hourlyCounts: {
  //                   $push: {
  //                     k: { $toString: "$_id.hour" },
  //                     v: "$count"
  //                   }
  //                 }
  //               }
  //             },
  //             {
  //               $project: {
  //                 item: "$_id",
  //                 hourlyCounts: { $arrayToObject: "$hourlyCounts" }
  //               }
  //             }
  //           ]
  //         }
  //       }
  //     ];

  //     const [result] = await db.collection("count").aggregate(pipeline).toArray();
  //     const itemDetails = result.itemDetails || [];
  //     const breakdown = result.hourlyItemBreakdown || [];

  //     const operatorName = itemDetails[0]?.operatorName || "Unknown";
  //     const machineSerial = itemDetails[0]?.machineSerial || "Unknown";
  //     const machineName = itemDetails[0]?.machineName || "Unknown";

  //     const countsByItem = {
  //       title: "Operator Counts by item",
  //       data: {
  //         hours: Array.from({ length: 24 }, (_, i) => i),
  //         operators: {}
  //       }
  //     };

  //     for (const row of breakdown) {
  //       const hourly = Array(24).fill(0);
  //       for (let h = 0; h < 24; h++) {
  //         hourly[h] = row.hourlyCounts?.[h.toString()] || 0;
  //       }
  //       countsByItem.data.operators[row.item] = hourly;
  //     }

  //     const faultHistory = buildOptimizedOperatorFaultHistorySingle(
  //       numericOperatorId,
  //       operatorName,
  //       machineSerial,
  //       machineName,
  //       states,
  //       sessionStart,
  //       sessionEnd
  //     );

  //     // DAILY EFFICIENCY
  //     const originalEndDate = new Date(end);
  //     let efficiencyStartDate = new Date(start);
  //     if (originalEndDate - efficiencyStartDate < 7 * 86400000) {
  //       efficiencyStartDate = new Date(originalEndDate);
  //       efficiencyStartDate.setDate(originalEndDate.getDate() - 6);
  //       efficiencyStartDate.setHours(0, 0, 0, 0);
  //     }

  //     const dailyCountsPipeline = [
  //       {
  //         $match: {
  //           "operator.id": numericOperatorId,
  //           misfeed: { $ne: true },
  //           timestamp: { $gte: efficiencyStartDate, $lte: originalEndDate }
  //         }
  //       },
  //       {
  //         $project: {
  //           timestamp: 1,
  //           day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
  //           "item.standard": 1
  //         }
  //       },
  //       {
  //         $group: {
  //           _id: "$day",
  //           count: { $sum: 1 },
  //           avgStandard: {
  //             $avg: {
  //               $cond: [{ $gt: ["$item.standard", 0] }, "$item.standard", 666]
  //             }
  //           }
  //         }
  //       },
  //       { $sort: { _id: 1 } }
  //     ];
  //     const dailyCountsResult = await db.collection("count").aggregate(dailyCountsPipeline).toArray();

  //     const operatorStates = await fetchStatesForOperator(
  //       db,
  //       numericOperatorId,
  //       efficiencyStartDate,
  //       originalEndDate
  //     );

  //     const runCycles = getCompletedCyclesForOperator(operatorStates);
  //     const runTimeByDay = {};
  //     for (const cycle of runCycles) {
  //       const dateKey = new Date(cycle.start).toISOString().split("T")[0];
  //       runTimeByDay[dateKey] = (runTimeByDay[dateKey] || 0) + (cycle.duration || 0);
  //     }

  //     const dailyEfficiencyArr = dailyCountsResult.map(day => {
  //       const runMs = runTimeByDay[day._id] || 0;
  //       const runHours = runMs / 3600000;
  //       const pph = runHours > 0 ? day.count / runHours : 0;
  //       const efficiency = day.avgStandard > 0 ? (pph / day.avgStandard) * 100 : 0;
  //       return {
  //         date: day._id,
  //         efficiency: Math.round(efficiency * 100) / 100
  //       };
  //     });

  //     res.json({
  //       itemSummary: itemDetails,
  //       countByItem: countsByItem,
  //       cyclePie: buildOperatorCyclePie(states, sessionStart, sessionEnd),
  //       faultHistory,
  //       dailyEfficiency: {
  //         operator: {
  //           id: numericOperatorId,
  //           name: operatorName
  //         },
  //         timeRange: {
  //           start: efficiencyStartDate.toISOString(),
  //           end: originalEndDate.toISOString(),
  //           totalDays: dailyEfficiencyArr.length
  //         },
  //         data: dailyEfficiencyArr
  //       }
  //     });
  //   } catch (err) {
  //     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  //     res.status(500).json({
  //       error: `Failed to fetch extended operator info for ${req.url}`
  //     });
  //   }
  // });

  router.get("/analytics/operator-info", async (req, res) => {
    try {
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
      if (!operatorId) {
        return res
          .status(400)
          .json({ error: "Missing required operatorId parameter" });
      }

      const numericOperatorId = parseInt(operatorId);
      const bookended = await getBookendedOperatorStatesAndTimeRange(
        db,
        numericOperatorId,
        start,
        end
      );
      if (!bookended) return res.json(null);

      const { states, sessionStart, sessionEnd } = bookended;
      if (!states.length) return res.json(null);

      const runSessions = extractAllCyclesFromStatesForDashboard(
        states,
        sessionStart,
        sessionEnd
      ).running;
      if (!runSessions.length) return res.json(null);

      const totalRunMs = runSessions.reduce(
        (sum, s) => sum + (s.duration || 0),
        0
      );
      const totalHours = totalRunMs / 3600000;

      const sessionWindows = runSessions.map(({ start, end }) => ({
        timestamp: { $gte: new Date(start), $lte: new Date(end) },
      }));

      // Fetch all counts for this operator within session windows
      const countCollection = getCountCollectionName(start);
      const counts = await db
        .collection(countCollection)
        .find({
          "operator.id": numericOperatorId,
          $or: sessionWindows,
        })
        .toArray();

      const validCounts = counts.filter((c) => !c.misfeed);
      const misfeedMap = new Map();
      for (const c of counts) {
        if (c.misfeed && c.item?.id) {
          const id = c.item.id;
          misfeedMap.set(id, (misfeedMap.get(id) || 0) + 1);
        }
      }

      // Build itemSummary (same as /operator-dashboard-sessions)
      const itemMap = {};
      const runCycles = getCompletedCyclesForOperator(states);
      // STEP 1: Group count timestamps by itemId
      const itemTimestampMap = {}; // itemId -> [timestamps]
      for (const count of validCounts) {
        const itemId = count.item?.id || "unknown";
        if (!itemTimestampMap[itemId]) itemTimestampMap[itemId] = [];
        itemTimestampMap[itemId].push(new Date(count.timestamp));
      }

      // STEP 2: For each item, sum run durations where any of its timestamps fall
      const itemRuntimeMap = {}; // itemId -> total run ms
      for (const [itemId, timestamps] of Object.entries(itemTimestampMap)) {
        itemRuntimeMap[itemId] = 0;

        for (const [itemId, timestamps] of Object.entries(itemTimestampMap)) {
          const seenCycleIds = new Set(); // to avoid double counting
          itemRuntimeMap[itemId] = 0;

          for (const ts of timestamps) {
            for (let i = 0; i < runCycles.length; i++) {
              const cycle = runCycles[i];
              if (
                ts >= cycle.start &&
                ts <= cycle.end &&
                !seenCycleIds.has(i)
              ) {
                itemRuntimeMap[itemId] += cycle.duration || 0;
                seenCycleIds.add(i);
                break; // move to next timestamp
              }
            }
          }
        }
      }

      for (const count of validCounts) {
        const item = count.item || {};
        const operator = count.operator || {};
        const machineSerial = count.machine?.serial || "Unknown";
        const machineName = count.machine?.name || "Unknown";

        const itemId = item.id || -1;
        const itemName = item.name || "Unknown";
        const standard = item.standard > 0 ? item.standard : 666;
        const operatorName = operator.name || "Unknown";

        const key = `${operatorName}-${machineSerial}-${itemName}`;

        if (!itemMap[key]) {
          itemMap[key] = {
            operatorName,
            machineSerial,
            machineName,
            itemName,
            count: 0,
            misfeed: misfeedMap.get(itemId) || 0,
            rawRunMs: 0,
            standard,
          };
        }

        itemMap[key].count += 1;
        itemMap[key].rawRunMs = itemRuntimeMap[itemId] || 0;
      }

      const itemSummary = Object.values(itemMap).map((row) => {
        const hours = row.rawRunMs / 3600000;
        const pph = hours > 0 ? row.count / hours : 0;
        const efficiency = row.standard > 0 ? pph / row.standard : 0;

        return {
          ...row,
          workedTimeFormatted: formatDuration(row.rawRunMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(efficiency * 10000) / 100,
        };
      });

      // Build hourly item breakdown
      const hourlyBreakdownMap = {};
      for (const c of counts) {
        const hour = new Date(c.timestamp).getHours();
        const item = c.item?.name || "Unknown";
        if (!hourlyBreakdownMap[item]) {
          hourlyBreakdownMap[item] = Array(24).fill(0);
        }
        hourlyBreakdownMap[item][hour] += 1;
      }

      const countByItem = {
        title: "Operator Counts by item",
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          operators: hourlyBreakdownMap,
        },
      };

      const operatorName = itemSummary[0]?.operatorName || "Unknown";
      const machineSerial = itemSummary[0]?.machineSerial || "Unknown";
      const machineName = itemSummary[0]?.machineName || "Unknown";

      const faultHistory = buildOptimizedOperatorFaultHistorySingle(
        numericOperatorId,
        operatorName,
        machineSerial,
        machineName,
        states,
        sessionStart,
        sessionEnd
      );

      // Daily efficiency
      const originalEndDate = new Date(end);
      let efficiencyStartDate = new Date(start);
      if (originalEndDate - efficiencyStartDate < 7 * 86400000) {
        efficiencyStartDate = new Date(originalEndDate);
        efficiencyStartDate.setDate(originalEndDate.getDate() - 6);
        efficiencyStartDate.setHours(0, 0, 0, 0);
      }

      const dailyCountsPipeline = [
        {
          $match: {
            "operator.id": numericOperatorId,
            misfeed: { $ne: true },
            timestamp: { $gte: efficiencyStartDate, $lte: originalEndDate },
          },
        },
        {
          $project: {
            timestamp: 1,
            day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            "item.standard": 1,
          },
        },
        {
          $group: {
            _id: "$day",
            count: { $sum: 1 },
            avgStandard: {
              $avg: {
                $cond: [{ $gt: ["$item.standard", 0] }, "$item.standard", 666],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ];
      const dailyCountsResult = await db
        .collection("count")
        .aggregate(dailyCountsPipeline)
        .toArray();

      const operatorStates = await fetchStatesForOperator(
        db,
        numericOperatorId,
        efficiencyStartDate,
        originalEndDate
      );

      const runCyclesDaily = getCompletedCyclesForOperator(operatorStates);
      const runTimeByDay = {};
      for (const cycle of runCyclesDaily) {
        const dateKey = new Date(cycle.start).toISOString().split("T")[0];
        runTimeByDay[dateKey] =
          (runTimeByDay[dateKey] || 0) + (cycle.duration || 0);
      }

      const dailyEfficiencyArr = dailyCountsResult.map((day) => {
        const runMs = runTimeByDay[day._id] || 0;
        const runHours = runMs / 3600000;
        const pph = runHours > 0 ? day.count / runHours : 0;
        const efficiency =
          day.avgStandard > 0 ? (pph / day.avgStandard) * 100 : 0;
        return {
          date: day._id,
          efficiency: Math.round(efficiency * 100) / 100,
        };
      });

      res.json({
        itemSummary,
        countByItem,
        cyclePie: buildOperatorCyclePie(states, sessionStart, sessionEnd),
        faultHistory,
        dailyEfficiency: {
          operator: {
            id: numericOperatorId,
            name: operatorName,
          },
          timeRange: {
            start: efficiencyStartDate.toISOString(),
            end: originalEndDate.toISOString(),
            totalDays: dailyEfficiencyArr.length,
          },
          data: dailyEfficiencyArr,
        },
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: `Failed to fetch extended operator info for ${req.url}`,
      });
    }
  });

  // Efficiency Screens

  router.get("/analytics/machine-live-summary", async (req, res) => {
    try {
      const { serial, date } = req.query;
      if (!serial || !date) {
        return res.status(400).json({ error: "Missing serial or date" });
      }

      const recentState = await getMostRecentStateForMachine(db, serial, date);
      if (!recentState) {
        return res.status(404).json({
          message: "No state found for this machine on the given date.",
        });
      }

      const baseFlipperData = buildInitialFlipperOutputs(recentState);

      const now = new Date(DateTime.now().toISO());
      const dayStart = new Date(DateTime.now().startOf('day').toISO());
      const currentTime = new Date(DateTime.now().toISO());

      const timeFrames = {
        today: { start: dayStart, end: currentTime },
        lastHour: {
          start: new Date(DateTime.now().minus({hours:1}).toISO()),
          end: currentTime,
        },
        lastFifteenMinutes: {
          start: new Date(DateTime.now().minus({minutes:15}).toISO()),
          end: currentTime,
        },
        lastSixMinutes: {
          start: new Date(DateTime.now().minus({minutes:6}).toISO()),
          end: currentTime,
        },
      };

      const machineStates = await fetchStatesForMachine(
        db,
        parseInt(serial),
        dayStart,
        now
      );

      // Calculate machine-level OEE first
      const machineOee = {};
      
      // Get all counts for the machine (not per operator)
      const allMachineCounts = await getCountsForMachine(
        db,
        parseInt(serial),
        dayStart,
        now
      );
      
      // Group all counts by machine (not by operator)
      const allGrouped = groupCountsByOperatorAndMachine(allMachineCounts);
      const allValid = [];
      const allMisfeed = [];
      
      // Collect all valid and misfeed counts across all operators
      Object.values(allGrouped).forEach(group => {
        if (group.validCounts) allValid.push(...group.validCounts);
        if (group.misfeedCounts) allMisfeed.push(...group.misfeedCounts);
      });

      for (const [label, { start, end }] of Object.entries(timeFrames)) {
        const filteredValid = allValid.filter(
          (c) =>
            new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
        );

        const filteredMisfeed = allMisfeed.filter(
          (c) =>
            new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
        );

        // Calculate machine-level runtime from all states
        const relevantStates = machineStates.filter(
          (s) =>
            new Date(s.timestamp) >= start && new Date(s.timestamp) <= end
        );

        const runningCycles = extractAllCyclesFromStates(
          relevantStates,
          start,
          end
        ).running;

        let runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

        // Fallback: assume still running if no cycles AND recent state shows status.code === 1
        const shouldAssumeRunning =
          runtimeMs === 0 &&
          ["lastSixMinutes", "lastFifteenMinutes", "lastHour"].includes(
            label
          ) &&
          recentState.status?.code === 1;

        if (shouldAssumeRunning) {
          runtimeMs = end - start;
        }

        const eff = calculateEfficiency(
          runtimeMs,
          filteredValid.length,
          filteredValid
        );

        const totalQueryMs = end - start;
        const downtimeMs = totalQueryMs - runtimeMs;
        
        const availability = calculateAvailability(
          runtimeMs,
          downtimeMs,
          totalQueryMs
        );
        
        const throughput = calculateThroughput(
          filteredValid.length,
          filteredMisfeed.length
        );
        
        const oeeValue = calculateOEE(availability, eff, throughput);

        const labelDisplayMap = {
          lastSixMinutes: "Last 6 Mins",
          lastFifteenMinutes: "Last 15 Mins",
          lastHour: "Last Hour",
          today: "All Day",
        };

        const displayLabel = labelDisplayMap[label] || label;

        machineOee[label] = {
          value: Math.round(oeeValue * 100),
          label: displayLabel,
          color: oeeValue >= 0.9 ? "green" : oeeValue >= 0.7 ? "yellow" : "red",
          availability: Math.round(availability * 100),
          efficiency: Math.round(eff * 100),
          throughput: Math.round(throughput * 100)
        };
      }

      const finalFlipperData = [];

      for (const entry of baseFlipperData) {
        const allCounts = await getCountsForMachine(
          db,
          parseInt(serial),
          dayStart,
          now,
          entry.operatorId
        );
        const grouped = groupCountsByOperatorAndMachine(allCounts);
        const key = `${entry.operatorId}-${serial}`;
        const all = grouped[key]?.counts || [];
        const valid = grouped[key]?.validCounts || [];
        const misfeed = grouped[key]?.misfeedCounts || [];

        const firstValid = valid[0] || {};
        const operatorName = firstValid?.operator?.name || "Unknown";
        const itemName = firstValid?.item?.name || "";
        const itemCode = firstValid?.item?.id || 0;

        const operatorStates = machineStates.filter((s) =>
          s.operators?.some((op) => Number(op.id) === Number(entry.operatorId))
        );

        const efficiency = {};

        for (const [label, { start, end }] of Object.entries(timeFrames)) {
          const filteredValid = valid.filter(
            (c) =>
              new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
          );

          const relevantStates = operatorStates.filter(
            (s) =>
              new Date(s.timestamp) >= start && new Date(s.timestamp) <= end
          );

          const runningCycles = extractAllCyclesFromStates(
            relevantStates,
            start,
            end
          ).running;

          let runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

          // Fallback: assume still running if no cycles AND recent state shows status.code === 1
          const shouldAssumeRunning =
            runtimeMs === 0 &&
            ["lastSixMinutes", "lastFifteenMinutes", "lastHour"].includes(
              label
            ) &&
            recentState.status?.code === 1 &&
            operatorStates.some((s) =>
              s.operators?.some(
                (op) => Number(op.id) === Number(entry.operatorId)
              )
            );

          if (shouldAssumeRunning) {
            runtimeMs = end - start;
          }

          const eff = calculateEfficiency(
            runtimeMs,
            filteredValid.length,
            filteredValid
          );

          const labelDisplayMap = {
            lastSixMinutes: "Last 6 Mins",
            lastFifteenMinutes: "Last 15 Mins",
            lastHour: "Last Hour",
            today: "All Day",
          };

          const displayLabel = labelDisplayMap[label] || label;

          efficiency[label] = {
            value: Math.round(eff * 100),
            label: displayLabel,
            color: eff >= 0.9 ? "green" : eff >= 0.7 ? "yellow" : "red",
          };
        }

        // Get all unique item names from most recent session
        const uniqueItems = [
          ...new Set(valid.map((v) => v.item?.name).filter(Boolean)),
        ];
        const itemConcat = uniqueItems.join(", ") || "";

        // Fixed batch codes for each lane (4 lanes total)
        const fixedBatchCodes = [10000001, 10000001, 10000001, 10000001];
        const batchCode = fixedBatchCodes[finalFlipperData.length] || 10000001;

        finalFlipperData.push({
          status: entry.status,
          fault: entry.fault,
          operator: operatorName,
          operatorId: entry.operatorId,
          machine: entry.machine,
          timers: {
            on: 0,
            ready: 0,
          },
          displayTimers: {
            on: "",
            run: "",
          },
          efficiency,
          oee: machineOee, // Use the machine-level OEE for all lanes
          batch: {
            item: itemConcat,
            code: batchCode,
          },
        });
      }

      return res.json({ flipperData: finalFlipperData });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
