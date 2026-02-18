// routes/analytics/machine-details.js
const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams } = require("../../utils/time");
const { buildFaultData } = require("../../utils/machineDashboardBuilder");
const { fetchGroupedAnalyticsData } = require("../../utils/fetchData");
const { getBookendedStatesAndTimeRange } = require("../../utils/bookendingBuilder");
const {
  buildCurrentOperators,
  buildItemSummaryFromItemSessions,
  buildPerformanceByHour
} = require("../../utils/machineFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  router.get("/analytics/machine-details", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      if (!serial) {
        return res.status(400).json({ error: "serial is required" });
      }

      // Pull machine name from the latest machine-session (cheap + accurate)
      const msColl = db.collection(config.machineSessionCollectionName);
      const latest = await msColl.find({ "machine.serial": Number(serial) })
        .project({ _id: 0, machine: 1 })
        .sort({ "timestamps.start": -1 })
        .limit(1)
        .toArray();
      const machineName = latest[0]?.machine?.name || `Serial ${serial}`;

      const [currentOperators, itemSummary, performanceByHour] = await Promise.all([
        buildCurrentOperators(db, serial),
        buildItemSummaryFromItemSessions(db, serial, start, end),
        buildPerformanceByHour(db, serial, start, end)
      ]);

      // Build faultData using the machine-dashboard approach (states + bookending)
      let faultData = null;
      try {
        const groupedData = await fetchGroupedAnalyticsData(
          db,
          start,
          end,
          "machine",
          { targetSerials: [Number(serial)] }
        );
        const group = groupedData[Number(serial)] || groupedData[String(serial)];
        if (group) {
          const bookended = await getBookendedStatesAndTimeRange(db, Number(serial), start, end);
          if (bookended) {
            const { states, sessionStart, sessionEnd } = bookended;
            faultData = buildFaultData(states, sessionStart, sessionEnd);
          }
        }
      } catch (e) {
        logger.error("machine-details faultData build error:", e);
      }

      return res.json({
        machine: { serial: Number(serial), name: machineName },
        tabs: {
          currentOperators,   // array of most-recent operator-sessions on this machine
          itemSummary,        // sessions-based item summary (same shape you use)
          performanceByHour   // [{hourStart, hourEnd, machine:{...}, operators:[...]}]
        },
        ...(faultData ? { faultData } : {})
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch machine details" });
    }
  });

  return router;
};
