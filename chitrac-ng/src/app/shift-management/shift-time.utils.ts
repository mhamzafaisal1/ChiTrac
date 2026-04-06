import { ShiftTimeValue } from '../services/shift.service';

export interface EditableBreak {
  startTime: ShiftTimeValue;
  endTime: ShiftTimeValue;
}

export function toMinutes(time: ShiftTimeValue): number {
  return (time.hour * 60) + time.minute;
}

export function compareTimes(a: ShiftTimeValue, b: ShiftTimeValue): number {
  return toMinutes(a) - toMinutes(b);
}

export function formatTime(time: ShiftTimeValue): string {
  let hour12 = time.hour % 12;
  if (hour12 === 0) {
    hour12 = 12;
  }
  const minute = time.minute.toString().padStart(2, '0');
  const suffix = time.hour >= 12 ? 'PM' : 'AM';
  return `${hour12}:${minute} ${suffix}`;
}

export function doBreaksOverlap(a: EditableBreak, b: EditableBreak): boolean {
  const aStart = toMinutes(a.startTime);
  const aEnd = toMinutes(a.endTime);
  const bStart = toMinutes(b.startTime);
  const bEnd = toMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function isBreakWithinShift(
  breakValue: EditableBreak,
  shiftStart: ShiftTimeValue,
  shiftEnd: ShiftTimeValue
): boolean {
  const shiftStartMinutes = toMinutes(shiftStart);
  const shiftEndMinutes = toMinutes(shiftEnd);
  const breakStartMinutes = toMinutes(breakValue.startTime);
  const breakEndMinutes = toMinutes(breakValue.endTime);

  return breakStartMinutes >= shiftStartMinutes && breakEndMinutes <= shiftEndMinutes;
}

export function sortBreaksChronologically(breaks: EditableBreak[]): EditableBreak[] {
  return [...breaks].sort((a, b) => compareTimes(a.startTime, b.startTime));
}

export function toTimeValue(date: Date): ShiftTimeValue {
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

export function toDateFromTimeValue(time: ShiftTimeValue): Date {
  const result = new Date();
  result.setHours(time.hour, time.minute, 0, 0);
  return result;
}
