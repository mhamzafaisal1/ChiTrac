const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");
const { getShiftTimeComponents, getTimeComponentsFromTimestamp } = require("./shiftTimeComponents");

const NON_FAULT_CODES = new Set([0, 1, "0", "1", null]);
const OPEN_FAULT_SESSION_CAP_MS = 5 * 60 * 1000;

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function numericId(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function serialFromEntity(entity) {
  return numericId(entity?.serial ?? entity?.id ?? entity?.serialNumber);
}

function operatorIdFromEntity(entity) {
  return numericId(entity?.id);
}

function overlapMs(start, end, rangeStart, rangeEnd) {
  const s = validDate(start);
  const e = validDate(end) || rangeEnd;
  if (!s || !e) return 0;

  const clampedStart = Math.max(s.getTime(), rangeStart.getTime());
  const clampedEnd = Math.min(e.getTime(), rangeEnd.getTime());
  return Math.max(0, clampedEnd - clampedStart);
}

function overlapQuery(start, end) {
  return {
    "timestamps.start": { $lt: end },
    $or: [
      { "timestamps.end": { $gt: start } },
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null },
    ],
  };
}

function idVariants(values) {
  const ids = Array.from(values).map(numericId).filter((value) => value !== null);
  return Array.from(new Set(ids.flatMap((value) => [value, String(value)])));
}

function addInterval(intervalsByOperator, operatorId, bucket, start, end) {
  if (!intervalsByOperator.has(operatorId)) {
    intervalsByOperator.set(operatorId, {
      runtime: [],
      pausedTime: [],
      faultTime: [],
    });
  }

  intervalsByOperator.get(operatorId)[bucket].push({ start, end });
}

