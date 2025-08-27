const express = require("express");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // Utility imports
  const {
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    formatDuration,
    getHourlyIntervals,
  } = require("../../utils/time");

  // State + Count imports
  const {
    fetchStatesForMachine,
    getAllMachineSerials,
    groupStatesByMachine,
    extractAllCyclesFromStates,
    extractFaultCycles,
    getAllMachinesFromStates,
    getAllMachineSerialsAndNames,
  } = require("../../utils/state");

  const {
    getCountsForMachine,
    groupCountsByOperatorAndMachine,
    groupCountsByItem,
    processCountStatistics,
  } = require("../../utils/count");

  // Dashboard Builders
  const {
    buildMachinePerformance,
    buildMachineItemSummary,
    buildItemHourlyStack,
    buildFaultData,
    buildOperatorEfficiency,
    buildCurrentOperators,
  } = require("../../utils/machineDashboardBuilder");

  const {
    buildMachineOEE,
    buildDailyItemHourlyStack,
    buildPlantwideMetricsByHour,
  } = require("../../utils/dailyDashboardBuilder");

  const {
    fetchGroupedAnalyticsData,
    fetchGroupedAnalyticsDataForMachine,
    fetchGroupedAnalyticsDataWithOperators,
  } = require("../../utils/fetchData");

  const {
    buildLiveOperatorEfficiencySummary,
    getMostRecentStateForMachine,
    buildInitialFlipperOutputs,
  } = require("../../utils/demoFlipperBuilder");

  const {
    calculateDowntime,
    calculateAvailability,
    calculateEfficiency,
    calculateOEE,
    calculateThroughput,
    calculateTotalCount,
    calculateOperatorTimes,
    calculateMisfeeds,
  } = require("../../utils/analytics");

  const { getBookendedGlobalRange } = require("../../utils/miscFunctions");
  const {getBookendedStatesAndTimeRange} = require("../../utils/bookendingBuilder")
  const { buildMachineSessionAnalytics } = require('../../utils/machineSessionAnalytics');

  // router.get("/machine-dashboard", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const serialNamePairs = serial
  // ? [parseInt(serial)]
  // : await getAllMachineSerialsAndNames(db, paddedStart, paddedEnd);

  // const results = [];

  // for (const { serial: machineSerial, name: machineName } of serialNamePairs) {
  //   const states = await fetchStatesForMachine(db, machineSerial, paddedStart, paddedEnd);
  //   const counts = await getCountsForMachine(db, machineSerial, paddedStart, paddedEnd);

  //   if (!states.length) continue;

  //   const performance = await buildMachinePerformance(db, states, counts, start, end);
  //   const itemSummary = await buildMachineItemSummary(states, counts, start, end);
  //   const itemHourlyStack = await buildItemHourlyStack(counts, start, end);
  //   const faultData = await buildFaultData(states, start, end);
  //   const operatorEfficiency = await buildOperatorEfficiency(states, counts, start, end, machineSerial);

  //   const latestState = states[states.length - 1];
  //   const statusCode = latestState.status?.code || 0;
  //   const statusName = latestState.status?.name || "Unknown";

  //   results.push({
  //     machine: {
  //       serial: machineSerial,
  //       name: machineName,
  //     },
  //     currentStatus: {
  //       code: statusCode,
  //       name: statusName,
  //     },
  //     performance,
  //     itemSummary,
  //     itemHourlyStack,
  //     faultData,
  //     operatorEfficiency
  //   });
  // }

  //     res.json(results);
  //   } catch (err) {
  //     logger.error("Error in /machine-dashboard route:", err);
  //     res.status(500).json({ error: "Failed to fetch dashboard data" });
  //   }
  // });

  // router.get("/machine-dashboard", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const targetSerials = serial ? [serial] : [];

  //     const groupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "machine",
  //       { targetSerials }
  //     );

  //     const results = [];

  //     for (const [serial, group] of Object.entries(groupedData)) {
  //       const machineSerial = parseInt(serial);
  //       const { states, counts } = group;

  //       if (!states.length) continue;

  //       // ✅ Compute performance using pre-filtered counts
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
  //       const operatorEfficiency = await buildOperatorEfficiency(states, counts.valid, start, end, parseInt(serial));

  //       const latestState = states[states.length - 1];
  //       const statusCode = latestState.status?.code || 0;
  //       const statusName = latestState.status?.name || "Unknown";
  //       const machineName = latestState.machine?.name || "Unknown";

  //       results.push({
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

  //     res.json(results);
  //   } catch (err) {
  //     logger.error("Error in /machine-dashboard route:", err);
  //     res.status(500).json({ error: "Failed to fetch dashboard data" });
  //   }
  // });
