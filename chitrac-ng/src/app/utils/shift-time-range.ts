import type { ShiftListItem } from '../services/shift.service';

/** Keeps the unfiltered dates so switching/clearing shifts cannot move the range. */
export class ShiftTimeRange {
  private base?: { start: Date; end: Date };
  private applied?: { start: number; end: number };

  reset(): void { this.base = undefined; this.applied = undefined; }

  apply(start: Date, end: Date, mode: string, shift?: ShiftListItem): { start: Date; end: Date } {
    if (!this.applied || +start !== this.applied.start || +end !== this.applied.end) {
      this.base = { start: new Date(start), end: new Date(end) };
    }
    const range = { start: new Date(this.base!.start), end: new Date(this.base!.end) };
    if (this.validTime(shift?.startTime) && this.validTime(shift?.endTime)) {
      // Completed presets end at the next period's exclusive midnight.
      if (['yesterday', 'lastWeek', 'lastMonth', 'lastYear'].includes(mode) &&
          range.end.getHours() === 0 && range.end.getMinutes() === 0 && range.end > range.start) {
        range.end.setDate(range.end.getDate() - 1);
      }
      range.start.setHours(shift!.startTime!.hour, shift!.startTime!.minute, 0, 0);
      range.end.setHours(shift!.endTime!.hour, shift!.endTime!.minute, 0, 0);
      if (shift!.endTime!.hour * 60 + shift!.endTime!.minute <=
          shift!.startTime!.hour * 60 + shift!.startTime!.minute) {
        range.end.setDate(range.end.getDate() + 1);
      }
    }
    this.applied = { start: +range.start, end: +range.end };
    return range;
  }

  private validTime(time?: { hour: number; minute: number }): boolean {
    return !!time && Number.isInteger(time.hour) && time.hour >= 0 && time.hour < 24 &&
      Number.isInteger(time.minute) && time.minute >= 0 && time.minute < 60;
  }
}
