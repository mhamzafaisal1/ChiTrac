// charts/daily-count-bar-chart/daily-count-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BarChartComponent, BarChartDataPoint } from '../../components/bar-chart/bar-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

@Component({
  selector: 'app-daily-count-bar-chart',
  standalone: true,
  imports: [CommonModule, BarChartComponent],
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

  chartData: BarChartDataPoint[] = [];
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

  ngOnInit(): void {
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
    this.fetchOnce().subscribe();

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
      this.fetchOnce().subscribe();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0,0,0,0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.pollingService.updateEndTimestampToNow();

    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.chartData = [];
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPolling();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getDailyCountTotals(this.startTime, this.endTime)
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
    return this.dailyDashboardService.getDailyCountTotals(this.startTime, this.endTime)
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

      const normalized = rows.map((r: any, i: number) => ({
        hour: i,
        counts: r.count ?? r.counts ?? 0,
        label: r.date ?? r.label ?? ''
      }));

      this.chartData = normalized;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = normalized.length > 0;

      this.cdr.markForCheck();
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartData = [];
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
