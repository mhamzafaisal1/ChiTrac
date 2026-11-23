import { PreviousDayComparison, yesterdayMarker, yesterdayTooltip, YESTERDAY_MARKER_STYLE } from '../yesterday-comparison';
// charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { Observable } from 'rxjs';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
type OperatorRow = { id: number | string; label: string; efficiency: number; previousDay?: PreviousDayComparison | null };

@Component({
  selector: 'app-ranked-operator-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './ranked-operator-bar-chart.component.html',
  styleUrls: ['./ranked-operator-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RankedOperatorBarChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
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
    // optional logs
    // console.log('RankedOperatorBarChart: Input changes:', changes);
    // console.log('RankedOperatorBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ topOperators: this.preloadedData });
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

    // Consolidated initial fetch logic - only one fetch call
    this.startTimeframeSync(isLive, wasConfirmed);
  }

  protected clearChart(): void {
    this.chartConfig = null;
    this.lastResponse = null;
  }

  protected loadData(start: string, end: string): Observable<any> {
    return this.dashboardService.getDailyTopOperators(start, end);
  }

  private formatOperatorName(name: any): string {
    // Handle name as object with first and surname properties
    if (name && typeof name === 'object') {
      const first = name.first || '';
      const surname = name.surname || '';
      return `${first} ${surname}`.trim() || 'Unknown';
    }
    // Handle name as string or fallback
    return String(name ?? 'Unknown');
  }

  protected consumeResponse =
    (_: 'once' | 'poll') =>
    (res: any) => {
      this.lastResponse = res;
      let rows: OperatorRow[] = [];
      if (res && res.topOperators && Array.isArray(res.topOperators)) {
        rows = res.topOperators.map((r: any, i: number) => ({
          id: r.id ?? `row-${i}`,
          previousDay: r.previousDay,
          label: this.formatOperatorName(r.name ?? r.operator ?? r.id),
          efficiency: Number(r.efficiency ?? r.oee ?? 0)
        }));
      } else if (Array.isArray(res)) {
        rows = res.map((r: any, i: number) => ({
          id: r.id ?? `row-${i}`,
          previousDay: r.previousDay,
          label: this.formatOperatorName(r.name ?? r.operator ?? r.id),
          efficiency: Number(r.efficiency ?? r.oee ?? 0)
        }));
      }

      const top = rows.sort((a, b) => b.efficiency - a.efficiency).slice(0, 10);

      this.chartConfig = top.length ? this.formatChartData(top) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: OperatorRow[]): CartesianChartConfig {
    // One bar series with unique x keys (id) so duplicate display names don't flip render path.
    // Per-bar color via XYPoint.color; Y-axis labels via yTickFormat from id -> label.
    const series: XYSeries[] = [{
      id: 'operators',
      title: 'Efficiency',
      type: 'bar',
      data: data.map(op => ({
        x: String(op.id),
        y: op.efficiency,
        ...yesterdayMarker(op.previousDay, this.showYesterday),
        color: this.getEfficiencyColor(op.efficiency),
      })),
      options: { barPadding: 0.2, endMarker: YESTERDAY_MARKER_STYLE },
    }];

    return {
      title: this.useExternalTitle ? '' : 'Top Operators by Efficiency',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      fitToContentMargins: this.useExternalTitle,
      yTickFormat: (v: any) => {
        const key = String(v);
        return data.find(d => String(d.id) === key)?.label ?? key;
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
          `Operator: ${this.getOperatorLabel(data, xLabel)}`,
          `Efficiency%: ${this.formatPercent(value)}`,
          yesterdayTooltip(data.find(row => String(row.id) === String(xLabel))?.previousDay)
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

  private getOperatorLabel(data: OperatorRow[], id: string): string {
    return data.find(op => String(op.id) === String(id))?.label ?? id;
  }

  private formatPercent(value: number): string {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
