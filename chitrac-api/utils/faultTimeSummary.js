const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");

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

      const startTime = timeComponents(shift?.startTime);
      const endTime = timeComponents(shift?.endTime);
      if (!startTime || !endTime) continue;

      const shiftStart = day.set({ ...startTime, second: 0, millisecond: 0 });
      const shiftEnd = day.set({ ...endTime, second: 0, millisecond: 0 });
      if (shiftEnd <= shiftStart) continue;

      const clippedShift = intersectInterval(
        { start: shiftStart.toJSDate(), end: shiftEnd.toJSDate() },
        { start: rangeStart.toJSDate(), end: rangeEnd.toJSDate() }
      );
      if (!clippedShift) continue;

      const breakIntervals = (Array.isArray(shift?.breaks) ? shift.breaks : [])
        .filter((breakDoc) => breakDoc?.active !== false)
        .map((breakDoc) => {
          const breakStart = timeComponents(breakDoc?.startTime);
          const breakEnd = timeComponents(breakDoc?.endTime);
          if (!breakStart || !breakEnd) return null;
          return intersectInterval(
            {
              start: day.set({ ...breakStart, second: 0, millisecond: 0 }).toJSDate(),
              end: day.set({ ...breakEnd, second: 0, millisecond: 0 }).toJSDate(),
            },
            clippedShift
          );
        })
        .filter(Boolean);

      intervals.push(...subtractBreakIntervals(clippedShift, breakIntervals));
    }

    day = day.plus({ days: 1 });
  }

  return mergeIntervals(intervals);
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
    .project({ _id: 0, type: 1, operators: 1, timestamps: 1 })
    .toArray();

  const idSet = new Set(ids.map(String));
  const intervalsByOperator = new Map();

  for (const session of machineSessions) {
    const type = Number(session.type);
    if (!Number.isFinite(type)) continue;

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

module.exports = {
  getMachineFaultTimeBySerial,
  getOperatorFaultTimeByOperatorId,
  getOperatorMachineStateTimeByOperatorId,
};
