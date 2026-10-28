import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { SettingsService } from '../services/settings.service';
import { DisplayTimePipe } from '../pipes/display-time.pipe';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil } from 'rxjs';
import { DashboardService } from '../services/dashboard.service';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { DashboardCacheState, WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { getStatusDotByCode } from '../../utils/status-utils';

interface ActionAlert {
  severity: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  detail: string;
  meta: string;
}

interface InsightCard {
  label: string;
  value: string | number;
  detail: string;
  icon: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

interface UnusedStationsSummary {
  unusedStations: number;
  totalStations: number;
  loggedInOperators: number;
  activeMachines: number;
  updatedAt?: string | Date;
}

@Component({
  selector: 'app-action-center',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, DisplayTimePipe],
  templateUrl: './action-center.component.html',
  styleUrl: './action-center.component.scss',
})
export class ActionCenterComponent implements OnInit, OnDestroy {
  private readonly settings = inject(SettingsService);
  private readonly breakpoints = inject(PercentBreakpointService);
  cacheReady = false;
  faultsLoading = true;
  faultsError = '';
  private stationsLoading = true;
  websocketStatus: WebsocketConnectionStatus = 'disconnected';
  updatedAt: Date | null = null;
  alerts: ActionAlert[] = [];
  insightCards: InsightCard[] = [];
  topFaults: any[] = [];
  private unusedStationsSummary: UnusedStationsSummary | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private websocketService: WebsocketService,
    private dashboardService: DashboardService,
    private dailyDashboardService: DailyDashboardService
  ) {}

  ngOnInit(): void {
    this.settings.timeFormat$.pipe(takeUntil(this.destroy$)).subscribe(() =>
      this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot()));
    this.settings.settings$.pipe(takeUntil(this.destroy$)).subscribe(() =>
      this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot()));
    this.websocketService.ensureConnected();
    this.websocketService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.websocketStatus = status;
        this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot());
      });

    this.websocketService.dashboardCache$
      .pipe(takeUntil(this.destroy$))
      .subscribe((cache) => this.rebuildFromCache(cache));

    this.loadFaults();
    this.loadUnusedStations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.websocketService.ensureConnected();
    this.loadFaults();
    this.loadUnusedStations();
    this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot());
  }

  private rebuildFromCache(cache: DashboardCacheState): void {
    const envelope = cache.dashboard?.machines?.today || cache.today || cache.dashboard?.machines?.shifts?.[0];
    this.cacheReady = Array.isArray(envelope?.machinesSummary);
    const operatorsReady = Array.isArray(cache.dashboard?.operators?.today?.operatorsSummary) || Array.isArray(cache.today?.operatorsSummary);
    const machines = envelope?.machinesSummary || [];
    const operators =
      cache.dashboard?.operators?.today?.operatorsSummary ||
      cache.today?.operatorsSummary ||
      [];

    this.updatedAt = envelope?.updatedAt ? new Date(envelope.updatedAt) : null;

    const running = machines.filter((m) => getStatusDotByCode(m.currentStatus?.code) === 'Running Dot').length;
    const faultedMachines = machines.filter((m) => getStatusDotByCode(m.currentStatus?.code) === 'Faulted Dot');
    const offlineMachines = machines.filter((m) => getStatusDotByCode(m.currentStatus?.code) === 'Offline Dot');
    const totalCount = machines.reduce((sum, m) => sum + Number(m.metrics?.output?.totalCount || m.itemSummary?.machineSummary?.totalCount || 0), 0);
    const avgOee = this.average(machines.map((m) => m.metrics?.performance?.oee?.percentage ?? m.performance?.oee?.percentage));
    const avgEfficiency = this.average(operators.map((o: any) => o.metrics?.performance?.efficiency?.percentage));
    const worstMachine = [...machines]
      .filter((m) => Number.isFinite(Number(m.metrics?.performance?.oee?.percentage ?? m.performance?.oee?.percentage)))
      .sort((a, b) =>
        Number(a.metrics?.performance?.oee?.percentage ?? a.performance?.oee?.percentage) -
        Number(b.metrics?.performance?.oee?.percentage ?? b.performance?.oee?.percentage)
      )[0];

    const unusedStations = Number(this.unusedStationsSummary?.unusedStations ?? 0);
    const totalStations = Number(this.unusedStationsSummary?.totalStations ?? 0);
    const loggedInOperators = Number(this.unusedStationsSummary?.loggedInOperators ?? 0);

    this.insightCards = [
      { label: 'Running Machines', value: `${running}/${machines.length}`, detail: 'Live machine status', icon: 'play_circle', tone: running === machines.length ? 'good' : 'warn' },
      { label: 'Plant OEE', value: `${avgOee}%`, detail: 'Average across machines', icon: 'speed', tone: this.metricTone(avgOee, true) },
      { label: 'Operator Efficiency', value: `${avgEfficiency}%`, detail: 'Average across active operators', icon: 'groups', tone: this.metricTone(avgEfficiency, false) },
      { label: 'Unused Stations', value: unusedStations, detail: `${totalStations} stations / ${loggedInOperators} operators`, icon: 'event_seat', tone: unusedStations > 0 ? 'warn' : 'good' },
      { label: 'Total Count', value: totalCount.toLocaleString(), detail: 'Current dashboard window', icon: 'tag', tone: 'neutral' },
    ];

    for (const card of this.insightCards) {
      const ready = card.label === 'Unused Stations' ? this.unusedStationsSummary !== null
        : card.label === 'Operator Efficiency' ? operatorsReady && operators.length > 0
        : this.cacheReady && (card.label !== 'Plant OEE' || machines.length > 0);
      if (!ready) {
        card.value = '—'; card.tone = 'neutral';
        card.detail = card.label === 'Unused Stations' ? (this.stationsLoading ? 'Loading stations…' : 'Station data unavailable')
          : (this.websocketStatus === 'connected' || this.websocketStatus === 'connecting' ? 'Waiting for live data' : 'Live data unavailable');
      }
    }

    const alerts: ActionAlert[] = [];
    if (this.websocketStatus === 'error' || this.websocketStatus === 'disconnected') {
      alerts.push({
        severity: 'critical',
        icon: 'cloud_off',
        title: 'Live feed is not connected',
        detail: 'Dashboards may be relying on fallback REST polling or stale cache.',
        meta: this.updatedAt ? `Last cache: ${this.settings.formatTime(this.updatedAt, { year: 'numeric', month: 'short', day: 'numeric', second: '2-digit' })}` : 'No cache timestamp',
      });
    }

    for (const machine of faultedMachines.slice(0, 5)) {
      alerts.push({
        severity: 'critical',
        icon: 'warning',
        title: `${machine.machine?.name || 'Machine'} is faulted`,
        detail: `OEE ${machine.metrics?.performance?.oee?.percentage ?? machine.performance?.oee?.percentage ?? 0}% with ${machine.metrics?.output?.totalCount ?? 0} pieces counted.`,
        meta: `Serial ${machine.machine?.serial ?? 'unknown'}`,
      });
    }

    for (const machine of offlineMachines.slice(0, 4)) {
      alerts.push({
        severity: 'warning',
        icon: 'cloud_off',
        title: `${machine.machine?.name || 'Machine'} is offline`,
        detail: 'No active running status is being reported for this machine.',
        meta: `Serial ${machine.machine?.serial ?? 'unknown'}`,
      });
    }

    if (worstMachine) {
      alerts.push({
        severity: 'info',
        icon: 'trending_down',
        title: `${worstMachine.machine?.name || 'Machine'} is the current bottleneck`,
        detail: `Lowest machine OEE is ${worstMachine.metrics?.performance?.oee?.percentage ?? worstMachine.performance?.oee?.percentage}% this window.`,
        meta: 'Review faults, downtime, and item mix',
      });
    }

    if (unusedStations > 0) {
      alerts.push({
        severity: 'warning',
        icon: 'event_seat',
        title: `${unusedStations} unused station${unusedStations === 1 ? '' : 's'} available`,
        detail: `${loggedInOperators} operator${loggedInOperators === 1 ? '' : 's'} logged in across ${totalStations} active station${totalStations === 1 ? '' : 's'}.`,
        meta: 'Assign available labor where possible',
      });
    }

    this.alerts = alerts;
  }

  private loadUnusedStations(): void {
    this.stationsLoading = true;
    this.dashboardService
      .getUnusedStationsSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => {
          this.stationsLoading = false;
          this.unusedStationsSummary = summary || null;
          this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot());
        },
        error: () => {
          this.stationsLoading = false;
          this.unusedStationsSummary = null;
          this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot());
        },
      });
  }

  private loadFaults(): void {
    this.faultsLoading = true;
    this.faultsError = '';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    this.dailyDashboardService
      .getFaultReportSummary(start.toISOString(), end.toISOString())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.faultsLoading = false;
          this.topFaults = (response.summaries || [])
            .sort((a, b) => Number(b.totalDurationSeconds || 0) - Number(a.totalDurationSeconds || 0))
            .slice(0, 5);
        },
        error: () => {
          this.faultsLoading = false;
          this.faultsError = 'Unable to load fault data. Try Refresh.';
          this.topFaults = [];
        },
      });
  }

  private metricTone(value: number, oee: boolean): 'good' | 'warn' | 'bad' {
    const bands = oee ? this.breakpoints.getOeBreakpoints() : this.breakpoints.getBreakpoints();
    return value >= bands.good ? 'good' : value >= bands.okay ? 'warn' : 'bad';
  }

  private average(values: any[]): number {
    const numeric = values.map(Number).filter((value) => Number.isFinite(value));
    if (!numeric.length) return 0;
    return Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
