import { Component, OnInit, OnDestroy, ElementRef, Renderer2, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subject, takeUntil, tap, delay, Observable } from 'rxjs';

import { BaseTableComponent } from '../components/base-table/base-table.component';
import { OperatorAnalyticsService } from '../services/operator-analytics.service';
import { getStatusDotByCode } from '../../utils/status-utils';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';

import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { UseCarouselComponent } from '../use-carousel/use-carousel.component';
import { OperatorItemSummaryTableComponent } from '../operator-item-summary-table/operator-item-summary-table.component';
import { OperatorCountbyitemChartComponent } from '../operator-countbyitem-chart/operator-countbyitem-chart.component';
import { OperatorCyclePieChartComponent } from '../operator-cycle-pie-chart/operator-cycle-pie-chart.component';
import { OperatorFaultHistoryComponent } from '../operator-fault-history/operator-fault-history.component';
import { OperatorLineChartComponent } from '../operator-line-chart/operator-line-chart.component';
import { OperatorMachineSummaryComponent } from '../operator-machine-summary/operator-machine-summary.component';

@Component({
    selector: 'app-operator-analytics-dashboard',
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        BaseTableComponent,
        MatTableModule,
        MatSortModule,
        MatButtonModule,
        MatIconModule,
        MatSlideToggleModule
    ],
    templateUrl: './operator-analytics-dashboard.component.html',
    styleUrl: './operator-analytics-dashboard.component.scss'
})
export class OperatorAnalyticsDashboardComponent implements OnInit, OnDestroy {
  isDarkTheme: boolean = false;
  private observer!: MutationObserver;
  startTime = '';
  endTime = '';
  operatorId?: number;
  columns: string[] = [];
  rows: any[] = [];
  selectedRow: any = null;
  operatorData: any[] = []; // Store the raw dashboard data
  liveMode: boolean = false;
  isLoading: boolean = false;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  // Chart dimensions
  chartHeight = 700;
  chartWidth = 1000;

  responsiveChartSizes: {
    [breakpoint: number]: { width: number; height: number };
  } = {
    1600: { width: 800, height: 700 },
    1210: { width: 700, height: 700 },
    1024: { width: 600, height: 600 },
    900: { width: 500, height: 500 },
    768: { width: 400, height: 400 },
    480: { width: 300, height: 300 },
    0: { width: 300, height: 350 }, // fallback for very small screens
  };

  constructor(
    private analyticsService: OperatorAnalyticsService,
    private dialog: MatDialog,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.updateChartDimensions();
    window.addEventListener("resize", this.updateChartDimensions.bind(this));

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    // Add dummy loading row initially
    this.addDummyLoadingRow();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchAnalyticsData();
    }

