import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { getStatusDot } from '../../utils/status-utils';
import { DailyDashboardService } from '../services/daily-dashboard.service';

interface VisualMetric {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone: string;
}

interface VisualMachine {
  name: string;
  serial: string;
  status: string;
  statusDot: string;
  tone: string;
  oee: number;
  availability: number;
  throughput: number;
  efficiency: number;
  count: number;
  runningMs: number;
  pausedMs: number;
  faultedMs: number;
  offlineMs: number;
}

interface WaterfallStep {
  label: string;
  value: number;
  width: number;
  tone: string;
  remaining: number;
}

interface HeatCell {
  label: string;
  value: number;
}

@Component({
  selector: 'app-visual-ops-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, DateTimePickerComponent],
  templateUrl: './visual-ops-dashboard.component.html',
  styleUrl: './visual-ops-dashboard.component.scss',
})
export class VisualOpsDashboardComponent implements OnInit, OnDestroy {
  startTime = '';
  endTime = '';
  isLoading = false;
  isDarkTheme = false;
  loadError = '';

  metrics: VisualMetric[] = [];
  machines: VisualMachine[] = [];
  timelineRows: VisualMachine[] = [];
  bulletRows: VisualMachine[] = [];
  heatmapRows: { machine: string; cells: HeatCell[] }[] = [];
  waterfallSteps: WaterfallStep[] = [];
  waterfallActual = 0;
  waterfallGap = 0;
  faultRows: any[] = [];

  private observer!: MutationObserver;
  readonly oeeTarget = 85;

  constructor(private dailyDashboardService: DailyDashboardService) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(end);
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
    this.loadError = '';

    const start = new Date(this.startTime).toISOString();
    const end = new Date(this.endTime).toISOString();

