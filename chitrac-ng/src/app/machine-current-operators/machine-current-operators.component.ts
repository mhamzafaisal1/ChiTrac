
// src/app/machine-current-operators/machine-current-operators.component.ts
import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { MachineService } from '../services/machine.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { displayInteger } from '../shared/utils/display-number';
import { formatDurationMilliseconds } from '../shared/utils/duration-format';

type OperatorRow = {
  'Operator': string;
  'Station': string | number;
  'Item': string;
  'Worked Time': string;
  'Total Count': number;
  'Valid': number;
  'Misfeed': number;
  'PPH': string | number;
  'Standard': string | number;
  'Efficiency': string;
  'Session Start': string;
  'Session End': string;
};

@Component({
  selector: 'app-machine-current-operators',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseTableComponent, MatButtonModule],
  templateUrl: './machine-current-operators.component.html',
  styleUrls: ['./machine-current-operators.component.scss']
})
export class MachineCurrentOperatorsComponent implements OnInit {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() selectedMachineSerial: number | null = null;

  /** Optional: pass pre-fetched array from parent (tabs.currentOperators) */
  @Input() currentOperatorsData: any[] | null = null;

  @Input() isModal: boolean = false;

  columns: string[] = [
    'Operator', 'Station', 'Item', 'Worked Time', 'Total Count', 'Valid', 'Misfeed', 'PPH', 'Standard', 'Efficiency', 'Session Start', 'Session End'
  ];
  rows: OperatorRow[] = [];
  loading = false;

  constructor(
    private machineService: MachineService,
    private percentBreakpointService: PercentBreakpointService
  ) {}

  ngOnInit(): void {
    if (!this.startTime || !this.endTime) {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      this.startTime = s.toISOString();
      this.endTime = e.toISOString();
    }
    console.log("currentOperatorsData", this.currentOperatorsData);
    if (this.currentOperatorsData?.length) {
      this.rows = this.transform(this.currentOperatorsData);
    } else {
      this.fetch();
    }
  }

  fetch(): void {
    if (!this.startTime || !this.endTime || !this.selectedMachineSerial) return;

    const start = new Date(this.startTime).toISOString();
    const end = new Date(this.endTime).toISOString();

    this.loading = true;
    // Use the same machine details endpoint as the dashboard modal
    this.machineService
      .getMachineDetails(start, end, this.selectedMachineSerial)
      .subscribe({
        next: (data: any[]) => {
          const machineData = Array.isArray(data) ? data[0] : data;
          const ops = machineData?.currentOperators || [];
          this.rows = this.transform(ops);
          this.loading = false;
        },
        error: (err) => {
          console.error('Error fetching current operators:', err);
          this.loading = false;
        }
      });
  }

  private transform(ops: any[]): OperatorRow[] {
    if (!Array.isArray(ops)) return [];
    return ops.map(o => {
      // Extract worked time from milliseconds
      const workedTimeMs = o?.metrics?.workedTimeMs || 0;
      const workedTime = formatDurationMilliseconds(workedTimeMs);
      
      const totalCount = o?.metrics?.totalCount || 0;
      const validCount = o?.metrics?.validCount || 0;
      const pph = Number(o?.metrics?.pph);
      const standard = Number(o?.metrics?.standard ?? o?.assignment?.standard);
      const efficiencyPct = Number(o?.metrics?.efficiencyPct);
      const efficiency = Number.isFinite(efficiencyPct)
        ? Math.round(efficiencyPct * 100) / 100
        : 0;
      
      return {
        'Operator': o?.operatorName || `Operator ${o?.operatorId || ''}`,
        'Station': o?.assignment?.station ?? o?.assignment?.lane ?? '-',
        'Item': o?.assignment?.itemName || '-',
        'Worked Time': workedTime,
        'Total Count': totalCount,
        'Valid': validCount,
        'Misfeed': o?.metrics?.misfeedCount || 0,
        'PPH': displayInteger(Number.isFinite(pph) ? pph : 0),
        'Standard': displayInteger(Number.isFinite(standard) ? standard : 0),
        'Efficiency': `${efficiency}%`,
        'Session Start': o?.session?.start ? new Date(o.session.start).toLocaleString() : '-',
        'Session End': o?.session?.end ? new Date(o.session.end).toLocaleString() : 'Open'
      };
    });
  }

  getEfficiencyClass = (value: any, column: string): string => {
    if ((column === 'Efficiency') && typeof value === 'string' && value.includes('%')) {
      return this.percentBreakpointService.getColorClass(value);
    }
    return '';
  };
}
