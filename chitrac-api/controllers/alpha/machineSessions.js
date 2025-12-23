const express = require("express");

const { formatDuration } = require("../../utils/time");
const { buildCurrentOperators } = require("../../utils/machineDashboardBuilder");

module.exports = function (server) {
  const router = express.Router();

  // Get logger and db from server object
  const logger = server.logger;
  const db = server.db;
  const config = require("../../modules/config");

  // Helper function to parse and validate query parameters
  function parseAndValidateQueryParams(req) {
    const { start, end, serial, timeframe } = req.query;

    // If timeframe is provided, calculate start and end from server time
    if (timeframe) {
      const now = new Date();
      let calculatedStart;
      let calculatedEnd = now;

      switch (timeframe) {
        case 'current':
          calculatedStart = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago
          break;
        case 'lastFifteen':
          calculatedStart = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
          break;
        case 'lastHour':
          calculatedStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
          break;
        case 'today':
          calculatedStart = new Date(now);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisWeek':
          calculatedStart = new Date(now);
          const day = calculatedStart.getDay();
          calculatedStart.setDate(calculatedStart.getDate() - day);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisMonth':
          calculatedStart = new Date(now.getFullYear(), now.getMonth(), 1);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisYear':
          calculatedStart = new Date(now.getFullYear(), 0, 1);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        default:
          throw new Error(`Invalid timeframe: ${timeframe}`);
      }

      return {
        start: calculatedStart,
        end: calculatedEnd,
        serial: serial ? parseInt(serial) : null,
      };
    }

    // Original logic for start/end parameters
    if (!start || !end) {
      throw new Error("Start and end dates are required");
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("Invalid date format");
    }

    if (startDate >= endDate) {
      throw new Error("Start date must be before end date");
    }

    return {
      start: startDate,
      end: endDate,
      serial: serial ? parseInt(serial) : null,
    };
  }

  // Debug route to check database state
  router.get("/analytics/debug", async (req, res) => {
    try {
      // Check collections
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map((c) => c.name);

      // Check machine collection
      const machineCount = await db
        .collection(config.machineCollectionName)
        .countDocuments();
      const activeMachineCount = await db
        .collection(config.machineCollectionName)
        .countDocuments({ active: true });

      // Check stateTicker collection
      const tickerCount = await db
        .collection(config.stateTickerCollectionName)
        .countDocuments();

      // Check machineSession collection
      const sessionCount = await db
        .collection(config.machineSessionCollectionName)
        .countDocuments();

      res.json({
        collections: collectionNames,
        machineCollection: {
          name: config.machineCollectionName,
          totalCount: machineCount,
          activeCount: activeMachineCount,
        },
        stateTickerCollection: {
          name: config.stateTickerCollectionName,
          totalCount: tickerCount,
        },
        machineSessionCollection: {
          name: config.machineSessionCollectionName,
          totalCount: sessionCount,
        },
      });
    } catch (err) {
      logger.error("Debug route error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add this debug query to see actual session dates
  router.get("/analytics/debug-sessions", async (req, res) => {
    try {
      const sessions = await db
        .collection("machine-session")
        .find({})
        .project({
          "machine.serial": 1,
          "timestamps.start": 1,
          "timestamps.end": 1,
          _id: 0,
        })
        .sort({ "timestamps.start": 1 })
        .limit(20)
        .toArray();

      res.json({
        totalSessions: await db.collection("machine-session").countDocuments(),
        sampleSessions: sessions,
        dateRange: {
          earliest: sessions[0]?.timestamps?.start,
          latest: sessions[sessions.length - 1]?.timestamps?.end,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Debug route for hybrid query issues
  router.get("/analytics/debug-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      // Check active machines
      const activeSerials = await db
        .collection(config.machineCollectionName)
        .distinct("serial", { active: true });

      // Check daily cache
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      const dailyCacheSample = await db
        .collection("totals-daily")
        .findOne({ entityType: "machine" });

      // Check sessions
      const sessionCount = await db
        .collection(config.machineSessionCollectionName)
        .countDocuments({
          "timestamps.start": { $gte: exactStart, $lte: exactEnd },
        });

      res.json({
        query: { start: exactStart, end: exactEnd },
        activeMachines: {
          count: activeSerials.length,
          serials: activeSerials,
        },
        dailyCache: {
          sampleRecord: dailyCacheSample,
          todayDateStr: dateStr,
        },
        sessions: {
          countInRange: sessionCount,
          totalCount: await db
            .collection(config.machineSessionCollectionName)
            .countDocuments(),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- /api/alpha/analytics/machines-summary-cached ----
  router.get("/analytics/machines-summary-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      logger.info(
        `[machineSessions] Fetching cached machines summary for date: ${dateStr}`
      );

      // Query the machines-summary-cache-today collection directly
      const data = await db
        .collection("machines-summary-cache-today")
        .find({
          date: dateStr,
          _id: { $ne: "metadata" },
        })
        .toArray();

      if (data.length === 0) {
        logger.warn(
          `[machineSessions] No cached data found for date: ${dateStr}, falling back to real-time calculation`
        );
        // Fallback to real-time calculation
        return await getMachinesSummaryRealTime(req, res);
      }

      logger.info(
        `[machineSessions] Retrieved ${data.length} cached machine records for date: ${dateStr}`
      );
      res.json(data);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in cached machines-summary route:`,
        err
      );

      // Check if it's a validation error
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date")
      ) {
        return res.status(400).json({ error: err.message });
      }

      // Fallback to real-time calculation on any error
      logger.info(
        `[machineSessions] Falling back to real-time calculation due to error`
      );
      return await getMachinesSummaryRealTime(req, res);
    }
  });

  // ---- /api/alpha/analytics/machines-summary-daily-cached ----
  router.get("/analytics/machines-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Get today's date string in Chicago timezone
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      logger.info(
        `[machineSessions] Fetching daily cached machines summary for date: ${dateStr}, serial: ${
          serial || "all"
        }`
      );

      // Build query filter for totals-daily collection
      const filter = {
        entityType: "machine",
        date: dateStr,
      };

      // Add serial filter if specified
      if (serial) {
        filter.machineSerial = parseInt(serial);
      }

      // Query the totals-daily collection
      const cacheRecords = await db
        .collection("totals-daily")
        .find(filter)
        .toArray();

      if (cacheRecords.length === 0) {
        logger.warn(
          `[machineSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`
        );
        // Fallback to real-time calculation
        return await getMachinesSummaryRealTime(req, res);
      }

      // Get machine serials from cache records
      const machineSerials = cacheRecords.map((r) => Number(r.machineSerial));

      // Get current status for each machine from stateTicker
      const tickers = await db
        .collection(config.stateTickerCollectionName)
        .find({ "machine.id": { $in: machineSerials } })
        .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
        .toArray();

      // console.log(machineSerials);
      // console.log(tickers.map((t) => t.machine.id));

      // ---- FIX START ----
      // Deduplicate and keep only latest ticker per machine ID
      const latestTickers = new Map();
      tickers.forEach((ticker) => {
        const id = Number(ticker.machine?.id);
        const ts = new Date(ticker.timestamp || 0);
        const existing = latestTickers.get(id);
        if (!existing || ts > new Date(existing.timestamp || 0)) {
          latestTickers.set(id, ticker);
        }
      });

      // Build statusMap from deduplicated tickers
      const statusMap = new Map();
      for (const [id, ticker] of latestTickers) {
        statusMap.set(id, {
          code: ticker.status?.code || 0,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.softrolColor || "None",
        });
      }
      // ---- FIX END ----

      // Transform cache records to expected format
      const data = cacheRecords.map((record) => {
        const currentStatus = statusMap.get(Number(record.machineSerial)) || {
          code: 0,
          name: "Unknown",
        };

        // ✅ Use buildRange (new format) or fall back to timeRange (legacy format)
        // buildRange represents the query window used for cache rebuild (todayStart to now)
        const timeRange = record.buildRange || record.timeRange;
        
        // Calculate window time (total time in query range)
        // If neither exists, calculate from start of day to now
        let windowMs = 0;
        let rangeStart, rangeEnd;
        
        if (timeRange && timeRange.start && timeRange.end) {
          rangeStart = new Date(timeRange.start);
          rangeEnd = new Date(timeRange.end);
          windowMs = rangeEnd - rangeStart;
        } else {
          // Fallback: calculate from start of day to now
          const today = new Date();
          const chicagoTime = new Date(
            today.toLocaleString("en-US", { timeZone: "America/Chicago" })
          );
          rangeStart = new Date(chicagoTime.setHours(0, 0, 0, 0));
          rangeEnd = new Date();
          windowMs = rangeEnd - rangeStart;
        }
        
        const downtimeMs = record.pausedTimeMs + record.faultTimeMs;

        // Calculate performance metrics
        const availability =
          windowMs > 0
            ? Math.min(Math.max(record.runtimeMs / windowMs, 0), 1)
            : 0;
        const totalOutput = record.totalCounts + record.totalMisfeeds;
        const throughput =
          totalOutput > 0 ? record.totalCounts / totalOutput : 0;
        const workTimeSec = record.workedTimeMs / 1000;
        const totalTimeCreditSec = record.totalTimeCreditMs / 1000;
        const efficiency =
          workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
        const oee = availability * throughput * efficiency;

        return {
          machine: {
            serial: record.machineSerial,
            name: record.machineName,
          },
          currentStatus: currentStatus,
          metrics: {
            runtime: {
              total: record.runtimeMs,
              formatted: formatDuration(record.runtimeMs),
            },
            downtime: {
              total: downtimeMs,
              formatted: formatDuration(downtimeMs),
            },
            output: {
              totalCount: record.totalCounts,
              misfeedCount: record.totalMisfeeds,
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
            start: rangeStart,
            end: rangeEnd,
          },
        };
      });

      logger.info(
        `[machineSessions] Retrieved ${data.length} daily cached machine records for date: ${dateStr}`
      );
      res.json(data);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in daily cached machines-summary route:`,
        err
      );

      // Check if it's a validation error
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date")
      ) {
        return res.status(400).json({ error: err.message });
      }

      // Fallback to real-time calculation on any error
      logger.info(
        `[machineSessions] Falling back to real-time calculation due to error`
      );
      return await getMachinesSummaryRealTime(req, res);
    }
  });

  // ---- /api/alpha/analytics/machines-summary (real-time calculation) ----
  router.get("/analytics/machines-summary", async (req, res) => {
    return await getMachinesSummaryRealTime(req, res);
  });

  // ---- /api/alpha/analytics/machines-summary-hybrid ----
  router.get("/analytics/machines-summary-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const HYBRID_THRESHOLD_HOURS = config.hybridThresholdHours;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        return res.status(400).json({
          error: "Time range too short for hybrid approach",
          message: `Use /analytics/machines-summary-cached for time ranges ≤ ${HYBRID_THRESHOLD_HOURS} hours`,
          currentHours: Math.round(timeRangeHours * 100) / 100,
          thresholdHours: HYBRID_THRESHOLD_HOURS,
        });
      }

      const { results, metadata } = await buildHybridMachinesSummary(
        exactStart,
        exactEnd
      );

      res.json({
        success: true,
        data: results,
        metadata,
      });
    } catch (error) {
      logger.error("Error in machines-summary-hybrid:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  });

  router.get("/analytics/machine-summary-timeframe", async (req, res) => {
    try {
      const { timeframe } = req.query;

      if (!timeframe) {
        return res
          .status(400)
          .json({ error: "timeframe query parameter is required" });
      }

      const shortTimeframes = new Set(["current", "lastFifteen", "lastHour"]);
      const extendedTimeframes = new Set([
        "today",
        "thisWeek",
        "thisMonth",
        "thisYear",
      ]);

      if (shortTimeframes.has(timeframe)) {
        return await getMachinesSummaryRealTime(req, res);
      }

      if (!extendedTimeframes.has(timeframe)) {
        return res
          .status(400)
          .json({ error: `Unsupported timeframe: ${timeframe}` });
      }

      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const { results } = await buildHybridMachinesSummary(
        exactStart,
        exactEnd
      );

      if (!results.length) {
        logger.warn(
          `[machineSessions] No data for timeframe ${timeframe}, falling back to real-time calculation`
        );
        return await getMachinesSummaryRealTime(req, res);
      }

      res.json(results);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in machine-summary-timeframe: `,
        err
      );

      if (
        err.message?.includes("Start and end dates are required") ||
        err.message?.includes("Invalid date format") ||
        err.message?.includes("Start date must be before end date") ||
        err.message?.includes("Invalid timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }

      res
        .status(500)
        .json({ error: "Failed to build machine summary for timeframe" });
    }
  });

  // ---- /api/alpha/machine-dashboard-cached ----
  router.get("/analytics/machine-dashboard-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      logger.info(
        `[machineSessions] Fetching cached machine dashboard for date: ${dateStr}, serial: ${
          serial || "all"
        }`
      );

      // Build query filter
      const filter = {
        date: dateStr,
        _id: { $ne: "metadata" },
      };

      // Add serial filter if specified
      if (serial) {
        filter["machine.serial"] = parseInt(serial);
      }

      // Query the machine-dashboard-summary-cache-today collection directly
      const data = await db
        .collection("machine-dashboard-summary-cache-today")
        .find(filter)
        .toArray();

      if (data.length === 0) {
        console.log("No cached dashboard data found for date: ", dateStr);
        logger.warn(
          `[machineSessions] No cached dashboard data found for date: ${dateStr}, falling back to real-time calculation`
        );
        // Fallback to real-time calculation
        return await getMachineDashboardRealTime(req, res);
      }

      logger.info(
        `[machineSessions] Retrieved ${data.length} cached dashboard records for date: ${dateStr}`
      );
      res.json(data);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in cached machine-dashboard route:`,
        err
      );

      // Check if it's a validation error
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date")
      ) {
        return res.status(400).json({ error: err.message });
      }

      // Fallback to real-time calculation on any error
      logger.info(
        `[machineSessions] Falling back to real-time calculation due to error`
      );
      return await getMachineDashboardRealTime(req, res);
    }
  });

  // ---- /api/alpha/machine-dashboard-daily-cached ----
  router.get("/analytics/machine-dashboard-daily-cached", async (req, res) => {
    try {
      const serialParam =
        typeof req.query.serial !== "undefined"
          ? Number.parseInt(req.query.serial, 10)
          : null;
      const machineSerialFilter = Number.isFinite(serialParam)
        ? serialParam
        : null;

      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      const cacheCollection = db.collection("totals-daily");
      const machineFilter = {
        entityType: "machine",
        date: dateStr,
      };

      if (machineSerialFilter !== null) {
        machineFilter.machineSerial = machineSerialFilter;
      }

      const machineTotals = await cacheCollection.find(machineFilter).toArray();

      if (machineTotals.length === 0) {
        logger.warn(
          `[machineSessions] No machine totals found in totals-daily for ${dateStr}`
        );
        return res.json([]);
      }

      const machineSerials = machineTotals
        .map((record) => Number(record.machineSerial))
        .filter((serial) => Number.isFinite(serial));

      if (!machineSerials.length) {
        logger.warn(
          "[machineSessions] Machine totals missing serial numbers, cannot build response"
        );
        return res.json([]);
      }

      const serialSet = new Set(machineSerials);
      const tickerSerialFilter = [
        ...new Set([
          ...machineSerials,
          ...machineSerials.map((serial) => String(serial)),
        ]),
      ];

      const [machineItemRecords, machineItemHourlyRecords, operatorMachineRecords, operatorMachineHourlyRecords, stateTickerData] =
        await Promise.all([
          cacheCollection
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          db
            .collection("hourly-totals")
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          cacheCollection
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          db
            .collection("hourly-totals")
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          tickerSerialFilter.length
            ? db
                .collection(config.stateTickerCollectionName)
                .find({
                  $or: [
                    { "machine.serial": { $in: tickerSerialFilter } },
                    { "machine.id": { $in: tickerSerialFilter } },
                  ],
                })
                .toArray()
            : [],
        ]);

      const tickerMap = buildLatestTickerMap(stateTickerData);
      const machineItemsBySerial = groupRecordsBySerial(machineItemRecords);
      const machineItemHourlyBySerial = groupRecordsBySerial(machineItemHourlyRecords);
      const operatorTotalsBySerial = groupRecordsBySerial(
        operatorMachineRecords
      );
      const operatorMachineHourlyBySerial = groupRecordsBySerial(operatorMachineHourlyRecords);

      const results = await Promise.all(
        machineTotals.map(async (record) => {
          const serial = Number(record.machineSerial);
          if (!Number.isFinite(serial) || !serialSet.has(serial)) {
            return null;
          }

          const sessionStart = record.timeRange?.start
            ? new Date(record.timeRange.start)
            : new Date(`${dateStr}T00:00:00.000Z`);
          const sessionEnd = record.timeRange?.end
            ? new Date(record.timeRange.end)
            : chicagoTime;

          const performance = buildPerformanceFromMachineRecord(record);
          const machineItems = machineItemsBySerial.get(serial) || [];
          const itemSummary = buildItemSummaryFromRecords(
            machineItems,
            sessionStart,
            sessionEnd
          );
          const machineItemHourly = machineItemHourlyBySerial.get(serial) || [];
          const itemHourlyStack = buildItemHourlyStackFromRecords(
            machineItemHourly,
            sessionStart
          );
          const operatorMachineHourly = operatorMachineHourlyBySerial.get(serial) || [];
          const operatorEfficiency = buildOperatorEfficiencyFromRecords(
            operatorMachineHourly,
            sessionStart
          );
          const currentOperators = await buildCurrentOperators(db, serial);

          const latestTicker = tickerMap.get(serial);

          return {
            machine: {
              serial,
              name: record.machineName || `Serial ${serial}`,
            },
            currentStatus: latestTicker?.status || {
              code: 0,
              name: "Unknown",
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData: {
              faultSummaries: [],
              faultCycles: [],
            },
            operatorEfficiency,
            currentOperators,
            timestamp: record.lastUpdated || chicagoTime,
            sessionStart,
            sessionEnd,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(
        `[machineSessions] Error in machine-dashboard-daily-cached route:`,
        err
      );
      res
        .status(500)
        .json({ error: "Failed to fetch machine dashboard daily cache" });
    }
  });

  // ---- /api/alpha/analytics/machine-dashboard-hybrid ----
  router.get("/analytics/machine-dashboard-hybrid", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      // Configurable threshold for hybrid approach (36 hours)
      const HYBRID_THRESHOLD_HOURS = config.hybridThresholdHours;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

      // If time range is less than threshold, use original route
      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        return res.status(400).json({
          error: "Time range too short for hybrid approach",
          message: `Use /analytics/machine-dashboard-cached for time ranges ≤ ${HYBRID_THRESHOLD_HOURS} hours`,
          currentHours: Math.round(timeRangeHours * 100) / 100,
          thresholdHours: HYBRID_THRESHOLD_HOURS,
        });
      }

      // Import required modules
      const { DateTime } = require("luxon");
      const { SYSTEM_TIMEZONE } = require("../../utils/time");
      const { fetchGroupedAnalyticsData } = require("../../utils/fetchData");
      const {
        getBookendedStatesAndTimeRange,
      } = require("../../utils/bookendingBuilder");
      const {
        buildMachinePerformance,
        buildMachineItemSummary,
        buildItemHourlyStack,
        buildFaultData,
        buildOperatorEfficiency,
        buildCurrentOperators,
      } = require("../../utils/machineDashboardBuilder");

      // Split time range into complete days and partial days
      const startOfFirstDay = DateTime.fromJSDate(exactStart, {
        zone: SYSTEM_TIMEZONE,
      }).startOf("day");
      const endOfLastDay = DateTime.fromJSDate(exactEnd, {
        zone: SYSTEM_TIMEZONE,
      }).endOf("day");

      const completeDays = [];
      const partialDays = [];

      // Add complete days (full 24-hour periods)
      let currentDay = startOfFirstDay;
      while (currentDay < endOfLastDay) {
        const dayStart = currentDay.toJSDate();
        const dayEnd = currentDay.plus({ days: 1 }).startOf("day").toJSDate();

        // Only include if the day is completely within the query range
        if (dayStart >= exactStart && dayEnd <= exactEnd) {
          completeDays.push({
            start: dayStart,
            end: dayEnd,
            dateStr: currentDay.toFormat("yyyy-LL-dd"),
          });
        }

        currentDay = currentDay.plus({ days: 1 });
      }

      // Add partial days (beginning and end of range)
      if (exactStart < startOfFirstDay.plus({ days: 1 }).toJSDate()) {
        partialDays.push({
          start: exactStart,
          end: Math.min(exactEnd, startOfFirstDay.plus({ days: 1 }).toJSDate()),
          type: "start",
        });
      }

      if (exactEnd > endOfLastDay.minus({ days: 1 }).toJSDate()) {
        partialDays.push({
          start: Math.max(
            exactStart,
            endOfLastDay.minus({ days: 1 }).toJSDate()
          ),
          end: exactEnd,
          type: "end",
        });
      }

      // Query daily cache for complete days
      const dailyRecords = await queryMachineDailyCache(completeDays, serial);

      // Query sessions for partial days
      const sessionData = await queryMachineSessions(partialDays, serial);

      // Combine the data
      const combinedData = combineMachineDashboardData(
        dailyRecords,
        sessionData
      );

      // Build final response using existing dashboard builder functions
      const targetSerials = serial
        ? [serial]
        : Object.keys(combinedData).map((s) => parseInt(s));

      const results = await Promise.all(
        targetSerials.map(async (machineSerial) => {
          const data = combinedData[machineSerial];
          if (!data) return null;

          const { states, counts, sessionStart, sessionEnd } = data;

          if (!states.length && !counts.valid.length) return null;

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
            buildMachinePerformance(
              states,
              counts.valid,
              counts.misfeed,
              sessionStart,
              sessionEnd
            ),
            buildMachineItemSummary(
              states,
              counts.valid,
              sessionStart,
              sessionEnd
            ),
            buildItemHourlyStack(counts.valid, sessionStart, sessionEnd),
            buildFaultData(states, sessionStart, sessionEnd),
            buildOperatorEfficiency(
              states,
              counts.valid,
              start,
              end,
              machineSerial
            ),
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
            metadata: {
              optimization: {
                used: true,
                approach: "hybrid",
                thresholdHours: HYBRID_THRESHOLD_HOURS,
                timeRangeHours: Math.round(timeRangeHours * 100) / 100,
                completeDays: completeDays.length,
                partialDays: partialDays.length,
                dailyRecords: dailyRecords.filter(
                  (r) => r.machineSerial === machineSerial
                ).length,
                sessionRecords: sessionData.filter(
                  (s) => s.machineSerial === machineSerial
                ).length,
              },
            },
          };
        })
      );

      res.json({
        success: true,
        data: results.filter(Boolean),
        metadata: {
          timeRange: {
            start: exactStart,
            end: exactEnd,
            hours: Math.round(timeRangeHours * 100) / 100,
          },
          optimization: {
            used: true,
            approach: "hybrid",
            thresholdHours: HYBRID_THRESHOLD_HOURS,
            timeRangeHours: Math.round(timeRangeHours * 100) / 100,
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length,
            performance: {
              estimatedSpeedup: `${Math.round(
                (timeRangeHours / 24) * 10
              )}x faster for ${Math.round(timeRangeHours / 24)} days`,
            },
          },
        },
      });
    } catch (error) {
      logger.error("Error in machine-dashboard-hybrid:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  });

  // Helper function to query machines summary daily cache
  async function queryMachinesSummaryDailyCache(completeDays) {
    if (completeDays.length === 0) return [];

    const cacheCollection = db.collection("totals-daily");

    // Exact UTC midnight dateObjs and date strings (matching cache writer format)
    const dateStrs = completeDays.map((d) => d.dateStr); // ["2025-08-28", "2025-08-29"]
    const dateObjs = dateStrs.map((str) => new Date(str + "T00:00:00.000Z"));

    logger.info(
      `[machineSessions] Querying daily cache with dateStrs:`,
      dateStrs
    );
    logger.info(
      `[machineSessions] Querying daily cache with dateObjs:`,
      dateObjs
    );

    const records = await cacheCollection
      .find({
        entityType: "machine",
        $or: [{ dateObj: { $in: dateObjs } }, { date: { $in: dateStrs } }],
      })
      .toArray();

    logger.info(
      `[machineSessions] Found ${records.length} daily cache records`
    );
    return records;
  }

  // Helper function to query machines summary sessions for partial days
  async function queryMachinesSummarySessions(partialDays) {
    if (partialDays.length === 0) return [];

    const results = [];

    for (const partialDay of partialDays) {
      // Get active machines
      const activeSerials = new Set(
        await db
          .collection(config.machineCollectionName)
          .distinct("serial", { active: true })
      );

      logger.info(
        `[machineSessions] Found ${activeSerials.size} active machines:`,
        [...activeSerials]
      );

      // Process each active machine
      for (const serial of activeSerials) {
        // Fetch sessions that overlap the partial day window
        // Use proper overlap logic: session starts before window ends AND session ends after window starts
        const sessions = await db
          .collection(config.machineSessionCollectionName)
          .find({
            "machine.id": serial,
            "timestamps.start": { $lt: partialDay.end },
            $or: [
              { "timestamps.end": { $gt: partialDay.start } },
              { "timestamps.end": { $exists: false } }, // Handle open sessions
            ],
          })
          .sort({ "timestamps.start": 1 })
          .toArray();

        if (!sessions.length) continue;

        // Truncate first session if it starts before partialDay.start
        if (sessions[0]) {
          const first = sessions[0];
          const firstStart = new Date(first.timestamps?.start);
          if (firstStart < partialDay.start) {
            sessions[0] = truncateAndRecalc(
              first,
              partialDay.start,
              first.timestamps?.end
                ? new Date(first.timestamps.end)
                : partialDay.end
            );
          }
        }

        // Truncate last session if it ends after partialDay.end (or is open)
        if (sessions.length > 0) {
          const lastIdx = sessions.length - 1;
          const last = sessions[lastIdx];
          const lastEnd = last.timestamps?.end
            ? new Date(last.timestamps.end)
            : null;

          if (!lastEnd || lastEnd > partialDay.end) {
            const effectiveEnd = lastEnd ? partialDay.end : partialDay.end;
            sessions[lastIdx] = truncateAndRecalc(
              last,
              new Date(sessions[lastIdx].timestamps.start),
              effectiveEnd
            );
          }
        }

        // Aggregate metrics
        let runtimeMs = 0;
        let workTimeSec = 0;
        let totalCount = 0;
        let misfeedCount = 0;
        let totalTimeCredit = 0;

        for (const s of sessions) {
          // Extract from session document structure
          runtimeMs += Math.floor((s.metrics?.timers?.run || s.runtime || 0)) * 1000;
          workTimeSec += Math.floor(s.metrics?.timers?.worked || s.workTime || 0);
          totalCount += s.metrics?.totals?.counts?.valid || s.totalCount || 0;
          misfeedCount += s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;
          totalTimeCredit += s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
        }

        const downtimeMs = Math.max(
          0,
          partialDay.end - partialDay.start - runtimeMs
        );

        results.push({
          machineSerial: serial,
          machineName: sessions[0]?.machine?.name || `Serial ${serial}`,
          runtimeMs,
          downtimeMs,
          totalCount,
          misfeedCount,
          workTimeSec,
          totalTimeCredit,
          timeRange: {
            start: partialDay.start,
            end: partialDay.end,
            type: partialDay.type,
          },
        });
      }
    }

    return results;
  }

  // Helper function to combine machines summary data
  function combineMachinesSummaryData(dailyRecords, sessionData) {
    const combinedMap = new Map();

    // Add daily records
    for (const record of dailyRecords) {
      const machineSerial = record.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          machineName: record.machineName,
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0,
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.runtimeMs += record.runtimeMs || 0;
      machine.downtimeMs += record.pausedTimeMs || 0; // pausedTimeMs from daily cache
      machine.totalCount += record.totalCounts || 0;
      machine.misfeedCount += record.totalMisfeeds || 0;
      machine.workTimeSec += (record.workedTimeMs || 0) / 1000; // Convert to seconds
      machine.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
    }

    // Add session data
    for (const session of sessionData) {
      const machineSerial = session.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          machineName: session.machineName,
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0,
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.runtimeMs += session.runtimeMs || 0;
      machine.downtimeMs += session.downtimeMs || 0;
      machine.totalCount += session.totalCount || 0;
      machine.misfeedCount += session.misfeedCount || 0;
      machine.workTimeSec += session.workTimeSec || 0;
      machine.totalTimeCredit += session.totalTimeCredit || 0;
    }

    return combinedMap;
  }

  async function buildHybridMachinesSummary(exactStart, exactEnd) {
    const { DateTime } = require("luxon");
    const { SYSTEM_TIMEZONE } = require("../../utils/time");

    const HYBRID_THRESHOLD_HOURS = config.hybridThresholdHours;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

    const startOfFirstDay = DateTime.fromJSDate(exactStart, {
      zone: SYSTEM_TIMEZONE,
    }).startOf("day");
    const endOfLastDay = DateTime.fromJSDate(exactEnd, {
      zone: SYSTEM_TIMEZONE,
    }).endOf("day");

    const completeDays = [];
    const partialDays = [];

    let currentDay = startOfFirstDay;
    while (currentDay < endOfLastDay) {
      const dayStart = currentDay.toJSDate();
      const dayEnd = currentDay.plus({ days: 1 }).startOf("day").toJSDate();

      if (dayStart >= exactStart && dayEnd <= exactEnd) {
        completeDays.push({
          start: dayStart,
          end: dayEnd,
          dateStr: currentDay.toFormat("yyyy-LL-dd"),
        });
      }

      currentDay = currentDay.plus({ days: 1 });
    }

    const nextDayStart = startOfFirstDay.plus({ days: 1 }).toJSDate();
    if (exactStart < nextDayStart) {
      const partialEnd = exactEnd < nextDayStart ? exactEnd : nextDayStart;
      if (partialEnd > exactStart) {
        partialDays.push({
          start: exactStart,
          end: partialEnd,
          type: "start",
        });
      }
    }

    const previousDayEnd = endOfLastDay.minus({ days: 1 }).toJSDate();
    if (exactEnd > previousDayEnd) {
      const partialStart =
        exactStart > previousDayEnd ? exactStart : previousDayEnd;
      if (exactEnd > partialStart) {
        partialDays.push({
          start: partialStart,
          end: exactEnd,
          type: "end",
        });
      }
    }

    if (
      partialDays.length === 2 &&
      partialDays[0].start.getTime() === partialDays[1].start.getTime() &&
      partialDays[0].end.getTime() === partialDays[1].end.getTime()
    ) {
      partialDays.splice(1, 1);
    }

    const dailyRecords = await queryMachinesSummaryDailyCache(completeDays);
    logger.info(
      `[machineSessions] Daily cache query returned ${dailyRecords.length} records`
    );

    const sessionData = await queryMachinesSummarySessions(partialDays);
    logger.info(
      `[machineSessions] Session query returned ${sessionData.length} records`
    );

    const combinedData = combineMachinesSummaryData(
      dailyRecords,
      sessionData
    );
    logger.info(
      `[machineSessions] Combined data has ${combinedData.size} machines`
    );

    if (!combinedData.size) {
      return {
        results: [],
        metadata: {
          timeRange: {
            start: exactStart,
            end: exactEnd,
            hours: Math.round(timeRangeHours * 100) / 100,
          },
          optimization: {
            used: true,
            approach: "hybrid",
            thresholdHours: HYBRID_THRESHOLD_HOURS,
            timeRangeHours: Math.round(timeRangeHours * 100) / 100,
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length,
            performance: {
              estimatedSpeedup: `${Math.round(
                (timeRangeHours / 24) * 10
              )}x faster for ${Math.round(timeRangeHours / 24)} days`,
            },
          },
        },
      };
    }

    const activeSerials = new Set(
      await db
        .collection(config.machineCollectionName)
        .distinct("serial", { active: true })
    );

    const tickers = await db
      .collection(config.stateTickerCollectionName)
      .find({ "machine.serial": { $in: [...activeSerials] } })
      .project({ _id: 0, timestamp: 1, status: 1, "machine.serial": 1 })
      .toArray();

    const statusMap = new Map();
    tickers.forEach((ticker) => {
      const serial = ticker.machine?.serial;
      if (!serial) {
        return;
      }
      const ts = new Date(ticker.timestamp || 0).getTime();
      const existing = statusMap.get(serial);
      if (!existing || ts > existing.timestamp) {
        statusMap.set(serial, {
          status: {
            code: ticker.status?.code ?? 0,
            name: ticker.status?.name ?? "Unknown",
          },
          timestamp: ts,
        });
      }
    });

    const results = [];
    for (const [machineSerial, data] of combinedData) {
      const statusEntry = statusMap.get(machineSerial)?.status || {
        code: 0,
        name: "Unknown",
      };

      const result = formatMachinesSummaryRow({
        machine: { serial: machineSerial, name: data.machineName },
        status: statusEntry,
        runtimeMs: data.runtimeMs,
        downtimeMs: data.downtimeMs,
        totalCount: data.totalCount,
        misfeedCount: data.misfeedCount,
        workTimeSec: data.workTimeSec,
        totalTimeCredit: data.totalTimeCredit,
        queryStart: exactStart,
        queryEnd: exactEnd,
      });

      results.push(result);
    }

    const metadata = {
      timeRange: {
        start: exactStart,
        end: exactEnd,
        hours: Math.round(timeRangeHours * 100) / 100,
      },
      optimization: {
        used: true,
        approach: "hybrid",
        thresholdHours: HYBRID_THRESHOLD_HOURS,
        timeRangeHours: Math.round(timeRangeHours * 100) / 100,
        completeDays: completeDays.length,
        partialDays: partialDays.length,
        dailyRecords: dailyRecords.length,
        sessionRecords: sessionData.length,
        performance: {
          estimatedSpeedup: `${Math.round(
            (timeRangeHours / 24) * 10
          )}x faster for ${Math.round(timeRangeHours / 24)} days`,
        },
      },
    };

    return { results, metadata };
  }

  // Helper function to query machine daily cache
  async function queryMachineDailyCache(completeDays, serial) {
    if (completeDays.length === 0) return [];

    const cacheCollection = db.collection("totals-daily");

    // Exact UTC midnight dateObjs and date strings (matching cache writer format)
    const dateStrs = completeDays.map((d) => d.dateStr); // ["2025-08-28", "2025-08-29"]
    const dateObjs = dateStrs.map((str) => new Date(str + "T00:00:00.000Z"));

    const query = {
      entityType: "machine",
      $or: [{ dateObj: { $in: dateObjs } }, { date: { $in: dateStrs } }],
    };

    if (serial) {
      query.machineSerial = parseInt(serial);
    }

    const records = await cacheCollection.find(query).toArray();

    return records;
  }

  // Helper function to query machine sessions for partial days
  async function queryMachineSessions(partialDays, serial) {
    if (partialDays.length === 0) return [];

    const results = [];

    for (const partialDay of partialDays) {
      // Get grouped analytics data for this partial day
      const groupedData = await fetchGroupedAnalyticsData(
        db,
        partialDay.start,
        partialDay.end,
        "machine",
        { targetSerials: serial ? [serial] : [] }
      );

      // Process each machine's data
      for (const [machineSerialStr, group] of Object.entries(groupedData)) {
        const machineSerial = parseInt(machineSerialStr);
        const { states: rawStates, counts } = group;

        if (!rawStates.length && !counts.valid.length) continue;

        // Apply bookending for this serial
        const bookended = await getBookendedStatesAndTimeRange(
          db,
          machineSerial,
          partialDay.start,
          partialDay.end
        );

        if (!bookended) continue;

        const { states, sessionStart, sessionEnd } = bookended;

        results.push({
          machineSerial,
          states,
          counts,
          sessionStart,
          sessionEnd,
          timeRange: {
            start: partialDay.start,
            end: partialDay.end,
            type: partialDay.type,
          },
        });
      }
    }

    return results;
  }

  // Helper function to combine machine dashboard data
  function combineMachineDashboardData(dailyRecords, sessionData) {
    const combinedMap = new Map();

    // Add daily records (convert to dashboard format)
    for (const record of dailyRecords) {
      const machineSerial = record.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          states: [],
          counts: { valid: [], misfeed: [] },
          sessionStart: null,
          sessionEnd: null,
          dailyData: [],
          sessionData: [],
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.dailyData.push(record);

      // Convert daily record to state-like format for dashboard builders
      const state = {
        machine: {
          serial: record.machineSerial,
          name: record.machineName,
        },
        status: {
          code: 0, // Default status for daily records
          name: "Running",
        },
        timestamps: {
          start:
            record.timeRange?.start || new Date(record.date + "T00:00:00.000Z"),
          end:
            record.timeRange?.end || new Date(record.date + "T23:59:59.999Z"),
        },
        runtime: record.runtimeMs / 1000, // Convert to seconds
        workTime: record.workedTimeMs / 1000, // Convert to seconds
        totalCount: record.totalCounts,
        misfeedCount: record.totalMisfeeds,
        totalTimeCredit: record.totalTimeCreditMs / 1000, // Convert to seconds
      };

      machine.states.push(state);

      // Set session bounds
      if (
        !machine.sessionStart ||
        state.timestamps.start < machine.sessionStart
      ) {
        machine.sessionStart = state.timestamps.start;
      }
      if (!machine.sessionEnd || state.timestamps.end > machine.sessionEnd) {
        machine.sessionEnd = state.timestamps.end;
      }
    }

    // Add session data
    for (const session of sessionData) {
      const machineSerial = session.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          states: [],
          counts: { valid: [], misfeed: [] },
          sessionStart: null,
          sessionEnd: null,
          dailyData: [],
          sessionData: [],
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.sessionData.push(session);

      // Add session states and counts
      machine.states.push(...session.states);
      machine.counts.valid.push(...session.counts.valid);
      machine.counts.misfeed.push(...session.counts.misfeed);

      // Update session bounds
      if (
        !machine.sessionStart ||
        session.sessionStart < machine.sessionStart
      ) {
        machine.sessionStart = session.sessionStart;
      }
      if (!machine.sessionEnd || session.sessionEnd > machine.sessionEnd) {
        machine.sessionEnd = session.sessionEnd;
      }
    }

    // Convert to object format expected by dashboard builders
    const result = {};
    for (const [machineSerial, data] of combinedMap) {
      result[machineSerial] = {
        states: data.states,
        counts: data.counts,
        sessionStart: data.sessionStart,
        sessionEnd: data.sessionEnd,
      };
    }

    return result;
  }

  // Helper function for real-time calculation (extracted from original route)
  async function getMachinesSummaryRealTime(req, res) {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const queryStart = new Date(start);
      let queryEnd = new Date(end);
      const now = new Date();
      if (queryEnd > now) queryEnd = now;

      logger.info(
        `[machineSessions] Real-time calculation for range: ${queryStart.toISOString()} to ${queryEnd.toISOString()}`
      );

      // Active machines set
      const activeSerials = new Set(
        await db
          .collection(config.machineCollectionName)
          .distinct("serial", { active: true })
      );

      logger.info(
        `[machineSessions] Found ${activeSerials.size} active machines: ${[...activeSerials].join(", ")}`
      );

      // Pull tickers for active machines only
      const tickers = await db
        .collection(config.stateTickerCollectionName)
        .find({ "machine.id": { $in: [...activeSerials] } })
        .project({ _id: 0, "machine.id": 1, "machine.serial": 1, "machine.name": 1, status: 1, timestamp: 1 })
        .toArray();

      logger.info(
        `[machineSessions] Found ${tickers.length} tickers for active machines`
      );

      // Deduplicate and keep only latest ticker per machine ID
      const latestTickers = new Map();
      tickers.forEach((ticker) => {
        const id = Number(ticker.machine?.id);
        const ts = new Date(ticker.timestamp || 0);
        const existing = latestTickers.get(id);
        if (!existing || ts > new Date(existing.timestamp || 0)) {
          latestTickers.set(id, ticker);
        }
      });

      logger.info(
        `[machineSessions] After deduplication: ${latestTickers.size} unique machines`
      );

      // Build one promise per machine
      const results = await Promise.all(
        [...latestTickers.values()].map(async (t) => {
          const { machine, status } = t || {};
          const serial = machine?.id || machine?.serial;
          if (!serial) {
            return null;
          }

          // Normalize machine object to have serial field
          const normalizedMachine = {
            serial: serial,
            name: machine?.name || `Serial ${serial}`,
          };

          // Fetch sessions that overlap the window
          // Proper overlap logic: session starts before window ends AND session ends after window starts
          const sessions = await db
            .collection(config.machineSessionCollectionName)
            .find({
              "machine.id": serial,
              "timestamps.start": { $lt: queryEnd },
              $or: [
                { "timestamps.end": { $gt: queryStart } },
                { "timestamps.end": { $exists: false } }, // Handle open sessions
              ],
            })
            .sort({ "timestamps.start": 1 })
            .toArray();

          logger.info(
            `[machineSessions] Machine ${serial}: Found ${sessions.length} sessions in time range`
          );

          // If nothing in range, still return zeroed row for the machine
          if (!sessions.length) {
            const totalMs = queryEnd - queryStart;
            return formatMachinesSummaryRow({
              machine: normalizedMachine,
              status,
              runtimeMs: 0,
              downtimeMs: totalMs,
              totalCount: 0,
              misfeedCount: 0,
              workTimeSec: 0,
              totalTimeCredit: 0,
              queryStart,
              queryEnd,
            });
          }

          // Truncate first session if it starts before queryStart
          {
            const first = sessions[0];
            const firstStart = new Date(first.timestamps?.start);
            if (firstStart < queryStart) {
              sessions[0] = truncateAndRecalc(
                first,
                queryStart,
                first.timestamps?.end
                  ? new Date(first.timestamps.end)
                  : queryEnd
              );
            }
          }

          // Truncate last session if it ends after queryEnd (or is open)
          {
            const lastIdx = sessions.length - 1;
            const last = sessions[lastIdx];
            const lastEnd = last.timestamps?.end
              ? new Date(last.timestamps.end)
              : null;

            if (!lastEnd || lastEnd > queryEnd) {
              const effectiveEnd = lastEnd ? queryEnd : queryEnd; // clamp open or overrun to queryEnd
              sessions[lastIdx] = truncateAndRecalc(
                last,
                new Date(sessions[lastIdx].timestamps.start), // after possible first fix, use its current start
                effectiveEnd
              );
            }
          }

          // Fetch counts directly from count collection for this machine within the time window
          const allCounts = await db
            .collection("count")
            .find({
              "machine.id": serial,
              "timestamps.create": { $gte: queryStart, $lte: queryEnd },
            })
            .toArray();

          // Separate valid counts from misfeeds
          const validCounts = allCounts.filter(c => !c.misfeed);
          const misfeedCounts = allCounts.filter(c => c.misfeed);

          logger.info(
            `[machineSessions] Machine ${serial}: Found ${validCounts.length} valid counts, ${misfeedCounts.length} misfeed counts in time window`
          );

          // Aggregate - calculate metrics based on sessions and counts
          let runtimeMs = 0;
          let workTimeSec = 0;
          let totalTimeCredit = 0;

          for (const s of sessions) {
            // Calculate runtime for this session (clamped to query window)
            const sessionStart = new Date(s.timestamps?.start);
            const sessionEnd = s.timestamps?.end ? new Date(s.timestamps.end) : queryEnd;
            const clampedStart = sessionStart < queryStart ? queryStart : sessionStart;
            const clampedEnd = sessionEnd > queryEnd ? queryEnd : sessionEnd;
            const sessionRuntimeMs = Math.max(0, clampedEnd - clampedStart);

            // Get operators count for work time calculation
            const operators = s.states?.start?.operators || [];
            const activeStations = operators.filter((op) => op && op.id !== -1).length;
            const sessionWorkTimeSec = (sessionRuntimeMs / 1000) * activeStations;

            runtimeMs += sessionRuntimeMs;
            workTimeSec += sessionWorkTimeSec;
          }

          // Calculate time credit based on counts
          const items = sessions[0]?.program?.items || sessions[0]?.states?.start?.program?.items || [];
          const perItemCounts = new Map();

          for (const c of validCounts) {
            const id = c.item?.id;
            if (id != null) {
              perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
            }
          }

          for (const [id, cnt] of perItemCounts) {
            const item = items.find((it) => it && it.id === id);
            if (item && item.standard) {
              const pph = normalizePPH(item.standard);
              if (pph > 0) {
                totalTimeCredit += cnt / (pph / 3600); // seconds
              }
            }
          }

          const totalCount = validCounts.length;
          const misfeedCount = misfeedCounts.length;
          const downtimeMs = Math.max(0, queryEnd - queryStart - runtimeMs);

          const result = formatMachinesSummaryRow({
            machine: normalizedMachine,
            status,
            runtimeMs,
            downtimeMs,
            totalCount,
            misfeedCount,
            workTimeSec,
            totalTimeCredit,
            queryStart,
            queryEnd,
          });

          return result;
        })
      );

      const finalResults = results.filter(Boolean);
      logger.info(
        `[machineSessions] Returning ${finalResults.length} machine summary results`
      );
      res.json(finalResults);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);

      // Check if it's a validation error
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date")
      ) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to build machines summary" });
    }
  }

  // Helper function for real-time machine dashboard calculation (extracted from machineRoutes.js)
  async function getMachineDashboardRealTime(req, res) {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      const targetSerials = serial ? [serial] : [];

      

      // Import required functions (these should be available from the server context)
      const { fetchGroupedAnalyticsData } = require("../../utils/fetchData");
      const {
        getBookendedStatesAndTimeRange,
      } = require("../../utils/bookendingBuilder");
      const {
        buildMachinePerformance,
        buildMachineItemSummary,
        buildItemHourlyStack,
        buildFaultData,
        buildOperatorEfficiency,
        buildCurrentOperators,
      } = require("../../utils/machineDashboardBuilder");

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        start,
        end,
        "machine",
        { targetSerials }
      );

      // Debug: Check groupedData structure
      logger.info(`[machineSessions] getMachineDashboardRealTime: groupedData keys: ${Object.keys(groupedData).length}, serials: ${Object.keys(groupedData).join(', ')}`);
      
      if (!groupedData || Object.keys(groupedData).length === 0) {
        logger.warn(`[machineSessions] No grouped data returned for time range ${start} to ${end}`);
        return res.json([]);
      }
      
      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states: rawStates, counts } = group;

          logger.info(`[machineSessions] Processing machine ${machineSerial}: rawStates.length=${rawStates?.length || 0}, counts.valid.length=${counts?.valid?.length || 0}`);

          if (!rawStates.length && !counts.valid.length) {
            logger.warn(`[machineSessions] Skipping machine ${machineSerial}: no states or valid counts`);
            return null;
          }

          // Apply bookending for this serial
          let bookended = await getBookendedStatesAndTimeRange(
            db,
            machineSerial,
            start,
            end
          );

          // Fallback: If bookending fails but we have counts, use the full time range
          if (!bookended) {
            logger.warn(`[machineSessions] No bookended data for machine ${machineSerial}, using full time range as fallback`);
            
            // Use rawStates if available, otherwise fetch fresh states
            let statesToUse = rawStates;
            if (!statesToUse || statesToUse.length === 0) {
              // Fetch states for the full range as fallback
              const { fetchGroupedAnalyticsData: fetchStates } = require("../../utils/fetchData");
              const stateData = await fetchStates(db, start, end, "machine", { targetSerials: [machineSerial] });
              statesToUse = stateData[machineSerial]?.states || [];
            }
            
            if (!statesToUse.length && !counts.valid.length) {
              return null;
            }
            
            // Normalize states if needed
            statesToUse = statesToUse.map(s => {
              if (!s.timestamp && s.timestamps?.create) {
                s.timestamp = s.timestamps.create;
              }
              if (!s.machine?.serial && s.machine?.id) {
                s.machine = s.machine || {};
                s.machine.serial = s.machine.id;
              }
              return s;
            });
            
            bookended = {
              states: statesToUse,
              sessionStart: new Date(start),
              sessionEnd: new Date(end)
            };
          }

          const { states, sessionStart, sessionEnd } = bookended;
          logger.info(`[machineSessions] Machine ${machineSerial}: session from ${sessionStart} to ${sessionEnd}, ${states.length} states`);

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
            buildMachinePerformance(
              states,
              counts.valid,
              counts.misfeed,
              sessionStart,
              sessionEnd
            ),
            buildMachineItemSummary(
              states,
              counts.valid,
              sessionStart,
              sessionEnd
            ),
            buildItemHourlyStack(counts.valid, sessionStart, sessionEnd),
            buildFaultData(states, sessionStart, sessionEnd),
            buildOperatorEfficiency(
              states,
              counts.valid,
              start,
              end,
              machineSerial
            ),
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
  }

  /* -------------------- helpers -------------------- */

  // Clamp standard to PPH
  function normalizePPH(std) {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  }

  // Recompute a session's metrics given its counts/misfeeds and timestamps
  function recalcSession(session) {
    const start = new Date(session.timestamps.start);
    const end = new Date(session.timestamps.end || new Date());
    const runtimeMs = Math.max(0, end - start);
    const runtimeSec = runtimeMs / 1000;

    // Active stations = non-dummy operators
    // Handle both old structure (session.operators) and new structure (session.states.start.operators)
    const operators = session.operators || session.states?.start?.operators || [];
    const activeStations = Array.isArray(operators)
      ? operators.filter((op) => op && op.id !== -1).length
      : 0;

    const workTimeSec = runtimeSec * activeStations;

    const counts = Array.isArray(session.counts) ? session.counts : [];
    const misfeeds = Array.isArray(session.misfeeds) ? session.misfeeds : [];

    const totalCount = counts.length;
    const misfeedCount = misfeeds.length;

    // Calculate total time credit (corrected - count per-item and use per-item standards)
    let totalTimeCredit = 0;

    // 1. Count how many of each item were produced in the truncated window
    const perItemCounts = new Map(); // key: item.id
    for (const c of counts) {
      const id = c.item?.id;
      if (id == null) continue;
      perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
    }

    // 2. Calculate time credit for each item based on its actual count and standard
    // Handle both old structure (session.items) and new structure (session.program.items or session.states.start.program.items)
    const items = session.items || session.program?.items || session.states?.start?.program?.items || [];
    for (const [id, cnt] of perItemCounts) {
      // Find the standard for this specific item from session.items
      const item = items.find((it) => it && it.id === id);
      if (item && item.standard) {
        const pph = normalizePPH(item.standard);
        if (pph > 0) {
          totalTimeCredit += cnt / (pph / 3600); // seconds
        }
      }
    }

    totalTimeCredit = Number(totalTimeCredit.toFixed(2));

    session.runtime = runtimeMs / 1000;
    session.workTime = workTimeSec;
    session.totalCount = totalCount;
    session.misfeedCount = misfeedCount;
    session.totalTimeCredit = totalTimeCredit;
    return session;
  }

  // Truncate a session to [start,end] and recalc
  function truncateAndRecalc(original, newStart, newEnd) {
    // Handle both old structure (counts as array) and new structure (counts.valid)
    const countsArray = Array.isArray(original.counts)
      ? original.counts
      : (original.counts?.valid || []);
    const misfeedsArray = Array.isArray(original.misfeeds)
      ? original.misfeeds
      : (original.counts?.misfeed || []);

    // Only clone what we need to modify
    const s = {
      ...original,
      timestamps: { ...original.timestamps },
      counts: [...countsArray],
      misfeeds: [...misfeedsArray],
    };

    // Clamp timestamps
    const start = new Date(s.timestamps.start);
    const end = new Date(s.timestamps.end || new Date());

    const clampedStart = start < newStart ? newStart : start;
    const clampedEnd = end > newEnd ? newEnd : end;

    s.timestamps.start = clampedStart;
    s.timestamps.end = clampedEnd;

    // Filter counts/misfeeds to window
    const inWindow = (d) => {
      const ts = new Date(d.timestamp || d.timestamps?.create);
      return ts >= clampedStart && ts <= clampedEnd;
    };

    s.counts = s.counts.filter(inWindow);
    s.misfeeds = s.misfeeds.filter(inWindow);

    return recalcSession(s);
  }

  // Build the final response row matching your existing shape
  function formatMachinesSummaryRow({
    machine,
    status,
    runtimeMs,
    downtimeMs,
    totalCount,
    misfeedCount,
    workTimeSec,
    totalTimeCredit,
    queryStart,
    queryEnd,
  }) {
    const totalMs = Math.max(0, queryEnd - queryStart);
    const availability = totalMs
      ? Math.min(Math.max(runtimeMs / totalMs, 0), 1)
      : 0;
    const throughput =
      totalCount + misfeedCount ? totalCount / (totalCount + misfeedCount) : 0;
    const efficiency = workTimeSec > 0 ? totalTimeCredit / workTimeSec : 0;
    const oee = availability * throughput * efficiency;

    return {
      machine: {
        serial: machine?.serial ?? -1,
        name: machine?.name ?? "Unknown",
      },
      currentStatus: {
        code: status?.code ?? 0,
        name: status?.name ?? "Unknown",
      },
      metrics: {
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
        start: queryStart,
        end: queryEnd,
      },
    };
  }

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function groupRecordsBySerial(records) {
    const map = new Map();
    for (const record of records || []) {
      const serial = safeNumber(record.machineSerial, null);
      if (serial === null) continue;
      if (!map.has(serial)) {
        map.set(serial, []);
      }
      map.get(serial).push(record);
    }
    return map;
  }

  function buildLatestTickerMap(stateTickerData) {
    const tickerMap = new Map();
    for (const record of stateTickerData || []) {
      const candidates = [
        record.machine?.serial,
        record.machine?.id,
        record.machine?.serialNumber,
      ];
      const ts =
        new Date(
          record.status?.timestamp ||
            record.timestamp ||
            record.timestamps?.update ||
            record.timestamps?.active ||
            record.timestamps?.create ||
            0
        ).getTime() || 0;

      for (const candidate of candidates) {
        const serial = safeNumber(candidate, null);
        if (serial === null) continue;

        const existing = tickerMap.get(serial);
        if (!existing || ts > existing.timestamp) {
          tickerMap.set(serial, {
            status: {
              code: record.status?.code ?? 0,
              name: record.status?.name || "Unknown",
            },
            timestamp: ts,
          });
        }
      }
    }
    return tickerMap;
  }

  function buildPerformanceFromMachineRecord(record) {
    const runtimeMs = safeNumber(record.runtimeMs);
    const pausedMs = safeNumber(record.pausedTimeMs);
    const faultMs = safeNumber(record.faultTimeMs);
    const downtimeMs = pausedMs + faultMs;
    const workedTimeMs = safeNumber(record.workedTimeMs);
    const timeCreditMs = safeNumber(record.totalTimeCreditMs);
    const totalCounts = safeNumber(record.totalCounts);
    const totalMisfeeds = safeNumber(record.totalMisfeeds);
    const totalOutput = totalCounts + totalMisfeeds;

    const windowMs =
      record.timeRange?.start && record.timeRange?.end
        ? Math.max(
            0,
            new Date(record.timeRange.end) - new Date(record.timeRange.start)
          )
        : runtimeMs + downtimeMs;

    const availability =
      windowMs > 0 ? Math.min(Math.max(runtimeMs / windowMs, 0), 1) : 0;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;
    const efficiency =
      workedTimeMs > 0 ? Math.min(Math.max(timeCreditMs / workedTimeMs, 0), 1) : 0;
    const oee = availability * throughput * efficiency;

    return {
      runtime: {
        total: runtimeMs,
        formatted: formatDuration(runtimeMs),
      },
      downtime: {
        total: downtimeMs,
        formatted: formatDuration(downtimeMs),
      },
      output: {
        totalCount: totalCounts,
        misfeedCount: totalMisfeeds,
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
  }

  function buildItemSummaryFromRecords(records, sessionStart, sessionEnd) {
    if (!records.length) {
      return {
        sessions: [],
        machineSummary: {
          totalCount: 0,
          workedTimeMs: 0,
          workedTimeFormatted: formatDuration(0),
          pph: 0,
          proratedStandard: 0,
          efficiency: 0,
          itemSummaries: {},
        },
      };
    }

    let totalWorkedMs = 0;
    let totalCounts = 0;
    const sessionItems = [];
    const itemSummaries = {};

    for (const record of records) {
      const counts = safeNumber(record.totalCounts);
      const workedMs =
        safeNumber(record.workedTimeMs) || safeNumber(record.runtimeMs);
      const standard = safeNumber(record.itemStandard);
      const hours = workedMs / 3600000 || 0;
      const pph = hours > 0 ? counts / hours : 0;
      const efficiency = standard > 0 ? pph / standard : 0;
      const itemId = record.itemId ?? record.itemName ?? "unknown";
      const itemKey = String(itemId);
      const itemName = record.itemName || `Item ${itemKey}`;

      totalWorkedMs += workedMs;
      totalCounts += counts;

      sessionItems.push({
        itemId: record.itemId,
        name: itemName,
        countTotal: counts,
        standard,
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      });

      itemSummaries[itemKey] = {
        name: itemName,
        standard,
        countTotal: counts,
        workedTimeFormatted: formatDuration(workedMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      };
    }

    const totalHours = totalWorkedMs / 3600000 || 0;
    const machinePph = totalHours > 0 ? totalCounts / totalHours : 0;
    const proratedStandard = sessionItems.reduce((acc, item) => {
      const weight = totalCounts > 0 ? item.countTotal / totalCounts : 0;
      return acc + weight * (item.standard || 0);
    }, 0);
    const machineEfficiency =
      proratedStandard > 0 ? machinePph / proratedStandard : 0;

    return {
      sessions: [
        {
          start: sessionStart.toISOString(),
          end: sessionEnd.toISOString(),
          workedTimeMs: totalWorkedMs,
          workedTimeFormatted: formatDuration(totalWorkedMs),
          items: sessionItems,
        },
      ],
      machineSummary: {
        totalCount: totalCounts,
        workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(machinePph * 100) / 100,
        proratedStandard: Math.round(proratedStandard * 100) / 100,
        efficiency: Math.round(machineEfficiency * 10000) / 100,
        itemSummaries,
      },
    };
  }

  function buildItemHourlyStackFromRecords(records, sessionStart) {
    if (!records.length) {
      return {
        title: "No data",
        data: { hours: [], items: {} },
      };
    }

    // Group records by hour and itemName, summing totalCounts
    const hourMap = new Map();
    const itemNames = new Set();

    for (const record of records) {
      // Use the hour field directly from hourly-totals records
      const hour = typeof record.hour === 'number' ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
      }

      const itemName = record.itemName || `Item ${record.itemId ?? "Unknown"}`;
      const count = safeNumber(record.totalCounts);

      if (!hourMap.has(hour)) {
        hourMap.set(hour, {});
      }
      const entry = hourMap.get(hour);
      entry[itemName] = (entry[itemName] || 0) + count;
      itemNames.add(itemName);
    }

    if (hourMap.size === 0) {
      return {
        title: "Item Stacked Count Chart",
        data: { hours: [], items: {} },
      };
    }

    // Get all hours that have data and find the maximum
    const hoursWithData = Array.from(hourMap.keys()).sort((a, b) => a - b);
    const maxHour = Math.max(...hoursWithData);

    // Create array of all hours from 0 to maxHour (inclusive) to match expected format
    // This ensures hours start from 0 even if data doesn't exist for early hours
    const allHours = Array.from({ length: maxHour + 1 }, (_, idx) => idx);

    // Initialize items object with arrays filled with zeros
    const items = {};
    for (const name of itemNames) {
      items[name] = Array(allHours.length).fill(0);
    }

    // Fill in the actual counts
    for (const [hour, counts] of hourMap.entries()) {
      if (hour >= 0 && hour < allHours.length) {
        for (const [itemName, total] of Object.entries(counts)) {
          items[itemName][hour] = total;
        }
      }
    }

    return {
      title: "Item Stacked Count Chart",
      data: {
        hours: allHours,
        items,
      },
    };
  }

  function buildOperatorEfficiencyFromRecords(records, sessionStart) {
    if (!records.length) {
      return [];
    }

    // Import Luxon for timezone-aware date handling
    const { DateTime } = require("luxon");
    const { SYSTEM_TIMEZONE } = require("../../utils/time");

    // Group records by hour
    const hourMap = new Map();

    for (const record of records) {
      // Use the hour field directly from hourly-totals records
      const hour = typeof record.hour === 'number' ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
      }

      const workedMs = safeNumber(record.workedTimeMs) || safeNumber(record.runtimeMs);
      const timeCreditMs = safeNumber(record.totalTimeCreditMs);
      const ratio = workedMs > 0 ? Math.min(Math.max(timeCreditMs / workedMs, 0), 2) : 0;
      const efficiency = Math.round(ratio * 10000) / 100;

      const operatorId = safeNumber(record.operatorId);
      const operatorName = record.operatorName || "Unknown";

      if (!hourMap.has(hour)) {
        hourMap.set(hour, {
          operators: new Map() // Use Map to deduplicate operators per hour
        });
      }

      const hourData = hourMap.get(hour);
      
      // Use operator ID as key to avoid duplicates (in case same operator has multiple records for same hour)
      const operatorKey = `${operatorId}`;
      if (!hourData.operators.has(operatorKey)) {
        hourData.operators.set(operatorKey, {
          id: operatorId,
          name: operatorName,
          efficiency: efficiency
        });
      } else {
        // If operator already exists in this hour, average the efficiencies
        // This handles cases where an operator might have multiple records for the same hour
        const existing = hourData.operators.get(operatorKey);
        existing.efficiency = Math.round(((existing.efficiency + efficiency) / 2) * 100) / 100;
      }
    }

    if (hourMap.size === 0) {
      return [];
    }

    // Convert to array format, sorted by hour
    const hours = Array.from(hourMap.keys()).sort((a, b) => a - b);
    const result = [];

    for (const hour of hours) {
      const hourData = hourMap.get(hour);
      const operators = Array.from(hourData.operators.values());
      
      // Calculate average efficiency for this hour from all operators
      const avgEfficiency = operators.length > 0
        ? operators.reduce((sum, op) => sum + op.efficiency, 0) / operators.length
        : 0;

      // ✅ FIX: Create hour timestamp in Chicago timezone (matching the hour field from records)
      // Convert sessionStart to Chicago timezone, then set the hour in that timezone
      const hourDate = DateTime.fromJSDate(sessionStart, { zone: SYSTEM_TIMEZONE })
        .set({ hour: hour, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();

      result.push({
        hour: hourDate.toISOString(),
        oee: Math.round(avgEfficiency * 100) / 100,
        operators: operators
      });
    }

    return result;
  }

  return router;
};
