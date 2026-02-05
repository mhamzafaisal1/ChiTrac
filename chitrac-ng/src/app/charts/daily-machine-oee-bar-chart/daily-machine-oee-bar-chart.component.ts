// charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';

@Component({
  selector: 'app-daily-machine-oee-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-machine-oee-bar-chart.component.html',
  styleUrls: ['./daily-machine-oee-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyMachineOeeBarChartComponent implements OnInit, OnDestroy, OnChanges {
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
    // console.log('DailyMachineOeeBarChart: Input changes:', changes);
    // console.log('DailyMachineOeeBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    // default [start,end] = [midnight, now]
    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();

    // Consolidated initial fetch logic - only one fetch call
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
    const start = new Date(); start.setHours(0, 0, 0, 0);
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
    return this.dailyDashboardService.getDailyMachineOee(this.startTime, this.endTime)
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
    return this.dailyDashboardService.getDailyMachineOee(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      // Handle the API response structure with machineOee array
      let rows: Array<any> = [];
      
      if (res && res.machineOee && Array.isArray(res.machineOee)) {
        rows = res.machineOee;
      } else if (Array.isArray(res)) {
        rows = res;
      }
      
      // Normalize and sort by OEE desc to match "Ranked OEE% by Machine"
      const normalized = rows.map((m: any) => ({
        name: m.name ?? m.machine ?? m.serial ?? 'Unknown',
        oee: Number(m.oee ?? m.efficiency ?? 0)
      })).sort((a, b) => b.oee - a.oee);

      this.chartConfig = normalized.length ? this.formatChartData(normalized) : null;
      this.isLoading = false;          // set to false unconditionally
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;
      
      this.cdr.markForCheck();        // <— critical
    };

  private formatChartData(data: Array<{name: string, oee: number}>): CartesianChartConfig {
    // Convert machine OEE data to cartesian chart format with color-coded horizontal bars
    const series: XYSeries[] = data.map((machine, index) => ({
      id: `machine-${index}`,
      title: machine.name,
      type: 'bar',
      data: [{ x: machine.name, y: machine.oee }],  // names on Y-axis, OEE on X-axis (horizontal bars)
      color: this.getOeeColor(machine.oee),  // Color based on OEE percentage
      options: { barPadding: 0.2 }
    }));

    return {
      title: 'Ranked OEE% by Machine',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',  // horizontal bars: machines on Y, OEE % on X
      xType: 'linear',  // OEE values are numeric (X-axis = bar length)
      xLabel: 'OEE (%)',
      yLabel: 'Machine',
      margin: {
        top: Math.max(this.marginTop || 50, 60),
        right: Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 120)  // space for machine names
      },
      legend: {
        show: false,  // No legend needed for individual machine bars
        position: 'top'  // Required property, but not used since show is false
      },
      series: series
    };
  }

  private getOeeColor(oee: number): string {
    // Same color logic as BarChartComponent for OEE mode
    if (oee >= 85) return '#66bb6a';  // Green: Excellent (85%+)
    if (oee >= 60) return '#ffca28';  // Yellow: Good (60-84%)
    return '#ef5350';                 // Red: Poor (<60%)
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();          // <— ensure overlay shows/hides
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
