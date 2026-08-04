import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil } from 'rxjs';
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

@Component({
  selector: 'app-action-center',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './action-center.component.html',
  styleUrl: './action-center.component.scss',
})
export class ActionCenterComponent implements OnInit, OnDestroy {
  websocketStatus: WebsocketConnectionStatus = 'disconnected';
  updatedAt: Date | null = null;
  alerts: ActionAlert[] = [];
  insightCards: InsightCard[] = [];
  topFaults: any[] = [];
  private readonly destroy$ = new Subject<void>();

  constructor(
    private websocketService: WebsocketService,
    private dailyDashboardService: DailyDashboardService
  ) {}

  ngOnInit(): void {
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
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.websocketService.ensureConnected();
    this.loadFaults();
    this.rebuildFromCache(this.websocketService.getDashboardCacheSnapshot());
  }

  private rebuildFromCache(cache: DashboardCacheState): void {
    const envelope = cache.dashboard?.machines?.today || cache.today || cache.dashboard?.machines?.shifts?.[0];
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

    this.insightCards = [
      { label: 'Running Machines', value: `${running}/${machines.length}`, detail: 'Live machine status', icon: 'play_circle', tone: running === machines.length ? 'good' : 'warn' },
      { label: 'Plant OEE', value: `${avgOee}%`, detail: 'Average across machines', icon: 'speed', tone: avgOee >= 85 ? 'good' : avgOee >= 60 ? 'warn' : 'bad' },
      { label: 'Operator Efficiency', value: `${avgEfficiency}%`, detail: 'Average across active operators', icon: 'groups', tone: avgEfficiency >= 85 ? 'good' : avgEfficiency >= 60 ? 'warn' : 'bad' },
      { label: 'Total Count', value: totalCount.toLocaleString(), detail: 'Current dashboard window', icon: 'tag', tone: 'neutral' },
    ];

    const alerts: ActionAlert[] = [];
    if (this.websocketStatus === 'error' || this.websocketStatus === 'disconnected') {
      alerts.push({
        severity: 'critical',
        icon: 'cloud_off',
        title: 'Live feed is not connected',
        detail: 'Dashboards may be relying on fallback REST polling or stale cache.',
        meta: this.updatedAt ? `Last cache: ${this.updatedAt.toLocaleString()}` : 'No cache timestamp',
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

    this.alerts = alerts;
  }

  private loadFaults(): void {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    this.dailyDashboardService
      .getFaultReportSummary(start.toISOString(), end.toISOString())
      .subscribe({
        next: (response) => {
          this.topFaults = (response.summaries || [])
            .sort((a, b) => Number(b.totalDurationSeconds || 0) - Number(a.totalDurationSeconds || 0))
            .slice(0, 5);
        },
        error: () => {
          this.topFaults = [];
        },
      });
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
