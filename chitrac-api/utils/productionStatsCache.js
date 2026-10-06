const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");
const { getShiftTimeComponents } = require("./shiftTimeComponents");
const { formatHumanName } = require("./humanNames");

const WINDOW_DEFINITIONS = Object.freeze([
  { key: "lastSixMinutes", minutes: 6, label: "Last 6 Mins" },
  { key: "lastFifteenMinutes", minutes: 15, label: "Last 15 Mins" },
  { key: "lastHour", minutes: 60, label: "Last Hour" },
  { key: "today", label: "All Day" },
  { key: "last24Hours", minutes: 24 * 60, label: "Last 24 Hours" },
]);

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function serialFromMachine(machine) {
  const serial = Number(machine?.serial ?? machine?.id);
  return Number.isFinite(serial) ? serial : null;
}

function productionWindowRanges(nowInput = new Date()) {
  const now = DateTime.fromJSDate(new Date(nowInput), { zone: SYSTEM_TIMEZONE });
  const currentMinute = now.startOf("minute");
  return Object.fromEntries(WINDOW_DEFINITIONS.map((definition) => {
    const start = definition.key === "today"
      ? now.startOf("day")
      : currentMinute.minus({ minutes: definition.minutes - 1 });
    return [definition.key, {
      key: definition.key,
      label: definition.label,
      start: start.toJSDate(),
      end: now.toJSDate(),
    }];
  }));
}

