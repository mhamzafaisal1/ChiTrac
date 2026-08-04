const { DateTime } = require("luxon");
const { formatDuration, SYSTEM_TIMEZONE } = require("./time");
const { computeShiftElapsedMs } = require("./shiftElapsed");
const { calendarRange, normalizeTotalsDocument } = require("./totalsSchema");
const { addDerivedShiftTimeComponents } = require("./shiftTimeComponents");
const {
  buildMachineStatusFromDailyTotals,
  buildMachineOEEFromDailyTotals,
  buildItemTotalsFromCache,
  buildCountTotalsFromDailyTotals,
  buildTopOperatorEfficiencyFromCache,
  buildTopOperatorEfficiencyFromSessions,
  previousDateStr,
  MACHINE_GROUP_DEPARTMENTS,
} = require("./dashboardFunctions");

const TOTALS_SHIFT_COLLECTION = "totals-shift";

function toDateStr(date) {
  return DateTime.fromJSDate(new Date(date), { zone: SYSTEM_TIMEZONE }).toISODate();
}

function serializableShift(shiftDoc) {
  if (!shiftDoc) return null;
  const components = addDerivedShiftTimeComponents(shiftDoc);
  return {
    _id: String(shiftDoc._id),
    id: shiftDoc.id,
    name: shiftDoc.name,
    active: shiftDoc.active,
    activeDays: shiftDoc.activeDays,
    startTime: components.startTime,
    endTime: components.endTime,
  };
}

function envelope(data, meta) {
  return {
    data,
    updatedAt: new Date(),
    meta,
  };
}

async function buildMachineDepartmentLookup(db, config) {
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
    if (key != null && departmentLookup?.has(String(key))) {
      return departmentLookup.get(String(key));
    }
  }

  return null;
}

function machineStatusFromRecords(records, start, end, shiftDoc) {
  const elapsedMs = computeShiftElapsedMs(shiftDoc ? [shiftDoc] : [], start, end, SYSTEM_TIMEZONE) || (end - start);
  return records
    .slice()
    .sort((a, b) => Number(a.machineSerial) - Number(b.machineSerial))
    .map((record) => {
      const runningMs = record.runtimeMs || 0;
      const breakMs = record.breakTimeMs || 0;
      const pausedMs = record.pausedTimeMs || record.pauseTimeMs || 0;
      const faultedMs = record.faultTimeMs || 0;
      const offlineMs = Math.max(0, elapsedMs - breakMs - runningMs - pausedMs - faultedMs);
      return {
        serial: record.machineSerial,
        name: record.machineName || `Serial ${record.machineSerial}`,
        runningMs,
        pausedMs,
        faultedMs,
        offlineMs,
      };
    });
}

function machineOeeFromRecords(records, start, end, shiftDoc) {
  const windowMs = computeShiftElapsedMs(shiftDoc ? [shiftDoc] : [], start, end, SYSTEM_TIMEZONE) || (end - start);
  return records
    .map((record) => {
      const runtimeMs = record.runtimeMs || 0;
      const productiveMs = Math.max(0, windowMs - (record.breakTimeMs || 0));
      const availability = productiveMs > 0
        ? Math.min(Math.max(runtimeMs / productiveMs, 0), 1)
        : 0;
      const totalCounts = record.totalCounts || 0;
      const totalMisfeeds = record.totalMisfeeds || 0;
      const throughput = totalCounts + totalMisfeeds > 0 ? totalCounts / (totalCounts + totalMisfeeds) : 0;
      let workedTimeMs = record.workedTimeMs || 0;
      if (workedTimeMs === 0 && (record.totalTimeCreditMs || 0) > 0 && runtimeMs > 0) workedTimeMs = runtimeMs;
      const efficiency = workedTimeMs > 0 ? (record.totalTimeCreditMs || 0) / workedTimeMs : 0;
      return {
        serial: record.machineSerial,
        name: record.machineName || `Serial ${record.machineSerial}`,
        oee: +(availability * throughput * efficiency * 100).toFixed(2),
      };
    })
    .sort((a, b) => b.oee - a.oee);
}

