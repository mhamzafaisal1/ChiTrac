// 📁 operatorRoutes.js
const express = require("express");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const {
    parseAndValidateQueryParams,
    formatDuration,
  } = require("../../utils/time");

  const {
    buildTopOperatorEfficiency,
  } = require("../../utils/dailyDashboardBuilder");

  const {
    buildOperatorPerformance,
    buildOperatorEfficiencyLine,
    buildOptimizedOperatorItemSummary,
    buildOptimizedOperatorCountByItem,
    buildOptimizedOperatorCyclePie,
    buildOptimizedOperatorFaultHistory,
  } = require("../../utils/operatorDashboardBuilder");

  const {
    fetchGroupedAnalyticsData
  } = require("../../utils/fetchData");

  const { getBookendedOperatorStatesAndTimeRange } = require('../../utils/bookendingBuilder');

  router.get("/daily-dashboard/operator-efficiency-top10", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operators = await buildTopOperatorEfficiency(db, start, end);

      res.json({
        timeRange: {
          start,
          end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        operators,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to fetch top operator efficiencies" });
    }
  });

  router.get("/analytics/operator-dashboard", async (req, res) => {
    try {
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
  
      const groupedData = await fetchGroupedAnalyticsData(
        db,
        start,
        end,
        "operator",
        { operatorId }
      );

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([operatorId, group]) => {
          const numericOperatorId = parseInt(operatorId);
          const { states, counts } = group;

          if (!states.length && !counts.all.length) return null;

          const validCounts = counts.valid;
          const misfeedCounts = counts.misfeed;
          const allCounts = counts.all;

          // ✅ Use your proper utility for operator-level bookending
          const bookended = await getBookendedOperatorStatesAndTimeRange(
            db,
            numericOperatorId,
            start,
            end
          );

          if (!bookended) return null;

          const { states: bookendedStates, sessionStart, sessionEnd } = bookended;

          const operatorName =
            validCounts[0]?.operator?.name ||
            allCounts[0]?.operator?.name ||
            "Unknown";

          const [
            performance,
            itemSummary,
            countByItem,
            cyclePie,
            faultHistory,
            dailyEfficiency
          ] = await Promise.all([
            buildOperatorPerformance(bookendedStates, validCounts, misfeedCounts, sessionStart, sessionEnd),
            buildOptimizedOperatorItemSummary(bookendedStates, allCounts, sessionStart, sessionEnd, group.machineNames || {}),
            buildOptimizedOperatorCountByItem(allCounts, sessionStart, sessionEnd),
            buildOptimizedOperatorCyclePie(bookendedStates, sessionStart, sessionEnd),
            buildOptimizedOperatorFaultHistory({ [operatorId]: { states: bookendedStates, counts } }, sessionStart, sessionEnd),
            buildOperatorEfficiencyLine({
              operator: { id: numericOperatorId, name: operatorName },
              counts
            }, sessionStart, sessionEnd, db)
          ]);

          return {
            operator: {
              id: numericOperatorId,
              name: operatorName,
            },
            currentStatus: {
              code: bookendedStates.at(-1)?.status?.code || 0,
              name: bookendedStates.at(-1)?.status?.name || "Unknown",
            },
            performance,
            itemSummary,
            countByItem,
            cyclePie,
            faultHistory,
            dailyEfficiency,
          };
        })
      );
      
      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator dashboard data" });
    }
  });
  

  

  return router;
};
