import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LayoutSaveConfirmComponent } from '../components/layout-save-confirm/layout-save-confirm.component';
import {
  SummaryCardVisibilityDialogComponent,
  SummaryCardVisibilityOption
} from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { ChartTileComponent } from '../components/chart-tile/chart-tile.component';
import { DailyCountBarChartComponent } from '../charts/daily-count-bar-chart/daily-count-bar-chart.component';
import { DailyCountByItemChartComponent } from '../charts/daily-count-by-item-chart/daily-count-by-item-chart.component';
import { DailyMachineOeeBarChartComponent } from '../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component';
import { DailyMachineStackedBarChartComponent } from '../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component';
import { EfficiencyByMachineGroupBarChartComponent } from '../charts/efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component';
import { MachineTimelineChartComponent } from '../charts/machine-timeline-chart/machine-timeline-chart.component';
import { RankedOperatorBarChartComponent } from '../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { DateTimeService } from '../services/date-time.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { SettingsService } from '../services/settings.service';
import { DashboardCacheScope, WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { UserService } from '../user.service';

interface ExperimentalChartTile {
  id: string;
  title: string;
  icon: string;
}

interface ExperimentalDashboardLayoutSnapshot {
  chartOrder: string[];
  chartVisibility: Record<string, boolean>;
}

@Component({
  selector: 'app-experimental-daily-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    MatButtonModule,
    MatIconModule,
    ChartTileComponent,
    DailyMachineStackedBarChartComponent,
    MachineTimelineChartComponent,
    DailyMachineOeeBarChartComponent,
    DailyCountByItemChartComponent,
    DailyCountBarChartComponent,
    RankedOperatorBarChartComponent,
    EfficiencyByMachineGroupBarChartComponent
  ],
  templateUrl: './experimental-daily-dashboard.component.html',
  styleUrl: './experimental-daily-dashboard.component.scss'
})
export class ExperimentalDailyDashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('chartsGrid') chartsGrid!: ElementRef<HTMLElement>;
  @ViewChild(DailyCountByItemChartComponent) itemChart!: DailyCountByItemChartComponent;

  isDarkTheme = false;
  layoutEditing = false;
  chartWidth = 600;
  chartHeight = 450;
  preloadedData: any = null;
  cacheSubtitle = 'Today';
  cacheUpdatedAt: string | null = null;
  readonly useTileTitles = true;
  readonly layoutContextId = 'experimentalDailyDashboard';
  readonly maxVisibleCharts = 6;

  chartTiles: ExperimentalChartTile[] = [
    { id: 'machine-status', title: 'Machine Run/Pause/Fault Time', icon: 'bar_chart' },
    { id: 'machine-timeline', title: 'Machine Timeline', icon: 'view_timeline' },
    { id: 'machine-oee', title: 'Machine OEE', icon: 'insights' },
    { id: 'item-totals', title: 'Item Totals by Type', icon: 'stacked_bar_chart' },
    { id: 'machine-group-efficiency', title: 'Efficiency % by Machine Group', icon: 'groups' },
    { id: 'top-operators', title: 'Top Operator Efficiency', icon: 'leaderboard' },
    { id: 'daily-counts', title: 'Daily Plantwide Count Totals', icon: 'calendar_view_day' }
  ];
  chartVisibility: Record<string, boolean> = {};

  private websocketStatus: WebsocketConnectionStatus = 'disconnected';
  private resizeObserver?: ResizeObserver;
  private resizeFrame: number | null = null;
  private destroy$ = new Subject<void>();
  private layoutSnapshot: ExperimentalDashboardLayoutSnapshot | null = null;

  constructor(
    private websocketService: WebsocketService,
    private dateTimeService: DateTimeService,
    private dashboardTimeframeService: DashboardTimeframeService,
    private layoutEditService: LayoutEditService,
    private settingsService: SettingsService,
    private userService: UserService,
    private dialog: MatDialog,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.applyDefaultChartVisibility();
    this.layoutEditService.register(this.layoutContextId, 'Experimental Daily Dashboard');
    this.subscribeToLayoutEditing();
    this.subscribeToUserPreferences();
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
    this.layoutEditService.unregister(this.layoutContextId);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  onChartDrop(event: CdkDragDrop<ExperimentalChartTile[]>): void {
    if (!this.layoutEditing || event.previousIndex === event.currentIndex) return;
    const visibleTiles = this.visibleChartTiles;
    const movedTile = visibleTiles[event.previousIndex];
    const targetTile = visibleTiles[event.currentIndex];
    if (!movedTile || !targetTile) return;

    const withoutMoved = this.chartTiles.filter((tile) => tile.id !== movedTile.id);
    const targetIndex = withoutMoved.findIndex((tile) => tile.id === targetTile.id);
    const insertIndex = event.currentIndex > event.previousIndex ? targetIndex + 1 : targetIndex;
    withoutMoved.splice(insertIndex, 0, movedTile);
    this.chartTiles = withoutMoved;
    this.layoutEditService.markEditsMade();
    this.settingsService.setExperimentalDailyDashboardChartOrder(this.getChartOrder(), this.chartVisibility);
    this.scheduleChartDimensionUpdate();
  }

  get visibleChartTiles(): ExperimentalChartTile[] {
    return this.chartTiles.filter((tile) => this.isChartVisible(tile.id)).slice(0, this.maxVisibleCharts);
  }

  chartSubtitle(tile: ExperimentalChartTile): string {
    if (tile.id === 'machine-timeline') {
      return this.preloadedData?.machineTimeline?.meta?.subtitle || this.cacheSubtitle;
    }
    return tile.id === 'daily-counts' ? 'Last 28 Days' : this.cacheSubtitle;
  }

  chartSubtitleStrong(tile: ExperimentalChartTile): boolean {
    return tile.id === 'machine-timeline' &&
      this.preloadedData?.machineTimeline?.meta?.displayDateMode === 'yesterday';
  }

  trackTile(index: number, tile: ExperimentalChartTile): string {
    return tile.id;
  }

  openChartVisibilityDialog(): void {
    const dialogRef = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '800px',
      maxWidth: '94vw',
      autoFocus: false,
      data: {
        title: 'Show/Hide Charts',
        description: 'Choose which Daily Dashboard charts are visible in this layout.',
        showLabel: 'Shown',
        hideLabel: 'Hidden',
        emptyShownText: 'No charts shown',
        emptyHiddenText: 'No charts hidden',
        compactCards: true,
        exactVisible: this.maxVisibleCharts,
        cards: this.getChartVisibilityOptions(),
        visibility: this.getChartVisibilityForDialog(),
      },
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((visibility: Record<string, boolean> | undefined) => {
        if (!visibility) return;
        this.layoutEditService.markEditsMade();
        this.chartVisibility = this.cleanChartVisibility(visibility);
        this.settingsService.setExperimentalDailyDashboardChartOrder(this.getChartOrder(), this.chartVisibility);
        this.scheduleChartDimensionUpdate();
      });
  }

  private subscribeToLayoutEditing(): void {
    this.layoutEditService.context$
      .pipe(takeUntil(this.destroy$))
      .subscribe((context) => {
        const nextEditing = context?.id === this.layoutContextId && context.editing;
        if (nextEditing && !this.layoutEditing) {
          this.layoutSnapshot = {
            chartOrder: [...this.getChartOrder()],
            chartVisibility: { ...this.chartVisibility },
          };
        } else if (!nextEditing && this.layoutEditing) {
          this.layoutSnapshot = null;
        }
        this.layoutEditing = nextEditing;
      });

    this.layoutEditService.lockRequested$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.confirmAndSaveLayout());
  }

  private subscribeToUserPreferences(): void {
    this.settingsService.userPreferences$
      .pipe(takeUntil(this.destroy$))
      .subscribe((preferences) => {
        const chartOrder = preferences?.dashboardLayouts?.experimentalDailyDashboard?.chartOrder;
        const chartVisibility = preferences?.dashboardLayouts?.experimentalDailyDashboard?.chartVisibility;
        if (Array.isArray(chartOrder) && chartOrder.length) {
          this.applyChartOrder(chartOrder);
        }
        this.chartVisibility = this.cleanChartVisibility(chartVisibility || this.chartVisibility);
      });
  }

  private confirmAndSaveLayout(): void {
    const dialogRef = this.dialog.open(LayoutSaveConfirmComponent, {
      width: '460px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        if (result === 'save') {
          this.saveLayout();
          return;
        }
        if (result === 'discard') {
          this.revertLayoutChanges();
        }
      });
  }

  private saveLayout(): void {
    const chartOrder = this.getChartOrder();
    this.settingsService.setExperimentalDailyDashboardChartOrder(chartOrder, this.chartVisibility);

    if (!this.userService.getToken()) {
      this.layoutEditService.setEditing(false);
      return;
    }

    this.settingsService.saveExperimentalDailyDashboardChartOrder(chartOrder, this.chartVisibility).subscribe({
      next: () => {
        this.layoutSnapshot = null;
        this.layoutEditService.setEditing(false);
      },
      error: (error) => {
        console.error('[ExperimentalDailyDashboard] Failed to save chart layout', error);
      }
    });
  }

  private revertLayoutChanges(): void {
    if (!this.layoutSnapshot) {
      this.layoutEditService.setEditing(false);
      return;
    }

    const chartOrder = [...this.layoutSnapshot.chartOrder];
    this.chartVisibility = this.cleanChartVisibility(this.layoutSnapshot.chartVisibility);
    this.applyChartOrder(chartOrder);
    this.settingsService.setExperimentalDailyDashboardChartOrder(chartOrder, this.chartVisibility);
    this.layoutSnapshot = null;
    this.layoutEditService.setEditing(false);
  }

  private applyChartOrder(chartOrder: string[]): void {
    const byId = new Map(this.chartTiles.map((tile) => [tile.id, tile]));
    const ordered = chartOrder
      .map((id) => byId.get(id))
      .filter((tile): tile is ExperimentalChartTile => Boolean(tile));
    const additions = this.chartTiles.filter((tile) => !chartOrder.includes(tile.id));
    this.chartTiles = [...ordered, ...additions];
    this.chartVisibility = this.cleanChartVisibility(this.chartVisibility);
    this.scheduleChartDimensionUpdate();
  }

  private getChartOrder(): string[] {
    return this.chartTiles.map((tile) => tile.id);
  }

  private getChartVisibilityOptions(): SummaryCardVisibilityOption[] {
    return this.chartTiles.map((tile) => ({
      label: tile.title,
      icon: tile.icon,
    }));
  }

  private getChartVisibilityForDialog(): Record<string, boolean> {
    return this.chartTiles.reduce((acc, tile) => {
      acc[tile.title] = this.isChartVisible(tile.id);
      return acc;
    }, {} as Record<string, boolean>);
  }

  private cleanChartVisibility(visibility: Record<string, boolean> = {}): Record<string, boolean> {
    const cleaned = this.chartTiles.reduce((acc, tile) => {
      if (typeof visibility[tile.id] === 'boolean') {
        acc[tile.id] = visibility[tile.id];
      } else if (typeof visibility[tile.title] === 'boolean') {
        acc[tile.id] = visibility[tile.title];
      }
      return acc;
    }, {} as Record<string, boolean>);

    let visibleCount = 0;
    for (const tile of this.chartTiles) {
      const visible = cleaned[tile.id] !== false;
      if (visible && visibleCount >= this.maxVisibleCharts) {
        cleaned[tile.id] = false;
        continue;
      }
      if (visible) visibleCount += 1;
    }

    Object.keys(cleaned).forEach((id) => {
      if (!this.chartTiles.some((tile) => tile.id === id)) {
        delete cleaned[id];
      }
    });

    return cleaned;
  }

  private isChartVisible(id: string): boolean {
    return this.chartVisibility[id] !== false;
  }

  private applyDefaultChartVisibility(): void {
    this.chartVisibility = this.cleanChartVisibility({
      ...this.chartVisibility,
      'machine-timeline': false,
    });
  }

  private detectTheme(): void {
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
        .querySelectorAll('.chart-shell')
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
    const tile = this.chartsGrid?.nativeElement.querySelector('.chart-shell');
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
