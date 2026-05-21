import { Injectable } from "@angular/core";
import { BehaviorSubject, Subject } from "rxjs";
import { ShiftListItem } from "./shift.service";

export interface DashboardTimeframeSelection {
  start: Date;
  end: Date;
  shiftId: string;
  mode: "current" | "shift";
}

@Injectable({
  providedIn: "root",
})
export class DateTimeService {
  private startTimeSubject = new BehaviorSubject<string>("");
  private endTimeSubject = new BehaviorSubject<string>("");
  private timeframeSubject = new BehaviorSubject<string>("");
  private confirmTriggerSubject = new Subject<void>();
  private confirmedSubject = new BehaviorSubject<boolean>(false);
  private lastConfirmedAt: Date | null = null;

  startTime$ = this.startTimeSubject.asObservable();
  endTime$ = this.endTimeSubject.asObservable();
  timeframe$ = this.timeframeSubject.asObservable();
  confirmTrigger$ = this.confirmTriggerSubject.asObservable();
  confirmed$ = this.confirmedSubject.asObservable();

  setConfirmed(value: boolean) {
    this.confirmedSubject.next(value);
    this.lastConfirmedAt = value ? new Date() : null;
  }

  getConfirmed(): boolean {
    return this.confirmedSubject.getValue();
  }

  getLastConfirmedAt(): Date | null {
    return this.lastConfirmedAt;
  }

  setStartTime(time: string) {
    this.startTimeSubject.next(time);
  }

  setEndTime(time: string) {
    this.endTimeSubject.next(time);
  }

  getStartTime(): string {
    return this.startTimeSubject.getValue();
  }

  getEndTime(): string {
    return this.endTimeSubject.getValue();
  }

  setTimeframe(timeframe: string) {
    this.timeframeSubject.next(timeframe);
  }

  getTimeframe(): string {
    return this.timeframeSubject.getValue();
  }

  triggerConfirm() {
    this.confirmTriggerSubject.next();
  }

  private liveModeSubject = new BehaviorSubject<boolean>(true); // live mode ON by default
  liveMode$ = this.liveModeSubject.asObservable();

  setLiveMode(isLive: boolean) {
    this.liveModeSubject.next(isLive);
  }

  getLiveMode(): boolean {
    return this.liveModeSubject.getValue();
  }

  /** Empty string = no shift filter (all data). */
  private shiftIdSubject = new BehaviorSubject<string>("");
  shiftId$ = this.shiftIdSubject.asObservable();

  setShiftId(id: string | null | undefined) {
    this.shiftIdSubject.next(id ? String(id) : "");
  }

  getShiftId(): string {
    return this.shiftIdSubject.getValue();
  }

  applyDashboardDefaultTimeframe(
    dashboardTimeframe: "current" | "shift" | null | undefined,
    shifts: ShiftListItem[] | null | undefined,
    now: Date = new Date()
  ): DashboardTimeframeSelection {
    const selection = this.resolveDashboardDefaultTimeframe(
      dashboardTimeframe,
      shifts,
      now
    );

    this.setStartTime(this.formatDateForInput(selection.start));
    this.setEndTime(this.formatDateForInput(selection.end));
    this.setShiftId(selection.shiftId);
    return selection;
  }

  resolveDashboardDefaultTimeframe(
    dashboardTimeframe: "current" | "shift" | null | undefined,
    shifts: ShiftListItem[] | null | undefined,
    now: Date = new Date()
  ): DashboardTimeframeSelection {
    const current = this.currentSelection(now);
    if (dashboardTimeframe !== "shift" || !Array.isArray(shifts) || shifts.length === 0) {
      return current;
    }

    const today = this.toIsoWeekday(now);
    const nowMinutes = this.toMinutes({ hour: now.getHours(), minute: now.getMinutes() });
    const todayShifts = shifts
      .filter((shift) => shift?.active !== false)
      .filter((shift) => this.isValidShift(shift))
      .filter((shift) => !Array.isArray(shift.activeDays) || shift.activeDays.includes(today))
      .sort((a, b) => this.toMinutes(a.startTime!) - this.toMinutes(b.startTime!));

    if (todayShifts.length === 0) {
      return current;
    }

    const activeShift = todayShifts.find((shift) => {
      const start = this.toMinutes(shift.startTime!);
      const end = this.toMinutes(shift.endTime!);
      return nowMinutes >= start && nowMinutes < end;
    });

    if (activeShift) {
      return {
        start: this.dateFromShiftTime(now, activeShift.startTime!),
        end: new Date(now),
        shiftId: activeShift._id || "",
        mode: "shift",
      };
    }

    const previousShift = [...todayShifts]
      .reverse()
      .find((shift) => this.toMinutes(shift.startTime!) <= nowMinutes);

    if (!previousShift) {
      return current;
    }

    return {
      start: this.dateFromShiftTime(now, previousShift.startTime!),
      end: this.dateFromShiftTime(now, previousShift.endTime!),
      shiftId: previousShift._id || "",
      mode: "shift",
    };
  }

  formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private currentSelection(now: Date): DashboardTimeframeSelection {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      start,
      end: new Date(now),
      shiftId: "",
      mode: "current",
    };
  }

  private isValidShift(shift: ShiftListItem): boolean {
    if (!shift?._id || !shift.startTime || !shift.endTime) {
      return false;
    }
    const start = this.toMinutes(shift.startTime);
    const end = this.toMinutes(shift.endTime);
    return end > start;
  }

  private toIsoWeekday(date: Date): number {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  private toMinutes(time: { hour: number; minute: number }): number {
    return (Number(time.hour) * 60) + Number(time.minute);
  }

  private dateFromShiftTime(reference: Date, time: { hour: number; minute: number }): Date {
    const date = new Date(reference);
    date.setHours(Number(time.hour), Number(time.minute), 0, 0);
    return date;
  }
}
