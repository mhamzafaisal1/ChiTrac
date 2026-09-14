import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { ShiftListItem, ShiftService } from '../../services/shift.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { displayInteger } from '../../shared/utils/display-number';
import { formatDurationParts, parseDurationDisplay } from '../../shared/utils/duration-format';

interface ShiftMachineReportGroup {
  key: string;
  summary: any;
  details: any[];
}

@Component({
  selector: 'app-shift-machine-report',
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './shift-machine-report.component.html',
  styleUrls: ['./shift-machine-report.component.scss'],
})
export class ShiftMachineReportComponent implements OnInit, OnDestroy {
  startDate: Date | null = null;
  endDate: Date | null = null;
  shifts: ShiftListItem[] = [];
  selectedShiftId: string | null = null;
  selectedShift: ShiftListItem | null = null;
  columns: string[] = [];
  summaryColumns: string[] = ['Machine', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
  detailColumns: string[] = ['Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
  rows: any[] = [];
  reportGroups: ShiftMachineReportGroup[] = [];
  columnTooltips: { [column: string]: string } = {
    'Total Time (Runtime)': 'Amount of time machine has been running during the selected shift',
    'Total Count': 'Amount of pieces fed into the machine/line.',
    'PPH': 'Pieces Per Hour',
    'Standard': 'Pieces Per Hour Goal',
    'Efficiency': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  expandedGroupKeys = new Set<string>();
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';
  shiftsLoadError: string | null = null;
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    return this.rows;
  }

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private shiftService: ShiftService,
    private percentBreakpointService: PercentBreakpointService
  ) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startDate = start;
    this.endDate = end;

    this.detectTheme();
    this.observer = new MutationObserver(() => {
      this.detectTheme();
    });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    this.shiftService.getActiveShifts().subscribe({
      next: (res) => {
        this.shifts = res.shifts || [];
        this.shiftsLoadError = null;
      },
      error: (err) => {
        console.error('Error loading shifts:', err);
        this.shiftsLoadError = 'Could not load shifts';
        this.shifts = [];
      },
    });
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

  onShiftChange(): void {
    this.selectedShift =
      this.shifts.find((s) => s._id === this.selectedShiftId) ?? null;
  }

  fetchAnalyticsData(): void {
    if (!this.startDate || !this.endDate || !this.selectedShiftId) return;

    this.isLoading = true;
    this.isDownloading = false;
    const formattedStart = this.toQueryStartIso(this.startDate);
    const formattedEnd = this.toQueryEndIso(this.endDate);

    this.dailyDashboardService
      .getMachineItemSessionsSummary(formattedStart, formattedEnd, undefined, this.selectedShiftId)
      .subscribe({
        next: (data) => {
          this.processTableData(data.results);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error fetching machine item summary:', error);
          this.isLoading = false;
        },
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
      const detailRows: any[] = [];
      let summaryRow: any | null = null;

      sortedItems.forEach((item: any) => {
        const wt = item.workedTimeFormatted;

        const row = {
          Machine: machineName,
          Item: item.name ?? '',
          'Total Time (Runtime)': formatDurationParts(wt),
          'Total Count': item.countTotal ?? 0,
          PPH: displayInteger(item.pph),
          Standard: displayInteger(item.standard, ''),
          Efficiency: item.efficiency != null ? `${item.efficiency}%` : '',
          _tooltipMachineSerial: machineSerial,
          _tooltipItemId: item.name === 'Total' ? '' : item.itemId,
        };
        formattedData.push(row);
        if (item.name === 'Total') {
          summaryRow = row;
        } else {
          detailRows.push(row);
        }
      });

      if (!summaryRow) {
        const runtime = summary.runtimeFormatted ?? summary.workedTimeFormatted ?? { hours: 0, minutes: 0 };
        summaryRow = {
          Machine: machineName,
          Item: 'Total',
          'Total Time (Runtime)': formatDurationParts(runtime),
          'Total Count': summary.totalCount ?? 0,
          PPH: displayInteger(summary.pph),
          Standard: displayInteger(summary.proratedStandard, ''),
          Efficiency: summary.efficiency != null ? `${summary.efficiency}%` : '',
          _tooltipMachineSerial: machineSerial,
          _tooltipItemId: '',
        };
        formattedData.push(summaryRow);
      }

      this.reportGroups.push({
        key: `${machineSerial || machineName || this.reportGroups.length}`,
        summary: summaryRow,
        details: detailRows,
      });
    });

    this.columns = ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
    this.rows = formattedData;
  }

  toggleGroup(group: ShiftMachineReportGroup): void {
    if (this.expandedGroupKeys.has(group.key)) {
      this.expandedGroupKeys.delete(group.key);
    } else {
      this.expandedGroupKeys.add(group.key);
    }
  }

  isGroupExpanded(group: ShiftMachineReportGroup): boolean {
    return this.expandedGroupKeys.has(group.key);
  }

  trackGroupByKey(_: number, group: ShiftMachineReportGroup): string {
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
    if (column === 'Machine' && row?._tooltipMachineSerial !== '') {
      return `Serial: ${row._tooltipMachineSerial}`;
    }
    if (column === 'Item' && row?._tooltipItemId !== '') {
      return `Item ID: ${row._tooltipItemId}`;
    }
    return '';
  }

  getEfficiencyClass(value: any, column: string): string {
    if (column === 'Efficiency' && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''), 10);
      if (isNaN(num)) return '';
      return this.percentBreakpointService.getColorClass(num);
    }
    return '';
  }

  async downloadMachineItemSummaryPdf(): Promise<void> {
    if (!this.startDate || !this.endDate || !this.selectedShiftId) return;

    this.isDownloading = true;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      const rangeLabel = `${this.formatDateOnly(this.startDate)} → ${this.formatDateOnly(this.endDate)}`;
      const shiftLabel = this.selectedShift?.name ?? this.selectedShiftId;

      doc.setFontSize(14);
      doc.text('SHIFT MACHINE REPORT', margin, y);
      y += 18;
      doc.setFontSize(10);
      doc.text(`Shift: ${shiftLabel}`, margin, y);
      y += 14;
      doc.text(`Range: ${rangeLabel}`, margin, y);
      y += 24;

      const head = [['Machine/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
      const body = this.displayedRows.map((row) => [
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
        theme: 'striped',
      });

      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-');
      doc.save(
        `shift_machine_report_${safe(shiftLabel)}_${this.formatDateOnly(this.startDate)}_${this.formatDateOnly(this.endDate)}.pdf`
      );
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  downloadMachineItemSummaryCsv(): void {
    if (!this.rows.length || !this.columns.length) return;

    this.isLoading = true;
    this.isDownloadingCsv = true;

    setTimeout(() => {
      try {
        const csvRows: string[] = [];
        csvRows.push(this.columns.join(','));

        for (const row of this.displayedRows) {
          const rowData = this.columns.map((col) => {
            const cell = row[col];
            return typeof cell === 'string' && cell.includes(',')
              ? `"${cell.replace(/"/g, '""')}"`
              : cell;
          });
          csvRows.push(rowData.join(','));
        }

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        const shiftPart = (this.selectedShift?.name ?? this.selectedShiftId ?? 'shift').replace(
          /[/\\?%*:|"<>]/g,
          '-'
        );
        link.setAttribute(
          'download',
          `shift_machine_report_${shiftPart}_${this.formatDateOnly(this.startDate!)}_${this.formatDateOnly(this.endDate!)}.csv`
        );
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

  private toQueryStartIso(d: Date): string {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    return x.toISOString();
  }

  private toQueryEndIso(d: Date): string {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return x.toISOString();
  }

  private formatDateOnly(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
