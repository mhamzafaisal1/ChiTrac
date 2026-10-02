import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  Renderer2,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { FormsModule } from "@angular/forms";
import { HttpClientModule } from "@angular/common/http";
import { forkJoin } from 'rxjs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, takeUntil, tap, delay, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { UseCarouselComponent } from '../use-carousel/use-carousel.component';
import { MachineFaultHistoryComponent } from '../machine-fault-history/machine-fault-history.component';
import { OperatorPerformanceChartComponent } from '../operator-performance-chart/operator-performance-chart.component';
import { MachineItemStackedBarChartComponent } from '../machine-item-stacked-bar-chart/machine-item-stacked-bar-chart.component';
import { BaseTableComponent } from "../components/base-table/base-table.component";
import { formatDurationMilliseconds, formatDurationParts } from '../shared/utils/duration-format';
import { MachineService } from '../services/machine.service';
import { OperatorCountbyitemChartComponent } from "../operator-countbyitem-chart/operator-countbyitem-chart.component";
import { getStatusDot } from '../../utils/status-utils';
import { DashboardService } from '../services/dashboard.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { OperatorService } from '../services/operator.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { SettingsService } from '../services/settings.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { UserService } from '../user.service';
import { LayoutSaveConfirmComponent } from '../components/layout-save-confirm/layout-save-confirm.component';
import {
  SummaryCardVisibilityDialogComponent,
  SummaryCardVisibilityDialogResult,
  SummaryCardVisibilityOption,
} from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import {
  calculateMachineStatusCounts,
  calculateOperatorStatusCounts,
  hasConnectedActivity,
} from '../../utils/dashboard-status-counts';

interface SummaryCard {
  id: string;
  label: string;
  value: string | number;
  icon: string;
  tone: string;
}

interface SummaryDashboardLayoutSnapshot {
  summaryCardOrder: string[];
  summaryCardVisibility: Record<string, boolean>;
}

@Component({
    selector: "app-daily-summary-dashboard",
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatSlideToggleModule,
        DragDropModule,
        BaseTableComponent,
        MatDialogModule,
    ],
    templateUrl: "./daily-summary-dashboard.component.html",
    styleUrls: ["./daily-summary-dashboard.component.scss"]
})
export class DailySummaryDashboardComponent implements OnInit, OnDestroy {
  startTime: string = "";
  endTime: string = "";
  isDarkTheme: boolean = false;
  private observer!: MutationObserver;
  machineColumns: string[] = ["Status", "Machine Name", "Total Count", "OEE"];
  machineRows: any[] = [];
  selectedMachine: any = null;
  selectedRow: any | null = null;
  itemColumns: string[] = ['Item Name', 'Total Count', 'Efficiency'];
  itemRows: any[] = [];  
  operatorColumns: string[] = ['Status', 'Operator Name', 'Worked Time', 'Efficiency'];
  operatorRows: any[] = [];
  selectedOperator: any = null;
  liveMode: boolean = false;
  isLoading: boolean = false;
  rawMachineData: any[] = []; // store full API response for machines
  rawOperatorData: any[] = []; // store full API response for operators
  rawItemData: any[] = [];
  summaryCards: SummaryCard[] = [];
  allSummaryCards: SummaryCard[] = [];
  summaryCardVisibility: Record<string, boolean> = {};
  layoutEditing = false;
  private idleOperatorSummary: any = null;
  private readonly layoutContextId = 'summaryDashboard';
  private readonly summaryCardOrderKey = 'chitrac-summary-dashboard-summary-card-order';
  private readonly summaryCardVisibilityKey = 'chitrac-summary-dashboard-summary-card-visibility';
  private summaryCardOrder: string[] = [];
  private layoutSnapshot: SummaryDashboardLayoutSnapshot | null = null;
  private readonly defaultVisibleSummaryCardIds = new Set([
    'machine.machines',
    'machine.running',
    'operator.operators',
    'operator.running',
    'machine.totalCount',
    'operator.totalCount',
    'machine.avgOee',
    'operator.avgEfficiency',
  ]);
  private readonly summaryCardIds = [
    'machine.machines', 'machine.running', 'machine.paused', 'machine.faulted', 'machine.offline',
    'machine.idlePaused', 'machine.down', 'operator.operators', 'operator.assigned', 'operator.running',
    'operator.paused', 'operator.faulted', 'operator.idle', 'operator.idlePaused', 'operator.down',
    'machine.faultTime', 'machine.avgFaultTime', 'machine.runTime', 'machine.avgWorkedTime',
    'machine.pausedTime', 'machine.avgPausedTime', 'machine.downTime', 'machine.avgDownTime',
    'machine.totalCount', 'machine.currentPace', 'machine.shift', 'machine.projectedAllDay',
    'machine.projectedShift', 'machine.avgAvailability', 'machine.avgThroughput', 'machine.avgEfficiency',
    'machine.avgOee', 'operator.faultTime', 'operator.avgFaultTime', 'operator.workedTime',
    'operator.avgWorkedTime', 'operator.pausedTime', 'operator.avgPausedTime', 'operator.downTime',
    'operator.avgDownTime', 'operator.totalCount', 'operator.projectedCount', 'operator.avgAvailability',
    'operator.avgThroughput', 'operator.avgEfficiency', 'operator.avgOee',
  ];
  private machinePollSub: any;
  private operatorPollSub: any;
  private itemPollSub: any;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds
  private readonly OP_POLL = this.POLLING_INTERVAL + 2000; // 8 seconds
  private readonly ITEM_POLL = this.POLLING_INTERVAL + 4000; // 10 seconds