function itemTotalsFromRecords(records) {
  const byItem = new Map();
  for (const record of records) {
    const itemName = record.itemName || "Unknown";
    byItem.set(itemName, (byItem.get(itemName) || 0) + (record.totalCounts || 0));
  }

  return {
    title: "Item Totals by Type",
    items: Array.from(byItem.entries())
      .filter(([, totalCount]) => totalCount > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([itemName, totalCount]) => ({ itemName, totalCount })),
  };
}

function topOperatorsFromRecords(records) {
  const byOperator = new Map();
  for (const record of records) {
    const id = record.operatorId;
    if (id == null) continue;
    const existing = byOperator.get(id) || {
      id,
      name: record.operatorName || `#${id}`,
      totalWorkedTimeMs: 0,
      totalTimeCreditMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
    };
    existing.totalWorkedTimeMs += record.workedTimeMs || 0;
    existing.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    existing.totalCounts += record.totalCounts || 0;
    existing.totalMisfeeds += record.totalMisfeeds || 0;
    byOperator.set(id, existing);
  }

  return Array.from(byOperator.values())
    .map((operator) => {
      const efficiency = operator.totalWorkedTimeMs > 0
        ? operator.totalTimeCreditMs / operator.totalWorkedTimeMs
        : 0;
      const validCount = Math.round(operator.totalCounts);
      const misfeedCount = Math.round(operator.totalMisfeeds);
      return {
        id: operator.id,
        name: operator.name,
        efficiency: +(efficiency * 100).toFixed(2),
        metrics: {
          runtime: {
            total: operator.totalWorkedTimeMs,
            formatted: formatDuration(operator.totalWorkedTimeMs),
          },
          output: {
            totalCount: validCount + misfeedCount,
            validCount,
            misfeedCount,
          },
        },
      };
    })
    .sort((a, b) => {
      const effDiff = b.efficiency - a.efficiency;
      return effDiff !== 0 ? effDiff : Number(a.id) - Number(b.id);
    })
    .slice(0, 10);
}

