import { PreviousDayComparison, yesterdayMarker, yesterdayTooltip, YESTERDAY_MARKER_STYLE } from '../yesterday-comparison';
// charts/daily-count-by-item-chart/daily-count-by-item-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { Observable } from 'rxjs';

import * as d3 from 'd3';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
@Component({
  selector: 'app-daily-count-by-item-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-count-by-item-chart.component.html',
  styleUrls: ['./daily-count-by-item-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyCountByItemChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: "top" | "right";
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @Input() preloadedData?: any | null;
  @Input() useExternalTitle = false;
  @Input() showYesterday = true;
  private lastResponse: any = null;

  chartConfig: CartesianChartConfig | null = null;

  /** Palette for item bars (each item gets a different color) */
  private readonly ITEM_COLORS = [
    '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#ef5350',
    '#26a69a', '#ff7043', '#5c6bc0', '#ec407a', '#8d6e63'
  ];

  constructor(
    private dashboardService: DashboardService,
    private dateTimeService: DateTimeService
  ) {
    super();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['chartWidth'] || changes['chartHeight']) && this.chartConfig) {
      this.chartConfig = {
        ...this.chartConfig,
        width: this.chartWidth,
        height: this.chartHeight
      };
      this.cdr.markForCheck();
    }

    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ itemTotals: this.preloadedData });
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
    return this.dashboardService.getItemTotalsByType(start, end);
  }

  protected consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      this.lastResponse = res;
      let items: Array<{ itemName: string; totalCount: number; machineGroups?: string[]; previousDay?: PreviousDayComparison | null }> = [];

      if (res && res.itemTotals && res.itemTotals.items && Array.isArray(res.itemTotals.items)) {
        items = res.itemTotals.items;
      } else if (res && Array.isArray(res.items)) {
        items = res.items;
      }

      this.chartConfig = items.length ? this.formatChartData(items) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: Array<{ itemName: string; totalCount: number; machineGroups?: string[]; previousDay?: PreviousDayComparison | null }>): CartesianChartConfig {
    const maxTotal = Math.max(0, ...data.map(item => Math.max(Number(item.totalCount) || 0, this.showYesterday ? item.previousDay?.value ?? 0 : 0)));
    const scaleMax = d3.scaleLinear().domain([0, maxTotal]).nice().domain()[1] ?? 0;
    const shouldAbbreviateXAxis = scaleMax > 10000;
    const series: XYSeries[] = data.map((item, index) => ({
      id: `item-${index}`,
      title: item.itemName,
      type: 'bar',
      data: [{ x: item.itemName, y: item.totalCount, ...yesterdayMarker(item.previousDay, this.showYesterday) }],
      color: this.ITEM_COLORS[index % this.ITEM_COLORS.length],
      options: { barPadding: 0.2, endMarker: YESTERDAY_MARKER_STYLE }
    }));

    return {
      title: this.useExternalTitle ? '' : 'Item Totals by Type',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',
      xType: 'linear',
      fitToContentMargins: this.useExternalTitle,
      xTickFormat: shouldAbbreviateXAxis
        ? (v: any) => this.formatCountTickAsThousands(v)
        : (v: any) => this.formatCountTick(v),
      margin: {
        top: this.useExternalTitle ? 4 : Math.max(this.marginTop || 40, 60),
        right: this.useExternalTitle ? 8 : Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: this.useExternalTitle ? 22 : Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft ?? 0, 150) 
      },
      legend: { show: false, position: 'top' },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ xLabel, value }) => this.formatTooltip(data, xLabel, value)
      },
      series: series
    };
  }

  private formatTooltip(data: Array<{ itemName: string; totalCount: number; machineGroups?: string[]; previousDay?: PreviousDayComparison | null }>, xLabel: string, value: number): string[] {
    const row = data.find(item => item.itemName === xLabel);
    const machineGroups = this.getMachineGroups(row);
    const lines = [
      `Item Type: ${xLabel}`,
      `Total Count: ${this.formatCount(value)}`,
      yesterdayTooltip(row?.previousDay, false)
    ];
    if (machineGroups.length) {
      lines.push(`Machine Groups: ${machineGroups.join(', ')}`);
    }
    return lines;
  }

  private getMachineGroups(row: any): string[] {
    const raw = row?.machineGroups ?? row?.machineGroupNames ?? row?.departments ?? row?.machineDepartments;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(value => String(value)).filter(Boolean);
    return [String(raw)].filter(Boolean);
  }

  private formatCountTick(v: any): string {
    const value = Number(v);
    return Number.isFinite(value) ? value.toLocaleString('en-US') : String(v);
  }

  private formatCountTickAsThousands(v: any): string {
    const value = Number(v);
    if (!Number.isFinite(value)) return String(v);
    if (Math.abs(value) < 1000) return this.formatCountTick(value);

    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }

  protected enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.lastResponse = null;
    this.cdr.markForCheck();
  }

  private formatCount(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
    if (this.chartConfig) {
      this.chartConfig = {
        ...this.chartConfig,
        width: this.chartWidth,
        height: this.chartHeight
      };
    }
    this.cdr.markForCheck();
  }
}
