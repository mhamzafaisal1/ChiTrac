import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { getStatusDot } from '../../utils/status-utils';

interface HandoffMetric {
  label: string;
  value: string | number;
  icon: string;
}

@Component({
  selector: 'app-shift-handoff',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, DateTimePickerComponent],
  templateUrl: './shift-handoff.component.html',
  styleUrl: './shift-handoff.component.scss',
})
export class ShiftHandoffComponent implements OnInit, OnDestroy {
  startTime = '';
  endTime = '';
  isLoading = false;
  isDarkTheme = false;
  metrics: HandoffMetric[] = [];
  machineRows: any[] = [];
  operatorRows: any[] = [];
  itemRows: any[] = [];
  faultRows: any[] = [];
  loadError = '';
  notes = '';
  private observer!: MutationObserver;
  private readonly notesKey = 'chitrac-shift-handoff-notes';

  constructor(private dailyDashboardService: DailyDashboardService) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(end);
    this.notes = localStorage.getItem(this.notesKey) || '';
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.fetchData();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  fetchData(): void {
    if (!this.startTime || !this.endTime) return;
    this.isLoading = true;
    const start = new Date(this.startTime).toISOString();
    const end = new Date(this.endTime).toISOString();

    this.loadError = '';

    forkJoin({
      machines: this.dailyDashboardService.getMachinesSummary(start, end).pipe(catchError(() => of([]))),
      operators: this.dailyDashboardService.getOperatorsSummary(start, end).pipe(catchError(() => of([]))),
      items: this.dailyDashboardService.getItemsSummary(start, end).pipe(catchError(() => of([]))),
      faults: this.dailyDashboardService.getFaultReportSummary(start, end).pipe(catchError(() => of({ context: {}, summaries: [] }))),
    }).subscribe({
      next: ({ machines, operators, items, faults }) => {
        const machineList = this.unwrapList(machines, 'machineResults');
        const operatorList = this.unwrapList(operators, 'operatorResults');
        const itemList = this.unwrapList(items, 'items');
        const faultList = faults.summaries || [];

        const totalCount = machineList.reduce((sum, m) => sum + this.machineCount(m), 0);
        const running = machineList.filter((m) => getStatusDot(m.currentStatus) === 'Running Dot').length;
        const avgOee = this.average(machineList.map((m) => this.numericPercent(m.metrics?.performance?.oee?.percentage ?? m.performance?.oee?.percentage ?? m.performance?.oee)));
        const faultMinutes = Math.round(faultList.reduce((sum, f) => sum + Number(f.totalDurationSeconds || 0), 0) / 60);

        this.metrics = [
          { label: 'Total Count', value: totalCount.toLocaleString(), icon: 'tag' },
          { label: 'Running Machines', value: `${running}/${machineList.length}`, icon: 'play_circle' },
          { label: 'Average OEE', value: `${avgOee}%`, icon: 'speed' },
          { label: 'Fault Minutes', value: faultMinutes, icon: 'warning' },
        ];

        this.machineRows = [...machineList]
          .sort((a, b) => this.machineOeeValue(a, 999) - this.machineOeeValue(b, 999))
          .slice(0, 6);
        this.operatorRows = [...operatorList]
          .sort((a, b) => this.operatorEfficiencyValue(b) - this.operatorEfficiencyValue(a))
          .slice(0, 6);
        this.itemRows = [...itemList]
          .filter((item) => this.itemCount(item) > 0)
          .sort((a, b) => this.itemCount(b) - this.itemCount(a))
          .slice(0, 6);
        this.faultRows = [...faultList]
          .sort((a, b) => Number(b.totalDurationSeconds || 0) - Number(a.totalDurationSeconds || 0))
          .slice(0, 6);
        this.isLoading = false;
      },
      error: () => {
        this.metrics = [];
        this.machineRows = [];
        this.operatorRows = [];
        this.itemRows = [];
        this.faultRows = [];
        this.loadError = 'Unable to load shift handoff data.';
        this.isLoading = false;
      },
    });
  }

  saveNotes(): void {
    localStorage.setItem(this.notesKey, this.notes);
  }

  print(): void {
    window.print();
  }

  private average(values: any[]): number {
    const numeric = values.map(Number).filter((value) => Number.isFinite(value));
    if (!numeric.length) return 0;
    return Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
  }

  private unwrapList(data: any, fallbackKey: string): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[fallbackKey])) return data[fallbackKey];
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  private numericPercent(value: any): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    const parsed = Number(String(value).replace('%', ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  machineOee(row: any): string {
    return `${this.machineOeeValue(row)}%`;
  }

  private machineOeeValue(row: any, fallback = 0): number {
    const value = this.numericPercent(row.metrics?.performance?.oee?.percentage ?? row.performance?.oee?.percentage ?? row.performance?.oee);
    return Number.isFinite(value) ? value : fallback;
  }

  machineCount(row: any): number {
    return Number(row.metrics?.output?.totalCount || row.performance?.output?.totalCount || row.itemSummary?.machineSummary?.totalCount || row.totalCount || 0);
  }

  operatorEfficiency(row: any): string {
    return `${this.operatorEfficiencyValue(row)}%`;
  }

  private operatorEfficiencyValue(row: any): number {
    return this.numericPercent(row.metrics?.performance?.efficiency?.percentage ?? row.performance?.efficiency?.percentage ?? row.efficiency);
  }

  operatorName(row: any): string {
    const name = row.operator?.name;
    if (typeof name === 'string') return name;
    if (name?.first || name?.surname) return `${name.first || ''} ${name.surname || ''}`.trim();
    return row.name || 'Operator';
  }

  itemName(row: any): string {
    return row.item?.name || row.itemName || row.name || row['Item Name'] || 'Item';
  }

  itemCount(row: any): number {
    return Number(row.totalCount || row['Total Count'] || row.count || row.itemCount || 0);
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
