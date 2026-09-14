const { DateTime } = require("luxon");
const { formatDuration, SYSTEM_TIMEZONE } = require("./time");
const { computeShiftElapsedMs, loadActiveShifts } = require("./shiftElapsed");
const { calendarRange, normalizeTotalsDocument } = require("./totalsSchema");
const { addDerivedShiftTimeComponents, getShiftTimeComponents } = require("./shiftTimeComponents");
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

function shiftMinutes(shift) {
  const components = getShiftTimeComponents(shift);
  if (!components) return null;
  const startMin = (components.startTime.hour * 60) + components.startTime.minute;
  const endMin = (components.endTime.hour * 60) + components.endTime.minute;
  return { startMin, endMin };
}

function shiftAppliesToDay(shift, day) {
  const activeDays = Array.isArray(shift?.activeDays) ? shift.activeDays : [];
  return activeDays.length === 0 || activeDays.includes(day.weekday);
}

function hasMidnightSpanningShift(shifts) {
  return (Array.isArray(shifts) ? shifts : [])
    .some((shift) => {
      const minutes = shiftMinutes(shift);
      return minutes && minutes.endMin <= minutes.startMin;
    });
}

function shiftTimelineWindowForDay(shifts, day) {
  const applicable = (Array.isArray(shifts) ? shifts : [])
    .filter((shift) => shiftAppliesToDay(shift, day))
    .map(shiftMinutes)
    .filter(Boolean)
    .filter((minutes) => minutes.endMin > minutes.startMin);

  if (!applicable.length) return null;

  const earliestStartMin = Math.min(...applicable.map((shift) => shift.startMin));
  const latestEndMin = Math.max(...applicable.map((shift) => shift.endMin));
  const startHour = Math.max(
    0,
    Math.floor(earliestStartMin / 60) - (earliestStartMin % 60 === 0 ? 1 : 0)
  );
  const endHour = Math.min(24, Math.ceil(latestEndMin / 60));

  return {
    start: day.startOf("day").plus({ hours: startHour }),
    end: day.startOf("day").plus({ hours: endHour }),
    firstShiftStart: day.startOf("day").plus({ minutes: earliestStartMin }),
    lastShiftEnd: day.startOf("day").plus({ minutes: latestEndMin }),
  };
}

