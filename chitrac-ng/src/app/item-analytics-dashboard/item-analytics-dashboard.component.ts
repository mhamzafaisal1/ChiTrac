import { Component, OnInit, OnDestroy, ElementRef, Renderer2, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil, tap, delay, Observable } from 'rxjs';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { ItemService } from '../services/item.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { displayInteger } from '../shared/utils/display-number';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { formatDurationParts } from '../shared/utils/duration-format';

import { toDateTimeLocalInput } from '../shared/utils/date-input';
import { ThemeService } from '../services/theme.service';
import { Subscription } from 'rxjs';
@Component({
    selector: 'app-item-analytics-dashboard',
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        BaseTableComponent
    ],
    templateUrl: './item-analytics-dashboard.component.html',
    styleUrl: './item-analytics-dashboard.component.scss'
})
export class ItemAnalyticsDashboardComponent implements OnInit, OnDestroy {
  private readonly theme = inject(ThemeService);
  startTime = '';
  endTime = '';
  rows: any[] = [];
  columns: string[] = [];
  columnTooltips: { [column: string]: string } = {
    'Worked Time': 'Amount of time item has been run across all machines.',
    Count: 'Amount of pieces fed for this item.',
    PPH: 'Pieces per hour for this item.',
    Standard: 'Goal pace for this item.',
    'Efficiency (%)': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  liveMode: boolean = false;
  private themeSubscription?: Subscription;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  // Computed getter for cleaner template logic
  get showOverlay(): boolean {
    return this.isLoading || this.rows.length === 0;
  }

  constructor(
    private itemService: ItemService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private cdr: ChangeDetectorRef,
    private percentBreakpointService: PercentBreakpointService
  ) {}

  ngOnInit(): void {

    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();
  
    if (!isLive && wasConfirmed) {
      this.isLoading = true;
      this.rows = [];
      this.cdr.detectChanges(); // Show overlay

      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();
      this.fetchItemAnalytics().subscribe();
    } else {
      this.dashboardTimeframeService.applyDefault().subscribe((selection) => {
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime = this.dateTimeService.getEndTime();
        this.dateTimeService.setLiveMode(selection.mode === 'current');
        if (selection.mode === 'shift') {
          this.isLoading = true;
          this.rows = [];
          this.fetchItemAnalytics().subscribe();
        }
      });
    }

    this.detectTheme();
    this.themeSubscription = this.theme.isDark$.subscribe(() => this.detectTheme());

    // Subscribe to live mode changes
    this.dateTimeService.liveMode$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isLive => {
      this.liveMode = isLive;
      if (isLive) {
        this.isLoading = true;
        this.rows = []; // Prevent table render flash
        this.cdr.detectChanges(); // Force overlay to show before fetch

        // Reset startTime to today at 00:00
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        this.startTime = toDateTimeLocalInput(start);
        this.dateTimeService.setStartTime(this.startTime);

        // Reset endTime to now
        this.endTime = this.pollingService.updateEndTimestampToNow();
        this.dateTimeService.setEndTime(this.endTime);

        // 🔥 Fix: defer fetchItemAnalytics to allow overlay to paint first
        setTimeout(() => {
          this.fetchItemAnalytics().subscribe();
          this.setupPolling();
        });
      } else {
        this.stopPolling();
        this.rows = [];
        this.isLoading = false;
      }
    });

    // Subscribe to confirm trigger
    this.dateTimeService.confirmTrigger$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.liveMode = false; // turn off polling
      this.stopPolling();

      // get times from the shared service
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime = this.dateTimeService.getEndTime();

      this.fetchItemAnalytics().subscribe(); // use them to fetch data
    });
  }

  ngOnDestroy(): void {
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  detectTheme(): void {
    const isDark = this.theme.isDark;
    this.isDarkTheme = isDark;

    const element = this.elRef.nativeElement;
  }

  private setupPolling(): void {
    if (this.liveMode) {
      // Setup polling for subsequent updates
      this.pollingSubscription = this.pollingService.poll(
        () => {
          this.endTime = this.pollingService.updateEndTimestampToNow();
          this.dateTimeService.setEndTime(this.endTime);
          return this.itemService.getItemAnalytics(this.startTime, this.endTime, this.dateTimeService.getShiftId())
            .pipe(
              tap((data: any[]) => {
                this.updateTableData(data);
              }),
              delay(0) // Force change detection cycle
            );
        },
        this.POLLING_INTERVAL,
        this.destroy$,
        false, // isModal
        false  // 👈 don't run immediately
      ).subscribe();
    }
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
  }

  private updateTableData(data: any[]): void {
    this.rows = data.map(row => {
      return {
        'Item Name': row.itemName,
        'Worked Time': formatDurationParts(row.workedTimeFormatted),
        'Count': row.count,
        'PPH': displayInteger(row.pph),
        'Standard': displayInteger(row.standard),
        'Efficiency (%)': `${row.efficiency ?? 0}%`
      };
    });        
    this.columns = Object.keys(this.rows[0]);
  }

  getEfficiencyClass = (value: any, column: string): string => {
    if (column === 'Efficiency (%)' && typeof value === 'string' && value.includes('%')) {
      return this.percentBreakpointService.getColorClass(value);
    }
    return '';
  };

  fetchItemAnalytics(): Observable<any> {
    if (!this.startTime || !this.endTime) {
      return new Observable();
    }

    // Set loading state
    this.isLoading = true;

    return this.itemService.getItemAnalytics(this.startTime, this.endTime, this.dateTimeService.getShiftId())
      .pipe(
        takeUntil(this.destroy$),
        tap({
          next: (data: any[]) => {
            this.updateTableData(data);
            this.isLoading = false;
            this.cdr.detectChanges();
          },
          error: (err) => {
            console.error('Failed to load item analytics', err);
            this.rows = [];
            this.isLoading = false;
            this.cdr.detectChanges();
          }
        }),
        delay(0) // Force change detection cycle
      );
  }

  onDateChange(): void {
    this.dateTimeService.setStartTime(this.startTime);
    this.dateTimeService.setEndTime(this.endTime);
    this.dateTimeService.setLiveMode(false);
    this.stopPolling();
    this.rows = [];
  }

}