function totalMergedMs(intervals) {
  return mergeIntervals(intervals).reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

function totalUncoveredMs(intervals, coveredIntervals) {
  const covered = mergeIntervals(coveredIntervals);
  let total = 0;

  for (const interval of mergeIntervals(intervals)) {
    let cursor = interval.start.getTime();
    const end = interval.end.getTime();

    for (const coveredInterval of covered) {
      const coveredStart = coveredInterval.start.getTime();
      const coveredEnd = coveredInterval.end.getTime();
      if (coveredEnd <= cursor) continue;
      if (coveredStart >= end) break;
      if (coveredStart > cursor) total += coveredStart - cursor;
      cursor = Math.max(cursor, coveredEnd);
      if (cursor >= end) break;
    }

    if (cursor < end) total += end - cursor;
  }

  return total;
}

function timeComponents(value) {
  const hour = value?.hour;
  const minute = value?.minute;
  if (typeof hour !== "number" || typeof minute !== "number") return null;
  return { hour, minute };
}

function sessionStateCode(session) {
  const stateStatus = session?.states?.start?.status;
  const stateCode = Number(stateStatus?.id ?? stateStatus?.code);
  if (Number.isFinite(stateCode)) return stateCode;

  const fromStartState = Number(session?.startState?.status?.id ?? session?.startState?.status?.code);
  if (Number.isFinite(fromStartState)) return fromStartState;

  const fromStatus = Number(session?.status?.id ?? session?.status?.code);
  if (Number.isFinite(fromStatus)) return fromStatus;

  const fromType = Number(session?.type);
  return Number.isFinite(fromType) ? fromType : null;
}

function sessionStateName(session) {
  return (
    session?.states?.start?.status?.name ||
    session?.startState?.status?.name ||
    session?.status?.name ||
    session?.endState?.status?.name ||
    session?.startState?.name ||
    session?.endState?.name ||
    "Fault"
  );
}

function realFaultSessionQuery() {
  return {
    $or: [
      { type: { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "status.code": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "status.id": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "startState.status.code": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "startState.status.id": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "states.start.status.id": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
      { "states.start.status.code": { $exists: true, $nin: Array.from(NON_FAULT_CODES) } },
    ],
  };
}

function clippedFaultSessionMs(session, rangeStart, rangeEnd) {
  const sessionStart = validDate(session?.timestamps?.start);
  if (!sessionStart) return 0;

  const storedEnd = validDate(session?.timestamps?.end);
  const cappedOpenEnd = new Date(Math.min(sessionStart.getTime() + OPEN_FAULT_SESSION_CAP_MS, rangeEnd.getTime()));
  const sessionEnd = storedEnd || cappedOpenEnd;

  return overlapMs(sessionStart, sessionEnd, rangeStart, rangeEnd);
}

function shiftWindowComponents(shift, zone = SYSTEM_TIMEZONE) {
  const startTime = timeComponents(shift?.startTime);
  const endTime = timeComponents(shift?.endTime);
  if (startTime && endTime) return { startTime, endTime };
  return getShiftTimeComponents(shift, zone);
}

function breakWindowComponents(breakDoc, zone = SYSTEM_TIMEZONE) {
  const startTime = timeComponents(breakDoc?.startTime);
  const endTime = timeComponents(breakDoc?.endTime);
  if (startTime && endTime) return { startTime, endTime };
  const start = getTimeComponentsFromTimestamp(breakDoc?.timestamps?.start, zone);
  const end = getTimeComponentsFromTimestamp(breakDoc?.timestamps?.end, zone);
  if (!start || !end) return null;
  return { startTime: start, endTime: end };
}

function lookupMergedTime(timeById, key) {
  if (key == null) return null;
  return timeById.get(Number(key)) || timeById.get(key) || timeById.get(String(key)) || null;
}

function intersectInterval(interval, boundary) {
  const startMs = Math.max(interval.start.getTime(), boundary.start.getTime());
  const endMs = Math.min(interval.end.getTime(), boundary.end.getTime());
  if (endMs <= startMs) return null;
  return { start: new Date(startMs), end: new Date(endMs) };
}

function subtractBreakIntervals(interval, breaks) {
  const segments = [];
  let cursorMs = interval.start.getTime();
  const endMs = interval.end.getTime();

  for (const breakInterval of mergeIntervals(breaks)) {
    const breakStartMs = breakInterval.start.getTime();
    const breakEndMs = breakInterval.end.getTime();
    if (breakEndMs <= cursorMs) continue;
    if (breakStartMs >= endMs) break;
    if (breakStartMs > cursorMs) {
      segments.push({ start: new Date(cursorMs), end: new Date(Math.min(breakStartMs, endMs)) });
    }
    cursorMs = Math.max(cursorMs, breakEndMs);
  }

  if (cursorMs < endMs) {
    segments.push({ start: new Date(cursorMs), end: new Date(endMs) });
  }

  return segments;
}

function buildShiftClipIntervals(shifts, start, end, zone = SYSTEM_TIMEZONE) {
  if (!Array.isArray(shifts) || shifts.length === 0) return null;

  const rangeStart = DateTime.fromJSDate(new Date(start), { zone });
  const rangeEnd = DateTime.fromJSDate(new Date(end), { zone });
  if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd <= rangeStart) return null;

  const intervals = [];
  let day = rangeStart.startOf("day");
  const lastDay = rangeEnd.minus({ milliseconds: 1 }).startOf("day");

  while (day <= lastDay) {
    for (const shift of shifts) {
      const activeDays = Array.isArray(shift?.activeDays) ? shift.activeDays : [];
      if (activeDays.length && !activeDays.includes(day.weekday)) continue;

      const window = shiftWindowComponents(shift, zone);
      if (!window?.startTime || !window?.endTime) continue;

      const shiftStart = day.set({ ...window.startTime, second: 0, millisecond: 0 });
      const shiftEnd = day.set({ ...window.endTime, second: 0, millisecond: 0 });
      if (shiftEnd <= shiftStart) continue;

      const clippedShift = intersectInterval(
        { start: shiftStart.toJSDate(), end: shiftEnd.toJSDate() },
        { start: rangeStart.toJSDate(), end: rangeEnd.toJSDate() }
      );
      if (!clippedShift) continue;

      const breakIntervals = (Array.isArray(shift?.breaks) ? shift.breaks : [])
        .filter((breakDoc) => breakDoc?.active !== false)
        .map((breakDoc) => {
          const breakWindow = breakWindowComponents(breakDoc, zone);
          if (!breakWindow) return null;
          return intersectInterval(
            {
              start: day.set({ ...breakWindow.startTime, second: 0, millisecond: 0 }).toJSDate(),
              end: day.set({ ...breakWindow.endTime, second: 0, millisecond: 0 }).toJSDate(),
            },
            clippedShift
          );
        })
        .filter(Boolean);

      intervals.push(...subtractBreakIntervals(clippedShift, breakIntervals));
    }

    day = day.plus({ days: 1 });
  }

  const merged = mergeIntervals(intervals);
  return merged.length ? merged : null;
}

function clipInterval(interval, clipIntervals) {
  if (!Array.isArray(clipIntervals)) return [interval];
  return clipIntervals.map((clip) => intersectInterval(interval, clip)).filter(Boolean);
}

async function getMachineFaultTimeBySerial(db, config, machineSerials, start, end) {
  const serials = idVariants(machineSerials);
  if (!config.faultSessionCollectionName || serials.length === 0) return new Map();

  const faultSessions = await db
    .collection(config.faultSessionCollectionName)
    .find({
      $and: [
        overlapQuery(start, end),
        {
          $or: [
            { "machine.serial": { $in: serials } },
            { "machine.id": { $in: serials } },
            { "machine.serialNumber": { $in: serials } },
          ],
        },
      ],
    })
    .project({ _id: 0, machine: 1, timestamps: 1 })
    .toArray();

  const faultTimeBySerial = new Map();
  for (const session of faultSessions) {
    const serial = serialFromEntity(session.machine);
    if (serial === null) continue;
    const duration = overlapMs(session.timestamps?.start, session.timestamps?.end, start, end);
    faultTimeBySerial.set(serial, (faultTimeBySerial.get(serial) || 0) + duration);
  }

  return faultTimeBySerial;
}

async function getMachineFaultSummariesBySerial(db, config, machineSerials, start, end) {
  const serials = idVariants(machineSerials);
  if (!config.machineSessionCollectionName || serials.length === 0) return new Map();

  const faultSessions = await db
    .collection(config.machineSessionCollectionName)
    .find({
      $and: [
        overlapQuery(start, end),
        realFaultSessionQuery(),
        {
          $or: [
            { "machine.serial": { $in: serials } },
            { "machine.id": { $in: serials } },
            { "machine.serialNumber": { $in: serials } },
          ],
        },
      ],
    })
    .project({
      _id: 0,
      activeStations: 1,
      machine: 1,
      operators: 1,
      startState: 1,
      endState: 1,
      status: 1,
      states: 1,
      timestamps: 1,
      type: 1,
    })
    .sort({ "timestamps.start": 1 })
    .toArray();

  const summariesBySerial = new Map();
  for (const session of faultSessions) {
    const serial = serialFromEntity(session.machine);
    if (serial === null) continue;

    const code = sessionStateCode(session);
    if (NON_FAULT_CODES.has(code)) continue;

    const durationSeconds = Math.max(0, Math.floor(clippedFaultSessionMs(session, start, end) / 1000));
    if (durationSeconds <= 0) continue;

    if (!summariesBySerial.has(serial)) summariesBySerial.set(serial, new Map());
    const summaryMap = summariesBySerial.get(serial);
    const name = sessionStateName(session);
    const key = `${code ?? ""}|${name}`;
    const activeStations = typeof session.activeStations === "number"
      ? session.activeStations
      : (Array.isArray(session.operators) ? session.operators.length : 0);
    const summary = summaryMap.get(key) || {
      code,
      name,
      count: 0,
      totalDurationSeconds: 0,
      totalWorkTimeMissedSeconds: 0,
    };

    summary.count += 1;
    summary.totalDurationSeconds += durationSeconds;
    summary.totalWorkTimeMissedSeconds += activeStations * durationSeconds;
    summaryMap.set(key, summary);
  }

  const result = new Map();
  for (const [serial, summaryMap] of summariesBySerial) {
    const summaries = Array.from(summaryMap.values())
      .map((summary) => ({
        ...summary,
        formatted: {
          hours: Math.floor(summary.totalDurationSeconds / 3600),
          minutes: Math.floor((summary.totalDurationSeconds % 3600) / 60),
          seconds: summary.totalDurationSeconds % 60,
        },
      }))
      .sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds || b.count - a.count);
    result.set(serial, summaries);
  }

  return result;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .map((interval) => ({
      start: validDate(interval.start),
      end: validDate(interval.end),
    }))
    .filter((interval) => interval.start && interval.end && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
      continue;
    }
    if (interval.end > previous.end) previous.end = interval.end;
  }

  return merged;
}

