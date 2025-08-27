
// src/app/machine-current-operators/machine-current-operators.component.ts
import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { DateTimePickerComponent } from '../components/date-time-picker/date-time-picker.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';

type OperatorRow = {
  'Operator': string;
  'Worked Time': string;
  'Total Count': number;
  'Valid': number;
  'Misfeed': number;
  'Efficiency': string;
  'Session Start': string;
  'Session End': string;
};

@Component({
  selector: 'app-machine-current-operators',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseTableComponent, DateTimePickerComponent, MatButtonModule],
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
    'Operator', 'Worked Time', 'Total Count', 'Valid', 'Misfeed', 'Efficiency', 'Session Start', 'Session End'
  ];
  rows: OperatorRow[] = [];
  loading = false;

  constructor(private machineAnalyticsService: MachineAnalyticsService) {}

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
    // Assumes service has a machine dashboard call that returns array of machines
    // with .currentOperators included (per your backend change).
    this.machineAnalyticsService.getMachineDashboard(start, end, this.selectedMachineSerial)
      .subscribe({
        next: (data: any[]) => {
          const m = data?.find(d => d?.machine?.serial === this.selectedMachineSerial);
          const ops = m?.currentOperators || [];
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
      const hours = Math.floor(workedTimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((workedTimeMs % (1000 * 60 * 60)) / (1000 * 60));
      const workedTime = `${hours}h ${minutes}m`;
      
      // Calculate efficiency percentage
      const totalCount = o?.metrics?.totalCount || 0;
      const validCount = o?.metrics?.validCount || 0;
      const efficiencyPct = totalCount > 0 ? Math.round((validCount / totalCount) * 100) : 0;
      
      return {
        'Operator': o?.operatorName || `Operator ${o?.operatorId || ''}`,
        'Worked Time': workedTime,
        'Total Count': totalCount,
        'Valid': validCount,
        'Misfeed': o?.metrics?.misfeedCount || 0,
        'Efficiency': `${efficiencyPct}%`,
        'Session Start': o?.session?.start ? new Date(o.session.start).toLocaleString() : '-',
        'Session End': o?.session?.end ? new Date(o.session.end).toLocaleString() : 'Open'
      };
    });
  }
}
