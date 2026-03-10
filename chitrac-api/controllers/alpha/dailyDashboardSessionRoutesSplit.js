// Individual routes for daily dashboard components
const express = require("express");
const { DateTime } = require("luxon");
const { formatDuration, SYSTEM_TIMEZONE, parseAndValidateQueryParams } = require("../../utils/time");
const {
  buildDailyItemHourlyStack,
  buildPlantwideMetricsByHour,
  buildPlantwideMetricsByHourFromCache,
  buildDailyCountTotals,
  buildDailyCountTotalsFromStateAndCount,
  buildMachineOEE
} = require("../../utils/dailyDashboardBuilder");
const {
  buildDailyMachineStatusFromSessions,
  buildTopOperatorEfficiencyFromSessions,
  buildMachineOEEFromDailyTotals,
  buildMachineStatusFromDailyTotals,
  buildMachineStatusFromStateAndCount,
  buildCountTotalsFromDailyTotals,
  buildTopOperatorEfficiencyFromCache,
  buildTopOperatorEfficiencyFromStateAndCount,
  buildItemHourlyStackFromCache,
  buildItemTotalsFromCache
} = require("../../utils/dashboardFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

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

      const machineStatus = await buildMachineStatusFromDailyTotals(db, dayStart, dayEnd, logger);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineStatus
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast machine status data" });
    }
  });

  // Route 1C: Machine Status Breakdowns (state collection)
  router.get('/analytics/daily/machine-status-state', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const machineStatus = await buildMachineStatusFromStateAndCount(db, dayStart, dayEnd, logger);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineStatus
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch machine status data (state)" });
    }
  });

  // Route 2: Machine OEE Rankings
  router.get('/analytics/daily/machine-oee', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      // Use cached OEE calculation with same logic as machines-summary-daily-cached
      const machineOee = await buildMachineOEEFromDailyTotals(db, dayStart, dayEnd, logger);

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

  // Route 3B: Item Hourly Production Data (Fast - using hourly-totals cache)
  router.get('/analytics/hourly/item-hourly-production', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const itemHourlyStack = await buildItemHourlyStackFromCache(db, dayStart, dayEnd, logger);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        itemHourlyStack
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch item hourly production data from cache" });
    }
  });

  // Route 3C: Item Totals by Type (one bar per item, total count for range; uses start/end query params like item-hourly-production URL)
  router.get('/analytics/hourly/item-totals-by-type', async (req, res) => {
    try {
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (err) {
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf('day').toJSDate();
        dayEnd = now.toJSDate();
      }

      const itemTotals = await buildItemTotalsFromCache(db, dayStart, dayEnd, logger);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        itemTotals
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch item totals by type from cache" });
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

  // Route 4B: Top Operator Rankings (Fast - using daily totals cache with fallback)
  router.get('/analytics/daily/top-operators-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      let topOperators = await buildTopOperatorEfficiencyFromCache(db, dayStart, dayEnd, logger);

      // If cache returns empty or all zeros, fall back to session-based calculation
      if (topOperators.length === 0 || topOperators.every(op => op.efficiency === 0 && op.metrics.runtime.total === 0)) {
        logger.warn('Cache data is empty or all zeros, falling back to session-based calculation');
        topOperators = await buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd);
      }

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topOperators
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast top operator data" });
    }
  });

  // Route 4B-alt: Top Operator Rankings (state + count only, same response shape as top-operators-cache)
  router.get('/analytics/daily/top-operators-state', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();
      const dayEnd = now.toJSDate();

      const topOperators = await buildTopOperatorEfficiencyFromStateAndCount(db, dayStart, dayEnd, logger);

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topOperators
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch top operator data from state/count" });
    }
  });

  // Route 4C: Top 10 Faults (plantwide, by fault code)
  router.get('/analytics/daily/top-faults', async (req, res) => {
    try {
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (error) {
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf('day').toJSDate();
        dayEnd = now.toJSDate();
      }

      const fsColl = db.collection(config.faultSessionCollectionName);
      const topFaults = await fsColl
        .aggregate([
          {
            $match: {
              "timestamps.start": { $lt: dayEnd },
              $or: [
                { "timestamps.end": { $gte: dayStart } },
                { "timestamps.end": { $exists: false } },
                { "timestamps.end": null }
              ]
            }
          },
          {
            $project: {
              code: {
                $ifNull: [
                  "$states.start.status.id",
                  { $ifNull: ["$states.start.status.code", "$startState.status.code"] }
                ]
              },
              name: {
                $ifNull: [
                  "$states.start.status.name",
                  { $ifNull: ["$startState.status.name", "Fault"] }
                ]
              }
            }
          },
          { $match: { code: { $ne: null } } },
          {
            $group: {
              _id: "$code",
              name: { $first: "$name" },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              code: "$_id",
              name: 1,
              count: 1
            }
          }
        ])
        .toArray();

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topFaults
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch top faults data" });
    }
  });

  // Route 4C-alt: Top 10 Faults (from state collection, no fault-session cache)
  router.get('/analytics/daily/top-faults-state', async (req, res) => {
    try {
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (error) {
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf('day').toJSDate();
        dayEnd = now.toJSDate();
      }

      const stateColl = db.collection('state');
      const topFaults = await stateColl
        .aggregate([
          {
            // Normalize timestamp: prefer `timestamp`, fall back to `timestamps.create`
            $addFields: {
              ts: { $ifNull: ['$timestamp', '$timestamps.create'] }
            }
          },
          {
            $match: {
              ts: { $gte: dayStart, $lte: dayEnd }
            }
          },
          {
            $project: {
              code: {
                $ifNull: [
                  '$status.id',
                  '$status.code'
                ]
              },
              name: {
                $ifNull: [
                  '$status.name',
                  'Fault'
                ]
              }
            }
          },
          // Only keep actual fault codes (status > 1 and non-null)
          {
            $match: {
              code: { $ne: null, $gt: 1 }
            }
          },
          {
            $group: {
              _id: '$code',
              name: { $first: '$name' },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              code: '$_id',
              name: 1,
              count: 1
            }
          }
        ])
        .toArray();

      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topFaults
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch top faults data (state)" });
    }
  });

  // Route 5: Plant-wide Metrics
  router.get('/analytics/daily/plantwide-metrics', async (req, res) => {
    try {
      // Parse query parameters, with fallback to today if not provided
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (error) {
        // If query params are invalid or missing, default to today
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf('day').toJSDate();
        dayEnd = now.toJSDate();
      }

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
      // Parse query parameters, with fallback to today if not provided
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (error) {
        // If query params are invalid or missing, default to today
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf('day').toJSDate();
        dayEnd = now.toJSDate();
      }

      const plantwideMetrics = await buildPlantwideMetricsByHourFromCache(db, dayStart, dayEnd);

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

  // Route 6A: Daily Count Totals (state + count collections)
  router.get('/analytics/daily/count-totals-state', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayEnd = now.toJSDate();

      const dailyCounts = await buildDailyCountTotalsFromStateAndCount(db, null, dayEnd);

      return res.json({
        timeRange: { end: dayEnd },
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch daily count totals data (state/count)" });
    }
  });

  // Route 6B: Daily Count Totals (Fast - using daily totals cache)
  router.get('/analytics/daily/count-totals-cache', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayEnd = now.toJSDate();

      const dailyCounts = await buildCountTotalsFromDailyTotals(db, dayEnd, logger);

      return res.json({
        timeRange: { end: dayEnd },
        dailyCounts
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast daily count totals data" });
    }
  });

  // Diagnostic route to check state collections
  router.get('/analytics/daily/debug-collections', async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf('day').toJSDate();

      // List all collections
      const collections = await db.listCollections().toArray();
      const stateCollections = collections.filter(c => c.name.includes('state'));

      // Count documents in each state collection for today
      const counts = {};
      for (const coll of stateCollections) {
        const count = await db.collection(coll.name).countDocuments({
          timestamp: { $gte: dayStart }
        });
        counts[coll.name] = count;
      }

      // Get a sample document from state-machine-daily if it exists
      let sampleDoc = null;
      if (collections.find(c => c.name === 'state-machine-daily')) {
        sampleDoc = await db.collection('state-machine-daily').findOne({
          timestamp: { $gte: dayStart }
        });
      }

      return res.json({
        allStateCollections: stateCollections.map(c => c.name),
        documentCounts: counts,
        sampleDocument: sampleDoc,
        queryDate: dayStart
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch debug info" });
    }
  });

  // Export the function for use in other modules
  router.buildTopOperatorEfficiencyFromSessions = buildTopOperatorEfficiencyFromSessions;

  return router;
};
