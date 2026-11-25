const express = require("express");
const { parseAndValidateQueryParams } = require("../../utils/time");
const { getMachineDowntimeSummariesBySerial } = require("../../utils/faultTimeSummary");
const { buildDowntimeParetoPayload } = require("../../utils/machineDashboardCache");

/**
 * Downtime (fault + paused + offline) for the Downtime Pareto.
 *
 *   GET /api/downtime/analytics/summary?start&end[&serial]
 *
 * Returns one row per machine and downtime cause, each tagged with
 * `category` ("fault" | "paused" | "offline"), plus per-category totals.
 * The fault-only endpoints used by the Fault Report and fault tabs are separate
 * and unchanged.
 */
module.exports = function downtimeRoutes(server) {
  const router = express.Router();
  const { db, config, logger } = server;

  router.get("/analytics/summary", async (req, res) => {
    let params;
    try {
      params = parseAndValidateQueryParams(req);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    try {
      // Historical sessions can belong to machines that have since been removed.
      const serials = params.serial === null ? null : [params.serial];
      const bySerial = await getMachineDowntimeSummariesBySerial(
        db, config, serials, params.start, params.end, { includeMachineName: true }
      );
      const summaries = [];
      for (const [serial, rows] of bySerial) {
        for (const row of rows) {
          summaries.push({
            ...row,
            machineSerial: serial,
            machineName: row.machineName || `Serial ${serial}`,
          });
        }
      }
      summaries.sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds || b.count - a.count);

      const payload = buildDowntimeParetoPayload(summaries);
      res.json({
        context: { start: params.start, end: params.end, serial: params.serial },
        ...payload,
      });
    } catch (error) {
      logger.error(`Downtime summary failed: ${error.message}`);
      res.status(500).json({ error: "Failed to build downtime summary" });
    }
  });

  return router;
};
