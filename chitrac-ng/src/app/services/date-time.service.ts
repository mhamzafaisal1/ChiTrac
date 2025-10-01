import { Injectable } from "@angular/core";
import { BehaviorSubject, Subject } from "rxjs";

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
}
