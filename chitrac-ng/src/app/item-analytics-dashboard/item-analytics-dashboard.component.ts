import { Component, OnInit, OnDestroy, ElementRef, Renderer2, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil, tap, delay, Observable } from 'rxjs';

import { BaseTableComponent } from '../components/base-table/base-table.component';
import { ItemAnalyticsService } from '../services/item-analytics.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';

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
  startTime = '';
  endTime = '';
  rows: any[] = [];
  columns: string[] = [];
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  liveMode: boolean = false;
  private observer!: MutationObserver;
  private pollingSubscription: any;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  // Computed getter for cleaner template logic
  get showOverlay(): boolean {
    return this.isLoading || this.rows.length === 0;
  }

  constructor(
    private analyticsService: ItemAnalyticsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService,
    private cdr: ChangeDetectorRef
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
    }

    const now = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

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
        this.startTime = this.formatDateForInput(start);
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
    if (this.observer) {
      this.observer.disconnect();
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  detectTheme(): void {
    const isDark = document.body.classList.contains('dark-theme');
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
          return this.analyticsService.getItemAnalytics(this.startTime, this.endTime)
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
      const { hours = 0, minutes = 0 } = row.workedTimeFormatted || {};
      return {
        'Item Name': row.itemName,
        'Worked Time': `${hours}h ${minutes}m`,
        'Count': row.count,
        'PPH': row.pph,
        'Standard': row.standard,
        'Efficiency (%)': row.efficiency
      };
    });        
    this.columns = Object.keys(this.rows[0]);
  }

  fetchItemAnalytics(): Observable<any> {
    if (!this.startTime || !this.endTime) {
      return new Observable();
    }

    // Set loading state
    this.isLoading = true;

    return this.analyticsService.getItemAnalytics(this.startTime, this.endTime)
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

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
