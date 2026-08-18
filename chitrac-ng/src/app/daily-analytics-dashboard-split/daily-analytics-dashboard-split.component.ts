import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit, ElementRef, NgZone } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { ChartTileComponent } from "../components/chart-tile/chart-tile.component";
import { DashboardTimeframeService } from "../services/dashboard-timeframe.service";
import { DateTimeService } from "../services/date-time.service";
import { DashboardCacheScope, WebsocketConnectionStatus, WebsocketService } from "../services/websocket.service";

import { DailyMachineStackedBarChartComponent } from "../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { DailyCountByItemChartComponent } from "../charts/daily-count-by-item-chart/daily-count-by-item-chart.component";
import { DailyCountBarChartComponent } from "../charts/daily-count-bar-chart/daily-count-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { EfficiencyByMachineGroupBarChartComponent } from "../charts/efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component";

@Component({
    selector: 'app-daily-analytics-dashboard-split',
    imports: [
        CommonModule,
        ChartTileComponent,
        DailyMachineStackedBarChartComponent,
        DailyMachineOeeBarChartComponent,
        DailyCountByItemChartComponent,
        DailyCountBarChartComponent,
        RankedOperatorBarChartComponent,
        EfficiencyByMachineGroupBarChartComponent
    ],
    templateUrl: './daily-analytics-dashboard-split.component.html',
    styleUrls: ['./daily-analytics-dashboard-split.component.scss']
})
export class DailyAnalyticsDashboardSplitComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('chartsGrid') chartsGrid!: ElementRef<HTMLElement>;
  @ViewChild(DailyCountByItemChartComponent) itemChart!: DailyCountByItemChartComponent;
  
  isDarkTheme: boolean = false;
  chartWidth: number = 600;
  chartHeight: number = 450;
  preloadedData: any = null;
  cacheSubtitle = 'Today';
  cacheUpdatedAt: string | null = null;
  readonly useTileTitles = true;
  private websocketStatus: WebsocketConnectionStatus = 'disconnected';
  private resizeObserver?: ResizeObserver;
  private resizeFrame: number | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private websocketService: WebsocketService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.websocketService.ensureConnected();
    if (!this.dateTimeService.getConfirmed()) {
      this.dashboardTimeframeService.applyDefault()
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.applyWebsocketCache());
    }

    this.websocketService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.websocketStatus = status;
        if (status === 'connected') {
          this.applyWebsocketCache();
        } else if (status === 'disconnected' || status === 'error') {
          this.preloadedData = null;
        }
      });
    this.websocketService.dashboardCache$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyWebsocketCache());
  }

  ngAfterViewInit(): void {
    this.setupChartResizeObserver();
    this.scheduleChartDimensionUpdate();
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  detectTheme() {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  private setupChartResizeObserver(): void {
    if (!this.chartsGrid?.nativeElement || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.scheduleChartDimensionUpdate());
      this.resizeObserver.observe(this.chartsGrid.nativeElement);

      this.chartsGrid.nativeElement
        .querySelectorAll('app-chart-tile')
        .forEach((tile) => this.resizeObserver?.observe(tile));
    });
  }

  private scheduleChartDimensionUpdate(): void {
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }

    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.ngZone.run(() => this.updateChartDimensionsFromTile());
    });
  }

  private updateChartDimensionsFromTile(): void {
    const tile = this.chartsGrid?.nativeElement.querySelector('app-chart-tile');
    if (!tile) return;

    const chartContent = tile.querySelector('.chart-content') as HTMLElement | null;
    const { width, height } = (chartContent || tile).getBoundingClientRect();
    const nextWidth = Math.floor(width);
    const nextHeight = Math.floor(height);

    if (nextWidth <= 0 || nextHeight <= 0) return;
    if (nextWidth === this.chartWidth && nextHeight === this.chartHeight) return;

    this.chartWidth = nextWidth;
    this.chartHeight = nextHeight;

    if (this.itemChart) {
      this.itemChart.setAvailableSize(this.chartWidth, this.chartHeight);
    }
  }

  private applyWebsocketCache(): void {
    if (this.websocketStatus !== 'connected') return;

    const scope = this.getDashboardCacheScope();
    const shiftId = this.dateTimeService.getShiftId();
    const cache = this.websocketService.getDashboardCacheSnapshot();
    const dailyAnalytics = cache.dashboard?.dailyAnalytics;
    const envelope = scope === 'currentShift' && shiftId
      ? dailyAnalytics?.shifts?.find((shift) => shift?.meta?.shiftId === shiftId)
      : dailyAnalytics?.today;

    this.preloadedData = envelope?.data || null;
    this.cacheSubtitle = this.buildCacheSubtitle(envelope, scope);
    this.cacheUpdatedAt = this.formatUpdatedAt(envelope?.updatedAt);
  }

  private getDashboardCacheScope(): DashboardCacheScope {
    return this.dateTimeService.getShiftId() ? 'currentShift' : 'today';
  }

  private buildCacheSubtitle(envelope: any, scope: DashboardCacheScope): string {
    const mode = envelope?.meta?.mode;
    const shiftName = envelope?.meta?.shift?.name;
    if (scope === 'currentShift') {
      return shiftName ? `${shiftName} Shift` : 'Current Shift';
    }
    if (mode === 'today') return 'Today';
    return 'Daily Analytics';
  }

  private formatUpdatedAt(updatedAt: string | Date | null | undefined): string | null {
    if (!updatedAt) return null;
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return `Updated ${date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    })}`;
  }
}
