// Individual routes for daily dashboard components
const express = require("express");
const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { formatDuration } = require("../../utils/time"); 
const {
  buildDailyItemHourlyStack,
  buildPlantwideMetricsByHour,
  buildDailyCountTotals,
} = require("../../utils/dailyDashboardBuilder");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // ---- helpers (local) ----
  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const overlap = (sStart, sEnd, wStart, wEnd) => {
    const ss = new Date(sStart); const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const f = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor: f };
  };

  // #1 Machine Status Breakdowns Route
  async function buildDailyMachineStatusFromSessions(db, dayStart, dayEnd) {
    const msColl = db.collection(config.machineSessionCollectionName);
    const fsColl = db.collection(config.faultSessionCollectionName);

    // machines that actually have sessions today
    const serials = await msColl.distinct("machine.serial", {
      "timestamps.start": { $lt: dayEnd },
      $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
    });

    const perMachine = await Promise.all(serials.map(async (serial) => {
      const [msessions, fsessions] = await Promise.all([
        msColl.find({
          "machine.serial": serial,
          "timestamps.start": { $lt: dayEnd },
          $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
        }).project({
          _id: 0, machine: 1, timestamps: 1,
          runtime: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
        }).toArray(),
        fsColl.find({
          "machine.serial": serial,
          "timestamps.start": { $lt: dayEnd },
          $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
        }).project({ _id: 0, timestamps: 1, faulttime: 1 }).toArray()
      ]);

      let runtimeSec = 0;
      for (const s of msessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
        runtimeSec += safe(s.runtime) * factor; // runtime is stored in seconds 
      }

      let faultSec = 0;
      for (const fs of fsessions) {
        const sStart = fs.timestamps?.start;
        const sEnd = fs.timestamps?.end || dayEnd;
        const { ovSec, fullSec } = overlap(sStart, sEnd, dayStart, dayEnd);
        if (ovSec === 0) continue;
        const ft = safe(fs.faulttime);
        if (ft > 0 && fullSec > 0) {
          const factor = ovSec / fullSec;
          faultSec += ft * factor;
        } else {
          // open/unfinished or unrecalculated fault-session → use overlap duration
          faultSec += ovSec;
        }
      }

      const windowMs = dayEnd - dayStart;
      const runningMs = Math.round(runtimeSec * 1000);
      const faultedMs = Math.round(faultSec * 1000);
      const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));

      return {
        serial,
        name: msessions[0]?.machine?.name || `Serial ${serial}`,
        runningMs,
        pausedMs: downtimeMs,
        faultedMs
      };
    }));

    return perMachine;
  }

  // #2 Machine OEE Rankings Route
  async function buildMachineOEEFromSessions(db, dayStart, dayEnd) {
    const msColl = db.collection(config.machineSessionCollectionName);

    const serials = await msColl.distinct("machine.serial", {
      "timestamps.start": { $lt: dayEnd },
      $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
    });

    const windowSec = (dayEnd - dayStart) / 1000;

    const rows = await Promise.all(serials.map(async (serial) => {
      const sessions = await msColl.find({
        "machine.serial": serial,
        "timestamps.start": { $lt: dayEnd },
        $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
      }).project({
        _id: 0, machine: 1, timestamps: 1,
        runtime: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
      }).toArray();

      let runtimeSec = 0, workSec = 0, timeCreditSec = 0, totalCount = 0, misfeed = 0;

      for (const s of sessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
        runtimeSec      += safe(s.runtime)          * factor;
        workSec         += safe(s.workTime)         * factor;
        timeCreditSec   += safe(s.totalTimeCredit)  * factor;
        totalCount      += safe(s.totalCount)       * factor;
        misfeed         += safe(s.misfeedCount)     * factor;
      }

      const availability = windowSec > 0 ? (runtimeSec / windowSec) : 0;
      const efficiency   = workSec  > 0 ? (timeCreditSec / workSec) : 0;
      const throughput   = (totalCount + misfeed) > 0 ? (totalCount / (totalCount + misfeed)) : 0;
      const oee          = availability * efficiency * throughput;

      return {
        serial,
        name: sessions[0]?.machine?.name || `Serial ${serial}`,
        oee: +(oee * 100).toFixed(2)
      };
    }));

    // sort desc by OEE as before
    rows.sort((a,b) => b.oee - a.oee);
    return rows;
  }

  // #3 Top Operator Rankings Route
  async function buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd) {
    const osColl = db.collection(config.operatorSessionCollectionName);

    //  agg to get operators who have a session overlapping today
    const operators = await osColl.aggregate([
      { $match: {
          "timestamps.start": { $lt: dayEnd },
          $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
          "operator.id": { $exists: true, $ne: -1 }
      }},
      { $group: { _id: "$operator.id", name: { $first: "$operator.name" } } }
    ]).toArray();

    if (!operators.length) return [];

    const rows = await Promise.all(operators.map(async (op) => {
      const sessions = await osColl.find({
        "operator.id": op._id,
        "timestamps.start": { $lt: dayEnd },
        $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
      }).project({
        _id: 0, timestamps: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
      }).toArray();

      let workSec = 0, timeCreditSec = 0, totalCount = 0, misfeed = 0;
      for (const s of sessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
        workSec       += safe(s.workTime)        * factor;
        timeCreditSec += safe(s.totalTimeCredit) * factor;
        totalCount    += safe(s.totalCount)      * factor;
        misfeed       += safe(s.misfeedCount)    * factor;
      }

      const efficiency = workSec > 0 ? (timeCreditSec / workSec) : 0;
      const roundedValid = Math.round(totalCount);
      const roundedMisfeed = Math.round(misfeed);
      return {
        id: op._id,
        name: op.name || `#${op._id}`,
        efficiency: +(efficiency * 100).toFixed(2),
        metrics: {
          runtime: { total: Math.round(workSec * 1000), formatted: formatDuration(Math.round(workSec * 1000)) },
          output: {
            totalCount: roundedValid + roundedMisfeed,
            validCount: roundedValid,
            misfeedCount: roundedMisfeed
          }
        }
      };
    }));

    return rows.sort((a,b) => b.efficiency - a.efficiency).slice(0, 10);
  }

  // ---- HELPER FUNCTIONS ----

  // Fast machine status using daily totals cache
  async function buildMachineStatusFromDailyTotals(db, dayStart, dayEnd) {
    try {
      // Query the daily totals cache instead of machine sessions
      const dailyTotals = await db.collection('totals-daily').find({
        dateObj: { $gte: dayStart, $lte: dayEnd }
      }).sort({ machineSerial: 1 }).toArray();

      if (dailyTotals.length === 0) {
        logger.warn('No daily totals found for machine status calculation');
        return [];
      }

      // Transform daily totals to machine status format
      const machineStatus = dailyTotals.map(total => {
        return {
          serial: total.machineSerial,
          name: total.machineName || `Serial ${total.machineSerial}`,
          runningMs: total.runtimeMs || 0,
          pausedMs: total.pausedTimeMs || 0,
          faultedMs: total.faultTimeMs || 0
        };
      });

      logger.info(`Built machine status from daily totals for ${machineStatus.length} machines`);
      return machineStatus;
      
    } catch (error) {
      logger.error('Error building machine status from daily totals:', error);
      throw error;
    }
  }

  // ---- INDIVIDUAL ROUTES ----

  // Route 1: Machine Status Breakdowns
  router.get('/analytics/daily/machine-status', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const machineStatus = await buildDailyMachineStatusFromSessions(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineStatus
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch machine status data" });
    }
  });

  // Route 1B: Machine Status Breakdowns (Fast - using daily totals cache)
  router.get('/analytics/daily/machine-status-fast', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const machineStatus = await buildMachineStatusFromDailyTotals(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineStatus
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast machine status data" });
    }
  });

  // Route 2: Machine OEE Rankings
  router.get('/analytics/daily/machine-oee', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const machineOee = await buildMachineOEEFromSessions(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineOee
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch machine OEE data" });
    }
  });

  // Route 3: Item Hourly Production Data
  router.get('/analytics/daily/item-hourly-production', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const itemHourlyStack = await buildDailyItemHourlyStack(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        itemHourlyStack
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch item hourly production data" });
    }
  });

  // Route 4: Top Operator Rankings
  router.get('/analytics/daily/top-operators', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const topOperators = await buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topOperators
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch top operator data" });
    }
  });

  // Route 5: Plant-wide Metrics
  router.get('/analytics/daily/plantwide-metrics', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const plantwideMetrics = await buildPlantwideMetricsByHour(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        plantwideMetrics
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch plant-wide metrics data" });
    }
  });

  // Route 5B: Plant-wide Metrics (Fast - using daily totals cache)
  router.get('/analytics/daily/plantwide-metrics-fast', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const plantwideMetrics = await buildPlantwideMetricsFromDailyTotals(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        plantwideMetrics
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast plant-wide metrics data" });
    }
  });

  // Route 6: Daily Count Totals
  router.get('/analytics/daily/count-totals', async (req, res) => {
    try {
      const now = DateTime.now();
      const dayEnd = now.toJSDate();

      const dailyCounts = await buildDailyCountTotals(db, null, dayEnd);

      return res.json({
        timeRange: { end: dayEnd },
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch daily count totals data" });
    }
  });

  return router;
};
