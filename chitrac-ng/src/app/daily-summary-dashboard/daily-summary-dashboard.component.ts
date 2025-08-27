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
import { Subject, takeUntil, tap, delay, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { UseCarouselComponent } from '../use-carousel/use-carousel.component';
import { MachineFaultHistoryComponent } from '../machine-fault-history/machine-fault-history.component';
import { OperatorPerformanceChartComponent } from '../operator-performance-chart/operator-performance-chart.component';
import { DateTimePickerComponent } from "../components/date-time-picker/date-time-picker.component";
import { BaseTableComponent } from "../components/base-table/base-table.component";

import { OperatorCountbyitemChartComponent } from "../operator-countbyitem-chart/operator-countbyitem-chart.component";
import { getStatusDotByCode } from '../../utils/status-utils';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';

@Component({
    selector: "app-daily-summary-dashboard",
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        DateTimePickerComponent,
        MatButtonModule,
        MatIconModule,
        MatSlideToggleModule,
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
  machineColumns: string[] = ["Status", "Machine Name", "OEE", "Total Count"];
  machineRows: any[] = [];
  selectedMachine: any = null;
  selectedRow: any | null = null;
  itemColumns: string[] = ['Item Name', 'Total Count'];
  itemRows: any[] = [];  
  operatorColumns: string[] = ['Status', 'Operator Name', 'Worked Time', 'Efficiency'];
  operatorRows: any[] = [];
  selectedOperator: any = null;
  liveMode: boolean = false;
  isLoading: boolean = false;
  rawMachineData: any[] = []; // store full API response for machines
  rawOperatorData: any[] = []; // store full API response for operators
  rawItemData: any[] = [];
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
    private dailyDashboardService: DailyDashboardService,
    private dialog: MatDialog,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    // Add dummy loading rows initially
    this.addDummyLoadingRows();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchData().subscribe();
    }

    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    this.endTime = this.formatDateForInput(end);
    this.startTime = this.formatDateForInput(start);

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
      () => { tick(); return this.dailyDashboardService
        .getMachinesSummary(this.startTime, this.endTime)
        .pipe(
          tap((r:any)=> this.updateMachines(r)),
          catchError(err => { console.error('machines poll', err); return of(null); }),
          delay(0)
        ); },
      this.POLLING_INTERVAL, this.destroy$, false, false).subscribe();

    this.operatorPollSub = this.pollingService.poll(
      () => { tick(); return this.dailyDashboardService
        .getOperatorsSummary(this.startTime, this.endTime)
        .pipe(
          tap((r:any)=> this.updateOperators(r)),
          catchError(err => { console.error('operators poll', err); return of(null); }),
          delay(0)
        ); },
      this.OP_POLL, this.destroy$, false, false).subscribe();

    this.itemPollSub = this.pollingService.poll(
      () => { tick(); return this.dailyDashboardService
        .getItemsSummary(this.startTime, this.endTime)
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
  }

  private updateMachines(data:any){ 
    const arr = Array.isArray(data) ? data : (data?.machineResults ?? []);
    this.rawMachineData = arr;
    this.machineRows = arr.map((m:any)=>({
      Status: getStatusDotByCode(m.currentStatus?.code),
      'Machine Name': m.machine?.name ?? 'Unknown',
      'OEE': m.performance?.performance?.oee?.percentage ?? '0%',
      'Total Count': m.performance?.output?.totalCount ?? 0,
      serial: m.machine?.serial
    }));
  }

  private updateOperators(data:any){
    const arr = Array.isArray(data) ? data : (data?.operatorResults ?? []);
    this.rawOperatorData = arr;
    this.operatorRows = arr.map((o:any)=>({
      Status: getStatusDotByCode(o.currentStatus?.code),
      'Operator Name': o.operator?.name ?? 'Unknown',
      'Worked Time': `${o.metrics?.runtime?.formatted?.hours ?? 0}h ${o.metrics?.runtime?.formatted?.minutes ?? 0}m`,
      'Efficiency': o.metrics?.performance?.efficiency?.percentage ?? '0%',
      operatorId: o.operator?.id
    }));
  }

  private updateItems(data:any){
    const arr = Array.isArray(data) ? data : (data?.items ?? []);
    this.rawItemData = arr;
    this.itemRows = arr.filter((x:any)=>(x.count ?? 0)>0)
      .map((x:any)=>({'Item Name': x.itemName, 'Total Count': x.count}));
  }

  fetchData(): Observable<any> {
    if (!this.startTime || !this.endTime) {
      return new Observable();
    }
  
    this.isLoading = true;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();
  
    return forkJoin({
      machines: this.dailyDashboardService.getMachinesSummary(formattedStart, formattedEnd),
      operators: this.dailyDashboardService.getOperatorsSummary(formattedStart, formattedEnd),
      items: this.dailyDashboardService.getItemsSummary(formattedStart, formattedEnd),
    }).pipe(
      takeUntil(this.destroy$),
      tap({
        next: ({machines, operators, items}) => {
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
  
    const faultSummaries = fullMachineData.faultData?.faultSummaries || [];
    const faultCycles = fullMachineData.faultData?.faultCycles || [];
  
    const carouselTabs = [
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
  

  onOperatorClick(row: any): void {
    this.selectedOperator = row;
    const dialogRef = this.dialog.open(ModalWrapperComponent, {
      width: '95vw',
      height: '90vh',
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: 'performance-chart-dialog',
      data: {
        component: OperatorCountbyitemChartComponent,
        componentInputs: {
          operatorId: row.operatorId,
          startTime: this.startTime,
          endTime: this.endTime,
          chartWidth: this.chartWidth,
          chartHeight: this.chartHeight,
          isModal: this.isModal,
          mode: 'dashboard',
          dashboardData: this.rawOperatorData
        }
      }
    });
  
    dialogRef.afterClosed().subscribe(() => {
      if (this.selectedOperator === row) {
        this.selectedOperator = null;
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
  getPerformanceClass(value: any, column?: string): string {
    if (column !== 'OEE' && column !== 'Efficiency') return '';
    let num = value;
    if (typeof value === 'string') {
      num = parseFloat(value.replace('%', ''));
    }
    if (isNaN(num)) return '';
    if (num >= 85) return 'green';
    if (num >= 60) return 'yellow';
    return 'red';
  }

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
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
      {
        'Item Name': '',
        'Total Count': '',
        isDummy: true,
        cssClass: "dummy-row", // CSS class for styling
      },
    ];
  }
}
