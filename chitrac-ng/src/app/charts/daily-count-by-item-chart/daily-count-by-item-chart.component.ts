// charts/daily-count-by-item-chart/daily-count-by-item-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

@Component({
  selector: 'app-daily-count-by-item-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-count-by-item-chart.component.html',
  styleUrls: ['./daily-count-by-item-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyCountByItemChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: "top" | "right";
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

  /** Palette for item bars (each item gets a different color) */
  private readonly ITEM_COLORS = [
    '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#ef5350',
    '#26a69a', '#ff7043', '#5c6bc0', '#ec407a', '#8d6e63'
  ];

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

  ngOnChanges(changes: SimpleChanges): void {}

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
      .subscribe((live) => {
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
    this.endTime = this.pollingService.updateEndTimestampToNow();
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
    return this.dailyDashboardService.getItemTotalsByType(this.startTime, this.endTime)
      .pipe(tap(this.consumeResponse('poll')));
  }

  private setupPolling(): void {
    this.stopPolling();
    this.pollingSub = this.pollOnce()
      .pipe(
        // @ts-ignore
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
    return this.dailyDashboardService.getItemTotalsByType(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      let items: Array<{ itemName: string; totalCount: number }> = [];

      if (res && res.itemTotals && res.itemTotals.items && Array.isArray(res.itemTotals.items)) {
        items = res.itemTotals.items;
      } else if (res && Array.isArray(res.items)) {
        items = res.items;
      }

      this.chartConfig = items.length ? this.formatChartData(items) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: Array<{ itemName: string; totalCount: number }>): CartesianChartConfig {
    const series: XYSeries[] = data.map((item, index) => ({
      id: `item-${index}`,
      title: item.itemName,
      type: 'bar',
      data: [{ x: item.itemName, y: item.totalCount }],
      color: this.ITEM_COLORS[index % this.ITEM_COLORS.length],
      options: { barPadding: 0.2 }
    }));

    return {
      title: 'Item Totals by Type',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      xLabel: 'Count',
      yLabel: 'Item',
      margin: {
        top: Math.max(this.marginTop || 50, 60),
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft ?? 0, 150) 
      },
      legend: { show: false, position: 'top' },
      series: series
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

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
    this.cdr.markForCheck();
  }
}
