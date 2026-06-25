const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const { formatDuration, SYSTEM_TIMEZONE } = require("./time");
const { loadActiveShifts, computeShiftElapsedMs } = require("./shiftElapsed");
const { getSessionDataForPartialDays } = require("./reportFunctions");

const TOTALS_SHIFT_COLLECTION = "totals-shift";

function plantNow() {
  return DateTime.now().setZone(SYSTEM_TIMEZONE);
}

function getPlantDateStr(input = new Date()) {
  const parsed = DateTime.fromJSDate(new Date(input), { zone: SYSTEM_TIMEZONE });
  return parsed.isValid ? parsed.toISODate() : plantNow().toISODate();
}

function getTodayRange(now = plantNow()) {
  const current = DateTime.isDateTime(now)
    ? now.setZone(SYSTEM_TIMEZONE)
    : DateTime.fromJSDate(new Date(now), { zone: SYSTEM_TIMEZONE });

  return {
    start: current.startOf("day").toJSDate(),
    end: current.toJSDate(),
    dateStr: current.toISODate(),
  };
}

function isValidShift(shift) {
  return (
    shift &&
    shift._id &&
    shift.startTime &&
    shift.endTime &&
    typeof shift.startTime.hour === "number" &&
    typeof shift.startTime.minute === "number" &&
    typeof shift.endTime.hour === "number" &&
    typeof shift.endTime.minute === "number"
  );
}

function shiftStart(shift, day) {
  return day.set({
    hour: Number(shift.startTime.hour),
    minute: Number(shift.startTime.minute),
    second: 0,
    millisecond: 0,
  });
}

function shiftEnd(shift, day) {
  return day.set({
    hour: Number(shift.endTime.hour),
    minute: Number(shift.endTime.minute),
    second: 0,
    millisecond: 0,
  });
}

async function resolveCurrentShiftContext(db, config, nowInput = new Date()) {
  const now = DateTime.fromJSDate(new Date(nowInput), { zone: SYSTEM_TIMEZONE });
  if (!now.isValid) return null;

  const shifts = await db
    .collection(config.shiftCollectionName)
    .find({ active: { $ne: false } })
    .toArray();

  const today = now.weekday;
  const todayShifts = shifts
    .filter(isValidShift)
    .filter((shift) => {
      const activeDays = Array.isArray(shift.activeDays) ? shift.activeDays : [];
      return activeDays.length === 0 || activeDays.includes(today);
    })
    .sort((a, b) => {
      const aMin = (a.startTime.hour * 60) + a.startTime.minute;
      const bMin = (b.startTime.hour * 60) + b.startTime.minute;
      return aMin - bMin;
    });

  if (!todayShifts.length) return null;

  const day = now.startOf("day");
  const activeShift = todayShifts.find((shift) => {
    const start = shiftStart(shift, day);
    const end = shiftEnd(shift, day);
    return now >= start && now < end;
  });

  if (activeShift) {
    return {
      shiftDoc: activeShift,
      shiftOid: new ObjectId(String(activeShift._id)),
      dateStr: now.toISODate(),
      start: shiftStart(activeShift, day).toJSDate(),
      end: now.toJSDate(),
      mode: "current",
    };
  }

  const previousShift = [...todayShifts]
    .reverse()
    .find((shift) => shiftStart(shift, day) <= now);

  if (!previousShift) return null;

  return {
    shiftDoc: previousShift,
    shiftOid: new ObjectId(String(previousShift._id)),
    dateStr: now.toISODate(),
    start: shiftStart(previousShift, day).toJSDate(),
    end: shiftEnd(previousShift, day).toJSDate(),
    mode: "previous",
  };
}

