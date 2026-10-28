import { Component, OnInit, OnDestroy, ElementRef, Renderer2, inject } from '@angular/core';
import { ReportColumnLayoutService } from '../report-column-layout.service';
import { reportCsv, reportCsvColumns, reportPdfTable } from '../report-columns';
import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { ReportsService } from '../../services/reports.service';
import { TimeframePickerComponent, TimeframeSelection, TimeframePickerMode } from '../../components/timeframe-picker/timeframe-picker.component';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { displayInteger } from '../../shared/utils/display-number';
import { formatDurationParts } from '../../shared/utils/duration-format';

interface OperatorReportGroup {
  key: string;
  summary: any;
  details: any[];
}

@Component({
    providers: [ReportColumnLayoutService],
    selector: 'app-operator-report',
    imports: [
        CommonModule,
        BaseTableComponent,
        HttpClientModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TimeframePickerComponent
    ],
    templateUrl: './operator-report.component.html',
    styleUrls: ['./operator-report.component.scss']
})
export class OperatorReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  selectedShiftId: string | null = null;
  timeframeMode: TimeframePickerMode = 'today';
  readonly layout = inject(ReportColumnLayoutService);
  get columns(): string[] { return reportCsvColumns('operatorReport', this.layout.columns); }
  get summaryColumns(): string[] { return this.layout.columns; }
  rows: any[] = [];
  reportGroups: OperatorReportGroup[] = [];
  columnTooltips: { [column: string]: string } = {
    'Worked Time': 'Amount of time operator has been working across all machines',
    'Total Count': 'Amount of pieces fed by operator',
    'PPH': 'Pieces Per Hour',
    'Standard': 'Pieces Per Hour Goal',
    'Efficiency': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  showSummaryOnly: boolean = false;
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    if (this.showSummaryOnly) {
      return this.rows.filter(row => row['Item'] === 'TOTAL');
    }
    return this.rows;
  }

  constructor(
    private reportsService: ReportsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private percentBreakpointService: PercentBreakpointService
  ) {}

  ngOnInit(): void {
    this.layout.initialize('operatorReport', 'Operator Report');
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

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
  }

  applyTimeframe(selection: TimeframeSelection): void {
    if (this.isLoading) return;
    this.startTime = selection.start.toISOString();
    this.endTime = selection.end.toISOString();
    this.selectedShiftId = selection.shiftId;
    this.timeframeMode = selection.mode || 'custom';
    this.rows = [];
    this.reportGroups = [];
    this.fetchAnalyticsData();
  }

  fetchAnalyticsData(): void {
    if (this.isLoading) return;
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    // Fetch the operator report for the table
    this.reportsService.getOperatorReport(formattedStart, formattedEnd, undefined, this.selectedShiftId).subscribe({
      next: (data: any) => {
        const results = data?.results ?? (Array.isArray(data) ? data : []);
        this.processTableData(results);
        this.isLoading = false;
      },
      error: (error: any) => {
        console.error('Error fetching operator report:', error);
        this.isLoading = false;
      }
    });
  }

  private normalizeOperatorName(rawName: any, operatorId: number): string {
    if (!rawName) return `Operator ${operatorId}`;
    // Handle object format { first, surname }
    if (typeof rawName === 'object' && rawName !== null && 'first' in rawName) {
      const nameObj = rawName as { first?: string; surname?: string };
      const fullName = `${nameObj.first || ''} ${nameObj.surname || ''}`.trim();
      return fullName || `Operator ${operatorId}`;
    }
    // Handle string format
    if (typeof rawName === 'string') {
      return rawName.trim() || `Operator ${operatorId}`;
    }
    return `Operator ${operatorId}`;
  }

  private processTableData(results: any[]): void {
    const formattedData: any[] = [];
    this.reportGroups = [];

    results.forEach((operator: any) => {
      const summary = operator.operatorSummary;
      const operatorId = operator.operator.id;
      const operatorName = this.normalizeOperatorName(operator.operator.name, operatorId);

      const summaryRow = this.formatOperatorSummaryRow(operatorName, summary);
      const detailRows: any[] = [];

      formattedData.push(summaryRow);

      // Add item summaries under this operator
      Object.entries(summary.itemSummaries ?? {}).forEach(([itemId, item]: [string, any]) => {
        const detailRow = this.formatOperatorDetailRow(operatorName, itemId, item);
        detailRows.push(detailRow);
        formattedData.push(detailRow);
      });

      this.reportGroups.push({
        key: `${operatorId || operatorName || this.reportGroups.length}`,
        summary: summaryRow,
        details: detailRows
      });
    });

    this.rows = formattedData;
  }

  private formatOperatorSummaryRow(operatorName: string, summary: any): any {
    const workedTime = summary.workedTimeFormatted ?? summary.runtimeFormatted ?? { hours: 0, minutes: 0 };

    return {
      'Operator': operatorName,
      'Item': 'TOTAL',
      'Worked Time': formatDurationParts(workedTime),
      'Total Count': summary.totalCount ?? 0,
      'PPH': displayInteger(summary.pph),
      'Standard': displayInteger(summary.proratedStandard, 'N/A'),
      'Efficiency': summary.efficiency !== null && summary.efficiency !== undefined ? `${summary.efficiency}%` : 'N/A',
      '_tooltipItemId': ''
    };
  }

  private formatOperatorDetailRow(operatorName: string, itemId: string, item: any): any {
    const workedTime = item.workedTimeFormatted ?? { hours: 0, minutes: 0 };

    return {
      'Operator': operatorName,
      'Item': item.name,
      'Worked Time': formatDurationParts(workedTime),
      'Total Count': item.countTotal,
      'PPH': displayInteger(item.pph),
      'Standard': displayInteger(item.standard, 'N/A'),
      'Efficiency': item.efficiency !== null && item.efficiency !== undefined ? `${item.efficiency}%` : 'N/A',
      '_tooltipItemId': itemId
    };
  }

  readonly getCellTooltip = (row: any, column: string): string => {
    if (column === 'Item' && row?._tooltipItemId != null && row._tooltipItemId !== '') {
      return `Item ID: ${row._tooltipItemId}`;
    }
    return '';
  };

  getEfficiencyClass(value: any, column: string): string {
    if (column === 'Efficiency' && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''));
      if (isNaN(num)) return '';
      return this.percentBreakpointService.getColorClass(num);
    }
    return '';
  }

  async downloadOperatorSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true;
    console.log('Starting PDF export...');

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      doc.setFontSize(14);
      doc.text('OPERATOR REPORT', margin, y); 
      y += 18;
      doc.setFontSize(10);
      doc.text(`Range: ${this.startTime} → ${this.endTime}`, margin, y); 
      y += 24;

      const { head, body, identityIndex } = reportPdfTable('operatorReport', this.layout.columns, this.displayedRows);

      console.log(`Adding table with ${body.length} rows`);
      autoTable(doc, {
        head, 
        body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255 },
        columnStyles: { [identityIndex]: { cellWidth: 180 } },
        theme: 'striped'
      });

      console.log('Saving PDF...');
      doc.save(`operator_report_${this.startTime}_${this.endTime}.pdf`);
      console.log('PDF export completed successfully');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  downloadOperatorSummaryCsv(): void {
    if (!this.rows.length || !this.columns.length) return;
  
    this.isLoading = true;
    this.isDownloadingCsv = true;

    setTimeout(() => {
      try {
        const csvContent = reportCsv(this.columns, this.displayedRows);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
      
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `operator_report_${this.startTime}_${this.endTime}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Error generating CSV:', error);
      } finally {
        setTimeout(() => {
          this.isLoading = false;
          this.isDownloadingCsv = false;
        }, 500);
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