function resolveMachineTimelineWindow(shifts, now) {
  const activeShifts = Array.isArray(shifts) ? shifts : [];
  const today = now.startOf("day");
  const todayEnd = today.plus({ days: 1 });

  if (hasMidnightSpanningShift(activeShifts)) {
    return {
      label: "Today",
      displayDateMode: "today",
      date: today.toISODate(),
      dataStart: today,
      dataEnd: DateTime.min(now, todayEnd),
      displayStart: today,
      displayEnd: todayEnd,
      shiftWindowMode: "fullDay",
    };
  }

  const todayWindow = shiftTimelineWindowForDay(activeShifts, today);
  const hasStartedToday = Boolean(todayWindow && now >= todayWindow.firstShiftStart);
  if (hasStartedToday) {
    return {
      label: "Today",
      displayDateMode: "today",
      date: today.toISODate(),
      dataStart: todayWindow.start,
      dataEnd: DateTime.min(now, todayWindow.end),
      displayStart: todayWindow.start,
      displayEnd: now < todayWindow.end ? DateTime.min(now, todayWindow.end) : todayWindow.end,
      shiftWindowMode: "shiftEnvelope",
    };
  }

  const yesterday = today.minus({ days: 1 });
  const yesterdayWindow = shiftTimelineWindowForDay(activeShifts, yesterday);
  const fallbackStart = yesterdayWindow?.start || yesterday;
  const fallbackEnd = yesterdayWindow?.end || yesterday.plus({ days: 1 });

  return {
    label: "Yesterday",
    displayDateMode: "yesterday",
    date: yesterday.toISODate(),
    dataStart: fallbackStart,
    dataEnd: fallbackEnd,
    displayStart: fallbackStart,
    displayEnd: fallbackEnd,
    shiftWindowMode: yesterdayWindow ? "shiftEnvelope" : "fullDay",
  };
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

function overlapRange(startInput, endInput, windowStart, windowEnd) {
  const start = startInput ? new Date(startInput) : null;
  const end = endInput ? new Date(endInput) : windowEnd;
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const clampedStart = start > windowStart ? start : windowStart;
  const clampedEnd = end < windowEnd ? end : windowEnd;
  if (clampedStart >= clampedEnd) return null;

  const fullMs = Math.max(0, end - start);
  const overlapMs = clampedEnd - clampedStart;
  return {
    start,
    end,
    clampedStart,
    clampedEnd,
    overlapMs,
    factor: fullMs > 0 ? overlapMs / fullMs : 1,
  };
}

function timelineStatusFromSession(session) {
  const status = session.startState?.status || session.status || session.endState?.status || {};
  const code = Number(status.id ?? status.code ?? 0);
  if (code === 1) return { key: "running", label: "Running", code };
  if (code >= 2) return { key: "faulted", label: status.name || "Faulted", code };
  return { key: "paused", label: status.name || "Paused", code };
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sessionCount(session, factor = 1) {
  const count = session.metrics?.totals?.counts?.valid ??
    session.totalCount ??
    (Array.isArray(session.counts) ? session.counts.length : 0);
  return Math.round(safeNumber(count) * factor);
}

function activeStationCount(session) {
  const explicitCount = safeNumber(session.metrics?.stations ?? session.activeStations);
  if (explicitCount > 0) return explicitCount;

  const operators = session.operators || session.states?.start?.operators;
  if (!Array.isArray(operators)) return 0;
  return operators.filter((operator) => operator && operator.id !== -1).length;
}

function sessionEfficiency(session) {
  const modernWorkedValue = session.metrics?.timers?.worked;
  const modernTimeCreditValue = session.metrics?.totals?.timeCredit;
  const modernWorkedMs = Number(modernWorkedValue);
  const modernTimeCreditMs = Number(modernTimeCreditValue);
  if (
    modernWorkedValue != null &&
    modernTimeCreditValue != null &&
    Number.isFinite(modernWorkedMs) &&
    Number.isFinite(modernTimeCreditMs)
  ) {
    return modernWorkedMs > 0
      ? +((modernTimeCreditMs / modernWorkedMs) * 100).toFixed(2)
      : 0;
  }

  const runtimeSec = safeNumber(session.runtime);
  const storedWorkedSec = safeNumber(session.workTime);
  const stations = activeStationCount(session);
  const workedSec = runtimeSec > 0 && stations > 0
    ? runtimeSec * stations
    : storedWorkedSec || runtimeSec;
  const timeCreditSec = safeNumber(session.totalTimeCredit);
  return workedSec > 0 ? +((timeCreditSec / workedSec) * 100).toFixed(2) : 0;
}

function timelineChunkFromSession(session, windowStart, windowEnd) {
  const range = overlapRange(session.timestamps?.start, session.timestamps?.end, windowStart, windowEnd);
  if (!range) return null;

  const status = timelineStatusFromSession(session);
  return {
    id: String(session._id),
    type: "session",
    status: status.key,
    statusLabel: status.label,
    statusCode: status.code,
    start: range.clampedStart,
    end: range.clampedEnd,
    sessionStart: range.start,
    sessionEnd: session.timestamps?.end ? range.end : null,
    durationMs: range.overlapMs,
    totalDurationMs: Math.max(0, range.end - range.start),
    totalCount: sessionCount(session, range.factor),
    efficiency: sessionEfficiency(session),
    current: !session.timestamps?.end,
  };
}

function offlineChunk(machine, start, end, index) {
  if (start >= end) return null;
  return {
    id: `offline-${machine.serial}-${index}`,
    type: "offline",
    status: "offline",
    statusLabel: "Offline",
    statusCode: -1,
    start,
    end,
    sessionStart: start,
    sessionEnd: end,
    durationMs: end - start,
    totalDurationMs: end - start,
    totalCount: 0,
    efficiency: null,
    current: false,
  };
}

function machineIdentityFromSession(session) {
  const serial = Number(session.machine?.serial ?? session.machine?.id);
  if (!Number.isFinite(serial)) return null;
  return {
    serial,
    name: session.machine?.name || `Serial ${serial}`,
  };
}

async function buildMachineTimelineFromSessions(db, config, start, end, options = {}) {
  const windowStart = new Date(start);
  const windowEnd = new Date(end);
  const displayStart = new Date(options.displayStart || start);
  const displayEnd = new Date(options.displayEnd || end);
  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime()) ||
    Number.isNaN(displayStart.getTime()) ||
    Number.isNaN(displayEnd.getTime()) ||
    windowStart >= windowEnd ||
    displayStart >= displayEnd
  ) {
    return { machines: [], completedSessions: [], currentSessions: [] };
  }

  const sessionQuery = {
    "timestamps.start": { $lt: windowEnd },
    $or: [
      { "timestamps.end": { $gt: windowStart } },
      { "timestamps.end": null },
      { "timestamps.end": { $exists: false } },
    ],
  };

  const [machines, sessions] = await Promise.all([
    db.collection(config.machineCollectionName)
      .find({})
      .project({ id: 1, serial: 1, name: 1 })
      .toArray(),
    db.collection(config.machineSessionCollectionName)
      .find(sessionQuery)
      .project({
        _id: 1,
        machine: 1,
        timestamps: 1,
        startState: 1,
        endState: 1,
        status: 1,
        runtime: 1,
        workTime: 1,
        totalTimeCredit: 1,
        totalCount: 1,
        counts: 1,
        metrics: 1,
        operators: 1,
        states: 1,
        activeStations: 1,
      })
      .sort({ "machine.name": 1, "machine.serial": 1, "timestamps.start": 1 })
      .toArray(),
  ]);

  const machineMap = new Map();
  for (const machine of machines) {
    const serial = Number(machine.serial ?? machine.id);
    if (!Number.isFinite(serial)) continue;
    machineMap.set(serial, {
      serial,
      name: machine.name || `Serial ${serial}`,
      sessions: [],
    });
  }

  const completedSessions = [];
  const currentSessions = [];

  for (const session of sessions) {
    const identity = machineIdentityFromSession(session);
    if (!identity) continue;

    if (!machineMap.has(identity.serial)) {
      machineMap.set(identity.serial, {
        serial: identity.serial,
        name: identity.name,
        sessions: [],
      });
    }

    const chunk = timelineChunkFromSession(session, windowStart, windowEnd);
    if (!chunk) continue;

    machineMap.get(identity.serial).sessions.push(chunk);
    const cacheSession = {
      ...chunk,
      machine: {
        serial: identity.serial,
        name: machineMap.get(identity.serial).name,
      },
    };
    if (chunk.current) currentSessions.push(cacheSession);
    else completedSessions.push(cacheSession);
  }

  const timelineMachines = Array.from(machineMap.values())
    .map((machine) => {
      const sessionsForMachine = machine.sessions
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      const chunks = [];
      let cursor = displayStart;
      let offlineIndex = 0;

      for (const session of sessionsForMachine) {
        const sessionStart = new Date(session.start);
        const sessionEnd = new Date(session.end);
        const gap = offlineChunk(machine, cursor, sessionStart, offlineIndex);
        if (gap) {
          chunks.push(gap);
          offlineIndex += 1;
        }
        chunks.push(session);
        if (sessionEnd > cursor) cursor = sessionEnd;
      }

      const trailingGap = offlineChunk(machine, cursor, windowEnd, offlineIndex);
      if (trailingGap) chunks.push(trailingGap);

      return {
        serial: machine.serial,
        name: machine.name,
        sessions: chunks,
      };
    })
    .filter((machine) => machine.sessions.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    machines: timelineMachines,
    completedSessions,
    currentSessions,
    range: {
      start: displayStart,
      end: displayEnd,
    },
    dataRange: {
      start: windowStart,
      end: windowEnd,
    },
    meta: options.meta || {},
  };
}

