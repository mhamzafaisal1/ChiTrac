import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StackedBarChartComponent, StackedBarChartData } from '../../components/stacked-bar-chart/stacked-bar-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

@Component({
    selector: 'app-daily-machine-item-stacked-bar-chart',
    standalone: true,
    imports: [CommonModule, StackedBarChartComponent],
    templateUrl: './daily-machine-item-stacked-bar-chart.component.html',
    styleUrls: ['./daily-machine-item-stacked-bar-chart.component.scss']
})
export class DailyMachineItemStackedBarChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;

  // derived state
  chartData: StackedBarChartData | null = null;
  isDarkTheme = false;
  isLoading = false;
  hasInitialData = false;
  dummyMode = true;

  // date/time + live
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

    // Use input values if provided, otherwise use defaults
    if (this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
    } else {
      // default [start,end] = [midnight, now]
      const now = new Date();
      const start = new Date(); start.setHours(0,0,0,0);
      this.startTime = this.formatDateForInput(start);
      this.endTime = this.formatDateForInput(now);
    }

    // initial dummy
    this.enterDummy();

    // Consolidated initial fetch logic - only one fetch call
    this.performInitialFetch(isLive, wasConfirmed);

    // liveMode wiring
    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((live: boolean) => {
        this.liveMode = live;
        if (live) this.startLive(); else this.stopLive();
      });

    // confirm wiring
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPollingInternal();
        this.enterDummy();
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Handle input changes
    if ((changes['startDate'] || changes['endDate']) && this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
      // Only update time variables, no API call here
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPollingInternal();
  }

  // ---------- core flow ----------
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
    const start = new Date(); start.setHours(0,0,0,0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.pollingService.updateEndTimestampToNow();

    // initial fetch + poll
    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPollingInternal();
    this.hasInitialData = false;
    this.chartData = null;
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPollingInternal();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getDailyItemHourlyProduction(this.startTime, this.endTime)
          .pipe(tap(this.consumeResponse('poll')));
      },
      this.POLLING_INTERVAL,
      this.destroy$,
      false,
      false
    ).subscribe({ error: () => this.stopPollingInternal() });
  }

  private stopPollingInternal(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
  }

  private fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return new Observable();
    this.isLoading = true;
    return this.dailyDashboardService.getDailyItemHourlyProduction(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      // Handle the nested response structure and transform to StackedBarChartData format
      if (res && res.itemHourlyStack && res.itemHourlyStack.data) {
        // Transform the API response to match StackedBarChartData interface
        const transformedData: StackedBarChartData = {
          title: res.itemHourlyStack.title || 'Daily Machine Item Hourly Production',
          data: {
            hours: res.itemHourlyStack.data.hours || [],
            operators: res.itemHourlyStack.data.operators || {},
            machineNames: res.itemHourlyStack.data.machineNames || []
          }
        };
        
        this.chartData = transformedData;
        this.hasInitialData = true;
        this.isLoading = false;
        this.dummyMode = false;
      } else {
        this.enterDummy();
      }
    };

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartData = null;
  }

  // ---------- grid interface methods ----------
  startPolling(): void {
    this.startLive();
  }

  stopPolling(): void {
    this.stopLive();
  }

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
  }

  // ---------- utils ----------
  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
