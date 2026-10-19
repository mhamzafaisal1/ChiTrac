const { DateTime } = require('luxon');
const { SYSTEM_TIMEZONE } = require('./time');
const { getShiftTimeComponents } = require('./shiftTimeComponents');

// Half-open windows keep adjacent dates/shifts from counting a boundary twice.
function buildShiftScopedSessionWindows(shift, start, end) {
  const components = getShiftTimeComponents(shift);
  const from = DateTime.fromJSDate(new Date(start), { zone: SYSTEM_TIMEZONE });
  const to = DateTime.fromJSDate(new Date(end), { zone: SYSTEM_TIMEZONE });
  if (!components || !from.isValid || !to.isValid || to <= from) return [];
  const days = shift.activeDays?.length ? shift.activeDays : [1, 2, 3, 4, 5, 6, 7];
  const overnight = components.endTime.hour * 60 + components.endTime.minute <=
    components.startTime.hour * 60 + components.startTime.minute;
  let day = from.startOf('day').minus({ days: overnight ? 1 : 0 });
  const windows = [];
  while (day < to) {
    if (days.includes(day.weekday)) {
      const shiftStart = day.set({ ...components.startTime, second: 0, millisecond: 0 });
      const shiftEnd = day.plus({ days: overnight ? 1 : 0 })
        .set({ ...components.endTime, second: 0, millisecond: 0 });
      const windowStart = DateTime.max(from, shiftStart);
      const windowEnd = DateTime.min(to, shiftEnd);
      if (windowEnd > windowStart) windows.push({ start: windowStart.toJSDate(), end: windowEnd.toJSDate() });
    }
    day = day.plus({ days: 1 });
  }
  return windows;
}

function durationInWindows(start, end, windows) {
  return windows.reduce((total, window) => total + Math.max(0,
    Math.min(+new Date(end), +window.end) - Math.max(+new Date(start), +window.start)), 0);
}

module.exports = { buildShiftScopedSessionWindows, durationInWindows };