async function buildDailyMachineTimeline(db, config, now) {
  const activeShifts = await loadActiveShifts(db, { collectionName: config.shiftCollectionName });
  const window = resolveMachineTimelineWindow(activeShifts, now);
  return buildMachineTimelineFromSessions(
    db,
    config,
    window.dataStart.toJSDate(),
    window.dataEnd.toJSDate(),
    {
      displayStart: window.displayStart.toJSDate(),
      displayEnd: window.displayEnd.toJSDate(),
      meta: {
        label: window.label,
        subtitle: window.label,
        displayDateMode: window.displayDateMode,
        date: window.date,
        shiftWindowMode: window.shiftWindowMode,
        start: window.displayStart.toJSDate(),
        end: window.displayEnd.toJSDate(),
        dataStart: window.dataStart.toJSDate(),
        dataEnd: window.dataEnd.toJSDate(),
      },
    }
  );
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
    machineTimeline,
    groupRecords,
    previousGroupRecords,
    departmentLookup,
  ] = await Promise.all([
    buildMachineStatusFromDailyTotals(db, start, end, logger),
    buildMachineOEEFromDailyTotals(db, start, end, logger),
    buildItemTotalsFromCache(db, start, end, logger),
    buildCountTotalsFromDailyTotals(db, end, logger),
    buildTopOperatorEfficiencyFromCache(db, start, end, logger),
    buildDailyMachineTimeline(db, config, now),
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
    machineTimeline,
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
      machineTimeline: machineTimeline.machines.length > 0,
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

  const [machineRecords, itemRecords, operatorRecords, dailyPreviousRecords, departmentLookup, machineTimeline] = await Promise.all([
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "machine" }).toArray(),
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "item" }).toArray(),
    db.collection(TOTALS_SHIFT_COLLECTION).find({ ...baseFilter, type: "operator-machine" }).toArray(),
    db.collection(config.totalsDailyCollectionName)
      .find({
        type: "machine",
        "timestamps.create": calendarRange(previousDateStr(dateStr)),
      }).toArray(),
    buildMachineDepartmentLookup(db, config),
    buildMachineTimelineFromSessions(db, config, start, end),
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
    machineTimeline,
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
      machineTimeline: data.machineTimeline.machines.length > 0,
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
  buildMachineTimelineFromSessions,
};
