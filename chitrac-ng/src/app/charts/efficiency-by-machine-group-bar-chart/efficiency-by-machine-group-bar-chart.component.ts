// charts/efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

type GroupRow = { id: string; name: string; efficiency: number; efficiencyPreviousDay?: number | null };

@Component({
  selector: 'app-efficiency-by-machine-group-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './efficiency-by-machine-group-bar-chart.component.html',
  styleUrls: ['./efficiency-by-machine-group-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EfficiencyByMachineGroupBarChartComponent implements OnInit, OnDestroy, OnChanges {
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
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')(this.preloadedData);
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
    return this.dashboardService.getMachinesGroupSummary(this.startTime, this.endTime)
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
    return this.dashboardService.getMachinesGroupSummary(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      let rows: GroupRow[] = [];
      const arr = Array.isArray(res) ? res : (res?.data ?? res?.groups ?? []);
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const name = item?.machine?.name ?? item?.name ?? `Group ${i}`;
        const eff = item?.metrics?.performance?.efficiency;
        const value = typeof eff?.value === 'number' ? eff.value * 100 :
          (typeof eff?.percentage === 'string' ? parseFloat(eff.percentage) : Number(eff?.percentage ?? 0));
        const prev = item?.efficiencyPreviousDay;
        const efficiencyPreviousDay =
          prev == null
            ? null
            : typeof prev.value === 'number'
              ? prev.value * 100
              : (typeof prev.percentage === 'string' ? parseFloat(prev.percentage) : Number(prev.percentage ?? 0));
        rows.push({
          id: `group-${i}`,
          name: String(name),
          efficiency: value,
          efficiencyPreviousDay: efficiencyPreviousDay ?? undefined,
        });
      }

      // Sort descending by efficiency
      rows.sort((a, b) => b.efficiency - a.efficiency);

      this.chartConfig = rows.length ? this.formatChartData(rows) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: GroupRow[]): CartesianChartConfig {
    const series: XYSeries[] = [{
      id: 'machine-groups',
      title: 'Efficiency',
      type: 'bar',
      data: data.map(g => ({
        x: g.id,
        y: g.efficiency,
        color: this.getEfficiencyColor(g.efficiency),
        ...(g.efficiencyPreviousDay != null && g.efficiencyPreviousDay > 0
          ? { endMarkerValue: g.efficiencyPreviousDay }
          : {}),
      })),
      options: {
        barPadding: 0.2,
        endMarker: { show: true, dash: '6,6', stroke: '#1e88e5', strokeWidth: 2 },
      },
    }];

    return {
      title: this.useExternalTitle ? '' : 'Efficiency % by Machine Group',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      yTickFormat: (v: any) => {
        const key = String(v);
        return data.find(d => d.id === key)?.name ?? key;
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
          `Machine Group: ${this.getMachineGroupName(data, xLabel)}`,
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

  private getMachineGroupName(data: GroupRow[], id: string): string {
    return data.find(group => group.id === String(id))?.name ?? id;
  }

  private formatPercent(value: number): string {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
