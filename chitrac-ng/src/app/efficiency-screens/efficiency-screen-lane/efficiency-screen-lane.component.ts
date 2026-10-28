import { Component, Input, OnDestroy, OnInit, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, timer, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

export type EfficiencyScreenLaneMode = 'operator' | 'oee' | 'fault' | 'offline';

export interface EfficiencySlot {
  value: number | null;
  label: string;
  color: 'green' | 'orange' | 'red' | 'neutral';
  hasData: boolean;
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

  /** Elapsed time in the current fault or paused state, updated every second. */
  elapsedDisplay = '';
  private destroy$ = new Subject<void>();
  private timerSub: Subscription | null = null;
  private elapsedAnchor?: { key: string; asOf: number; elapsedMs: number; receivedAt: number };

  constructor(
    private cdr: ChangeDetectorRef,
    private percentBreakpointService: PercentBreakpointService
  ) {}

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
    const start = this.elapsedStart();
    if (start !== null) {
      const snapshotValue = this.lane?.elapsedAsOf;
      const snapshot = snapshotValue == null ? NaN : new Date(snapshotValue).getTime();
      const key = `${this.lane?.serial}:${this.lane?.station}:${this.mode}:${this.lane?.status}:${start}`;
      if (Number.isFinite(snapshot)) {
        if (!this.elapsedAnchor || this.elapsedAnchor.key !== key || snapshot > this.elapsedAnchor.asOf) {
          this.elapsedAnchor = { key, asOf: snapshot, elapsedMs: Math.max(0, snapshot - start), receivedAt: performance.now() };
        }
      } else this.elapsedAnchor = undefined;
    } else this.elapsedAnchor = undefined;
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

  private elapsedStart(): number | null {
    const value = this.mode === 'fault' ? this.lane?.latestFaultStart
      : this.mode === 'offline' ? this.lane?.latestPausedStart : null;
    if (value == null) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private shouldShowDynamicElapsed(): boolean {
    return this.elapsedStart() !== null;
  }

  private updateElapsedDisplay(): void {
    const start = this.elapsedStart();
    if (start !== null) this.elapsedDisplay = this.formatElapsedFromStart(start);
    else if (this.mode === 'fault' || this.mode === 'offline') this.elapsedDisplay = '—';
    else {
      this.elapsedDisplay = this.lane?.displayTimers?.on ?? '';
    }
  }

  /** Advance the source clock locally without depending on the browser's wall clock. */
  private formatElapsedFromStart(start: number): string {
    const elapsedMs = this.elapsedAnchor
      ? this.elapsedAnchor.elapsedMs + performance.now() - this.elapsedAnchor.receivedAt
      : Date.now() - start;
    const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
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
  getColor(value: number | undefined | null): 'green' | 'orange' | 'red' | 'neutral' {
    if (value == null) return 'neutral';
    const v = value;
    if (this.mode === 'oee') return this.percentBreakpointService.getOeDashboardColor(v);
    return this.percentBreakpointService.getDashboardColor(v);
  }

  /** Get efficiency or OEE data with frontend-derived colors for operator/oee modes. */
  getSlots(): {
    lastSixMinutes: EfficiencySlot;
    lastFifteenMinutes: EfficiencySlot;
    lastHour: EfficiencySlot;
    today: EfficiencySlot;
  } {
    const source = this.mode === 'oee' ? (this.lane?.oee ?? {}) : (this.lane?.efficiency ?? {});
    const def = (v: number | null, label: string, hasData: boolean) => ({
      value: v,
      label,
      hasData,
      color: this.getColor(v)
    });
    return {
      lastSixMinutes: def(
        source?.lastSixMinutes?.value ?? null,
        source?.lastSixMinutes?.label ?? 'Last 6 Mins',
        source?.lastSixMinutes?.hasData === true
      ),
      lastFifteenMinutes: def(
        source?.lastFifteenMinutes?.value ?? null,
        source?.lastFifteenMinutes?.label ?? 'Last 15 Mins',
        source?.lastFifteenMinutes?.hasData === true
      ),
      lastHour: def(
        source?.lastHour?.value ?? null,
        source?.lastHour?.label ?? 'Last Hour',
        source?.lastHour?.hasData === true
      ),
      today: def(
        source?.today?.value ?? null,
        source?.today?.label ?? 'All Day',
        source?.today?.hasData === true
      )
    };
  }

  displayValue(slot: EfficiencySlot): string {
    return slot.hasData && slot.value != null ? `${Math.round(slot.value)}%` : 'N/A';
  }

  barHeight(slot: EfficiencySlot): number {
    return slot.hasData && slot.value != null ? Math.max(0, Math.min(slot.value, 100)) : 0;
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
