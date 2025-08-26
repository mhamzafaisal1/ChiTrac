// charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StackedBarChartComponent, StackedBarChartData } from '../../components/stacked-bar-chart/stacked-bar-chart.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';
import { Subject, Observable } from 'rxjs';
import { takeUntil, tap, delay } from 'rxjs/operators';

interface MachineStatus {
  serial: number;
  name: string;
  runningMs: number;
  pausedMs: number;
  faultedMs: number;
}

@Component({
  selector: 'app-daily-machine-stacked-bar-chart',
  standalone: true,
  imports: [CommonModule, StackedBarChartComponent],
  templateUrl: './daily-machine-stacked-bar-chart.component.html',
  styleUrls: ['./daily-machine-stacked-bar-chart.component.scss']
})
export class DailyMachineStackedBarChartComponent implements OnInit, OnDestroy {
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;
  @Input() serial?: number; // optional filter

  chartData: StackedBarChartData | null = null;

  isDarkTheme = false;
  isLoading = false;
  hasInitialData = false;
  dummyMode = true;

  startTime = '';
  endTime = '';
  liveMode = false;

  private destroy$ = new Subject<void>();
  private pollingSub: any;
  private readonly POLLING_INTERVAL = 6000;

  constructor(
    private dailyDashboardService: DailyDashboardService,
    private pollingService: PollingService,
    private dateTimeService: DateTimeService
  ) {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    new MutationObserver(() => {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
    }).observe(document.body, { attributes: true });
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(now);

    this.enterDummy();

    if (!isLive && wasConfirmed) {
      this.startTime = this.dateTimeService.getStartTime();
      this.endTime   = this.dateTimeService.getEndTime();
      this.fetchOnce().subscribe();
    }
    if (!wasConfirmed) {
      this.fetchOnce().subscribe();
    }

    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((live) => {
        this.liveMode = live;
        if (live) this.startLive(); else this.stopLive();
      });

    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPolling();
        this.enterDummy();
        this.startTime = this.dateTimeService.getStartTime();
        this.endTime   = this.dateTimeService.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.stopPolling();
  }

  // ---- flow ----
  private startLive(): void {
    this.enterDummy();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime   = this.pollingService.updateEndTimestampToNow();

    this.fetchOnce().subscribe();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.chartData = null;
    this.enterDummy();
  }

  private setupPolling(): void {
    this.stopPolling();
    this.pollingSub = this.pollingService.poll(
      () => {
        this.endTime = this.pollingService.updateEndTimestampToNow();
        return this.dailyDashboardService.getDailyMachineStatus(this.startTime, this.endTime, this.serial)
          .pipe(tap(this.consumeResponse('poll')));
      },
      this.POLLING_INTERVAL,
      this.destroy$,
      false,
      false
    ).subscribe({ error: () => this.stopPolling() });
  }

  private stopPolling(): void {
    if (this.pollingSub) { this.pollingSub.unsubscribe(); this.pollingSub = null; }
  }

  private fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return new Observable();
    this.isLoading = true;
    return this.dailyDashboardService.getDailyMachineStatus(this.startTime, this.endTime, this.serial)
      .pipe(
        takeUntil(this.destroy$),
        tap(this.consumeResponse('once')),
        delay(0)
      );
  }

  private consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      // Handle the API response structure with machineStatus array
      let rows: MachineStatus[] = [];
      
      if (res && res.machineStatus && Array.isArray(res.machineStatus)) {
        rows = res.machineStatus.map((m: any) => ({
          serial:   m.serial ?? m.machineId ?? 0,
          name:     m.name ?? m.machineName ?? `Machine ${m.serial ?? 'Unknown'}`,
          runningMs:m.runningMs ?? m.running ?? 0,
          pausedMs: m.pausedMs  ?? m.paused  ?? 0,
          faultedMs:m.faultedMs ?? m.faulted ?? 0
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((m: any) => ({
          serial:   m.serial ?? m.machineId ?? 0,
          name:     m.name ?? m.machineName ?? `Machine ${m.serial ?? 'Unknown'}`,
          runningMs:m.runningMs ?? m.running ?? 0,
          pausedMs: m.pausedMs  ?? m.paused  ?? 0,
          faultedMs:m.faultedMs ?? m.faulted ?? 0
        }));
      }

      this.chartData = rows.length ? this.formatMachineData(rows) : null;
      this.hasInitialData = !!this.chartData;
      this.isLoading = false;
      this.dummyMode = false;
    };

  // ---- mapping ----
  private formatMachineData(data: MachineStatus[]): StackedBarChartData {
    const toHours = (ms: number) => ms / 3_600_000;
    return {
      title: 'Daily Machine Status',
      data: {
        hours: [], // not used by machine mode
        operators: {
          'Running': data.map(d => toHours(d.runningMs)),
          'Paused':  data.map(d => toHours(d.pausedMs)),
          'Faulted': data.map(d => toHours(d.faultedMs))
        },
        machineNames: data.map(d => d.name)
      }
    };
  }

  private enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartData = null;
  }

  // ---- utils ----
  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
