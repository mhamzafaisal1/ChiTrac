import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

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
export class EfficiencyScreenLaneComponent {
  @Input() lane: any;
  @Input() mode: EfficiencyScreenLaneMode = 'operator';

  /** Derive color from efficiency value (frontend-controlled: ≥90 green, 70-89 yellow, <70 red). */
  getColor(value: number | undefined | null): 'green' | 'orange' | 'yellow' {
    const v = value ?? 0;
    if (v >= 90) return 'green';
    if (v >= 70) return 'orange';
    return 'yellow';
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
}
