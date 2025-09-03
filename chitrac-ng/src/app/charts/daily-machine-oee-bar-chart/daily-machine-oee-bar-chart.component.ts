// charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BarChartComponent, BarChartDataPoint } from '../../components/bar-chart/bar-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

@Component({
  selector: 'app-daily-machine-oee-bar-chart',
  standalone: true,
  imports: [CommonModule, BarChartComponent],
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

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
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
        this.endTime = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  // ---- flow ----
  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0, 0, 0, 0);
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
        return this.dailyDashboardService.getDailyMachineOee(this.startTime, this.endTime)
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
    this.cdr.markForCheck();          // <— optional but safe
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

      this.chartData = normalized.map((m, i) => ({
        hour: i,
        counts: m.oee,
        label: m.name
      }));

      this.isLoading = false;          // set to false unconditionally
      this.dummyMode = false;
      this.hasInitialData = this.chartData.length > 0;
      
      this.cdr.markForCheck();        // <— critical
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartData = [];
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
