import type { ShiftListItem } from '../services/shift.service';

/** Uses the same local calendar/time convention as the timeframe pickers. */
export function futureTodayShiftStart(
  timeframe: string, shiftId: string | null, shifts: ShiftListItem[] | null,
  now: Date = new Date()
): number | null {
  if (timeframe !== 'today' || !shiftId) return null;
  const time = shifts?.find(shift => String(shift._id) === shiftId)?.startTime;
  if (!time || !Number.isInteger(time.hour) || !Number.isInteger(time.minute) ||
      time.hour < 0 || time.hour > 23 || time.minute < 0 || time.minute > 59) return null;
  const start = new Date(now);
  start.setHours(time.hour, time.minute, 0, 0);
  return start.getTime() > now.getTime() ? start.getTime() : null;
}
