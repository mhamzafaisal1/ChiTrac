// charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable, EMPTY } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

interface MachineStatus {
  serial: number;
  name: string;
  runningMs: number;
  pausedMs: number;
  faultedMs: number;
}

@Component({
  selector: 'app-daily-machine-stacked-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-machine-stacked-bar-chart.component.html',
  styleUrls: ['./daily-machine-stacked-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyMachineStackedBarChartComponent implements OnInit, OnDestroy, OnChanges {
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

  ngOnChanges(changes: SimpleChanges): void {
    // console.log('DailyMachineStackedBarChart: Input changes:', changes);
    // console.log('DailyMachineStackedBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
  }

  chartConfig: CartesianChartConfig | null = null;

  isDarkTheme = false;
  isLoading = false;
  hasInitialData = false;
  dummyMode = true;

  startTime = '';
  endTime = '';
  liveMode = false;

  private destroy$ = new Subject<void>();
  private pollingSub: any;
  private readonly POLLING_INTERVAL = 6000;
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService
  ) {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    new MutationObserver(() => {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
    }).observe(document.body, { attributes: true });
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime   = this.dateTimeService.getEndTime();
      this.fetchOnce().subscribe();
    }
    if (!wasConfirmed) {
      this.fetchOnce().subscribe();
    }

    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((live) => {
        this.liveMode = live;
        if (live) this.startLive(); else this.stopLive();
      });

    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPollingInternal();
        this.enterDummy();
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime   = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });

    // Optional sanity check: fetch once if nothing has loaded within the first tick
    setTimeout(() => {
      if (!this.hasInitialData && this.isLoading) {
        this.fetchOnce().subscribe();
      }
    }, 0);
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPollingInternal();
  }

  // ---- flow ----
  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime   = this.pollingService.updateEndTimestampToNow();

    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPollingInternal();
    this.hasInitialData = false;
    this.chartConfig = null;
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPollingInternal();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getDailyMachineStatus(this.startTime, this.endTime, this.serial)
          .pipe(tap(this.consumeResponse('poll')));
      },
      this.POLLING_INTERVAL,
      this.destroy$,
      false,
      false
    ).subscribe({ error: () => this.stopPollingInternal() });
  }

  private stopPollingInternal(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
    this.cdr.markForCheck();          // <— optional but safe
  }

  private fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return EMPTY;
    this.isLoading = true;
    return this.dailyDashboardService.getDailyMachineStatus(this.startTime, this.endTime, this.serial)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
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
          faultedMs:m.faultedMs ?? m.faulted ?? 0
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((m: any) => ({
          serial:   m.serial ?? m.machineId ?? 0,
          name:     m.name ?? m.machineName ?? `Machine ${m.serial ?? 'Unknown'}`,
          runningMs:m.runningMs ?? m.running ?? 0,
          pausedMs: m.pausedMs  ?? m.paused  ?? 0,
          faultedMs:m.faultedMs ?? m.faulted ?? 0
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
    
    
    // Convert machine data to cartesian chart format
    const series: XYSeries[] = [
      {
        id: 'running',
        title: 'Running',
        type: 'bar',
        stack: 'status', // This groups them for stacking
        data: data.map(d => ({ x: d.name, y: toHours(d.runningMs) })),
        color: '#66bb6a'
      },
      {
        id: 'paused',
        title: 'Paused',
        type: 'bar',
        stack: 'status', // Same stack group for stacking
        data: data.map(d => ({ x: d.name, y: toHours(d.pausedMs) })),
        color: '#ffca28'
      },
      {
        id: 'faulted',
        title: 'Faulted',
        type: 'bar',
        stack: 'status', // Same stack group for stacking
        data: data.map(d => ({ x: d.name, y: toHours(d.faultedMs) })),
        color: '#ef5350'
      }
    ];

    return {
      title: 'Daily Machine Status',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'vertical',
      xType: 'category',
      xLabel: 'Machine',
      yLabel: 'Hours',
      margin: {
        top: Math.max(this.marginTop || 50, 60), // Ensure enough space for legend
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)), // Space for right legend
        bottom: this.marginBottom || 50,
        left: this.marginLeft || 50
      },
      legend: {
        show: this.showLegend !== false,
        position: this.legendPosition || 'right' // Now supports both 'top' and 'right'
      },
      series: series
    };
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();          // <— ensure overlay shows/hides
  }

  // ---- grid interface methods ----
  startPolling(): void {
    // ensure one immediate fetch
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime   = this.pollingService.updateEndTimestampToNow();

    this.enterDummy();
    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  stopPolling(): void {
    this.stopLive(); // calls the existing private stopPolling method
  }

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
  }



  // ---- utils ----
  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
