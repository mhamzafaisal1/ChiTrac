const express = require("express");
const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const config = require("../../modules/config");
const {
  loadActiveShifts,
  computeShiftElapsedMs,
  getShiftDayHourEnvelope,
} = require("../../utils/shiftElapsed");
const { getSessionDataForPartialDays } = require("../../utils/reportFunctions");
const { getPlantDateStr } = require("../../utils/machineDashboardCache");
const {
  getMachinesSummaryRealTime,
  buildLatestTickerMap,
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
  buildCurrentOperatorsFromTicker: buildCurrentOperators,
} = require("../../utils/machineFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const getMachinesSummaryRealTimeHandler = getMachinesSummaryRealTime(db, logger, config);

  function resolveDashboardDetailRange(req) {
    const hasStart = typeof req.query.start !== "undefined" || typeof req.query.startTime !== "undefined";
    const hasEnd = typeof req.query.end !== "undefined" || typeof req.query.endTime !== "undefined";

    if (hasStart || hasEnd || req.query.timeframe) {
      const parsed = parseAndValidateQueryParams(req);
      return {
        start: parsed.start,
        end: parsed.end,
        serial: parsed.serial,
        dateStr: getPlantDateStr(parsed.start),
        hasExplicitRange: true,
      };
    }

    const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
    return {
      start: now.startOf("day").toJSDate(),
      end: now.toJSDate(),
      serial:
        typeof req.query.serial !== "undefined" || typeof req.query.machineSerial !== "undefined"
          ? Number.parseInt(req.query.serial || req.query.machineSerial, 10)
          : null,
      dateStr: now.toISODate(),
      hasExplicitRange: false,
    };
  }

  function hourEnvelopeForRange(start, end) {
    const startDt = DateTime.fromJSDate(new Date(start), { zone: SYSTEM_TIMEZONE });
    const endDt = DateTime.fromJSDate(new Date(end), { zone: SYSTEM_TIMEZONE });
    if (!startDt.isValid || !endDt.isValid || endDt <= startDt) return null;

    const effectiveEnd = endDt.minus({ milliseconds: 1 });
    if (startDt.toISODate() !== effectiveEnd.toISODate()) return null;

    return {
      minHour: startDt.hour,
      maxHour: Math.max(startDt.hour, effectiveEnd.hour),
    };
  }

  function intersectHourEnvelopes(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    const minHour = Math.max(a.minHour, b.minHour);
    const maxHour = Math.min(a.maxHour, b.maxHour);
    return maxHour >= minHour ? { minHour, maxHour } : null;
  }

  // GET /api/alpha/analytics/machines-summary-daily-cached
  // Returns daily machine summary from totals-daily cache; falls back to real-time if no cache.
  router.get("/machines-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      if (req.query.shiftId) {
        let shiftOid;
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        const shiftDoc = await db.collection("shift").findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }
        const sessionData = await getSessionDataForPartialDays(
          db,
          [{ start, end }],
          serial,
          { shiftId: String(shiftOid) }
        );
        const machineSerials = [
          ...new Set((sessionData.machines || []).map((m) => Number(m.machineSerial))),
        ].filter((n) => Number.isFinite(n));
        const tickers = machineSerials.length
          ? await db
              .collection(config.stateTickerCollectionName)
              .find({ "machine.id": { $in: machineSerials } })
              .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
              .toArray()
          : [];
        const latestTickers = new Map();
        tickers.forEach((ticker) => {
          const id = Number(ticker.machine?.id);
          const ts = new Date(ticker.timestamp || 0);
          const existing = latestTickers.get(id);
          if (!existing || ts > new Date(existing.timestamp || 0)) {
            latestTickers.set(id, ticker);
          }
        });
        const statusMap = new Map();
        for (const [id, ticker] of latestTickers) {
          const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
          statusMap.set(id, {
            code: statusId,
            name: ticker.status?.name || "Unknown",
            color: ticker.status?.softrolColor || "None",
          });
        }
        const data = (sessionData.machines || []).map((record) => {
          const serialNum = Number(record.machineSerial);
          const currentStatus = statusMap.get(serialNum) || {
            code: 0,
            name: "Unknown",
          };
          const runtimeMs = record.runtimeMs || 0;
          const totalCounts = record.totalCounts || 0;
          const workedMs = record.workedTimeMs || 0;
          const efficiency = runtimeMs > 0 ? Math.min(workedMs / (runtimeMs * 4), 1) : 0;
          const availability = 1;
          const throughput = 1;
          const oee = availability * throughput * efficiency;
          return {
            machine: {
              serial: serialNum,
              name: record.machineName || `Serial ${serialNum}`,
            },
            currentStatus,
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              downtime: {
                total: 0,
                formatted: formatDuration(0),
              },
              output: {
                totalCount: totalCounts,
                misfeedCount: 0,
              },
              performance: {
                availability: { value: availability, percentage: "100.00" },
                throughput: { value: throughput, percentage: "100.00" },
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
            timeRange: { start, end },
          };
        });
        return res.json(data);
      }

      const today = new Date();
      const wallClockNow = new Date(
        today.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
      );
      const dateStr = wallClockNow.toISOString().split("T")[0];

      // Load shifts once per request (used to make availability/downtime shift-aware).
      const activeShifts = await loadActiveShifts(db).catch(() => []);

      logger.info(
        `[machineSessions] Fetching daily cached machines summary for date: ${dateStr}, serial: ${
          serial || "all"
        }`
      );

      const filter = {
        entityType: "machine",
        date: dateStr,
      };
      if (serial) {
        filter.machineSerial = parseInt(serial);
      }

      const cacheRecords = await db
        .collection("totals-daily")
        .find(filter)
        .toArray();

      if (cacheRecords.length === 0) {
        logger.warn(
          `[machineSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`
        );
        return await getMachinesSummaryRealTimeHandler(req, res);
      }

      const machineSerials = cacheRecords.map((r) => Number(r.machineSerial));
      const shiftElapsedCache = new Map(); // `${rangeStartMs}|${rangeEndMs}` -> ms

      const tickers = await db
        .collection(config.stateTickerCollectionName)
        .find({ "machine.id": { $in: machineSerials } })
        .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
        .toArray();

      const latestTickers = new Map();
      tickers.forEach((ticker) => {
        const id = Number(ticker.machine?.id);
        const ts = new Date(ticker.timestamp || 0);
        const existing = latestTickers.get(id);
        if (!existing || ts > new Date(existing.timestamp || 0)) {
          latestTickers.set(id, ticker);
        }
      });

      const statusMap = new Map();
      for (const [id, ticker] of latestTickers) {
        const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
        statusMap.set(id, {
          code: statusId,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.softrolColor || "None",
        });
      }

      const data = cacheRecords.map((record) => {
        const currentStatus = statusMap.get(Number(record.machineSerial)) || {
          code: 0,
          name: "Unknown",
        };

        const timeRange = record.buildRange || record.timeRange;
        let rangeStart, rangeEnd;

        if (timeRange && timeRange.start && timeRange.end) {
          rangeStart = new Date(timeRange.start);
          rangeEnd = new Date(timeRange.end);
        } else {
          const todayFallback = new Date();
          const wallClockFallback = new Date(
            todayFallback.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
          );
          rangeStart = new Date(wallClockFallback.setHours(0, 0, 0, 0));
          rangeEnd = new Date();
        }

        const shiftKey = `${rangeStart.getTime()}|${rangeEnd.getTime()}`;
        const shiftElapsedMs = shiftElapsedCache.has(shiftKey)
          ? shiftElapsedCache.get(shiftKey)
          : computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);
        shiftElapsedCache.set(shiftKey, shiftElapsedMs);

        const downtimeMs = Math.max(shiftElapsedMs - record.runtimeMs, 0);
        const availability =
          shiftElapsedMs > 0
            ? Math.min(Math.max(record.runtimeMs / shiftElapsedMs, 0), 1)
            : 0;
        const totalOutput = record.totalCounts + record.totalMisfeeds;
        const throughput =
          totalOutput > 0 ? record.totalCounts / totalOutput : 0;

        let workTimeMs = record.workedTimeMs || 0;
        if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && record.runtimeMs > 0) {
          workTimeMs = record.runtimeMs;
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

      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date") ||
        err.message.includes("Invalid timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }

      logger.info(
        `[machineSessions] Falling back to real-time calculation due to error`
      );
      return await getMachinesSummaryRealTimeHandler(req, res);
    }
  });

  // GET /api/alpha/analytics/machine-dashboard-daily-cached
  // Returns machine dashboard from totals-daily and hourly-totals cache.
  router.get("/machine-dashboard-daily-cached", async (req, res) => {
    try {
      const {
        start: requestStart,
        end: requestEnd,
        serial,
        dateStr,
        hasExplicitRange,
      } = resolveDashboardDetailRange(req);
      const machineSerialFilter = Number.isFinite(serial) ? serial : null;

      let shiftDoc = null;
      let shiftOid = null;
      if (req.query.shiftId) {
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }
      }

      const wallClockNow = DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate();

      const cacheCollection = db.collection("totals-daily");
      const machineCollection = shiftOid
        ? db.collection("totals-shift")
        : cacheCollection;
      const machineFilter = {
        entityType: "machine",
        date: dateStr,
      };
      if (shiftOid) {
        machineFilter.shiftId = String(shiftOid);
      }

      if (machineSerialFilter !== null) {
        machineFilter.machineSerial = machineSerialFilter;
      }

      let machineTotalsSource = shiftOid ? "totals-shift" : "totals-daily";
      let machineTotals = await machineCollection.find(machineFilter).toArray();
      if (machineTotals.length === 0 && shiftOid) {
        logger.warn(
          `[machineSessions] No shift machine totals found in totals-shift for ${dateStr} shift ${shiftOid}; falling back to daily machine totals`
        );
        const dailyMachineFilter = {
          entityType: "machine",
          date: dateStr,
        };
        if (machineSerialFilter !== null) {
          dailyMachineFilter.machineSerial = machineSerialFilter;
        }
        machineTotalsSource = "totals-daily";
        machineTotals = await cacheCollection.find(dailyMachineFilter).toArray();
      }

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

      const activeShifts = await loadActiveShifts(db).catch(() => []);
      const shiftHourEnvelope = getShiftDayHourEnvelope(
        shiftDoc ? [shiftDoc] : activeShifts,
        requestStart
      );
      const requestHourEnvelope = hasExplicitRange
        ? hourEnvelopeForRange(requestStart, requestEnd)
        : null;
      const chartHourEnvelope = intersectHourEnvelopes(
        shiftHourEnvelope,
        requestHourEnvelope
      );
      const chartHoursAreEmpty =
        Boolean(requestHourEnvelope && shiftHourEnvelope && !chartHourEnvelope);
      const chartHourFilter = chartHoursAreEmpty
        ? { hour: { $gte: 1, $lte: 0 } }
        : chartHourEnvelope
          ? { hour: { $gte: chartHourEnvelope.minHour, $lte: chartHourEnvelope.maxHour } }
          : {};
      const detailTotalsCollection = machineTotalsSource === "totals-shift"
        ? db.collection("totals-shift")
        : cacheCollection;
      const detailTotalsBaseFilter = machineTotalsSource === "totals-shift"
        ? { shiftId: String(shiftOid) }
        : {};

      const [machineItemRecords, machineItemHourlyRecords, operatorMachineRecords, operatorMachineHourlyRecords, stateTickerData] =
        await Promise.all([
          detailTotalsCollection
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...detailTotalsBaseFilter,
            })
            .toArray(),
          db
            .collection("hourly-totals")
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...chartHourFilter,
            })
            .toArray(),
          detailTotalsCollection
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...detailTotalsBaseFilter,
            })
            .toArray(),
          db
            .collection("hourly-totals")
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...chartHourFilter,
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
      const operatorMachineHourlyBySerial = groupRecordsBySerial(operatorMachineHourlyRecords);

      const results = await Promise.all(
        machineTotals.map(async (record) => {
          const serial = Number(record.machineSerial);
          if (!Number.isFinite(serial) || !serialSet.has(serial)) {
            return null;
          }

          const sessionStart = hasExplicitRange
            ? new Date(requestStart)
            : record.timeRange?.start
              ? new Date(record.timeRange.start)
              : new Date(`${dateStr}T00:00:00.000Z`);
          const sessionEnd = hasExplicitRange
            ? new Date(requestEnd)
            : record.timeRange?.end
              ? new Date(record.timeRange.end)
              : wallClockNow;

          const cacheDateForCharts =
            typeof record.date === "string" && record.date.trim()
              ? record.date.trim()
              : dateStr;

          const shiftElapsedMs = computeShiftElapsedMs(
            activeShifts,
            sessionStart,
            sessionEnd
          );
          const performance = buildPerformanceFromMachineRecord(
            record,
            shiftElapsedMs
          );
          const machineItems = machineItemsBySerial.get(serial) || [];
          const itemSummary = buildItemSummaryFromRecords(
            machineItems,
            sessionStart,
            sessionEnd
          );
          const machineItemHourly = machineItemHourlyBySerial.get(serial) || [];
          const itemHourlyStack = buildItemHourlyStackFromRecords(
            machineItemHourly,
            sessionStart,
            chartHourEnvelope,
            cacheDateForCharts
          );
          const operatorMachineHourly = operatorMachineHourlyBySerial.get(serial) || [];
          const operatorEfficiency = buildOperatorEfficiencyFromRecords(
            operatorMachineHourly,
            sessionStart,
            chartHourEnvelope,
            cacheDateForCharts
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
            timestamp: record.lastUpdated || wallClockNow,
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
      if (
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date string format") ||
        err.message.includes("Start time must be before end time") ||
        err.message.includes("Unsupported timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }
      res
        .status(500)
        .json({ error: "Failed to fetch machine dashboard daily cache" });
    }
  });

  // GET /api/alpha/analytics/machine-summary-timeframe
  // Timeframe-based machine list; optional shiftId uses session aggregation (same shape as shift branch on machines-summary-daily-cached).
  router.get("/machine-summary-timeframe", async (req, res) => {
    try {
      if (!req.query.timeframe) {
        return res.status(400).json({ error: "timeframe is required" });
      }
      const { start, end, serial } = parseAndValidateQueryParams(req);

      if (req.query.shiftId) {
        let shiftOid;
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        const shiftDoc = await db.collection("shift").findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }
        const sessionData = await getSessionDataForPartialDays(
          db,
          [{ start, end }],
          serial,
          { shiftId: String(shiftOid) }
        );
        const machineSerials = [
          ...new Set((sessionData.machines || []).map((m) => Number(m.machineSerial))),
        ].filter((n) => Number.isFinite(n));
        const tickers = machineSerials.length
          ? await db
              .collection(config.stateTickerCollectionName)
              .find({ "machine.id": { $in: machineSerials } })
              .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
              .toArray()
          : [];
        const latestTickers = new Map();
        tickers.forEach((ticker) => {
          const id = Number(ticker.machine?.id);
          const ts = new Date(ticker.timestamp || 0);
          const existing = latestTickers.get(id);
          if (!existing || ts > new Date(existing.timestamp || 0)) {
            latestTickers.set(id, ticker);
          }
        });
        const statusMap = new Map();
        for (const [id, ticker] of latestTickers) {
          const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
          statusMap.set(id, {
            code: statusId,
            name: ticker.status?.name || "Unknown",
            color: ticker.status?.softrolColor || "None",
          });
        }
        const data = (sessionData.machines || []).map((record) => {
          const serialNum = Number(record.machineSerial);
          const currentStatus = statusMap.get(serialNum) || {
            code: 0,
            name: "Unknown",
          };
          const runtimeMs = record.runtimeMs || 0;
          const totalCounts = record.totalCounts || 0;
          const workedMs = record.workedTimeMs || 0;
          const efficiency = runtimeMs > 0 ? Math.min(workedMs / (runtimeMs * 4), 1) : 0;
          const availability = 1;
          const throughput = 1;
          const oee = availability * throughput * efficiency;
          return {
            machine: {
              serial: serialNum,
              name: record.machineName || `Serial ${serialNum}`,
            },
            currentStatus,
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              downtime: {
                total: 0,
                formatted: formatDuration(0),
              },
              output: {
                totalCount: totalCounts,
                misfeedCount: 0,
              },
              performance: {
                availability: { value: availability, percentage: "100.00" },
                throughput: { value: throughput, percentage: "100.00" },
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
            timeRange: { start, end },
          };
        });
        return res.json(data);
      }

      return await getMachinesSummaryRealTimeHandler(req, res);
    } catch (err) {
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date") ||
        err.message.includes("Unsupported timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }
      logger.error(`[machineSessions] Error in machine-summary-timeframe:`, err);
      return res.status(500).json({ error: "Failed to fetch machine summary" });
    }
  });

  // GET /api/alpha/analytics/machine-dashboard-cached
  // Timeframe-based single-machine dashboard payload from sessions (optional shiftId).
  router.get("/machine-dashboard-cached", async (req, res) => {
    try {
      if (!req.query.timeframe) {
        return res.status(400).json({ error: "timeframe is required" });
      }
      const serialParam =
        typeof req.query.serial !== "undefined"
          ? Number.parseInt(req.query.serial, 10)
          : null;
      if (!Number.isFinite(serialParam)) {
        return res.status(400).json({ error: "serial is required" });
      }

      const { start, end, serial } = parseAndValidateQueryParams(req);

      const sessionOpts = {};
      if (req.query.shiftId) {
        let shiftOid;
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        const shiftDoc = await db.collection("shift").findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }
        sessionOpts.shiftId = String(shiftOid);
      }

      const sessionData = await getSessionDataForPartialDays(
        db,
        [{ start, end }],
        serial || serialParam,
        sessionOpts
      );
      const record =
        (sessionData.machines || []).find(
          (m) => Number(m.machineSerial) === serialParam
        ) || null;
      if (!record) {
        return res.json([]);
      }

      const tickerSerialFilter = [serialParam, String(serialParam)];
      const stateTickerData = await db
        .collection(config.stateTickerCollectionName)
        .find({
          $or: [
            { "machine.serial": { $in: tickerSerialFilter } },
            { "machine.id": { $in: tickerSerialFilter } },
          ],
        })
        .toArray();
      const tickerMap = buildLatestTickerMap(stateTickerData);
      const latestTicker = tickerMap.get(serialParam);
      const runtimeMs = record.runtimeMs || 0;
      const totalCounts = record.totalCounts || 0;
      const performance = buildPerformanceFromMachineRecord({
        machineSerial: serialParam,
        machineName: record.machineName,
        runtimeMs,
        workedTimeMs: record.workedTimeMs || 0,
        totalCounts,
        totalMisfeeds: 0,
        pausedTimeMs: 0,
        faultTimeMs: 0,
        totalTimeCreditMs: record.workedTimeMs || 0,
        timeRange: { start, end },
      });
      return res.json([
        {
          machine: {
            serial: serialParam,
            name: record.machineName || `Serial ${serialParam}`,
          },
          currentStatus: latestTicker?.status || {
            code: 0,
            name: "Unknown",
          },
          performance,
          itemSummary: {
            machineSummary: { totalCount: totalCounts, misfeedCount: 0 },
            itemSummaries: {},
          },
          itemHourlyStack: [],
          faultData: { faultSummaries: [], faultCycles: [] },
          operatorEfficiency: [],
          currentOperators: await buildCurrentOperators(db, serialParam),
          timestamp: new Date(),
          sessionStart: start,
          sessionEnd: end,
        },
      ]);
    } catch (err) {
      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date") ||
        err.message.includes("Unsupported timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }
      logger.error(`[machineSessions] Error in machine-dashboard-cached:`, err);
      return res
        .status(500)
        .json({ error: "Failed to fetch machine dashboard (timeframe)" });
    }
  });

  return router;
};
