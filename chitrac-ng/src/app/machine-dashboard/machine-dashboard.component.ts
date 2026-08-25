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
import { CdkDragDrop, DragDropModule, moveItemInArray } from "@angular/cdk/drag-drop";
import { catchError, debounceTime, distinctUntilChanged, forkJoin, Observable, of, Subject, switchMap, takeUntil, tap } from "rxjs";

import { BaseTableComponent } from "../components/base-table/base-table.component";
import { MachineService, ShiftProjectionWindow } from "../services/machine.service";
import { OperatorService } from "../services/operator.service";
import { PollingService } from "../services/polling-service.service";
import { DateTimeService } from "../services/date-time.service";
import { DashboardTimeframeService } from "../services/dashboard-timeframe.service";
import { PercentBreakpointService } from "../services/percent-breakpoint.service";
import { SettingsService } from "../services/settings.service";
import { LayoutEditService } from "../services/layout-edit.service";
import { DashboardCacheScope, DashboardCacheState, WebsocketConnectionStatus, WebsocketService } from "../services/websocket.service";
import { ShiftListItem, ShiftService } from "../services/shift.service";
import { UserService } from "../user.service";
import { getStatusDotByCode } from "../../utils/status-utils";
import {
  calculateMachineStatusCounts,
  calculateOperatorStatusCounts,
  EMPTY_OPERATOR_STATUS_COUNTS,
  OperatorStatusCounts,
} from "../../utils/dashboard-status-counts";
import { ModalWrapperComponent } from "../components/modal-wrapper-component/modal-wrapper-component.component";
import { UseCarouselComponent } from "../use-carousel/use-carousel.component";
import { MachineItemSummaryTableComponent } from "../machine-item-summary-table/machine-item-summary-table.component";
import { MachineCurrentOperatorsComponent } from "../machine-current-operators/machine-current-operators.component";
import { MachineItemStackedBarChartComponent } from "../machine-item-stacked-bar-chart/machine-item-stacked-bar-chart.component";
import { MachineFaultHistoryComponent } from "../machine-fault-history/machine-fault-history.component";
import { OperatorPerformanceChartComponent } from "../operator-performance-chart/operator-performance-chart.component";
import { LayoutSaveConfirmComponent } from "../components/layout-save-confirm/layout-save-confirm.component";
import {
  SummaryCardVisibilityDialogComponent,
  SummaryCardVisibilityOption,
} from "../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component";

interface SummaryCard {
  label: string;
  value: string | number;
  icon: string;
  tone: string;
  sparklineData?: SparklineDataPoint[];
  sparklineLinePoints?: string;
  sparklineAreaPath?: string;
  sparklineSegments?: SparklineSegment[];
}

type SparklineShiftState = "shift" | "break" | "outsideShift";

interface SparklineDataPoint {
  value: number;
  shiftState: SparklineShiftState;
}

interface SparklineRenderPoint extends SparklineDataPoint {
  x: number;
  y: number;
}

interface SparklineSegment {
  shiftState: SparklineShiftState;
  linePoints: string;
}

