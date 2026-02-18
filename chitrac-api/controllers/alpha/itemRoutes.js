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
  } = require("../../utils/time");

  // State + Count imports
  const {
    fetchStatesForMachine,
    getAllMachineSerials,
    groupStatesByMachine,
    extractAllCyclesFromStates,
    getAllMachinesFromStates,
    getAllMachineSerialsAndNames,
  } = require("../../utils/state");

  const {
    getCountsForMachine,
    groupCountsByOperatorAndMachine,
  } = require("../../utils/count");

  // Dashboard Builders
  const {
    buildMachinePerformance,
    buildMachineItemSummary,
    buildItemHourlyStack,
    buildFaultData,
    buildOperatorEfficiency,
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

router.get("/analytics/item-dashboard-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
  
      const machineSerials = await db.collection("machine").distinct("serial");
  
      const resultsMap = new Map();
  
      for (const serial of machineSerials) {
        const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
        if (!bookended) continue;
  
        const { sessionStart, sessionEnd, states } = bookended;
        const cycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;
        if (!cycles.length) continue;
  
        const counts = await getValidCounts(db, serial, sessionStart, sessionEnd);
        if (!counts.length) continue;
  
        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;
  
          const cycleCounts = counts.filter((c) => {
            const ts = new Date(c.timestamp);
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
            const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
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
      logger.error("Error in /analytics/item-dashboard-summary:", err);
      res.status(500).json({ error: "Failed to generate item dashboard summary" });
    }
  });

}