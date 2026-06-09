import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  Renderer2,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog } from "@angular/material/dialog";
import { Subject, takeUntil } from "rxjs";

import { BaseTableComponent } from "../components/base-table/base-table.component";
import { MachineService } from "../services/machine.service";
import { PollingService } from "../services/polling-service.service";
import { DateTimeService } from "../services/date-time.service";
import { DashboardTimeframeService } from "../services/dashboard-timeframe.service";
import { PercentBreakpointService } from "../services/percent-breakpoint.service";
import { DashboardCacheScope, WebsocketService } from "../services/websocket.service";
import { getStatusDotByCode } from "../../utils/status-utils";
import { ModalWrapperComponent } from "../components/modal-wrapper-component/modal-wrapper-component.component";
import { UseCarouselComponent } from "../use-carousel/use-carousel.component";
import { MachineItemSummaryTableComponent } from "../machine-item-summary-table/machine-item-summary-table.component";
import { MachineCurrentOperatorsComponent } from "../machine-current-operators/machine-current-operators.component";
import { MachineItemStackedBarChartComponent } from "../machine-item-stacked-bar-chart/machine-item-stacked-bar-chart.component";
import { MachineFaultHistoryComponent } from "../machine-fault-history/machine-fault-history.component";
import { OperatorPerformanceChartComponent } from "../operator-performance-chart/operator-performance-chart.component";

@Component({
  selector: "app-machine-dashboard",
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    BaseTableComponent
  ],
  templateUrl: "./machine-dashboard.component.html",
  styleUrls: ["./machine-dashboard.component.scss"],
})
export class MachineDashboardComponent implements OnInit, OnDestroy {
  startTime: string = "";
  endTime: string = "";
  machineData: any[] = [];
  columns: string[] = [];
  rows: any[] = [];
  selectedRow: any | null = null;
  isDarkTheme: boolean = false;
  liveMode: boolean = false;
  isLoading: boolean = false;
  /** Full-screen loading overlay between row click and modal open (matches machine-report fetch UX). */
  isOpeningModal: boolean = false;
  responsiveHiddenColumns: { [key: number]: string[] } = {
    1210: ["Misfeed Count", "Serial Number"],
    1024: ["Misfeed Count"],
    768: [
      "Misfeed Count",
      "Serial Number",
      "Downtime",
      "Availability",
      "Throughput",
      "Efficiency",
    ],
    480: [
      "Misfeed Count",
      "Serial Number",
      "Downtime",
      "Throughput",
      "Efficiency",
    ],
  };

  private observer!: MutationObserver;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();

  chartWidth: number = 1200;
  chartHeight: number = 700;

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

  isModal: boolean = true;

  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  constructor(
    private machineService: MachineService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private dialog: MatDialog,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private percentBreakpointService: PercentBreakpointService,
    private websocketService: WebsocketService
  ) {}

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    this.updateChartDimensions();
    window.addEventListener("resize", this.updateChartDimensions.bind(this));

