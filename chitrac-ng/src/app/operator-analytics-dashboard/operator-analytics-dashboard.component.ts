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
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, takeUntil, tap } from 'rxjs';

import { BaseTableComponent } from '../components/base-table/base-table.component';
import { OperatorService } from '../services/operator.service';
import { MachineService } from '../services/machine.service';
import { getStatusDotByCode } from '../../utils/status-utils';
import {
  calculateMachineStatusCounts,
  calculateOperatorStatusCounts,
  EMPTY_MACHINE_STATUS_COUNTS,
  MachineStatusCounts,
} from '../../utils/dashboard-status-counts';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { SettingsService } from '../services/settings.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { DashboardCacheScope, DashboardCacheState, WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { UserService } from '../user.service';

import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { UseCarouselComponent } from '../use-carousel/use-carousel.component';
import { OperatorItemSummaryTableComponent } from '../operator-item-summary-table/operator-item-summary-table.component';
import { OperatorCountbyitemChartComponent } from '../operator-countbyitem-chart/operator-countbyitem-chart.component';
import { OperatorCyclePieChartComponent } from '../operator-cycle-pie-chart/operator-cycle-pie-chart.component';
import { OperatorFaultHistoryComponent } from '../operator-fault-history/operator-fault-history.component';
import { OperatorLineChartComponent } from '../operator-line-chart/operator-line-chart.component';
import { OperatorMachineSummaryComponent } from '../operator-machine-summary/operator-machine-summary.component';
import { OperatorTimelineChartComponent } from '../operator-timeline-chart/operator-timeline-chart.component';
import { LayoutSaveConfirmComponent } from '../components/layout-save-confirm/layout-save-confirm.component';
import {
  SummaryCardVisibilityDialogComponent,
  SummaryCardVisibilityOption,
} from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';

interface SummaryCard {
  label: string;
  value: string | number;
  icon: string;
  tone: string;
}

interface OperatorDashboardLayoutSnapshot {
  summaryCardOrder: string[];
  tableColumnVisibility: Record<string, boolean>;
  summaryCardVisibility: Record<string, boolean>;
  summaryCardOrderSource: 'server' | 'local' | 'default';
  summaryCardVisibilitySource: 'server' | 'local' | 'default';
}

