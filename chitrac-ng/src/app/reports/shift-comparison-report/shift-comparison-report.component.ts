import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { ShiftListItem, ShiftService } from '../../services/shift.service';
import { displayInteger } from '../../shared/utils/display-number';
import { formatDurationParts } from '../../shared/utils/duration-format';

@Component({
  selector: 'app-shift-comparison-report',
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    MatSlideToggleModule,
    BaseTableComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './shift-comparison-report.component.html',
  styleUrls: ['./shift-comparison-report.component.scss'],
})
export class ShiftComparisonReportComponent implements OnInit, OnDestroy {
  selectedDate: Date | null = null;
  shifts: ShiftListItem[] = [];
  firstShiftId: string | null = null;
  secondShiftId: string | null = null;
  firstRows: any[] = [];
  secondRows: any[] = [];
  columns: string[] = this.defaultColumns;
  isDarkTheme = false;
  isLoading = false;
  showSummaryOnly = false;
  shiftsLoadError: string | null = null;
  private observer!: MutationObserver;

  get firstDisplayedRows(): any[] {
    return this.getDisplayedRows(this.firstRows);
  }

  get secondDisplayedRows(): any[] {
    return this.getDisplayedRows(this.secondRows);
  }

  get firstShiftLabel(): string {
    return this.getShiftLabel(this.firstShiftId);
  }

  get secondShiftLabel(): string {
    return this.getShiftLabel(this.secondShiftId);
  }

  get firstReportHeading(): string {
    return this.formatReportHeading(this.firstShiftLabel);
  }

  get secondReportHeading(): string {
    return this.formatReportHeading(this.secondShiftLabel);
  }

  get hasResults(): boolean {
    return this.firstRows.length > 0 || this.secondRows.length > 0;
  }

  private get defaultColumns(): string[] {
    return ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
  }

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private shiftService: ShiftService
  ) {}

  ngOnInit(): void {
    this.selectedDate = new Date();
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

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  onFirstShiftChange(): void {
    if (this.firstShiftId && this.firstShiftId === this.secondShiftId) {
      this.secondShiftId = null;
    }
  }

  fetchAnalyticsData(): void {
    if (!this.selectedDate || !this.firstShiftId || !this.secondShiftId) return;

    this.isLoading = true;
    this.firstRows = [];
    this.secondRows = [];

    const start = this.toQueryStartIso(this.selectedDate);
    const end = this.toQueryEndIso(this.selectedDate);

    forkJoin({
      first: this.dailyDashboardService.getMachineItemSessionsSummary(start, end, undefined, this.firstShiftId),
      second: this.dailyDashboardService.getMachineItemSessionsSummary(start, end, undefined, this.secondShiftId),
    }).subscribe({
      next: ({ first, second }) => {
        this.firstRows = this.processTableData(first?.results);
        this.secondRows = this.processTableData(second?.results);
        this.columns = this.firstRows.length
          ? Object.keys(this.firstRows[0])
          : this.secondRows.length
            ? Object.keys(this.secondRows[0])
            : this.defaultColumns;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching shift comparison report:', error);
        this.isLoading = false;
      },
    });
  }

  secondShiftOptions(): ShiftListItem[] {
    return this.shifts.filter((shift) => shift._id !== this.firstShiftId);
  }

  getEfficiencyClass(value: any, column: string): string {
    if (column === 'Efficiency' && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''), 10);
      if (isNaN(num)) return '';
      if (num >= 90) return 'green';
      if (num >= 70) return 'yellow';
      return 'red';
    }
    return '';
  }

  private processTableData(results: any[]): any[] {
    const formattedData: any[] = [];

    if (!results || !Array.isArray(results)) {
      return formattedData;
    }

    results.forEach((machine: any) => {
      const summary = machine.machineSummary;
      if (!summary) return;

      const itemSummaries = summary.itemSummaries;
      const items = itemSummaries != null ? Object.values(itemSummaries) : [];

      const totalItem = items.find((item: any) => item.name === 'Total');
      const otherItems = items.filter((item: any) => item.name !== 'Total');
      const sortedItems = totalItem ? [totalItem, ...otherItems] : items;

      sortedItems.forEach((item: any) => {
        const wt = item.workedTimeFormatted;

        formattedData.push({
          Machine: machine.machine?.name ?? '',
          Item: item.name ?? '',
          'Total Time (Runtime)': formatDurationParts(wt),
          'Total Count': item.countTotal ?? 0,
          PPH: displayInteger(item.pph),
          Standard: displayInteger(item.standard, ''),
          Efficiency: item.efficiency != null ? `${item.efficiency}%` : '',
        });
      });
    });

    return formattedData;
  }

  private getDisplayedRows(rows: any[]): any[] {
    if (this.showSummaryOnly) {
      return rows.filter((row) => row['Item'] === 'Total');
    }
    return rows;
  }

  private getShiftLabel(shiftId: string | null): string {
    if (!shiftId) return '';
    const shift = this.shifts.find((s) => s._id === shiftId);
    return shift?.name || `Shift ${shiftId}`;
  }

  private formatReportHeading(shiftLabel: string): string {
    const dateLabel = this.selectedDate ? this.formatDateOnly(this.selectedDate) : '';
    return dateLabel ? `${shiftLabel} - ${dateLabel}` : shiftLabel;
  }

  private formatDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day}/${year}`;
  }

  private toQueryStartIso(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  private toQueryEndIso(date: Date): string {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }
}
