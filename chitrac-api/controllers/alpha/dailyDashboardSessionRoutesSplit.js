// Individual routes for daily dashboard components
const express = require("express");
const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time"); 
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
      // Query the daily totals cache for machine entity type
      // Use date string instead of dateObj range since dateObj is set to start of day
      const dateStr = dayStart.toISOString().split('T')[0]; // Get YYYY-MM-DD format
      
      const dailyTotals = await db.collection('totals-daily').find({
        entityType: 'machine',
        date: dateStr
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

  // Fast daily count totals using daily totals cache (legacy - uses item entityType)
  async function buildDailyCountTotalsFromCache(db, dayEnd) {
    try {
      const endDate = new Date(dayEnd);
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 27); // include 28 total days including endDate
      startDate.setHours(0, 0, 0, 0); // set to 12:00 AM

      // Query the daily totals cache for item totals
      const pipeline = [
        {
          $match: {
            entityType: 'item',
            dateObj: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$date',
            count: { $sum: '$totalCounts' }
          }
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            count: 1
          }
        },
        {
          $sort: { date: 1 }
        }
      ];

      const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

      logger.info(`Built daily count totals from cache for ${results.length} days`);
      return results;

    } catch (error) {
      logger.error('Error building daily count totals from cache:', error);
      throw error;
    }
  }

  // Fast daily count totals using machine records from daily totals cache
  async function buildCountTotalsFromDailyTotals(db, dayEnd) {
    try {
      const endDate = new Date(dayEnd);
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 27); // include 28 total days including endDate
      startDate.setHours(0, 0, 0, 0); // set to 12:00 AM

      // Query the daily totals cache for machine records and aggregate counts by date
      const pipeline = [
        {
          $match: {
            entityType: 'machine',
            dateObj: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$date',
            count: { $sum: '$totalCounts' }
          }
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            count: 1
          }
        },
        {
          $sort: { date: 1 }
        }
      ];

      const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

      logger.info(`Built daily count totals from machine records for ${results.length} days`);
      return results;

    } catch (error) {
      logger.error('Error building count totals from daily totals:', error);
      throw error;
    }
  }

  // Fast top operator efficiency using daily totals cache
  async function buildTopOperatorEfficiencyFromCache(db, dayStart, dayEnd) {
    try {
      // Query the daily totals cache for operator-machine totals
      // Note: dateObj is set to start of day (00:00:00), so we need to query by date string instead
      const dateStr = dayStart.toISOString().split('T')[0]; // Get YYYY-MM-DD format
      
      const pipeline = [
        {
          $match: {
            entityType: 'operator-machine',
            date: dateStr  // Use date string instead of dateObj range
          }
        },
        {
          $group: {
            _id: '$operatorId',
            name: { $first: '$operatorName' },
            totalWorkedTimeMs: { $sum: '$workedTimeMs' },
            totalTimeCreditMs: { $sum: '$totalTimeCreditMs' },
            totalCounts: { $sum: '$totalCounts' },
            totalMisfeeds: { $sum: '$totalMisfeeds' }
          }
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            totalWorkedTimeMs: 1,
            totalTimeCreditMs: 1,
            totalCounts: 1,
            totalMisfeeds: 1
          }
        }
      ];

      const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

      // If no operator-machine data found, return empty array
      if (results.length === 0) {
        logger.warn('No operator-machine data found in daily cache');
        return [];
      }

      // Calculate efficiency and format results
      const operatorData = results.map(op => {
        const efficiency = op.totalWorkedTimeMs > 0 ? (op.totalTimeCreditMs / op.totalWorkedTimeMs) : 0;
        const roundedValid = Math.round(op.totalCounts);
        const roundedMisfeed = Math.round(op.totalMisfeeds);

        return {
          id: op.id,
          name: op.name || `#${op.id}`,
          efficiency: +(efficiency * 100).toFixed(2),
          metrics: {
            runtime: { 
              total: op.totalWorkedTimeMs, 
              formatted: formatDuration(op.totalWorkedTimeMs) 
            },
            output: {
              totalCount: roundedValid + roundedMisfeed,
              validCount: roundedValid,
              misfeedCount: roundedMisfeed
            }
          }
        };
      });

      // Sort by efficiency and return top 10
      const topOperators = operatorData
        .sort((a, b) => b.efficiency - a.efficiency)
        .slice(0, 10);

      logger.info(`Built top operator efficiency from cache for ${topOperators.length} operators`);
      return topOperators;

    } catch (error) {
      logger.error('Error building top operator efficiency from cache:', error);
      throw error;
    }
  }

  // ---- INDIVIDUAL ROUTES ----

  // Route 1: Machine Status Breakdowns
  router.get('/analytics/daily/machine-status', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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
  router.get('/analytics/daily/machine-status-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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

  // Route 4B: Top Operator Rankings (Fast - using daily totals cache)
  router.get('/analytics/daily/top-operators-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const topOperators = await buildTopOperatorEfficiencyFromCache(db, dayStart, dayEnd);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topOperators
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast top operator data" });
    }
  });

  // Route 5: Plant-wide Metrics
  router.get('/analytics/daily/plantwide-metrics', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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
  router.get('/analytics/daily/plantwide-metrics-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      // Note: buildPlantwideMetricsFromDailyTotals doesn't exist yet, using session-based version
      const plantwideMetrics = await buildPlantwideMetricsByHour(db, dayStart, dayEnd);

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
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
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

  // Route 6B: Daily Count Totals (Fast - using daily totals cache)
  router.get('/analytics/daily/count-totals-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayEnd = now.toJSDate();

      const dailyCounts = await buildCountTotalsFromDailyTotals(db, dayEnd);

      return res.json({
        timeRange: { end: dayEnd },
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast daily count totals data" });
    }
  });

  // Export the function for use in other modules
  router.buildTopOperatorEfficiencyFromSessions = buildTopOperatorEfficiencyFromSessions;

  return router;
};