interface IdleOperatorSummary {
  idleOperators: number;
  shiftOperators: number;
  activeOperators: number;
  idleOperatorIds?: number[];
}

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
        MatSlideToggleModule,
        DragDropModule
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
  summaryCards: SummaryCard[] = [];
  allSummaryCards: SummaryCard[] = [];
  layoutEditing = false;
  columnTooltips: { [column: string]: string } = {
    Runtime: 'Amount of time operator has been running across all machines',
    Downtime: 'Amount of time this operators machines have been paused, faulted, or offline.',
    'Paused Time': 'Amount of time this operator has been paused.',
    'Fault Time': 'Amount of time this operator has overlapped machine fault sessions.',
    'Total Count': 'Amount of pieces fed by operator',
    'Misfeed Count': 'Amount of pieces misfed or rejected by the operator.',
    PPH: 'Pieces Per Hour',
    Availability: 'Percent of time operator was active on a running machine.',
    Throughput: 'Percent of pieces fed which were good quality (not misfed or rejected).',
    Efficiency: 'Percent of goal pace being achieved.',
    OEE: 'Overall Equipment Efficiency, combination of Availability, Efficiency, and Throughput',
  };
  selectedRow: any = null;
  operatorData: any[] = []; // Store the raw dashboard data
  liveMode: boolean = false;
  isLoading: boolean = false;
  /** Full-screen loading overlay between row click and modal open (matches machine dashboard). */
  isOpeningModal: boolean = false;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private websocketStatus: WebsocketConnectionStatus = 'disconnected';
  private readonly handleResize = this.updateChartDimensions.bind(this);
  private readonly summaryCardOrderKey = 'chitrac-operator-dashboard-summary-card-order';
  private readonly summaryCardVisibilityKey = 'chitrac-operator-dashboard-summary-card-visibility';
  private readonly operatorSummaryCardLabels = [
    'Operators',
    'Assigned',
    'Running',
    'Paused Operators',
    'Faulted',
    'Fault Time',
    'Idle Operators',
    'Run Time',
    'Paused Time',
    'Down Time',
    'Idle/Paused Operators',
    'Down Operators',
    'Paused Machines',
    'Idle/Paused Machines',
    'Down Machines',
    'Total Count',
    'Projected Count',
    'Avg Efficiency',
  ];
  private readonly layoutContextId = 'operatorDashboard';
  private summaryCardOrder: string[] = [];
  private summaryCardOrderSource: 'server' | 'local' | 'default' = 'default';
  private summaryCardVisibilitySource: 'server' | 'local' | 'default' = 'default';
  private layoutSnapshot: OperatorDashboardLayoutSnapshot | null = null;
  private readonly POLLING_INTERVAL = 6000; // 6 seconds
  readonly operatorDashboardToggleableColumns = [
    'Operator ID',
    'Current Machine Serial',
    'Downtime',
    'Paused Time',
    'Fault Time',
    'Misfeed Count',
    'PPH',
    'Availability',
    'Throughput',
    'Efficiency',
  ];
  tableColumnVisibility: Record<string, boolean> = {};
  summaryCardVisibility: Record<string, boolean> = {};
  private idleOperatorSummary: IdleOperatorSummary | null = null;
  private machineStatusCounts: MachineStatusCounts = EMPTY_MACHINE_STATUS_COUNTS;

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
    private operatorService: OperatorService,
    private machineService: MachineService,
    private dialog: MatDialog,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private cdr: ChangeDetectorRef,
    private percentBreakpointService: PercentBreakpointService,
    private websocketService: WebsocketService,
    private settingsService: SettingsService,
    private userService: UserService,
    private layoutEditService: LayoutEditService
  ) {}

  ngOnInit(): void {
    this.loadInitialSummaryCardOrder();
    this.loadInitialSummaryCardVisibility();
    this.subscribeToLayoutEditing();
    this.subscribeToUserPreferences();
    this.layoutEditService.register(this.layoutContextId, 'Operator Dashboard');
    this.updateChartDimensions();
    window.addEventListener("resize", this.handleResize);

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    if (!this.tryApplyWebsocketDashboardData(null)) {
      this.addDummyLoadingRow();
    }
    this.websocketService.ensureConnected();
    this.websocketService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.websocketStatus = status;
        if (status === 'connected') {
          this.stopPolling();
        } else if ((status === 'disconnected' || status === 'error') && this.liveMode) {
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
        this.dateTimeService.setLiveMode(selection.mode === 'current');
        if (selection.mode === 'shift') {
          this.fetchAnalyticsData();
        }
      });
    }

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
    this.layoutEditService.unregister(this.layoutContextId);
    if (this.observer) {
      this.observer.disconnect();
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
    window.removeEventListener("resize", this.handleResize);
  }

  onSummaryCardDrop(event: CdkDragDrop<SummaryCard[]>): void {
    if (!this.layoutEditing) return;
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.summaryCards, event.previousIndex, event.currentIndex);
    this.layoutEditService.markEditsMade();
    this.summaryCardOrder = this.mergeVisibleSummaryCardOrder(this.summaryCards.map((card) => card.label));
    this.allSummaryCards = this.applySummaryCardOrder(this.allSummaryCards);
    this.settingsService.setOperatorDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);

    if (!this.userService.getToken()) {
      this.summaryCardOrderSource = 'local';
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(this.summaryCardOrder));
    }
  }

  onTableColumnVisibilityChange(visibility: Record<string, boolean>): void {
    if (this.layoutEditing) {
      this.layoutEditService.markEditsMade();
    }
    this.tableColumnVisibility = this.cleanTableColumnVisibility(visibility);
    this.settingsService.setOperatorDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility);
  }

  openSummaryCardVisibilityDialog(): void {
    const dialogRef = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '800px',
      maxWidth: '94vw',
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
        this.settingsService.setOperatorDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility);

        if (!this.userService.getToken()) {
          this.summaryCardVisibilitySource = 'local';
          localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(this.summaryCardVisibility));
        }
      });
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
    if (this.liveMode && this.websocketStatus !== 'connected' && !this.pollingSubscription) {
      // Setup polling for subsequent updates
      this.pollingSubscription = this.pollingService.poll(
        () => {
          this.endTime = this.pollingService.updateEndTimestampToNow();
          this.dateTimeService.setEndTime(this.endTime);
          
          // Check if we have a timeframe selected
          const timeframe = this.dateTimeService.getTimeframe();
          
          if (timeframe) {
            // Use timeframe-based API call
            return this.operatorService.getOperatorSummaryWithTimeframe(timeframe, this.dateTimeService.getShiftId())
              .pipe(
                tap((data: any) => {
                  this.updateDashboardData(data);
                  this.loadIdleOperatorSummary();
                })
              );
          } else {
            // Use regular API call with start/end times
            return this.operatorService.getOperatorSummary(this.startTime, this.endTime, this.dateTimeService.getShiftId())
              .pipe(
                tap((data: any) => {
                  this.updateDashboardData(data);
                  this.loadIdleOperatorSummary();
                })
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
    const responses = Array.isArray(data) ? data : [data];
    this.operatorData = responses.filter((response) => response?.operator && response?.metrics);
    this.updateSummaryCards(this.operatorData);
    this.loadMachineStatusCounts();

    if (this.operatorData.length === 0) {
      this.rows = [];
      this.cdr.markForCheck();
      return;
    }

    this.rows = this.operatorData.map(response => ({
      'Status': getStatusDotByCode(response.currentStatus?.code),
      'Operator Name': this.formatOperatorName(response.operator?.name),
      'Operator ID': response.operator?.id,
      'Current Machine': response.currentMachine?.name || '',
      'Current Machine Serial': response.currentMachine?.serial || '',
      'Runtime': `${response.metrics.runtime?.formatted?.hours ?? 0}h ${response.metrics.runtime?.formatted?.minutes ?? 0}m`,
      'Downtime': `${response.metrics.downtime?.formatted?.hours ?? 0}h ${response.metrics.downtime?.formatted?.minutes ?? 0}m`,
      'Paused Time': this.formatDurationMetric(response.metrics.pausedTime),
      'Fault Time': this.formatDurationMetric(response.metrics.faultTime),
      'Total Count': response.metrics.output?.totalCount ?? 0,
      'Misfeed Count': response.metrics.output?.misfeedCount ?? 0,
      'PPH': this.formatPph(response),
      'Availability': `${response.metrics.performance?.availability?.percentage ?? 0}%`,
      'Throughput': `${response.metrics.performance?.throughput?.percentage ?? 0}%`,
      'Efficiency': `${response.metrics.performance?.efficiency?.percentage ?? 0}%`,
      'OEE': `${response.metrics.performance?.oee?.percentage ?? 0}%`,
      'Time Range': `${this.startTime} to ${this.endTime}`
    }));

    const allColumns = Object.keys(this.rows[0]);
    const columnsToHide = ['Operator ID', 'Time Range'];
    this.columns = allColumns.filter(col => !columnsToHide.includes(col));
    this.cdr.markForCheck();
  }

  private updateSummaryCards(responses: any[]): void {
    const idleOperators = Number(this.idleOperatorSummary?.idleOperators ?? 0);
    const totalRunTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.runtime?.total || 0), 0);
    const totalPausedTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.pausedTime?.total || 0), 0);
    const totalDownTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.downTime?.total ?? r.metrics?.downtime?.total ?? 0), 0);
    const totalFaultTimeMs = responses.reduce((sum, r) => sum + Number(r.metrics?.faultTime?.total || 0), 0);
    const operatorCounts = calculateOperatorStatusCounts(responses, idleOperators);
    const machineCounts = this.machineStatusCounts;
    const totalCount = responses.reduce((sum, r) => sum + Number(r.metrics?.output?.totalCount || 0), 0);
    const avgEfficiency = this.averagePercent(responses.map((r) => r.metrics?.performance?.efficiency?.percentage));
    const elapsedHours = this.getElapsedHours();
    const totalProjectionHours = this.getProjectionWindowHours(elapsedHours);
    const projectedCount = this.getProjectedCount(totalCount, elapsedHours, totalProjectionHours);

    this.allSummaryCards = this.applySummaryCardOrder([
      { label: 'Operators', value: operatorCounts.total, icon: 'groups', tone: 'neutral' },
      { label: 'Assigned', value: operatorCounts.assigned, icon: 'assignment_ind', tone: 'neutral' },
      { label: 'Running', value: operatorCounts.running, icon: 'play_circle', tone: 'good' },
      { label: 'Paused Operators', value: operatorCounts.paused, icon: 'pause_circle', tone: operatorCounts.paused > 0 ? 'warn' : 'neutral' },
      { label: 'Faulted', value: operatorCounts.faulted, icon: 'warning', tone: operatorCounts.faulted > 0 ? 'bad' : 'neutral' },
      { label: 'Fault Time', value: this.formatMilliseconds(totalFaultTimeMs), icon: 'timer_off', tone: totalFaultTimeMs > 0 ? 'bad' : 'neutral' },
      { label: 'Idle Operators', value: operatorCounts.idle, icon: 'person_off', tone: operatorCounts.idle > 0 ? 'warn' : 'good' },
      { label: 'Run Time', value: this.formatMilliseconds(totalRunTimeMs), icon: 'timer', tone: totalRunTimeMs > 0 ? 'good' : 'neutral' },
      { label: 'Paused Time', value: this.formatMilliseconds(totalPausedTimeMs), icon: 'pause_circle', tone: totalPausedTimeMs > 0 ? 'warn' : 'neutral' },
      { label: 'Down Time', value: this.formatMilliseconds(totalDownTimeMs), icon: 'timer_off', tone: totalDownTimeMs > 0 ? 'bad' : 'neutral' },
      { label: 'Idle/Paused Operators', value: operatorCounts.idlePaused, icon: 'person_off', tone: operatorCounts.idlePaused > 0 ? 'warn' : 'neutral' },
      { label: 'Down Operators', value: operatorCounts.down, icon: 'do_not_disturb_on', tone: operatorCounts.down > 0 ? 'warn' : 'neutral' },
      { label: 'Paused Machines', value: machineCounts.paused, icon: 'pause_circle', tone: machineCounts.paused > 0 ? 'warn' : 'neutral' },
      { label: 'Idle/Paused Machines', value: machineCounts.idlePaused, icon: 'motion_photos_paused', tone: machineCounts.idlePaused > 0 ? 'warn' : 'neutral' },
      { label: 'Down Machines', value: machineCounts.down, icon: 'do_not_disturb_on', tone: machineCounts.down > 0 ? 'warn' : 'neutral' },
      { label: 'Total Count', value: totalCount.toLocaleString(), icon: 'tag', tone: 'neutral' },
      { label: 'Projected Count', value: projectedCount.toLocaleString(), icon: 'flag', tone: projectedCount >= totalCount ? 'good' : 'neutral' },
      { label: 'Avg Efficiency', value: `${avgEfficiency}%`, icon: 'speed', tone: avgEfficiency >= 85 ? 'good' : avgEfficiency >= 60 ? 'warn' : 'bad' },
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

  private loadMachineStatusCounts(): void {
    if (!this.startTime || !this.endTime) {
      this.machineStatusCounts = EMPTY_MACHINE_STATUS_COUNTS;
      this.updateSummaryCards(this.operatorData);
      return;
    }

    const shiftId = this.dateTimeService.getShiftId();
    const timeframe = this.dateTimeService.getTimeframe();
    const summaryObservable = timeframe
      ? this.machineService.getMachineSummaryWithTimeframe(timeframe, shiftId)
      : this.machineService.getMachinesSummary(this.startTime, this.endTime, shiftId);

    summaryObservable
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          const responses = Array.isArray(data) ? data : [data];
          const machineData = responses.filter(
            (response) =>
              response &&
              (response.metrics || response.itemSummary || response.performance) &&
              response.machine &&
              response.currentStatus
          );
          this.machineStatusCounts = calculateMachineStatusCounts(machineData);
          this.updateSummaryCards(this.operatorData);
          this.cdr.markForCheck();
        },
        error: () => {
          this.machineStatusCounts = EMPTY_MACHINE_STATUS_COUNTS;
          this.updateSummaryCards(this.operatorData);
          this.cdr.markForCheck();
        },
      });
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
    const cards = this.allSummaryCards.length
      ? this.allSummaryCards
      : this.operatorSummaryCardLabels.map((label) => ({ label, value: '', icon: this.getSummaryCardFallbackIcon(label), tone: 'neutral' }));

    return cards.map((card) => ({
      label: card.label,
      icon: card.icon,
      value: card.value,
      tone: card.tone,
    }));
  }

  private getSummaryCardFallbackIcon(label: string): string {
    const icons: Record<string, string> = {
      Operators: 'groups',
      Assigned: 'assignment_ind',
      Running: 'play_circle',
      'Paused Operators': 'pause_circle',
      Faulted: 'warning',
      'Fault Time': 'timer_off',
      'Idle Operators': 'person_off',
      'Run Time': 'timer',
      'Paused Time': 'pause_circle',
      'Down Time': 'timer_off',
      'Idle/Paused Operators': 'person_off',
      'Down Operators': 'do_not_disturb_on',
      'Paused Machines': 'pause_circle',
      'Idle/Paused Machines': 'motion_photos_paused',
      'Down Machines': 'do_not_disturb_on',
      'Total Count': 'tag',
      'Projected Count': 'flag',
      'Avg Efficiency': 'speed',
    };
    return icons[label] || 'dashboard';
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
      width: '380px',
      autoFocus: false,
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        if (result === 'save') {
          this.saveLayoutPreferences();
          return;
        }
        if (result === 'discard') {
          this.revertLayoutChanges();
        }
      });
  }

  private saveLayoutPreferences(): void {
    this.summaryCardOrder = this.getSummaryCardOrder();
    this.tableColumnVisibility = this.cleanTableColumnVisibility(this.tableColumnVisibility);
    this.summaryCardVisibility = this.cleanSummaryCardVisibility(this.summaryCardVisibility);
    this.settingsService.setOperatorDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);

    if (!this.userService.getToken()) {
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(this.summaryCardOrder));
      localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(this.summaryCardVisibility));
      this.layoutEditService.setEditing(false);
      return;
    }

    this.settingsService.saveOperatorDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility).subscribe({
      next: () => {
        localStorage.removeItem(this.summaryCardOrderKey);
        localStorage.removeItem(this.summaryCardVisibilityKey);
        this.summaryCardOrderSource = 'server';
        this.summaryCardVisibilitySource = 'server';
        this.layoutSnapshot = null;
        this.layoutEditService.setEditing(false);
      },
      error: (error) => {
        console.error('[OperatorDashboard] Failed to save layout preferences', error);
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
    this.settingsService.setOperatorDashboardLayout(this.summaryCardOrder, this.tableColumnVisibility, this.summaryCardVisibility);
    this.summaryCardOrderSource = snapshot.summaryCardOrderSource;
    this.summaryCardVisibilitySource = snapshot.summaryCardVisibilitySource;
    this.restoreLocalLayoutStorage(snapshot);
    this.layoutSnapshot = null;
    this.layoutEditService.setEditing(false);
  }

  private restoreLocalLayoutStorage(snapshot: OperatorDashboardLayoutSnapshot): void {
    if (snapshot.summaryCardOrderSource === 'local' && snapshot.summaryCardOrder.length) {
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(snapshot.summaryCardOrder));
    } else {
      localStorage.removeItem(this.summaryCardOrderKey);
    }

    if (snapshot.summaryCardVisibilitySource === 'local' && Object.keys(snapshot.summaryCardVisibility).length) {
      localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(snapshot.summaryCardVisibility));
    } else {
      localStorage.removeItem(this.summaryCardVisibilityKey);
    }
  }

  private subscribeToUserPreferences(): void {
    this.settingsService.userPreferences$
      .pipe(takeUntil(this.destroy$))
      .subscribe((preferences) => {
        const operatorDashboardLayout = preferences?.dashboardLayouts?.operatorDashboard;
        const serverOrder = operatorDashboardLayout?.summaryCardOrder;
        if (Array.isArray(serverOrder) && serverOrder.length) {
          this.summaryCardOrder = this.cleanSummaryCardOrder(serverOrder);
          this.summaryCardOrderSource = 'server';
          this.syncSummaryCardsFromAll();
        }

        if (operatorDashboardLayout?.summaryCardVisibility) {
          this.summaryCardVisibility = this.cleanSummaryCardVisibility(operatorDashboardLayout.summaryCardVisibility);
          this.summaryCardVisibilitySource = 'server';
          this.syncSummaryCardsFromAll();
        }

        if (operatorDashboardLayout?.tableColumnVisibility) {
          this.tableColumnVisibility = this.cleanTableColumnVisibility(operatorDashboardLayout.tableColumnVisibility);
        }

        if (
          preferences &&
          this.userService.getToken() &&
          (this.summaryCardOrderSource === 'local' || this.summaryCardVisibilitySource === 'local') &&
          (this.summaryCardOrder.length || Object.keys(this.summaryCardVisibility).length)
        ) {
          this.summaryCardOrderSource = 'server';
          this.settingsService.saveOperatorDashboardLayout(this.getSummaryCardOrder(), this.tableColumnVisibility, this.summaryCardVisibility).subscribe({
            next: () => {
              localStorage.removeItem(this.summaryCardOrderKey);
              localStorage.removeItem(this.summaryCardVisibilityKey);
              this.summaryCardVisibilitySource = 'server';
            },
            error: (error) => {
              this.summaryCardOrderSource = 'local';
              console.error('[OperatorDashboard] Failed to save local layout preferences', error);
            },
          });
        }
      });
  }

  private loadInitialSummaryCardOrder(): void {
    const localOrder = this.loadLocalSummaryCardOrder();
    if (!localOrder.length) return;

    this.summaryCardOrder = localOrder;
    this.summaryCardOrderSource = 'local';
  }

  private loadInitialSummaryCardVisibility(): void {
    const localVisibility = this.loadLocalSummaryCardVisibility();
    if (!Object.keys(localVisibility).length) return;

    this.summaryCardVisibility = localVisibility;
    this.summaryCardVisibilitySource = 'local';
  }

  private loadLocalSummaryCardOrder(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.summaryCardOrderKey) || '[]');
      return Array.isArray(parsed) ? this.cleanSummaryCardOrder(parsed) : [];
    } catch {
      return [];
    }
  }

  private loadLocalSummaryCardVisibility(): Record<string, boolean> {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.summaryCardVisibilityKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? this.cleanSummaryCardVisibility(parsed)
        : {};
    } catch {
      return {};
    }
  }

  private cleanSummaryCardOrder(labels: any[]): string[] {
    const allowedLabels = new Set(this.operatorSummaryCardLabels);
    return [...new Set(labels.filter((label) => typeof label === 'string').map((label) => label.trim()).filter((label) => allowedLabels.has(label)))];
  }

  private cleanSummaryCardVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    return this.operatorSummaryCardLabels.reduce((acc, label) => {
      if (typeof visibility[label] === 'boolean') {
        acc[label] = visibility[label];
      }
      return acc;
    }, {} as Record<string, boolean>);
  }

  private cleanTableColumnVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    return this.operatorDashboardToggleableColumns.reduce((acc, column) => {
      if (typeof visibility[column] === 'boolean') {
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
    const numbers = values.map(Number).filter((value) => Number.isFinite(value));
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

  async fetchAnalyticsData(): Promise<void> {
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
      this.operatorService.getOperatorSummaryWithTimeframe(timeframe, shiftId)
        .subscribe({
          next: (data: any) => {
            this.updateDashboardData(data);
            this.loadIdleOperatorSummary();
            this.isLoading = false;
          },
          error: (error) => {
            console.error('Error fetching analytics data:', error);
            this.rows = [];
            this.isLoading = false;
          }
        });
      return;
    }

    if (!this.startTime || !this.endTime) {
      this.rows = [];
      this.isLoading = false;
      return;
    }

    this.operatorService.getOperatorSummary(this.startTime, this.endTime, shiftId)
      .subscribe({
        next: (data: any) => {
          this.updateDashboardData(data);
          this.loadIdleOperatorSummary();
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error fetching analytics data:', error);
          this.rows = [];
          this.isLoading = false;
        }
      });
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

  private subscribeToWebsocketDashboardData(): void {
    this.websocketService.connect();
    this.stopPolling();

    const scope = this.getDashboardCacheScope();
    const shiftId = this.dateTimeService.getShiftId();
    this.pollingSubscription = this.websocketService
      .operatorDashboardData$(scope, shiftId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.updateDashboardData(data);
        this.loadIdleOperatorSummary();
        this.isLoading = false;
      });
  }

  private loadIdleOperatorSummary(): void {
    this.operatorService
      .getIdleOperatorSummary(this.startTime, this.endTime, this.dateTimeService.getShiftId())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => {
          this.idleOperatorSummary = summary || null;
          this.updateSummaryCards(this.operatorData);
          this.cdr.markForCheck();
        },
        error: () => {
          this.idleOperatorSummary = null;
          this.updateSummaryCards(this.operatorData);
          this.cdr.markForCheck();
        },
      });
  }

  private getDashboardCacheScope(): DashboardCacheScope {
    return this.dateTimeService.getShiftId() ? 'currentShift' : 'today';
  }

  private formatOperatorName(name: any): string {
    if (!name) return 'Unknown';
    if (typeof name === 'string') return name;
    if (name.first && name.surname) return `${name.first} ${name.surname}`;
    if (name.first) return name.first;
    return 'Unknown';
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
    // Slightly increase vertical padding so charts fit without overflow/scroll (align with machine modal)
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

    this.isOpeningModal = true;

    // Fetch detailed operator data for the modal
    const summaryObservable = timeframe
      ? this.operatorService.getOperatorSummaryWithTimeframe(timeframe, this.dateTimeService.getShiftId())
      : this.operatorService.getOperatorSummary(this.startTime, this.endTime, this.dateTimeService.getShiftId());

    summaryObservable.subscribe({
      next: (summaryData) => {
        const base = Array.isArray(summaryData) ? summaryData.find(d => d.operator.id === operatorId) : summaryData;

        if (Array.isArray(summaryData) && base == null) {
          this.isOpeningModal = false;
          return;
        }

        const detailsObservable = timeframe
          ? this.operatorService.getOperatorDetailsWithTimeFrame(this.startTime, this.endTime, operatorId)
          : this.operatorService.getOperatorDetails(this.startTime, this.endTime, operatorId);

        detailsObservable.subscribe({
            next: (infoData) => {
              try {
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
                    chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                    chartWidth: modalChartDimensions.width + 200,
                    marginTop: 30,
                    marginRight: 180,
                    marginBottom: 80,
                    marginLeft: 40,
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
                    chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                    chartWidth: modalChartDimensions.width + 200,
                    marginTop: 30,
                    marginRight: 180,
                    marginBottom: 80,
                    marginLeft: 40,
                    showLegend: true,
                    legendPosition: 'right',
                    legendWidthPx: 120
                  }
                },
                {
                  label: 'Operator Timeline',
                  component: OperatorTimelineChartComponent,
                  componentInputs: {
                    timelineData: data.operatorTimeline,
                    operatorId: operatorId.toString(),
                    isModal: true,
                    chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                    chartWidth: modalChartDimensions.width + 200
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
                    chartHeight: Math.max(modalChartDimensions.height - 40, 300),
                    chartWidth: modalChartDimensions.width + 200,
                    marginTop: 30,
                    marginRight: 180,
                    marginBottom: 80,
                    marginLeft: 40,
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
              } finally {
                this.isOpeningModal = false;
              }
            },
            error: (err: unknown) => {
              console.error('Error loading operator details for modal:', err);
              this.isOpeningModal = false;
            }
          });
      },
      error: (err: unknown) => {
        console.error('Error loading operator summary for modal:', err);
        this.isOpeningModal = false;
      }
    });
  
  }

  getEfficiencyClass = (value: any, column: string): string => {
    if ((column === 'Efficiency' || column === 'OEE' || column === 'Availability' || column === 'Throughput') && typeof value === 'string' && value.includes('%')) {
      if (column === 'OEE') return this.percentBreakpointService.getOeColorClass(value);
      return this.percentBreakpointService.getColorClass(value);
    }
    return '';
  };

  private formatPph(response: any): number {
    const pph =
      response?.operatorSummary?.pph ??
      response?.metrics?.performance?.piecesPerHour?.value ??
      response?.metrics?.performance?.pph ??
      response?.performance?.pph;

    const numericPph = Number(pph);
    return Number.isFinite(numericPph) ? Math.round(numericPph) : 0;
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private tryApplyWebsocketDashboardData(cache: DashboardCacheState | null): boolean {
    if (this.dateTimeService.getTimeframe() || this.dateTimeService.getConfirmed()) {
      return false;
    }

    const dashboardCache = cache || this.websocketService.getDashboardCacheSnapshot();
    const envelope = this.dateTimeService.getShiftId()
      ? dashboardCache?.currentShift
      : dashboardCache?.today;
    const data = envelope?.operatorsSummary;

    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    this.updateDashboardData(data);
    this.isLoading = false;
    return true;
  }

  private addDummyLoadingRow(): void {
    this.summaryCards = [];
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
        'Paused Time': '',
        'Fault Time': '',
        'Total Count': '',
        'Misfeed Count': '',
        'PPH': '',
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
        'Paused Time': '',
        'Fault Time': '',
        'Total Count': '',
        'Misfeed Count': '',
        'PPH': '',
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
        'Paused Time': '',
        'Fault Time': '',
        'Total Count': '',
        'Misfeed Count': '',
        'PPH': '',
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
        'Paused Time': '',
        'Fault Time': '',
        'Total Count': '',
        'Misfeed Count': '',
        'PPH': '',
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
        'Paused Time': '',
        'Fault Time': '',
        'Total Count': '',
        'Misfeed Count': '',
        'PPH': '',
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
        'Paused Time',
        'Fault Time',
        'Total Count',
        'Misfeed Count',
        'PPH',
        'Availability',
        'Throughput',
        'Efficiency',
        'OEE',
      ];
    }
  }
}
