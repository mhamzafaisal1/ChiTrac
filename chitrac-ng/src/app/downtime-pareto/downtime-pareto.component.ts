import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, delay, takeUntil, tap } from 'rxjs/operators';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { DateTimeService } from '../services/date-time.service';
import { PollingService } from '../services/polling-service.service';

interface ParetoRow {
  fault: string;
  count: number;
  seconds: number;
  duration: string;
  share: number;
  cumulative: number;
}

@Component({
  selector: 'app-downtime-pareto',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './downtime-pareto.component.html',
  styleUrl: './downtime-pareto.component.scss',
})
export class DowntimeParetoComponent implements OnInit, OnDestroy {
  startTime = '';
  endTime = '';
  isLoading = false;
  isDarkTheme = false;
  rows: ParetoRow[] = [];
  totalDuration = 0;
  totalCount = 0;
  private observer!: MutationObserver;
  private destroy$ = new Subject<void>();
  private pollingSubscription: Subscription | null = null;
  private readonly pollingIntervalMs = 60000;

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private pollingService: PollingService
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.subscribeToTimeframePicker();
    this.initializeTimeframe();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  fetchData(): void {
    if (!this.startTime || !this.endTime) return;
    this.isLoading = true;
    this.loadParetoData().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.processRows(response?.summaries || []);
        this.isLoading = false;
      },
      error: () => {
        this.clearRows();
        this.isLoading = false;
      },
    });
  }

  refreshData(): void {
    if (this.dateTimeService.getLiveMode()) this.updateLiveEndTime();
    this.fetchData();
  }

  private processRows(summaries: any[]): void {
    const sorted = summaries
      .map((summary) => ({
        fault: summary.code == null ? summary.name || 'Fault' : `${summary.name || 'Fault'} (${summary.code})`,
        count: Number(summary.count || 0),
        seconds: Number(summary.totalDurationSeconds || 0),
      }))
      .filter((row) => row.seconds > 0 || row.count > 0)
      .sort((a, b) => b.seconds - a.seconds || b.count - a.count);

    this.totalDuration = sorted.reduce((sum, row) => sum + row.seconds, 0);
    this.totalCount = sorted.reduce((sum, row) => sum + row.count, 0);
    let running = 0;
    this.rows = sorted.map((row) => {
      running += row.seconds;
      return {
        ...row,
        duration: this.formatDuration(row.seconds),
        share: this.totalDuration ? Math.round((row.seconds / this.totalDuration) * 100) : 0,
        cumulative: this.totalDuration ? Math.round((running / this.totalDuration) * 100) : 0,
      };
    });
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  private subscribeToTimeframePicker(): void {
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.stopPolling();
        this.syncTimeframeFromService();
        if (this.dateTimeService.getLiveMode()) {
          this.updateLiveEndTime();
          this.setupPolling();
        }
        this.fetchData();
      });
  }

  private initializeTimeframe(): void {
    if (this.dateTimeService.getConfirmed()) {
      this.syncTimeframeFromService();
      if (this.dateTimeService.getLiveMode()) {
        this.updateLiveEndTime();
        this.setupPolling();
      }
      this.fetchData();
      return;
    }

    this.dashboardTimeframeService.applyDefault()
      .pipe(takeUntil(this.destroy$))
      .subscribe((selection) => {
        this.syncTimeframeFromService();
        this.dateTimeService.setLiveMode(selection.mode === 'current');
        if (selection.mode === 'current') {
          this.updateLiveEndTime();
          this.setupPolling();
        }
        this.fetchData();
      });
  }

  private syncTimeframeFromService(): void {
    this.startTime = this.dateTimeService.getStartTime();
    this.endTime = this.dateTimeService.getEndTime();
  }

  private setupPolling(): void {
    this.stopPolling();
    this.pollingSubscription = this.pollingService.poll(
      () => {
        this.updateLiveEndTime();
        return this.loadParetoData().pipe(
          tap((response) => this.processRows(response?.summaries || [])),
          catchError((error) => {
            console.error('[DowntimePareto] Poll failed', error);
            return of(null);
          }),
          delay(0)
        );
      },
      this.pollingIntervalMs,
      this.destroy$,
      false,
      false
    ).subscribe();
  }

  private stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
  }

  private updateLiveEndTime(): void {
    this.endTime = new Date().toISOString();
    this.dateTimeService.setEndTime(this.endTime);
  }

  private loadParetoData() {
    return this.dailyDashboardService.getFaultReportSummary(
      new Date(this.startTime).toISOString(),
      new Date(this.endTime).toISOString()
    );
  }

  private clearRows(): void {
    this.rows = [];
    this.totalDuration = 0;
    this.totalCount = 0;
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
}
