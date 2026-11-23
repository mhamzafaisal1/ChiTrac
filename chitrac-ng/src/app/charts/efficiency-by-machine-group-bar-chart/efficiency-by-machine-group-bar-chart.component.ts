import { PreviousDayComparison, yesterdayMarker, yesterdayTooltip, YESTERDAY_MARKER_STYLE } from '../yesterday-comparison';
// charts/efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { Observable } from 'rxjs';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
type GroupRow = { id: string; name: string; efficiency: number; efficiencyPreviousDay?: number | null; previousDay?: PreviousDayComparison | null };

@Component({
  selector: 'app-efficiency-by-machine-group-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './efficiency-by-machine-group-bar-chart.component.html',
  styleUrls: ['./efficiency-by-machine-group-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EfficiencyByMachineGroupBarChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: 'top' | 'right';
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @Input() preloadedData?: any[] | null;
  @Input() useExternalTitle = false;
  @Input() showYesterday = true;
  private lastResponse: any = null;

  chartConfig: CartesianChartConfig | null = null;

  constructor(
    private dashboardService: DashboardService,
    private dateTimeService: DateTimeService,
    private percentBreakpointService: PercentBreakpointService
  ) {
    super();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')(this.preloadedData);
    } else if (changes['preloadedData'] && !this.preloadedData && this.liveMode && !this.dateTimeService.getConfirmed()) {
      this.setupPolling();
    }
    if (!changes['preloadedData'] && this.lastResponse &&
        ['showYesterday', 'chartWidth', 'chartHeight'].some(key => changes[key])) {
      this.consumeResponse('once')(this.lastResponse);
    }
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = toDateTimeLocalInput(start);
    this.endTime = toDateTimeLocalInput(now);

    if (!this.preloadedData) this.enterDummy();
    if (this.useExternalTitle) return;

    this.startTimeframeSync(isLive, wasConfirmed);
  }

  protected clearChart(): void {
    this.chartConfig = null;
    this.lastResponse = null;
  }

  protected loadData(start: string, end: string): Observable<any> {
    return this.dashboardService.getMachinesGroupSummary(start, end);
  }

  protected consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      this.lastResponse = res;
      let rows: GroupRow[] = [];
      const arr = Array.isArray(res) ? res : (res?.data ?? res?.groups ?? []);
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const name = item?.machine?.name ?? item?.name ?? `Group ${i}`;
        const eff = item?.metrics?.performance?.efficiency;
        const value = typeof eff?.value === 'number' ? eff.value * 100 :
          (typeof eff?.percentage === 'string' ? parseFloat(eff.percentage) : Number(eff?.percentage ?? 0));
        const prev = item?.efficiencyPreviousDay;
        const efficiencyPreviousDay =
          prev == null
            ? null
            : typeof prev.value === 'number'
              ? prev.value * 100
              : (typeof prev.percentage === 'string' ? parseFloat(prev.percentage) : Number(prev.percentage ?? 0));
        rows.push({
          id: `group-${i}`,
          name: String(name),
          efficiency: value,
          efficiencyPreviousDay: efficiencyPreviousDay ?? undefined,
          previousDay: item.previousDay ?? (efficiencyPreviousDay == null ? null : { date: '', value: efficiencyPreviousDay }),
        });
      }

      // Sort descending by efficiency
      rows.sort((a, b) => b.efficiency - a.efficiency);

      this.chartConfig = rows.length ? this.formatChartData(rows) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: GroupRow[]): CartesianChartConfig {
    const series: XYSeries[] = [{
      id: 'machine-groups',
      title: 'Efficiency',
      type: 'bar',
      data: data.map(g => ({
        x: g.id,
        y: g.efficiency,
        color: this.getEfficiencyColor(g.efficiency),
        ...yesterdayMarker(g.previousDay, this.showYesterday),
      })),
      options: {
        barPadding: 0.2,
        endMarker: YESTERDAY_MARKER_STYLE,
      },
    }];

    return {
      title: this.useExternalTitle ? '' : 'Efficiency % by Machine Group',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      fitToContentMargins: this.useExternalTitle,
      yTickFormat: (v: any) => {
        const key = String(v);
        return data.find(d => d.id === key)?.name ?? key;
      },
      margin: {
        top: this.useExternalTitle ? 4 : Math.max(this.marginTop || 40, 60),
        right: this.useExternalTitle ? 8 : Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: this.useExternalTitle ? 22 : Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 120)
      },
      legend: { show: false, position: 'top' },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ xLabel, value }) => [
          `Machine Group: ${this.getMachineGroupName(data, xLabel)}`,
          `Efficiency%: ${this.formatPercent(value)}`,
          yesterdayTooltip(data.find(row => row.id === String(xLabel))?.previousDay)
        ]
      },
      series,
    };
  }

  private getEfficiencyColor(efficiency: number): string {
    return this.percentBreakpointService.getColorHex(efficiency);
  }

  protected enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.lastResponse = null;
    this.cdr.markForCheck();
  }

  private getMachineGroupName(data: GroupRow[], id: string): string {
    return data.find(group => group.id === String(id))?.name ?? id;
  }

  private formatPercent(value: number): string {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
