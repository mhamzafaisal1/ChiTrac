import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';

@Component({
  selector: 'app-fault-report',
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    BaseTableComponent,
    DateTimePickerComponent,
  ],
  templateUrl: './fault-report.component.html',
  styleUrls: ['./fault-report.component.scss'],
})
export class FaultReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  columns: string[] = [];
  rows: any[] = [];
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  showSummaryOnly: boolean = true; // Summary = true, Detailed = false
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    return this.rows;
  }

  constructor(private dailyDashboardService: DailyDashboardService) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    this.endTime = this.formatDateForInput(end);
    this.startTime = this.formatDateForInput(start);

    this.detectTheme();

    this.observer = new MutationObserver(() => {
      this.detectTheme();
    });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  onReportModeChange(): void {
    // If a range is selected, immediately refetch in the new mode
    if (this.startTime && this.endTime) {
      this.fetchFaultReport();
    }
  }

  fetchFaultReport(): void {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    if (this.showSummaryOnly) {
      this.dailyDashboardService
        .getFaultReportSummary(formattedStart, formattedEnd)
        .subscribe({
          next: (data: { context: any; summaries: any[] }) => {
            this.processSummaryData(data.summaries ?? []);
            this.isLoading = false;
          },
          error: (err: any) => {
            console.error('Error fetching fault report summary:', err);
            this.isLoading = false;
            this.columns = this.getDefaultColumns();
            this.rows = [];
          },
        });
    } else {
      this.dailyDashboardService
        .getFaultReportDetailed(formattedStart, formattedEnd)
        .subscribe({
          next: (data: { context: any; details: any[] }) => {
            this.processDetailedData(data.details ?? []);
            this.isLoading = false;
          },
          error: (err: any) => {
            console.error('Error fetching fault report detailed:', err);
            this.isLoading = false;
            this.columns = this.getDefaultColumns();
            this.rows = [];
          },
        });
    }
  }

  private getDefaultColumns(): string[] {
    return this.showSummaryOnly
      ? ['Fault', 'Count', 'Total Duration']
      : ['Machine', 'Fault', 'Count', 'Total Duration'];
  }

  private processSummaryData(summaries: any[]): void {
    this.columns = ['Fault', 'Count', 'Total Duration'];
    this.rows = (summaries || []).map((s) => ({
      Fault: s.name ?? 'Fault',
      Count: s.count ?? 0,
      'Total Duration': this.formatDuration(s.formatted),
    }));
  }

  private processDetailedData(details: any[]): void {
    this.columns = ['Machine', 'Fault', 'Count', 'Total Duration'];
    this.rows = (details || []).map((d) => ({
      Machine: d.machineName ?? `Machine ${d.machineSerial ?? ''}`,
      Fault: d.name ?? 'Fault',
      Count: d.count ?? 0,
      'Total Duration': this.formatDuration(d.formatted),
    }));
  }

  private formatDuration(formatted: { hours?: number; minutes?: number; seconds?: number } | undefined): string {
    if (!formatted) return '0m';
    const h = formatted.hours ?? 0;
    const m = formatted.minutes ?? 0;
    const s = formatted.seconds ?? 0;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
  }

  getEfficiencyClass(_value: any, _column: string): string {
    return '';
  }

  async downloadPdf(): Promise<void> {
    if (!this.startTime || !this.endTime || !this.rows.length) return;

    this.isDownloading = true;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      doc.setFontSize(14);
      doc.text('FAULT REPORT', margin, y);
      y += 18;
      doc.setFontSize(10);
      doc.text(
        `${this.showSummaryOnly ? 'Summary' : 'Detailed'}: ${this.startTime} → ${this.endTime}`,
        margin,
        y
      );
      y += 24;

      const head = [this.columns];
      const body = this.displayedRows.map((row) => this.columns.map((col) => String(row[col] ?? '')));

      autoTable(doc, {
        head,
        body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255 },
        theme: 'striped',
      });

      doc.save(`fault_report_${this.showSummaryOnly ? 'summary' : 'detailed'}_${this.startTime}_${this.endTime}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  downloadCsv(): void {
    if (!this.rows.length || !this.columns.length) return;

    this.isDownloadingCsv = true;
    setTimeout(() => {
      try {
        const csvRows: string[] = [this.columns.join(',')];
        for (const row of this.displayedRows) {
          const rowData = this.columns.map((col) => {
            const cell = row[col];
            return typeof cell === 'string' && cell.includes(',')
              ? `"${String(cell).replace(/"/g, '""')}"`
              : cell;
          });
          csvRows.push(rowData.join(','));
        }
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `fault_report_${this.showSummaryOnly ? 'summary' : 'detailed'}_${this.startTime}_${this.endTime}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
