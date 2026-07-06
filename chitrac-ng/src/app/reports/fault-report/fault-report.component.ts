import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';

interface FaultDetailRow {
  Timestamp: string;
  Machine: string;
  Duration: string;
  _timestamp: string;
  _durationSeconds: number;
  _machineSerial: number | string | null;
}

interface FaultSummaryRow {
  Fault: string;
  Count: number;
  'Total Duration': string;
  _faultCode: number | string | null;
  _totalDurationSeconds: number;
}

interface FaultReportGroup {
  key: string;
  summary: FaultSummaryRow;
  details: FaultDetailRow[];
}

@Component({
  selector: 'app-fault-report',
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    DateTimePickerComponent,
  ],
  templateUrl: './fault-report.component.html',
  styleUrls: ['./fault-report.component.scss'],
})
export class FaultReportComponent implements OnInit, OnDestroy {
  startTime = '';
  endTime = '';
  readonly summaryColumns = ['Fault', 'Count', 'Total Duration'];
  readonly detailColumns = ['Timestamp', 'Machine', 'Duration'];
  reportGroups: FaultReportGroup[] = [];
  expandedGroupKeys = new Set<string>();
  sortColumn: string | null = 'Total Duration';
  sortDirection: 'asc' | 'desc' = 'desc';
  isDarkTheme = false;
  isLoading = false;
  isDownloading = false;
  isDownloadingCsv = false;
  private observer!: MutationObserver;

  constructor(private dailyDashboardService: DailyDashboardService) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.endTime = this.formatDateForInput(end);
    this.startTime = this.formatDateForInput(start);

    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  fetchFaultReport(): void {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.dailyDashboardService
      .getFaultReportSummary(formattedStart, formattedEnd)
      .subscribe({
        next: (data: { context: any; summaries: any[] }) => {
          this.processReportData(data.summaries ?? []);
          this.isLoading = false;
        },
        error: (err: any) => {
          console.error('Error fetching fault report:', err);
          this.reportGroups = [];
          this.expandedGroupKeys.clear();
          this.isLoading = false;
        },
      });
  }

  private processReportData(summaries: any[]): void {
    this.expandedGroupKeys.clear();
    this.sortColumn = 'Total Duration';
    this.sortDirection = 'desc';

    this.reportGroups = summaries
      .map((summary: any, index: number) => {
        const code = summary.code ?? null;
        const name = summary.name ?? 'Fault';
        const details = (summary.faults ?? [])
          .map((fault: any) => this.formatDetailRow(fault))
          .sort(
            (a: FaultDetailRow, b: FaultDetailRow) =>
              b._durationSeconds - a._durationSeconds ||
              new Date(b._timestamp).getTime() - new Date(a._timestamp).getTime()
          );

        return {
          key: `${code ?? 'unknown'}|${name}|${index}`,
          summary: {
            Fault: code === null ? name : `${name} (${code})`,
            Count: summary.count ?? details.length,
            'Total Duration': this.formatDuration(summary.formatted),
            _faultCode: code,
            _totalDurationSeconds: Number(summary.totalDurationSeconds) || 0,
          },
          details,
        };
      })
      .sort(
        (a: FaultReportGroup, b: FaultReportGroup) =>
          b.summary._totalDurationSeconds - a.summary._totalDurationSeconds ||
          a.summary.Fault.localeCompare(b.summary.Fault)
      );
  }

  private formatDetailRow(fault: any): FaultDetailRow {
    const timestamp = fault.timestamp ? new Date(fault.timestamp) : null;
    const validTimestamp = timestamp && !Number.isNaN(timestamp.getTime());
    const machineSerial = fault.machineSerial ?? null;
    const machineName =
      fault.machineName ??
      (machineSerial !== null ? `Machine ${machineSerial}` : 'Unknown Machine');

    return {
      Timestamp: validTimestamp ? timestamp.toLocaleString() : 'Unknown',
      Machine: machineName,
      Duration: this.formatDuration(fault.formatted),
      _timestamp: validTimestamp ? timestamp.toISOString() : '',
      _durationSeconds: Number(fault.durationSeconds) || 0,
      _machineSerial: machineSerial,
    };
  }

