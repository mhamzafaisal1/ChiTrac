import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StackedBarChartComponent, StackedBarChartData } from '../../components/stacked-bar-chart/stacked-bar-chart.component';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { ChartDataService } from '../../services/chart-data.service';
import { Subject, Observable, of } from 'rxjs';
import { takeUntil, tap, delay, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-data-aware-item-stacked-chart',
  standalone: true,
  imports: [CommonModule, FormsModule, StackedBarChartComponent],
  templateUrl: './data-aware-item-stacked-chart.component.html',
  styleUrls: ['./data-aware-item-stacked-chart.component.scss']
})
export class DataAwareItemStackedChartComponent implements OnInit, OnDestroy, OnChanges {
  // required time range
  @Input() startDate = '';
  @Input() endDate = '';

  // optional filters
  @Input() serial?: number;        // machine serial
  @Input() operatorId?: number;    // operator id

  // ui
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;
  @Input() pollIntervalMs = 6000;

  // Manual input fields
  manualSerial: string = '';
  manualOperatorId: string = '';
  showManualControls = false;
  filtersSelected = false; // Track if user has selected filters

  chartData: StackedBarChartData | null = null;
  isDarkTheme = false;
  isLoading = false;
  hasInitialData = false;
  dummyMode = true;
  liveMode = false;

  private destroy$ = new Subject<void>();
  private pollingSub: any;

  private chartDataService = inject(ChartDataService);
  private pollingService = inject(PollingService);
  private dateTimeService = inject(DateTimeService);

  ngOnInit(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    new MutationObserver(() => {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
    }).observe(document.body, { attributes: true });

    // default [start,end] if not provided
    if (!this.startDate || !this.endDate) {
      const now = new Date();
      const start = new Date(); start.setHours(0, 0, 0, 0);
      this.startDate = this.toLocalInput(start);
      this.endDate = this.toLocalInput(now);
    }

    // Initialize manual input fields with current values
    if (this.serial) this.manualSerial = this.serial.toString();
    if (this.operatorId) this.manualOperatorId = this.operatorId.toString();

    // Check if filters are already provided via inputs
    this.filtersSelected = !!(this.serial || this.operatorId);
    
    // Only fetch data if filters are already selected
    if (this.filtersSelected) {
      this.fetchOnce().subscribe();
    } else {
      this.enterDummy();
    }

    // live toggle
    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((live: boolean) => {
        this.liveMode = live;
        if (live && this.filtersSelected) this.startLive(); else this.stopLive();
      });

    // confirm trigger
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPolling();
        this.enterDummy();
        this.startDate = this.dateTimeService.getStartTime();
        this.endDate = this.dateTimeService.getEndTime();
        // Only fetch if filters are selected
        if (this.filtersSelected) {
          this.fetchOnce().subscribe();
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Any of these changes means we should refetch
    if (changes['startDate'] || changes['endDate'] || changes['serial'] || changes['operatorId']) {
      if (this.startDate && this.endDate) {
        // Update manual input fields
        if (changes['serial']) this.manualSerial = this.serial?.toString() || '';
        if (changes['operatorId']) this.manualOperatorId = this.operatorId?.toString() || '';
        
        // Update filters selected state
        this.filtersSelected = !!(this.serial || this.operatorId);
        
        // Only fetch if filters are selected
        if (this.filtersSelected) {
          this.fetchOnce().subscribe();
        }
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  // ---- Manual Data Fetching ----
  toggleManualControls(): void {
    this.showManualControls = !this.showManualControls;
  }

  getData(): void {
    if (!this.startDate || !this.endDate) return;
    
    // Update the component inputs with manual values
    this.serial = this.manualSerial ? Number(this.manualSerial) : undefined;
    this.operatorId = this.manualOperatorId ? Number(this.manualOperatorId) : undefined;
    
    // Mark filters as selected
    this.filtersSelected = !!(this.serial || this.operatorId);
    
    // Fetch data with new parameters
    this.fetchOnce().subscribe({
      next: (res) => {
        // If data fetch is successful, start polling
        if (res && res.data && Array.isArray(res.data.hours) && res.data.operators) {
          this.startPollingAfterDataFetch();
        }
      },
      error: () => {
        // On error, don't start polling
        console.error('Failed to fetch data');
      }
    });
  }

  clearFilters(): void {
    this.manualSerial = '';
    this.manualOperatorId = '';
    this.serial = undefined;
    this.operatorId = undefined;
    this.filtersSelected = false;
    this.enterDummy();
    this.stopPolling(); // Stop any ongoing polling
  }

  // ---- live polling ----
  private startLive(): void {
    // Only start live mode if filters are selected
    if (!this.filtersSelected) return;
    
    this.enterDummy();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startDate = this.toLocalInput(start);
    this.endDate = this.pollingService.updateEndTimestampToNow();
    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private setupPolling(): void {
    // Only setup polling if filters are selected
    if (!this.filtersSelected) return;
    
    this.stopPolling();
    this.pollingSub = this.pollingService
      .poll(
        () => {
          this.endDate = this.pollingService.updateEndTimestampToNow();
          return this.fetchOnce();
        },
        this.pollIntervalMs,
        this.destroy$,
        false,
        false
      )
      .subscribe({ error: () => this.stopPolling() });
  }

  private startPollingAfterDataFetch(): void {
    // Start polling after successful data fetch
    if (this.filtersSelected) {
      this.setupPolling();
    }
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.chartData = null;
    this.enterDummy();
  }

  private stopPolling(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
  }

  // ---- data ----
  private fetchOnce(): Observable<any> {
    if (!this.startDate || !this.endDate || !this.filtersSelected) return of(null);
    this.isLoading = true;
    return this.callApi(this.startDate, this.endDate, this.serial, this.operatorId)
      .pipe(
        tap(res => this.consumeResponse(res)),
        catchError(() => { this.enterDummy(); return of(null); }),
        delay(0)
      );
  }

  private callApi(startISO: string, endISO: string, serial?: number, operatorId?: number) {
    // Convert local datetime strings to ISO strings for the API
    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    
    return this.chartDataService.getItemStackedByHour(
      startDate.toISOString(),
      endDate.toISOString(),
      operatorId,
      serial
    );
  }

  private consumeResponse(res: any): void {
    if (res && res.data && Array.isArray(res.data.hours) && res.data.operators) {
      const transformed: StackedBarChartData = {
        title: res.title || 'Item Stacked Count Chart',
        data: {
          hours: res.data.hours,
          operators: res.data.operators
        }
      };
      this.chartData = transformed;
      this.hasInitialData = true;
      this.isLoading = false;
      this.dummyMode = false;
    } else {
      this.enterDummy();
    }
  }

  // ---- utils ----
  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartData = null;
  }

  private toLocalInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
