import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, delay, takeUntil, tap } from 'rxjs/operators';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { DateTimeService } from '../services/date-time.service';
import { FaultService } from '../services/fault.service';
import { PollingService } from '../services/polling-service.service';
import { DashboardCacheScope, WebsocketService } from '../services/websocket.service';

import { ThemeService } from '../services/theme.service';
export type DowntimeCategory = 'fault' | 'paused' | 'offline';

const DOWNTIME_CATEGORIES: { key: DowntimeCategory; label: string }[] = [
  { key: 'fault', label: 'Faults' },
  { key: 'paused', label: 'Paused' },
  { key: 'offline', label: 'Offline' },
];
// Faults and paused are what Rob defined as downtime for this view; offline is
// available but off by default so idle overnight/weekend time does not swamp it.
const DEFAULT_CATEGORIES: DowntimeCategory[] = ['fault', 'paused'];
const CATEGORY_STORAGE_KEY = 'chitrac.downtimePareto.categories';

interface ParetoSource {
  category: DowntimeCategory;
  fault: string;
  machine: string;
  count: number;
  seconds: number;
}

interface ParetoRow {
  category: DowntimeCategory;
  fault: string;
  machine: string;
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
export class DowntimeParetoComponent implements OnInit, OnChanges, OnDestroy {
  private readonly theme = inject(ThemeService);
  @Input() startTime = '';
  @Input() endTime = '';
  @Input() serial: string | number | null = null;
  @Input() machineSerial: string | number | null = null;
  @Input() isModal = false;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';
  @Input() preloadedData: any | null = null;
  @Input() cacheScope: DashboardCacheScope | null = null;
  @Input() shiftId: string | null = null;

  isLoading = false;
  isDarkTheme = false;
  rows: ParetoRow[] = [];
  totalDuration = 0;
  totalCount = 0;
  readonly categoryOptions = DOWNTIME_CATEGORIES;
  enabledCategories = new Set<DowntimeCategory>(this.loadCategoryPreference());
  categoryTotals: Record<DowntimeCategory, number> = { fault: 0, paused: 0, offline: 0 };
  private sourceRows: ParetoSource[] = [];
  private themeSubscription?: Subscription;
  private destroy$ = new Subject<void>();
  private pollingSubscription: Subscription | null = null;
  private cacheSubscription: Subscription | null = null;
  private readonly pollingIntervalMs = 60000;

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private faultService: FaultService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private pollingService: PollingService,
    private websocketService: WebsocketService
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.themeSubscription = this.theme.isDark$.subscribe(() => this.detectTheme());

    if (this.isDashboardMode()) {
      this.loadModalData();
      this.subscribeToDashboardCache();
      return;
    }