    forkJoin({
      machines: this.dailyDashboardService.getMachinesSummary(start, end).pipe(catchError(() => of([]))),
      status: this.dailyDashboardService.getDailyMachineStatusFast(start, end).pipe(catchError(() => of([]))),
      faults: this.dailyDashboardService.getFaultReportSummary(start, end).pipe(catchError(() => of({ summaries: [] }))),
    }).subscribe({
      next: ({ machines, status, faults }) => {
        const machineList = this.unwrapList(machines, 'machineResults');
        const statusList = this.unwrapList(status, 'machineStatus');
        const merged = this.mergeMachineRows(machineList, statusList);

        this.machines = merged.sort((a, b) => a.name.localeCompare(b.name));
        this.timelineRows = [...merged].sort((a, b) => this.totalStateMs(b) - this.totalStateMs(a)).slice(0, 10);
        this.bulletRows = [...merged].sort((a, b) => b.oee - a.oee).slice(0, 8);
        this.heatmapRows = this.buildHeatmapRows(merged);
        this.waterfallSteps = this.buildWaterfallSteps(merged);
        this.faultRows = [...(faults?.summaries || [])]
          .sort((a, b) => Number(b.totalDurationSeconds || 0) - Number(a.totalDurationSeconds || 0))
          .slice(0, 6);
        this.metrics = this.buildMetrics(merged, this.faultRows);
        this.isLoading = false;
      },
      error: () => {
        this.clearDashboard();
        this.loadError = 'Unable to load visual operations data.';
        this.isLoading = false;
      },
    });
  }

  stateWidth(machine: VisualMachine, key: 'runningMs' | 'pausedMs' | 'faultedMs' | 'offlineMs'): number {
    const total = this.totalStateMs(machine);
    if (!total) return key === 'offlineMs' ? 100 : 0;
    return Math.max(0, Math.round((machine[key] / total) * 100));
  }

  bulletWidth(machine: VisualMachine): number {
    return this.clamp(Math.round((machine.oee / this.oeeTarget) * 100), 0, 120);
  }

  targetOffset(): number {
    return this.clamp(this.oeeTarget, 0, 100);
  }

  actualOffset(): number {
    return this.clamp(this.waterfallActual, 0, 100);
  }

  heatTone(value: number): string {
    if (value >= 85) return 'good';
    if (value >= 65) return 'watch';
    return 'bad';
  }

  statusIcon(tone: string): string {
    if (tone === 'good') return 'check_circle';
    if (tone === 'watch') return 'error';
    return 'warning';
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  machineSubtitle(machine: VisualMachine): string {
    return machine.serial !== 'unknown' ? `Serial ${machine.serial}` : 'No serial';
  }

  private mergeMachineRows(machineRows: any[], statusRows: any[]): VisualMachine[] {
    const bySerial = new Map<string, any>();
    statusRows.forEach((row) => bySerial.set(String(row.serial || row.machine?.serial || row.machineSerial || row._id || row.name), row));

    const normalized = machineRows.map((row) => {
      const serial = String(row.machine?.serial || row.serial || row.machineSerial || row._id || row.machine?.name || 'unknown');
      return this.normalizeMachine(row, bySerial.get(serial));
    });

    const existing = new Set(normalized.map((row) => row.serial));
    statusRows.forEach((row) => {
      const serial = String(row.serial || row.machine?.serial || row.machineSerial || row._id || row.name || 'unknown');
      if (!existing.has(serial)) {
        normalized.push(this.normalizeMachine(row, row));
      }
    });

    return normalized;
  }

  private normalizeMachine(row: any, statusRow: any): VisualMachine {
    const machine = row.machine || statusRow?.machine || {};
    const name = machine.name || row.name || statusRow?.name || `Machine ${machine.serial || row.serial || ''}`.trim();
    const serial = String(machine.serial || row.serial || statusRow?.serial || statusRow?.machineSerial || 'unknown');
    const status = row.currentStatus || statusRow?.currentStatus || statusRow?.status || 'Unknown';
    const statusDot = getStatusDot(status);
    const runningMs = this.numeric(statusRow?.runningMs ?? statusRow?.runtimeMs ?? row.runningMs ?? row.runtimeMs);
    const pausedMs = this.numeric(statusRow?.pausedMs ?? row.pausedMs);
    const faultedMs = this.numeric(statusRow?.faultedMs ?? statusRow?.faultMs ?? row.faultedMs);
    const offlineMs = this.numeric(statusRow?.offlineMs ?? row.offlineMs);
    const performance = row.metrics?.performance ?? row.performance ?? {};
    const oee = this.performancePercent(performance.oee ?? row.oee);
    const availability = this.performancePercent(performance.availability ?? row.availability);
    const throughputSource = performance.throughput ?? row.throughput ?? row.quality;
    const throughput = throughputSource == null ? 100 : this.performancePercent(throughputSource);
    const efficiency = this.performancePercent(performance.efficiency ?? row.efficiency);

    return {
      name,
      serial,
      status,
      statusDot,
      tone: this.machineTone(statusDot, oee),
      oee,
      availability,
      throughput,
      efficiency,
      count: this.numeric(row.metrics?.output?.totalCount ?? row.performance?.output?.totalCount ?? row.totalCount),
      runningMs,
      pausedMs,
      faultedMs,
      offlineMs,
    };
  }

  private buildMetrics(machines: VisualMachine[], faults: any[]): VisualMetric[] {
    const avgOee = this.average(machines.map((m) => m.oee));
    const running = machines.filter((m) => m.statusDot === 'Running Dot').length;
    const totalCount = machines.reduce((sum, m) => sum + m.count, 0);
    const faultMinutes = Math.round(faults.reduce((sum, f) => sum + Number(f.totalDurationSeconds || 0), 0) / 60);
    const worstMachine = [...machines].sort((a, b) => a.oee - b.oee)[0];

    return [
      { label: 'Plant OEE', value: `${avgOee}%`, detail: `${this.oeeTarget}% target`, icon: 'speed', tone: avgOee >= this.oeeTarget ? 'good' : 'watch' },
      { label: 'Running Now', value: `${running}/${machines.length}`, detail: 'machines in good state', icon: 'play_circle', tone: running === machines.length ? 'good' : 'watch' },
      { label: 'Total Count', value: totalCount.toLocaleString(), detail: 'pieces in window', icon: 'tag', tone: 'neutral' },
      { label: 'Fault Loss', value: `${faultMinutes}m`, detail: 'top fault minutes', icon: 'warning', tone: faultMinutes ? 'bad' : 'good' },
      { label: 'Watch Machine', value: worstMachine?.name || 'None', detail: worstMachine ? `${worstMachine.oee}% OEE` : 'no machine data', icon: 'visibility', tone: worstMachine?.oee < 65 ? 'bad' : 'neutral' },
    ];
  }

  private buildHeatmapRows(machines: VisualMachine[]): { machine: string; cells: HeatCell[] }[] {
    return machines
      .slice()
      .sort((a, b) => a.oee - b.oee)
      .slice(0, 8)
      .map((machine) => ({
        machine: machine.name,
        cells: [
          { label: 'OEE', value: machine.oee },
          { label: 'Avail', value: machine.availability },
          { label: 'Eff', value: machine.efficiency },
          { label: 'Run', value: this.stateWidth(machine, 'runningMs') },
          { label: 'Loss', value: this.clamp(this.stateWidth(machine, 'pausedMs') + this.stateWidth(machine, 'faultedMs') + this.stateWidth(machine, 'offlineMs'), 0, 100) },
        ],
      }));
  }

  private buildWaterfallSteps(machines: VisualMachine[]): WaterfallStep[] {
    const componentRows = machines.map((machine) => this.oeeComponentLosses(machine));
    this.waterfallActual = this.average(componentRows.map((row) => row.actual));
    this.waterfallGap = Math.max(0, this.oeeTarget - this.waterfallActual);

    if (!componentRows.length) return [];

    const steps = [
      {
        label: 'Availability Loss',
        value: this.average(componentRows.map((row) => row.availabilityLoss)),
        remaining: this.average(componentRows.map((row) => row.afterAvailability)),
      },
      {
        label: 'Quality Loss',
        value: this.average(componentRows.map((row) => row.throughputLoss)),
        remaining: this.average(componentRows.map((row) => row.afterThroughput)),
      },
      {
        label: 'Efficiency Loss',
        value: this.average(componentRows.map((row) => row.efficiencyLoss)),
        remaining: this.waterfallActual,
      },
    ];

    return steps
      .filter((step) => step.value > 0)
      .map((step) => ({
        ...step,
        width: this.clamp(step.value, 4, 100),
        tone: step.value >= 20 ? 'bad' : 'watch',
      }));
  }

  private machineTone(statusDot: string, oee: number): string {
    if (statusDot === 'Running Dot' && oee >= 75) return 'good';
    if (statusDot === 'Fault Dot' || oee < 55) return 'bad';
    return 'watch';
  }

  private clearDashboard(): void {
    this.metrics = [];
    this.machines = [];
    this.timelineRows = [];
    this.bulletRows = [];
    this.heatmapRows = [];
    this.waterfallSteps = [];
    this.faultRows = [];
  }

  private unwrapList(data: any, fallbackKey: string): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[fallbackKey])) return data[fallbackKey];
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.results)) return data.results;
    return [];
  }

  private average(values: number[]): number {
    const numeric = values.filter((value) => Number.isFinite(value));
    if (!numeric.length) return 0;
    return Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
  }

  private percent(value: any): number {
    if (value == null) return 0;
    if (typeof value === 'number') return Math.round(value);
    const parsed = Number(String(value).replace('%', ''));
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  private performancePercent(value: any): number {
    if (value && typeof value === 'object') {
      if (value.percentage != null) return this.percent(value.percentage);
      if (value.value != null) return this.ratioPercent(value.value);
    }
    return this.percent(value);
  }

  private ratioPercent(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed <= 1 ? parsed * 100 : parsed);
  }

  private oeeComponentLosses(machine: VisualMachine): {
    availabilityLoss: number;
    throughputLoss: number;
    efficiencyLoss: number;
    afterAvailability: number;
    afterThroughput: number;
    actual: number;
  } {
    const availability = this.clamp(machine.availability, 0, 100);
    const throughput = this.clamp(machine.throughput, 0, 100);
    const efficiency = this.clamp(machine.efficiency, 0, 100);
    const afterThroughput = availability * (throughput / 100);
    const actual = afterThroughput * (efficiency / 100);

    return {
      availabilityLoss: Math.round(100 - availability),
      throughputLoss: Math.round(availability - afterThroughput),
      efficiencyLoss: Math.round(afterThroughput - actual),
      afterAvailability: Math.round(availability),
      afterThroughput: Math.round(afterThroughput),
      actual: Math.round(actual),
    };
  }

  private numeric(value: any): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private totalStateMs(machine: VisualMachine): number {
    return machine.runningMs + machine.pausedMs + machine.faultedMs + machine.offlineMs;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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
}
