// charts/plantwide-metrics-chart/plantwide-metrics-chart.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MultipleBarAndLineChartComponent } from '../../components/multiple-bar-and-line-chart/multiple-bar-and-line-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

type MetricsRow = {
  hour: number;
  availability: number;
  efficiency: number;
  throughput: number;
  oee: number;
};

@Component({
  selector: 'app-plantwide-metrics-chart',
  standalone: true,
  imports: [CommonModule, MultipleBarAndLineChartComponent],
  templateUrl: './plantwide-metrics-chart.component.html',
  styleUrls: ['./plantwide-metrics-chart.component.scss']
})
export class PlantwideMetricsChartComponent implements OnInit, OnDestroy {
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;

  chartInputData: any = null;

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
    this.chartInputData = null;
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
      // Handle the API response structure with plantwideMetrics array
      let rows: MetricsRow[] = [];
      
      if (res && res.plantwideMetrics && Array.isArray(res.plantwideMetrics)) {
        rows = res.plantwideMetrics;
      } else if (Array.isArray(res)) {
        rows = res;
      }

      // Ensure hours are sorted ascending and contiguous inputs handled
      rows.sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0));

      const hours = rows.map(r => Number(r.hour ?? 0));
      const series = {
        Availability: rows.map(r => Number(r.availability ?? 0)),
        Efficiency:   rows.map(r => Number(r.efficiency   ?? 0)),
        Throughput:   rows.map(r => Number(r.throughput   ?? 0)),
        OEE:          rows.map(r => Number(r.oee          ?? 0)),
      };

      this.chartInputData = {
        title: 'Plantwide Metrics by Hour',
        data: { hours, series }
      };

      this.hasInitialData = hours.length > 0;
      this.isLoading = false;
      this.dummyMode = false;
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartInputData = null;
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
