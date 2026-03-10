// charts/top-faults-bar-chart/top-faults-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

type FaultRow = { code: number | string; label: string; count: number };

@Component({
  selector: 'app-top-faults-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './top-faults-bar-chart.component.html',
  styleUrls: ['./top-faults-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TopFaultsBarChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: 'top' | 'right';
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;

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

  ngOnChanges(changes: SimpleChanges): void {
    // No-op for now, kept for symmetry with other charts
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();

    this.performInitialFetch(isLive, wasConfirmed);

    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe(live => {
        this.liveMode = live;
        if (live) this.startLive(); else this.stopLive();
      });

    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPolling();
        this.enterDummy();
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  private performInitialFetch(isLive: boolean, wasConfirmed: boolean): void {
    const shouldFetch = !isLive || wasConfirmed;

    if (shouldFetch) {
      if (wasConfirmed) {
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
      }
      this.fetchOnce().subscribe();
    }
  }

  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime   = this.pollingService.updateEndTimestampToNow();

    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.chartConfig = null;
    this.enterDummy();
  }

  private pollOnce(): Observable<any> {
    this.endTime = this.pollingService.updateEndTimestampToNow();
    return this.dailyDashboardService.getDailyTopFaults(this.startTime, this.endTime)
      .pipe(tap(this.consumeResponse('poll')));
  }

  private setupPolling(): void {
    this.stopPolling();

    this.pollingSub = this.pollOnce()
      .pipe(
        // @ts-ignore – type inference sometimes complains on repeat config
        repeat({ delay: this.POLLING_INTERVAL }),
        takeUntil(this.destroy$)
      )
      .subscribe({ error: () => this.stopPolling() });
  }

  private stopPolling(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
  }

  private fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return new Observable();
    this.isLoading = true;
    return this.dailyDashboardService.getDailyTopFaults(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private formatFaultLabel(f: any): string {
    const code = f?.code ?? f?._id ?? 'Unknown';
    const name = f?.name ?? 'Fault';
    return `${code} – ${name}`;
  }

  private consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      let rows: FaultRow[] = [];

      const faults = Array.isArray(res)
        ? res
        : (res?.topFaults ?? res?.faults ?? []);

      if (Array.isArray(faults)) {
        rows = faults.map((f: any, i: number) => ({
          code: f.code ?? f.id ?? `fault-${i}`,
          label: this.formatFaultLabel(f),
          count: Number(f.count ?? f.total ?? 0)
        }));
      }

      const top = rows
        .filter(r => Number.isFinite(r.count) && r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      this.chartConfig = top.length ? this.formatChartData(top) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: FaultRow[]): CartesianChartConfig {
    const series: XYSeries[] = [{
      id: 'faults',
      title: 'Occurrences',
      type: 'bar',
      data: data.map(f => ({
        x: String(f.code),
        y: f.count,
        color: '#ef5350', // red for faults
      })),
      options: { barPadding: 0.2 },
    }];

    return {
      title: 'Top 10 Fault Codes',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      xLabel: 'Occurrences',
      yLabel: 'Fault Code',
      yTickFormat: (v: any) => {
        const key = String(v);
        return data.find(d => String(d.code) === key)?.label ?? key;
      },
      margin: {
        top: Math.max(this.marginTop || 50, 60),
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 160)
      },
      legend: { show: false, position: 'top' },
      series,
    };
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();
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

