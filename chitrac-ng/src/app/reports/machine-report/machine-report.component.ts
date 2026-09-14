import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { ReportsService } from '../../services/reports.service';
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { displayInteger } from '../../shared/utils/display-number';
import { formatDurationParts, parseDurationDisplay } from '../../shared/utils/duration-format';
import { MachineReportEmailModalComponent } from './machine-report-email-modal.component';

interface MachineReportGroup {
  key: string;
  summary: any;
  details: any[];
}

@Component({
    selector: 'app-machine-report',
    imports: [
        CommonModule,
        HttpClientModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        MatDialogModule,
        MatSnackBarModule,
        DateTimePickerComponent
    ],
    templateUrl: './machine-report.component.html',
    styleUrls: ['./machine-report.component.scss'] // ❗️Use plural: styleUrls
})

export class MachineReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  columns: string[] = [];
  summaryColumns: string[] = ['Machine', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
  detailColumns: string[] = ['Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
  rows: any[] = [];
  reportGroups: MachineReportGroup[] = [];
  columnTooltips: { [column: string]: string } = {
    'Total Time (Runtime)': 'Amount of time machine has been running',
    'Total Count': 'Amount of pieces fed into the machine/line.',
    'PPH': 'Pieces Per Hour',
    'Standard': 'Pieces Per Hour Goal',
    'Efficiency': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  isEmailing: boolean = false;
  showSummaryOnly: boolean = false;
  expandedGroupKeys = new Set<string>();
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    if (this.showSummaryOnly) {
      return this.rows.filter(row => row['Item'] === 'Total');
    }
    return this.rows;
  }

  constructor(
    private reportsService: ReportsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private percentBreakpointService: PercentBreakpointService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

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

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
  }

  fetchAnalyticsData(): void {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    // Fetch the machine report for the table
    this.reportsService.getMachineReport(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        const results = data?.results ?? (Array.isArray(data) ? data : []);
        this.processTableData(results);
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching machine report:', error);
        this.isLoading = false;
      }
    });
  }

  private processTableData(results: any[]): void {
    const formattedData: any[] = [];
    this.reportGroups = [];
    this.expandedGroupKeys.clear();
    this.sortColumn = null;
    this.sortDirection = 'asc';

    if (!results || !Array.isArray(results)) {
      this.columns = ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
      this.rows = [];
      return;
    }

    results.forEach((machine: any) => {
      const summary = machine.machineSummary;
      if (!summary) return;

      const itemSummaries = summary.itemSummaries;
      const items = itemSummaries != null
        ? Object.entries(itemSummaries).map(([itemId, item]: [string, any]) => ({ ...item, itemId }))
        : [];

      const totalItem = items.find((item: any) => item.name === 'Total');
      const otherItems = items.filter((item: any) => item.name !== 'Total');
      const sortedItems = totalItem ? [totalItem, ...otherItems] : items;
      const machineName = machine.machine?.name ?? '';
      const machineSerial = machine.machine?.serial ?? '';
      const groupRows: any[] = [];
      const detailRows: any[] = [];
      let summaryRow: any | null = null;

      sortedItems.forEach((item: any) => {
        const row = this.formatMachineReportRow(machineName, machineSerial, item, item.name !== 'Total');
        groupRows.push(row);

        if (item.name === 'Total') {
          summaryRow = row;
        } else {
          detailRows.push(row);
        }
      });

      if (!summaryRow) {
        summaryRow = this.formatMachineSummaryRow(machineName, machineSerial, summary);
        formattedData.push(summaryRow);
      }
      formattedData.push(...groupRows);

      this.reportGroups.push({
        key: `${machineSerial || machineName || this.reportGroups.length}`,
        summary: summaryRow,
        details: detailRows
      });
    });

    this.columns = ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
    this.rows = formattedData;
  }

  private formatMachineReportRow(machineName: string, machineSerial: any, item: any, isDetail: boolean): any {
    const wt = item.workedTimeFormatted;

    return {
      'Machine': machineName,
      'Item': item.name ?? '',
      'Total Time (Runtime)': formatDurationParts(wt),
      'Total Count': item.countTotal ?? 0,
      'PPH': displayInteger(item.pph),
      'Standard': displayInteger(item.standard, ''),
      'Efficiency': item.efficiency != null ? `${item.efficiency}%` : '',
      '_tooltipMachineSerial': machineSerial ?? '',
      '_tooltipItemId': isDetail ? item.itemId : ''
    };
  }

  private formatMachineSummaryRow(machineName: string, machineSerial: any, summary: any): any {
    const rt = summary.runtimeFormatted ?? summary.workedTimeFormatted;

    return {
      'Machine': machineName,
      'Item': 'Total',
      'Total Time (Runtime)': formatDurationParts(rt),
      'Total Count': summary.totalCount ?? 0,
      'PPH': displayInteger(summary.pph),
      'Standard': displayInteger(summary.proratedStandard, ''),
      'Efficiency': summary.efficiency != null ? `${summary.efficiency}%` : '',
      '_tooltipMachineSerial': machineSerial ?? '',
      '_tooltipItemId': ''
    };
  }

  toggleGroup(group: MachineReportGroup): void {
    if (this.expandedGroupKeys.has(group.key)) {
      this.expandedGroupKeys.delete(group.key);
    } else {
      this.expandedGroupKeys.add(group.key);
    }
  }

  isGroupExpanded(group: MachineReportGroup): boolean {
    return this.expandedGroupKeys.has(group.key);
  }

  trackGroupByKey(_: number, group: MachineReportGroup): string {
    return group.key;
  }

  sortBySummary(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }

    const direction = this.sortDirection === 'asc' ? 1 : -1;
    this.reportGroups = this.reportGroups
      .map((group, index) => ({ group, index }))
      .sort((a, b) => {
        const left = this.getSummarySortValue(a.group.summary, column);
        const right = this.getSummarySortValue(b.group.summary, column);
        const comparison = typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, undefined, { sensitivity: 'base' })
          : Number(left) - Number(right);
        return comparison === 0 ? a.index - b.index : comparison * direction;
      })
      .map(({ group }) => group);
  }

  private getSummarySortValue(summary: any, column: string): string | number {
    const value = summary?.[column];
    if (column === 'Machine') return String(value ?? '');
    if (column === 'Total Time (Runtime)') {
      return parseDurationDisplay(value);
    }
    return Number.parseFloat(String(value ?? '').replace(/[,%]/g, '')) || 0;
  }

  getCellTooltip(row: any, column: string): string {
    if (column === 'Machine' && row?._tooltipMachineSerial != null && row._tooltipMachineSerial !== '') {
      return `Serial: ${row._tooltipMachineSerial}`;
    }
    if (column === 'Item' && row?._tooltipItemId != null && row._tooltipItemId !== '') {
      return `Item ID: ${row._tooltipItemId}`;
    }
    return '';
  }

  getEfficiencyClass(value: any, column: string): string {
    if (column === 'Efficiency' && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''));
      if (isNaN(num)) return '';
      return this.percentBreakpointService.getColorClass(num);
    }
    return '';
  }

  async downloadMachineItemSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true;

    try {
      const doc = this.buildMachineReportPdf();

      doc.save(`machine_report_${this.startTime}_${this.endTime}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
      this.showMessage('Failed to download machine report PDF.');
    } finally {
      this.isDownloading = false;
    }
  }

  openEmailReportDialog(): void {
    if (!this.rows.length || !this.startTime || !this.endTime) return;

    const dialogRef = this.dialog.open(MachineReportEmailModalComponent, {
      width: '420px',
      maxWidth: '92vw',
      data: {
        startTime: this.startTime,
        endTime: this.endTime,
        summaryOnly: this.showSummaryOnly
      }
    });

    dialogRef.afterClosed().subscribe((to) => {
      if (!to) return;
      this.emailMachineReport(to);
    });
  }

  private emailMachineReport(to: string): void {
    this.isEmailing = true;

    try {
      const doc = this.buildMachineReportPdf();
      const dataUri = doc.output('datauristring');
      const pdfBase64 = dataUri.split(',')[1] ?? '';

      this.reportsService.emailMachineReport({
        to,
        pdfBase64,
        start: new Date(this.startTime).toISOString(),
        end: new Date(this.endTime).toISOString(),
        summaryOnly: this.showSummaryOnly
      }).subscribe({
        next: () => {
          this.showMessage('Machine report email sent successfully.');
          this.isEmailing = false;
        },
        error: (error) => {
          console.error('Error emailing machine report:', error);
          this.showMessage('Failed to send machine report email.');
          this.isEmailing = false;
        }
      });
    } catch (error) {
      console.error('Failed to generate PDF for email:', error);
      this.showMessage('Failed to prepare machine report email.');
      this.isEmailing = false;
    }
  }

  downloadMachineItemSummaryCsv(): void {
    if (!this.rows.length || !this.columns.length) return;
  
    this.isLoading = true;
    this.isDownloadingCsv = true;

    setTimeout(() => {
      try {
        const csvRows: string[] = [];
      
        // Header
        csvRows.push(this.columns.join(','));
      
        // Rows
        for (const row of this.displayedRows) {
          const rowData = this.columns.map(col => {
            const cell = row[col];
            return typeof cell === 'string' && cell.includes(',')
              ? `"${cell.replace(/"/g, '""')}"` // Escape double quotes
              : cell;
          });
          csvRows.push(rowData.join(','));
        }
      
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
      
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `machine_report_${this.startTime}_${this.endTime}.csv`);
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

  private buildMachineReportPdf(): jsPDF {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const margin = 24;
    let y = margin;

    doc.setFontSize(14);
    doc.text('MACHINE REPORT', margin, y);
    y += 18;
    doc.setFontSize(10);
    doc.text(`Range: ${this.startTime} → ${this.endTime}`, margin, y);
    y += 24;

    const head = [['Machine/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
    const body = this.displayedRows.map(row => [
      `${row['Machine']} / ${row['Item']}`,
      row['Total Time (Runtime)'],
      row['Total Count'],
      row['PPH'],
      row['Standard'],
      row['Efficiency'],
    ]);

    autoTable(doc, {
      head,
      body,
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255 },
      columnStyles: { 0: { cellWidth: 180 } },
      theme: 'striped'
    });

    return doc;
  }

  private showMessage(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 4500 });
  }
}