// LAST WORKING ROUTE WITHOUT BOOKENDING
  // router.get("/machine-dashboard", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const targetSerials = serial ? [serial] : [];

  //     const groupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       paddedStart,
  //       paddedEnd,
  //       "machine",
  //       { targetSerials }
  //     );

  //     const results = await Promise.all(
  //       Object.entries(groupedData).map(async ([serial, group]) => {
  //         const machineSerial = parseInt(serial);
  //         const { states, counts } = group;

  //         if (!states.length && !counts.valid.length) return null;

  //         const latest = states[states.length - 1] || {};
  //         const statusCode = latest.status?.code || 0;
  //         const statusName = latest.status?.name || "Unknown";
  //         const machineName = latest.machine?.name || "Unknown";

  //         const [
  //           performance,
  //           itemSummary,
  //           itemHourlyStack,
  //           faultData,
  //           operatorEfficiency,
  //         ] = await Promise.all([
  //           buildMachinePerformance(
  //             states,
  //             counts.valid,
  //             counts.misfeed,
  //             start,
  //             end
  //           ),
  //           buildMachineItemSummary(states, counts.valid, start, end),
  //           buildItemHourlyStack(counts.valid, start, end),
  //           buildFaultData(states, start, end),
  //           buildOperatorEfficiency(
  //             states,
  //             counts.valid,
  //             start,
  //             end,
  //             machineSerial
  //           ),
  //         ]);

  //         return {
  //           machine: {
  //             serial: machineSerial,
  //             name: machineName,
  //           },
  //           currentStatus: {
  //             code: statusCode,
  //             name: statusName,
  //           },
  //           performance,
  //           itemSummary,
  //           itemHourlyStack,
  //           faultData,
  //           operatorEfficiency,
  //         };
  //       })
  //     );

  //     res.json(results.filter(Boolean));
  //   } catch (err) {
  //     logger.error("Error in /machine-dashboard route:", err);
  //     res.status(500).json({ error: "Failed to fetch dashboard data" });
  //   }
  // });

  // Version 1 of bookended states
  // router.get("/machine-dashboard", async (req, res) => {
  //   try {
  //     // Step 1: Parse and validate query parameters
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     // Step 2: Get active machine serials in range using aggregation
  //     const activeSerialDocs = await db.collection("state").aggregate([
  //       { $match: { timestamp: { $gte: paddedStart, $lte: paddedEnd } } },
  //       { $group: { _id: "$machine.serial" } },
  //       { $project: { serial: "$_id", _id: 0 } }
  //     ]).toArray();

  //     const targetSerials = serial ? [parseInt(serial)] : activeSerialDocs.map(doc => doc.serial);

  //     // Step 3-5: Process each machine to get bookended states and sessions
  //     const results = await Promise.all(targetSerials.map(async (machineSerial) => {
  //       // Get all states for this machine in range
  //       const inRangeStates = await db.collection("state")
  //         .find({ 
  //           "machine.serial": machineSerial,
  //           timestamp: { $gte: paddedStart, $lte: paddedEnd }
  //         })
  //         .sort({ timestamp: 1 })
  //         .toArray();

  //       if (!inRangeStates.length) return null;

  //       // Get bookend states
  //       const [beforeStart] = await db.collection("state")
  //         .find({ 
  //           "machine.serial": machineSerial,
  //           timestamp: { $lt: paddedStart }
  //         })
  //         .sort({ timestamp: -1 })
  //         .limit(1)
  //         .toArray();

  //       const [afterEnd] = await db.collection("state")
  //         .find({ 
  //           "machine.serial": machineSerial,
  //           timestamp: { $gt: paddedEnd }
  //         })
  //         .sort({ timestamp: 1 })
  //         .limit(1)
  //         .toArray();

  //       // Create complete timeline with bookends
  //       const completeStates = [
  //         ...(beforeStart ? [beforeStart] : []),
  //         ...inRangeStates,
  //         ...(afterEnd ? [afterEnd] : [])
  //       ];

  //       // Step 6: Pair session start/end states
  //       const sessions = [];
  //       let currentSession = null;

  //       for (const state of completeStates) {
  //         if (state.status?.code === 1) { // Running state
  //           if (!currentSession) {
  //             currentSession = {
  //               start: state,
  //               counts: []
  //             };
  //           }
  //         } else if (currentSession) { // Non-running state ends session
  //           currentSession.end = state;
  //           sessions.push(currentSession);
  //           currentSession = null;
  //         }
  //       }

  //       // Handle case where machine is still running at end
  //       if (currentSession) {
  //         currentSession.end = afterEnd || completeStates[completeStates.length - 1];
  //         sessions.push(currentSession);
  //       }

  //       // Step 7: Get counts for each session
  //       for (const session of sessions) {
  //         const sessionCounts = await db.collection("count")
  //           .find({
  //             "machine.serial": machineSerial,
  //             timestamp: {
  //               $gte: session.start.timestamp,
  //               $lte: session.end.timestamp
  //             }
  //           })
  //           .sort({ timestamp: 1 })
  //           .toArray();

  //         session.counts = sessionCounts;
  //       }

  //       // Build performance metrics using the session data
  //       const latest = completeStates[completeStates.length - 1] || {};
  //       const statusCode = latest.status?.code || 0;
  //       const statusName = latest.status?.name || "Unknown";
  //       const machineName = latest.machine?.name || "Unknown";

  //       // Extract all valid counts from sessions
  //       const allValidCounts = sessions.flatMap(s => 
  //         s.counts.filter(c => !c.misfeed && c.operator?.id !== -1)
  //       );
  //       const allMisfeedCounts = sessions.flatMap(s => 
  //         s.counts.filter(c => c.misfeed)
  //       );

  //       const [
  //         performance,
  //         itemSummary,
  //         itemHourlyStack,
  //         faultData,
  //         operatorEfficiency,
  //       ] = await Promise.all([
  //         buildMachinePerformance(completeStates, allValidCounts, allMisfeedCounts, start, end),
  //         buildMachineItemSummary(completeStates, allValidCounts, start, end),
  //         buildItemHourlyStack(allValidCounts, start, end),
  //         buildFaultData(completeStates, start, end),
  //         buildOperatorEfficiency(completeStates, allValidCounts, start, end, machineSerial),
  //       ]);

  //       return {
  //         machine: { serial: machineSerial, name: machineName },
  //         currentStatus: { code: statusCode, name: statusName },
  //         performance,
  //         itemSummary,
  //         itemHourlyStack,
  //         faultData,
  //         operatorEfficiency,
  //         sessions: sessions.map(s => ({
  //           start: s.start.timestamp,
  //           end: s.end.timestamp,
  //           counts: s.counts.length
  //         }))
  //       };
  //     }));

  //     res.json(results.filter(Boolean));
  //   } catch (err) {
  //     logger.error("Error in /machine-dashboard route:", err);
  //     res.status(500).json({ error: "Failed to fetch dashboard data" });
  //   }
  // });

  // Version 2 of bookended states modularized


// router.get("/machine-dashboard", async (req, res) => {
//   try {
//     const { start, end, serial } = parseAndValidateQueryParams(req);
//     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

//     const activeSerialDocs = await db.collection("state").aggregate([
//       { $match: { timestamp: { $gte: paddedStart, $lte: paddedEnd } } },
//       { $group: { _id: "$machine.serial" } },
//       { $project: { serial: "$_id", _id: 0 } }
//     ]).toArray();

//     const targetSerials = serial ? [parseInt(serial)] : activeSerialDocs.map(doc => doc.serial);

