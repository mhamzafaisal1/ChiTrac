const express = require("express");

const { formatDuration } = require("../../utils/time");
const { buildCurrentOperators } = require("../../utils/machineDashboardBuilder");
const {
  normalizePPH,
  safeNumber,
  recalcSession,
  truncateAndRecalc,
  formatMachinesSummaryRow,
  groupRecordsBySerial,
  buildLatestTickerMap,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
  queryMachinesSummaryDailyCache,
  queryMachinesSummarySessions,
  combineMachinesSummaryData,
  buildHybridMachinesSummary,
  queryMachineDailyCache,
  queryMachineSessions,
  combineMachineDashboardData,
} = require("../../utils/machineFunctions");

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
      // Note: Status schema uses 'id' but we keep 'code' for API compatibility
      const statusMap = new Map();
      for (const [id, ticker] of latestTickers) {
        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
        statusMap.set(id, {
          code: statusId, // Use 'code' in API response for backward compatibility
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
        
        // ✅ FIX: If workedTimeMs is 0 but we have totalTimeCreditMs and runtimeMs,
        // use runtimeMs as fallback (assuming at least 1 active station)
        // This handles cases where workedTimeMs wasn't properly calculated in cache
        let workTimeMs = record.workedTimeMs || 0;
        if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && record.runtimeMs > 0) {
          workTimeMs = record.runtimeMs; // Fallback to runtimeMs (assumes 1 active station)
          logger.debug(
            `[machineSessions] Machine ${record.machineSerial}: workedTimeMs was 0, using runtimeMs ${workTimeMs}ms as fallback`
          );
        }
        
        const workTimeSec = workTimeMs / 1000;
        const totalTimeCreditSec = (record.totalTimeCreditMs || 0) / 1000;
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

  // ---- /api/alpha/analytics/machine-group-summary-daily-cached ----
  // Aggregates totals-daily machine records by department (hard-coded 4 groups).
  // Returns one entry per department with summed runtime, downtime, counts and derived OEE metrics.
  const MACHINE_GROUP_DEPARTMENTS = [
    "Small Piece Folder",
    "Large Piece Ironer",
    "Blanket Blaster",
    "Small Piece Ironer",
  ];

  // Previous calendar day (YYYY-MM-DD) for "yesterday" in same timezone context
  function previousDateStr(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - 1);
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  router.get("/analytics/machines-group-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Use requested start date (in Chicago) for totals-daily query so ?start=2026-02-04... returns that day
      const dateStr = start.toLocaleDateString("en-CA", {
        timeZone: "America/Chicago",
      });
      const yesterdayStr = previousDateStr(dateStr);

      logger.info(
        `[machineSessions] machine-group-summary: query params start=${req.query.start} end=${req.query.end} serial=${req.query.serial || "none"}`
      );
      logger.info(
        `[machineSessions] machine-group-summary: parsed start=${start?.toISOString?.()} end=${end?.toISOString?.()} dateStr=${dateStr} yesterdayStr=${yesterdayStr}`
      );

      const filter = {
        entityType: "machine",
        date: dateStr,
      };
      if (serial) {
        filter.machineSerial = parseInt(serial);
      }

      const filterYesterday = {
        entityType: "machine",
        date: yesterdayStr,
      };
      if (serial) {
        filterYesterday.machineSerial = parseInt(serial);
      }

      logger.info(
        `[machineSessions] machine-group-summary: querying totals-daily with filter ${JSON.stringify(filter)}`
      );

      const [cacheRecords, yesterdayRecords] = await Promise.all([
        db.collection("totals-daily").find(filter).toArray(),
        db.collection("totals-daily").find(filterYesterday).toArray(),
      ]);

      logger.info(
        `[machineSessions] machine-group-summary: totals-daily returned ${cacheRecords.length} record(s) for date=${dateStr}`
      );

      if (cacheRecords.length === 0) {
        // Debug: see what dates/entityTypes exist in totals-daily
        const anyByDate = await db
          .collection("totals-daily")
          .countDocuments({ date: dateStr });
        const sampleDocs = await db
          .collection("totals-daily")
          .find({})
          .limit(3)
          .project({ date: 1, entityType: 1, machineSerial: 1, "machine.groups.department": 1 })
          .toArray();
        const debug = {
          reason: "no_cached_data_for_date",
          message: `No daily cached data for the requested date (${dateStr}). Totals may not have been built yet for this date.`,
          details: {
            requestedDate: dateStr,
            totalsDailyCountForDate: anyByDate,
            sampleDocsInCollection: sampleDocs,
          },
        };
        logger.warn(
          `[machineSessions] No daily cached data for date: ${dateStr}, returning empty array. ` +
            `totals-daily count for date "${dateStr}": ${anyByDate}. ` +
            `Sample docs in collection: ${JSON.stringify(sampleDocs)}`
        );
        return res.json({ data: [], debug });
      }

      // Log first record shape to verify machine.groups.department
      const first = cacheRecords[0];
      logger.info(
        `[machineSessions] machine-group-summary: first record date=${first.date} entityType=${first.entityType} machineSerial=${first.machineSerial} machine.groups.department=${first.machine?.groups?.department ?? "missing"}`
      );

      // Window: use requested start/end for availability calculation
      const rangeStart = new Date(start);
      const rangeEnd = new Date(end);
      const windowMs = rangeEnd - rangeStart;

      // Group records by department (only known departments; skip others)
      const byDept = new Map();
      for (const name of MACHINE_GROUP_DEPARTMENTS) {
        byDept.set(name, []);
      }
      let skippedNoDept = 0;
      let skippedUnknownDept = 0;
      for (const record of cacheRecords) {
        const dept = record.machine?.groups?.department;
        if (!dept) {
          skippedNoDept++;
          continue;
        }
        if (!byDept.has(dept)) {
          skippedUnknownDept++;
          logger.info(
            `[machineSessions] machine-group-summary: record machineSerial=${record.machineSerial} has unknown department "${dept}"`
          );
          continue;
        }
        byDept.get(dept).push(record);
      }
      logger.info(
        `[machineSessions] machine-group-summary: grouped by dept. ` +
          `Counts: ${[...byDept.entries()].map(([n, r]) => `${n}=${r.length}`).join(", ")}. ` +
          `Skipped (no department): ${skippedNoDept}, skipped (unknown department): ${skippedUnknownDept}`
      );

      // Group yesterday's records by department (same logic) for previous-day efficiency
      const byDeptYesterday = new Map();
      for (const name of MACHINE_GROUP_DEPARTMENTS) {
        byDeptYesterday.set(name, []);
      }
      for (const record of yesterdayRecords) {
        const dept = record.machine?.groups?.department;
        if (!dept || !byDeptYesterday.has(dept)) continue;
        byDeptYesterday.get(dept).push(record);
      }

      const data = [];
      for (const departmentName of MACHINE_GROUP_DEPARTMENTS) {
        const records = byDept.get(departmentName);
        if (!records || records.length === 0) continue;

        let sumRuntimeMs = 0;
        let sumPausedMs = 0;
        let sumFaultMs = 0;
        let sumTotalCounts = 0;
        let sumTotalMisfeeds = 0;
        let sumTotalTimeCreditMs = 0;
        let sumWorkedTimeMs = 0;

        for (const record of records) {
          sumRuntimeMs += record.runtimeMs || 0;
          sumPausedMs += record.pausedTimeMs || 0;
          sumFaultMs += record.faultTimeMs || 0;
          sumTotalCounts += record.totalCounts || 0;
          sumTotalMisfeeds += record.totalMisfeeds || 0;
          sumTotalTimeCreditMs += record.totalTimeCreditMs || 0;
          let workMs = record.workedTimeMs || 0;
          if (workMs === 0 && (record.totalTimeCreditMs || 0) > 0 && (record.runtimeMs || 0) > 0) {
            workMs = record.runtimeMs;
          }
          sumWorkedTimeMs += workMs;
        }

        const downtimeMs = sumPausedMs + sumFaultMs;
        const availability =
          windowMs > 0
            ? Math.min(Math.max(sumRuntimeMs / windowMs, 0), 1)
            : 0;
        const totalOutput = sumTotalCounts + sumTotalMisfeeds;
        const throughput = totalOutput > 0 ? sumTotalCounts / totalOutput : 0;
        const workTimeSec = sumWorkedTimeMs / 1000;
        const totalTimeCreditSec = sumTotalTimeCreditMs / 1000;
        const efficiency = workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
        const oee = availability * throughput * efficiency;

        // Previous-day efficiency for this group (N/A if no yesterday data or no worked time)
        let efficiencyPreviousDay = null;
        const recordsYesterday = byDeptYesterday.get(departmentName);
        if (recordsYesterday && recordsYesterday.length > 0) {
          let sumWorkedMsY = 0;
          let sumTimeCreditMsY = 0;
          for (const rec of recordsYesterday) {
            sumTimeCreditMsY += rec.totalTimeCreditMs || 0;
            let w = rec.workedTimeMs || 0;
            if (w === 0 && (rec.totalTimeCreditMs || 0) > 0 && (rec.runtimeMs || 0) > 0) {
              w = rec.runtimeMs;
            }
            sumWorkedMsY += w;
          }
          const workTimeSecY = sumWorkedMsY / 1000;
          const totalTimeCreditSecY = sumTimeCreditMsY / 1000;
          if (workTimeSecY > 0) {
            const effY = totalTimeCreditSecY / workTimeSecY;
            efficiencyPreviousDay = {
              value: effY,
              percentage: (effY * 100).toFixed(2),
            };
          }
        }

        data.push({
          machine: {
            name: departmentName,
          },
          metrics: {
            runtime: {
              total: sumRuntimeMs,
              formatted: formatDuration(sumRuntimeMs),
            },
            downtime: {
              total: downtimeMs,
              formatted: formatDuration(downtimeMs),
            },
            output: {
              totalCount: sumTotalCounts,
              misfeedCount: sumTotalMisfeeds,
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
          efficiencyPreviousDay,
        });
      }

      if (data.length === 0 && cacheRecords.length > 0) {
        const debug = {
          reason: "all_records_skipped_no_matching_department",
          message:
            `Found ${cacheRecords.length} cache record(s) for ${dateStr} but none matched known machine groups (departments). ` +
            `Skipped: ${skippedNoDept} with no department, ${skippedUnknownDept} with unknown department.`,
          details: {
            requestedDate: dateStr,
            cacheRecordsCount: cacheRecords.length,
            skippedNoDepartment: skippedNoDept,
            skippedUnknownDepartment: skippedUnknownDept,
            knownDepartments: MACHINE_GROUP_DEPARTMENTS,
          },
        };
        logger.warn(
          `[machineSessions] machine-group-summary: had ${cacheRecords.length} cache record(s) but 0 department groups (all skipped or no matching department)`
        );
        return res.json({ data: [], debug });
      }
      logger.info(
        `[machineSessions] Retrieved ${data.length} department group(s) for date: ${dateStr}`
      );
      res.json(data);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in machine-group-summary-daily-cached route:`,
        err
      );
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date")
      ) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
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
        db,
        logger,
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
        db,
        logger,
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
      const dailyRecords = await queryMachineDailyCache(db, completeDays, serial);

      // Query sessions for partial days
      const sessionData = await queryMachineSessions(db, partialDays, serial);

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
          // Status schema uses 'id', but legacy code used 'code' - support both
          const statusCode = latest.status?.id ?? latest.status?.code ?? 0;
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
          // Status schema uses 'id', but legacy code used 'code' - support both
          const statusCode = latest.status?.id ?? latest.status?.code ?? 0;
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

  return router;
};