    this.subscribeToTimeframePicker();
    this.initializeTimeframe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.isDashboardMode()) return;
    if (
      changes['preloadedData'] ||
      changes['startTime'] ||
      changes['endTime'] ||
      changes['serial'] ||
      changes['machineSerial'] ||
      changes['cacheScope'] ||
      changes['shiftId']
    ) {
      this.loadModalData();
      this.subscribeToDashboardCache();
    }
  }

  ngOnDestroy(): void {
    this.themeSubscription?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
    this.stopCacheSubscription();
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
    if (this.isDashboardMode()) {
      this.loadModalData();
      return;
    }

    if (this.dateTimeService.getLiveMode()) this.updateLiveEndTime();
    this.fetchData();
  }

  get showPageHeader(): boolean {
    return !this.isDashboardMode();
  }

  private loadModalData(): void {
    const summaries = this.extractSummaries(this.preloadedData);
    if (summaries) {
      this.processRows(summaries);
      return;
    }

    if (this.shouldUseCacheOnly()) {
      this.clearRows();
      return;
    }

    const machineSerial = this.getMachineSerial();
    if (!this.startTime || !this.endTime || machineSerial === null) {
      this.clearRows();
      return;
    }

    this.isLoading = true;
    this.dailyDashboardService.getDowntimeSummary(
      new Date(this.startTime).toISOString(),
      new Date(this.endTime).toISOString(),
      machineSerial
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
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

  private subscribeToDashboardCache(): void {
    if (!this.isDashboardMode()) return;

    this.stopCacheSubscription();
    const machineSerial = this.getMachineSerial();
    if (machineSerial === null) return;

    this.websocketService.connect();
    const scope = this.cacheScope || (this.dateTimeService.getShiftId() ? 'currentShift' : 'today');
    const shiftId = this.shiftId ?? this.dateTimeService.getShiftId();
    this.cacheSubscription = this.websocketService.machineDashboardData$(scope, shiftId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((machineRows) => {
        const machineRow = (machineRows || []).find(
          (row) => Number(row?.machine?.serial) === machineSerial
        );
        const summaries = this.extractSummaries(machineRow);
        if (!summaries) return;

        this.processRows(summaries);
        this.isLoading = false;
      });
  }

  private stopCacheSubscription(): void {
    this.cacheSubscription?.unsubscribe();
    this.cacheSubscription = null;
  }

  private extractSummaries(source: any): any[] | null {
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.downtimePareto?.summaries)) return source.downtimePareto.summaries;
    // Older payloads (pre paused/offline) only carried fault summaries.
    if (Array.isArray(source?.downtimePareto?.faultSummaries)) return source.downtimePareto.faultSummaries;
    if (Array.isArray(source?.faultData?.faultSummaries)) return source.faultData.faultSummaries;
    if (Array.isArray(source?.faultSummaries)) return source.faultSummaries;
    if (Array.isArray(source?.summaries)) return source.summaries;
    return null;
  }

  private shouldUseCacheOnly(): boolean {
    if (!this.isDashboardMode()) return false;
    if (this.dateTimeService.getLiveMode()) return true;
    return Boolean(this.cacheScope && this.isToday(this.startTime) && this.isToday(this.endTime));
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

  private processRows(summaries: any[]): void {
    const expanded = summaries.flatMap(summary => {
      if (!Array.isArray(summary.faults) || !summary.faults.length) return [summary];
      const machines = new Map<string, any>();
      for (const fault of summary.faults) {
        const serial = fault.machineSerial ?? 'unknown';
        const key = String(serial);
        const row = machines.get(key) || { ...summary, machineName: fault.machineName || `Machine ${serial}`, machineSerial: serial, count: 0, totalDurationSeconds: 0 };
        row.count++;
        row.totalDurationSeconds += Number(fault.durationSeconds || 0);
        machines.set(key, row);
      }
      return [...machines.values()];
    });
    this.sourceRows = expanded
      .map((summary): ParetoSource => {
        const category = this.categoryOf(summary);
        const name = summary.name || (category === 'fault' ? 'Fault' : category === 'paused' ? 'Paused' : 'Offline');
        return {
          category,
          machine: `${summary.machineName || ((this.serial ?? this.machineSerial) ? 'Machine' : 'All machines')}${summary.machineSerial != null ? ' · Serial ' + summary.machineSerial : (this.serial ?? this.machineSerial) ? ' · Serial ' + (this.serial ?? this.machineSerial) : ''}`,
          // Fault codes identify the alarm; paused/offline codes (0/-1) add nothing.
          fault: category === 'fault' && summary.code != null ? `${name} (${summary.code})` : name,
          count: Number(summary.count || 0),
          seconds: Number(summary.totalDurationSeconds || 0),
        };
      })
      .filter((row) => row.seconds > 0 || row.count > 0)
      .sort((a, b) => b.seconds - a.seconds || b.count - a.count);

    this.categoryTotals = { fault: 0, paused: 0, offline: 0 };
    for (const row of this.sourceRows) this.categoryTotals[row.category] += row.seconds;
    this.applyCategoryFilter();
  }

  isCategoryEnabled(category: DowntimeCategory): boolean {
    return this.enabledCategories.has(category);
  }

  toggleCategory(category: DowntimeCategory): void {
    const next = new Set(this.enabledCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    this.enabledCategories = next;
    this.saveCategoryPreference();
    this.applyCategoryFilter();
  }

  categoryLabel(category: DowntimeCategory): string {
    return DOWNTIME_CATEGORIES.find((option) => option.key === category)?.label ?? category;
  }

  private categoryOf(summary: any): DowntimeCategory {
    if (summary?.category === 'paused' || summary?.category === 'offline' || summary?.category === 'fault') {
      return summary.category;
    }
    const code = summary?.code;
    if (code === 0 || code === '0') return 'paused';
    if (code === -1 || code === '-1') return 'offline';
    return 'fault';
  }

  private applyCategoryFilter(): void {
    const sorted = this.sourceRows.filter((row) => this.enabledCategories.has(row.category));
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
    this.isDarkTheme = this.theme.isDark;
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

  private isDashboardMode(): boolean {
    return this.isModal || this.mode === 'dashboard';
  }

  private getMachineSerial(): number | null {
    const value = this.machineSerial ?? this.serial;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private updateLiveEndTime(): void {
    this.endTime = new Date().toISOString();
    this.dateTimeService.setEndTime(this.endTime);
  }

  private loadParetoData() {
    return this.dailyDashboardService.getDowntimeSummary(
      new Date(this.startTime).toISOString(),
      new Date(this.endTime).toISOString()
    );
  }

  private loadCategoryPreference(): DowntimeCategory[] {
    try {
      const stored = JSON.parse(localStorage.getItem(CATEGORY_STORAGE_KEY) || 'null');
      if (Array.isArray(stored)) {
        return stored.filter((key: string) => DOWNTIME_CATEGORIES.some((option) => option.key === key));
      }
    } catch {
      // Storage unavailable or malformed: fall back to the defaults.
    }
    return [...DEFAULT_CATEGORIES];
  }

  private saveCategoryPreference(): void {
    try {
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify([...this.enabledCategories]));
    } catch {
      // Not persisting is acceptable; the toggle still applies to this view.
    }
  }

  private clearRows(): void {
    this.sourceRows = [];
    this.categoryTotals = { fault: 0, paused: 0, offline: 0 };
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
