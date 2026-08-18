// charts/daily-count-bar-chart/daily-count-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

type DailyCountPoint = {
  date: string;
  count: number;
  movingAverage: number | null;
  previousDeltaPct: number | null;
  averageDeltaPct: number | null;
  isToday: boolean;
};

@Component({
  selector: 'app-daily-count-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-count-bar-chart.component.html',
  styleUrls: ['./daily-count-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyCountBarChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;

  // pass-through props (added to mirror other charts)
  @Input() showLegend!: boolean;
  @Input() legendPosition!: 'top' | 'right';
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @Input() preloadedData?: any[] | null;
  @Input() useExternalTitle = false;

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
    private dashboardService: DashboardService,
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

    if (this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
    } else {
      const now = new Date();
      const start = new Date(); start.setHours(0,0,0,0);
      this.startTime = this.formatDateForInput(start);
      this.endTime = this.formatDateForInput(now);
    }

    this.enterDummy();
    if (this.useExternalTitle) return;
    
    // Consolidated initial fetch logic - only one fetch call
    this.performInitialFetch(isLive, wasConfirmed);

    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((live: boolean) => {
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

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['startDate'] || changes['endDate']) && this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
      // Only update time variables, no API call here
    }

    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ dailyCounts: this.preloadedData });
    } else if (changes['preloadedData'] && !this.preloadedData && this.liveMode && !this.dateTimeService.getConfirmed()) {
      this.setupPolling();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  // ---- flow ----
  private performInitialFetch(isLive: boolean, wasConfirmed: boolean): void {
    // Determine if we should fetch data based on the current state
    const shouldFetch = !isLive || wasConfirmed;
    
    if (shouldFetch) {
      // Use confirmed times if available, otherwise use default times
      if (wasConfirmed) {
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
      }
      
      this.fetchOnce().subscribe();
    }
  }


  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0,0,0,0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.pollingService.updateEndTimestampToNow();

    // setupPolling() handles the initial fetch, no need for separate fetchOnce()
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
    return this.dashboardService.getDailyCountTotals(this.startTime, this.endTime)
      .pipe(tap(this.consumeResponse('poll')));
  }

  private setupPolling(): void {
    this.stopPolling();

    this.pollingSub = this.pollOnce()               // immediate first poll
      .pipe(
        // wait POLLING_INTERVAL after completion, then resubscribe to pollOnce()
        // ensures: no overlap, next call starts only after prior finished + delay
        // RxJS 7+
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
    return this.dashboardService.getDailyCountTotals(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      let rows: any[] = [];
      if (res && res.dailyCounts && Array.isArray(res.dailyCounts)) {
        rows = res.dailyCounts;
      } else if (Array.isArray(res)) {
        rows = res;
      }

      this.chartConfig = rows.length ? this.formatChartData(rows) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: any[]): CartesianChartConfig {
    const points = this.buildDailyCountPoints(data);
    const yMax = Math.max(0, ...points.flatMap(point => [
      point.count,
      point.movingAverage ?? 0
    ]));
    const shouldAbbreviateYAxis = yMax > 10000;

    // Convert daily count data to cartesian chart format
    const series: XYSeries[] = [
      {
        id: 'counts',
        title: 'Counts',
        type: 'bar',
        data: points.map(point => ({
          x: point.date,
          y: point.count,
          color: this.getVarianceColor(point)
        })),
        color: '#42a5f5'
      },
      {
        id: 'moving-average',
        title: '7-Day Avg',
        type: 'line',
        data: points
          .filter(point => point.movingAverage != null)
          .map(point => ({
            x: point.date,
            y: point.movingAverage ?? 0
          })),
        color: '#ffca28',
        options: {
          showDots: false
        }
      }
    ];

    return {
      title: this.useExternalTitle ? '' : 'Daily Count Totals',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'vertical',
      xType: 'category',
      xTickFormat: (v: any) => this.formatXAxisDate(v),
      yTickFormat: shouldAbbreviateYAxis
        ? (v: any) => this.formatCountTickAsThousands(v)
        : (v: any) => this.formatCountTick(v),
      margin: {
        top: this.useExternalTitle ? 12 : Math.max(this.marginTop || 40, 60),
        right: Math.max(this.marginRight || 30, 30),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft ?? 0, 60) 
      },
      legend: { show: false, position: 'top' },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ series, xLabel, value }) => this.formatTooltip(series.id, xLabel, value, points)
      },
      series: series
    };
  }

  private buildDailyCountPoints(data: any[]): DailyCountPoint[] {
    const todayKey = this.toDateKey(new Date());
    const raw = data.map((d: any, i: number) => ({
      date: String(d.date ?? d.label ?? `Day ${i + 1}`),
      count: Number(d.count ?? d.counts ?? 0) || 0
    }));

    return raw.map((point, index) => {
      const windowStart = Math.max(0, index - 6);
      const movingWindow = raw.slice(windowStart, index + 1);
      const movingAverage = movingWindow.length
        ? movingWindow.reduce((sum, row) => sum + row.count, 0) / movingWindow.length
        : null;
      const previous = index > 0 ? raw[index - 1].count : null;
      return {
        ...point,
        movingAverage,
        previousDeltaPct: previous && previous > 0
          ? ((point.count - previous) / previous) * 100
          : null,
        averageDeltaPct: movingAverage && movingAverage > 0
          ? ((point.count - movingAverage) / movingAverage) * 100
          : null,
        isToday: this.toDateKey(point.date) === todayKey
      };
    });
  }

  private getVarianceColor(point: DailyCountPoint): string {
    if (point.isToday) return '#26a69a';
    const delta = point.averageDeltaPct;
    if (delta == null) return '#42a5f5';
    if (delta <= -12) return '#ef5350';
    if (delta <= -6) return '#ffca28';
    if (delta >= 10) return '#66bb6a';
    return '#42a5f5';
  }

  private formatTooltip(seriesId: string, xLabel: string, value: number, points: DailyCountPoint[]): string[] {
    const point = points.find(row => String(row.date) === String(xLabel));
    const lines = [
      `${this.formatXAxisDate(xLabel)}${point?.isToday ? ' (Today)' : ''}`,
      seriesId === 'moving-average'
        ? `7-Day Avg: ${this.formatCount(value)}`
        : `Total Count: ${this.formatCount(value)}`
    ];

    if (seriesId !== 'moving-average' && point) {
      if (point.previousDeltaPct != null) {
        lines.push(`Vs Previous Day: ${this.formatSignedPercent(point.previousDeltaPct)}`);
      }
      if (point.averageDeltaPct != null) {
        lines.push(`Vs 7-Day Avg: ${this.formatSignedPercent(point.averageDeltaPct)}`);
      }
    }

    return lines;
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();
  }

  /** Format x-axis tick: month and day only (no year). */
  private formatXAxisDate(v: any): string {
    const s = String(v);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      const date = new Date(+y, +m - 1, +d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return s;
  }

  private toDateKey(value: string | Date): string {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const s = String(value);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return this.toDateKey(parsed);
    return s;
  }

  private formatCountTick(v: any): string {
    const value = Number(v);
    return Number.isFinite(value) ? value.toLocaleString('en-US') : String(v);
  }

  private formatCountTickAsThousands(v: any): string {
    const value = Number(v);
    if (!Number.isFinite(value)) return String(v);
    if (Math.abs(value) < 1000) return this.formatCountTick(value);
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private formatCount(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }

  private formatSignedPercent(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
