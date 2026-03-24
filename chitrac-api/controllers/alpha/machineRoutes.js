const express = require("express");
const { formatDuration, parseAndValidateQueryParams } = require("../../utils/time");
const config = require("../../modules/config");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");
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

  // GET /api/alpha/analytics/machines-summary-daily-cached
  // Returns daily machine summary from totals-daily cache; falls back to real-time if no cache.
  router.get("/machines-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

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
          const chicagoTimeFallback = new Date(
            todayFallback.toLocaleString("en-US", { timeZone: "America/Chicago" })
          );
          rangeStart = new Date(chicagoTimeFallback.setHours(0, 0, 0, 0));
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
      const serialParam =
        typeof req.query.serial !== "undefined"
          ? Number.parseInt(req.query.serial, 10)
          : null;
      const machineSerialFilter = Number.isFinite(serialParam)
        ? serialParam
        : null;

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

  return router;
};