async function getOperatorFaultTimeByOperatorId(db, config, operatorIds, start, end) {
  const ids = idVariants(operatorIds);
  if (
    !config.faultSessionCollectionName ||
    !config.operatorSessionCollectionName ||
    ids.length === 0
  ) {
    return new Map();
  }

  const operatorSessions = await db
    .collection(config.operatorSessionCollectionName)
    .find({
      ...overlapQuery(start, end),
      "operator.id": { $in: ids },
    })
    .project({ _id: 0, operator: 1, machine: 1, timestamps: 1 })
    .toArray();

  const intervalsBySerial = new Map();
  const faultIntervalsByOperator = new Map();
  for (const session of operatorSessions) {
    const operatorId = operatorIdFromEntity(session.operator);
    const serial = serialFromEntity(session.machine);
    if (operatorId === null || serial === null) continue;

    const sessionStart = validDate(session.timestamps?.start);
    const sessionEnd = validDate(session.timestamps?.end) || end;
    if (!sessionStart || !sessionEnd) continue;

    const interval = {
      operatorId,
      serial,
      start: new Date(Math.max(sessionStart.getTime(), start.getTime())),
      end: new Date(Math.min(sessionEnd.getTime(), end.getTime())),
    };
    if (interval.end <= interval.start) continue;

    if (!intervalsBySerial.has(serial)) intervalsBySerial.set(serial, []);
    intervalsBySerial.get(serial).push(interval);
  }

  const serials = idVariants(intervalsBySerial.keys());
  if (serials.length === 0) return new Map();

  const machineFaults = await db
    .collection(config.faultSessionCollectionName)
    .find({
      $and: [
        overlapQuery(start, end),
        {
          $or: [
            { "machine.serial": { $in: serials } },
            { "machine.id": { $in: serials } },
            { "machine.serialNumber": { $in: serials } },
          ],
        },
      ],
    })
    .project({ _id: 0, machine: 1, timestamps: 1 })
    .toArray();

  for (const fault of machineFaults) {
    const serial = serialFromEntity(fault.machine);
    const faultStart = validDate(fault.timestamps?.start);
    const faultEnd = validDate(fault.timestamps?.end) || end;
    if (serial === null) continue;
    const intervals = intervalsBySerial.get(serial) || [];
    for (const interval of intervals) {
      const duration = overlapMs(fault.timestamps?.start, fault.timestamps?.end, interval.start, interval.end);
      if (duration <= 0) continue;
      if (!faultStart || !faultEnd) continue;
      if (!faultIntervalsByOperator.has(interval.operatorId)) {
        faultIntervalsByOperator.set(interval.operatorId, []);
      }
      faultIntervalsByOperator.get(interval.operatorId).push({
        start: new Date(Math.max(faultStart.getTime(), interval.start.getTime())),
        end: new Date(Math.min(faultEnd.getTime(), interval.end.getTime())),
      });
    }
  }

  const faultTimeByOperator = new Map();
  for (const [operatorId, intervals] of faultIntervalsByOperator) {
    const merged = mergeIntervals(intervals);
    const total = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
    faultTimeByOperator.set(operatorId, total);
  }

  return faultTimeByOperator;
}

