const { formatDuration } = require("./time");
const { formatHumanName } = require("./humanNames");
const { loadActiveShifts, computeShiftElapsedMs } = require("./shiftElapsed");
const { getOperatorSessionDataForPartialDays } = require("./reportFunctions");
const {
  TOTALS_SHIFT_COLLECTION,
  getPlantDateStr,
  getTodayRange,
} = require("./machineDashboardCache");
const { calendarRange, normalizeTotalsDocument } = require("./totalsSchema");
const { getOperatorFaultTimeByOperatorId } = require("./faultTimeSummary");

async function buildOperatorTickerMap(db, config) {
  const stateTickerData = await db.collection(config.stateTickerCollectionName).find({}).toArray();
  const operatorTickerMap = new Map();

  for (const stateRecord of stateTickerData) {
    const machine = stateRecord.machine || {};
    const status = stateRecord.status || {};
    const timestamp = new Date(
      status.timestamp ||
        stateRecord.timestamp ||
        (stateRecord.timestamps &&
          (stateRecord.timestamps.update ||
            stateRecord.timestamps.active ||
            stateRecord.timestamps.create)) ||
        0
    ).getTime();

    if (!Array.isArray(stateRecord.operators)) continue;

    for (const op of stateRecord.operators) {
      if (!op || typeof op.id === "undefined" || op.id === null) continue;

      const operatorKey = typeof op.id === "string" ? Number.parseInt(op.id, 10) : op.id;
      if (Number.isNaN(operatorKey)) continue;

      const existing = operatorTickerMap.get(operatorKey);
      if (existing && existing.timestamp >= timestamp) continue;

      const serial = machine.serial ?? machine.id ?? machine.serialNumber ?? null;
      const statusId = status?.id ?? status?.code ?? null;
      operatorTickerMap.set(operatorKey, {
        machine:
          serial !== null && serial !== undefined
            ? { serial, name: machine.name || null }
            : null,
        status:
          typeof statusId !== "undefined" && statusId !== null || typeof status.name !== "undefined"
            ? { code: statusId, name: status.name ?? null }
            : null,
        timestamp,
      });
    }
  }

  return operatorTickerMap;
}

function operatorNameFromRecord(record) {
  return formatHumanName(record.operatorName);
}

async function buildOperatorSummaryRows(db, config, records, activeShifts, requestStart, requestEnd) {
  const operatorTickerMap = await buildOperatorTickerMap(db, config);
  const operatorIds = records.map((record) => record.operatorId).filter((id) => id && id !== -1);
  const faultTimeByOperatorId = await getOperatorFaultTimeByOperatorId(db, config, operatorIds, requestStart, requestEnd);
  const operatorMap = new Map();

  for (const record of records) {
    const opId = record.operatorId;
    if (!opId || opId === -1) continue;

    if (!operatorMap.has(opId)) {
      operatorMap.set(opId, {
        operator: { id: opId, name: operatorNameFromRecord(record) },
        currentStatus: null,
        currentMachine: null,
        metrics: {
          runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          pausedTime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          downTime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          faultTime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          output: { totalCount: 0, misfeedCount: 0 },
          performance: {
            availability: { value: 0, percentage: "0.00" },
            throughput: { value: 0, percentage: "0.00" },
            efficiency: { value: 0, percentage: "0.00" },
            oee: { value: 0, percentage: "0.00" },
          },
        },
        timeRange: record.buildRange || record.timeRange || { start: requestStart, end: requestEnd },
        machines: [],
        efficiencyData: [],
        workedTimeMs: 0,
        breakTimeMs: 0,
      });
    }

    const operatorData = operatorMap.get(opId);
    operatorData.machines.push({
      serial: record.machineSerial,
      name: record.machineName,
    });

    const tickerContext = operatorTickerMap.get(opId);
    operatorData.currentMachine = tickerContext?.machine || null;
    operatorData.currentStatus = tickerContext?.status || null;
    operatorData.metrics.runtime.total += record.runtimeMs || 0;
    operatorData.metrics.pausedTime.total += record.pausedTimeMs || 0;
    operatorData.breakTimeMs += record.breakTimeMs || 0;
    operatorData.metrics.output.totalCount += record.totalCounts || 0;
    operatorData.metrics.output.misfeedCount += record.totalMisfeeds || 0;

    const workTimeMs = record.workedTimeMs || 0;
    operatorData.workedTimeMs += workTimeMs;
    const efficiency = workTimeMs > 0 ? (record.totalTimeCreditMs || 0) / workTimeMs : 0;
    operatorData.efficiencyData.push({
      efficiency,
      weight: workTimeMs,
    });
  }

  const results = Array.from(operatorMap.values()).map((operatorData) => {
    const { runtime, downtime, pausedTime, downTime, output } = operatorData.metrics;
    const faultTime = operatorData.metrics.faultTime;
    let rangeStart = new Date(requestStart);
    let rangeEnd = new Date(requestEnd);

    if (operatorData.timeRange?.start && operatorData.timeRange?.end) {
      const startDate = new Date(operatorData.timeRange.start);
      const endDate = new Date(operatorData.timeRange.end);
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate > startDate) {
        rangeStart = startDate;
        rangeEnd = endDate;
      }
    }

    const shiftElapsedMs = computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);
    const productiveElapsedMs = Math.max(0, shiftElapsedMs - operatorData.breakTimeMs);
    downtime.total = Math.max(productiveElapsedMs - runtime.total, 0);
    downTime.total = downtime.total;
    faultTime.total = faultTimeByOperatorId.get(Number(operatorData.operator.id)) || 0;
    const availability =
      productiveElapsedMs > 0 ? runtime.total / productiveElapsedMs : 0;
    const throughput =
      output.totalCount + output.misfeedCount > 0
        ? output.totalCount / (output.totalCount + output.misfeedCount)
        : 0;

    let totalWeightedEfficiency = 0;
    let totalWeight = 0;
    for (const effData of operatorData.efficiencyData) {
      totalWeightedEfficiency += effData.efficiency * effData.weight;
      totalWeight += effData.weight;
    }

    const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
    const oee = availability * throughput * efficiency;
    const workedHours = operatorData.workedTimeMs / 3600000;
    const piecesPerHour = workedHours > 0 ? output.totalCount / workedHours : 0;

    operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
    operatorData.metrics.downtime.formatted = formatDuration(downtime.total);
    operatorData.metrics.pausedTime.formatted = formatDuration(pausedTime.total);
    operatorData.metrics.downTime.formatted = formatDuration(downTime.total);
    operatorData.metrics.faultTime.formatted = formatDuration(faultTime.total);
    operatorData.metrics.performance = {
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
      piecesPerHour: {
        value: piecesPerHour,
        formatted: Math.round(piecesPerHour).toString(),
      },
      pph: piecesPerHour,
      oee: {
        value: oee,
        percentage: (oee * 100).toFixed(2),
      },
    };
    operatorData.timeRange = { start: rangeStart, end: rangeEnd };

    delete operatorData.machines;
    delete operatorData.efficiencyData;
    delete operatorData.workedTimeMs;
    delete operatorData.breakTimeMs;
    return operatorData;
  });

  const MIN_RUNTIME_TO_SHOW_MS = 3600000;
  return results.filter((operatorData) => {
    const hasRuntime = operatorData.metrics.runtime.total > 0;
    const hasProduction = operatorData.metrics.output.totalCount > 0;
    const hasCurrentMachine = operatorData.currentMachine !== null;
    const hasSignificantRuntime = operatorData.metrics.runtime.total >= MIN_RUNTIME_TO_SHOW_MS;
    return hasRuntime && hasProduction && (hasCurrentMachine || hasSignificantRuntime);
  });
}