//     const results = await Promise.all(
//       targetSerials.map(s => buildMachineSessionAnalytics(db, s, paddedStart, paddedEnd))
//     );

//     res.json(results.filter(Boolean));
//   } catch (err) {
//     logger.error("Error in /machine-dashboard route:", err);
//     res.status(500).json({ error: "Failed to fetch dashboard data" });
//   }
// });

//Universal implementation of bookending 

  router.get("/machine-dashboard", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
  

      const targetSerials = serial ? [serial] : [];

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        start,
        end,
        "machine",
        { targetSerials }
      );

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states: rawStates, counts } = group;
      
          if (!rawStates.length && !counts.valid.length) return null;
      
          // Apply bookending for this serial
          const bookended = await getBookendedStatesAndTimeRange(
            db,
            machineSerial,
            start,
            end
          );
      
          if (!bookended) return null;
      
          const { states, sessionStart, sessionEnd } = bookended;
      
          const latest = states.at(-1) || {};
          const statusCode = latest.status?.code || 0;
          const statusName = latest.status?.name || "Unknown";
          const machineName = latest.machine?.name || "Unknown";
      
          const [
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
            currentOperators,
          ] = await Promise.all([
            buildMachinePerformance(states, counts.valid, counts.misfeed, sessionStart, sessionEnd),
            buildMachineItemSummary(states, counts.valid, sessionStart, sessionEnd),
            buildItemHourlyStack(counts.valid, sessionStart, sessionEnd),
            buildFaultData(states, sessionStart, sessionEnd),
            buildOperatorEfficiency(states, counts.valid, sessionStart, sessionEnd, machineSerial),
            buildCurrentOperators(db, machineSerial),
          ]);
      
          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
            currentOperators,
          };
        })
      );
      
      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });
  



  


  


  // router.get("/machine-dashboard", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     // const targetSerials = serial ? [serial] : [];
  //     const targetSerials = serial
  //       ? [serial]
  //       : await db.collection("state").distinct("machine.serial");

  //     const { adjustedStart, adjustedEnd } = await getBookendedGlobalRange(
  //       db,
  //       targetSerials,
  //       start,
  //       end
  //     );

  //     console.log(`[Bookend] Adjusted start: ${adjustedStart}, adjusted end: ${adjustedEnd}`);
  //     // Now pass these to everything:
  //     const groupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       adjustedStart,
  //       adjustedEnd,
  //       "machine",
  //       { targetSerials }
  //     );

  //     const results = await Promise.all(
  //       Object.entries(groupedData).map(async ([serial, group]) => {
  //         const machineSerial = parseInt(serial);
  //         const { states, counts } = group;

  //         if (!states.length && !counts.valid.length) return null;

  //         const latest = states[states.length - 1] || {};
  //         const statusCode = latest.status?.code || 0;
  //         const statusName = latest.status?.name || "Unknown";
  //         const machineName = latest.machine?.name || "Unknown";

  //         const [
  //           performance,
  //           itemSummary,
  //           itemHourlyStack,
  //           faultData,
  //           operatorEfficiency,
  //         ] = await Promise.all([
  //           buildMachinePerformance(
  //             states,
  //             counts.valid,
  //             counts.misfeed,
  //             start,
  //             end
  //           ),
  //           buildMachineItemSummary(states, counts.valid, start, end),
  //           buildItemHourlyStack(counts.valid, start, end),
  //           buildFaultData(states, start, end),
  //           buildOperatorEfficiency(
  //             states,
  //             counts.valid,
  //             start,
  //             end,
  //             machineSerial
  //           ),
  //         ]);

  //         return {
  //           machine: {
  //             serial: machineSerial,
  //             name: machineName,
  //           },
  //           currentStatus: {
  //             code: statusCode,
  //             name: statusName,
  //           },
  //           performance,
  //           itemSummary,
  //           itemHourlyStack,
  //           faultData,
  //           operatorEfficiency,
  //         };
  //       })
  //     );

  //     res.json(results.filter(Boolean));
  //   } catch (err) {
  //     logger.error("Error in /machine-dashboard route:", err);
  //     res.status(500).json({ error: "Failed to fetch dashboard data" });
  //   }
  // });

  router.get("/daily-dashboard/machine-status", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let machines;
      if (serial) {
        machines = [{ serial: parseInt(serial) }];
      } else {
        machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
      }

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
        const runningMs = cycles.running.reduce(
          (sum, c) => sum + c.duration,
          0
        );
        const pausedMs = cycles.paused.reduce((sum, c) => sum + c.duration, 0);
        const faultedMs = cycles.fault.reduce((sum, c) => sum + c.duration, 0);

        results.push({
          serial: machine.serial,
          name: states[0].machine?.name || "Unknown",
          runningMs,
          pausedMs,
          faultedMs,
        });
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch daily stacked bar data" });
    }
  });

  router.get("/daily-dashboard/machine-oee", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const results = await buildMachineOEE(db, start, end);
      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to calculate machine OEE%" });
    }
  });

  router.get("/daily-dashboard/item-hourly-stack", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const result = await buildDailyItemHourlyStack(db, start, end);
      res.json(result);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to build item/hour stacked data" });
    }
  });

  //API route for plantwide metrics by hour start
  router.get("/daily-dashboard/plantwide-metrics-by-hour", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const hourlyMetrics = await buildPlantwideMetricsByHour(
        db,
        paddedStart,
        paddedEnd
      );

      // Format the response for the chart
      const response = {
        title: "Plantwide Metrics by Hour",
        data: {
          hours: hourlyMetrics.map((m) => m.hour),
          series: {
            Availability: hourlyMetrics.map(
              (m) => Math.round(m.availability * 100) / 100
            ),
            Efficiency: hourlyMetrics.map(
              (m) => Math.round(m.efficiency * 100) / 100
            ),
            Throughput: hourlyMetrics.map(
              (m) => Math.round(m.throughput * 100) / 100
            ),
            OEE: hourlyMetrics.map((m) => Math.round(m.oee * 100) / 100),
          },
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
      };

      res.json(response);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate plantwide metrics by hour" });
    }
  });
  //API route for plantwide metrics by hour end

  //API route for demo flipper start

  router.get("/live-efficiency-summary", async (req, res) => {
    try {
      const { serial, date } = req.query;

      if (!serial || !date) {
        return res
          .status(400)
          .json({ error: "Missing required query parameters: serial, date" });
      }

      const machineSerial = parseInt(serial);
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        startOfDay,
        endOfDay,
        "machine",
        { targetSerials: [machineSerial] }
      );

      const group = groupedData[machineSerial];
      if (!group) return res.json([]);

      const { states, counts } = group;

      const summary = await buildLiveOperatorEfficiencySummary(
        states,
        counts.valid,
        date,
        machineSerial
      );
      res.json(summary);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        error: "Failed to calculate live operator efficiency summary",
      });
    }
  });

  router.get("/operator-efficiency-hourly", async (req, res) => {
    try {
      const { serial, date } = req.query;

      if (!serial || !date) {
        return res
          .status(400)
          .json({ error: "Missing required query parameters: serial, date" });
      }

      const machineSerial = parseInt(serial);
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const groupedData = await fetchGroupedAnalyticsDataWithOperators(
        db,
        startOfDay,
        endOfDay,
        "machine",
        { targetSerials: [machineSerial] }
      );

      const group = groupedData[machineSerial];

      if (!group) {
        return res
          .status(404)
          .json({ error: "No data found for the specified machine serial." });
      }

      const { states, counts } = group;

      const result = await buildLiveOperatorEfficiencySummary(
        states,
        counts.valid,
        startOfDay,
        endOfDay,
        machineSerial
      );

      res.json(result);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // router.get("/operator-efficiency-live", async (req, res) => {
  //   try {
  //     const { serial, date } = req.query;

  //     if (!serial || !date) {
  //       return res.status(400).json({ error: "Missing required query parameters: serial, date" });
  //     }

  //     const machineSerial = parseInt(serial);
  //     const inputDate = new Date(`${date}T00:00:00.000Z`);
  //     const now = new Date();

  //     const currentTime = {
  //       hours: now.getHours(),
  //       minutes: now.getMinutes(),
  //       seconds: now.getSeconds(),
  //     };

  //     const windowRanges = {
  //       last6Min: {
  //         start: new Date(inputDate.setHours(currentTime.hours, currentTime.minutes - 6, currentTime.seconds)),
  //         end: new Date(inputDate.setHours(currentTime.hours, currentTime.minutes, currentTime.seconds))
  //       },
  //       last15Min: {
  //         start: new Date(inputDate.setHours(currentTime.hours, currentTime.minutes - 15, currentTime.seconds)),
  //         end: new Date(inputDate.setHours(currentTime.hours, currentTime.minutes, currentTime.seconds))
  //       },
  //       lastHour: {
  //         start: new Date(inputDate.setHours(currentTime.hours - 1, currentTime.minutes, currentTime.seconds)),
  //         end: new Date(inputDate.setHours(currentTime.hours, currentTime.minutes, currentTime.seconds))
  //       },
  //       allDay: {
  //         start: new Date(`${date}T00:00:00.000Z`),
  //         end: new Date(`${date}T23:59:59.999Z`)
  //       }
  //     };

  //     const groupedData = await fetchGroupedAnalyticsData(
  //       db,
  //       windowRanges.allDay.start,
  //       windowRanges.allDay.end,
  //       "machine",
  //       { targetSerials: [machineSerial] }
  //     );

  //     const group = groupedData[machineSerial];
  //     if (!group) {
  //       return res.status(404).json({ error: "No data found for the specified machine serial." });
  //     }

  //     const { states, counts } = group;
  //     const validCounts = counts.valid.filter(c => c.operator?.id);

  //     const operatorsMap = new Map();

  //     for (const [label, { start, end }] of Object.entries(windowRanges)) {
  //       const rangeStates = states.filter(s => {
  //         const ts = new Date(s.timestamp);
  //         return s.machine?.serial === machineSerial && ts >= start && ts <= end;
  //       });

  //       const rangeCounts = validCounts.filter(c => {
  //         const ts = new Date(c.timestamp);
  //         return c.machine?.serial === machineSerial && ts >= start && ts <= end;
  //       });

  //       const groupedCounts = groupCountsByOperatorAndMachine(rangeCounts);

  //       for (const key in groupedCounts) {
  //         const { counts: operatorCounts, validCounts } = groupedCounts[key];
  //         const operatorId = operatorCounts[0]?.operator?.id;
  //         const operatorName = operatorCounts[0]?.operator?.name || "Unknown";

  //         const runningCycles = extractAllCyclesFromStates(rangeStates, start, end).running;
  //         const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

  //         const efficiency = calculateEfficiency(runtimeMs, validCounts.length, validCounts);

  //         if (!operatorsMap.has(operatorId)) {
  //           operatorsMap.set(operatorId, {
  //             id: operatorId,
  //             name: operatorName,
  //             items: new Set(),
  //             efficiency: {}
  //           });
  //         }

  //         const operatorData = operatorsMap.get(operatorId);
  //         operatorCounts.forEach(c => c.item?.name && operatorData.items.add(c.item.name));
  //         operatorData.efficiency[label] = Math.round(efficiency * 10000) / 100;
  //       }
  //     }

  //     // Get latest state for machine info
  //     const latestState = states.at(-1) || {};
  //     const machineName = latestState?.machine?.name || "Unknown";
  //     const statusCode = latestState?.status?.code ?? 0;
  //     const statusName = latestState?.status?.name ?? "Unknown";

  //     const result = Array.from(operatorsMap.values()).map(op => ({
  //       operator: op.name,
  //       machine: machineName,
  //       status: statusCode,
  //       fault: statusName,
  //       batch: {
  //         item: Array.from(op.items).join(", ") || "Unknown"
  //       },
  //       efficiency: {
  //         lastSixMinutes: {
  //           label: "Current",
  //           value: op.efficiency.last6Min || 0
  //         },
  //         lastFifteenMinutes: {
  //           label: "15 mins",
  //           value: op.efficiency.last15Min || 0
  //         },
  //         lastHour: {
  //           label: "1 hr",
  //           value: op.efficiency.lastHour || 0
  //         },
  //         today: {
  //           label: "Today",
  //           value: op.efficiency.allDay || 0
  //         }
  //       }
  //     }));

  //     res.json(result);
  //   } catch (err) {
  //     logger.error("Error in /operator-efficiency-live:", err);
  //     res.status(500).json({ error: "Internal server error" });
  //   }
  // });

  //   router.get("/flipper-live-summary", async (req, res) => {
  //     try {
  //       const { serial, date } = req.query;
  //       const recentState = await getMostRecentStateForMachine(db, serial, date);

  //       if (!recentState) {
  //         return res.status(404).json({
  //           message: "No state found for this machine on the given date.",
  //         });
  //       }

  //       const baseFlipperData = buildInitialFlipperOutputs(recentState);

  //       const now = new Date();
  //       const start = new Date(`${date}T00:00:00.000Z`);
  //       const end = new Date(`${date}T${now.toISOString().split("T")[1]}`);
  //       const timeFrames = {
  //         AllDay: { start: new Date(`${date}T00:00:00.000Z`), end: now },
  //         LastHour: { start: new Date(now.getTime() - 60 * 60 * 1000), end: now },
  //         Last15Min: { start: new Date(now.getTime() - 15 * 60 * 1000), end: now },
  //         Last6Min: { start: new Date(now.getTime() - 6 * 60 * 1000), end: now },
  //       };

  //       const finalFlipperData = [];

  //       // Fetch state cycles and filter by operator
  //       const machineStates = await fetchStatesForMachine(
  //         db,
  //         parseInt(serial),
  //         start,
  //         end
  //       );

  //       for (const entry of baseFlipperData) {
  //         const allCounts = await getCountsForMachine(
  //           db,
  //           parseInt(serial),
  //           start,
  //           end,
  //           entry.operatorId
  //         );

  //         const grouped = groupCountsByOperatorAndMachine(allCounts);
  //         const key = `${entry.operatorId}-${serial}`;

  //         const all = grouped[key]?.counts || [];
  //         const valid = grouped[key]?.validCounts || [];

  //         const firstValid = valid[0] || {};
  //         const operatorName = firstValid?.operator?.name || "Unknown";
  //         const itemName = firstValid?.item?.name || "";
  //         const itemCode = firstValid?.item?.id || 0;

  //         const operatorStates = machineStates.filter((s) =>
  //           s.operators?.some((op) => Number(op.id) === Number(entry.operatorId))
  //         );

  //         const runningCycles = extractAllCyclesFromStates(
  //           operatorStates,
  //           start,
  //           end
  //         ).running;
  //         const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

  //         const efficiencyValue = calculateEfficiency(
  //           runtimeMs,
  //           valid.length,
  //           valid
  //         );
  //         const efficiency = {
  //           AllDay: {
  //             value: Math.round(efficiencyValue * 100), // convert to %
  //             label: "All Day",
  //             color:
  //               efficiencyValue >= 0.9
  //                 ? "#008000"
  //                 : efficiencyValue >= 0.7
  //                 ? "#F89406"
  //                 : "#FF0000",
  //           },
  //         };

  //         finalFlipperData.push({
  //           status: entry.status,
  //           fault: entry.fault,
  //           operator: operatorName,
  //           operatorId: entry.operatorId,
  //           machine: entry.machine,
  //           efficiency,
  //           batch: {
  //             item: itemName,
  //             code: itemCode,
  //           },
  //         });
  //       }

  //       return res.json({ flipperData: finalFlipperData });
  //     } catch (err) {
  //       logger.error("Error in /flipper-live-summary:", err);
  //       return res.status(500).json({ error: "Internal server error" });
  //     }
  //   });

  // router.get("/flipper-live-summary", async (req, res) => {
  //   try {
  //     const { serial, date } = req.query;

  //     const recentState = await getMostRecentStateForMachine(db, serial, date);
  //     if (!recentState) {
  //       return res.status(404).json({
  //         message: "No state found for this machine on the given date.",
  //       });
  //     }

  //     const baseFlipperData = buildInitialFlipperOutputs(recentState);

  //     const now = new Date();
  //     const dayStart = new Date(`${date}T00:00:00.000Z`);
  //     const currentTime = new Date(`${date}T${now.toISOString().split("T")[1]}`);

  //     const timeFrames = {
  //       AllDay: { start: dayStart, end: currentTime },
  //       LastHour: { start: new Date(currentTime.getTime() - 60 * 60 * 1000), end: currentTime },
  //     };

  //     const machineStates = await fetchStatesForMachine(db, parseInt(serial), dayStart, currentTime);

  //     const finalFlipperData = [];

  //     for (const entry of baseFlipperData) {
  //       const allCounts = await getCountsForMachine(db, parseInt(serial), dayStart, currentTime, entry.operatorId);
  //       const grouped = groupCountsByOperatorAndMachine(allCounts);
  //       const key = `${entry.operatorId}-${serial}`;
  //       const all = grouped[key]?.counts || [];
  //       const valid = grouped[key]?.validCounts || [];

  //       const firstValid = valid[0] || {};
  //       const operatorName = firstValid?.operator?.name || "Unknown";
  //       const itemName = firstValid?.item?.name || "";
  //       const itemCode = firstValid?.item?.id || 0;

  //       const operatorStates = machineStates.filter((s) =>
  //         s.operators?.some((op) => Number(op.id) === Number(entry.operatorId))
  //       );

  //       const efficiency = {};

  //       for (const [label, { start, end }] of Object.entries(timeFrames)) {
  //         const filteredValid = valid.filter(
  //           (c) => new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
  //         );

  //         const relevantStates = operatorStates.filter(
  //           (s) => new Date(s.timestamp) >= start && new Date(s.timestamp) <= end
  //         );

  //         const runningCycles = extractAllCyclesFromStates(relevantStates, start, end).running;
  //         const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

  //         const eff = calculateEfficiency(runtimeMs, filteredValid.length, filteredValid);

  //         efficiency[label] = {
  //           value: Math.round(eff * 100),
  //           label,
  //           color:
  //             eff >= 0.9 ? "#008000" :
  //             eff >= 0.7 ? "#F89406" :
  //             "#FF0000",
  //         };
  //       }

  //       finalFlipperData.push({
  //         status: entry.status,
  //         fault: entry.fault,
  //         operator: operatorName,
  //         operatorId: entry.operatorId,
  //         machine: entry.machine,
  //         efficiency,
  //         batch: {
  //           item: itemName,
  //           code: itemCode,
  //         },
  //       });
  //     }

  //     return res.json({ flipperData: finalFlipperData });
  //   } catch (err) {
  //     logger.error("Error in /flipper-live-summary:", err);
  //     return res.status(500).json({ error: "Internal server error" });
  //   }
  // });

  // router.get("/flipper-live-summary", async (req, res) => {
  //   try {
  //     const { serial, date } = req.query;

  //     const recentState = await getMostRecentStateForMachine(db, serial, date);
  //     if (!recentState) {
  //       return res.status(404).json({
  //         message: "No state found for this machine on the given date.",
  //       });
  //     }

  //     const baseFlipperData = buildInitialFlipperOutputs(recentState);

  //     const now = new Date();
  //     const dayStart = new Date(`${date}T00:00:00.000Z`);
  //     const currentTime = new Date(`${date}T${now.toISOString().split("T")[1]}`); // time from real 'now' on passed date

  //     const timeFrames = {
  //       AllDay: { start: dayStart, end: currentTime },
  //       LastHour: { start: new Date(currentTime.getTime() - 60 * 60 * 1000), end: currentTime },
  //       Last15Min: { start: new Date(currentTime.getTime() - 15 * 60 * 1000), end: currentTime },
  //     };

  //     const machineStates = await fetchStatesForMachine(db, parseInt(serial), dayStart, now);

  //     const finalFlipperData = [];

  //     for (const entry of baseFlipperData) {
  //       const allCounts = await getCountsForMachine(db, parseInt(serial), dayStart, now, entry.operatorId);
  //       const grouped = groupCountsByOperatorAndMachine(allCounts);
  //       const key = `${entry.operatorId}-${serial}`;
  //       const all = grouped[key]?.counts || [];
  //       const valid = grouped[key]?.validCounts || [];

  //       const firstValid = valid[0] || {};
  //       const operatorName = firstValid?.operator?.name || "Unknown";
  //       const itemName = firstValid?.item?.name || "";
  //       const itemCode = firstValid?.item?.id || 0;

  //       const operatorStates = machineStates.filter((s) =>
  //         s.operators?.some((op) => Number(op.id) === Number(entry.operatorId))
  //       );

  //       const efficiency = {};

  //       for (const [label, { start, end }] of Object.entries(timeFrames)) {
  //         const filteredValid = valid.filter(
  //           (c) => new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
  //         );

  //         const relevantStates = operatorStates.filter(
  //           (s) => new Date(s.timestamp) >= start && new Date(s.timestamp) <= end
  //         );

  //         const runningCycles = extractAllCyclesFromStates(relevantStates, start, end).running;
  //         const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

  //         const eff = calculateEfficiency(runtimeMs, filteredValid.length, filteredValid);

  //         efficiency[label] = {
  //           value: Math.round(eff * 100),
  //           label,
  //           color:
  //             eff >= 0.9 ? "#008000" :
  //             eff >= 0.7 ? "#F89406" :
  //             "#FF0000",
  //         };
  //       }

  //       finalFlipperData.push({
  //         status: entry.status,
  //         fault: entry.fault,
  //         operator: operatorName,
  //         operatorId: entry.operatorId,
  //         machine: entry.machine,
  //         efficiency,
  //         batch: {
  //           item: itemName,
  //           code: itemCode,
  //         },
  //       });
  //     }

  //     return res.json({ flipperData: finalFlipperData });
  //   } catch (err) {
  //     logger.error("Error in /flipper-live-summary:", err);
  //     return res.status(500).json({ error: "Internal server error" });
  //   }
  // });

  router.get("/flipper-live-summary", async (req, res) => {
    try {
      const { serial, date } = req.query;

      const recentState = await getMostRecentStateForMachine(db, serial, date);
      if (!recentState) {
        return res.status(404).json({
          message: "No state found for this machine on the given date.",
        });
      }

      const baseFlipperData = buildInitialFlipperOutputs(recentState);

      const now = new Date();
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const currentTime = new Date(
        `${date}T${now.toISOString().split("T")[1]}`
      );

      const timeFrames = {
        today: { start: dayStart, end: currentTime },
        lastHour: {
          start: new Date(currentTime.getTime() - 60 * 60 * 1000),
          end: currentTime,
        },
        lastFifteenMinutes: {
          start: new Date(currentTime.getTime() - 15 * 60 * 1000),
          end: currentTime,
        },
        lastSixMinutes: {
          start: new Date(currentTime.getTime() - 6 * 60 * 1000),
          end: currentTime,
        },
      };

      const machineStates = await fetchStatesForMachine(
        db,
        parseInt(serial),
        dayStart,
        now
      );

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
          const runtimeMs = runningCycles.reduce(
            (sum, c) => sum + c.duration,
            0
          );

          const eff = calculateEfficiency(
            runtimeMs,
            filteredValid.length,
            filteredValid
          );

          efficiency[label] = {
            value: Math.round(eff * 100),
            label,
            color: eff >= 0.9 ? "#008000" : eff >= 0.7 ? "#F89406" : "#FF0000",
          };
        }

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
          batch: {
            item: itemName,
            code: itemCode,
          },
        });
      }

    return res.json({ flipperData: finalFlipperData });
  } catch (err) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

  router.get("/machine-dashboard-optimized", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const targetSerials = serial ? [serial] : [];

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        paddedStart,
        paddedEnd,
        "machine",
        { targetSerials }
      );

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states, counts } = group;

          if (!states.length && !counts.valid.length) return null;

          const latest = states[states.length - 1] || {};
          const statusCode = latest.status?.code || 0;
          const statusName = latest.status?.name || "Unknown";
          const machineName = latest.machine?.name || "Unknown";

          // Preprocess data once to reduce traversals
          const preprocessedData = preprocessMachineData(states, counts.valid, start, end);

          const [
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          ] = await Promise.all([
            buildMachinePerformanceOptimized(
              preprocessedData.runningCycles,
              counts.valid,
              counts.misfeed,
              start,
              end
            ),
            buildMachineItemSummaryOptimized(
              preprocessedData.runningCycles,
              preprocessedData.cycleAssignments,
              start,
              end
            ),
            buildItemHourlyStackOptimized(
              preprocessedData.itemHourMap,
              preprocessedData.itemNames,
              start,
              end
            ),
            buildFaultDataOptimized(
              preprocessedData.faultCycles,
              start,
              end
            ),
            buildOperatorEfficiencyOptimized(
              preprocessedData.hourlyCountsMap,
              preprocessedData.hourlyStatesMap,
              start,
              end,
              machineSerial
            ),
          ]);

          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error("Error in /machine-dashboard-optimized route:", err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });


  router.get("/machine-dashboard-optimized", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const targetSerials = serial ? [serial] : [];

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        paddedStart,
        paddedEnd,
        "machine",
        { targetSerials }
      );

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states, counts } = group;

          if (!states.length && !counts.valid.length) return null;

          const latest = states[states.length - 1] || {};
          const statusCode = latest.status?.code || 0;
          const statusName = latest.status?.name || "Unknown";
          const machineName = latest.machine?.name || "Unknown";

          // Preprocess data once to reduce traversals
          const preprocessedData = preprocessMachineData(states, counts.valid, start, end);

          const [
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          ] = await Promise.all([
            buildMachinePerformanceOptimized(
              preprocessedData.runningCycles,
              counts.valid,
              counts.misfeed,
              start,
              end
            ),
            buildMachineItemSummaryOptimized(
              preprocessedData.runningCycles,
              preprocessedData.cycleAssignments,
              start,
              end
            ),
            buildItemHourlyStackOptimized(
              preprocessedData.itemHourMap,
              preprocessedData.itemNames,
              start,
              end
            ),
            buildFaultDataOptimized(
              preprocessedData.faultCycles,
              start,
              end
            ),
            buildOperatorEfficiencyOptimized(
              preprocessedData.hourlyCountsMap,
              preprocessedData.hourlyStatesMap,
              start,
              end,
              machineSerial
            ),
          ]);

          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error("Error in /machine-dashboard-optimized route:", err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  router.get("/machine-dashboard-fast", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const targetSerials = serial ? [serial] : [];

      // Use ultra-optimized data fetching
      const groupedData = await preprocessMachineDataUltra(db, paddedStart, paddedEnd, targetSerials);

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states, counts } = group;

          if (!states.length && !counts.valid.length) return null;

          const latest = states[states.length - 1] || {};
          const statusCode = latest.status?.code || 0;
          const statusName = latest.status?.name || "Unknown";
          const machineName = latest.machine?.name || "Unknown";

          // Extract cycles once
          const allCycles = extractAllCyclesFromStates(states, start, end);
          const runningCycles = allCycles.running;
          const faultCycles = extractFaultCycles(states, start, end);

          // Pre-group data for efficiency
          const startDate = new Date(start);
          const hourlyCountsMap = new Map();
          const hourlyStatesMap = new Map();
          const itemHourMap = new Map();
          const itemNames = new Set();
          const cycleAssignments = new Map();

          // Single pass through counts
          for (const count of counts.valid) {
            const ts = new Date(count.timestamp);
            const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));
            
            if (!hourlyCountsMap.has(hourIndex)) {
              hourlyCountsMap.set(hourIndex, []);
            }
            hourlyCountsMap.get(hourIndex).push(count);

            if (!itemHourMap.has(hourIndex)) {
              itemHourMap.set(hourIndex, {});
            }
            const hourEntry = itemHourMap.get(hourIndex);
            const itemName = count.item?.name || "Unknown";
            hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
            itemNames.add(itemName);
          }

          // Single pass through states
          for (const state of states) {
            const ts = new Date(state.timestamp);
            const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));
            
            if (!hourlyStatesMap.has(hourIndex)) {
              hourlyStatesMap.set(hourIndex, []);
            }
            hourlyStatesMap.get(hourIndex).push(state);
          }

          // Assign counts to cycles
          for (let i = 0; i < runningCycles.length; i++) {
            const cycle = runningCycles[i];
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            
            const cycleCounts = counts.valid.filter(c => {
              const ts = new Date(c.timestamp);
              return ts >= cycleStart && ts <= cycleEnd;
            });
            
            cycleAssignments.set(i, cycleCounts);
          }

          const [
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          ] = await Promise.all([
            buildMachinePerformanceUltra(
              runningCycles,
              counts.valid,
              counts.misfeed,
              start,
              end
            ),
            buildMachineItemSummaryUltra(
              runningCycles,
              cycleAssignments,
              start,
              end
            ),
            buildItemHourlyStackUltra(
              itemHourMap,
              Array.from(itemNames),
              start,
              end
            ),
            buildFaultDataUltra(
              faultCycles,
              start,
              end
            ),
            buildOperatorEfficiencyUltra(
              hourlyCountsMap,
              hourlyStatesMap,
              start,
              end,
              machineSerial
            ),
          ]);

          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error("Error in /machine-dashboard-fast route:", err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  router.get("/machine-dashboard-aggregated", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const targetSerials = serial ? [serial] : [];

      // Use aggregation-based preprocessing
      const groupedData = await preprocessMachineDataAggregated(db, paddedStart, paddedEnd, targetSerials);

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states, counts, latestStatus, preCalculated } = group;

          if (!states.length && !counts.valid.length) return null;

          const machineName = latestStatus?.machine?.name || "Unknown";
          const statusCode = latestStatus?.code || 0;
          const statusName = latestStatus?.name || "Unknown";

          // Extract cycles once
          const allCycles = extractAllCyclesFromStates(states, start, end);
          const runningCycles = allCycles.running;
          const faultCycles = extractFaultCycles(states, start, end);

          // Use pre-calculated totals for performance
          const runtimeMs = runningCycles.reduce((total, cycle) => total + cycle.duration, 0);
          const totalQueryMs = new Date(end) - new Date(start);
          const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);

          const totalCount = preCalculated.totalValid + preCalculated.totalMisfeed;
          const misfeedCount = preCalculated.totalMisfeed;

          const availability = calculateAvailability(runtimeMs, downtimeMs, totalQueryMs);
          const throughput = calculateThroughput(preCalculated.totalValid, misfeedCount);
          const efficiency = calculateEfficiency(runtimeMs, preCalculated.totalValid, counts.valid);
          const oee = calculateOEE(availability, efficiency, throughput);

          const performance = {
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
          };

          // Build item summary using pre-calculated data
          const itemSummary = {};
          let totalWorkedMs = 0;
          let itemTotalCount = 0;
          const sessions = [];

          // Group pre-calculated item summary by item
          const itemGroups = {};
          for (const item of preCalculated.itemSummary) {
            if (item.operatorId === -1 || item.misfeed) continue;
            
            const itemId = item.itemId;
            if (!itemGroups[itemId]) {
              itemGroups[itemId] = [];
            }
            itemGroups[itemId].push(item);
          }

          // Process each item group
          for (const [itemId, items] of Object.entries(itemGroups)) {
            const name = items[0]?.itemName || "Unknown";
            const standard = items[0]?.itemStandard > 0 ? items[0]?.itemStandard : 666;
            const countTotal = items.length;

            if (!itemSummary[itemId]) {
              itemSummary[itemId] = {
                name,
                standard,
                count: 0,
                workedTimeMs: 0,
              };
            }

            itemSummary[itemId].count += countTotal;
            itemTotalCount += countTotal;
          }

          // Calculate worked time based on running cycles
          for (const cycle of runningCycles) {
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            const cycleMs = cycleEnd - cycleStart;

            // Find operators in this cycle
            const cycleStates = states.filter(s => {
              const ts = new Date(s.timestamp);
              return ts >= cycleStart && ts <= cycleEnd;
            });
            
            const operators = new Set();
            for (const state of cycleStates) {
              if (state.operators) {
                for (const op of state.operators) {
                  operators.add(op.id);
                }
              }
            }

            const workedTimeMs = cycleMs * Math.max(1, operators.size);
            totalWorkedMs += workedTimeMs;

            // Distribute worked time to items based on their proportion
            for (const [itemId, item] of Object.entries(itemSummary)) {
              const proportion = itemTotalCount > 0 ? item.count / itemTotalCount : 0;
              item.workedTimeMs += workedTimeMs * proportion;
            }

            sessions.push({
              start: cycleStart.toISOString(),
              end: cycleEnd.toISOString(),
              workedTimeMs,
              workedTimeFormatted: formatDuration(workedTimeMs),
              items: Object.entries(itemSummary).map(([itemId, item]) => {
                const hours = item.workedTimeMs / 3600000;
                const pph = hours ? item.count / hours : 0;
                const efficiency = item.standard ? pph / item.standard : 0;

                return {
                  itemId: parseInt(itemId),
                  name: item.name,
                  countTotal: item.count,
                  standard: item.standard,
                  pph: Math.round(pph * 100) / 100,
                  efficiency: Math.round(efficiency * 10000) / 100,
                };
              })
            });
          }

          const totalHours = totalWorkedMs / 3600000;
          const machinePph = totalHours > 0 ? totalCount / totalHours : 0;

          const proratedStandard = Object.values(itemSummary).reduce((acc, item) => {
            const weight = totalCount > 0 ? item.count / totalCount : 0;
            return acc + weight * item.standard;
          }, 0);

          const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

          const formattedItemSummaries = {};
          for (const [itemId, item] of Object.entries(itemSummary)) {
            const hours = item.workedTimeMs / 3600000;
            const pph = hours ? item.count / hours : 0;
            const efficiency = item.standard ? pph / item.standard : 0;

            formattedItemSummaries[itemId] = {
              name: item.name,
              standard: item.standard,
              countTotal: item.count,
              workedTimeFormatted: formatDuration(item.workedTimeMs),
              pph: Math.round(pph * 100) / 100,
              efficiency: Math.round(efficiency * 10000) / 100,
            };
          }

          const itemSummaryResult = {
            sessions,
            machineSummary: {
              totalCount,
              workedTimeMs: totalWorkedMs,
              workedTimeFormatted: formatDuration(totalWorkedMs),
              pph: Math.round(machinePph * 100) / 100,
              proratedStandard: Math.round(proratedStandard * 100) / 100,
              efficiency: Math.round(machineEff * 10000) / 100,
              itemSummaries: formattedItemSummaries,
            },
          };

          // Build hourly stack data
          const startDate = new Date(start);
          const itemHourMap = new Map();
          const itemNames = new Set();

          for (const count of counts.valid) {
            const ts = new Date(count.timestamp);
            const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));
            
            if (!itemHourMap.has(hourIndex)) {
              itemHourMap.set(hourIndex, {});
            }
            const hourEntry = itemHourMap.get(hourIndex);
            const itemName = count.item?.name || "Unknown";
            hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
            itemNames.add(itemName);
          }

          const maxHour = Math.max(...itemHourMap.keys(), -1);
          const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);
          const operators = {};
          for (const name of itemNames) {
            operators[name] = Array(maxHour + 1).fill(0);
          }

          for (const [hourIndex, itemCounts] of itemHourMap.entries()) {
            for (const [itemName, count] of Object.entries(itemCounts)) {
              operators[itemName][hourIndex] = count;
            }
          }

          const itemHourlyStack = {
            title: "Item Stacked Count Chart",
            data: {
              hours,
              operators,
            },
          };

          // Build fault data
          const faultData = buildFaultDataUltra(faultCycles, start, end);

          // Build operator efficiency (simplified for speed)
          const hourlyIntervals = getHourlyIntervals(new Date(start), new Date(end));
          const operatorEfficiency = hourlyIntervals.map(interval => ({
            hour: interval.start.toISOString(),
            oee: 0,
            operators: []
          }));

          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary: itemSummaryResult,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error("Error in /machine-dashboard-aggregated route:", err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  return router;
};
