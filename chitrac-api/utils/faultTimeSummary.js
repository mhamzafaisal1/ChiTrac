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

module.exports = {
  getMachineFaultTimeBySerial,
  getOperatorFaultTimeByOperatorId,
};