async function getOperatorMachineStateTimeByOperatorId(db, config, operatorIds, start, end, options = {}) {
  const ids = idVariants(operatorIds);
  if (!config.machineSessionCollectionName || ids.length === 0) {
    return new Map();
  }

  const clipIntervals = buildShiftClipIntervals(options.activeShifts, start, end, options.zone);

  const machineSessions = await db
    .collection(config.machineSessionCollectionName)
    .find({
      ...overlapQuery(start, end),
      "operators.id": { $in: ids },
    })
    .project({ _id: 0, type: 1, status: 1, operators: 1, timestamps: 1 })
    .toArray();

  const idSet = new Set(ids.map(String));
  const intervalsByOperator = new Map();

  for (const session of machineSessions) {
    const type = sessionStateCode(session);
    if (type === null) continue;

    const sessionStart = validDate(session.timestamps?.start);
    const sessionEnd = validDate(session.timestamps?.end) || end;
    if (!sessionStart || !sessionEnd) continue;

    const interval = {
      start: new Date(Math.max(sessionStart.getTime(), start.getTime())),
      end: new Date(Math.min(sessionEnd.getTime(), end.getTime())),
    };
    if (interval.end <= interval.start) continue;

    const bucket = type === 0 ? "pausedTime" : type === 1 ? "runtime" : type > 1 ? "faultTime" : null;
    if (!bucket) continue;
    for (const clipped of clipInterval(interval, clipIntervals)) {
      for (const operator of session.operators || []) {
        const operatorId = operatorIdFromEntity(operator);
        if (operatorId === null || !idSet.has(String(operatorId))) continue;
        addInterval(intervalsByOperator, operatorId, bucket, clipped.start, clipped.end);
      }
    }
  }

  const totalsByOperator = new Map();
  for (const [operatorId, intervals] of intervalsByOperator) {
    const faultIntervals = mergeIntervals(intervals.faultTime);
    const runtimeIntervals = mergeIntervals(intervals.runtime);
    totalsByOperator.set(operatorId, {
      runtime: totalMergedMs(runtimeIntervals),
      pausedTime: totalUncoveredMs(intervals.pausedTime, [...runtimeIntervals, ...faultIntervals]),
      faultTime: totalMergedMs(faultIntervals),
    });
  }

  return totalsByOperator;
}

