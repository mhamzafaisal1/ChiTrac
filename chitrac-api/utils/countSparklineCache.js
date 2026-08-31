const { DateTime } = require("luxon");
const { loadActiveShifts } = require("./shiftElapsed");
const { SYSTEM_TIMEZONE } = require("./time");
const { getShiftTimeComponents } = require("./shiftTimeComponents");

const LOOKBACK_MINUTES = 60;
const SPARKLINE_SHIFT_STATES = Object.freeze({
  SHIFT: "shift",
  BREAK: "break",
  OUTSIDE_SHIFT: "outsideShift",
});

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

function timeComponentsFromObject(value) {
  if (!value) return null;
  const hour = Number(value.hour);
  const minute = Number(value.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function shiftTimeComponents(shift) {
  const startTime = timeComponentsFromObject(shift?.startTime);
  const endTime = timeComponentsFromObject(shift?.endTime);
  if (startTime && endTime) return { startTime, endTime };
  return getShiftTimeComponents(shift);
}

function minutesFromTime(time) {
  return (Number(time.hour) * 60) + Number(time.minute);
}

function normalizeShiftForSparkline(shift) {
  const components = shiftTimeComponents(shift);
  const activeDays = Array.isArray(shift?.activeDays) ? shift.activeDays : [];
  if (!components || activeDays.length === 0) return null;

  const startMin = minutesFromTime(components.startTime);
  const endMin = minutesFromTime(components.endTime);
  if (endMin <= startMin) return null;

  return {
    startMin,
    endMin,
    activeDays,
    breaks: Array.isArray(shift?.breaks) ? shift.breaks : [],
  };
}

function breakTimeComponents(shiftBreak) {
  const startTime = timeComponentsFromObject(shiftBreak?.startTime);
  const endTime = timeComponentsFromObject(shiftBreak?.endTime);
  if (startTime && endTime) return { startTime, endTime };

  const timestampComponents = getShiftTimeComponents(shiftBreak);
  return timestampComponents;
}

function minuteFallsInBreak(localMinuteOfDay, shift) {
  return shift.breaks.some((shiftBreak) => {
    const components = breakTimeComponents(shiftBreak);
    if (!components) return false;

    const startMin = minutesFromTime(components.startTime);
    const endMin = minutesFromTime(components.endTime);
    if (endMin <= startMin) return false;

    return localMinuteOfDay >= startMin && localMinuteOfDay < endMin;
  });
}

function buildShiftStateClassifier(shifts, zone = SYSTEM_TIMEZONE) {
  const normalizedShifts = (Array.isArray(shifts) ? shifts : [])
    .map(normalizeShiftForSparkline)
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);

  return (minuteStart) => {
    if (!normalizedShifts.length) return SPARKLINE_SHIFT_STATES.OUTSIDE_SHIFT;

    const localMinute = DateTime.fromJSDate(new Date(minuteStart), { zone });
    if (!localMinute.isValid) return SPARKLINE_SHIFT_STATES.OUTSIDE_SHIFT;

    const localMinuteOfDay = (localMinute.hour * 60) + localMinute.minute;
    const activeShift = normalizedShifts.find((shift) =>
      shift.activeDays.includes(localMinute.weekday) &&
      localMinuteOfDay >= shift.startMin &&
      localMinuteOfDay < shift.endMin
    );

    if (!activeShift) return SPARKLINE_SHIFT_STATES.OUTSIDE_SHIFT;
    return minuteFallsInBreak(localMinuteOfDay, activeShift)
      ? SPARKLINE_SHIFT_STATES.BREAK
      : SPARKLINE_SHIFT_STATES.SHIFT;
  };
}

function emptyMinuteSeries(startMinute, endMinuteExclusive, classifyShiftState = () => SPARKLINE_SHIFT_STATES.SHIFT) {
  const points = [];
  for (let cursor = new Date(startMinute); cursor < endMinuteExclusive; cursor = addMinutes(cursor, 1)) {
    points.push({
      minuteStart: cursor.toISOString(),
      count: 0,
      shiftState: classifyShiftState(cursor),
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

function buildPayload(machineSerials, startMinute, endMinuteExclusive, bucketMap, shiftStateClassifier, updatedAt = new Date()) {
  const machines = {};
  const totalsByMinute = new Map();

  for (const serial of machineSerials) {
    const points = emptyMinuteSeries(startMinute, endMinuteExclusive, shiftStateClassifier).map((point) => {
      const count = bucketMap.get(`${serial}|${point.minuteStart}`) || 0;
      totalsByMinute.set(point.minuteStart, (totalsByMinute.get(point.minuteStart) || 0) + count);
      return { ...point, count };
    });

    machines[String(serial)] = points;
  }

  const allMachines = emptyMinuteSeries(startMinute, endMinuteExclusive, shiftStateClassifier).map((point) => ({
    minuteStart: point.minuteStart,
    count: totalsByMinute.get(point.minuteStart) || 0,
    shiftState: point.shiftState,
  }));

  return {
    lookbackMinutes: LOOKBACK_MINUTES,
    updatedAt,
    range: {
      start: startMinute,
      end: endMinuteExclusive,
    },
    machineSerials,
    machines,
    allMachines,
  };
}

async function buildLastHourCountSparklineCache(db, config, nowInput = new Date()) {
  const endMinute = floorToMinute(nowInput);
  const startMinute = addMinutes(endMinute, -LOOKBACK_MINUTES);
  const [machineSerials, bucketMap, activeShifts] = await Promise.all([
    loadActiveMachineSerials(db, config),
    aggregateCountBuckets(db, config, startMinute, endMinute),
    loadActiveShifts(db, { collectionName: config.shiftCollectionName }),
  ]);
  const shiftStateClassifier = buildShiftStateClassifier(activeShifts);

  return buildPayload(machineSerials, startMinute, endMinute, bucketMap, shiftStateClassifier);
}

async function appendCompletedMinuteCountSparklineCache(db, config, existingCache, nowInput = new Date()) {
  return buildLastHourCountSparklineCache(db, config, nowInput);
}

module.exports = {
  LOOKBACK_MINUTES,
  SPARKLINE_SHIFT_STATES,
  buildLastHourCountSparklineCache,
  appendCompletedMinuteCountSparklineCache,
};
