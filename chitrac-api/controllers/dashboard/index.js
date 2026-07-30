// Dashboard routes. The following 6 routes are for daily-dashboard (6 charts):
//   GET /analytics/daily/machine-status-cache
//   GET /analytics/daily/machine-oee
//   GET /analytics/hourly/item-totals-by-type
//   GET /analytics/daily/count-totals-cache
//   GET /analytics/daily/top-operators-cache
//   GET /analytics/machines-group-summary-daily-cached
const express = require("express");
const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const { parseAndValidateQueryParams, formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time");
const config = require("../../modules/config");
const { formatHumanName } = require("../../utils/humanNames");
const {
  getSessionDataForPartialDays,
} = require("../../utils/reportFunctions");
const {
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData,
} = require("../../utils/itemFunctions");
const {
  splitTimeRangeForHybrid,
  computeMachineResults,
  getCachedMachineResults,
  computeMachineResultsForPartialDays,
  combineMachineResults,
  computeOperatorResults,
  buildMachineStatusFromDailyTotals,
  buildMachineOEEFromDailyTotals,
  buildItemTotalsFromCache,
  buildCountTotalsFromDailyTotals,
  buildTopOperatorEfficiencyFromCache,
  buildTopOperatorEfficiencyFromSessions,
  previousDateStr,
  MACHINE_GROUP_DEPARTMENTS,
} = require("../../utils/dashboardFunctions");
const {
  projectSessionForPerf,
  projectMachineForPerf,
  queryOperatorTimeframes,
  queryMachineTimeframes,
  extractCountsFromSessions,
  getValidAndMisfeedCountsInWindow,
  sumWindowWithCounts,
  sumWindowMachine,
  resolveBatchItemFromSessions,
  buildZeroEfficiencyPayload,
} = require("../../utils/sessionFunctions");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");
const {
  getLiveProductiveWindowMs,
  liveAvailabilityRatioFromRuntimeSec,
  liveAvailabilityRatioFromMs,
} = require("../../utils/availabilityLive");
const {
  getPercentBreakpointColor,
  getOePercentBreakpointColor
} = require("../../utils/percentBreakpoints");
const {
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
} = require("../../utils/operatorDashboardCache");

async function resolveShiftIdString(req, db) {
  const raw = req.query.shiftId;
  if (!raw) return null;
  let oid;
  try {
    oid = new ObjectId(String(raw));
  } catch (e) {
    const err = new Error("Invalid shiftId");
    err.statusCode = 400;
    throw err;
  }
  const doc = await db.collection(config.shiftCollectionName).findOne({ _id: oid });
  if (!doc) {
    const err = new Error("Shift not found");
    err.statusCode = 404;
    throw err;
  }
  return String(oid);
}

async function resolveShift(req, db) {
  const raw = req.query.shiftId;
  if (!raw) return null;
  let shiftOid;
  try {
    shiftOid = new ObjectId(String(raw));
  } catch (e) {
    const err = new Error("Invalid shiftId");
    err.statusCode = 400;
    throw err;
  }
  const shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
  if (!shiftDoc) {
    const err = new Error("Shift not found");
    err.statusCode = 404;
    throw err;
  }
  return { shiftOid, shiftDoc };
}

function buildMachineGroupDailyFilter(dateStr, serial) {
  const dayStart = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const dailyFilter = {
    $or: [
      { entityType: "machine", date: dateStr },
      {
        type: "machine",
        "timestamps.start": { $gte: dayStart.toUTC().toISO(), $lt: dayEnd.toUTC().toISO() },
      },
      {
        type: "machine",
        "timestamps.start": { $gte: dayStart.toUTC().toJSDate(), $lt: dayEnd.toUTC().toJSDate() },
      },
      { type: "machine", id: { $regex: `-${dateStr}$` } },
    ],
  };

  if (!serial) return dailyFilter;
  const serialNumber = parseInt(serial);
  return {
    $and: [
      dailyFilter,
      {
        $or: [
          { machineSerial: serialNumber },
          { "machine.serial": serialNumber },
          { "machine.id": serialNumber },
        ],
      },
    ],
  };
}

async function buildMachineDepartmentLookup(db) {
  const machines = await db
    .collection(config.machineCollectionName)
    .find({})
    .project({ id: 1, serial: 1, name: 1, groups: 1 })
    .toArray();
  const lookup = new Map();
  for (const machine of machines) {
    const department = machine.groups?.department;
    if (!department) continue;
    for (const key of [machine.id, machine.serial, machine.name]) {
      if (key != null) lookup.set(String(key), department);
    }
  }
  return lookup;
}

function getMachineDepartment(record, departmentLookup) {
  const embeddedDepartment = record.machine?.groups?.department;
  if (embeddedDepartment) return embeddedDepartment;
  for (const key of [record.machineSerial, record.machine?.serial, record.machine?.id, record.machine?.name]) {
    if (key != null && departmentLookup.has(String(key))) return departmentLookup.get(String(key));
  }
  return null;
}

function getDailyMachineMetric(record, topLevelKey, totalsKey) {
  return record[topLevelKey] ?? record.totals?.[totalsKey] ?? 0;
}

function buildDailySummaryItemRows(itemTotals) {
  const normalizePPH = (std) => {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  };

  const resultsMap = new Map();
  for (const itemTotal of itemTotals) {
    const itemId = String(itemTotal.itemId);
    if (!resultsMap.has(itemId)) {
      resultsMap.set(itemId, {
        itemId: itemTotal.itemId,
        itemName: itemTotal.itemName || "Unknown",
        standardRaw: itemTotal.itemStandard ?? 0,
        count: 0,
        workedSec: 0,
      });
    }

    const acc = resultsMap.get(itemId);
    acc.count += itemTotal.totalCounts || 0;
    acc.workedSec += (itemTotal.workedTimeMs || 0) / 1000;
  }

  return Array.from(resultsMap.values()).map((entry) => {
    const workedMs = Math.round(entry.workedSec * 1000);
    const hours = workedMs / 3600000;
    const pph = hours > 0 ? entry.count / hours : 0;
    const stdPPH = normalizePPH(entry.standardRaw);
    const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

    return {
      itemId: entry.itemId,
      itemName: entry.itemName,
      workedTimeFormatted: formatDuration(workedMs),
      count: entry.count,
      pph: Math.round(pph * 100) / 100,
      standard: entry.standardRaw ?? 0,
      efficiency: Math.round(efficiencyPct * 100) / 100,
    };
  });
}

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // ---------------------------------------------------------------------------
  // From daily-summary-dashboard: machines summary route.
  // GET /api/alpha/analytics/daily-summary-dashboard/machines
  // Returns machine results for the daily summary dashboard (hybrid cache/session).
  // ---------------------------------------------------------------------------
  router.get("/analytics/daily-summary-dashboard/machines", async (req, res) => {
    try {
      const started = Date.now();
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      if (req.query.shiftId) {
        let shiftIdStr;
        try {
          shiftIdStr = await resolveShiftIdString(req, db);
        } catch (e) {
          const code = e.statusCode || 400;
          return res.status(code).json({ error: e.message });
        }
        const sessionData = await getSessionDataForPartialDays(
          db,
          [{ start, end }],
          serial ? parseInt(serial, 10) : undefined,
          { shiftId: shiftIdStr }
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
          statusMap.set(id, {
            code: ticker.status?.code ?? ticker.status?.id ?? 0,
            name: ticker.status?.name || "Unknown",
            color: ticker.status?.color || ticker.status?.softrolColor || "None",
          });
        }
        const machineResults = (sessionData.machines || []).map((record) => {
          const serialNum = Number(record.machineSerial);
          const st = statusMap.get(serialNum) || { code: 0, name: "Unknown" };
          const runtimeMs = record.runtimeMs || 0;
          const totalCounts = record.totalCounts || 0;
          return {
            machine: { serial: serialNum, name: record.machineName || "Unknown" },
            currentStatus: st,
            performance: {
              output: { totalCount: totalCounts },
              oee: { percentage: 0 },
              runtime: { formatted: formatDuration(runtimeMs) },
            },
          };
        });
        return res.json({
          timeRange: { start, end, total: formatDuration(Date.now() - started) },
          machineResults,
        });
      }

      const today = new Date();
      const todayDateStr = today.toISOString().split("T")[0];
      const startDateStr = exactStart.toISOString().split("T")[0];
      const endDateStr = exactEnd.toISOString().split("T")[0];
      const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;

      const startOfDayStart = new Date(exactStart);
      startOfDayStart.setHours(0, 0, 0, 0);
      const endOfDayEnd = new Date(exactEnd);
      endOfDayEnd.setHours(23, 59, 59, 999);
      const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
      const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
      const isSameDay = startDateStr === endDateStr;
      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);

      if (isPartialDay && !isToday) {
        const machineResults = await computeMachineResults(
          db,
          start,
          end,
          serial ? parseInt(serial) : undefined
        );
        return res.json({
          timeRange: { start, end, total: formatDuration(Date.now() - started) },
          machineResults,
        });
      }

      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;

      let machineResults = [];

      if (useHybrid) {
        const { completeDays, partialDays } = splitTimeRangeForHybrid(
          exactStart,
          exactEnd
        );

        const today2 = new Date();
        const todayDateStr2 = today2.toISOString().split("T")[0];

        const partialDaysToday = [];
        const partialDaysNotToday = [];

        for (const partialDay of partialDays) {
          const partialDayDateStr = new Date(
            partialDay.start
          ).toISOString().split("T")[0];
          if (partialDayDateStr === todayDateStr2) {
            partialDaysToday.push({
              dateStr: partialDayDateStr,
              start: new Date(partialDayDateStr + "T00:00:00.000Z"),
              end: new Date(partialDayDateStr + "T23:59:59.999Z"),
            });
          } else {
            partialDaysNotToday.push(partialDay);
          }
        }

        const daysForCache = [...completeDays, ...partialDaysToday];

        if (daysForCache.length > 0) {
          const cacheResults = await getCachedMachineResults(
            db,
            daysForCache,
            serial ? parseInt(serial) : undefined
          );
          machineResults = cacheResults;
        }

        if (partialDaysNotToday.length > 0) {
          const sessionResults = await computeMachineResultsForPartialDays(
            db,
            partialDaysNotToday,
            serial ? parseInt(serial) : undefined
          );
          machineResults = combineMachineResults(
            machineResults,
            sessionResults
          );
        }
      } else {
        const startDate = exactStart.toISOString().split("T")[0];
        const endDate = exactEnd.toISOString().split("T")[0];

        const daysForCache = [
          {
            dateStr: startDate,
            start: startOfDayStart,
            end: endOfDayEnd,
          },
        ];

        machineResults = await getCachedMachineResults(
          db,
          daysForCache,
          serial ? parseInt(serial) : undefined
        );
      }

      res.json({
        timeRange: { start, end, total: formatDuration(Date.now() - started) },
        machineResults,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate machines summary" });
    }
  });

  // ---------------------------------------------------------------------------
  // From daily-summary-dashboard: operators summary route.
  // GET /api/alpha/analytics/daily-summary-dashboard/operators
  // Returns operator results for the daily summary dashboard (hybrid cache/session).
  // ---------------------------------------------------------------------------
  router.get("/analytics/daily-summary-dashboard/operators", async (req, res) => {
    try {
      const started = Date.now();
      const { start, end } = parseAndValidateQueryParams(req);

      if (req.query.shiftId) {
        let resolvedShift;
        try {
          resolvedShift = await resolveShift(req, db);
        } catch (e) {
          const code = e.statusCode || 400;
          return res.status(code).json({ error: e.message });
        }
        const result = await buildOperatorSummaryFromShiftCache(
          db,
          logger,
          config,
          { ...resolvedShift, start, end }
        );
        return res.json({
          timeRange: { start, end, total: formatDuration(Date.now() - started) },
          operatorResults: result.data,
        });
      }

      const result = await buildOperatorSummaryFromDailyCache(db, logger, config, {
        start,
        end,
      });
      const operatorResults = result.found
        ? result.data
        : await computeOperatorResults(db, start, end);

      res.json({
        timeRange: { start, end, total: formatDuration(Date.now() - started) },
        operatorResults,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate operators summary" });
    }
  });

  // ---------------------------------------------------------------------------
  // From daily-summary-dashboard: items summary route.
  // GET /api/alpha/analytics/daily-summary-dashboard/items
  // Returns item results for the daily summary dashboard (hybrid cache/session).
  // ---------------------------------------------------------------------------
  router.get("/analytics/daily-summary-dashboard/items", async (req, res) => {
    try {
      const started = Date.now();
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const today = new Date();
      const todayDateStr = today.toISOString().split("T")[0];
      const startDateStr = exactStart.toISOString().split("T")[0];
      const endDateStr = exactEnd.toISOString().split("T")[0];
      const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;

      const startOfDayStart = new Date(exactStart);
      startOfDayStart.setHours(0, 0, 0, 0);
      const endOfDayEnd = new Date(exactEnd);
      endOfDayEnd.setHours(23, 59, 59, 999);
      const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
      const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
      const isSameDay = startDateStr === endDateStr;
      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);

      if (isPartialDay && !isToday) {
        const sessionData = await getItemsSessionDataForPartialDays(
          [{ start: exactStart, end: exactEnd }],
          db,
          logger
        );
        const items = buildDailySummaryItemRows(sessionData);
        return res.json({
          timeRange: { start, end, total: formatDuration(Date.now() - started) },
          items,
        });
      }

      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;

      let items = [];

      if (useHybrid) {
        const { completeDays, partialDays } = splitTimeRangeForHybridItems(
          exactStart,
          exactEnd
        );

        const partialDaysToday = [];
        const partialDaysNotToday = [];

        for (const partialDay of partialDays) {
          const partialDayDateStr = new Date(
            partialDay.start
          ).toISOString().split("T")[0];
          if (partialDayDateStr === todayDateStr) {
            partialDaysToday.push({
              dateStr: partialDayDateStr,
              start: new Date(partialDayDateStr + "T00:00:00.000Z"),
              end: new Date(partialDayDateStr + "T23:59:59.999Z"),
            });
          } else {
            partialDaysNotToday.push(partialDay);
          }
        }

        const daysForCache = [...completeDays, ...partialDaysToday];

        if (daysForCache.length > 0) {
          items = await getItemsCachedDataForDays(daysForCache, db);
        }

        if (partialDaysNotToday.length > 0) {
          const sessionResults = await getItemsSessionDataForPartialDays(
            partialDaysNotToday,
            db,
            logger
          );
          items = combineItemsHybridData(items, sessionResults, logger);
        }
      } else {
        const startDate = exactStart.toISOString().split("T")[0];
        const daysForCache = [
          {
            dateStr: startDate,
            start: startOfDayStart,
            end: endOfDayEnd,
          },
        ];

        items = await getItemsCachedDataForDays(daysForCache, db);
      }

      if (serial) {
        const targetSerial = parseInt(serial, 10);
        items = items.filter((item) => {
          const machineSerial = item.machineSerial ?? item.machine?.serial ?? item.machine?.id;
          return machineSerial == null || Number(machineSerial) === targetSerial;
        });
      }

      res.json({
        timeRange: { start, end, total: formatDuration(Date.now() - started) },
        items: buildDailySummaryItemRows(items),
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate items summary" });
    }
  });

  // -------- Daily-dashboard (6 charts) routes --------

  router.get("/analytics/daily/machine-status-cache", async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf("day").toJSDate();
      const dayEnd = now.toJSDate();
      const machineStatus = await buildMachineStatusFromDailyTotals(db, dayStart, dayEnd, logger);
      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineStatus,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast machine status data" });
    }
  });

  router.get("/analytics/daily/machine-oee", async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf("day").toJSDate();
      const dayEnd = now.toJSDate();
      const machineOee = await buildMachineOEEFromDailyTotals(db, dayStart, dayEnd, logger);
      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        machineOee,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch machine OEE data" });
    }
  });

  router.get("/analytics/hourly/item-totals-by-type", async (req, res) => {
    try {
      let dayStart, dayEnd;
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        dayStart = new Date(start);
        dayEnd = new Date(end);
      } catch (err) {
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        dayStart = now.startOf("day").toJSDate();
        dayEnd = now.toJSDate();
      }
      const itemTotals = await buildItemTotalsFromCache(db, dayStart, dayEnd, logger);
      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        itemTotals,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch item totals by type from cache" });
    }
  });

  router.get("/analytics/daily/count-totals-cache", async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayEnd = now.toJSDate();
      const dailyCounts = await buildCountTotalsFromDailyTotals(db, dayEnd, logger);
      return res.json({
        timeRange: { end: dayEnd },
        dailyCounts,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast daily count totals data" });
    }
  });

  router.get("/analytics/daily/top-operators-cache", async (req, res) => {
    try {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const dayStart = now.startOf("day").toJSDate();
      const dayEnd = now.toJSDate();
      let topOperators = await buildTopOperatorEfficiencyFromCache(db, dayStart, dayEnd, logger);
      if (topOperators.length === 0 || topOperators.every((op) => op.efficiency === 0 && op.metrics.runtime.total === 0)) {
        topOperators = await buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd);
      }
      return res.json({
        timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
        topOperators,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch fast top operator data" });
    }
  });

  router.get("/analytics/machines-group-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const dateStr = start.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const yesterdayStr = previousDateStr(dateStr);

      const filter = buildMachineGroupDailyFilter(dateStr, serial);
      const filterYesterday = buildMachineGroupDailyFilter(yesterdayStr, serial);

      const [cacheRecords, yesterdayRecords, departmentLookup] = await Promise.all([
        db.collection(config.totalsDailyCollectionName).find(filter).toArray(),
        db.collection(config.totalsDailyCollectionName).find(filterYesterday).toArray(),
        buildMachineDepartmentLookup(db),
      ]);

      if (cacheRecords.length === 0) {
        const anyByDate = await db.collection(config.totalsDailyCollectionName).countDocuments(filter);
        const sampleDocs = await db
          .collection(config.totalsDailyCollectionName)
          .find({})
          .limit(3)
          .project({ date: 1, entityType: 1, type: 1, machineSerial: 1, "machine.serial": 1, "machine.groups.department": 1, timestamps: 1 })
          .toArray();
        const debug = {
          reason: "no_cached_data_for_date",
          message: `No daily cached data for the requested date (${dateStr}). Totals may not have been built yet for this date.`,
          details: { requestedDate: dateStr, totalsDailyCountForDate: anyByDate, sampleDocsInCollection: sampleDocs },
        };
        return res.json({ data: [], debug });
      }

      const rangeStart = new Date(start);
      const rangeEnd = new Date(end);
      const activeShifts = await loadActiveShifts(db).catch(() => []);
      const shiftElapsedMs = computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);

      const byDept = new Map();
      for (const name of MACHINE_GROUP_DEPARTMENTS) byDept.set(name, []);
      let skippedNoDept = 0;
      let skippedUnknownDept = 0;
      for (const record of cacheRecords) {
        const dept = getMachineDepartment(record, departmentLookup);
        if (!dept) {
          skippedNoDept++;
          continue;
        }
        if (!byDept.has(dept)) {
          skippedUnknownDept++;
          continue;
        }
        byDept.get(dept).push(record);
      }

      const byDeptYesterday = new Map();
      for (const name of MACHINE_GROUP_DEPARTMENTS) byDeptYesterday.set(name, []);
      for (const record of yesterdayRecords) {
        const dept = getMachineDepartment(record, departmentLookup);
        if (!dept || !byDeptYesterday.has(dept)) continue;
        byDeptYesterday.get(dept).push(record);
      }

      const data = [];
      for (const departmentName of MACHINE_GROUP_DEPARTMENTS) {
        const records = byDept.get(departmentName);
        if (!records || records.length === 0) continue;

        let sumRuntimeMs = 0;
        let sumTotalCounts = 0;
        let sumTotalMisfeeds = 0;
        let sumTotalTimeCreditMs = 0;
        let sumWorkedTimeMs = 0;
        for (const record of records) {
          const runtimeMs = getDailyMachineMetric(record, "runtimeMs", "runtimeMs");
          const totalTimeCreditMs = getDailyMachineMetric(record, "totalTimeCreditMs", "timeCreditMs");
          sumRuntimeMs += runtimeMs;
          sumTotalCounts += getDailyMachineMetric(record, "totalCounts", "count");
          sumTotalMisfeeds += getDailyMachineMetric(record, "totalMisfeeds", "misfeeds");
          sumTotalTimeCreditMs += totalTimeCreditMs;
          let workMs = getDailyMachineMetric(record, "workedTimeMs", "workedTimeMs");
          if (workMs === 0 && totalTimeCreditMs > 0 && runtimeMs > 0) workMs = runtimeMs;
          sumWorkedTimeMs += workMs;
        }

        const downtimeMs = Math.max(shiftElapsedMs - sumRuntimeMs, 0);
        const availability =
          shiftElapsedMs > 0
            ? Math.min(Math.max(sumRuntimeMs / shiftElapsedMs, 0), 1)
            : 0;
        const totalOutput = sumTotalCounts + sumTotalMisfeeds;
        const throughput = totalOutput > 0 ? sumTotalCounts / totalOutput : 0;
        const workTimeSec = sumWorkedTimeMs / 1000;
        const totalTimeCreditSec = sumTotalTimeCreditMs / 1000;
        const efficiency = workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
        const oee = availability * throughput * efficiency;

        let efficiencyPreviousDay = null;
        const recordsYesterday = byDeptYesterday.get(departmentName);
        if (recordsYesterday && recordsYesterday.length > 0) {
          let sumWorkedMsY = 0;
          let sumTimeCreditMsY = 0;
          for (const rec of recordsYesterday) {
            const runtimeMs = getDailyMachineMetric(rec, "runtimeMs", "runtimeMs");
            const totalTimeCreditMs = getDailyMachineMetric(rec, "totalTimeCreditMs", "timeCreditMs");
            sumTimeCreditMsY += totalTimeCreditMs;
            let w = getDailyMachineMetric(rec, "workedTimeMs", "workedTimeMs");
            if (w === 0 && totalTimeCreditMs > 0 && runtimeMs > 0) w = runtimeMs;
            sumWorkedMsY += w;
          }
          const workTimeSecY = sumWorkedMsY / 1000;
          const totalTimeCreditSecY = sumTimeCreditMsY / 1000;
          if (workTimeSecY > 0) {
            const effY = totalTimeCreditSecY / workTimeSecY;
            efficiencyPreviousDay = { value: effY, percentage: (effY * 100).toFixed(2) };
          }
        }

        data.push({
          machine: { name: departmentName },
          metrics: {
            runtime: { total: sumRuntimeMs, formatted: formatDuration(sumRuntimeMs) },
            downtime: { total: downtimeMs, formatted: formatDuration(downtimeMs) },
            output: { totalCount: sumTotalCounts, misfeedCount: sumTotalMisfeeds },
            performance: {
              availability: { value: availability, percentage: (availability * 100).toFixed(2) },
              throughput: { value: throughput, percentage: (throughput * 100).toFixed(2) },
              efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) },
              oee: { value: oee, percentage: (oee * 100).toFixed(2) },
            },
          },
          timeRange: { start: rangeStart, end: rangeEnd },
          efficiencyPreviousDay,
        });
      }

      if (data.length === 0 && cacheRecords.length > 0) {
        const debug = {
          reason: "all_records_skipped_no_matching_department",
          message: `Found ${cacheRecords.length} cache record(s) for ${dateStr} but none matched known machine groups (departments). Skipped: ${skippedNoDept} with no department, ${skippedUnknownDept} with unknown department.`,
          details: {
            requestedDate: dateStr,
            cacheRecordsCount: cacheRecords.length,
            skippedNoDepartment: skippedNoDept,
            skippedUnknownDepartment: skippedUnknownDept,
            knownDepartments: MACHINE_GROUP_DEPARTMENTS,
          },
        };
        return res.json({ data: [], debug });
      }
      return res.json(data);
    } catch (err) {
      logger.error(`Error in machines-group-summary-daily-cached:`, err);
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

  // ---------------------------------------------------------------------------
  // For efficiency screen: daily machine live session summary.
  // GET /api/alpha/analytics/daily/machine-live-session-summary
  // Returns flipper data (per-operator efficiency/OEE for 6m, 15m, 1h, today) using
  // sessions for short windows and totals-daily for today. Query: ?serial=<machineSerial>
  // ---------------------------------------------------------------------------
  router.get("/analytics/daily/machine-live-session-summary", async (req, res) => {
    const routeStartTime = Date.now();
    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: "Missing serial" });
      }

      const serialNum = Number(serial);
      const ticker = await db
        .collection(config.stateTickerCollectionName)
        .findOne(
          { "machine.id": serialNum },
          { projection: { timestamp: 1, machine: 1, program: 1, status: 1, operators: 1 } }
        );

      if (!ticker) {
        const machineConfig = await db.collection(config.machineCollectionName).findOne(
          { $or: [{ id: serialNum }, { serial: serialNum }] },
          { projection: { name: 1 } }
        );
        const machineName = machineConfig?.name || `Serial ${serialNum}`;
        const offlineLanes = [
          {
            status: -1,
            fault: "Offline",
            operator: null,
            operatorId: null,
            machine: machineName,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: "", run: "" },
            efficiency: buildZeroEfficiencyPayload(),
            oee: buildZeroEfficiencyPayload(),
            batch: { item: "", code: 0 },
          },
        ];
        return res.json({ flipperData: offlineLanes });
      }

      const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .filter((op) => op && op.id !== -1)
        .filter((op) => !([67801, 67802].includes(serialNum) && op.station === 2));

      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const todayDateStr = now.toFormat("yyyy-MM-dd");

      if (statusCode !== 1) {
        const performanceData = await Promise.all(
          onMachineOperators.map(async (op) => {
            const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
            const operatorName = formatHumanName(op.name);
            return {
              status: statusCode,
              fault: ticker.status?.name ?? "Unknown",
              operator: operatorName,
              operatorId: op.id,
              machine: ticker.machine?.name || `Serial ${serialNum}`,
              timers: { on: 0, ready: 0 },
              displayTimers: { on: "", run: "" },
              efficiency: buildZeroEfficiencyPayload(),
              oee: buildZeroEfficiencyPayload(),
              batch: { item: batchItem, code: 10000001 },
            };
          })
        );
        return res.json({ flipperData: performanceData });
      }

      const activeShifts = await loadActiveShifts(db);

      const shortFrames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: "Last 6 Mins" },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: "Last 15 Mins" },
        lastHour: { start: now.minus({ hours: 1 }), label: "Last Hour" },
      };

      const dailyTotals = await db
        .collection(config.totalsDailyCollectionName)
        .find({
          entityType: "operator-machine",
          machineSerial: serialNum,
          date: todayDateStr,
        })
        .toArray();

      const dailyTotalsMap = new Map();
      for (const total of dailyTotals) {
        if (total.operatorId) dailyTotalsMap.set(total.operatorId, total);
      }

      const todayProductiveMs = getLiveProductiveWindowMs(
        activeShifts,
        now.startOf("day").toJSDate(),
        now.toJSDate()
      );

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op) => {
          const shortFramesWithToday = {
            ...shortFrames,
            today: { start: now.startOf("day"), label: "All Day" },
          };

          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday, logger);

          const hasEmpty = Object.values({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour,
          }).some((arr) => arr.length === 0);

          if (hasEmpty) {
            const open = await db
              .collection(config.operatorSessionCollectionName)
              .findOne(
                {
                  "operator.id": op.id,
                  $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }],
                  "timestamps.end": { $exists: false },
                },
                { sort: { "timestamps.start": -1 }, projection: projectSessionForPerf() }
              );
            if (open) {
              results.lastSixMinutes = [open];
              results.lastFifteenMinutes = [open];
              results.lastHour = [open];
            }
          }

          const efficiencyObj = {};
          const oeeObj = {};

          for (const [key, arr] of Object.entries({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour,
          })) {
            const { start, label } = shortFrames[key];
            const windowStart = new Date(start.toISO());
            const windowEnd = new Date(now.toISO());

            const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
            const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
            const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;

            efficiencyObj[key] = {
              value: Math.round(eff * 100),
              label,
              color: getPercentBreakpointColor(eff, config),
            };

            const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(
              arr,
              windowStart,
              windowEnd,
              op.id,
              serialNum
            );
            const productiveSec =
              getLiveProductiveWindowMs(activeShifts, windowStart, windowEnd) / 1000;
            const availability = liveAvailabilityRatioFromRuntimeSec(runtimeSec, productiveSec);
            const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            const throughput = validCount + misfeedCount > 0 ? validCount / (validCount + misfeedCount) : 0;
            const oeeVal = availability * efficiencyRatio * throughput;
            oeeObj[key] = {
              value: Math.round(oeeVal * 100),
              label,
              color: getOePercentBreakpointColor(oeeVal, config),
            };
          }

          const dailyTotal = dailyTotalsMap.get(op.id);
          let todayEfficiency = 0;
          let todayOee = 0;

          if (dailyTotal && dailyTotal.runtimeMs > 0) {
            const runtimeSec = dailyTotal.runtimeMs / 1000;
            const timeCreditSec = (dailyTotal.totalTimeCreditMs || 0) / 1000;
            todayEfficiency = timeCreditSec / runtimeSec;
            const availability = liveAvailabilityRatioFromMs(dailyTotal.runtimeMs, todayProductiveMs);
            const totalCounts = dailyTotal.totalCounts || 0;
            const totalMisfeeds = dailyTotal.totalMisfeeds || 0;
            const throughput =
              totalCounts + totalMisfeeds > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
            todayOee = availability * todayEfficiency * throughput;
          }

          efficiencyObj.today = {
            value: Math.round(todayEfficiency * 100),
            label: "All Day",
            color: getPercentBreakpointColor(todayEfficiency, config),
          };
          oeeObj.today = {
            value: Math.round(todayOee * 100),
            label: "All Day",
            color: getOePercentBreakpointColor(todayOee, config),
          };

          const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
          const operatorName = formatHumanName(op.name);
          const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;

          return {
            status: statusCodeForResponse,
            fault: ticker.status?.name ?? "Unknown",
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: "", run: "" },
            efficiency: efficiencyObj,
            oee: oeeObj,
            batch: { item: batchItem, code: 10000001 },
          };
        })
      );

      return res.json({ flipperData: performanceData });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // For efficiency screen: machine-wide live session summary.
  // GET /api/alpha/analytics/machine-live-session-summary/machine
  // Returns flipper data (per-operator efficiency/OEE for 6m, 15m, 1h, today).
  // Query: ?serial=<machineSerial>
  // ---------------------------------------------------------------------------
  router.get("/analytics/machine-live-session-summary/machine", async (req, res) => {
    try {
      const { serial } = req.query;
      if (!serial) {
        return res.status(400).json({ error: "Missing serial" });
      }

      const serialNum = Number(serial);
      const ticker = await db
        .collection(config.stateTickerCollectionName)
        .findOne(
          { "machine.id": serialNum },
          { projection: { timestamp: 1, machine: 1, program: 1, status: 1, operators: 1 } }
        );

      if (!ticker) {
        const machineConfig = await db.collection(config.machineCollectionName).findOne(
          { $or: [{ id: serialNum }, { serial: serialNum }] },
          { projection: { name: 1 } }
        );
        const machineName = machineConfig?.name || `Serial ${serialNum}`;
        const offlineLanes = [
          {
            status: -1,
            fault: "Offline",
            operator: null,
            operatorId: null,
            machine: machineName,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: "", run: "" },
            efficiency: buildZeroEfficiencyPayload(),
            oee: buildZeroEfficiencyPayload(),
            batch: { item: "", code: 0 },
          },
        ];
        return res.json({ flipperData: offlineLanes });
      }

      const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
        .filter((op) => op && op.id !== -1)
        .filter((op) => !([67801, 67802].includes(serialNum) && op.station === 2));

      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const todayDateStr = now.toFormat("yyyy-MM-dd");

      if (statusCode !== 1) {
        const performanceData = await Promise.all(
          onMachineOperators.map(async (op) => {
            const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
            const operatorName = formatHumanName(op.name);
            return {
              status: statusCode,
              fault: ticker.status?.name ?? "Unknown",
              operator: operatorName,
              operatorId: op.id,
              machine: ticker.machine?.name || `Serial ${serialNum}`,
              timers: { on: 0, ready: 0 },
              displayTimers: { on: "", run: "" },
              efficiency: buildZeroEfficiencyPayload(),
              oee: buildZeroEfficiencyPayload(),
              batch: { item: batchItem, code: 10000001 },
            };
          })
        );
        return res.json({ flipperData: performanceData });
      }

      const activeShifts = await loadActiveShifts(db);

      const shortFrames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: "Last 6 Mins" },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: "Last 15 Mins" },
        lastHour: { start: now.minus({ hours: 1 }), label: "Last Hour" },
      };

      const dailyTotals = await db
        .collection(config.totalsDailyCollectionName)
        .find({
          entityType: "operator-machine",
          machineSerial: serialNum,
          date: todayDateStr,
        })
        .toArray();

      const dailyTotalsMap = new Map();
      for (const total of dailyTotals) {
        if (total.operatorId) dailyTotalsMap.set(total.operatorId, total);
      }

      const todayProductiveMs = getLiveProductiveWindowMs(
        activeShifts,
        now.startOf("day").toJSDate(),
        now.toJSDate()
      );

      const performanceData = await Promise.all(
        onMachineOperators.map(async (op) => {
          const shortFramesWithToday = {
            ...shortFrames,
            today: { start: now.startOf("day"), label: "All Day" },
          };

          const results = await queryOperatorTimeframes(db, serialNum, op.id, shortFramesWithToday, logger);

          const hasEmpty = Object.values({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour,
          }).some((arr) => arr.length === 0);

          if (hasEmpty) {
            const open = await db
              .collection(config.operatorSessionCollectionName)
              .findOne(
                {
                  "operator.id": op.id,
                  $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }],
                  "timestamps.end": { $exists: false },
                },
                { sort: { "timestamps.start": -1 }, projection: projectSessionForPerf() }
              );
            if (open) {
              results.lastSixMinutes = [open];
              results.lastFifteenMinutes = [open];
              results.lastHour = [open];
            }
          }

          const efficiencyObj = {};
          const oeeObj = {};

          for (const [key, arr] of Object.entries({
            lastSixMinutes: results.lastSixMinutes,
            lastFifteenMinutes: results.lastFifteenMinutes,
            lastHour: results.lastHour,
          })) {
            const { start, label } = shortFrames[key];
            const windowStart = new Date(start.toISO());
            const windowEnd = new Date(now.toISO());

            const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
            const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
            const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;

            efficiencyObj[key] = {
              value: Math.round(eff * 100),
              label,
              color: getPercentBreakpointColor(eff, config),
            };

            const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(
              arr,
              windowStart,
              windowEnd,
              op.id,
              serialNum
            );
            const productiveSec =
              getLiveProductiveWindowMs(activeShifts, windowStart, windowEnd) / 1000;
            const availability = liveAvailabilityRatioFromRuntimeSec(runtimeSec, productiveSec);
            const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
            const throughput = validCount + misfeedCount > 0 ? validCount / (validCount + misfeedCount) : 0;
            const oeeVal = availability * efficiencyRatio * throughput;
            oeeObj[key] = {
              value: Math.round(oeeVal * 100),
              label,
              color: getOePercentBreakpointColor(oeeVal, config),
            };
          }

          const dailyTotal = dailyTotalsMap.get(op.id);
          let todayEfficiency = 0;
          let todayOee = 0;

          if (dailyTotal && dailyTotal.runtimeMs > 0) {
            const runtimeSec = dailyTotal.runtimeMs / 1000;
            const timeCreditSec = (dailyTotal.totalTimeCreditMs || 0) / 1000;
            todayEfficiency = timeCreditSec / runtimeSec;
            const availability = liveAvailabilityRatioFromMs(dailyTotal.runtimeMs, todayProductiveMs);
            const totalCounts = dailyTotal.totalCounts || 0;
            const totalMisfeeds = dailyTotal.totalMisfeeds || 0;
            const throughput =
              totalCounts + totalMisfeeds > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
            todayOee = availability * todayEfficiency * throughput;
          }

          efficiencyObj.today = {
            value: Math.round(todayEfficiency * 100),
            label: "All Day",
            color: getPercentBreakpointColor(todayEfficiency, config),
          };
          oeeObj.today = {
            value: Math.round(todayOee * 100),
            label: "All Day",
            color: getOePercentBreakpointColor(todayOee, config),
          };

          const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
          const operatorName = formatHumanName(op.name);
          const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;

          return {
            status: statusCodeForResponse,
            fault: ticker.status?.name ?? "Unknown",
            operator: operatorName,
            operatorId: op.id,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: "", run: "" },
            efficiency: efficiencyObj,
            oee: oeeObj,
            batch: { item: batchItem, code: 10000001 },
          };
        })
      );

      return res.json({ flipperData: performanceData });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // Per-station operator efficiency (efficiency screen column widget).
  // GET /api/dashboard/analytics/machine-live-session-summary/operator
  // Query: ?serial=&station=
  // ---------------------------------------------------------------------------
  router.get("/analytics/machine-live-session-summary/operator", async (req, res) => {
    try {
      const { serial, station } = req.query;
      if (!serial || !station) {
        return res.status(400).json({ error: "Missing serial or station" });
      }
      const serialNum = Number(serial);
      const stationNum = Number(station);

      const ticker = await db
        .collection(config.stateTickerCollectionName)
        .findOne(
          { "machine.id": serialNum },
          { projection: { timestamp: 1, machine: 1, program: 1, status: 1, operators: 1 } }
        );

      if (!ticker) {
        const machineConfig = await db.collection(config.machineCollectionName).findOne(
          { $or: [{ id: serialNum }, { serial: serialNum }] },
          { projection: { name: 1 } }
        );
        const machineName = machineConfig?.name || `Serial ${serialNum}`;
        return res.json({
          status: -1,
          fault: "Offline",
          operator: null,
          machine: machineName,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: "", run: "" },
          efficiency: buildZeroEfficiencyPayload(),
          oee: buildZeroEfficiencyPayload(),
          batch: { item: "", code: 10000001 },
        });
      }

      const blockedStation = [67801, 67802].includes(serialNum) && stationNum === 2;
      const operator = (Array.isArray(ticker.operators) ? ticker.operators : []).find(
        (op) => op && op.station === stationNum
      );
      const hasOperator = !!operator && operator.id !== -1 && !blockedStation;
      const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;

      if (!hasOperator) {
        if (statusCode !== 1) {
          return res.json({
            status: statusCode,
            fault: ticker.status?.name ?? "Unknown",
            operator: null,
            machine: ticker.machine?.name || `Serial ${serialNum}`,
            timers: { on: 0, ready: 0 },
            displayTimers: { on: "", run: "" },
            efficiency: buildZeroEfficiencyPayload(),
            oee: buildZeroEfficiencyPayload(),
            batch: { item: "", code: 10000001 },
          });
        }

        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        const frames = {
          lastSixMinutes: { start: now.minus({ minutes: 6 }), label: "Last 6 Mins" },
          lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: "Last 15 Mins" },
          lastHour: { start: now.minus({ hours: 1 }), label: "Last Hour" },
          today: { start: now.startOf("day"), label: "All Day" },
        };

        let results = await queryMachineTimeframes(db, serialNum, frames);
        if (Object.values(results).some((arr) => arr.length === 0)) {
          const open = await db
            .collection(config.machineSessionCollectionName)
            .findOne(
              {
                $or: [{ "machine.id": serialNum }, { "machine.serial": serialNum }],
                "timestamps.end": { $exists: false },
              },
              { sort: { "timestamps.start": -1 }, projection: projectMachineForPerf() }
            );
          if (open) {
            for (const k of Object.keys(results)) results[k] = [open];
          }
        }

        const effObj = {};
        for (const [key, arr] of Object.entries(results)) {
          const { start, label } = frames[key];
          const { runtimeSec, timeCreditSec } = sumWindowMachine(arr, start, now);
          const eff = runtimeSec > 0 ? Math.round((timeCreditSec / runtimeSec) * 100) : 0;
          effObj[key] = {
            value: eff,
            label,
            color: getPercentBreakpointColor(eff, config),
          };
        }

        const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
        return res.json({
          status: statusCodeForResponse,
          fault: ticker.status?.name ?? "Unknown",
          operator: null,
          machine: ticker.machine?.name || `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: "", run: "" },
          efficiency: effObj,
          oee: buildZeroEfficiencyPayload(),
          batch: { item: "", code: 10000001 },
        });
      }

      if (statusCode !== 1) {
        const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);
        const operatorName = formatHumanName(operator.name);
        return res.json({
          status: statusCode,
          fault: ticker.status?.name ?? "Unknown",
          operator: operatorName,
          operatorId: operator.id,
          machine: ticker.machine?.name || `Serial ${serialNum}`,
          timers: { on: 0, ready: 0 },
          displayTimers: { on: "", run: "" },
          efficiency: buildZeroEfficiencyPayload(),
          oee: buildZeroEfficiencyPayload(),
          batch: { item: batchItem, code: 10000001 },
        });
      }

      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const todayDateStr = now.toFormat("yyyy-MM-dd");
      const activeShifts = await loadActiveShifts(db);
      const todayProductiveMs = getLiveProductiveWindowMs(
        activeShifts,
        now.startOf("day").toJSDate(),
        now.toJSDate()
      );
      const shortFrames = {
        lastSixMinutes: { start: now.minus({ minutes: 6 }), label: "Last 6 Mins" },
        lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: "Last 15 Mins" },
        lastHour: { start: now.minus({ hours: 1 }), label: "Last Hour" },
      };
      const shortFramesWithToday = {
        ...shortFrames,
        today: { start: now.startOf("day"), label: "All Day" },
      };

      let results = await queryOperatorTimeframes(db, serialNum, operator.id, shortFramesWithToday, logger);

      const hasEmpty = Object.values({
        lastSixMinutes: results.lastSixMinutes,
        lastFifteenMinutes: results.lastFifteenMinutes,
        lastHour: results.lastHour,
      }).some((arr) => arr.length === 0);

      if (hasEmpty) {
        const open = await db
          .collection(config.operatorSessionCollectionName)
          .findOne(
            {
              "operator.id": operator.id,
              $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }],
              "timestamps.end": { $exists: false },
            },
            { sort: { "timestamps.start": -1 }, projection: projectSessionForPerf() }
          );
        if (open) {
          results.lastSixMinutes = [open];
          results.lastFifteenMinutes = [open];
          results.lastHour = [open];
        }
      }

      const efficiencyObj = {};
      const oeeObj = {};

      for (const [key, arr] of Object.entries({
        lastSixMinutes: results.lastSixMinutes,
        lastFifteenMinutes: results.lastFifteenMinutes,
        lastHour: results.lastHour,
      })) {
        const { start, label } = shortFrames[key];
        const windowStart = new Date(start.toISO());
        const windowEnd = new Date(now.toISO());

        const counts = extractCountsFromSessions(arr, windowStart, windowEnd, operator.id, serialNum);
        const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
        const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;

        efficiencyObj[key] = {
          value: Math.round(eff * 100),
          label,
          color: getPercentBreakpointColor(eff, config),
        };

        const { validCount, misfeedCount } = getValidAndMisfeedCountsInWindow(
          arr,
          windowStart,
          windowEnd,
          operator.id,
          serialNum
        );
        const productiveSec =
          getLiveProductiveWindowMs(activeShifts, windowStart, windowEnd) / 1000;
        const availability = liveAvailabilityRatioFromRuntimeSec(runtimeSec, productiveSec);
        const efficiencyRatio = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
        const throughput = validCount + misfeedCount > 0 ? validCount / (validCount + misfeedCount) : 0;
        const oeeVal = availability * efficiencyRatio * throughput;
        oeeObj[key] = {
          value: Math.round(oeeVal * 100),
          label,
          color: getOePercentBreakpointColor(oeeVal, config),
        };
      }

      const dailyTotal = await db.collection(config.totalsDailyCollectionName).findOne({
        entityType: "operator-machine",
        machineSerial: serialNum,
        date: todayDateStr,
        operatorId: operator.id,
      });

      let todayEfficiency = 0;
      let todayOee = 0;
      if (dailyTotal && dailyTotal.runtimeMs > 0) {
        const runtimeSec = dailyTotal.runtimeMs / 1000;
        const timeCreditSec = (dailyTotal.totalTimeCreditMs || 0) / 1000;
        todayEfficiency = timeCreditSec / runtimeSec;
        const availability = liveAvailabilityRatioFromMs(dailyTotal.runtimeMs, todayProductiveMs);
        const totalCounts = dailyTotal.totalCounts || 0;
        const totalMisfeeds = dailyTotal.totalMisfeeds || 0;
        const throughput =
          totalCounts + totalMisfeeds > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
        todayOee = availability * todayEfficiency * throughput;
      }

      efficiencyObj.today = {
        value: Math.round(todayEfficiency * 100),
        label: "All Day",
        color: getPercentBreakpointColor(todayEfficiency, config),
      };
      oeeObj.today = {
        value: Math.round(todayOee * 100),
        label: "All Day",
        color: getOePercentBreakpointColor(todayOee, config),
      };

      const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);
      const operatorName = formatHumanName(operator.name);
      const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;

      return res.json({
        status: statusCodeForResponse,
        fault: ticker.status?.name ?? "Unknown",
        operator: operatorName,
        operatorId: operator.id,
        machine: ticker.machine?.name || `Serial ${serialNum}`,
        timers: { on: 0, ready: 0 },
        displayTimers: { on: "", run: "" },
        efficiency: efficiencyObj,
        oee: oeeObj,
        batch: { item: batchItem, code: 10000001 },
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};

