const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const { formatDuration, SYSTEM_TIMEZONE } = require("./time");
const { loadActiveShifts, computeShiftElapsedMs, resolveShiftProjectionWindow } = require("./shiftElapsed");
const { getSessionDataForPartialDays } = require("./reportFunctions");
const { calendarRange, normalizeTotalsDocument } = require("./totalsSchema");
const { getShiftTimeComponents, getShiftStartMinutes } = require("./shiftTimeComponents");
const { getMachineFaultTimeBySerial } = require("./faultTimeSummary");

const TOTALS_SHIFT_COLLECTION = "totals-shift";

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

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
  return Boolean(shift && shift._id && getShiftTimeComponents(shift));
}

function shiftStart(shift, day) {
  const components = getShiftTimeComponents(shift);
  return day.set({
    hour: Number(components.startTime.hour),
    minute: Number(components.startTime.minute),
    second: 0,
    millisecond: 0,
  });
}

function shiftEnd(shift, day) {
  const components = getShiftTimeComponents(shift);
  return day.set({
    hour: Number(components.endTime.hour),
    minute: Number(components.endTime.minute),
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
      const aMin = getShiftStartMinutes(a);
      const bMin = getShiftStartMinutes(b);
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
  const faultTimeBySerial = await getMachineFaultTimeBySerial(db, config, machineSerials, requestStart, requestEnd);
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
      color: ticker.status?.color || ticker.status?.softrolColor || "None",
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

    const runtimeMs = safeNumber(record.runtimeMs);
    const pausedTimeMs = safeNumber(record.pausedTimeMs);
    const cachedDownTimeMs = safeNumber(record.downTimeMs, null);
    const offlineTimeMs = safeNumber(record.offlineTimeMs);
    const faultTimeMs = faultTimeBySerial.get(Number(record.machineSerial)) ?? record.faultTimeMs ?? 0;
    const breakTimeMs = safeNumber(record.breakTimeMs);
    const productiveElapsedMs = Math.max(0, elapsedMs - breakTimeMs);
    const totalCounts = safeNumber(record.totalCounts);
    const totalMisfeeds = safeNumber(record.totalMisfeeds);
    const observedDownTimeMs = pausedTimeMs + safeNumber(faultTimeMs) + offlineTimeMs;
    const downtimeMs = cachedDownTimeMs !== null
      ? Math.max(0, cachedDownTimeMs)
      : observedDownTimeMs > 0
        ? observedDownTimeMs
        : Math.max(productiveElapsedMs - runtimeMs, 0);
    const availabilityDenominatorMs = downtimeMs > 0
      ? runtimeMs + downtimeMs
      : productiveElapsedMs;
    const availability =
      availabilityDenominatorMs > 0
        ? Math.min(Math.max(runtimeMs / availabilityDenominatorMs, 0), 1)
        : 0;
    const totalOutput = totalCounts + totalMisfeeds;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;
    const runtimeHours = runtimeMs / 3600000;
    const piecesPerHour = runtimeHours > 0 ? totalCounts / runtimeHours : 0;

    let workTimeMs = safeNumber(record.workedTimeMs);
    if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && runtimeMs > 0) {
      workTimeMs = runtimeMs;
      if (logger) {
        logger.debug(
          `[machineSessions] Machine ${record.machineSerial}: workedTimeMs was 0, using runtimeMs ${workTimeMs}ms as fallback`
        );
      }
    }

    const efficiency = workTimeMs > 0 ? safeNumber(record.totalTimeCreditMs) / workTimeMs : 0;
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
        pausedTime: {
          total: pausedTimeMs,
          formatted: formatDuration(pausedTimeMs),
        },
        downTime: {
          total: downtimeMs,
          formatted: formatDuration(downtimeMs),
        },
        faultTime: {
          total: faultTimeMs,
          formatted: formatDuration(faultTimeMs),
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

function machineSerialFromConfig(machine) {
  const serial = Number(machine?.id ?? machine?.serial);
  return Number.isFinite(serial) ? serial : null;
}

async function loadConfiguredMachines(db, config, serial = null) {
  const filter = { active: { $ne: false } };
  const serialNum = Number(serial);
  if (Number.isFinite(serialNum)) {
    filter.$or = [
      { id: serialNum },
      { serial: serialNum },
      { id: String(serialNum) },
      { serial: String(serialNum) },
    ];
  }

  return db
    .collection(config.machineCollectionName)
    .find(filter)
    .project({ _id: 0, id: 1, serial: 1, name: 1, active: 1 })
    .sort({ name: 1, id: 1, serial: 1 })
    .toArray();
}

function buildOfflineMachineSummaryRow(machine, requestStart, requestEnd) {
  const serial = machineSerialFromConfig(machine);
  if (serial === null) return null;

  return {
    machine: {
      serial,
      name: machine.name || `Serial ${serial}`,
    },
    currentStatus: {
      code: null,
      name: "Offline",
      color: "None",
    },
    metrics: {
      runtime: {
        total: 0,
        formatted: formatDuration(0),
      },
      downtime: {
        total: 0,
        formatted: formatDuration(0),
      },
      pausedTime: {
        total: 0,
        formatted: formatDuration(0),
      },
      downTime: {
        total: 0,
        formatted: formatDuration(0),
      },
      faultTime: {
        total: 0,
        formatted: formatDuration(0),
      },
      output: {
        totalCount: 0,
        misfeedCount: 0,
      },
      performance: {
        availability: {
          value: 0,
          percentage: "0.00",
        },
        throughput: {
          value: 0,
          percentage: "0.00",
        },
        piecesPerHour: {
          value: 0,
          formatted: "0",
        },
        pph: 0,
        efficiency: {
          value: 0,
          percentage: "0.00",
        },
        oee: {
          value: 0,
          percentage: "0.00",
        },
      },
    },
    timeRange: {
      start: requestStart,
      end: requestEnd,
    },
  };
}

async function appendConfiguredOfflineMachineRows(db, config, rows, requestStart, requestEnd, serial = null) {
  const configuredMachines = await loadConfiguredMachines(db, config, serial);
  if (!configuredMachines.length) return rows;

  const existingSerials = new Set(
    rows
      .map((row) => Number(row?.machine?.serial))
      .filter(Number.isFinite)
  );
  const missingRows = configuredMachines
    .filter((machine) => {
      const machineSerial = machineSerialFromConfig(machine);
      return machineSerial !== null && !existingSerials.has(machineSerial);
    })
    .map((machine) => buildOfflineMachineSummaryRow(machine, requestStart, requestEnd))
    .filter(Boolean);

  return rows.concat(missingRows);
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
    pausedTimeMs: record.pausedTimeMs || 0,
    faultTimeMs: record.faultTimeMs || 0,
    workedTimeMs: record.workedTimeMs || 0,
    totalCounts: record.totalCounts || 0,
    totalMisfeeds: record.totalMisfeeds || 0,
    totalTimeCreditMs: record.totalTimeCreditMs || record.workedTimeMs || 0,
    timeRange: { start, end },
  }));

  const rows = await buildMachineSummaryRows(db, logger, config, records, [shiftDoc], start, end);
  return appendConfiguredOfflineMachineRows(db, config, rows, start, end, serial);
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
    type: "machine",
    "timestamps.create": calendarRange(dateStr),
  };
  if (options.serial) {
    filter["machine.id"] = parseInt(options.serial, 10);
  }

  const records = (await db.collection(config.totalsDailyCollectionName).find(filter).toArray())
    .map(normalizeTotalsDocument);
  const activeShifts = await loadActiveShifts(db, {
    collectionName: config.shiftCollectionName,
  }).catch(() => []);
  const rows = records.length
    ? await buildMachineSummaryRows(db, logger, config, records, activeShifts, start, end)
    : [];
  const data = await appendConfiguredOfflineMachineRows(db, config, rows, start, end, options.serial);
  const projectionWindow = resolveShiftProjectionWindow(activeShifts, start, end, SYSTEM_TIMEZONE);

  return {
    data,
    source: records.length ? "totals-daily" : "config-machine",
    found: data.length > 0,
    dateStr,
    start,
    end,
    projectionWindow,
    recordCount: records.length,
  };
}

