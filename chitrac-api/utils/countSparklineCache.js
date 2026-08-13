const LOOKBACK_MINUTES = 60;

function floorToMinute(dateInput) {
  const date = new Date(dateInput);
  date.setSeconds(0, 0);
  return date;
}

function addMinutes(dateInput, minutes) {
  return new Date(new Date(dateInput).getTime() + minutes * 60000);
}

function minuteKey(dateInput) {
  return floorToMinute(dateInput).toISOString();
}

function machineSerialFromCount(count) {
  const serial = Number(count?.machine?.serial ?? count?.machine?.id);
  return Number.isFinite(serial) ? serial : null;
}

function emptyMinuteSeries(startMinute, endMinuteExclusive) {
  const points = [];
  for (let cursor = new Date(startMinute); cursor < endMinuteExclusive; cursor = addMinutes(cursor, 1)) {
    points.push({
      minuteStart: cursor.toISOString(),
      count: 0,
    });
  }
  return points;
}

async function loadActiveMachineSerials(db, config) {
  const machines = await db
    .collection(config.machineCollectionName)
    .find({ active: { $ne: false } })
    .project({ _id: 0, id: 1, serial: 1 })
    .toArray();

  return machines
    .map((machine) => Number(machine.id ?? machine.serial))
    .filter(Number.isFinite);
}

async function aggregateCountBuckets(db, config, start, end) {
  const counts = await db
    .collection(config.countCollectionName)
    .find({
      timestamp: { $gte: start, $lt: end },
      misfeed: { $ne: true },
    })
    .project({ _id: 0, timestamp: 1, machine: 1 })
    .toArray();

  const buckets = new Map();
  for (const count of counts) {
    const serial = machineSerialFromCount(count);
    const timestamp = new Date(count.timestamp);
    if (serial === null || Number.isNaN(timestamp.getTime())) continue;

    const key = `${serial}|${minuteKey(timestamp)}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return buckets;
}

function buildPayload(machineSerials, startMinute, endMinuteExclusive, bucketMap, updatedAt = new Date()) {
  const machines = {};
  const totalsByMinute = new Map();

  for (const serial of machineSerials) {
    const points = emptyMinuteSeries(startMinute, endMinuteExclusive).map((point) => {
      const count = bucketMap.get(`${serial}|${point.minuteStart}`) || 0;
      totalsByMinute.set(point.minuteStart, (totalsByMinute.get(point.minuteStart) || 0) + count);
      return { ...point, count };
    });

    machines[String(serial)] = points;
  }

  const allMachines = emptyMinuteSeries(startMinute, endMinuteExclusive).map((point) => ({
    minuteStart: point.minuteStart,
    count: totalsByMinute.get(point.minuteStart) || 0,
  }));

  return {
    lookbackMinutes: LOOKBACK_MINUTES,
    updatedAt,
    range: {
      start: startMinute,
      end: endMinuteExclusive,
    },
    machines,
    allMachines,
  };
}

async function buildLastHourCountSparklineCache(db, config, nowInput = new Date()) {
  const endMinute = floorToMinute(nowInput);
  const startMinute = addMinutes(endMinute, -LOOKBACK_MINUTES);
  const [machineSerials, bucketMap] = await Promise.all([
    loadActiveMachineSerials(db, config),
    aggregateCountBuckets(db, config, startMinute, endMinute),
  ]);

  return buildPayload(machineSerials, startMinute, endMinute, bucketMap);
}

async function appendCompletedMinuteCountSparklineCache(db, config, existingCache, nowInput = new Date()) {
  const completedMinuteStart = addMinutes(floorToMinute(nowInput), -1);
  const completedMinuteEnd = addMinutes(completedMinuteStart, 1);
  const keepStart = addMinutes(completedMinuteEnd, -LOOKBACK_MINUTES);
  const [machineSerials, bucketMap] = await Promise.all([
    loadActiveMachineSerials(db, config),
    aggregateCountBuckets(db, config, completedMinuteStart, completedMinuteEnd),
  ]);

  const previousMachines = existingCache?.machines || {};
  const nextMachines = {};

  for (const serial of machineSerials) {
    const serialKey = String(serial);
    const previousPoints = Array.isArray(previousMachines[serialKey]) ? previousMachines[serialKey] : [];
    const count = bucketMap.get(`${serial}|${completedMinuteStart.toISOString()}`) || 0;
    const pointsByMinute = new Map(
      previousPoints
        .filter((point) => new Date(point.minuteStart) >= keepStart)
        .map((point) => [point.minuteStart, { minuteStart: point.minuteStart, count: Number(point.count) || 0 }])
    );

    pointsByMinute.set(completedMinuteStart.toISOString(), {
      minuteStart: completedMinuteStart.toISOString(),
      count,
    });

    nextMachines[serialKey] = emptyMinuteSeries(keepStart, completedMinuteEnd).map((point) => (
      pointsByMinute.get(point.minuteStart) || point
    ));
  }

  const totalsByMinute = new Map();
  for (const points of Object.values(nextMachines)) {
    for (const point of points) {
      totalsByMinute.set(point.minuteStart, (totalsByMinute.get(point.minuteStart) || 0) + (Number(point.count) || 0));
    }
  }

  return {
    lookbackMinutes: LOOKBACK_MINUTES,
    updatedAt: new Date(),
    range: {
      start: keepStart,
      end: completedMinuteEnd,
    },
    machines: nextMachines,
    allMachines: emptyMinuteSeries(keepStart, completedMinuteEnd).map((point) => ({
      minuteStart: point.minuteStart,
      count: totalsByMinute.get(point.minuteStart) || 0,
    })),
  };
}

module.exports = {
  LOOKBACK_MINUTES,
  buildLastHourCountSparklineCache,
  appendCompletedMinuteCountSparklineCache,
};
