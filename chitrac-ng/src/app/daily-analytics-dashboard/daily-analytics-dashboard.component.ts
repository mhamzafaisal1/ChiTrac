import { Component, OnInit, Renderer2, ElementRef, Input, OnDestroy, ChangeDetectorRef } from "@angular/core";
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from "@angular/common";
import { DailyDashboardService } from "../services/daily-dashboard.service";
import { ChartTileComponent } from "../components/chart-tile/chart-tile.component";
import { PollingService } from "../services/polling-service.service";
import { DateTimeService } from "../services/date-time.service";
import { Subject, Observable } from "rxjs";
import { takeUntil, tap, delay } from "rxjs/operators";
import { FormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { DailyMachineStackedBarChartComponent } from "../daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { DailyMachineItemStackedBarChartComponent } from "../daily-machine-item-stacked-bar-chart/daily-machine-item-stacked-bar-chart.component";
import { DailyCountBarChartComponent } from "../daily-count-bar-chart/daily-count-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { PlantwideMetricsChartComponent } from "../plantwide-metrics-chart/plantwide-metrics-chart.component";

// Required for dynamic input support
import { ComponentOutletInjectorModule, DynamicIoDirective } from 'ng-dynamic-component';
import { MatButtonModule } from '@angular/material/button';
@Component({
    selector: 'app-daily-analytics-dashboard',
    imports: [
        CommonModule,
        ChartTileComponent,
        ComponentOutletInjectorModule,
        DynamicIoDirective,
        MatIconModule,
        MatButtonModule,
        FormsModule,
        MatSlideToggleModule
    ],
    templateUrl: './daily-analytics-dashboard.component.html',
    styleUrls: ['./daily-analytics-dashboard.component.scss']
})
export class DailyAnalyticsDashboardComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  isDarkTheme: boolean = false;
  liveMode: boolean = false;
  isLoading: boolean = false;
  private pollingSubscription: any;

  fullDashboardData: any = null;
  hasInitialData: boolean = false;
  dummyCharts: any[] = []; // Store dummy chart data

  chartWidth: number = 600;
  chartHeight: number = 450;

  chartComponents = [
    {
      component: DailyMachineStackedBarChartComponent,
      title: 'Machine Run/Pause/Fault Time',
      icon: 'bar_chart',
      dataKey: 'machineStatus'
    },
    {
      component: DailyMachineOeeBarChartComponent,
      title: 'Machine OEE',
      icon: 'insights',
      dataKey: 'machineOee'
    },
    {
      component: DailyMachineItemStackedBarChartComponent,
      title: 'Machine Item Stacked Bar',
      icon: 'stacked_bar_chart',
      dataKey: 'itemHourlyStack'
    },
    {
      component: DailyCountBarChartComponent,
      title: 'Daily Plantwide Count Totals',
      icon: 'calendar_view_day',
      dataKey: 'dailyCounts'
    },
    {
      component: RankedOperatorBarChartComponent,
      title: 'Top Operator Efficiency',
      icon: 'leaderboard',
      dataKey: 'topOperators'
    },
    {
      component: PlantwideMetricsChartComponent,
      title: 'Plantwide Metrics by Hour',
      icon: 'trending_up',
      dataKey: 'plantwideMetrics',
      // chartWidth and chartHeight will be passed via ndcDynamicInputs in the template
    }
    // Future charts:
    // { component: ..., title: ..., icon: ..., dataKey: ... }
  ];

  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  constructor(
    private dashboardService: DailyDashboardService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Calculate responsive chart dimensions
    this.calculateChartDimensions();

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    // Add dummy loading charts initially
    this.addDummyLoadingCharts();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchDashboardData().subscribe();
    }
    
    const now = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);
    this.detectTheme();

    // Subscribe to live mode changes
    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isLive: boolean) => {
        this.liveMode = isLive;

        if (this.liveMode) {
          // Add dummy loading charts when switching to live mode
          this.addDummyLoadingCharts();
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          this.startTime = this.formatDateForInput(start);
          this.endTime = this.pollingService.updateEndTimestampToNow();

          this.fetchDashboardData().subscribe();
          this.setupPolling();
        } else {
          this.stopPolling();
          this.hasInitialData = false;
          this.fullDashboardData = null;
          // Add dummy loading charts when stopping live mode
          this.addDummyLoadingCharts();
        }
      });

    // Subscribe to confirm action
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPolling();

        // Add dummy loading charts when confirming date/time
        this.addDummyLoadingCharts();

        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();

        this.fetchDashboardData().subscribe();
      });

    // Listen for window resize to recalculate chart dimensions
    window.addEventListener('resize', () => {
      this.calculateChartDimensions();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  private setupPolling(): void {
    if (this.liveMode) {
      // Setup polling for subsequent updates
      this.pollingSubscription = this.pollingService.poll(
        () => {
          this.endTime = this.pollingService.updateEndTimestampToNow();
          return this.dashboardService.getFullDailyDashboard(this.startTime, this.endTime)
            .pipe(
              tap({
                next: (data) => {
                  this.fullDashboardData = data;
                  this.hasInitialData = true;
                  this.isLoading = false;
                },
                error: (error) => {
                  console.error('Polling error:', error);
                  this.fullDashboardData = null;
                  this.hasInitialData = false;
                  this.isLoading = false;
                }
              })
            );
        },
        this.POLLING_INTERVAL,
        this.destroy$,
        false, // isModal
        false  // 👈 don't run immediately
      ).subscribe({
        next: (data) => {
          // Data is handled in the tap operator above
        },
        error: (error) => {
          console.error('Polling subscription error:', error);
          this.stopPolling();
        }
      });
    }
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
  }

  onDateChange(): void {
    if (this.liveMode) {
      this.liveMode = false;
      this.stopPolling();
    }
  
    // Clear previously loaded data so charts disappear until "Fetch Data" is clicked
    this.hasInitialData = false;
    this.fullDashboardData = null;
  }
  

  fetchDashboardData(): Observable<any> {
    if (!this.startTime || !this.endTime) {
      return new Observable();
    }
  
    this.isLoading = true;
  
    return this.dashboardService.getFullDailyDashboard(this.startTime, this.endTime)
      .pipe(
        takeUntil(this.destroy$),
        tap({
          next: (data) => {
            this.fullDashboardData = data;
            this.hasInitialData = true;
            this.isLoading = false;
          },
          error: () => {
            this.fullDashboardData = null;
            this.hasInitialData = false;
            this.isLoading = false;
          }
        }),
        delay(0) // Force change detection cycle
      );
  }
  

  detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
    const el = this.elRef.nativeElement;
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private calculateChartDimensions(): void {
    // Get the dashboard container element
    const dashboardElement = this.elRef.nativeElement.querySelector('.dashboard-wrapper');
    if (!dashboardElement) return;

    const containerRect = dashboardElement.getBoundingClientRect();
    
    // Calculate tile dimensions based on grid layout
    let tilesPerRow = 3; // Default for large screens
    
    if (window.innerWidth <= 768) {
      tilesPerRow = 1;
    } else if (window.innerWidth <= 1200) {
      tilesPerRow = 2;
    }

    // Calculate tile width and height
    const tileWidth = containerRect.width / tilesPerRow;
    const tileHeight = containerRect.height / 2; // 2 rows in the grid

    // Set chart dimensions with some padding
    this.chartWidth = Math.floor(tileWidth * 0.95); // 95% of tile width
    this.chartHeight = Math.floor(tileHeight * 0.95); // 95% of tile height
  }

  private addDummyLoadingCharts(): void {
    // Create dummy chart data for loading state
    this.dummyCharts = this.chartComponents.map(chart => ({
      ...chart,
      isDummy: true,
      cssClass: "dummy-chart"
    }));
  }
}