async function buildMachineSummaryFromShiftCache(db, logger, config, options) {
  const { shiftOid, shiftDoc, start, end } = options;
  const dateStr = options.dateStr || getPlantDateStr(start);
  const filter = {
    type: "machine",
    "timestamps.create": calendarRange(dateStr),
    $or: [
      { "shift.id": String(shiftOid) },
      { "shift._id": shiftOid },
    ],
  };
  if (options.serial) {
    filter["machine.id"] = parseInt(options.serial, 10);
  }

  const records = (await db.collection(TOTALS_SHIFT_COLLECTION).find(filter).toArray())
    .map(normalizeTotalsDocument);
  if (records.length > 0) {
    const rows = await buildMachineSummaryRows(db, logger, config, records, [shiftDoc], start, end);
    return {
      data: await appendConfiguredOfflineMachineRows(db, config, rows, start, end, options.serial),
      source: TOTALS_SHIFT_COLLECTION,
      found: true,
      dateStr,
      start,
      end,
      projectionWindow: resolveShiftProjectionWindow([shiftDoc], start, end, SYSTEM_TIMEZONE),
      shiftId: String(shiftOid),
      shift: shiftDoc,
      recordCount: records.length,
    };
  }

  const data = await buildMachineSummaryFromSessions(db, logger, config, start, end, options.serial, shiftOid, shiftDoc);
  return {
    data,
    source: "session-machine",
    found: data.length > 0,
    dateStr,
    start,
    end,
    projectionWindow: resolveShiftProjectionWindow([shiftDoc], start, end, SYSTEM_TIMEZONE),
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
  loadConfiguredMachines,
  buildOfflineMachineSummaryRow,
  appendConfiguredOfflineMachineRows,
  buildMachineSummaryFromSessions,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
};

