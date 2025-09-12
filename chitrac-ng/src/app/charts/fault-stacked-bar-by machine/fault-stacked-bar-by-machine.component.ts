import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

@Component({
    selector: 'app-fault-stacked-bar-by-machine',
    standalone: true,
    imports: [CommonModule, CartesianChartComponent],
    templateUrl: './fault-stacked-bar-by-machine.component.html',
    styleUrls: ['./fault-stacked-bar-by-machine.component.scss']
})
export class FaultStackedBarByMachineComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;
  @Input() externalChartConfig: any = null; // For receiving external chart data

  // derived state
  chartConfig: CartesianChartConfig | null = null;
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
    // Check if we have external chart data first
    if (this.externalChartConfig) {
      this.processExternalChartData();
      return;
    }

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

    // Always fetch data on init
    this.fetchOnce().subscribe();

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
    // Handle external chart config changes
    if (changes['externalChartConfig'] && this.externalChartConfig) {
      this.processExternalChartData();
      return;
    }
    
    // Handle input changes for self-fetching mode
    if ((changes['startDate'] || changes['endDate']) && this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
      this.fetchOnce().subscribe();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPollingInternal();
  }

  // ---------- core flow ----------
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
    this.chartConfig = null;
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPollingInternal();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getMachineItemSessionsSummary(this.startTime, this.endTime)
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
    return this.dailyDashboardService.getMachineItemSessionsSummary(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      console.log('Full API Response:', res); // Debug logging
      
      // Handle the nested response structure and transform to CartesianChartConfig format
      if (res && res.charts && res.charts.faultsStacked) {
        const faultData = res.charts.faultsStacked;
        console.log('Fault Stacked Bar Data:', faultData); // Debug logging
        console.log('Number of fault series:', faultData.series?.length || 0);
        
        // Check if we have valid series data
        if (!faultData.series || faultData.series.length === 0) {
          console.warn('No fault series data found');
          this.enterDummy();
          return;
        }
        
        // Limit to 10 series to prevent rendering issues
        const limitedSeries = faultData.series.slice(0, 10);
        if (faultData.series.length > 10) {
          console.warn(`Too many fault series (${faultData.series.length}), limiting to 10`);
        }
        
        // Transform the API response to match CartesianChartConfig interface
        const transformedConfig: CartesianChartConfig = {
          title: faultData.title || 'Fault Stacked Bar by Machine',
          width: this.chartWidth,
          height: this.chartHeight,
          orientation: faultData.orientation || 'vertical',
          xType: faultData.xType || 'category',
          xLabel: faultData.xLabel || 'Machine',
          yLabel: faultData.yLabel || 'Fault Duration (hours)',
          legend: {
            show: true,
            position: 'right'
          },
          series: limitedSeries || []
        };
        
        console.log('Transformed Chart Config:', transformedConfig);
        this.chartConfig = transformedConfig;
        this.hasInitialData = true;
        this.isLoading = false;
        this.dummyMode = false;
      } else {
        console.warn('No fault chart data in response:', res);
        this.enterDummy();
      }
    };

  private processExternalChartData(): void {
    if (!this.externalChartConfig) {
      this.enterDummy();
      return;
    }

    console.log('Processing external chart data:', this.externalChartConfig);
    
    // Transform the external chart data to match our internal format
    const transformedConfig: CartesianChartConfig = {
      title: this.externalChartConfig.title || 'Fault Stacked Bar by Machine',
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: this.externalChartConfig.orientation || 'vertical',
      xType: this.externalChartConfig.xType || 'category',
      xLabel: this.externalChartConfig.xLabel || 'Machine',
      yLabel: this.externalChartConfig.yLabel || 'Fault Duration (hours)',
      legend: {
        show: true,
        position: 'right'
      },
      series: this.externalChartConfig.series || []
    };
    
    console.log('Transformed external chart config:', transformedConfig);
    this.chartConfig = transformedConfig;
    this.hasInitialData = true;
    this.isLoading = false;
    this.dummyMode = false;
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
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
    if (this.chartConfig) {
      this.chartConfig.width = w;
      this.chartConfig.height = h;
    }
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
