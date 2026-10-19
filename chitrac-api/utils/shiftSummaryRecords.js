const { DateTime } = require('luxon');
const { SYSTEM_TIMEZONE } = require('./time');
const { getShiftTimeComponents } = require('./shiftTimeComponents');
const { buildShiftScopedSessionWindows } = require('./shiftWindows');
const { calendarRange, normalizeTotalsDocument } = require('./totalsSchema');
const { getSessionDataForPartialDays, getOperatorSessionDataForPartialDays } = require('./reportFunctions');

async function getShiftSummaryRecords(db, shift, start, end, type, entityId) {
  const records = [];
  const components = getShiftTimeComponents(shift);
  const windows = buildShiftScopedSessionWindows(shift, start, end);
  for (const window of windows) {
    const localStart = DateTime.fromJSDate(window.start, { zone: SYSTEM_TIMEZONE });
    let shiftDay = localStart.startOf('day');
    const startMinutes = components.startTime.hour * 60 + components.startTime.minute;
    if (localStart.hour * 60 + localStart.minute < startMinutes) shiftDay = shiftDay.minus({ days: 1 });
    const fullStart = shiftDay.set({ ...components.startTime });
    let fullEnd = shiftDay.set({ ...components.endTime });
    if (fullEnd <= fullStart) fullEnd = fullEnd.plus({ days: 1 });
    // A daily shift cache cannot represent a clipped custom or in-progress window.
    let cached = [];
    if (+window.start === +fullStart && +window.end === +fullEnd) {
      const query = {
        type, 'timestamps.create': calendarRange(shiftDay.toISODate()),
        $or: [{ 'shift.id': { $in: [String(shift._id), shift._id] } },
          { 'shift._id': { $in: [String(shift._id), shift._id] } }],
      };
      if (entityId) query[type === 'operator-machine' ? 'operator.id' : 'machine.id'] = Number(entityId);
      cached = (await db.collection('totals-shift').find(query).toArray()).map(normalizeTotalsDocument);
    }
    if (cached.length) {
      records.push(...cached);
      continue;
    }
    const options = { shiftId: String(shift._id), includeUntaggedShift: true, exclusiveEnd: true };
    const sessions = type === 'operator-machine'
      ? (await getOperatorSessionDataForPartialDays(db, [window], entityId ? Number(entityId) : undefined, options)).operators
      : (await getSessionDataForPartialDays(db, [window], entityId ? Number(entityId) : undefined, options))[
        type === 'machine' ? 'machines' : 'machineItems'];
    records.push(...sessions.map(record => ({ ...record, timeRange: window })));
  }
  if (type !== 'machine') return records;
  const machines = new Map();
  for (const record of records) {
    const key = Number(record.machineSerial);
    if (!machines.has(key)) machines.set(key, { ...record, machineSerial: key,
      runtimeMs: 0, pausedTimeMs: 0, faultTimeMs: 0, workedTimeMs: 0,
      totalCounts: 0, totalMisfeeds: 0, totalTimeCreditMs: 0,
      downTimeMs: undefined, offlineTimeMs: undefined, breakTimeMs: undefined, totalFaults: undefined,
      timeRange: { start, end } });
    const total = machines.get(key);
    for (const field of ['runtimeMs', 'pausedTimeMs', 'faultTimeMs', 'workedTimeMs', 'totalCounts', 'totalMisfeeds', 'totalTimeCreditMs']) {
      total[field] += Number(record[field]) || 0;
    }
    for (const field of ['downTimeMs', 'offlineTimeMs', 'breakTimeMs', 'totalFaults']) {
      if (record[field] != null) {
        total[field] = (Number(total[field]) || 0) + (Number(record[field]) || 0);
      }
    }
  }
  return [...machines.values()];
}

module.exports = { getShiftSummaryRecords };
