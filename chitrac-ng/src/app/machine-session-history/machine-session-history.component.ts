import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';

interface SessionRow {
  'Session Type': string;
  'Start Time': string;
  'End Time': string;
  'Duration': string;
  'Total Count': number;
}

@Component({
  selector: 'app-machine-session-history',
  standalone: true,
  imports: [CommonModule, BaseTableComponent],
  templateUrl: './machine-session-history.component.html',
  styleUrls: ['./machine-session-history.component.scss'],
})
export class MachineSessionHistoryComponent implements OnInit, OnChanges {
  @Input() machineName: string = '';
  @Input() machineSerial: number = 0;

  columns = ['Session Type', 'Start Time', 'End Time', 'Duration', 'Total Count'];
  rows: SessionRow[] = [];

  constructor(private machineAnalyticsService: MachineAnalyticsService) {}

  ngOnInit(): void {
    this.loadSessions();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.loadSessions();
  }

  private loadSessions(): void {
    if (!this.machineSerial) {
      this.rows = [];
      return;
    }

    // For now, use "today" window: from local midnight to now.
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const startIso = start.toISOString();
    const endIso = now.toISOString();

    this.machineAnalyticsService
      .getMachineSessions(startIso, endIso, this.machineSerial)
      .subscribe((sessions: any[]) => {
        this.rows = (sessions || []).map((s) => ({
          'Session Type': s.sessionType ?? 'run',
          'Start Time': new Date(s.startTime).toLocaleString(),
          'End Time': new Date(s.endTime).toLocaleString(),
          'Duration': this.formatMs(s.durationMs ?? 0),
          'Total Count': s.totalCount ?? 0,
        }));
      });
  }

  private formatMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  getSessionCellClass = (_value: any, column: string, row?: SessionRow): string => {
    if (column !== 'Session Type' || !row) return '';
    return `session-badge session-badge--${String(row['Session Type']).toLowerCase()}`;
  };
}

