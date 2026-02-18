// routes/analytics/daily-dashboard.js
const express = require("express");
const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { formatDuration } = require("../../utils/time");
const {
  buildDailyItemHourlyStack,
  buildPlantwideMetricsByHour,
  buildDailyCountTotals,
  buildDailyMachineStatusFromSessions,
  buildMachineOEEFromSessions,
  buildTopOperatorEfficiencyFromSessions
} = require("../../utils/dashboardFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  router.get('/analytics/daily-sessions-dashboard', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const [
        machineStatus,             // sessions-based
        machineOee,                // sessions-based
        itemHourlyStack,           // existing (counts)
        topOperators,              // sessions-based
        plantwideMetrics,          // existing (states/counts) – leaving as-is for now
        dailyCounts                // existing (counts)
      ] = await Promise.all([
        buildDailyMachineStatusFromSessions(db, dayStart, dayEnd),
        buildMachineOEEFromSessions(db, dayStart, dayEnd),
        buildDailyItemHourlyStack(db, dayStart, dayEnd),
        buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd),
        buildPlantwideMetricsByHour(db, dayStart, dayEnd),
        buildDailyCountTotals(db, null, dayEnd)
      ]);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
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

  return router;
};