async function getMachineStateTimeBySerial(db, config, machineSerials, start, end, options = {}) {
  const serials = idVariants(machineSerials);
  if (!config.machineSessionCollectionName || serials.length === 0) {
    return new Map();
  }

  const clipIntervals = buildShiftClipIntervals(options.activeShifts, start, end, options.zone);
  const sessionMatch = {
    $and: [
      overlapQuery(start, end),
      {
        $or: [
          { "machine.serial": { $in: serials } },
          { "machine.id": { $in: serials } },
          { "machine.serialNumber": { $in: serials } },
        ],
      },
    ],
  };

  if (options.shiftId) {
    const shiftId = String(options.shiftId);
    sessionMatch.$and.push({
      $or: ObjectId.isValid(shiftId)
        ? [{ "shift._id": shiftId }, { "shift._id": new ObjectId(shiftId) }]
        : [{ "shift._id": shiftId }],
    });
  }

  const machineSessions = await db
    .collection(config.machineSessionCollectionName)
    .find(sessionMatch)
    .project({ _id: 0, type: 1, status: 1, machine: 1, timestamps: 1 })
    .toArray();

  const serialSet = new Set(serials.map(String));
  const intervalsBySerial = new Map();

  for (const session of machineSessions) {
    const serial = serialFromEntity(session.machine);
    if (serial === null || !serialSet.has(String(serial))) continue;

    const type = sessionStateCode(session);
    if (type === null) continue;

    const sessionStart = validDate(session.timestamps?.start);
    const sessionEnd = validDate(session.timestamps?.end) || end;
    if (!sessionStart || !sessionEnd) continue;

    const interval = {
      start: new Date(Math.max(sessionStart.getTime(), start.getTime())),
      end: new Date(Math.min(sessionEnd.getTime(), end.getTime())),
    };
    if (interval.end <= interval.start) continue;

    const bucket = type === 0 ? "pausedTime" : type === 1 ? "runtime" : type > 1 ? "faultTime" : null;
    if (!bucket) continue;

    if (!intervalsBySerial.has(serial)) {
      intervalsBySerial.set(serial, {
        runtime: [],
        pausedTime: [],
        faultTime: [],
      });
    }

    for (const clipped of clipInterval(interval, clipIntervals)) {
      intervalsBySerial.get(serial)[bucket].push(clipped);
    }
  }

  const totalsBySerial = new Map();
  for (const [serial, intervals] of intervalsBySerial) {
    const faultIntervals = mergeIntervals(intervals.faultTime);
    const runtimeIntervals = mergeIntervals(intervals.runtime);
    totalsBySerial.set(serial, {
      runtime: totalMergedMs(runtimeIntervals),
      pausedTime: totalUncoveredMs(intervals.pausedTime, [...runtimeIntervals, ...faultIntervals]),
      faultTime: totalMergedMs(faultIntervals),
    });
  }

  return totalsBySerial;
}

module.exports = {
  getMachineFaultTimeBySerial,
  getMachineFaultSummariesBySerial,
  getOperatorFaultTimeByOperatorId,
  getOperatorMachineStateTimeByOperatorId,
  getMachineStateTimeBySerial,
  lookupMergedTime,
  mergeIntervals,
};
