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
import { Subject, tap, takeUntil } from "rxjs";

import { BaseTableComponent } from "../components/base-table/base-table.component";
import { DateTimePickerComponent } from "../components/date-time-picker/date-time-picker.component";
import { MachineAnalyticsService } from "../services/machine-analytics.service";
import { PollingService } from "../services/polling-service.service";
import { DateTimeService } from "../services/date-time.service";
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
    BaseTableComponent,
    DateTimePickerComponent,
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

  chartWidth: number = 1000;
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
    private analyticsService: MachineAnalyticsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private dialog: MatDialog,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService
  ) {}

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    this.updateChartDimensions();
    window.addEventListener("resize", this.updateChartDimensions.bind(this));

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
      this.pollingSubscription = this.pollingService
        .poll(
          () => {
            this.endTime = this.pollingService.updateEndTimestampToNow();

            return this.analyticsService
              .getMachineSummary(this.startTime, this.endTime)
              .pipe(
                tap((data: any) => {
                  const responses = Array.isArray(data) ? data : [data];
                  this.machineData = responses;

                  const formattedData = responses.map((response) => ({
                    Status: getStatusDotByCode(response.currentStatus?.code),
                    "Machine Name": response.machine.name,
                    "Serial Number": response.machine.serial,
                    Runtime: `${response.metrics.runtime.formatted.hours}h ${response.metrics.runtime.formatted.minutes}m`,
                    Downtime: `${response.metrics.downtime.formatted.hours}h ${response.metrics.downtime.formatted.minutes}m`,
                    "Total Count": response.metrics.output.totalCount,
                    "Misfeed Count": response.metrics.output.misfeedCount,
                    Availability: `${response.metrics.performance.availability.percentage}%`,
                    Throughput: `${response.metrics.performance.throughput.percentage}%`,
                    Efficiency: `${response.metrics.performance.efficiency.percentage}%`,
                    OEE: `${response.metrics.performance.oee.percentage}%`,
                  }));

                  this.columns = Object.keys(formattedData[0]);
                  this.rows = formattedData;
                })
              );
          },
          this.POLLING_INTERVAL,
          this.destroy$,
          false,
          false
        )
        .subscribe();
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
    if (!this.startTime || !this.endTime) return;
    this.isLoading = true;
    this.analyticsService
      .getMachineSummary(this.startTime, this.endTime)
      .subscribe({
        next: (data: any) => {
          const responses = Array.isArray(data) ? data : [data];

          // Guard: if responses is not an array or is empty, set rows to [] and return
          if (!Array.isArray(responses) || responses.length === 0) {
            this.rows = [];
            this.isLoading = false;
            return;
          }

          // Filter out undefined/null/invalid responses
          const validResponses = responses.filter(
            (response) =>
              response &&
              response.metrics &&
              response.machine &&
              response.currentStatus
          );
          if (validResponses.length === 0) {
            this.rows = [];
            this.isLoading = false;
            return;
          }

          const formattedData = validResponses.map((response) => ({
            Status: getStatusDotByCode(response.currentStatus?.code),
            "Machine Name": response.machine?.name ?? "Unknown",
            "Serial Number": response.machine?.serial,
            Runtime: `${response.metrics?.runtime?.formatted?.hours ?? 0}h ${
              response.metrics?.runtime?.formatted?.minutes ?? 0
            }m`,
            Downtime: `${response.metrics?.downtime?.formatted?.hours ?? 0}h ${
              response.metrics?.downtime?.formatted?.minutes ?? 0
            }m`,
            "Total Count": response.metrics?.output?.totalCount ?? 0,
            "Misfeed Count": response.metrics?.output?.misfeedCount ?? 0,
            Availability:
              (response.metrics?.performance?.availability?.percentage ?? "0") +
              "%",
            Throughput:
              (response.metrics?.performance?.throughput?.percentage ?? "0") +
              "%",
            Efficiency:
              (response.metrics?.performance?.efficiency?.percentage ?? "0") +
              "%",
            OEE: (response.metrics?.performance?.oee?.percentage ?? "0") + "%",
          }));

          const allColumns = Object.keys(formattedData[0]);
          const columnsToHide: string[] = [""];
          this.columns = allColumns.filter(
            (col) => !columnsToHide.includes(col)
          );

          this.rows = formattedData;
          this.isLoading = false;
        },
        error: (err) => {
          console.error("Error fetching dashboard data:", err);
          this.rows = [];
          this.isLoading = false;
        },
      });
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
    this.analyticsService
      .getMachineDetails(this.startTime, this.endTime, machineSerial)
      .subscribe({
        next: (res: any[]) => {
          const machineData = res[0]; // <-- FIX HERE
          console.log("Machine data:", machineData);

          const itemSummaryData = Object.values(
            machineData.itemSummary?.machineSummary?.itemSummaries || {}
          );
          console.log("Item summary data:", itemSummaryData);

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
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: "dashboard",
                preloadedData: machineData.itemHourlyStack,
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
                preloadedData: faultSummaryData,
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
                preloadedData: faultCycleData,
              },
            },
            {
              label: "Performance Chart",
              component: OperatorPerformanceChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
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
        },
        error: (err) => {
          console.error(
            `Error loading detailed modal data for machine ${machineSerial}:`,
            err
          );
        },
      });
  }

  getEfficiencyClass(value: any): string {
    if (typeof value !== "string" || !value.includes("%")) return "";
    const num = parseInt(value.replace("%", ""));
    if (isNaN(num)) return "";
    if (num >= 90) return "green";
    if (num >= 70) return "yellow";
    return "red";
  }

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