  // Add chart dimensions and isModal property
  chartWidth: number = 1000;
  chartHeight: number = 700;
  isModal: boolean = true;

  constructor(
    private renderer: Renderer2,
    private elRef: ElementRef,
    private dashboardService: DashboardService,
    private dialog: MatDialog,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private cdr: ChangeDetectorRef,
    private machineService: MachineService,
    private operatorService: OperatorService,
    private percentBreakpointService: PercentBreakpointService,
    private settingsService: SettingsService,
    private layoutEditService: LayoutEditService,
    private userService: UserService
  ) {}

  ngOnInit(): void {

    this.loadInitialSummaryCardLayout();
    this.subscribeToLayoutEditing();
    this.subscribeToUserPreferences();
    this.layoutEditService.register(this.layoutContextId, 'Summary Dashboard');

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    // Add dummy loading rows initially
    this.addDummyLoadingRows();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchData().subscribe();
    } else {
      this.dashboardTimeframeService.applyDefault().subscribe((selection) => {
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        this.dateTimeService.setLiveMode(selection.mode === "current");
        if (selection.mode === "shift") {
          this.addDummyLoadingRows();
          this.fetchData().subscribe();
        }
      });
    }

    this.detectTheme();

    if (this.observer) this.observer.disconnect();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Subscribe to live mode changes
    this.dateTimeService.liveMode$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isLive => {
      this.liveMode = isLive;
      if (isLive) {
        // Add dummy loading rows when switching to live mode
        this.addDummyLoadingRows();
        // Reset startTime to today at 00:00
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        this.startTime = this.formatDateForInput(start);
        this.dateTimeService.setStartTime(this.startTime);

        // Reset endTime to now
        this.endTime = this.pollingService.updateEndTimestampToNow();
        this.dateTimeService.setEndTime(this.endTime);
        this.dateTimeService.setShiftId("");

        // Initial data fetch
        this.fetchData().subscribe();
        this.setupPolling();
      } else {
        this.stopPolling();
        this.clearData();
        // Add dummy loading rows when stopping live mode
        this.addDummyLoadingRows();
      }
    });

    // Subscribe to confirm trigger
    this.dateTimeService.confirmTrigger$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.liveMode = false; // turn off polling
      this.stopPolling();

      // Add dummy loading rows when confirming date/time
      this.addDummyLoadingRows();

      // get times from the shared service
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();

      this.fetchData().subscribe(); // use them to fetch data
    });
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
    this.layoutEditService.unregister(this.layoutContextId);
  }

  detectTheme(): void {
    const isDark = document.body.classList.contains("dark-theme");
    this.isDarkTheme = isDark;
  }

  private setupPolling(): void {
    if (!this.liveMode) return;

    const tick = () => {
      this.endTime = this.pollingService.updateEndTimestampToNow();
      this.dateTimeService.setEndTime(this.endTime);
    };

    this.machinePollSub = this.pollingService.poll(
      () => { tick(); return this.dashboardService
        .getMachinesSummary(this.startTime, this.endTime, undefined, this.dateTimeService.getShiftId())
        .pipe(
          tap((r:any)=> this.updateMachines(r)),
          catchError(err => { console.error('machines poll', err); return of(null); }),
          delay(0)
        ); },
      this.POLLING_INTERVAL, this.destroy$, false, false).subscribe();

    this.operatorPollSub = this.pollingService.poll(
      () => { tick(); return forkJoin({
        operators: this.dashboardService.getOperatorsSummary(this.startTime, this.endTime, this.dateTimeService.getShiftId()),
        idleOperators: this.operatorService
          .getIdleOperatorSummary(this.startTime, this.endTime, this.dateTimeService.getShiftId())
          .pipe(catchError(() => of(null))),
      })
        .pipe(
          tap(({ operators, idleOperators }) => {
            this.idleOperatorSummary = idleOperators;
            this.updateOperators(operators);
          }),
          catchError(err => { console.error('operators poll', err); return of(null); }),
          delay(0)
        ); },
      this.OP_POLL, this.destroy$, false, false).subscribe();

    this.itemPollSub = this.pollingService.poll(
      () => { tick(); return this.dashboardService
        .getItemsSummary(this.startTime, this.endTime, undefined, this.dateTimeService.getShiftId())
        .pipe(
          tap((r:any)=> this.updateItems(r)),
          catchError(err => { console.error('items poll', err); return of(null); }),
          delay(0)
        ); },
      this.ITEM_POLL, this.destroy$, false, false).subscribe();
  }

  private stopPolling(): void {
    for (const s of [this.machinePollSub, this.operatorPollSub, this.itemPollSub]) if (s) s.unsubscribe();
    this.machinePollSub = this.operatorPollSub = this.itemPollSub = null;
  }

  private clearData(): void {
    this.rawMachineData = [];
    this.rawOperatorData = [];
    this.rawItemData = [];
    this.machineRows = [];
    this.operatorRows = [];
    this.itemRows = [];
    this.idleOperatorSummary = null;
    this.updateSummaryCards();
  }

  private updateMachines(data:any){ 
    const arr = Array.isArray(data) ? data : (data?.machineResults ?? []);
    this.rawMachineData = arr;
    this.machineRows = arr.map((m:any)=>({
      Status: getStatusDot(m.currentStatus),
      'Machine Name': m.machine?.name ?? 'Unknown',
      'OEE': this.formatPercentage(m.performance?.oee?.percentage ?? 0),
      'Total Count': m.performance?.output?.totalCount ?? 0,
      serial: m.machine?.serial
    }));
    this.updateSummaryCards();
  }

  private updateOperators(data:any){
    const arr = Array.isArray(data) ? data : (data?.operatorResults ?? []);
    this.rawOperatorData = arr;
    this.operatorRows = arr.map((o:any)=>({
      Status: getStatusDot(o.currentStatus),
      'Operator Name': this.formatOperatorName(o.operator?.name),
      'Worked Time': this.formatDurationForTable(o.metrics?.workedTime ?? o.metrics?.runtime),
      'Efficiency': this.formatPercentage(o.metrics?.performance?.efficiency?.percentage ?? 0),
      operatorId: o.operator?.id
    }));
    this.updateSummaryCards();
  }

  private updateItems(data:any){
    const arr = Array.isArray(data) ? data : (data?.items ?? []);
    this.rawItemData = arr;
    this.itemRows = arr.filter((x:any)=>(x.count ?? 0)>0)
      .map((x:any)=>({
        'Item Name': x.itemName,
        'Total Count': x.count,
        'Efficiency': this.formatPercentage(x.efficiency ?? 0)
      }));
  }

  onSummaryCardDrop(event: CdkDragDrop<SummaryCard[]>): void {
    if (!this.layoutEditing || event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.summaryCards, event.previousIndex, event.currentIndex);
    const visibleIds = this.summaryCards.map((card) => card.id);
    const hiddenIds = this.getSummaryCardOrder().filter((id) => !visibleIds.includes(id));
    this.summaryCardOrder = this.cleanSummaryCardOrder([...visibleIds, ...hiddenIds]);
    this.allSummaryCards = this.applySummaryCardOrder(this.allSummaryCards);
    this.layoutEditService.markEditsMade();
  }

  openSummaryCardVisibilityDialog(): void {
    const dialogRef = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '900px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
      data: {
        cards: this.getSummaryCardVisibilityOptions(),
        visibility: this.summaryCardVisibility,
        title: 'Summary Dashboard Infoboxes',
        description: 'Choose machine and operator infoboxes for this dashboard.',
        dragDropEnabled: true,
      },
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: SummaryCardVisibilityDialogResult | undefined) => {
        if (!result) return;
        this.summaryCardOrder = this.cleanSummaryCardOrder(result.order);
        this.summaryCardVisibility = this.cleanSummaryCardVisibility(result.visibility);
        this.syncSummaryCardsFromAll();
        this.layoutEditService.markEditsMade();
      });
  }

  private updateSummaryCards(): void {
    const machines = this.rawMachineData.filter((record) => !record?.isDummy);
    const operators = this.rawOperatorData.filter((record) => !record?.isDummy);
    const machineCounts = calculateMachineStatusCounts(machines);
    const operatorCounts = calculateOperatorStatusCounts(
      operators,
      Number(this.idleOperatorSummary?.idleOperators || 0)
    );

    const machineRuntimeMs = this.sumDuration(machines, ['runtime']);
    const machinePausedMs = this.sumDuration(machines, ['pausedTime']);
    const machineFaultMs = this.sumDuration(machines, ['faultTime']);
    const machineDownMs = this.sumDuration(machines, ['downTime', 'downtime']);
    const operatorRuntimeMs = this.sumDuration(operators, ['runtime', 'workedTime']);
    const operatorPausedMs = this.sumDuration(operators, ['pausedTime']);
    const operatorFaultMs = this.sumDuration(operators, ['faultTime']);
    const operatorDownMs = this.sumDuration(operators, ['downTime', 'downtime']);
    const machineTotalCount = this.sumTotalCount(machines);
    const operatorTotalCount = this.sumTotalCount(operators);
    const machineConnected = machines.filter(hasConnectedActivity);
    const operatorConnected = operators.filter(hasConnectedActivity);
    const elapsedHours = this.getElapsedHours();
    const projectionHours = this.getProjectionWindowHours(elapsedHours);
    const machinePace = elapsedHours > 0 ? Math.round(machineTotalCount / elapsedHours) : 0;
    const machineProjectedCount = this.getProjectedCount(machineTotalCount, elapsedHours, projectionHours);
    const operatorProjectedCount = this.getProjectedCount(operatorTotalCount, elapsedHours, projectionHours);
    const selectedShift = Boolean(this.dateTimeService.getShiftId());

    const machineAverage = (metric: 'availability' | 'throughput' | 'efficiency' | 'oee') =>
      this.averagePercent(machineConnected.map((record) => this.performancePercent(record, metric)));
    const operatorAverage = (metric: 'availability' | 'throughput' | 'efficiency' | 'oee') =>
      this.averagePercent(operatorConnected.map((record) => this.performancePercent(record, metric)));

    const cards: SummaryCard[] = [
      this.card('machine.machines', 'Machines', machineCounts.total, 'precision_manufacturing', 'neutral'),
      this.card('machine.running', 'Running Machines', machineCounts.running, 'play_circle', 'good'),
      this.card('machine.paused', 'Paused Machines', machineCounts.paused, 'pause_circle', machineCounts.paused ? 'warn' : 'neutral'),
      this.card('machine.faulted', 'Faulted Machines', machineCounts.faulted, 'warning', machineCounts.faulted ? 'bad' : 'neutral'),
      this.card('machine.offline', 'Offline Machines', machineCounts.offline, 'cloud_off', machineCounts.offline ? 'warn' : 'neutral'),
      this.card('machine.idlePaused', 'Idle/Paused Machines', machineCounts.idlePaused, 'motion_photos_paused', machineCounts.idlePaused ? 'warn' : 'neutral'),
      this.card('machine.down', 'Down Machines', machineCounts.down, 'do_not_disturb_on', machineCounts.down ? 'warn' : 'neutral'),
      this.card('operator.operators', 'Operators', operatorCounts.total, 'groups', 'neutral'),
      this.card('operator.assigned', 'Assigned Operators', operatorCounts.assigned, 'assignment_ind', 'neutral'),
      this.card('operator.running', 'Running Operators', operatorCounts.running, 'play_circle', 'good'),
      this.card('operator.paused', 'Paused Operators', operatorCounts.paused, 'pause_circle', operatorCounts.paused ? 'warn' : 'neutral'),
      this.card('operator.faulted', 'Faulted Operators', operatorCounts.faulted, 'warning', operatorCounts.faulted ? 'bad' : 'neutral'),
      this.card('operator.idle', 'Idle Operators', operatorCounts.idle, 'person_off', operatorCounts.idle ? 'warn' : 'good'),
      this.card('operator.idlePaused', 'Idle/Paused Operators', operatorCounts.idlePaused, 'person_off', operatorCounts.idlePaused ? 'warn' : 'neutral'),
      this.card('operator.down', 'Down Operators', operatorCounts.down, 'do_not_disturb_on', operatorCounts.down ? 'warn' : 'neutral'),
      this.card('machine.faultTime', 'Machine Fault Time', this.formatMilliseconds(machineFaultMs), 'timer_off', machineFaultMs ? 'bad' : 'neutral'),
      this.card('machine.avgFaultTime', 'Avg Machine Fault Time', this.formatAverageDuration(machineFaultMs, machines.length), 'timer_off', machineFaultMs ? 'bad' : 'neutral'),
      this.card('machine.runTime', 'Machine Run Time', this.formatMilliseconds(machineRuntimeMs), 'timer', machineRuntimeMs ? 'good' : 'neutral'),
      this.card('machine.avgWorkedTime', 'Avg Machine Worked Time', this.formatAverageDuration(machineRuntimeMs, machines.length), 'timer', machineRuntimeMs ? 'good' : 'neutral'),
      this.card('machine.pausedTime', 'Machine Paused Time', this.formatMilliseconds(machinePausedMs), 'pause_circle', machinePausedMs ? 'warn' : 'neutral'),
      this.card('machine.avgPausedTime', 'Avg Machine Paused Time', this.formatAverageDuration(machinePausedMs, machines.length), 'pause_circle', machinePausedMs ? 'warn' : 'neutral'),
      this.card('machine.downTime', 'Machine Down Time', this.formatMilliseconds(machineDownMs), 'timer_off', machineDownMs ? 'bad' : 'neutral'),
      this.card('machine.avgDownTime', 'Avg Machine Down Time', this.formatAverageDuration(machineDownMs, machines.length), 'timer_off', machineDownMs ? 'bad' : 'neutral'),
      this.card('machine.totalCount', 'Machine Total Count', machineTotalCount.toLocaleString(), 'tag', 'neutral'),
      this.card('machine.currentPace', 'Machine Current Pace', `${machinePace.toLocaleString()} PPH`, 'trending_up', machinePace ? 'good' : 'warn'),
      this.card('machine.shift', 'Shift', selectedShift ? 'Selected Shift' : 'All Day', 'schedule', 'neutral'),
      this.card('machine.projectedAllDay', 'Machine Projected Count (All Day)', selectedShift ? 'N/A' : machineProjectedCount.toLocaleString(), 'flag', !selectedShift && machineProjectedCount >= machineTotalCount ? 'good' : 'neutral'),
      this.card('machine.projectedShift', 'Machine Projected Count (Shift)', selectedShift ? machineProjectedCount.toLocaleString() : 'N/A', 'outlined_flag', selectedShift && machineProjectedCount >= machineTotalCount ? 'good' : 'neutral'),
      this.percentCard('machine.avgAvailability', 'Avg Machine Availability', machineAverage('availability'), 'event_available'),
      this.percentCard('machine.avgThroughput', 'Avg Machine Throughput', machineAverage('throughput'), 'trending_up'),
      this.percentCard('machine.avgEfficiency', 'Avg Machine Efficiency', machineAverage('efficiency'), 'speed'),
      this.percentCard('machine.avgOee', 'Avg Machine OEE', machineAverage('oee'), 'speed', true),
      this.card('operator.faultTime', 'Operator Fault Time', this.formatMilliseconds(operatorFaultMs), 'timer_off', operatorFaultMs ? 'bad' : 'neutral'),
      this.card('operator.avgFaultTime', 'Avg Operator Fault Time', this.formatAverageDuration(operatorFaultMs, operators.length), 'timer_off', operatorFaultMs ? 'bad' : 'neutral'),
      this.card('operator.workedTime', 'Operator Worked Time', this.formatMilliseconds(operatorRuntimeMs), 'timer', operatorRuntimeMs ? 'good' : 'neutral'),
      this.card('operator.avgWorkedTime', 'Avg Operator Worked Time', this.formatAverageDuration(operatorRuntimeMs, operators.length), 'timer', operatorRuntimeMs ? 'good' : 'neutral'),
      this.card('operator.pausedTime', 'Operator Paused Time', this.formatMilliseconds(operatorPausedMs), 'pause_circle', operatorPausedMs ? 'warn' : 'neutral'),
      this.card('operator.avgPausedTime', 'Avg Operator Paused Time', this.formatAverageDuration(operatorPausedMs, operators.length), 'pause_circle', operatorPausedMs ? 'warn' : 'neutral'),
      this.card('operator.downTime', 'Operator Down Time', this.formatMilliseconds(operatorDownMs), 'timer_off', operatorDownMs ? 'bad' : 'neutral'),
      this.card('operator.avgDownTime', 'Avg Operator Down Time', this.formatAverageDuration(operatorDownMs, operators.length), 'timer_off', operatorDownMs ? 'bad' : 'neutral'),
      this.card('operator.totalCount', 'Operator Total Count', operatorTotalCount.toLocaleString(), 'tag', 'neutral'),
      this.card('operator.projectedCount', 'Operator Projected Count', operatorProjectedCount.toLocaleString(), 'flag', operatorProjectedCount >= operatorTotalCount ? 'good' : 'neutral'),
      this.percentCard('operator.avgAvailability', 'Avg Operator Availability', operatorAverage('availability'), 'event_available'),
      this.percentCard('operator.avgThroughput', 'Avg Operator Throughput', operatorAverage('throughput'), 'trending_up'),
      this.percentCard('operator.avgEfficiency', 'Avg Operator Efficiency', operatorAverage('efficiency'), 'speed'),
      this.percentCard('operator.avgOee', 'Avg Operator OEE', operatorAverage('oee'), 'speed', true),
    ];

    this.allSummaryCards = this.applySummaryCardOrder(cards);
    this.syncSummaryCardsFromAll();
  }

  private card(id: string, label: string, value: string | number, icon: string, tone: string): SummaryCard {
    return { id, label, value, icon, tone };
  }

  private percentCard(id: string, label: string, value: number, icon: string, oee = false): SummaryCard {
    return this.card(id, label, `${value}%`, icon, oee ? this.getOeeSummaryTone(value) : this.getPercentSummaryTone(value));
  }

  private sumDuration(records: any[], keys: string[]): number {
    return records.reduce((sum, record) => sum + this.durationTotal(record, keys), 0);
  }

  private durationTotal(record: any, keys: string[]): number {
    for (const key of keys) {
      const value = record?.metrics?.[key]?.total ?? record?.performance?.[key]?.total;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return 0;
  }

  private sumTotalCount(records: any[]): number {
    return records.reduce((sum, record) => {
      const value = record?.metrics?.output?.totalCount ?? record?.performance?.output?.totalCount ?? 0;
      return sum + (Number(value) || 0);
    }, 0);
  }

  private performancePercent(record: any, metric: string): number {
    const value = record?.metrics?.performance?.[metric]?.percentage ?? record?.performance?.[metric]?.percentage;
    const numeric = Number(typeof value === 'string' ? value.replace('%', '') : value);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  private averagePercent(values: number[]): number {
    const valid = values.filter(Number.isFinite);
    return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
  }

  private formatMilliseconds(totalMs: number): string {
    return formatDurationMilliseconds(totalMs);
  }

  private formatAverageDuration(totalMs: number, count: number): string {
    return this.formatMilliseconds(count > 0 ? totalMs / count : 0);
  }

  private getPercentSummaryTone(value: unknown): 'good' | 'warn' | 'bad' {
    const color = this.percentBreakpointService.getDashboardColor(value);
    return color === 'green' ? 'good' : color === 'orange' ? 'warn' : 'bad';
  }

  private getOeeSummaryTone(value: unknown): 'good' | 'warn' | 'bad' {
    const color = this.percentBreakpointService.getOeDashboardColor(value);
    return color === 'green' ? 'good' : color === 'orange' ? 'warn' : 'bad';
  }

  private getElapsedHours(): number {
    const start = new Date(this.startTime).getTime();
    const end = new Date(this.endTime).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 36e5 : 0;
  }

  private getProjectionWindowHours(elapsedHours: number): number {
    const start = new Date(this.startTime);
    const end = new Date(this.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return elapsedHours;
    const projectionEnd = new Date(end);
    projectionEnd.setHours(23, 59, 59, 999);
    return Math.max(elapsedHours, (projectionEnd.getTime() - start.getTime()) / 36e5);
  }

  private getProjectedCount(totalCount: number, elapsedHours: number, projectionHours: number): number {
    if (elapsedHours <= 0 || projectionHours <= 0) return totalCount;
    return Math.round((totalCount / elapsedHours) * Math.max(elapsedHours, projectionHours));
  }

  private applySummaryCardOrder(cards: SummaryCard[]): SummaryCard[] {
    const byId = new Map(cards.map((card) => [card.id, card]));
    const ordered = this.summaryCardOrder.map((id) => byId.get(id)).filter((card): card is SummaryCard => Boolean(card));
    return [...ordered, ...cards.filter((card) => !this.summaryCardOrder.includes(card.id))];
  }

  private syncSummaryCardsFromAll(): void {
    this.allSummaryCards = this.applySummaryCardOrder(this.allSummaryCards);
    this.summaryCards = this.allSummaryCards.filter((card) => this.summaryCardVisibility[card.id] !== false);
  }

  private getSummaryCardVisibilityOptions(): SummaryCardVisibilityOption[] {
    return this.allSummaryCards.map((card) => ({
      id: card.id,
      label: card.label,
      icon: card.icon,
      value: card.value,
      tone: card.tone,
    }));
  }

  private getSummaryCardOrder(): string[] {
    return this.allSummaryCards.length ? this.allSummaryCards.map((card) => card.id) : this.summaryCardOrder;
  }

  private cleanSummaryCardOrder(order: string[] = []): string[] {
    const allowed = new Set(this.summaryCardIds);
    const unique = [...new Set(order.filter((id) => typeof id === 'string' && allowed.has(id)))];
    return [...unique, ...this.summaryCardIds.filter((id) => !unique.includes(id))];
  }

  private cleanSummaryCardVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    return this.summaryCardIds.reduce((cleaned, id) => {
      cleaned[id] = typeof visibility[id] === 'boolean'
        ? visibility[id]
        : this.defaultVisibleSummaryCardIds.has(id);
      return cleaned;
    }, {} as Record<string, boolean>);
  }

  private loadInitialSummaryCardLayout(): void {
    try {
      const order = JSON.parse(localStorage.getItem(this.summaryCardOrderKey) || '[]');
      const visibility = JSON.parse(localStorage.getItem(this.summaryCardVisibilityKey) || '{}');
      this.summaryCardOrder = this.cleanSummaryCardOrder(Array.isArray(order) ? order : []);
      this.summaryCardVisibility = this.cleanSummaryCardVisibility(visibility);
    } catch {
      this.resetSummaryCardLayout();
    }
  }

  private subscribeToUserPreferences(): void {
    this.settingsService.userPreferences$
      .pipe(takeUntil(this.destroy$))
      .subscribe((preferences) => {
        if (!preferences) return;
        const layout = preferences.dashboardLayouts?.summaryDashboard;
        if (!layout) {
          this.resetSummaryCardLayout();
          return;
        }
        this.summaryCardOrder = this.cleanSummaryCardOrder(layout.summaryCardOrder || []);
        this.summaryCardVisibility = this.cleanSummaryCardVisibility(layout.summaryCardVisibility || {});
        this.syncSummaryCardsFromAll();
      });
  }

  private subscribeToLayoutEditing(): void {
    this.layoutEditService.context$
      .pipe(takeUntil(this.destroy$))
      .subscribe((context) => {
        const nextEditing = context?.id === this.layoutContextId && context.editing;
        if (nextEditing && !this.layoutEditing) {
          this.layoutSnapshot = {
            summaryCardOrder: [...this.getSummaryCardOrder()],
            summaryCardVisibility: { ...this.summaryCardVisibility },
          };
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
      width: '460px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
    });
    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        if (result === 'save') this.saveSummaryCardLayout();
        if (result === 'discard') this.revertSummaryCardLayout();
      });
  }

  private saveSummaryCardLayout(): void {
    const order = this.getSummaryCardOrder();
    this.settingsService.setSummaryDashboardLayout(order, this.summaryCardVisibility);
    if (!this.userService.getToken()) {
      localStorage.setItem(this.summaryCardOrderKey, JSON.stringify(order));
      localStorage.setItem(this.summaryCardVisibilityKey, JSON.stringify(this.summaryCardVisibility));
      this.layoutEditService.setEditing(false);
      return;
    }
    this.settingsService.saveSummaryDashboardLayout(order, this.summaryCardVisibility).subscribe({
      next: () => {
        localStorage.removeItem(this.summaryCardOrderKey);
        localStorage.removeItem(this.summaryCardVisibilityKey);
        this.layoutSnapshot = null;
        this.layoutEditService.setEditing(false);
      },
      error: (error) => console.error('[SummaryDashboard] Failed to save layout preferences', error),
    });
  }

  private revertSummaryCardLayout(): void {
    if (this.layoutSnapshot) {
      this.summaryCardOrder = this.cleanSummaryCardOrder(this.layoutSnapshot.summaryCardOrder);
      this.summaryCardVisibility = this.cleanSummaryCardVisibility(this.layoutSnapshot.summaryCardVisibility);
      this.syncSummaryCardsFromAll();
    }
    this.layoutSnapshot = null;
    this.layoutEditService.setEditing(false);
  }

  private resetSummaryCardLayout(): void {
    this.summaryCardOrder = this.cleanSummaryCardOrder([]);
    this.summaryCardVisibility = this.cleanSummaryCardVisibility({});
    this.syncSummaryCardsFromAll();
  }

  fetchData(): Observable<any> {
    if (!this.startTime || !this.endTime) {
      return new Observable();
    }
  
    this.isLoading = true;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();
  
    return forkJoin({
      machines: this.dashboardService.getMachinesSummary(formattedStart, formattedEnd, undefined, this.dateTimeService.getShiftId()),
      operators: this.dashboardService.getOperatorsSummary(formattedStart, formattedEnd, this.dateTimeService.getShiftId()),
      items: this.dashboardService.getItemsSummary(formattedStart, formattedEnd, undefined, this.dateTimeService.getShiftId()),
      idleOperators: this.operatorService
        .getIdleOperatorSummary(formattedStart, formattedEnd, this.dateTimeService.getShiftId())
        .pipe(catchError(() => of(null))),
    }).pipe(
      takeUntil(this.destroy$),
      tap({
        next: ({machines, operators, items, idleOperators}) => {
          this.idleOperatorSummary = idleOperators;
          this.updateMachines(machines);
          this.updateOperators(operators);
          this.updateItems(items);
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          console.error('Error fetching summary data:', err);
          this.clearData();
          this.isLoading = false;
        }
      }),
      delay(0)
    );
  }

  onDateChange(): void {
    this.dateTimeService.setStartTime(this.startTime);
    this.dateTimeService.setEndTime(this.endTime);
    this.dateTimeService.setLiveMode(false);
    this.stopPolling();
    this.clearData();
  }

  getPercentageSafe(value: any): string {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return '0%';
    return `${(num * 100).toFixed(2)}%`;
  }

  private formatDurationForTable(duration: any): string {
    if (duration?.total != null) return formatDurationMilliseconds(duration.total);
    return formatDurationParts(duration?.formatted ?? duration);
  }

  private formatOperatorName(name: any): string {
    if (typeof name === 'string' && name.trim()) return name.trim();
    if (name && typeof name === 'object') {
      const formatted = `${name.first ?? ''} ${name.surname ?? ''}`.trim();
      if (formatted) return formatted;
    }
    return 'Unknown';
  }

  private formatPercentage(value: any): string {
    // Handle both number and string inputs
    // Backend returns percentage as a number (0-100) or string with '%'
    let num: number;
    if (typeof value === 'number') {
      num = value;
    } else if (typeof value === 'string') {
      // Remove '%' if present and parse
      num = parseFloat(value.replace('%', ''));
    } else {
      num = 0;
    }
    
    if (isNaN(num)) return '0%';
    
    const percentage = Math.max(0, num);
    return `${percentage.toFixed(2)}%`;
  }
  
  
  

  onMachineClick(row: any): void {
    if (this.selectedRow === row) {
      this.selectedRow = null;
      return;
    }
  
    this.selectedRow = row;
  
    const serial = row.serial;
    const fullMachineData = this.rawMachineData.find((m: any) => m.machine?.serial === serial);
    if (!fullMachineData) {
      console.warn('Machine data not found for serial:', serial);
      return;
    }
  
    // Fetch full machine details to get operatorEfficiency data
    // The cached /machines endpoint returns empty operatorEfficiency arrays
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();
    
    this.machineService.getMachineDetails(formattedStart, formattedEnd, serial, this.dateTimeService.getShiftId())
      .subscribe({
        next: (machineDetails: any) => {
          // machineDetails is an array, get the first item
          const machineData = Array.isArray(machineDetails) ? machineDetails[0] : machineDetails;
          
          // Use operatorEfficiency from the detailed API call, fallback to cached data
          const operatorEfficiency = machineData?.operatorEfficiency ?? fullMachineData.operatorEfficiency ?? [];
          const faultSummaries = machineData?.faultData?.faultSummaries ?? fullMachineData.faultData?.faultSummaries ?? [];
          const faultCycles = machineData?.faultData?.faultCycles ?? fullMachineData.faultData?.faultCycles ?? [];
          const itemHourlyStack = machineData?.itemHourlyStack ?? fullMachineData.itemHourlyStack;
          
          const carouselTabs = [
            {
              label: 'Item Stacked Chart',
              component: MachineItemStackedBarChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial: serial,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                preloadedData: itemHourlyStack,
                showLegend: true,
                legendPosition: 'right'
              }
            },
            {
              label: 'Fault Summaries',
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: 'summary',
                mode: 'dashboard',
                preloadedData: faultSummaries,
                isModal: this.isModal,
                startTime: this.startTime,
                endTime: this.endTime,
                serial: serial.toString()
              }
            },
            {
              label: 'Fault Cycles',
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: 'cycles',
                mode: 'dashboard',
                preloadedData: faultCycles,
                isModal: this.isModal,
                startTime: this.startTime,
                endTime: this.endTime,
                serial: serial.toString()
              }
            },
            {
              label: 'Performance Chart',
              component: OperatorPerformanceChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial: serial,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                preloadedData: {
                  machine: {
                    serial: serial,
                    name: machineData?.machine?.name ?? fullMachineData.machine?.name ?? 'Unknown'
                  },
                  timeRange: {
                    start: this.startTime,
                    end: this.endTime
                  },
                  hourlyData: operatorEfficiency
                }
              }
            }
          ];
        
          const dialogRef = this.dialog.open(ModalWrapperComponent, {
            width: '95vw',
            height: '90vh',
            maxHeight: '90vh',
            maxWidth: '95vw',
            panelClass: 'performance-chart-dialog',
            data: {
              component: UseCarouselComponent,
              componentInputs: {
                tabData: carouselTabs
              },
              machineSerial: serial,
              startTime: this.startTime,
              endTime: this.endTime
            }
          });
        
          dialogRef.afterClosed().subscribe(() => {
            if (this.selectedRow === row) {
              this.selectedRow = null;
            }
          });
        },
        error: (err: unknown) => {
          console.error('Error fetching machine details:', err);
          // Fallback to using cached data even if it's empty
          const faultSummaries = fullMachineData.faultData?.faultSummaries || [];
          const faultCycles = fullMachineData.faultData?.faultCycles || [];
          
          const carouselTabs = [
            {
              label: 'Item Stacked Chart',
              component: MachineItemStackedBarChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial: serial,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                preloadedData: fullMachineData.itemHourlyStack,
                showLegend: true,
                legendPosition: 'right'
              }
            },
            {
              label: 'Fault Summaries',
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: 'summary',
                mode: 'dashboard',
                preloadedData: faultSummaries,
                isModal: this.isModal,
                startTime: this.startTime,
                endTime: this.endTime,
                serial: serial.toString()
              }
            },
            {
              label: 'Fault Cycles',
              component: MachineFaultHistoryComponent,
              componentInputs: {
                viewType: 'cycles',
                mode: 'dashboard',
                preloadedData: faultCycles,
                isModal: this.isModal,
                startTime: this.startTime,
                endTime: this.endTime,
                serial: serial.toString()
              }
            },
            {
              label: 'Performance Chart',
              component: OperatorPerformanceChartComponent,
              componentInputs: {
                startTime: this.startTime,
                endTime: this.endTime,
                machineSerial: serial,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                preloadedData: {
                  machine: {
                    serial: serial,
                    name: fullMachineData.machine?.name ?? 'Unknown'
                  },
                  timeRange: {
                    start: this.startTime,
                    end: this.endTime
                  },
                  hourlyData: fullMachineData.operatorEfficiency ?? []
                }
              }
            }
          ];
        
          const dialogRef = this.dialog.open(ModalWrapperComponent, {
            width: '95vw',
            height: '90vh',
            maxHeight: '90vh',
            maxWidth: '95vw',
            panelClass: 'performance-chart-dialog',
            data: {
              component: UseCarouselComponent,
              componentInputs: {
                tabData: carouselTabs
              },
              machineSerial: serial,
              startTime: this.startTime,
              endTime: this.endTime
            }
          });
        
          dialogRef.afterClosed().subscribe(() => {
            if (this.selectedRow === row) {
              this.selectedRow = null;
            }
          });
        }
      });
  }
  

  onOperatorClick(row: any): void {
    this.selectedOperator = row;
    
    const operatorId = row.operatorId;
    const fullOperatorData = this.rawOperatorData.find((o: any) => o.operator?.id === operatorId);
    
    // Fetch full operator details to get countByItem data
    // The cached /operators endpoint doesn't return countByItem
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();
    
    this.operatorService.getOperatorDetails(formattedStart, formattedEnd, operatorId)
      .subscribe({
        next: (operatorDetails: any) => {
          // Format operator name if it's an object
          let operatorName = 'Unknown';
          if (fullOperatorData?.operator?.name) {
            if (typeof fullOperatorData.operator.name === 'string') {
              operatorName = fullOperatorData.operator.name;
            } else if (fullOperatorData.operator.name.first || fullOperatorData.operator.name.surname) {
              operatorName = `${fullOperatorData.operator.name.first || ''} ${fullOperatorData.operator.name.surname || ''}`.trim();
            }
          }
          
          // Structure the data to match what the component expects
          // The component expects an array with operator object and countByItem
          const operatorData = {
            operator: {
              id: operatorId,
              name: operatorName // Use formatted string name
            },
            ...fullOperatorData,
            countByItem: operatorDetails.countByItem || fullOperatorData?.countByItem
          };
          
          const dialogRef = this.dialog.open(ModalWrapperComponent, {
            width: '95vw',
            height: '90vh',
            maxWidth: '95vw',
            maxHeight: '90vh',
            panelClass: 'performance-chart-dialog',
            data: {
              component: OperatorCountbyitemChartComponent,
              componentInputs: {
                operatorId: operatorId,
                startTime: this.startTime,
                endTime: this.endTime,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                dashboardData: [operatorData]
              }
            }
          });
        
          dialogRef.afterClosed().subscribe(() => {
            if (this.selectedOperator === row) {
              this.selectedOperator = null;
            }
          });
        },
        error: (err: unknown) => {
          console.error('Error fetching operator details:', err);
          // Fallback to using cached data even if it doesn't have countByItem
          const dialogRef = this.dialog.open(ModalWrapperComponent, {
            width: '95vw',
            height: '90vh',
            maxWidth: '95vw',
            maxHeight: '90vh',
            panelClass: 'performance-chart-dialog',
            data: {
              component: OperatorCountbyitemChartComponent,
              componentInputs: {
                operatorId: operatorId,
                startTime: this.startTime,
                endTime: this.endTime,
                chartWidth: this.chartWidth,
                chartHeight: this.chartHeight,
                isModal: this.isModal,
                mode: 'dashboard',
                dashboardData: fullOperatorData ? [fullOperatorData] : this.rawOperatorData
              }
            }
          });
        
          dialogRef.afterClosed().subscribe(() => {
            if (this.selectedOperator === row) {
              this.selectedOperator = null;
            }
          });
        }
      });
  }
  
  

  // getStatusDot(status: { code: number } | undefined | null): string {
  //   const code = status?.code;
  //   if (code === 1) return '🟢';       // Running
  //   if (code === 0) return '🟡';       // Paused
  //   if (typeof code === 'number' && code > 1) return '🔴'; // Faulted
  
  //   console.warn('Unknown status code:', status);
  //   return '⚪'; // Offline or unknown
  // }
  
  
  
  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  // Add this helper for dynamic color coding
  getPerformanceClass = (value: any, column?: string): string => {
    if (column !== 'OEE' && column !== 'Efficiency') return '';
    if (column === 'OEE') return this.percentBreakpointService.getOeColorClass(value);
    return this.percentBreakpointService.getColorClass(value);
  };

  private addDummyLoadingRows(): void {
    // Add dummy loading rows for machines
    this.machineRows = [
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Machine Name': '',
        'OEE': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Machine Name': '',
        'OEE': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Machine Name': '',
        'OEE': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Machine Name': '',
        'OEE': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Machine Name': '',
        'OEE': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
    ];

    // Add dummy loading rows for operators
    this.operatorRows = [
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Worked Time': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Worked Time': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Worked Time': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Worked Time': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        Status: '<div class="loading-spinner dummy-row">⏳</div>',
        'Operator Name': '',
        'Worked Time': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
    ];

    // Add dummy loading rows for items
    this.itemRows = [
      {
        'Item Name': '',
        'Total Count': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        'Efficiency': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
    ];
  }
}
