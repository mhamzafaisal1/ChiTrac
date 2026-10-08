import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, Type, ViewChild } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ChartTileComponent } from '../chart-tile/chart-tile.component';
import { DailyMachineStackedBarChartComponent } from '../../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component';
import { MachineTimelineChartComponent } from '../../charts/machine-timeline-chart/machine-timeline-chart.component';
import { DailyMachineOeeBarChartComponent } from '../../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component';
import { DailyCountByItemChartComponent } from '../../charts/daily-count-by-item-chart/daily-count-by-item-chart.component';
import { EfficiencyByMachineGroupBarChartComponent } from '../../charts/efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component';
import { RankedOperatorBarChartComponent } from '../../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component';
import { DailyCountBarChartComponent } from '../../charts/daily-count-bar-chart/daily-count-bar-chart.component';

export interface DailyChartDetailState {
  data: unknown;
  subtitle: string;
  subtitleStrong: boolean;
  updatedAt: string | null;
}

export const DAILY_CHART_COMPONENTS: Record<string, { component: Type<unknown>; dataKey: string }> = {
  'machine-status': { component: DailyMachineStackedBarChartComponent, dataKey: 'machineStatus' },
  'machine-timeline': { component: MachineTimelineChartComponent, dataKey: 'machineTimeline' },
  'machine-oee': { component: DailyMachineOeeBarChartComponent, dataKey: 'machineOee' },
  'item-totals': { component: DailyCountByItemChartComponent, dataKey: 'itemTotals' },
  'machine-group-efficiency': { component: EfficiencyByMachineGroupBarChartComponent, dataKey: 'machineGroupEfficiency' },
  'top-operators': { component: RankedOperatorBarChartComponent, dataKey: 'topOperators' },
  'daily-counts': { component: DailyCountBarChartComponent, dataKey: 'dailyCounts' },
};

@Component({
  selector: 'app-daily-chart-detail',
  standalone: true,
  imports: [CommonModule, ChartTileComponent],
  templateUrl: './daily-chart-detail.component.html',
  styleUrl: './daily-chart-detail.component.scss',
})
export class DailyChartDetailComponent implements AfterViewInit, OnDestroy {
  @Input() chartId = '';
  @Input() title = '';
  @Input() icon = '';
  @Input() state$!: BehaviorSubject<DailyChartDetailState>;
  @ViewChild('viewport') viewport!: ElementRef<HTMLElement>;
  chartWidth = 600;
  chartHeight = 450;
  private observer?: ResizeObserver;
  private frame: number | null = null;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  get chartComponent(): Type<unknown> | null {
    return DAILY_CHART_COMPONENTS[this.chartId]?.component ?? null;
  }

  chartInputs(state: DailyChartDetailState): Record<string, unknown> {
    return {
      chartWidth: this.chartWidth,
      chartHeight: this.chartHeight,
      preloadedData: state.data,
      useExternalTitle: true,
    };
  }

  ngAfterViewInit(): void {
    const content = this.viewport.nativeElement.querySelector('.chart-content');
    if (!content) return;
    this.observer = new ResizeObserver(() => {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        const { width, height } = content.getBoundingClientRect();
        if (width <= 0 || height <= 0) return;
        this.zone.run(() => {
          this.chartWidth = Math.floor(width);
          this.chartHeight = Math.floor(height);
          this.cdr.markForCheck();
        });
      });
    });
    this.observer.observe(content);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
}