    const now = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.detectTheme();
    this.observer = new MutationObserver(() => {
      this.detectTheme();
    });
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Subscribe to live mode changes
    this.dateTimeService.liveMode$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isLive => {
      this.liveMode = isLive;
      if (isLive) {
        // Add dummy loading row when switching to live mode
        this.addDummyLoadingRow();
        // Reset startTime to today at 00:00
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        this.startTime = this.formatDateForInput(start);
        this.dateTimeService.setStartTime(this.startTime);

        // Reset endTime to now
        this.endTime = this.pollingService.updateEndTimestampToNow();
        this.dateTimeService.setEndTime(this.endTime);

        // Initial data fetch
        this.fetchAnalyticsData();
        this.setupPolling();
      } else {
        this.stopPolling();
        this.operatorData = [];
        this.rows = [];
        // Add dummy loading row when stopping live mode
        this.addDummyLoadingRow();
      }
    });

    // Subscribe to confirm trigger
    this.dateTimeService.confirmTrigger$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.liveMode = false; // turn off polling
      this.stopPolling();

      // Add dummy loading row when confirming date/time
      this.addDummyLoadingRow();

      // get times from the shared service
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();

      this.fetchAnalyticsData(); // use them to fetch data
    });
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
    window.removeEventListener("resize", this.updateChartDimensions.bind(this));
  }

  detectTheme(): void {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
  }

  private updateChartDimensions(): void {
    const width = window.innerWidth;

    const breakpoints = Object.keys(this.responsiveChartSizes)
      .map(Number)
      .sort((a, b) => b - a); // sort descending

    for (const bp of breakpoints) {
      if (width >= bp) {
        this.chartWidth = this.responsiveChartSizes[bp].width;
        this.chartHeight = this.responsiveChartSizes[bp].height;
        return;
      }
    }
  }

  private setupPolling(): void {
    if (this.liveMode) {
      // Setup polling for subsequent updates
      this.pollingSubscription = this.pollingService.poll(
        () => {
          this.endTime = this.pollingService.updateEndTimestampToNow();
          this.dateTimeService.setEndTime(this.endTime);
          
          // Check if we have a timeframe selected
          const timeframe = this.dateTimeService.getTimeframe();
          
          if (timeframe) {
            // Use timeframe-based API call
            return this.analyticsService.getOperatorSummaryWithTimeframe(timeframe)
              .pipe(
                tap((data: any) => {
                  this.updateDashboardData(data);
                }),
                delay(0) // Force change detection cycle
              );
          } else {
            // Use regular API call with start/end times
            return this.analyticsService.getOperatorSummary(this.startTime, this.endTime)
              .pipe(
                tap((data: any) => {
                  this.updateDashboardData(data);
                }),
                delay(0) // Force change detection cycle
              );
          }
        },
        this.POLLING_INTERVAL,
        this.destroy$,
        false,  // isModal
        false   // 👈 prevents immediate call
      ).subscribe();
      
    }
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
  }

  private updateDashboardData(data: any): void {
    this.operatorData = Array.isArray(data) ? data : [data];
    
    this.rows = this.operatorData.map(response => ({
      'Status': getStatusDotByCode(response.currentStatus?.code),
      'Operator Name': response.operator.name,
      'Operator ID': response.operator.id,
      'Current Machine': response.currentMachine?.name || '',
      'Current Machine Serial': response.currentMachine?.serial || '',
      'Runtime': `${response.metrics.runtime.formatted.hours}h ${response.metrics.runtime.formatted.minutes}m`,
      'Downtime': `${response.metrics.downtime.formatted.hours}h ${response.metrics.downtime.formatted.minutes}m`,
      'Total Count': response.metrics.output.totalCount,
      'Misfeed Count': response.metrics.output.misfeedCount,
      'Availability': `${response.metrics.performance.availability.percentage}%`,
      'Throughput': `${response.metrics.performance.throughput.percentage}%`,
      'Efficiency': `${`${response.metrics.performance.efficiency.percentage}%`}%`,
      'OEE': `${response.metrics.performance.oee.percentage}%`,
      'Time Range': `${this.startTime} to ${this.endTime}`
    }));

    const allColumns = Object.keys(this.rows[0]);
    const columnsToHide = ['Operator ID', 'Time Range'];
    this.columns = allColumns.filter(col => !columnsToHide.includes(col));
  }

  async fetchAnalyticsData(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    
    // Check if we have a timeframe selected
    const timeframe = this.dateTimeService.getTimeframe();
    
    if (timeframe) {
      // Use timeframe-based API call
      this.analyticsService.getOperatorSummaryWithTimeframe(timeframe)
        .subscribe({
          next: (data: any) => {
            this.updateDashboardData(data);
            this.isLoading = false;
          },
          error: (error) => {
            console.error('Error fetching analytics data:', error);
            this.rows = [];
            this.isLoading = false;
          }
        });
    } else {
      // Use operator-summary route for initial table data (all operators)
      this.analyticsService.getOperatorSummary(this.startTime, this.endTime)
        .subscribe({
          next: (data: any) => {
            this.updateDashboardData(data);
            this.isLoading = false;
          },
          error: (error) => {
            console.error('Error fetching analytics data:', error);
            this.rows = [];
            this.isLoading = false;
          }
        });
    }
  }

  onDateChange(): void {
    this.dateTimeService.setStartTime(this.startTime);
    this.dateTimeService.setEndTime(this.endTime);
    this.dateTimeService.setLiveMode(false);
    this.stopPolling();
    this.operatorData = [];
    this.rows = [];
  }

  /**
   * Calculate modal-aware chart dimensions
   * Modal is 90vw x 85vh, but we need to account for:
   * - Modal padding: 1.5rem (24px) each side = 48px total
   * - Modal content padding: 2rem (32px) each side = 64px total
   * - Carousel padding: 12px each side = 24px total
   * - Chart legend space: 200px on the right
   * Total horizontal overhead: ~336px (136px padding + 200px legend)
   */
  private getModalAwareChartDimensions(): { width: number; height: number } {
    const modalWidth = window.innerWidth * 0.9; // 90vw
    const modalHeight = window.innerHeight * 0.85; // 85vh

    // Account for all padding and margins
    const horizontalPadding = 136; // 48 + 64 + 24 (modal + content + carousel padding)
    const verticalPadding = 150; // Modal actions, tab headers, and spacing

    // Available space for chart (before adding legend space)
    const availableWidth = modalWidth - horizontalPadding - 200; // Remove legend width
    const availableHeight = modalHeight - verticalPadding;

    // Use the responsive breakpoints but cap at available space
    const width = window.innerWidth;
    let chartWidth = 800;
    let chartHeight = 700;

    if (width >= 1600) {
      chartWidth = 800;
      chartHeight = 700;
    } else if (width >= 1210) {
      chartWidth = 700;
      chartHeight = 700;
    } else if (width >= 1024) {
      chartWidth = 600;
      chartHeight = 600;
    } else if (width >= 900) {
      chartWidth = 500;
      chartHeight = 500;
    } else if (width >= 768) {
      chartWidth = 400;
      chartHeight = 400;
    } else if (width >= 480) {
      chartWidth = 300;
      chartHeight = 300;
    } else {
      chartWidth = 300;
      chartHeight = 350;
    }

    // Cap dimensions to available space
    chartWidth = Math.min(chartWidth, availableWidth);
    chartHeight = Math.min(chartHeight, availableHeight);

    return { width: chartWidth, height: chartHeight };
  }

  onRowSelected(row: any): void {
    if (this.selectedRow === row) {
      this.selectedRow = null;
      return;
    }

    this.selectedRow = row;

    setTimeout(() => {
      const element = document.querySelector('.mat-row.selected');
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);

    const operatorId = row['Operator ID'];
    // Use the actual dashboard time range
    const startTimeStr = this.startTime;
    const endTimeStr = this.endTime;

    // Get modal-aware dimensions
    const modalChartDimensions = this.getModalAwareChartDimensions();

    // Check if we have a timeframe selected
    const timeframe = this.dateTimeService.getTimeframe();

    // Fetch detailed operator data for the modal
    const summaryObservable = timeframe
      ? this.analyticsService.getOperatorSummaryWithTimeframe(timeframe)
      : this.analyticsService.getOperatorSummary(this.startTime, this.endTime);

    summaryObservable.subscribe({
      next: (summaryData) => {
        const base = Array.isArray(summaryData) ? summaryData.find(d => d.operator.id === operatorId) : summaryData;
  
        this.analyticsService.getOperatorInfo(this.startTime, this.endTime, operatorId)
          .subscribe({
            next: (infoData) => {
              const data = { ...base, ...infoData }; // Merge both
  
              const carouselTabs = [
                {
                  label: 'Item Summary',
                  component: OperatorItemSummaryTableComponent,
                  componentInputs: {
                    mode: 'dashboard',
                    dashboardData: [data],
                    operatorId,
                    isModal: true
                  }
                },
                {
                  label: 'Item Stacked Chart',
                  component: OperatorCountbyitemChartComponent,
                  componentInputs: {
                    mode: 'dashboard',
                    dashboardData: [data],
                    operatorId,
                    isModal: true,
                    chartHeight: modalChartDimensions.height,
                    chartWidth: modalChartDimensions.width + 200,  // Add extra width for right-side legend
                    marginTop: 30,
                    marginRight: 180,  // Increase right margin to accommodate legend
                    marginBottom: 60,
                    marginLeft: 25,
                    showLegend: true,
                    legendPosition: 'right',
                    legendWidthPx: 120
                  }
                },
                {
                  label: 'Running/Paused/Fault Pie Chart',
                  component: OperatorCyclePieChartComponent,
                  componentInputs: {
                    mode: 'dashboard',
                    dashboardData: [data],
                    operatorId,
                    isModal: true,
                    chartHeight: modalChartDimensions.height,
                    chartWidth: modalChartDimensions.width + 200,  // Add extra width for right-side legend
                    marginTop: 30,
                    marginRight: 180,  // Increase right margin to accommodate legend
                    marginBottom: 60,
                    marginLeft: 25,
                    showLegend: true,
                    legendPosition: 'right',
                    legendWidthPx: 120
                  }
                },
                {
                  label: 'Fault History',
                  component: OperatorFaultHistoryComponent,
                  componentInputs: {
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                    operatorId: operatorId.toString(),
                    isModal: true
                  }
                },
                {
                  label: 'Daily Efficiency Chart',
                  component: OperatorLineChartComponent,
                  componentInputs: {
                    mode: 'dashboard',
                    dashboardData: [data],
                    operatorId: operatorId.toString(),
                    isModal: true,
                    chartHeight: modalChartDimensions.height,
                    chartWidth: modalChartDimensions.width + 200,  // Add extra width for right-side legend
                    marginTop: 30,
                    marginRight: 180,  // Increase right margin to accommodate legend
                    marginBottom: 60,
                    marginLeft: 25,
                    showLegend: true,
                    legendPosition: 'right',
                    legendWidthPx: 120
                  }
                },
                {
                  label: 'Machine Summary',
                  component: OperatorMachineSummaryComponent,
                  componentInputs: {
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                    operatorId: operatorId.toString(),
                    isModal: true
                  }
                }
              ];
  
              this.dialog.open(ModalWrapperComponent, {
                width: '90vw',
                height: '85vh',
                maxWidth: '95vw',
                maxHeight: '90vh',
                panelClass: 'performance-chart-dialog',
                data: {
                  component: UseCarouselComponent,
                  componentInputs: {
                    tabData: carouselTabs
                  }
                }
              });
            }
          });
      }
    });
  
  }

  getEfficiencyClass(value: any, column: string): string {
    if ((column === 'Efficiency' || column === 'OEE' || column === 'Availability' || column === 'Throughput') && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''));
      if (isNaN(num)) return '';
      if (num >= 90) return 'green';
      if (num >= 70) return 'yellow';
      return 'red';
    }
    return '';
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private addDummyLoadingRow(): void {
    // Add a dummy row with loading state
    this.rows = [
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Operator ID': '',
        'Current Machine': '',
        'Current Machine Serial': '',
        'Runtime': '',
        'Downtime': '',
        'Total Count': '',
        'Misfeed Count': '',
        'Availability': '',
        'Throughput': '',
        'Efficiency': '',
        'OEE': '',
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Operator ID': '',
        'Current Machine': '',
        'Current Machine Serial': '',
        'Runtime': '',
        'Downtime': '',
        'Total Count': '',
        'Misfeed Count': '',
        'Availability': '',
        'Throughput': '',
        'Efficiency': '',
        'OEE': '',
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Operator ID': '',
        'Current Machine': '',
        'Current Machine Serial': '',
        'Runtime': '',
        'Downtime': '',
        'Total Count': '',
        'Misfeed Count': '',
        'Availability': '',
        'Throughput': '',
        'Efficiency': '',
        'OEE': '',
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Operator ID': '',
        'Current Machine': '',
        'Current Machine Serial': '',
        'Runtime': '',
        'Downtime': '',
        'Total Count': '',
        'Misfeed Count': '',
        'Availability': '',
        'Throughput': '',
        'Efficiency': '',
        'OEE': '',
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Operator ID': '',
        'Current Machine': '',
        'Current Machine Serial': '',
        'Runtime': '',
        'Downtime': '',
        'Total Count': '',
        'Misfeed Count': '',
        'Availability': '',
        'Throughput': '',
        'Efficiency': '',
        'OEE': '',
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
    ];

    // Set columns if not already set
    if (this.columns.length === 0) {
      this.columns = [
        'Status',
        'Operator Name',
        'Operator ID',
        'Current Machine',
        'Current Machine Serial',
        'Runtime',
        'Downtime',
        'Total Count',
        'Misfeed Count',
        'Availability',
        'Throughput',
        'Efficiency',
        'OEE',
      ];
    }
  }
}