async function buildMachineSummaryRows(db, logger, config, records, activeShifts, requestStart, requestEnd, options = {}) {
  const useShiftElapsed = options.useShiftElapsed !== false;
  const shiftElapsedCache = new Map();
  const machineSerials = records.map((r) => Number(r.machineSerial)).filter(Number.isFinite);
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

  return records.map((record) => {
    const currentStatus = statusMap.get(Number(record.machineSerial)) || {
      code: 0,
      name: "Unknown",
    };

    const timeRange = record.buildRange || record.timeRange;
    const rangeStart = timeRange?.start ? new Date(timeRange.start) : new Date(requestStart);
    const rangeEnd = timeRange?.end ? new Date(timeRange.end) : new Date(requestEnd);
    const wallClockElapsedMs = Math.max(0, rangeEnd - rangeStart);
    let elapsedMs = wallClockElapsedMs;
    if (useShiftElapsed) {
      const shiftKey = `${rangeStart.getTime()}|${rangeEnd.getTime()}`;
      elapsedMs = shiftElapsedCache.has(shiftKey)
        ? shiftElapsedCache.get(shiftKey)
        : computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);
      shiftElapsedCache.set(shiftKey, elapsedMs);
    }

    const runtimeMs = record.runtimeMs || 0;
    const totalCounts = record.totalCounts || 0;
    const totalMisfeeds = record.totalMisfeeds || 0;
    const downtimeMs = Math.max(elapsedMs - runtimeMs, 0);
    const availability =
      elapsedMs > 0 ? Math.min(Math.max(runtimeMs / elapsedMs, 0), 1) : 0;
    const totalOutput = totalCounts + totalMisfeeds;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;
    const runtimeHours = runtimeMs / 3600000;
    const piecesPerHour = runtimeHours > 0 ? totalCounts / runtimeHours : 0;

    let workTimeMs = record.workedTimeMs || 0;
    if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && runtimeMs > 0) {
      workTimeMs = runtimeMs;
      if (logger) {
        logger.debug(
          `[machineSessions] Machine ${record.machineSerial}: workedTimeMs was 0, using runtimeMs ${workTimeMs}ms as fallback`
        );
      }
    }

    const efficiency = workTimeMs > 0 ? (record.totalTimeCreditMs || 0) / workTimeMs : 0;
    const oee = availability * throughput * efficiency;

    return {
      machine: {
        serial: record.machineSerial,
        name: record.machineName || `Serial ${record.machineSerial}`,
      },
      currentStatus,
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
          totalCount: totalCounts,
          misfeedCount: totalMisfeeds,
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
          piecesPerHour: {
            value: piecesPerHour,
            formatted: Math.round(piecesPerHour).toString(),
          },
          pph: piecesPerHour,
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
}

async function buildMachineSummaryFromSessions(db, logger, config, start, end, serial, shiftOid, shiftDoc) {
  const sessionData = await getSessionDataForPartialDays(
    db,
    [{ start, end }],
    serial ? parseInt(serial, 10) : undefined,
    { shiftId: String(shiftOid) }
  );

  const records = (sessionData.machines || []).map((record) => ({
    machineSerial: Number(record.machineSerial),
    machineName: record.machineName,
    runtimeMs: record.runtimeMs || 0,
    workedTimeMs: record.workedTimeMs || 0,
    totalCounts: record.totalCounts || 0,
    totalMisfeeds: record.totalMisfeeds || 0,
    totalTimeCreditMs: record.totalTimeCreditMs || record.workedTimeMs || 0,
    timeRange: { start, end },
  }));

  return buildMachineSummaryRows(db, logger, config, records, [shiftDoc], start, end);
}

async function buildMachineSummaryFromDailyCache(db, logger, config, options = {}) {
  const now = options.now || new Date();
  const { start, end, dateStr } = options.start && options.end
    ? {
        start: options.start,
        end: options.end,
        dateStr: options.dateStr || getPlantDateStr(options.start),
      }
    : getTodayRange(now);

  const filter = {
    entityType: "machine",
    date: dateStr,
  };
  if (options.serial) {
    filter.machineSerial = parseInt(options.serial, 10);
  }

  const records = await db.collection(config.totalsDailyCollectionName).find(filter).toArray();
  if (!records.length) {
    return {
      data: [],
      source: "totals-daily",
      found: false,
      dateStr,
      start,
      end,
      recordCount: 0,
    };
  }

  const activeShifts = await loadActiveShifts(db, {
    collectionName: config.shiftCollectionName,
  }).catch(() => []);

  return {
    data: await buildMachineSummaryRows(db, logger, config, records, activeShifts, start, end),
    source: "totals-daily",
    found: true,
    dateStr,
    start,
    end,
    recordCount: records.length,
  };
}

async function buildMachineSummaryFromShiftCache(db, logger, config, options) {
  const { shiftOid, shiftDoc, start, end } = options;
  const dateStr = options.dateStr || getPlantDateStr(start);
  const filter = {
    entityType: "machine",
    date: dateStr,
    shiftId: String(shiftOid),
  };
  if (options.serial) {
    filter.machineSerial = parseInt(options.serial, 10);
  }

  const records = await db.collection(TOTALS_SHIFT_COLLECTION).find(filter).toArray();
  if (records.length > 0) {
    return {
      data: await buildMachineSummaryRows(db, logger, config, records, [shiftDoc], start, end),
      source: TOTALS_SHIFT_COLLECTION,
      found: true,
      dateStr,
      start,
      end,
      shiftId: String(shiftOid),
      shift: shiftDoc,
      recordCount: records.length,
    };
  }

  return {
    data: await buildMachineSummaryFromSessions(db, logger, config, start, end, options.serial, shiftOid, shiftDoc),
    source: "session-machine",
    found: false,
    dateStr,
    start,
    end,
    shiftId: String(shiftOid),
    shift: shiftDoc,
    recordCount: 0,
  };
}

module.exports = {
  TOTALS_SHIFT_COLLECTION,
  getPlantDateStr,
  getTodayRange,
  resolveCurrentShiftContext,
  buildMachineSummaryRows,
  buildMachineSummaryFromSessions,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
};
