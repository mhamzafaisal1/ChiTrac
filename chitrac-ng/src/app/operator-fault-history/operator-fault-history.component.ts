import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  Renderer2,
  Input,
  SimpleChanges,
  OnChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { Subject, tap, takeUntil, debounceTime } from 'rxjs';

import { BaseTableComponent } from '../components/base-table/base-table.component';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { FaultHistoryService } from '../services/fault-history.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';

@Component({
    selector: 'app-operator-fault-history',
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        BaseTableComponent,
        DateTimePickerComponent
    ],
    templateUrl: './operator-fault-history.component.html',
    styleUrls: ['./operator-fault-history.component.scss']
})
export class OperatorFaultHistoryComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() operatorId: string = '';
  @Input() isModal: boolean = false;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';

  private _viewType: 'summary' | 'cycles' = 'summary';
  @Input()
  set viewType(val: 'summary' | 'cycles') {
    this._viewType = val;
    if (this.hasFetchedOnce) this.updateTable();
  }
  get viewType() {
    return this._viewType;
  }

  columns: string[] = [];
  rows: any[] = [];
  selectedRow: any | null = null;
  isDarkTheme: boolean = false;
  hasFetchedOnce = false;
  liveMode: boolean = false;
  isLoading: boolean = false;
  error: string | null = null;

  lastFetchedData: any | null = null;
  lastParams: { startTime: string; endTime: string; operatorId: string } | null = null;
  private observer!: MutationObserver;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private fetchTrigger$ = new Subject<void>();

  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  constructor(
    private faultHistoryService: FaultHistoryService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.observeTheme();
  
    // Set up debounced fetch trigger
    this.fetchTrigger$.pipe(
      debounceTime(0), 
      takeUntil(this.destroy$)
    ).subscribe(() => this.checkAndFetch());
  
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
          
          // Set lastParams before fetching to prevent duplicate calls
          this.lastParams = { startTime: this.startTime, endTime: this.endTime, operatorId: this.operatorId };
          this.fetchData();
          this.setupPolling();
        } else {
          this.stopPolling();
          this.lastFetchedData = null;
          this.rows = [];
          this.columns = [];
        }
      });

    // Subscribe to confirm action
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false; // turn off polling
        this.stopPolling();

        // get times from the shared service
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        
        // Set lastParams before fetching to prevent duplicate calls
        this.lastParams = { startTime: this.startTime, endTime: this.endTime, operatorId: this.operatorId };
        this.fetchData(); // use them to fetch data
      });
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    // Handle viewType changes separately - just update table display
    if (changes['viewType'] && this.lastFetchedData) {
      console.log('ngOnChanges: viewType changed, updating table display only');
      this.updateTable();
      return;
    }

    // Handle other input changes that require API calls
    if (
      changes['startTime'] ||
      changes['endTime'] ||
      changes['operatorId']
    ) {
      console.log('ngOnChanges: Input parameters changed, triggering debounced fetch');
      this.fetchTrigger$.next();
    }
  }

  ngOnDestroy() {
    if (this.observer) this.observer.disconnect();
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private observeTheme() {
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
    const el = this.elRef.nativeElement;
  }

  private setupPolling(): void {
    if (this.liveMode) {
      this.pollingSubscription = this.pollingService
        .poll(
          () => {
            this.endTime = this.pollingService.updateEndTimestampToNow();

            return this.faultHistoryService
              .getFaultHistoryByOperator(
                this.startTime, 
                this.endTime, 
                parseInt(this.operatorId),
                this.viewType === 'summary' ? 'summaries' : 'cycles'
              )
              .pipe(
                tap((data: any) => {
                  this.hasFetchedOnce = true;
                  this.lastFetchedData = data;
                  this.updateTable();
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

  private checkAndFetch() {
    // Don't fetch if we don't have all required parameters
    if (!this.startTime || !this.endTime || !this.operatorId) {
      console.log('checkAndFetch: Missing required parameters, skipping fetch');
      return;
    }

    const currentParams = {
      startTime: this.startTime,
      endTime: this.endTime,
      operatorId: this.operatorId
    };

    // Only fetch if parameters have actually changed
    if (
      !this.lastParams ||
      this.lastParams.startTime !== currentParams.startTime ||
      this.lastParams.endTime !== currentParams.endTime ||
      this.lastParams.operatorId !== currentParams.operatorId
    ) {
      console.log('checkAndFetch: Parameters changed, fetching new data', {
        old: this.lastParams,
        new: currentParams
      });
      this.lastParams = currentParams;
      this.fetchData();
    } else {
      console.log('checkAndFetch: Parameters unchanged, skipping fetch');
    }
  }

  fetchData(): void {
    const operatorIdNum = parseInt(this.operatorId);
    if (isNaN(operatorIdNum)) {
      this.error = 'Invalid operator ID';
      this.rows = [];
      this.columns = [];
      return;
    }

    console.log('fetchData: Making API call', {
      startTime: this.startTime,
      endTime: this.endTime,
      operatorId: this.operatorId,
      viewType: this.viewType
    });

    this.error = null;
    this.isLoading = true;
    
    // Determine which data to include based on viewType
    const includeParam = this.viewType === 'summary' ? 'summaries' : 'cycles';
    
    this.faultHistoryService.getFaultHistoryByOperator(
      this.startTime, 
      this.endTime, 
      operatorIdNum,
      includeParam
    )
      .subscribe({
        next: (data) => {
          console.log('fetchData: API call successful', data);
          console.log('Debug: Fault summaries sample:', data.faultSummaries?.[0]);
          console.log('Debug: Fault cycles sample:', data.faultCycles?.[0]);
          this.hasFetchedOnce = true;
          this.lastFetchedData = data;
          this.updateTable();
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error fetching operator fault history:', error);
          this.error = 'Failed to fetch fault history. Please try again.';
          this.rows = [];
          this.columns = [];
          this.isLoading = false;
        }
      });
  }

  updateTable(): void {
    if (!this.lastFetchedData) return;

    if (this.viewType === 'summary') {
      // Process fault summaries (similar to machine fault history)
      this.rows = (this.lastFetchedData.faultSummaries || []).map((summary: any) => {
        // Backend already provides totalDurationSeconds in seconds, no need to divide by 1000
        const totalSeconds = summary.totalDurationSeconds;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        console.log('Debug: Processing summary:', {
          name: summary.name,
          totalDurationSeconds: summary.totalDurationSeconds,
          calculated: { hours, minutes, seconds }
        });

        // Format duration to show seconds when minutes are 0
        let duration;
        if (hours > 0) {
          duration = `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
          duration = `${minutes}m ${seconds}s`;
        } else {
          duration = `${seconds}s`;
        }

        return {
          'Fault Type': summary.name,
          'Count': summary.count,
          'Total Duration': duration
        };
      });
    } else {
      // Sort fault cycles by start time (latest first) for default sorting
      const sortedFaultCycles = (this.lastFetchedData.faultCycles || [])
        .sort((a: any, b: any) => new Date(b.start).getTime() - new Date(a.start).getTime());
      
      console.log('Debug: Processing fault cycles:', sortedFaultCycles);
      
      this.rows = sortedFaultCycles.map((cycle: any) => {
        console.log('Debug: Processing cycle:', {
          id: cycle.id,
          start: cycle.start,
          end: cycle.end,
          durationSeconds: cycle.durationSeconds,
          durationType: typeof cycle.durationSeconds,
          name: cycle.name
        });
        
        // Ensure durationSeconds is a valid number and handle edge cases
        const durationSeconds = cycle.durationSeconds || 0;
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        const seconds = durationSeconds % 60;
        
        // Format duration to show seconds when minutes are 0
        let duration;
        if (hours > 0) {
          duration = `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
          duration = `${minutes}m ${seconds}s`;
        } else {
          duration = `${seconds}s`;
        }
        
        return {
          'Fault Type': cycle.name,
          'Start Time': new Date(cycle.start).toLocaleString(),
          'Duration': duration
        };
      });
    }

    this.columns = this.rows.length > 0 ? Object.keys(this.rows[0]) : [];
  }

  onRowSelected(row: any): void {
    this.selectedRow = this.selectedRow === row ? null : row;
    setTimeout(() => {
      const element = document.querySelector('.mat-row.selected');
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