function timePart(value) {
  const hour = Number(value?.hour);
  const minute = Number(value?.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function rangeTimeComponents(value) {
  const explicitStart = timePart(value?.startTime || value?.start);
  const explicitEnd = timePart(value?.endTime || value?.end);
  if (explicitStart && explicitEnd) return { startTime: explicitStart, endTime: explicitEnd };
  return getShiftTimeComponents(value);
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function scheduledBreakMs(shifts, rangeStart, rangeEnd) {
  const start = DateTime.fromJSDate(new Date(rangeStart), { zone: SYSTEM_TIMEZONE });
  const end = DateTime.fromJSDate(new Date(rangeEnd), { zone: SYSTEM_TIMEZONE });
  if (!start.isValid || !end.isValid || end <= start) return 0;

  const intervals = [];
  let day = start.startOf("day");
  const lastDay = end.minus({ milliseconds: 1 }).startOf("day");
  while (day <= lastDay) {
    for (const shift of Array.isArray(shifts) ? shifts : []) {
      if (shift?.active === false) continue;
      if (
        Array.isArray(shift?.activeDays)
        && shift.activeDays.length
        && !shift.activeDays.includes(day.weekday)
      ) continue;
      const shiftComponents = rangeTimeComponents(shift);
      if (!shiftComponents) continue;
      const shiftStart = day.set({ ...shiftComponents.startTime, second: 0, millisecond: 0 });
      const shiftEnd = day.set({ ...shiftComponents.endTime, second: 0, millisecond: 0 });
      if (shiftEnd <= shiftStart) continue;

      for (const shiftBreak of [
        ...(Array.isArray(shift?.breaks) ? shift.breaks : []),
        ...(Array.isArray(shift?.breakTimes) ? shift.breakTimes : []),
      ]) {
        const components = rangeTimeComponents(shiftBreak);
        if (!components) continue;
        const breakStart = day.set({ ...components.startTime, second: 0, millisecond: 0 });
        const breakEnd = day.set({ ...components.endTime, second: 0, millisecond: 0 });
        const startMs = Math.max(start.toMillis(), shiftStart.toMillis(), breakStart.toMillis());
        const endMs = Math.min(end.toMillis(), shiftEnd.toMillis(), breakEnd.toMillis());
        if (endMs > startMs) intervals.push({ startMs, endMs });
      }
    }
    day = day.plus({ days: 1 });
  }

  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.endMs - interval.startMs,
    0
  );
}

function scheduledShiftMs(shifts, rangeStart, rangeEnd) {
  const start = DateTime.fromJSDate(new Date(rangeStart), { zone: SYSTEM_TIMEZONE });
  const end = DateTime.fromJSDate(new Date(rangeEnd), { zone: SYSTEM_TIMEZONE });
  if (!start.isValid || !end.isValid || end <= start) return 0;

  const intervals = [];
  let day = start.startOf("day");
  const lastDay = end.minus({ milliseconds: 1 }).startOf("day");
  while (day <= lastDay) {
    for (const shift of Array.isArray(shifts) ? shifts : []) {
      if (shift?.active === false) continue;
      if (
        Array.isArray(shift?.activeDays)
        && shift.activeDays.length
        && !shift.activeDays.includes(day.weekday)
      ) continue;
      const components = rangeTimeComponents(shift);
      if (!components) continue;
      const shiftStart = day.set({ ...components.startTime, second: 0, millisecond: 0 });
      const shiftEnd = day.set({ ...components.endTime, second: 0, millisecond: 0 });
      if (shiftEnd <= shiftStart) continue;

      const startMs = Math.max(start.toMillis(), shiftStart.toMillis());
      const endMs = Math.min(end.toMillis(), shiftEnd.toMillis());
      if (endMs > startMs) intervals.push({ startMs, endMs });
    }
    day = day.plus({ days: 1 });
  }

  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.endMs - interval.startMs,
    0
  );
}

function emptyTotals() {
  return {
    validCount: 0,
    rejectCount: 0,
    runtimeMs: 0,
    workedTimeMs: 0,
    pausedTimeMs: 0,
    faultTimeMs: 0,
    offlineTimeMs: 0,
    shiftTimeMs: 0,
    shiftTimeSamples: 0,
    timeCreditMs: 0,
  };
}

function addDocumentTotals(target, document) {
  const totals = document?.totals || {};
  target.validCount += Number(totals.count || 0);
  target.rejectCount += Number(totals.misfeeds || 0);
  target.runtimeMs += Number(totals.runtimeMs || 0);
  target.workedTimeMs += Number(totals.workedTimeMs || 0);
  target.pausedTimeMs += Number(totals.pausedTimeMs || 0);
  target.faultTimeMs += Number(totals.faultTimeMs || 0);
  target.offlineTimeMs += Number(totals.offlineTimeMs || 0);
  if (Object.prototype.hasOwnProperty.call(totals, "shiftTimeMs")) {
    target.shiftTimeMs += Number(totals.shiftTimeMs || 0);
    target.shiftTimeSamples += 1;
  }
  target.timeCreditMs += Number(totals.timeCreditMs || 0);
}

function statsFromTotals(totals, range, breakTimeMs, fallbackShiftTimeMs = 0) {
  const elapsedMs = Math.max(0, new Date(range.end) - new Date(range.start));
  const expectedMinuteSamples = Math.ceil(elapsedMs / 60000);
  const hasCompleteShiftTime = expectedMinuteSamples > 0
    && totals.shiftTimeSamples >= expectedMinuteSamples;
  const shiftTimeMs = hasCompleteShiftTime
    ? totals.shiftTimeMs
    : fallbackShiftTimeMs;
  const eligibleElapsedMs = Math.max(0, shiftTimeMs - breakTimeMs);
  const hasData = totals.runtimeMs > 0;
  const availability = !hasData
    ? null
    : eligibleElapsedMs > 0
      ? Math.min(Math.max(totals.runtimeMs / eligibleElapsedMs, 0), 1)
      : 1;
  const efficiency = hasData ? totals.timeCreditMs / totals.runtimeMs : null;
  const throughput = hasData
    ? (totals.validCount + totals.rejectCount > 0
      ? totals.validCount / (totals.validCount + totals.rejectCount)
      : 0)
    : null;
  const oee = hasData ? availability * efficiency * throughput : null;

  return {
    hasData,
    availabilityPercent: availability === null ? null : round2(availability * 100),
    efficiencyPercent: efficiency === null ? null : round2(efficiency * 100),
    throughputPercent: throughput === null ? null : round2(throughput * 100),
    oeePercent: oee === null ? null : round2(oee * 100),
    validCount: Math.round(totals.validCount),
    rejectCount: Math.round(totals.rejectCount),
    runtimeMs: Math.round(totals.runtimeMs),
    workedTimeMs: Math.round(totals.workedTimeMs),
    pausedTimeMs: Math.round(totals.pausedTimeMs),
    faultTimeMs: Math.round(totals.faultTimeMs),
    offlineTimeMs: Math.round(totals.offlineTimeMs),
    shiftTimeMs: Math.round(shiftTimeMs),
    breakTimeMs: Math.round(breakTimeMs),
    timeCreditMs: Math.round(totals.timeCreditMs),
  };
}

function emptyEntityWindows() {
  return Object.fromEntries(WINDOW_DEFINITIONS.map(({ key }) => [key, emptyTotals()]));
}

function ensureMachine(machines, machine) {
  const serial = serialFromMachine(machine);
  if (serial === null) return null;
  const key = String(serial);
  if (!machines[key]) {
    machines[key] = {
      key,
      machine: { ...machine, id: machine?.id ?? serial, serial },
      totals: emptyEntityWindows(),
      activeOperatorKeys: [],
      status: -1,
      fault: "Offline",
    };
  }
  return machines[key];
}

function ensureOperator(operators, machine, operator) {
  const serial = serialFromMachine(machine);
  if (serial === null || operator?.id === undefined || operator?.id === null) return null;
  const key = `${serial}:${operator.id}`;
  if (!operators[key]) {
    operators[key] = {
      key,
      machine: { ...machine, id: machine?.id ?? serial, serial },
      operator: { ...operator, name: formatHumanName(operator.name, "Unknown") },
      totals: emptyEntityWindows(),
      active: false,
      status: -1,
      fault: "Offline",
    };
  }
  return operators[key];
}

function tickerItem(ticker, operator) {
  const items = ticker?.program?.items || ticker?.items || [];
  if (!Array.isArray(items) || !items.length) return null;
  const station = Number(operator?.station);
  return items.find((item) => Number(item?.station ?? item?.sortNumber) === station)
    || items[Math.max(0, station - 1)]
    || items[0];
}

function buildProductionStatsCache(documents, tickers, shifts, nowInput = new Date()) {
  const windows = productionWindowRanges(nowInput);
  const breakTimes = Object.fromEntries(
    Object.entries(windows).map(([key, range]) => [key, scheduledBreakMs(shifts, range.start, range.end)])
  );
  const shiftTimes = Object.fromEntries(
    Object.entries(windows).map(([key, range]) => [key, scheduledShiftMs(shifts, range.start, range.end)])
  );
  const machines = {};
  const operators = {};

  for (const document of Array.isArray(documents) ? documents : []) {
    const timestamp = new Date(document?.timestamps?.start || document?.timestamps?.create);
    if (Number.isNaN(timestamp.getTime())) continue;
    const entity = document.type === "machine"
      ? ensureMachine(machines, document.machine)
      : document.type === "operator-machine"
        ? ensureOperator(operators, document.machine, document.operator)
        : null;
    if (!entity) continue;
    for (const [key, range] of Object.entries(windows)) {
      if (timestamp >= range.start && timestamp < range.end) {
        addDocumentTotals(entity.totals[key], document);
      }
    }
  }

  for (const ticker of Array.isArray(tickers) ? tickers : []) {
    const machineEntity = ensureMachine(machines, ticker.machine);
    if (!machineEntity) continue;
    const status = Number(ticker?.status?.id ?? ticker?.status?.code ?? 0);
    machineEntity.status = status;
    machineEntity.fault = ticker?.status?.name || "Unknown";
    machineEntity.statusSince = ticker?.timestamps?.active
      || ticker?.timestamps?.create
      || ticker?.timestamps?.update
      || null;
    machineEntity.activeOperatorKeys = [];

    for (const operator of Array.isArray(ticker?.operators) ? ticker.operators : []) {
      if (!operator || operator.id === -1) continue;
      const operatorEntity = ensureOperator(operators, ticker.machine, operator);
      if (!operatorEntity) continue;
      operatorEntity.active = true;
      operatorEntity.status = status;
      operatorEntity.fault = machineEntity.fault;
      operatorEntity.statusSince = machineEntity.statusSince;
      operatorEntity.item = tickerItem(ticker, operator);
      machineEntity.activeOperatorKeys.push(operatorEntity.key);
    }
  }

  const finalize = (entity) => ({
    ...entity,
    stats: Object.fromEntries(Object.entries(windows).map(([key, range]) => [
      key,
      statsFromTotals(entity.totals[key], range, breakTimes[key], shiftTimes[key]),
    ])),
    totals: undefined,
  });

  return {
    updatedAt: new Date(nowInput),
    windows,
    machines: Object.fromEntries(Object.entries(machines).map(([key, entity]) => [key, finalize(entity)])),
    operators: Object.fromEntries(Object.entries(operators).map(([key, entity]) => [key, finalize(entity)])),
  };
}

async function loadProductionStatsCache(db, config, nowInput = new Date()) {
  const windows = productionWindowRanges(nowInput);
  const earliestStart = windows.last24Hours.start;
  const [documents, tickers, shifts] = await Promise.all([
    db.collection(config.totalsMinuteCollectionName).find({
      type: { $in: ["machine", "operator-machine"] },
      "timestamps.start": { $gte: earliestStart, $lt: new Date(nowInput) },
    }).toArray(),
    db.collection(config.stateTickerCollectionName).find({}).toArray(),
    db.collection(config.shiftCollectionName).find({ active: true }).toArray(),
  ]);
  return buildProductionStatsCache(documents, tickers, shifts, nowInput);
}

module.exports = {
  WINDOW_DEFINITIONS,
  buildProductionStatsCache,
  loadProductionStatsCache,
  productionWindowRanges,
  scheduledBreakMs,
  scheduledShiftMs,
  statsFromTotals,
};
