// charts/plantwide-metrics-chart/plantwide-metrics-chart.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../../charts/cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';


@Component({
  selector: 'app-plantwide-metrics-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './plantwide-metrics-chart.component.html',
  styleUrls: ['./plantwide-metrics-chart.component.scss']
})
export class PlantwideMetricsChartComponent implements OnInit, OnDestroy {
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
        return this.dailyDashboardService.getDailyPlantwideMetrics(this.startTime, this.endTime)
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
      type Row = { hour:number; availability:number; efficiency:number; throughput:number; oee:number };
      let rows: Row[] = Array.isArray(res?.plantwideMetrics) ? res.plantwideMetrics : (Array.isArray(res) ? res : []);
      rows.sort((a,b)=>(a.hour??0)-(b.hour??0));

      const hours = rows.map(r => Number(r.hour ?? 0));
      const fmt = (h:number) => h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
      const labels = hours.map(fmt);

      const series: XYSeries[] = [
        {
          id:'availability', title:'Availability', type:'bar', color:'#66bb6a',
          data: rows.map((r,i)=>({ x: labels[i], y: Number(r.availability ?? 0) })),
          options:{ barPadding:0.2 }
        },
        {
          id:'efficiency', title:'Efficiency', type:'bar', color:'#ffca28',
          data: rows.map((r,i)=>({ x: labels[i], y: Number(r.efficiency ?? 0) }))
        },
        {
          id:'throughput', title:'Throughput', type:'bar', color:'#ef5350',
          data: rows.map((r,i)=>({ x: labels[i], y: Number(r.throughput ?? 0) }))
        },
        {
          id:'oee', title:'OEE', type:'line', color:'#ab47bc',
          data: rows.map((r,i)=>({ x: labels[i], y: Number(r.oee ?? 0) })),
          options:{ showDots:true, radius:3 }
        }
      ];

      this.chartConfig = {
        title: 'Plantwide Metrics by Hour',
        width:  this.chartWidth,
        height: this.chartHeight,
        orientation: 'vertical',
        xType: 'category',
        xLabel: 'Hour',
        yLabel: 'Value',
        margin: {
          top:    Math.max(this.marginTop ?? 50, 60),
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

      this.hasInitialData = rows.length > 0;
      this.isLoading = false;
      this.dummyMode = false;
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
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
