// charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

type OperatorRow = { id: number | string; label: string; efficiency: number };

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
    private dateTimeService: DateTimeService,
    private percentBreakpointService: PercentBreakpointService
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
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ topOperators: this.preloadedData });
    } else if (changes['preloadedData'] && !this.preloadedData && this.liveMode && !this.dateTimeService.getConfirmed()) {
      this.setupPolling();
    }
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();
    if (this.useExternalTitle) return;

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
    return this.dashboardService.getDailyTopOperators(this.startTime, this.endTime)
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
    return this.dashboardService.getDailyTopOperators(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private formatOperatorName(name: any): string {
    // Handle name as object with first and surname properties
    if (name && typeof name === 'object') {
      const first = name.first || '';
      const surname = name.surname || '';
      return `${first} ${surname}`.trim() || 'Unknown';
    }
    // Handle name as string or fallback
    return String(name ?? 'Unknown');
  }

  private consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      let rows: OperatorRow[] = [];
      if (res && res.topOperators && Array.isArray(res.topOperators)) {
        rows = res.topOperators.map((r: any, i: number) => ({
          id: r.id ?? `row-${i}`,
          label: this.formatOperatorName(r.name ?? r.operator ?? r.id),
          efficiency: Number(r.efficiency ?? r.oee ?? 0)
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((r: any, i: number) => ({
          id: r.id ?? `row-${i}`,
          label: this.formatOperatorName(r.name ?? r.operator ?? r.id),
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
    // One bar series with unique x keys (id) so duplicate display names don't flip render path.
    // Per-bar color via XYPoint.color; Y-axis labels via yTickFormat from id -> label.
    const series: XYSeries[] = [{
      id: 'operators',
      title: 'Efficiency',
      type: 'bar',
      data: data.map(op => ({
        x: String(op.id),
        y: op.efficiency,
        color: this.getEfficiencyColor(op.efficiency),
      })),
      options: { barPadding: 0.2 },
    }];

    return {
      title: this.useExternalTitle ? '' : 'Top Operators by Efficiency',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      yTickFormat: (v: any) => {
        const key = String(v);
        return data.find(d => String(d.id) === key)?.label ?? key;
      },
      margin: {
        top: Math.max(this.marginTop || 40, this.useExternalTitle ? 24 : 60),
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 120)
      },
      legend: { show: false, position: 'top' },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ xLabel, value }) => [
          `Operator: ${this.getOperatorLabel(data, xLabel)}`,
          `Efficiency%: ${this.formatPercent(value)}`
        ]
      },
      series,
    };
  }

  private getEfficiencyColor(efficiency: number): string {
    return this.percentBreakpointService.getColorHex(efficiency);
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

  private getOperatorLabel(data: OperatorRow[], id: string): string {
    return data.find(op => String(op.id) === String(id))?.label ?? id;
  }

  private formatPercent(value: number): string {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