    // Add dummy loading row initially
    this.addDummyLoadingRow();
    this.websocketService.connect();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchAnalyticsData();
    } else {
      this.dashboardTimeframeService.applyDefault().subscribe((selection) => {
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        this.dateTimeService.setLiveMode(selection.mode === "current");
        if (selection.mode === "shift") {
          this.addDummyLoadingRow();
          this.fetchAnalyticsData();
        }
      });
    }

    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Subscribe to live mode changes
    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isLive: boolean) => {
        this.liveMode = isLive;

        if (this.liveMode) {
          // Add dummy loading row when switching to live mode
          this.addDummyLoadingRow();
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          this.startTime = this.formatDateForInput(start);
          this.endTime = this.pollingService.updateEndTimestampToNow();
          this.dateTimeService.setShiftId("");

          this.fetchAnalyticsData();
          this.setupPolling();
        } else {
          this.stopPolling();
          this.machineData = [];
          this.rows = [];
          // Add dummy loading row when stopping live mode
          this.addDummyLoadingRow();
        }
      });

    // Subscribe to confirm action
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
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
    if (this.observer) this.observer.disconnect();
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener("resize", this.updateChartDimensions.bind(this));
  }

  detectTheme(): void {
    const isDark = document.body.classList.contains("dark-theme");
    this.isDarkTheme = isDark;
  }

  private setupPolling(): void {
    if (this.liveMode) {
      this.subscribeToWebsocketDashboardData();
    }
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
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

  fetchAnalyticsData(): void {
    this.isLoading = true;
    this.subscribeToWebsocketDashboardData();
  }

  private subscribeToWebsocketDashboardData(): void {
    this.websocketService.connect();
    this.stopPolling();

    const scope = this.getDashboardCacheScope();
    const shiftId = this.dateTimeService.getShiftId();
    this.pollingSubscription = this.websocketService
      .machineDashboardData$(scope, shiftId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.updateDashboardData(data);
        this.isLoading = false;
      });
  }

  private getDashboardCacheScope(): DashboardCacheScope {
    return this.dateTimeService.getShiftId() ? "currentShift" : "today";
  }

  private updateDashboardData(data: any): void {
    const responses = Array.isArray(data) ? data : [data];
    const validResponses = responses.filter(
      (response) =>
        response &&
        (response.metrics || response.itemSummary || response.performance) &&
        response.machine &&
        response.currentStatus
    );

    this.machineData = validResponses;

    if (validResponses.length === 0) {
      this.rows = [];
      return;
    }

    const formattedData = validResponses.map((response) => {
      const totalCount = response.metrics?.output?.totalCount ??
        response.itemSummary?.machineSummary?.totalCount ?? 0;
      const misfeedCount = response.metrics?.output?.misfeedCount ??
        response.itemSummary?.machineSummary?.misfeedCount ?? 0;
      const runtime = response.metrics?.runtime ?? response.performance?.runtime;
      const downtime = response.metrics?.downtime ?? response.performance?.downtime;
      const performance = response.metrics?.performance ?? response.performance;

      return {
        Status: getStatusDotByCode(response.currentStatus?.code),
        "Machine Name": response.machine?.name ?? "Unknown",
        "Serial Number": response.machine?.serial,
        Runtime: `${runtime?.formatted?.hours ?? 0}h ${runtime?.formatted?.minutes ?? 0}m`,
        Downtime: `${downtime?.formatted?.hours ?? 0}h ${downtime?.formatted?.minutes ?? 0}m`,
        "Total Count": totalCount,
        "Misfeed Count": misfeedCount,
        Availability: `${performance?.availability?.percentage ?? "0"}%`,
        Throughput: `${performance?.throughput?.percentage ?? "0"}%`,
        Efficiency: `${performance?.efficiency?.percentage ?? "0"}%`,
        OEE: `${performance?.oee?.percentage ?? "0"}%`,
      };
    });

    this.columns = Object.keys(formattedData[0]).filter((col) => col !== "");
    this.rows = formattedData;
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
    // Slightly increase vertical padding to better account for
    // tab headers, modal actions, and any internal spacing so that
    // charts don't overflow and require scrolling.
    const verticalPadding = 200;

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

  onRowClick(row: any): void {
    if (this.selectedRow === row) {
      this.selectedRow = null;
      return;
    }

    this.selectedRow = row;
    setTimeout(() => {
      const element = document.querySelector(".mat-row.selected");
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);

    const machineSerial = row["Serial Number"];
    const timeframe = this.dateTimeService.getTimeframe();

    // Get modal-aware dimensions
    const modalChartDimensions = this.getModalAwareChartDimensions();

    this.isOpeningModal = true;

    if (timeframe) {
      // Use timeframe-based API call
      this.machineService
        .getMachineDetailsWithTimeframe(timeframe, machineSerial, this.dateTimeService.getShiftId())
        .subscribe({
        next: (res: any[]) => {
          try {
          const machineData = res[0]; // <-- FIX HERE

          const itemSummaryData = Object.values(
            machineData.itemSummary?.machineSummary?.itemSummaries || {}
          );

          const faultSummaryData = machineData.faultData?.faultSummaries || [];
          const faultCycleData = machineData.faultData?.faultCycles || [];

        
          const carouselTabs = [
            {
              label: "Item Summary",
              component: MachineItemSummaryTableComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                selectedMachineSerial: machineSerial,
                itemSummaryData,
                isModal: this.isModal,
              },
            },
            {
              label: "Current Operators",
              component: MachineCurrentOperatorsComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                selectedMachineSerial: machineSerial,
                currentOperatorsData: machineData.currentOperators || [],
                isModal: this.isModal,
              },
            },
            {
              label: "Item Stacked Chart",
              component: MachineItemStackedBarChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial,
                chartWidth: modalChartDimensions.width + 200, // Add extra width for right-side legend
                // Reduce height slightly inside the modal so the
                // chart area fits comfortably without vertical scroll.
                chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                isModal: this.isModal,
                mode: "dashboard",
                preloadedData: machineData.itemHourlyStack,
                marginTop: 30,
                marginRight: 180,  // Increase right margin to accommodate legend
                marginBottom: 60,
                marginLeft: 100,  // Keep larger left margin for item labels
                showLegend: true,
                legendPosition: "right",
                legendWidthPx: 120,
              },
            },
            {
              label: "Fault Summaries",
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: "summary",
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial,
                isModal: this.isModal,
              },
            },
            {
              label: "Fault History",
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: "cycles",
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial,
                isModal: this.isModal,
              },
            },
            {
              label: "Performance Chart",
              component: OperatorPerformanceChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial,
                chartWidth: modalChartDimensions.width + 200, // Add extra width for right-side legend
                // Reduce height slightly inside the modal so the
                // chart area fits comfortably without vertical scroll.
                chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                isModal: this.isModal,
                mode: "dashboard",
                preloadedData: {
                  machine: {
                    serial: machineSerial,
                    name: machineData.machine?.name ?? "Unknown",
                  },
                  timeRange: {
                    start: this.startTime,
                    end: this.endTime,
                  },
                  hourlyData: machineData.operatorEfficiency ?? [],
                },
                marginTop: 30,
                marginRight: 180, // Increase right margin to accommodate legend
                // Give X and Y axis labels a bit more breathing room
                // so they are not visually clipped inside the modal.
                marginBottom: 80,
                marginLeft: 40,
                showLegend: true,
                legendPosition: "right",
                legendWidthPx: 120,
              },
            },
          ];

          const dialogRef = this.dialog.open(ModalWrapperComponent, {
            width: "90vw",
            height: "85vh",
            maxWidth: "95vw",
            maxHeight: "90vh",
            panelClass: "performance-chart-dialog",
            data: {
              component: UseCarouselComponent,
              componentInputs: {
                tabData: carouselTabs,
              },
              machineSerial,
              startTime: this.startTime,
              endTime: this.endTime,
            },
          });

          dialogRef.afterClosed().subscribe(() => {
            if (this.selectedRow === row) this.selectedRow = null;
          });
          } finally {
            this.isOpeningModal = false;
          }
        },
        error: (err: unknown) => {
          console.error(
            `Error loading detailed modal data for machine ${machineSerial}:`,
            err
          );
          this.isOpeningModal = false;
        },
      });
    } else {
      // Fallback to date-based API call
      this.machineService
        .getMachineDetails(this.startTime, this.endTime, machineSerial, this.dateTimeService.getShiftId())
        .subscribe({
          next: (res: any[]) => {
            try {
            const machineData = res[0]; // <-- FIX HERE

            const itemSummaryData = Object.values(
              machineData.itemSummary?.machineSummary?.itemSummaries || {}
            );

            const faultSummaryData = machineData.faultData?.faultSummaries || [];
            const faultCycleData = machineData.faultData?.faultCycles || [];

            // console.log("machineData.currentOperators", machineData.currentOperators)
          
            const carouselTabs = [
              {
                label: "Item Summary",
                component: MachineItemSummaryTableComponent,
                componentInputs: {
                  startTime: this.startTime,
                  endTime: this.endTime,
                  selectedMachineSerial: machineSerial,
                  itemSummaryData,
                  isModal: this.isModal,
                },
              },
              {
                label: "Current Operators",
                component: MachineCurrentOperatorsComponent,
                componentInputs: {
                  startTime: this.startTime,
                  endTime: this.endTime,
                  selectedMachineSerial: machineSerial,
                  currentOperatorsData: machineData.currentOperators || [],
                  isModal: this.isModal,
                },
              },
              {
                label: "Item Stacked Chart",
                component: MachineItemStackedBarChartComponent,
                componentInputs: {
                  startTime: this.startTime,
                  endTime: this.endTime,
                  machineSerial,
                  chartWidth: modalChartDimensions.width + 200, // Add extra width for right-side legend
                  // Reduce height slightly inside the modal so the
                  // chart area fits comfortably without vertical scroll.
                  chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                  isModal: this.isModal,
                  mode: "dashboard",
                  preloadedData: machineData.itemHourlyStack,
                  marginTop: 30,
                  marginRight: 180,  // Increase right margin to accommodate legend
                  marginBottom: 60,
                  marginLeft: 100,  // Keep larger left margin for item labels
                  showLegend: true,
                  legendPosition: "right",
                  legendWidthPx: 120,
                },
              },
              {
                label: "Fault Summaries",
                component: MachineFaultHistoryComponent,
                componentInputs: {
                  viewType: "summary",
                  startTime: this.startTime,
                  endTime: this.endTime,
                  machineSerial,
                  isModal: this.isModal,
                },
              },
              {
                label: "Fault History",
                component: MachineFaultHistoryComponent,
                componentInputs: {
                  viewType: "cycles",
                  startTime: this.startTime,
                  endTime: this.endTime,
                  machineSerial,
                  isModal: this.isModal,
                },
              },
              {
                label: "Performance Chart",
                component: OperatorPerformanceChartComponent,
                componentInputs: {
                  startTime: this.startTime,
                  endTime: this.endTime,
                  machineSerial,
                  chartWidth: modalChartDimensions.width + 200, // Add extra width for right-side legend
                  // Reduce height slightly inside the modal so the
                  // chart area fits comfortably without vertical scroll.
                  chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                  isModal: this.isModal,
                  mode: "dashboard",
                  preloadedData: {
                    machine: {
                      serial: machineSerial,
                      name: machineData.machine?.name ?? "Unknown",
                    },
                    timeRange: {
                      start: this.startTime,
                      end: this.endTime,
                    },
                    hourlyData: machineData.operatorEfficiency ?? [],
                  },
                  marginTop: 30,
                  marginRight: 180, // Increase right margin to accommodate legend
                  // Give X and Y axis labels a bit more breathing room
                  // so they are not visually clipped inside the modal.
                  marginBottom: 80,
                  marginLeft: 40,
                  showLegend: true,
                  legendPosition: "right",
                  legendWidthPx: 120,
                },
              },
            ];

            const dialogRef = this.dialog.open(ModalWrapperComponent, {
              width: "90vw",
              height: "85vh",
              maxWidth: "95vw",
              maxHeight: "90vh",
              panelClass: "performance-chart-dialog",
              data: {
                component: UseCarouselComponent,
                componentInputs: {
                  tabData: carouselTabs,
                },
                machineSerial,
                startTime: this.startTime,
                endTime: this.endTime,
              },
            });

            dialogRef.afterClosed().subscribe(() => {
              if (this.selectedRow === row) this.selectedRow = null;
            });
            } finally {
              this.isOpeningModal = false;
            }
          },
          error: (err: unknown) => {
            console.error(
              `Error loading detailed modal data for machine ${machineSerial}:`,
              err
            );
            this.isOpeningModal = false;
          },
        });
    }
  }

  getEfficiencyClass = (value: any): string => {
    if (typeof value !== "string" || !value.includes("%")) return "";
    return this.percentBreakpointService.getColorClass(value);
  };

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private addDummyLoadingRow(): void {
    // Add a dummy row with loading state
    this.rows = [
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Total Count": "",
        "Misfeed Count": "",
        Availability: "",
        Throughput: "",
        Efficiency: "",
        OEE: "",
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Total Count": "",
        "Misfeed Count": "",
        Availability: "",
        Throughput: "",
        Efficiency: "",
        OEE: "",
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Total Count": "",
        "Misfeed Count": "",
        Availability: "",
        Throughput: "",
        Efficiency: "",
        OEE: "",
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Total Count": "",
        "Misfeed Count": "",
        Availability: "",
        Throughput: "",
        Efficiency: "",
        OEE: "",
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Total Count": "",
        "Misfeed Count": "",
        Availability: "",
        Throughput: "",
        Efficiency: "",
        OEE: "",
        isDummy: true, // Flag to identify this as a dummy row
        cssClass: "dummy-row", // CSS class for styling
      },
    ];

    // Set columns if not already set
    if (this.columns.length === 0) {
      this.columns = [
        "Status",
        "Machine Name",
        "Serial Number",
        "Runtime",
        "Downtime",
        "Total Count",
        "Misfeed Count",
        "Availability",
        "Throughput",
        "Efficiency",
        "OEE",
      ];
    }
  }
}
