import { Component, Input, OnDestroy, OnInit, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, timer, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export type EfficiencyScreenLaneMode = 'operator' | 'oee' | 'fault' | 'offline';

export interface EfficiencySlot {
  value: number;
  label: string;
  color: 'green' | 'orange' | 'yellow';
}

@Component({
  selector: 'app-efficiency-screen-lane',
  templateUrl: './efficiency-screen-lane.component.html',
  styleUrls: ['./efficiency-screen-lane.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class EfficiencyScreenLaneComponent implements OnInit, OnChanges, OnDestroy {
  @Input() lane: any;
  @Input() mode: EfficiencyScreenLaneMode = 'operator';

  /** Elapsed time display string, updated every second when in fault (latestFaultStart) or paused (latestPausedStart) */
  elapsedDisplay = '';
  private destroy$ = new Subject<void>();
  private timerSub: Subscription | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.syncElapsedTimer();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['lane'] || changes['mode']) {
      this.syncElapsedTimer();
    }
  }

  ngOnDestroy() {
    this.stopElapsedTimer();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private syncElapsedTimer(): void {
    this.updateElapsedDisplay();
    if (this.shouldShowDynamicElapsed()) {
      if (!this.timerSub) {
        this.timerSub = timer(0, 1000)
          .pipe(takeUntil(this.destroy$))
          .subscribe(() => {
            this.updateElapsedDisplay();
            this.cdr.markForCheck();
          });
      }
    } else {
      this.stopElapsedTimer();
    }
  }

  private stopElapsedTimer(): void {
    if (this.timerSub) {
      this.timerSub.unsubscribe();
      this.timerSub = null;
    }
  }

  /** Show ticking elapsed when faulted (use latestFaultStart) or paused/offline (use latestPausedStart or latestFaultStart). */
  private shouldShowDynamicElapsed(): boolean {
    if (this.mode === 'fault') return !!this.lane?.latestFaultStart;
    if (this.mode === 'offline') return !!(this.lane?.latestPausedStart || this.lane?.latestFaultStart);
    return false;
  }

  private updateElapsedDisplay(): void {
    if (this.mode === 'fault' && this.lane?.latestFaultStart) {
      this.elapsedDisplay = this.formatElapsedFromStart(this.lane.latestFaultStart);
    } else if (this.mode === 'offline' && this.lane?.latestPausedStart) {
      this.elapsedDisplay = this.formatElapsedFromStart(this.lane.latestPausedStart);
    } else if (this.mode === 'offline' && this.lane?.latestFaultStart) {
      this.elapsedDisplay = this.formatElapsedFromStart(this.lane.latestFaultStart);
    } else {
      this.elapsedDisplay = this.lane?.displayTimers?.on ?? '';
    }
  }

  /** Format elapsed seconds as "Xh Ym Zs" from given start to now */
  private formatElapsedFromStart(isoOrDate: string | Date): string {
    const start = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    if (!start || isNaN(start.getTime())) return '0s';
    const totalSec = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
    if (totalSec <= 0) return '0s';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  /** Get the elapsed time string for display (used in template) */
  getElapsedDisplay(): string {
    return this.elapsedDisplay;
  }

  /** Derive color from efficiency value (frontend-controlled: ≥90 green, 70-89 yellow, <70 red). */
  getColor(value: number | undefined | null): 'green' | 'orange' | 'yellow' {
    const v = value ?? 0;
    if (v >= 90) return 'green';
    if (v >= 70) return 'yellow';
    return 'orange';
  }

  /** Get efficiency or OEE data with frontend-derived colors for operator/oee modes. */
  getSlots(): {
    lastSixMinutes: EfficiencySlot;
    lastFifteenMinutes: EfficiencySlot;
    lastHour: EfficiencySlot;
    today: EfficiencySlot;
  } {
    const source = this.mode === 'oee' ? (this.lane?.oee ?? {}) : (this.lane?.efficiency ?? {});
    const def = (v: number, label: string) => ({ value: v, label, color: this.getColor(v) });
    return {
      lastSixMinutes: def(
        source?.lastSixMinutes?.value ?? 0,
        source?.lastSixMinutes?.label ?? 'Last 6 Mins'
      ),
      lastFifteenMinutes: def(
        source?.lastFifteenMinutes?.value ?? 0,
        source?.lastFifteenMinutes?.label ?? 'Last 15 Mins'
      ),
      lastHour: def(
        source?.lastHour?.value ?? 0,
        source?.lastHour?.label ?? 'Last Hour'
      ),
      today: def(
        source?.today?.value ?? 0,
        source?.today?.label ?? 'All Day'
      )
    };
  }

  /** Operator/oee header label. */
  getHeaderLabel(): string {
    if (this.mode === 'oee') return 'OEE';
    return this.lane?.operator || 'NO OPERATOR';
  }

  /** Whether operator mode has no operator (greyed). */
  get isNoOperator(): boolean {
    return this.mode === 'operator' && !this.lane?.operator;
  }

  /**
   * Fault string for display: if it contains at least one underscore,
   * replace all underscores with spaces; otherwise return as-is.
   */
  getFaultDisplayText(): string {
    const fault = this.lane?.fault;
    if (fault == null || fault === '') return fault ?? '';
    return typeof fault === 'string' && fault.includes('_') ? fault.replace(/_/g, ' ') : String(fault);
  }
}