function machineGroupEfficiencyFromRecords(records, previousRecords, start, end, shiftDoc, departmentLookup = new Map()) {
  const elapsedMs = computeShiftElapsedMs(shiftDoc ? [shiftDoc] : [], start, end, SYSTEM_TIMEZONE) || (end - start);
  const byDept = new Map(MACHINE_GROUP_DEPARTMENTS.map((name) => [name, []]));
  const previousByDept = new Map(MACHINE_GROUP_DEPARTMENTS.map((name) => [name, []]));

  for (const record of records) {
    const dept = getMachineDepartment(record, departmentLookup);
    if (byDept.has(dept)) byDept.get(dept).push(record);
  }

  for (const record of previousRecords || []) {
    const dept = getMachineDepartment(record, departmentLookup);
    if (previousByDept.has(dept)) previousByDept.get(dept).push(record);
  }

  const data = [];
  for (const departmentName of MACHINE_GROUP_DEPARTMENTS) {
    const deptRecords = byDept.get(departmentName) || [];
    if (!deptRecords.length) continue;

    let sumRuntimeMs = 0;
    let sumTotalCounts = 0;
    let sumTotalMisfeeds = 0;
    let sumTotalTimeCreditMs = 0;
    let sumWorkedTimeMs = 0;
    let sumBreakTimeMs = 0;
    for (const record of deptRecords) {
      sumRuntimeMs += record.runtimeMs || 0;
      sumTotalCounts += record.totalCounts || 0;
      sumTotalMisfeeds += record.totalMisfeeds || 0;
      sumTotalTimeCreditMs += record.totalTimeCreditMs || 0;
      sumBreakTimeMs += record.breakTimeMs || 0;
      let workedMs = record.workedTimeMs || 0;
      if (workedMs === 0 && (record.totalTimeCreditMs || 0) > 0 && (record.runtimeMs || 0) > 0) {
        workedMs = record.runtimeMs;
      }
      sumWorkedTimeMs += workedMs;
    }

    const productiveElapsedMs = Math.max(0, elapsedMs - sumBreakTimeMs);
    const availability = productiveElapsedMs > 0
      ? Math.min(Math.max(sumRuntimeMs / productiveElapsedMs, 0), 1)
      : 0;
    const throughput = sumTotalCounts + sumTotalMisfeeds > 0
      ? sumTotalCounts / (sumTotalCounts + sumTotalMisfeeds)
      : 0;
    const efficiency = sumWorkedTimeMs > 0 ? sumTotalTimeCreditMs / sumWorkedTimeMs : 0;
    const oee = availability * throughput * efficiency;

    let efficiencyPreviousDay = null;
    const previousDeptRecords = previousByDept.get(departmentName) || [];
    if (previousDeptRecords.length) {
      let previousWorkedMs = 0;
      let previousCreditMs = 0;
      for (const record of previousDeptRecords) {
        previousCreditMs += record.totalTimeCreditMs || 0;
        let workedMs = record.workedTimeMs || 0;
        if (workedMs === 0 && (record.totalTimeCreditMs || 0) > 0 && (record.runtimeMs || 0) > 0) {
          workedMs = record.runtimeMs;
        }
        previousWorkedMs += workedMs;
      }
      if (previousWorkedMs > 0) {
        const previousEfficiency = previousCreditMs / previousWorkedMs;
        efficiencyPreviousDay = {
          value: previousEfficiency,
          percentage: (previousEfficiency * 100).toFixed(2),
        };
      }
    }

    data.push({
      machine: { name: departmentName },
      metrics: {
        runtime: { total: sumRuntimeMs, formatted: formatDuration(sumRuntimeMs) },
        downtime: {
          total: Math.max(productiveElapsedMs - sumRuntimeMs, 0),
          formatted: formatDuration(Math.max(productiveElapsedMs - sumRuntimeMs, 0)),
        },
        output: { totalCount: sumTotalCounts, misfeedCount: sumTotalMisfeeds },
        performance: {
          availability: { value: availability, percentage: (availability * 100).toFixed(2) },
          throughput: { value: throughput, percentage: (throughput * 100).toFixed(2) },
          efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) },
          oee: { value: oee, percentage: (oee * 100).toFixed(2) },
        },
      },
      timeRange: { start, end },
      efficiencyPreviousDay,
    });
  }

  return data;
}