async function buildOperatorSummaryFromSessions(db, config, start, end, operatorId, shiftOid, shiftDoc) {
  const sessionData = await getOperatorSessionDataForPartialDays(
    db,
    [{ start, end }],
    operatorId || undefined,
    { shiftId: String(shiftOid) }
  );

  const records = (sessionData.operators || []).map((record) => ({
    operatorId: record.operatorId,
    operatorName: record.operatorName,
    machineSerial: null,
    machineName: null,
    runtimeMs: record.runtimeMs || 0,
    pausedTimeMs: record.pausedTimeMs || 0,
    faultTimeMs: record.faultTimeMs || 0,
    workedTimeMs: record.workedTimeMs || 0,
    totalCounts: record.totalCounts || 0,
    totalMisfeeds: record.totalMisfeeds || 0,
    totalTimeCreditMs: record.totalTimeCreditMs || record.workedTimeMs || 0,
    timeRange: { start, end },
  }));

  return buildOperatorSummaryRows(db, config, records, [shiftDoc], start, end);
}

async function buildOperatorSummaryFromDailyCache(db, logger, config, options = {}) {
  const now = options.now || new Date();
  const { start, end, dateStr } = options.start && options.end
    ? {
        start: options.start,
        end: options.end,
        dateStr: options.dateStr || getPlantDateStr(options.start),
      }
    : getTodayRange(now);

  const filter = {
    type: "operator-machine",
    "timestamps.create": calendarRange(dateStr),
  };
  if (options.operatorId) {
    filter["operator.id"] = parseInt(options.operatorId, 10);
  }

  const records = (await db.collection(config.totalsDailyCollectionName).find(filter).toArray())
    .map(normalizeTotalsDocument);
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

  const data = await buildOperatorSummaryRows(db, config, records, activeShifts, start, end);
  return {
    data,
    source: "totals-daily",
    found: true,
    dateStr,
    start,
    end,
    recordCount: records.length,
  };
}

async function buildOperatorSummaryFromShiftCache(db, logger, config, options) {
  const { shiftOid, shiftDoc, start, end } = options;
  const dateStr = options.dateStr || getPlantDateStr(start);
  const filter = {
    type: "operator-machine",
    "timestamps.create": calendarRange(dateStr),
    $or: [
      { "shift.id": String(shiftOid) },
      { "shift._id": shiftOid },
    ],
  };
  if (options.operatorId) {
    filter["operator.id"] = parseInt(options.operatorId, 10);
  }

  const records = (await db.collection(TOTALS_SHIFT_COLLECTION).find(filter).toArray())
    .map(normalizeTotalsDocument);
  if (records.length > 0) {
    return {
      data: await buildOperatorSummaryRows(db, config, records, [shiftDoc], start, end),
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
    data: await buildOperatorSummaryFromSessions(db, config, start, end, options.operatorId, shiftOid, shiftDoc),
    source: "session-operator",
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
  buildOperatorTickerMap,
  buildOperatorSummaryRows,
  buildOperatorSummaryFromSessions,
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
};
