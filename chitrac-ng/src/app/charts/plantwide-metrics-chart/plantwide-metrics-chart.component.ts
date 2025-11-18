// charts/plantwide-metrics-chart/plantwide-metrics-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../../charts/cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay, repeat } from 'rxjs/operators';


@Component({
  selector: 'app-plantwide-metrics-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './plantwide-metrics-chart.component.html',
  styleUrls: ['./plantwide-metrics-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlantwideMetricsChartComponent implements OnInit, OnDestroy, OnChanges {
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
    // console.log('PlantwideMetricsChart: Input changes:', changes);
    // console.log('PlantwideMetricsChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
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
        this.endTime   = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  // flow
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
    return this.dailyDashboardService.getDailyPlantwideMetrics(this.startTime, this.endTime)
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
    return this.dailyDashboardService.getDailyPlantwideMetrics(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      // Handle the API response structure with plantwideMetrics array
      type Row = { hour:number; availability:number; efficiency:number; throughput:number; oee:number };
      let rows: Row[] = [];
      
      if (res?.plantwideMetrics && Array.isArray(res.plantwideMetrics)) {
        rows = res.plantwideMetrics;
      } else if (Array.isArray(res)) {
        rows = res;
      }
      
      if (rows.length === 0) {
        this.chartConfig = null;
        this.hasInitialData = false;
        this.isLoading = false;
        this.dummyMode = false;
        this.cdr.markForCheck();
        return;
      }

      rows.sort((a,b)=>(a.hour??0)-(b.hour??0));

      const hours = rows.map(r => Number(r.hour ?? 0));
      const fmt = (h:number) => h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
      const labels = hours.map(fmt);

      const series: XYSeries[] = [
        {
          id:'availability', title:'Availability', type:'bar', color:'#66bb6a',
          data: rows.map((r,i)=>({ x: labels[i] || `Hour ${i}`, y: Number(r.availability ?? 0) })),
          options:{ barPadding:0.2 }
        },
        {
          id:'efficiency', title:'Efficiency', type:'bar', color:'#ffca28',
          data: rows.map((r,i)=>({ x: labels[i] || `Hour ${i}`, y: Number(r.efficiency ?? 0) }))
        },
        {
          id:'throughput', title:'Throughput', type:'bar', color:'#ef5350',
          data: rows.map((r,i)=>({ x: labels[i] || `Hour ${i}`, y: Number(r.throughput ?? 0) }))
        },
        {
          id:'oee', title:'OEE', type:'line', color:'#ab47bc',
          data: rows.map((r,i)=>({ x: labels[i] || `Hour ${i}`, y: Number(r.oee ?? 0) })),
          options:{ showDots:true, radius:3 }
        }
      ];

      this.chartConfig = {
        title: 'Plantwide Metrics by Hour',
        width:  this.chartWidth || 600,
        height: this.chartHeight || 400,
        orientation: 'vertical',
        xType: 'category',
        xLabel: 'Hour',
        yLabel: 'Value',
        margin: {
          top:    Math.max(this.marginTop ?? 50, (this.legendPosition === 'top' ? 80 : 60)),
          right:  Math.max(this.marginRight ?? 30, (this.legendPosition === 'right' ? 120 : 30)),
          bottom: Math.max(this.marginBottom ?? 56, 92), // space for rotated ticks + label
          left:   this.marginLeft ?? 50
        },
        legend: {
          show: this.showLegend !== false,
          position: this.legendPosition || 'top'
        },
        series
      };

      this.isLoading = false;          // set to false unconditionally
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;
      
      this.cdr.markForCheck();        // <— critical
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.cdr.markForCheck();          // <— ensure overlay shows/hides
  }

  // utils
  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