  toggleGroup(group: FaultReportGroup): void {
    if (this.expandedGroupKeys.has(group.key)) {
      this.expandedGroupKeys.delete(group.key);
    } else {
      this.expandedGroupKeys.add(group.key);
    }
  }

  isGroupExpanded(group: FaultReportGroup): boolean {
    return this.expandedGroupKeys.has(group.key);
  }

  trackGroupByKey(_: number, group: FaultReportGroup): string {
    return group.key;
  }

  sortBySummary(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = column === 'Fault' ? 'asc' : 'desc';
    }

    const direction = this.sortDirection === 'asc' ? 1 : -1;
    this.reportGroups = this.reportGroups
      .map((group, index) => ({ group, index }))
      .sort((a, b) => {
        const left = this.getSummarySortValue(a.group.summary, column);
        const right = this.getSummarySortValue(b.group.summary, column);
        const comparison =
          typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right, undefined, { sensitivity: 'base' })
            : Number(left) - Number(right);
        return comparison === 0 ? a.index - b.index : comparison * direction;
      })
      .map(({ group }) => group);
  }

  private getSummarySortValue(summary: FaultSummaryRow, column: string): string | number {
    if (column === 'Fault') return summary.Fault;
    if (column === 'Count') return summary.Count;
    return summary._totalDurationSeconds;
  }

  getMachineTooltip(detail: FaultDetailRow): string {
    return detail._machineSerial !== null && detail._machineSerial !== ''
      ? `Serial: ${detail._machineSerial}`
      : '';
  }

  private formatDuration(
    formatted: { hours?: number; minutes?: number; seconds?: number } | undefined
  ): string {
    if (!formatted) return '0s';
    const h = formatted.hours ?? 0;
    const m = formatted.minutes ?? 0;
    const s = formatted.seconds ?? 0;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
  }

  async downloadPdf(): Promise<void> {
    if (!this.reportGroups.length) return;

    this.isDownloading = true;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      doc.setFontSize(14);
      doc.text('FAULT REPORT', margin, margin);
      doc.setFontSize(10);
      doc.text(`${this.startTime} to ${this.endTime}`, margin, margin + 18);

      const body: string[][] = [];
      for (const group of this.reportGroups) {
        body.push([
          'Summary',
          group.summary.Fault,
          String(group.summary.Count),
          group.summary['Total Duration'],
          '',
          '',
        ]);
        for (const detail of group.details) {
          body.push([
            'Detail',
            group.summary.Fault,
            '',
            detail.Duration,
            detail.Timestamp,
            detail.Machine,
          ]);
        }
      }

      autoTable(doc, {
        head: [['Row Type', 'Fault', 'Count', 'Duration', 'Timestamp', 'Machine']],
        body,
        startY: margin + 42,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255 },
        theme: 'striped',
      });

      doc.save(`fault_report_${this.startTime}_${this.endTime}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
    } finally {
      this.isDownloading = false;
    }
  }

  downloadCsv(): void {
    if (!this.reportGroups.length) return;

    this.isDownloadingCsv = true;
    setTimeout(() => {
      try {
        const rows: Array<Array<string | number>> = [
          ['Row Type', 'Fault', 'Count', 'Duration', 'Timestamp', 'Machine'],
        ];
        for (const group of this.reportGroups) {
          rows.push([
            'Summary',
            group.summary.Fault,
            group.summary.Count,
            group.summary['Total Duration'],
            '',
            '',
          ]);
          for (const detail of group.details) {
            rows.push([
              'Detail',
              group.summary.Fault,
              '',
              detail.Duration,
              detail.Timestamp,
              detail.Machine,
            ]);
          }
        }

        const csv = rows
          .map((row) =>
            row
              .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
              .join(',')
          )
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `fault_report_${this.startTime}_${this.endTime}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error generating CSV:', error);
      } finally {
        this.isDownloadingCsv = false;
      }
    }, 100);
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