async function buildDailyCountsForShift(db, config, dayEnd, dateStr, machineRecords, logger) {
  const dailyCounts = await buildCountTotalsFromDailyTotals(db, dayEnd, logger);
  const shiftCount = machineRecords.reduce((sum, record) => sum + (record.totalCounts || 0), 0);
  const existing = dailyCounts.find((row) => row.date === dateStr);
  if (existing) {
    existing.count = shiftCount;
    existing.scope = "shift";
  } else {
    dailyCounts.push({ date: dateStr, count: shiftCount, scope: "shift" });
    dailyCounts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return dailyCounts;
}

async function buildTodayDailyAnalyticsCache(db, logger, config, options = {}) {
  const now = DateTime.fromJSDate(new Date(options.now || new Date()), { zone: SYSTEM_TIMEZONE });
  const start = options.start || now.startOf("day").toJSDate();
  const end = options.end || now.toJSDate();
  const dateStr = options.dateStr || toDateStr(start);
  const yesterdayStr = previousDateStr(dateStr);

  const [
    machineStatus,
    machineOee,
    itemTotals,
    dailyCounts,
    topOperatorsInitial,
    groupRecords,
    previousGroupRecords,
    departmentLookup,
  ] = await Promise.all([
    buildMachineStatusFromDailyTotals(db, start, end, logger),
    buildMachineOEEFromDailyTotals(db, start, end, logger),
    buildItemTotalsFromCache(db, start, end, logger),
    buildCountTotalsFromDailyTotals(db, end, logger),
    buildTopOperatorEfficiencyFromCache(db, start, end, logger),
    db.collection(config.totalsDailyCollectionName)
      .find({ type: "machine", "timestamps.create": calendarRange(dateStr) }).toArray(),
    db.collection(config.totalsDailyCollectionName)
      .find({ type: "machine", "timestamps.create": calendarRange(yesterdayStr) }).toArray(),
    buildMachineDepartmentLookup(db, config),
  ]);

  let topOperators = topOperatorsInitial;
  if (topOperators.length === 0 || topOperators.every((op) => op.efficiency === 0 && op.metrics?.runtime?.total === 0)) {
    topOperators = await buildTopOperatorEfficiencyFromSessions(db, start, end).catch(() => topOperatorsInitial);
  }

  const normalizedGroupRecords = groupRecords.map(normalizeTotalsDocument);
  const normalizedPreviousGroupRecords = previousGroupRecords.map(normalizeTotalsDocument);

  const data = {
    machineStatus,
    machineOee,
    itemTotals,
    machineGroupEfficiency: machineGroupEfficiencyFromRecords(
      normalizedGroupRecords,
      normalizedPreviousGroupRecords,
      start,
      end,
      null,
      departmentLookup
    ),
    topOperators,
    dailyCounts,
  };

  return envelope(data, {
    key: dateStr,
    date: dateStr,
    mode: "today",
    start,
    end,
    source: "totals-daily",
    found: {
      machineStatus: machineStatus.length > 0,
      machineOee: machineOee.length > 0,
      itemTotals: itemTotals.items.length > 0,
      machineGroupEfficiency: data.machineGroupEfficiency.length > 0,
      topOperators: topOperators.length > 0,
      dailyCounts: dailyCounts.length > 0,
    },
  });
}

async function buildShiftDailyAnalyticsCache(db, logger, config, context) {
  const { dateStr, start, end, shiftDoc, shiftOid, mode } = context;
  const baseFilter = {
    "timestamps.create": calendarRange(dateStr),
    $or: [
      { "shift.id": String(shiftOid) },
      { "shift._id": shiftOid },
    ],
  };

  const [machineRecords, itemRecords, operatorRecords, dailyPreviousRecords, departmentLookup] = await Promise.all([
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "machine" }).toArray(),
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "item" }).toArray(),
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "operator-machine" }).toArray(),
    db.collection(config.totalsDailyCollectionName)
      .find({
        type: "machine",
        "timestamps.create": calendarRange(previousDateStr(dateStr)),
      }).toArray(),
    buildMachineDepartmentLookup(db, config),
  ]);

  const normalizedMachines = machineRecords.map(normalizeTotalsDocument);
  const normalizedItems = itemRecords.map(normalizeTotalsDocument);
  const normalizedOperators = operatorRecords.map(normalizeTotalsDocument);
  const normalizedPrevious = dailyPreviousRecords.map(normalizeTotalsDocument);

  const data = {
    machineStatus: machineStatusFromRecords(normalizedMachines, start, end, shiftDoc),
    machineOee: machineOeeFromRecords(normalizedMachines, start, end, shiftDoc),
    itemTotals: itemTotalsFromRecords(normalizedItems),
    machineGroupEfficiency: machineGroupEfficiencyFromRecords(normalizedMachines, normalizedPrevious, start, end, shiftDoc, departmentLookup),
    topOperators: topOperatorsFromRecords(normalizedOperators),
    dailyCounts: await buildDailyCountsForShift(db, config, end, dateStr, normalizedMachines, logger),
  };

  return envelope(data, {
    key: `${dateStr}|${String(shiftOid)}`,
    date: dateStr,
    shiftId: String(shiftOid),
    shift: serializableShift(shiftDoc),
    mode,
    start,
    end,
    source: TOTALS_SHIFT_COLLECTION,
    found: {
      machineStatus: data.machineStatus.length > 0,
      machineOee: data.machineOee.length > 0,
      itemTotals: data.itemTotals.items.length > 0,
      machineGroupEfficiency: data.machineGroupEfficiency.length > 0,
      topOperators: data.topOperators.length > 0,
      dailyCounts: data.dailyCounts.length > 0,
    },
    recordCount: {
      machines: machineRecords.length,
      items: itemRecords.length,
      operators: operatorRecords.length,
    },
  });
}

module.exports = {
  buildTodayDailyAnalyticsCache,
  buildShiftDailyAnalyticsCache,
};
