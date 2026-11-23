// charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { Observable } from 'rxjs';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
interface MachineStatus {
  serial: number;
  name: string;
  runningMs: number;
  pausedMs: number;
  faultedMs: number;
  offlineMs: number;
}

@Component({
  selector: 'app-daily-machine-stacked-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-machine-stacked-bar-chart.component.html',
  styleUrls: ['./daily-machine-stacked-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyMachineStackedBarChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: "top" | "right";
  @Input() legendWidthPx!: number;
  @Input() serial?: number; // optional filter
  @Input() preloadedData?: MachineStatus[] | null;
  @Input() useExternalTitle = false;

  ngOnChanges(changes: SimpleChanges): void {
    // console.log('DailyMachineStackedBarChart: Input changes:', changes);
    // console.log('DailyMachineStackedBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ machineStatus: this.preloadedData });
    } else if (changes['preloadedData'] && !this.preloadedData && this.liveMode && !this.dateTimeService.getConfirmed()) {
      this.setupPolling();
    }
  }

  chartConfig: CartesianChartConfig | null = null;

  constructor(
    private dashboardService: DashboardService,
    private dateTimeService: DateTimeService
  ) {
    super();
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = toDateTimeLocalInput(start);
    this.endTime = toDateTimeLocalInput(now);

    if (!this.preloadedData) this.enterDummy();
    if (this.useExternalTitle) return;

    // Consolidated initial fetch logic - only one fetch call
    this.startTimeframeSync(isLive, wasConfirmed);
  }

  // ---- flow ----

  protected clearChart(): void {
    this.chartConfig = null;
  }

  protected loadData(start: string, end: string): Observable<any> {
    return this.dashboardService.getDailyMachineStatus(start, end, this.serial);
  }

  protected consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      // Handle the API response structure with machineStatus array
      let rows: MachineStatus[] = [];
      
      if (res && res.machineStatus && Array.isArray(res.machineStatus)) {
        rows = res.machineStatus.map((m: any) => ({
          serial:   m.serial ?? m.machineId ?? 0,
          name:     m.name ?? m.machineName ?? `Machine ${m.serial ?? 'Unknown'}`,
          runningMs:m.runningMs ?? m.running ?? 0,
          pausedMs: m.pausedMs  ?? m.paused  ?? 0,
          faultedMs:m.faultedMs ?? m.faulted ?? 0,
          offlineMs: m.offlineMs ?? 0
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((m: any) => ({
          serial:   m.serial ?? m.machineId ?? 0,
          name:     m.name ?? m.machineName ?? `Machine ${m.serial ?? 'Unknown'}`,
          runningMs:m.runningMs ?? m.running ?? 0,
          pausedMs: m.pausedMs  ?? m.paused  ?? 0,
          faultedMs:m.faultedMs ?? m.faulted ?? 0,
          offlineMs: m.offlineMs ?? 0
        }));
      }

      this.chartConfig = rows.length ? this.formatMachineData(rows) : null;
      this.isLoading = false;          // set to false unconditionally
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig; // or chartConfig.length > 0
      
      this.cdr.markForCheck();        // <— critical
      
    };

  // ---- mapping ----
  private formatMachineData(data: MachineStatus[]): CartesianChartConfig {
    const toHours = (ms: number) => ms / 3_600_000;
    const maxMachineNameLength = data.reduce((max, machine) => Math.max(max, machine.name.length), 0);
    const leftMargin = Math.min(150, Math.max(92, maxMachineNameLength * 7 + 16));

    // Convert machine data to cartesian chart format (Offline = remainder, grey)
    const series: XYSeries[] = [
      {
        id: 'running',
        title: 'Running',
        type: 'bar',
        stack: 'status',
        data: data.map(d => ({ x: d.name, y: toHours(d.runningMs) })),
        color: '#66bb6a',
        options: { barPadding: 0.2 }
      },
      {
        id: 'paused',
        title: 'Paused',
        type: 'bar',
        stack: 'status',
        data: data.map(d => ({ x: d.name, y: toHours(d.pausedMs) })),
        color: '#ffca28',
        options: { barPadding: 0.2 }
      },
      {
        id: 'faulted',
        title: 'Faulted',
        type: 'bar',
        stack: 'status',
        data: data.map(d => ({ x: d.name, y: toHours(d.faultedMs) })),
        color: '#ef5350',
        options: { barPadding: 0.2 }
      },
      {
        id: 'offline',
        title: 'Offline',
        type: 'bar',
        stack: 'status',
        data: data.map(d => ({ x: d.name, y: toHours(d.offlineMs ?? 0) })),
        color: 'var(--sg-color-blue-gray-medium-100)', // theme-aware grey
        options: { barPadding: 0.2 }
      }
    ];

    return {
      title: this.useExternalTitle ? '' : 'Daily Machine Status',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'category',
      fitToContentMargins: this.useExternalTitle,
      margin: {
        top: this.useExternalTitle ? 4 : Math.max(this.marginTop || 40, 60),
        right: this.useExternalTitle ? 8 : Math.max(this.marginRight || 30, 30),
        bottom: this.useExternalTitle ? 22 : Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, leftMargin)
      },
      legend: {
        show: false,
        position: 'top',
        titleYOffset: -10,
        yOffset: 10
      },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ series, xLabel, value }) => [
          `Machine: ${xLabel}`,
          `${this.getStatusTimeLabel(series.id)}: ${this.formatDuration(value * 3_600_000)}`
        ]
      },
      series: series
    };
  }

  protected enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();          // <— ensure overlay shows/hides
  }

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
  }

  // ---- utils ----

  private getStatusTimeLabel(statusId: string): string {
    switch (statusId) {
      case 'running': return 'Run Time';
      case 'paused': return 'Paused Time';
      case 'faulted': return 'Fault Time';
      case 'offline': return 'Offline Time';
      default: return 'Time';
    }
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, '0'))
      .join(':');
  }
}
