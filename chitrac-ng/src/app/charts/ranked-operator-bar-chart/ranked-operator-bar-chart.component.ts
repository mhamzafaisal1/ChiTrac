// charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

type OperatorRow = { name: string; efficiency: number };

@Component({
  selector: 'app-ranked-operator-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './ranked-operator-bar-chart.component.html',
  styleUrls: ['./ranked-operator-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RankedOperatorBarChartComponent implements OnInit, OnDestroy, OnChanges {
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
    // optional logs
    // console.log('RankedOperatorBarChart: Input changes:', changes);
    // console.log('RankedOperatorBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();

    // Consolidated initial fetch logic - only one fetch call
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
        this.endTime   = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

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
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime   = this.pollingService.updateEndTimestampToNow();

    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.chartConfig = null;
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPolling();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getDailyTopOperators(this.startTime, this.endTime)
          .pipe(tap(this.consumeResponse('poll')));
      },
      this.POLLING_INTERVAL,
      this.destroy$,
      false,
      false
    ).subscribe({ error: () => this.stopPolling() });
  }

  private stopPolling(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
    this.cdr.markForCheck();
  }

  private fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return new Observable();
    this.isLoading = true;
    return this.dailyDashboardService.getDailyTopOperators(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      let rows: OperatorRow[] = [];
      if (res && res.topOperators && Array.isArray(res.topOperators)) {
        rows = res.topOperators.map((r: any) => ({
          name: String(r.name ?? r.operator ?? r.id ?? 'Unknown'),
          efficiency: Number(r.efficiency ?? r.oee ?? 0)
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((r: any) => ({
          name: String(r.name ?? r.operator ?? r.id ?? 'Unknown'),
          efficiency: Number(r.efficiency ?? r.oee ?? 0)
        }));
      }

      const top = rows.sort((a, b) => b.efficiency - a.efficiency).slice(0, 10);

      this.chartConfig = top.length ? this.formatChartData(top) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: OperatorRow[]): CartesianChartConfig {
    // Convert operator data to cartesian chart format with horizontal bars
    const series: XYSeries[] = [
      {
        id: 'efficiency',
        title: 'Efficiency',
        type: 'bar',
        data: data.map((op, i) => ({ 
          x: op.name,  // operator names on Y-axis (horizontal bars)
          y: op.efficiency  // efficiency values on X-axis
        })),
        color: '#42a5f5'
      }
    ];

    return {
      title: 'Top Operators by Efficiency',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal', // horizontal bars
      xType: 'linear', // efficiency values are numeric
      xLabel: 'Efficiency (%)',
      yLabel: 'Operator',
      margin: {
        top: Math.max(this.marginTop || 50, 60),
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 120) // more space for operator names
      },
      legend: {
        show: this.showLegend !== false,
        position: this.legendPosition || 'top'
      },
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
}