interface MachineDashboardLayoutSnapshot {
  summaryCardOrder: string[];
  tableColumnVisibility: Record<string, boolean>;
  summaryCardVisibility: Record<string, boolean>;
  summaryCardOrderSource: "server" | "local" | "default";
  summaryCardVisibilitySource: "server" | "local" | "default";
}

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
    DragDropModule,
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
  summaryCards: SummaryCard[] = [];
  allSummaryCards: SummaryCard[] = [];
  layoutEditing = false;
  columnTooltips: { [column: string]: string } = {
    Runtime: "Amount of time machine has been running",
    Downtime: "Amount of time machine has been paused, faulted, or offline.",
    "Paused Time": "Amount of time machine has been paused.",
    "Fault Time": "Amount of time machine has been faulted.",
    "Total Count": "Amount of pieces fed into the machine/line.",
    "Misfeed Count": "Amount of pieces misfed or rejected by the machine/line.",
    PPH: "Pieces Per Hour",
    Availability: "Percent of time machine was running.",
    Throughput: "Percent of pieces fed which were good quality (not misfed or rejected).",
    Efficiency: "Percent of goal pace being achieved.",
    OEE: "Overall Equipment Efficiency, combination of Availability, Efficiency, and Throughput",
  };
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
  readonly machineDashboardToggleableColumns = [
    "Serial Number",
    "Runtime",
    "Downtime",
    "Paused Time",
    "Fault Time",
    "Misfeed Count",
    "PPH",
    "Availability",
    "Throughput",
    "Efficiency",
  ];
  tableColumnVisibility: Record<string, boolean> = {};
  summaryCardVisibility: Record<string, boolean> = {};

  private observer!: MutationObserver;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private websocketStatus: WebsocketConnectionStatus = "disconnected";
  private readonly handleResize = this.updateChartDimensions.bind(this);
  private readonly summaryCardOrderKey = "chitrac-machine-dashboard-summary-card-order";
  private readonly summaryCardVisibilityKey = "chitrac-machine-dashboard-summary-card-visibility";
  private readonly allDayProjectedCountLabel = "Projected County (All Day)";
  private readonly legacyAllDayProjectedCountLabel = "Projected Count";
  private readonly shiftProjectedCountLabel = "Projected Count (Shift)";
  private readonly machineSummaryCardLabels = [
    "Machines",
    "Running",
    "Paused Machines",
    "Faulted",
    "Fault Time",
    "Offline",
    "Run Time",
    "Paused Time",
    "Down Time",
    "Idle/Paused Machines",
    "Down Machines",
    "Paused Operators",
    "Idle/Paused Operators",
    "Down Operators",
    "Total Count",
    "Current Pace",
    "Projected County (All Day)",
    "Projected Count (Shift)",
    "Avg OEE",
  ];
  private readonly layoutContextId = "machineDashboard";
  private summaryCardOrder: string[] = [];
  private summaryCardOrderSource: "server" | "local" | "default" = "default";
  private summaryCardVisibilitySource: "server" | "local" | "default" = "default";
  private layoutSnapshot: MachineDashboardLayoutSnapshot | null = null;
  private readonly summaryCardOrderSave$ = new Subject<string[]>();
  private shiftProjectionWindow: ShiftProjectionWindow | null = null;
  private allDayProjectionWindow: ShiftProjectionWindow | null = null;
  private allDayProjectionResponses: any[] | null = null;
  private currentShiftProjectionWindow: ShiftProjectionWindow | null = null;
  private currentShiftProjectionResponses: any[] | null = null;
  private currentShiftProjectionShiftId: string | null = null;
  private operatorStatusCounts: OperatorStatusCounts = EMPTY_OPERATOR_STATUS_COUNTS;

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
    private operatorService: OperatorService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private dialog: MatDialog,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private percentBreakpointService: PercentBreakpointService,
    private websocketService: WebsocketService,
    private settingsService: SettingsService,
    private userService: UserService,
    private layoutEditService: LayoutEditService,
    private shiftService: ShiftService
  ) {}

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    this.loadInitialSummaryCardOrder();
    this.loadInitialSummaryCardVisibility();
    this.setupSummaryCardOrderPersistence();
    this.subscribeToLayoutEditing();
    this.subscribeToUserPreferences();
    this.layoutEditService.register(this.layoutContextId, "Machine Dashboard");
    this.updateChartDimensions();
    window.addEventListener("resize", this.handleResize);

    // Prime from the websocket cache when it is already available, otherwise
    // keep the existing placeholder while the REST fallback catches up.
    if (!this.tryApplyWebsocketDashboardData(null)) {
      this.addDummyLoadingRow();
    }
    this.websocketService.ensureConnected();
    this.websocketService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.websocketStatus = status;
        if (status === "connected") {
          this.stopPolling();
        } else if ((status === "disconnected" || status === "error") && this.liveMode) {
          this.setupPolling();
        }
      });

    this.websocketService.dashboardCache$
      .pipe(takeUntil(this.destroy$))
      .subscribe((cache) => {
        if (this.tryApplyWebsocketDashboardData(cache)) {
          this.stopPolling();
        }
      });

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

  onSummaryCardDrop(event: CdkDragDrop<SummaryCard[]>): void {
    if (!this.layoutEditing) return;
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.summaryCards, event.previousIndex, event.currentIndex);
    this.layoutEditService.markEditsMade();
    this.summaryCardOrder = this.mergeVisibleSummaryCardOrder(this.summaryCards.map((card) => card.label));
    this.allSummaryCards = this.applySummaryCardOrder(this.allSummaryCards);
    this.settingsService.setMachineDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);

    if (!this.userService.getToken()) {
      this.summaryCardOrderSource = "local";
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(this.summaryCardOrder));
    }
  }

  onTableColumnVisibilityChange(visibility: Record<string, boolean>): void {
    if (this.layoutEditing) {
      this.layoutEditService.markEditsMade();
    }
    this.tableColumnVisibility = this.cleanTableColumnVisibility(visibility);
    this.settingsService.setMachineDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility);
  }

  openSummaryCardVisibilityDialog(): void {
    const dialogRef = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: "800px",
      maxWidth: "94vw",
      autoFocus: false,
      data: {
        cards: this.getSummaryCardVisibilityOptions(),
        visibility: this.summaryCardVisibility,
      },
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((visibility: Record<string, boolean> | undefined) => {
        if (!visibility) return;
        this.layoutEditService.markEditsMade();
        this.summaryCardVisibility = this.cleanSummaryCardVisibility(visibility);
        this.syncSummaryCardsFromAll();
        this.settingsService.setMachineDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility);

        if (!this.userService.getToken()) {
          this.summaryCardVisibilitySource = "local";
          localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(this.summaryCardVisibility));
        }
      });
  }

  ngOnDestroy(): void {
    this.layoutEditService.unregister(this.layoutContextId);
    if (this.observer) this.observer.disconnect();
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener("resize", this.handleResize);
  }

  detectTheme(): void {
    const isDark = document.body.classList.contains("dark-theme");
    this.isDarkTheme = isDark;
  }

  private setupPolling(): void {
    if (this.liveMode && this.websocketStatus !== "connected" && !this.pollingSubscription) {
      this.pollingSubscription = this.pollingService
        .poll(
          () => {
            this.endTime = this.pollingService.updateEndTimestampToNow();
            const shiftId = this.dateTimeService.getShiftId();

            return forkJoin({
              data: this.machineService.getMachinesSummary(this.startTime, this.endTime, shiftId),
              projection: this.machineService
                .getShiftProjectionWindow(this.getProjectionDate(), shiftId)
                .pipe(catchError(() => of(null))),
              allDayData: shiftId
                ? this.machineService.getMachinesSummary(this.startTime, this.endTime)
                  .pipe(catchError(() => of(null)))
                : of(null),
              allDayProjection: shiftId
                ? this.machineService.getShiftProjectionWindow(this.getProjectionDate())
                  .pipe(catchError(() => of(null)))
                : of(null),
              currentShiftProjection: shiftId
                ? of(null)
                : this.isCurrentDayView()
                  ? this.getCurrentShiftProjectionRequest()
                  : of(null),
            }).pipe(
                tap(({ data, projection, allDayData, allDayProjection, currentShiftProjection }: any) => {
                  this.shiftProjectionWindow = projection;
                  this.setAllDayProjectionData(shiftId ? allDayData : data, shiftId ? allDayProjection : projection);
                  if (!shiftId) {
                    this.setCurrentShiftProjectionData(currentShiftProjection);
                  }
                  const responses = Array.isArray(data) ? data : [data];
                  this.machineData = responses;
                  this.updateSummaryCards(responses, this.websocketService.getDashboardCacheSnapshot());
                  this.loadOperatorStatusCounts();

                  const formattedData = responses.map((response) => ({
                    Status: getStatusDotByCode(response.currentStatus?.code),
                    "Machine Name": response.machine.name,
                    "Serial Number": response.machine.serial,
                    Runtime: `${response.metrics.runtime.formatted.hours}h ${response.metrics.runtime.formatted.minutes}m`,
                    Downtime: `${response.metrics.downtime.formatted.hours}h ${response.metrics.downtime.formatted.minutes}m`,
                    "Paused Time": this.formatDurationMetric(response.metrics.pausedTime),
                    "Fault Time": this.formatDurationMetric(response.metrics.faultTime),
                    "Total Count": response.metrics.output.totalCount,
                    "Misfeed Count": response.metrics.output.misfeedCount,
                    PPH: this.formatPph(response),
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
    if (this.shouldUseWebsocketDashboardData()) {
      this.websocketService.ensureConnected();
      if (this.tryApplyWebsocketDashboardData(null)) {
        return;
      }
    }

    this.isLoading = true;
    this.addDummyLoadingRow();
    this.fetchRestDashboardData();
  }

  private fetchRestDashboardData(): void {
    const timeframe = this.dateTimeService.getTimeframe();
    const shiftId = this.dateTimeService.getShiftId();

    if (timeframe) {
      forkJoin({
        data: this.machineService.getMachineSummaryWithTimeframe(timeframe, shiftId),
        projection: this.machineService
          .getShiftProjectionWindow(this.getProjectionDate(), shiftId)
          .pipe(catchError(() => of(null))),
        allDayData: shiftId
          ? this.machineService.getMachineSummaryWithTimeframe(timeframe)
            .pipe(catchError(() => of(null)))
          : of(null),
        allDayProjection: shiftId
          ? this.machineService.getShiftProjectionWindow(this.getProjectionDate())
            .pipe(catchError(() => of(null)))
          : of(null),
        currentShiftProjection: shiftId
          ? of(null)
          : this.isCurrentDayView()
            ? this.getCurrentShiftProjectionRequest()
            : of(null),
      })
        .subscribe({
          next: ({ data, projection, allDayData, allDayProjection, currentShiftProjection }: any) => {
            this.shiftProjectionWindow = projection;
            this.setAllDayProjectionData(shiftId ? allDayData : data, shiftId ? allDayProjection : projection);
            if (!shiftId) {
              this.setCurrentShiftProjectionData(currentShiftProjection);
            }
            this.updateDashboardData(data);
            this.isLoading = false;
          },
          error: (err: unknown) => {
            console.error("Error fetching dashboard data:", err);
            this.rows = [];
            this.isLoading = false;
          },
        });
      return;
    }

    if (!this.startTime || !this.endTime) {
      this.rows = [];
      this.isLoading = false;
      return;
    }

    forkJoin({
      data: this.machineService.getMachinesSummary(this.startTime, this.endTime, shiftId),
      projection: this.machineService
        .getShiftProjectionWindow(this.getProjectionDate(), shiftId)
        .pipe(catchError(() => of(null))),
      allDayData: shiftId
        ? this.machineService.getMachinesSummary(this.startTime, this.endTime)
          .pipe(catchError(() => of(null)))
        : of(null),
      allDayProjection: shiftId
        ? this.machineService.getShiftProjectionWindow(this.getProjectionDate())
          .pipe(catchError(() => of(null)))
        : of(null),
      currentShiftProjection: shiftId
        ? of(null)
        : this.isCurrentDayView()
          ? this.getCurrentShiftProjectionRequest()
          : of(null),
    })
      .subscribe({
        next: ({ data, projection, allDayData, allDayProjection, currentShiftProjection }: any) => {
          this.shiftProjectionWindow = projection;
          this.setAllDayProjectionData(shiftId ? allDayData : data, shiftId ? allDayProjection : projection);
          if (!shiftId) {
            this.setCurrentShiftProjectionData(currentShiftProjection);
          }
          this.updateDashboardData(data);
          this.isLoading = false;
        },
        error: (err: unknown) => {
          console.error("Error fetching dashboard data:", err);
          this.rows = [];
          this.isLoading = false;
        },
      });
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

  private shouldUseWebsocketDashboardData(): boolean {
    if (this.dateTimeService.getLiveMode()) {
      return true;
    }

    const shiftId = this.dateTimeService.getShiftId();
    if (shiftId) {
      return this.isToday(this.startTime);
    }

    return this.isToday(this.startTime) && this.isToday(this.endTime);
  }

  private isCurrentDayView(): boolean {
    if (this.dateTimeService.getLiveMode()) {
      return true;
    }

    return this.isToday(this.startTime) && this.isToday(this.endTime);
  }

  private isToday(value: string): boolean {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;

    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
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
    this.updateSummaryCards(validResponses, this.websocketService.getDashboardCacheSnapshot());
    this.loadOperatorStatusCounts();

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
      const pausedTime = response.metrics?.pausedTime ?? response.performance?.pausedTime;
      const faultTime = response.metrics?.faultTime ?? response.performance?.faultTime;
      const performance = response.metrics?.performance ?? response.performance;

      return {
        Status: getStatusDotByCode(response.currentStatus?.code),
        "Machine Name": response.machine?.name ?? "Unknown",
        "Serial Number": response.machine?.serial,
        Runtime: `${runtime?.formatted?.hours ?? 0}h ${runtime?.formatted?.minutes ?? 0}m`,
        Downtime: `${downtime?.formatted?.hours ?? 0}h ${downtime?.formatted?.minutes ?? 0}m`,
        "Paused Time": this.formatDurationMetric(pausedTime),
        "Fault Time": this.formatDurationMetric(faultTime),
        "Total Count": totalCount,
        "Misfeed Count": misfeedCount,
        PPH: this.formatPph(response),
        Availability: `${performance?.availability?.percentage ?? "0"}%`,
        Throughput: `${performance?.throughput?.percentage ?? "0"}%`,
        Efficiency: `${performance?.efficiency?.percentage ?? "0"}%`,
        OEE: `${performance?.oee?.percentage ?? "0"}%`,
      };
    });

    this.columns = Object.keys(formattedData[0]).filter((col) => col !== "");
    this.rows = formattedData;
  }

  private updateSummaryCards(responses: any[], cache?: DashboardCacheState | null): void {
    const totalRunTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.runtime?.total ?? r.performance?.runtime?.total ?? 0), 0);
    const totalPausedTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.pausedTime?.total ?? r.performance?.pausedTime?.total ?? 0), 0);
    const totalDownTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.downTime?.total ?? r.metrics?.downtime?.total ?? r.performance?.downTime?.total ?? r.performance?.downtime?.total ?? 0), 0);
    const totalFaultTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.faultTime?.total ?? r.performance?.faultTime?.total ?? 0), 0);
    const machineCounts = calculateMachineStatusCounts(responses);
    const operatorCounts = this.operatorStatusCounts;
    const totalCount = responses.reduce((sum, r) => {
      const value = r.metrics?.output?.totalCount ?? r.itemSummary?.machineSummary?.totalCount ?? 0;
      return sum + Number(value || 0);
    }, 0);
    const avgOee = this.averagePercent(responses.map((r) => r.metrics?.performance?.oee?.percentage ?? r.performance?.oee?.percentage));
    const allDayProjection = this.getAllDayProjectionSource(responses, cache);
    const allDayTotalCount = this.getSummaryTotalCount(allDayProjection.responses);
    const allDayElapsedHours = this.getProjectionElapsedHours(allDayProjection.projectionWindow) ?? this.getElapsedHours();
    const allDayTotalProjectionHours =
      this.getProjectionTotalHours(allDayProjection.projectionWindow) ?? this.getProjectionWindowHours(allDayElapsedHours);
    const elapsedHours = this.getSelectedDataElapsedHours(cache);
    const currentPph = elapsedHours > 0 ? Math.round(totalCount / elapsedHours) : 0;
    const projectedCount = this.getProjectedCount(allDayTotalCount, allDayElapsedHours, allDayTotalProjectionHours);
    const shiftProjection = this.getShiftProjection(responses, cache);
    const shiftProjectionValue = shiftProjection.projectedCount === null
      ? "N/A"
      : shiftProjection.projectedCount.toLocaleString();
    const shiftProjectionTone = shiftProjection.projectedCount !== null && shiftProjection.projectedCount >= shiftProjection.totalCount
      ? "good"
      : "neutral";

    this.allSummaryCards = this.applySummaryCardOrder([
      { label: "Machines", value: machineCounts.total, icon: "precision_manufacturing", tone: "neutral" },
      { label: "Running", value: machineCounts.running, icon: "play_circle", tone: "good" },
      { label: "Paused Machines", value: machineCounts.paused, icon: "pause_circle", tone: machineCounts.paused > 0 ? "warn" : "neutral" },
      { label: "Faulted", value: machineCounts.faulted, icon: "warning", tone: machineCounts.faulted > 0 ? "bad" : "neutral" },
      { label: "Fault Time", value: this.formatMilliseconds(totalFaultTimeMs), icon: "timer_off", tone: totalFaultTimeMs > 0 ? "bad" : "neutral" },
      { label: "Offline", value: machineCounts.offline, icon: "cloud_off", tone: machineCounts.offline > 0 ? "warn" : "neutral" },
      { label: "Run Time", value: this.formatMilliseconds(totalRunTimeMs), icon: "timer", tone: totalRunTimeMs > 0 ? "good" : "neutral" },
      { label: "Paused Time", value: this.formatMilliseconds(totalPausedTimeMs), icon: "pause_circle", tone: totalPausedTimeMs > 0 ? "warn" : "neutral" },
      { label: "Down Time", value: this.formatMilliseconds(totalDownTimeMs), icon: "timer_off", tone: totalDownTimeMs > 0 ? "bad" : "neutral" },
      { label: "Idle/Paused Machines", value: machineCounts.idlePaused, icon: "motion_photos_paused", tone: machineCounts.idlePaused > 0 ? "warn" : "neutral" },
      { label: "Down Machines", value: machineCounts.down, icon: "do_not_disturb_on", tone: machineCounts.down > 0 ? "warn" : "neutral" },
      { label: "Paused Operators", value: operatorCounts.paused, icon: "pause_circle", tone: operatorCounts.paused > 0 ? "warn" : "neutral" },
      { label: "Idle/Paused Operators", value: operatorCounts.idlePaused, icon: "person_off", tone: operatorCounts.idlePaused > 0 ? "warn" : "neutral" },
      { label: "Down Operators", value: operatorCounts.down, icon: "do_not_disturb_on", tone: operatorCounts.down > 0 ? "warn" : "neutral" },
      this.withSparkline({
        label: "Total Count",
        value: totalCount.toLocaleString(),
        icon: "tag",
        tone: "neutral",
        sparklineData: this.getCountSparklineData(cache) || this.getMockCountSparklineData(totalCount, currentPph),
      }),
      { label: "Current Pace", value: `${currentPph.toLocaleString()} PPH`, icon: "trending_up", tone: currentPph > 0 ? "good" : "warn" },
      { label: this.allDayProjectedCountLabel, value: projectedCount.toLocaleString(), icon: "flag", tone: projectedCount >= allDayTotalCount ? "good" : "neutral" },
      { label: this.shiftProjectedCountLabel, value: shiftProjectionValue, icon: "outlined_flag", tone: shiftProjectionTone },
      { label: "Avg OEE", value: `${avgOee}%`, icon: "speed", tone: this.getOeeSummaryTone(avgOee) },
    ]);
    this.syncSummaryCardsFromAll();
  }

  private formatDurationMetric(metric: any): string {
    if (metric?.formatted) {
      return `${metric.formatted.hours ?? 0}h ${metric.formatted.minutes ?? 0}m`;
    }

    return this.formatMilliseconds(Number(metric?.total || 0));
  }

  private formatMilliseconds(totalMs: number): string {
    const safeMs = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
    const totalMinutes = Math.floor(safeMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  private getShiftProjection(responses: any[], cache?: DashboardCacheState | null): { totalCount: number; projectedCount: number | null } {
    const hasSelectedShift = Boolean(this.dateTimeService.getShiftId());
    if (!hasSelectedShift && (!this.isCurrentDayView() || !this.isCurrentlyInShift(cache))) {
      return { totalCount: 0, projectedCount: null };
    }

    const shiftResponses = this.getShiftProjectionResponses(responses, cache);
    const totalCount = this.getSummaryTotalCount(shiftResponses);
    const projectionWindow = this.getShiftProjectionWindow(cache);
    const elapsedHours = this.getProjectionElapsedHours(projectionWindow) ?? (hasSelectedShift ? this.getElapsedHours() : 0);
    const totalHours = this.getProjectionTotalHours(projectionWindow) ?? elapsedHours;

    return {
      totalCount,
      projectedCount: this.getProjectedCount(totalCount, elapsedHours, totalHours),
    };
  }

  private getShiftProjectionResponses(responses: any[], cache?: DashboardCacheState | null): any[] {
    if (this.dateTimeService.getShiftId()) {
      return responses;
    }

    const activeShiftId = this.getActiveCurrentShiftId(cache);
    if (!activeShiftId) {
      return [];
    }

    const currentShiftRows =
      (cache?.currentShift?.meta?.shiftId === activeShiftId ? cache?.currentShift?.machinesSummary : null) ||
      cache?.dashboard?.machines?.shifts?.find((shift) => shift?.meta?.shiftId === activeShiftId)?.machinesSummary ||
      (this.currentShiftProjectionShiftId === activeShiftId ? this.currentShiftProjectionResponses : null);

    return Array.isArray(currentShiftRows) ? currentShiftRows : [];
  }

  private getSummaryTotalCount(responses: any[]): number {
    return responses.reduce((sum, r) => {
      const value = r.metrics?.output?.totalCount ?? r.itemSummary?.machineSummary?.totalCount ?? 0;
      return sum + Number(value || 0);
    }, 0);
  }

  private getOeeSummaryTone(value: unknown): "good" | "warn" | "bad" {
    const color = this.percentBreakpointService.getOeDashboardColor(value);
    if (color === "green") return "good";
    if (color === "orange") return "warn";
    return "bad";
  }

  private loadOperatorStatusCounts(): void {
    if (!this.startTime || !this.endTime) {
      this.operatorStatusCounts = EMPTY_OPERATOR_STATUS_COUNTS;
      this.updateSummaryCards(this.machineData, this.websocketService.getDashboardCacheSnapshot());
      return;
    }

    const shiftId = this.dateTimeService.getShiftId();
    const timeframe = this.dateTimeService.getTimeframe();
    const summaryObservable = timeframe
      ? this.operatorService.getOperatorSummaryWithTimeframe(timeframe, shiftId)
      : this.operatorService.getOperatorSummary(this.startTime, this.endTime, shiftId);

    forkJoin({
      data: summaryObservable,
      idle: this.operatorService.getIdleOperatorSummary(this.startTime, this.endTime, shiftId),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ data, idle }) => {
          const responses = Array.isArray(data) ? data : [data];
          const operatorData = responses.filter((response) => response?.operator && response?.metrics);
          this.operatorStatusCounts = calculateOperatorStatusCounts(operatorData, idle?.idleOperators);
          this.updateSummaryCards(this.machineData, this.websocketService.getDashboardCacheSnapshot());
        },
        error: () => {
          this.operatorStatusCounts = EMPTY_OPERATOR_STATUS_COUNTS;
          this.updateSummaryCards(this.machineData, this.websocketService.getDashboardCacheSnapshot());
        },
      });
  }

  private getMockCountSparklineData(totalCount: number, currentPph: number): SparklineDataPoint[] {
    const baseline = Math.max(12, Math.round((currentPph || totalCount / 8 || 120) / 60));
    return Array.from({ length: 60 }, (_, index) => {
      const trend = index * 0.32;
      const wave = Math.sin(index / 4.5) * 3.8 + Math.cos(index / 8) * 2.4;
      const dip = index > 18 && index < 24 ? -8 + Math.abs(21 - index) * 1.4 : 0;
      const bump = index > 39 ? 4 : 0;
      return {
        value: Math.max(0, Math.round(baseline + trend + wave + dip + bump)),
        shiftState: "shift",
      };
    });
  }

  private getCountSparklineData(cache?: DashboardCacheState | null): SparklineDataPoint[] | null {
    const sparkline =
      cache?.countSparkline ||
      cache?.dashboard?.counts?.sparkline ||
      cache?.today?.countSparkline ||
      cache?.currentShift?.countSparkline;
    const points = sparkline?.allMachines;
    if (!Array.isArray(points) || points.length < 2) return null;

    const values = points
      .map((point) => ({
        value: Number(point?.count),
        shiftState: this.normalizeSparklineShiftState(point?.shiftState),
      }))
      .filter((point) => Number.isFinite(point.value));
    return values.length >= 2 ? values : null;
  }

  private withSparkline(card: SummaryCard): SummaryCard {
    const data = (card.sparklineData || [])
      .map((point) => ({
        value: Number(point?.value),
        shiftState: this.normalizeSparklineShiftState(point?.shiftState),
      }))
      .filter((point) => Number.isFinite(point.value));
    if (data.length < 2) return card;

    const width = 160;
    const height = 48;
    const values = data.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value.value - min) / range) * (height - 8) - 4;
      return { ...value, x, y };
    });
    const linePoints = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const areaPath = [
      `M0,${height}`,
      ...points.map((point, index) => `${index === 0 ? "L" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`),
      `L${width},${height}`,
      "Z",
    ].join(" ");

    return {
      ...card,
      sparklineData: data,
      sparklineLinePoints: linePoints,
      sparklineAreaPath: areaPath,
      sparklineSegments: this.buildSparklineSegments(points),
    };
  }

  private normalizeSparklineShiftState(value: unknown): SparklineShiftState {
    return value === "break" || value === "outsideShift" ? value : "shift";
  }

  private buildSparklineSegments(points: SparklineRenderPoint[]): SparklineSegment[] {
    const segments: { shiftState: SparklineShiftState; points: SparklineRenderPoint[] }[] = [];

    for (let index = 1; index < points.length; index += 1) {
      const shiftState = points[index].shiftState;
      const previousPoint = points[index - 1];
      const point = points[index];
      const currentSegment = segments[segments.length - 1];

      if (currentSegment?.shiftState === shiftState) {
        currentSegment.points.push(point);
      } else {
        segments.push({ shiftState, points: [previousPoint, point] });
      }
    }

    return segments.map((segment) => ({
      shiftState: segment.shiftState,
      linePoints: segment.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    }));
  }

  private applySummaryCardOrder(cards: SummaryCard[]): SummaryCard[] {
    if (!this.summaryCardOrder.length) return cards;

    const byLabel = new Map(cards.map((card) => [card.label, card]));
    const ordered = this.summaryCardOrder
      .map((label) => byLabel.get(label))
      .filter((card): card is SummaryCard => Boolean(card));
    const additions = cards.filter((card) => !this.summaryCardOrder.includes(card.label));

    return [...ordered, ...additions];
  }

  private applySummaryCardVisibility(cards: SummaryCard[]): SummaryCard[] {
    return cards.filter((card) => this.summaryCardVisibility[card.label] !== false);
  }

  private syncSummaryCardsFromAll(): void {
    this.allSummaryCards = this.applySummaryCardOrder(this.allSummaryCards);
    this.summaryCards = this.applySummaryCardVisibility(this.allSummaryCards);
  }

  private getSummaryCardVisibilityOptions(): SummaryCardVisibilityOption[] {
    const cards: SummaryCard[] = this.allSummaryCards.length
      ? this.allSummaryCards
      : this.machineSummaryCardLabels.map((label): SummaryCard => ({ label, value: "", icon: this.getSummaryCardFallbackIcon(label), tone: "neutral" }));

    return cards.map((card) => ({
      label: card.label,
      icon: card.icon,
      value: card.value,
      tone: card.tone,
      sparklineLinePoints: card.sparklineLinePoints,
      sparklineAreaPath: card.sparklineAreaPath,
    }));
  }

  private getSummaryCardFallbackIcon(label: string): string {
    const icons: Record<string, string> = {
      Machines: "precision_manufacturing",
      Running: "play_circle",
      "Paused Machines": "pause_circle",
      Faulted: "warning",
      "Fault Time": "timer_off",
      Offline: "cloud_off",
      "Run Time": "timer",
      "Paused Time": "pause_circle",
      "Down Time": "timer_off",
      "Idle/Paused Machines": "motion_photos_paused",
      "Down Machines": "do_not_disturb_on",
      "Paused Operators": "pause_circle",
      "Idle/Paused Operators": "person_off",
      "Down Operators": "do_not_disturb_on",
      "Total Count": "tag",
      "Current Pace": "trending_up",
      [this.allDayProjectedCountLabel]: "flag",
      [this.shiftProjectedCountLabel]: "outlined_flag",
      "Avg OEE": "speed",
    };
    return icons[label] || "dashboard";
  }

  private subscribeToLayoutEditing(): void {
    this.layoutEditService.context$
      .pipe(takeUntil(this.destroy$))
      .subscribe((context) => {
        const nextEditing = context?.id === this.layoutContextId && context.editing;
        if (nextEditing && !this.layoutEditing) {
          this.captureLayoutSnapshot();
        } else if (!nextEditing && this.layoutEditing) {
          this.layoutSnapshot = null;
        }
        this.layoutEditing = nextEditing;
      });

    this.layoutEditService.lockRequested$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.confirmAndSaveLayout());
  }

  private confirmAndSaveLayout(): void {
    const dialogRef = this.dialog.open(LayoutSaveConfirmComponent, {
      width: "380px",
      autoFocus: false,
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        if (result === "save") {
          this.saveLayoutPreferences();
          return;
        }
        if (result === "discard") {
          this.revertLayoutChanges();
        }
      });
  }

  private saveLayoutPreferences(): void {
    this.summaryCardOrder = this.getSummaryCardOrder();
    this.tableColumnVisibility = this.cleanTableColumnVisibility(this.tableColumnVisibility);
    this.summaryCardVisibility = this.cleanSummaryCardVisibility(this.summaryCardVisibility);
    this.settingsService.setMachineDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);

    if (!this.userService.getToken()) {
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(this.summaryCardOrder));
      localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(this.summaryCardVisibility));
      this.layoutEditService.setEditing(false);
      return;
    }

    this.settingsService.saveMachineDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility).subscribe({
      next: () => {
        localStorage.removeItem(this.summaryCardOrderKey);
        localStorage.removeItem(this.summaryCardVisibilityKey);
        this.summaryCardOrderSource = "server";
        this.summaryCardVisibilitySource = "server";
        this.layoutSnapshot = null;
        this.layoutEditService.setEditing(false);
      },
      error: (error) => {
        console.error("[MachineDashboard] Failed to save layout preferences", error);
      },
    });
  }

  private captureLayoutSnapshot(): void {
    this.layoutSnapshot = {
      summaryCardOrder: [...this.getSummaryCardOrder()],
      tableColumnVisibility: { ...this.tableColumnVisibility },
      summaryCardVisibility: { ...this.summaryCardVisibility },
      summaryCardOrderSource: this.summaryCardOrderSource,
      summaryCardVisibilitySource: this.summaryCardVisibilitySource,
    };
  }

  private revertLayoutChanges(): void {
    const snapshot = this.layoutSnapshot;
    if (!snapshot) {
      this.layoutEditService.setEditing(false);
      return;
    }

    this.summaryCardOrder = [...snapshot.summaryCardOrder];
    this.tableColumnVisibility = { ...snapshot.tableColumnVisibility };
    this.summaryCardVisibility = { ...snapshot.summaryCardVisibility };
    this.summaryCardOrderSource = snapshot.summaryCardOrderSource;
    this.summaryCardVisibilitySource = snapshot.summaryCardVisibilitySource;
    this.syncSummaryCardsFromAll();
    this.settingsService.setMachineDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);
    this.summaryCardOrderSource = snapshot.summaryCardOrderSource;
    this.summaryCardVisibilitySource = snapshot.summaryCardVisibilitySource;
    this.restoreLocalLayoutStorage(snapshot);
    this.layoutSnapshot = null;
    this.layoutEditService.setEditing(false);
  }

  private restoreLocalLayoutStorage(snapshot: MachineDashboardLayoutSnapshot): void {
    if (snapshot.summaryCardOrderSource === "local" && snapshot.summaryCardOrder.length) {
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(snapshot.summaryCardOrder));
    } else {
      localStorage.removeItem(this.summaryCardOrderKey);
    }

    if (snapshot.summaryCardVisibilitySource === "local" && Object.keys(snapshot.summaryCardVisibility).length) {
      localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(snapshot.summaryCardVisibility));
    } else {
      localStorage.removeItem(this.summaryCardVisibilityKey);
    }
  }

  private setupSummaryCardOrderPersistence(): void {
    this.summaryCardOrderSave$
      .pipe(
        debounceTime(800),
        distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
        switchMap((order) =>
          this.settingsService.saveMachineDashboardCardOrder(order).pipe(
            tap(() => localStorage.removeItem(this.summaryCardOrderKey)),
            catchError((error) => {
              console.error("[MachineDashboard] Failed to save summary card order", error);
              return of(null);
            })
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  private subscribeToUserPreferences(): void {
    this.settingsService.userPreferences$
      .pipe(takeUntil(this.destroy$))
      .subscribe((preferences) => {
        const machineDashboardLayout = preferences?.dashboardLayouts?.machineDashboard;
        const serverOrder = machineDashboardLayout?.summaryCardOrder;
        if (Array.isArray(serverOrder) && serverOrder.length) {
          this.summaryCardOrder = this.cleanSummaryCardOrder(serverOrder);
          this.summaryCardOrderSource = "server";
          this.syncSummaryCardsFromAll();
        }

        if (machineDashboardLayout?.summaryCardVisibility) {
          this.summaryCardVisibility = this.cleanSummaryCardVisibility(machineDashboardLayout.summaryCardVisibility);
          this.summaryCardVisibilitySource = "server";
          this.syncSummaryCardsFromAll();
        }

        if (machineDashboardLayout?.tableColumnVisibility) {
          this.tableColumnVisibility = this.cleanTableColumnVisibility(machineDashboardLayout.tableColumnVisibility);
        }

        if (
          preferences &&
          this.userService.getToken() &&
          (this.summaryCardOrderSource === "local" || this.summaryCardVisibilitySource === "local") &&
          (this.summaryCardOrder.length || Object.keys(this.summaryCardVisibility).length)
        ) {
          this.settingsService
            .saveMachineDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility)
            .subscribe({
              next: () => {
                localStorage.removeItem(this.summaryCardOrderKey);
                localStorage.removeItem(this.summaryCardVisibilityKey);
                this.summaryCardOrderSource = "server";
                this.summaryCardVisibilitySource = "server";
              },
              error: (error) => {
                console.error("[MachineDashboard] Failed to save local layout preferences", error);
              },
            });
        }
      });
  }

  private loadInitialSummaryCardOrder(): void {
    const localOrder = this.loadLocalSummaryCardOrder();
    if (!localOrder.length) return;

    this.summaryCardOrder = localOrder;
    this.summaryCardOrderSource = "local";
  }

  private loadInitialSummaryCardVisibility(): void {
    const localVisibility = this.loadLocalSummaryCardVisibility();
    if (!Object.keys(localVisibility).length) return;

    this.summaryCardVisibility = localVisibility;
    this.summaryCardVisibilitySource = "local";
  }

  private loadLocalSummaryCardOrder(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.summaryCardOrderKey) || "[]");
      return Array.isArray(parsed) ? this.cleanSummaryCardOrder(parsed) : [];
    } catch {
      return [];
    }
  }

  private loadLocalSummaryCardVisibility(): Record<string, boolean> {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.summaryCardVisibilityKey) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? this.cleanSummaryCardVisibility(parsed)
        : {};
    } catch {
      return {};
    }
  }

  private cleanSummaryCardOrder(labels: any[]): string[] {
    const allowedLabels = new Set(this.machineSummaryCardLabels);
    return [...new Set(labels
      .filter((label) => typeof label === "string")
      .map((label) => this.normalizeSummaryCardLabel(label.trim()))
      .filter((label) => allowedLabels.has(label)))];
  }

  private cleanSummaryCardVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    return this.machineSummaryCardLabels.reduce((acc, label) => {
      if (typeof visibility[label] === "boolean") {
        acc[label] = visibility[label];
      } else if (
        label === this.allDayProjectedCountLabel &&
        typeof visibility[this.legacyAllDayProjectedCountLabel] === "boolean"
      ) {
        acc[label] = visibility[this.legacyAllDayProjectedCountLabel];
      }
      return acc;
    }, {} as Record<string, boolean>);
  }

  private normalizeSummaryCardLabel(label: string): string {
    return label === this.legacyAllDayProjectedCountLabel
      ? this.allDayProjectedCountLabel
      : label;
  }

  private cleanTableColumnVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    return this.machineDashboardToggleableColumns.reduce((acc, column) => {
      if (typeof visibility[column] === "boolean") {
        acc[column] = visibility[column];
      }
      return acc;
    }, {} as Record<string, boolean>);
  }

  private getSummaryCardOrder(): string[] {
    return this.allSummaryCards.length
      ? this.allSummaryCards.map((card) => card.label)
      : this.summaryCardOrder;
  }

  private mergeVisibleSummaryCardOrder(visibleLabels: string[]): string[] {
    const hiddenLabels = this.getSummaryCardOrder().filter((label) => !visibleLabels.includes(label));
    return this.cleanSummaryCardOrder([...visibleLabels, ...hiddenLabels]);
  }

  private averagePercent(values: any[]): number {
    const numbers = values.map(Number).filter((v) => Number.isFinite(v));
    if (!numbers.length) return 0;
    return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
  }

  private getElapsedHours(): number {
    const start = new Date(this.startTime).getTime();
    const end = new Date(this.endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return (end - start) / 36e5;
  }

  private getProjectedCount(totalCount: number, elapsedHours: number, totalWindowHours: number): number {
    if (elapsedHours <= 0) return totalCount;
    if (!Number.isFinite(totalWindowHours) || totalWindowHours <= 0) return totalCount;
    return Math.round((totalCount / elapsedHours) * Math.max(elapsedHours, totalWindowHours));
  }

  private getProjectionWindowHours(elapsedHours: number): number {
    const start = new Date(this.startTime);
    const end = new Date(this.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return elapsedHours;
    const projectionEnd = new Date(end);
    projectionEnd.setHours(23, 59, 59, 999);
    return Math.max(elapsedHours, (projectionEnd.getTime() - start.getTime()) / 36e5);
  }

  private setAllDayProjectionData(data: any, projectionWindow: ShiftProjectionWindow | null): void {
    const responses = Array.isArray(data) ? data : data ? [data] : [];
    this.allDayProjectionResponses = responses.length ? responses : null;
    this.allDayProjectionWindow = projectionWindow;
  }

  private getCurrentShiftProjectionRequest(): Observable<{ shiftId: string | null; data: any; projection: ShiftProjectionWindow | null }> {
    return this.shiftService.getActiveShifts().pipe(
      switchMap(({ shifts }) => {
        const shiftId = this.resolveCurrentShiftId(shifts || []);
        if (!shiftId || !this.startTime || !this.endTime) {
          return of({ shiftId: null, data: null, projection: null });
        }

        return forkJoin({
          shiftId: of(shiftId),
          data: this.machineService
            .getMachinesSummary(this.startTime, this.endTime, shiftId)
            .pipe(catchError(() => of(null))),
          projection: this.machineService
            .getShiftProjectionWindow(this.getProjectionDate(), shiftId)
            .pipe(catchError(() => of(null))),
        });
      }),
      catchError(() => of({ shiftId: null, data: null, projection: null }))
    );
  }

  private setCurrentShiftProjectionData(payload: { shiftId: string | null; data: any; projection: ShiftProjectionWindow | null } | null): void {
    this.currentShiftProjectionShiftId = payload?.shiftId || null;
    this.currentShiftProjectionWindow = payload?.projection || null;
    const responses = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
    this.currentShiftProjectionResponses = responses.length ? responses : null;
  }

  private resolveCurrentShiftId(shifts: ShiftListItem[], now: Date = new Date()): string | null {
    const today = this.toIsoWeekday(now);
    const nowMinutes = this.toMinutes({ hour: now.getHours(), minute: now.getMinutes() });

    const activeShift = shifts
      .filter((shift) => shift?.active !== false)
      .filter((shift) => this.isValidShift(shift))
      .filter((shift) => !Array.isArray(shift.activeDays) || shift.activeDays.includes(today))
      .find((shift) => {
        const start = this.toMinutes(shift.startTime!);
        const end = this.toMinutes(shift.endTime!);
        return nowMinutes >= start && nowMinutes < end;
      });

    return activeShift?._id || null;
  }

  private isValidShift(shift: ShiftListItem): boolean {
    if (!shift?._id || !shift.startTime || !shift.endTime) {
      return false;
    }

    return this.toMinutes(shift.endTime) > this.toMinutes(shift.startTime);
  }

  private toIsoWeekday(date: Date): number {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  private toMinutes(time: { hour: number; minute: number }): number {
    return (Number(time.hour) * 60) + Number(time.minute);
  }

  private getSelectedDataElapsedHours(cache?: DashboardCacheState | null): number {
    const projectionWindow = this.getSelectedProjectionWindow(cache);
    return this.getProjectionElapsedHours(projectionWindow) ?? this.getElapsedHours();
  }

  private getAllDayProjectionSource(
    responses: any[],
    cache?: DashboardCacheState | null
  ): { responses: any[]; projectionWindow: ShiftProjectionWindow | null } {
    const todayEnvelope = cache?.dashboard?.machines?.today || cache?.today;
    const cachedRows = todayEnvelope?.machinesSummary;
    const cachedWindow = todayEnvelope?.meta?.projectionWindow;
    const usingSelectedShift = Boolean(this.dateTimeService.getShiftId());

    if (!usingSelectedShift) {
      return {
        responses,
        projectionWindow: cachedWindow || this.allDayProjectionWindow || this.shiftProjectionWindow,
      };
    }

    const allDayRows = Array.isArray(cachedRows) && cachedRows.length
      ? cachedRows
      : this.allDayProjectionResponses;

    return {
      responses: allDayRows && allDayRows.length ? allDayRows : responses,
      projectionWindow: cachedWindow || this.allDayProjectionWindow,
    };
  }

  private getSelectedProjectionWindow(cache?: DashboardCacheState | null): ShiftProjectionWindow | null {
    const shiftId = this.dateTimeService.getShiftId();
    if (!shiftId) {
      const todayEnvelope = cache?.dashboard?.machines?.today || cache?.today;
      return todayEnvelope?.meta?.projectionWindow || this.shiftProjectionWindow;
    }

    const selectedShiftEnvelope =
      cache?.dashboard?.machines?.shifts?.find((shift) => shift?.meta?.shiftId === shiftId) ||
      (cache?.currentShift?.meta?.shiftId === shiftId ? cache?.currentShift : null);

    return selectedShiftEnvelope?.meta?.projectionWindow || this.shiftProjectionWindow;
  }

  private getShiftProjectionWindow(cache?: DashboardCacheState | null): ShiftProjectionWindow | null {
    if (this.dateTimeService.getShiftId()) {
      return this.getSelectedProjectionWindow(cache);
    }

    const activeShiftId = this.getActiveCurrentShiftId(cache);
    if (!activeShiftId) {
      return null;
    }

    const currentShiftEnvelope =
      (cache?.currentShift?.meta?.shiftId === activeShiftId ? cache?.currentShift : null) ||
      cache?.dashboard?.machines?.shifts?.find((shift) => shift?.meta?.shiftId === activeShiftId);

    return currentShiftEnvelope?.meta?.projectionWindow ||
      (this.currentShiftProjectionShiftId === activeShiftId ? this.currentShiftProjectionWindow : null);
  }

  private isCurrentlyInShift(cache?: DashboardCacheState | null): boolean {
    return Boolean(this.getActiveCurrentShiftId(cache));
  }

  private getActiveCurrentShiftId(cache?: DashboardCacheState | null): string | null {
    const activeShift = cache?.activeShift;
    if (activeShift?.mode === "current" && activeShift?.shiftId) {
      return String(activeShift.shiftId);
    }

    if (cache?.currentShift?.meta?.mode === "current" && cache.currentShift.meta.shiftId) {
      return String(cache.currentShift.meta.shiftId);
    }

    if (this.currentShiftProjectionShiftId) {
      return this.currentShiftProjectionShiftId;
    }

    return null;
  }

  private getProjectionElapsedHours(projectionWindow: ShiftProjectionWindow | null): number | null {
    if (!projectionWindow) return null;
    const hours = Number(projectionWindow.elapsedShiftHours);
    if (Number.isFinite(hours)) return hours;

    const ms = Number(projectionWindow.elapsedShiftMs);
    return Number.isFinite(ms) ? ms / 36e5 : null;
  }

  private getProjectionTotalHours(projectionWindow: ShiftProjectionWindow | null): number | null {
    if (!projectionWindow) return null;
    const hours = Number(projectionWindow.totalShiftHours);
    if (Number.isFinite(hours)) return hours;

    const ms = Number(projectionWindow.totalShiftMs);
    return Number.isFinite(ms) ? ms / 36e5 : null;
  }

  private getProjectionDate(): string | undefined {
    const source = this.startTime || this.dateTimeService.getStartTime();
    if (!source) return undefined;
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return undefined;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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
    const cachedMachineData = this.getCachedMachineDetails(machineSerial);

    if (cachedMachineData) {
      this.openMachineDetailsModal(row, machineSerial, cachedMachineData, modalChartDimensions);
      return;
    }

    this.isOpeningModal = true;
    if (timeframe) {
      // Use timeframe-based API call
      this.machineService
        .getMachineDetailsWithTimeframe(timeframe, machineSerial, this.dateTimeService.getShiftId())
        .subscribe({
        next: (res: any[]) => {
          try {
            this.openMachineDetailsModal(row, machineSerial, res[0], modalChartDimensions);
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
              this.openMachineDetailsModal(row, machineSerial, res[0], modalChartDimensions);
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

  private getCachedMachineDetails(machineSerial: number): any | null {
    const machineData = this.machineData.find(
      (machine) => Number(machine?.machine?.serial) === Number(machineSerial)
    );

    if (!machineData) return null;

    const hasDetailData =
      !!machineData.itemSummary ||
      !!machineData.itemHourlyStack ||
      !!machineData.operatorEfficiency ||
      !!machineData.currentOperators ||
      !!machineData.faultData;

    return hasDetailData ? machineData : null;
  }

  private openMachineDetailsModal(
    row: any,
    machineSerial: number,
    machineData: any,
    modalChartDimensions: { width: number; height: number }
  ): void {
    const itemSummaryData = Object.values(
      machineData?.itemSummary?.machineSummary?.itemSummaries || {}
    );

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
          currentOperatorsData: machineData?.currentOperators || [],
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
          chartWidth: modalChartDimensions.width + 200,
          chartHeight: Math.max(modalChartDimensions.height - 40, 300),
          isModal: this.isModal,
          mode: "dashboard",
          preloadedData: machineData?.itemHourlyStack,
          marginTop: 30,
          marginRight: 180,
          marginBottom: 60,
          marginLeft: 100,
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
          serial: machineSerial.toString(),
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
          serial: machineSerial.toString(),
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
          chartWidth: modalChartDimensions.width + 200,
          chartHeight: Math.max(modalChartDimensions.height - 40, 300),
          isModal: this.isModal,
          mode: "dashboard",
          preloadedData: {
            machine: {
              serial: machineSerial,
              name: machineData?.machine?.name ?? "Unknown",
            },
            timeRange: {
              start: this.startTime,
              end: this.endTime,
            },
            hourlyData: machineData?.operatorEfficiency ?? [],
          },
          marginTop: 30,
          marginRight: 180,
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
  }

  getEfficiencyClass = (value: any, column?: string): string => {
    if (typeof value !== "string" || !value.includes("%")) return "";
    if (column === "OEE") return this.percentBreakpointService.getOeColorClass(value);
    return this.percentBreakpointService.getColorClass(value);
  };

  private formatPph(response: any): number {
    const pph =
      response?.itemSummary?.machineSummary?.pph ??
      response?.machineSummary?.pph ??
      response?.metrics?.performance?.piecesPerHour?.value ??
      response?.metrics?.performance?.pph ??
      response?.performance?.pph;

    const numericPph = Number(pph);
    return Number.isFinite(numericPph) ? Math.round(numericPph) : 0;
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private tryApplyWebsocketDashboardData(cache: DashboardCacheState | null): boolean {
    if (this.dateTimeService.getTimeframe() || this.dateTimeService.getConfirmed()) {
      return false;
    }

    const dashboardCache = cache || this.websocketService.getDashboardCacheSnapshot();
    const shiftId = this.dateTimeService.getShiftId();
    const envelope = shiftId
      ? dashboardCache?.dashboard?.machines?.shifts?.find((shift) => shift?.meta?.shiftId === shiftId) ||
        (dashboardCache?.currentShift?.meta?.shiftId === shiftId ? dashboardCache.currentShift : null)
      : dashboardCache?.today;
    const data = envelope?.machinesSummary;

    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    const validResponses = data.filter(
      (response) =>
        response &&
        (response.metrics || response.itemSummary || response.performance) &&
        response.machine &&
        response.currentStatus
    );

    if (validResponses.length === 0) {
      return false;
    }

    this.machineData = validResponses;
    this.updateSummaryCards(validResponses, dashboardCache);
    this.loadOperatorStatusCounts();
    const formattedData = validResponses.map((response) => {
      const totalCount = response.metrics?.output?.totalCount ??
        response.itemSummary?.machineSummary?.totalCount ?? 0;
      const misfeedCount = response.metrics?.output?.misfeedCount ??
        response.itemSummary?.machineSummary?.misfeedCount ?? 0;
      const runtime = response.metrics?.runtime ?? response.performance?.runtime;
      const downtime = response.metrics?.downtime ?? response.performance?.downtime;
      const pausedTime = response.metrics?.pausedTime ?? response.performance?.pausedTime;
      const faultTime = response.metrics?.faultTime ?? response.performance?.faultTime;
      const performance = response.metrics?.performance ?? response.performance;

      return {
        Status: getStatusDotByCode(response.currentStatus?.code),
        "Machine Name": response.machine?.name ?? "Unknown",
        "Serial Number": response.machine?.serial,
        Runtime: `${runtime?.formatted?.hours ?? 0}h ${runtime?.formatted?.minutes ?? 0}m`,
        Downtime: `${downtime?.formatted?.hours ?? 0}h ${downtime?.formatted?.minutes ?? 0}m`,
        "Paused Time": this.formatDurationMetric(pausedTime),
        "Fault Time": this.formatDurationMetric(faultTime),
        "Total Count": totalCount,
        "Misfeed Count": misfeedCount,
        PPH: this.formatPph(response),
        Availability: `${performance?.availability?.percentage ?? "0"}%`,
        Throughput: `${performance?.throughput?.percentage ?? "0"}%`,
        Efficiency: `${performance?.efficiency?.percentage ?? "0"}%`,
        OEE: `${performance?.oee?.percentage ?? "0"}%`,
      };
    });

    this.columns = Object.keys(formattedData[0]).filter((col) => col !== "");
    this.rows = formattedData;
    this.isLoading = false;
    return true;
  }

  private addDummyLoadingRow(): void {
    this.summaryCards = [];
    // Add a dummy row with loading state
    this.rows = [
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        //Status: "",
        "Machine Name": "",
        "Serial Number": "",
        Runtime: "",
        Downtime: "",
        "Paused Time": "",
        "Fault Time": "",
        "Total Count": "",
        "Misfeed Count": "",
        PPH: "",
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
        "Paused Time": "",
        "Fault Time": "",
        "Total Count": "",
        "Misfeed Count": "",
        PPH: "",
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
        "Paused Time": "",
        "Fault Time": "",
        "Total Count": "",
        "Misfeed Count": "",
        PPH: "",
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
        "Paused Time": "",
        "Fault Time": "",
        "Total Count": "",
        "Misfeed Count": "",
        PPH: "",
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
        "Paused Time": "",
        "Fault Time": "",
        "Total Count": "",
        "Misfeed Count": "",
        PPH: "",
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
        "Paused Time",
        "Fault Time",
        "Total Count",
        "Misfeed Count",
        "PPH",
        "Availability",
        "Throughput",
        "Efficiency",
        "OEE",
      ];
    }
  }
}
