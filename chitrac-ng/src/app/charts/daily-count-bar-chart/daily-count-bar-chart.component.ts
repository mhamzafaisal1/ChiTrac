// charts/daily-count-bar-chart/daily-count-bar-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { Observable } from 'rxjs';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
export interface DailyCountDisplayOptions {
  averageLine: boolean;
  barColors: boolean;
}

export const DEFAULT_DAILY_COUNT_DISPLAY_OPTIONS: Readonly<DailyCountDisplayOptions> = {
  averageLine: true,
  barColors: true,
};

type DailyCountPoint = {
  date: string;
  count: number;
  movingAverage: number | null;
  previousDelta: number | null;
  averageDelta: number | null;
  previousDeltaPct: number | null;
  averageDeltaPct: number | null;
  isToday: boolean;
};

@Component({
  selector: 'app-daily-count-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-count-bar-chart.component.html',
  styleUrls: ['./daily-count-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyCountBarChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() chartWidth = 600;
  @Input() chartHeight = 400;

  // pass-through props (added to mirror other charts)
  @Input() showLegend!: boolean;
  @Input() legendPosition!: 'top' | 'right';
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @Input() preloadedData?: any[] | null;
  @Input() useExternalTitle = false;
  @Input() displayOptions: Readonly<DailyCountDisplayOptions> = DEFAULT_DAILY_COUNT_DISPLAY_OPTIONS;

  private dailyCounts: any[] = [];

  chartConfig: CartesianChartConfig | null = null;

  constructor(
    private dashboardService: DashboardService,
    private dateTimeService: DateTimeService
  ) {
    super();
  }

  ngOnInit(): void {
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    if (this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
    } else {
      const now = new Date();
      const start = new Date(); start.setHours(0,0,0,0);
      this.startTime = toDateTimeLocalInput(start);
      this.endTime = toDateTimeLocalInput(now);
    }

    if (!this.preloadedData) this.enterDummy();
    if (this.useExternalTitle) return;
    
    // Consolidated initial fetch logic - only one fetch call
    this.startTimeframeSync(isLive, wasConfirmed);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['startDate'] || changes['endDate']) && this.startDate && this.endDate) {
      this.startTime = this.startDate;
      this.endTime = this.endDate;
      // Only update time variables, no API call here
    }

    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ dailyCounts: this.preloadedData });
    } else if (changes['preloadedData'] && !this.preloadedData && this.liveMode && !this.dateTimeService.getConfirmed()) {
      this.setupPolling();
    }

    if (this.dailyCounts.length && ['displayOptions', 'chartWidth', 'chartHeight', 'useExternalTitle'].some(key => changes[key])) {
      this.chartConfig = this.formatChartData(this.dailyCounts);
      this.cdr.markForCheck();
    }
  }

  // ---- flow ----

  protected clearChart(): void {
    this.chartConfig = null;
  }

  protected loadData(start: string, end: string): Observable<any> {
    return this.dashboardService.getDailyCountTotals(start, end);
  }

  protected consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      let rows: any[] = [];
      if (res && res.dailyCounts && Array.isArray(res.dailyCounts)) {
        rows = res.dailyCounts;
      } else if (Array.isArray(res)) {
        rows = res;
      }

      this.dailyCounts = rows;
      this.chartConfig = rows.length ? this.formatChartData(rows) : null;
      this.isLoading = false;
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;

      this.cdr.markForCheck();
    };

  private formatChartData(data: any[]): CartesianChartConfig {
    const points = this.buildDailyCountPoints(data);
    const yMax = Math.max(0, ...points.flatMap(point => [
      point.count,
      point.movingAverage ?? 0
    ]));
    const shouldAbbreviateYAxis = yMax > 10000;

    // Convert daily count data to cartesian chart format
    const series: XYSeries[] = [
      {
        id: 'counts',
        title: 'Counts',
        type: 'bar',
        data: points.map(point => ({
          x: point.date,
          y: point.count,
          color: this.displayOptions.barColors ? this.getVarianceColor(point) : '#42a5f5'
        })),
        color: '#42a5f5'
      }
    ];
    if (this.displayOptions.averageLine) series.push(
      {
        id: 'moving-average',
        title: '7-Day Avg',
        type: 'line',
        data: points
          .filter(point => point.movingAverage != null)
          .map(point => ({
            x: point.date,
            y: point.movingAverage ?? 0
          })),
        color: '#ffca28',
        options: {
          showDots: false
        }
      }
    );

    return {
      title: this.useExternalTitle ? '' : 'Daily Count Totals',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'vertical',
      xType: 'category',
      fitToContentMargins: this.useExternalTitle,
      xTickFormat: (v: any) => this.formatXAxisDate(v),
      yTickFormat: shouldAbbreviateYAxis
        ? (v: any) => this.formatCountTickAsThousands(v)
        : (v: any) => this.formatCountTick(v),
      margin: {
        top: this.useExternalTitle ? 4 : Math.max(this.marginTop || 40, 60),
        right: this.useExternalTitle ? 8 : Math.max(this.marginRight || 30, 30),
        bottom: this.useExternalTitle ? 56 : Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft ?? 0, 60) 
      },
      legend: { show: false, position: 'top' },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ series, xLabel, value }) => this.formatTooltip(series.id, xLabel, value, points)
      },
      series: series
    };
  }

  private buildDailyCountPoints(data: any[]): DailyCountPoint[] {
    const todayKey = this.toDateKey(new Date());
    const raw = data.map((d: any, i: number) => ({
      date: this.toDateKey(String(d.date ?? d.label ?? `Day ${i + 1}`)),
      count: Number(d.count ?? d.counts ?? 0) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map(raw.map(point => [point.date, point.count]));

    return raw.map((point, index) => {
      const windowStart = Math.max(0, index - 6);
      const movingWindow = raw.slice(windowStart, index + 1);
      const movingAverage = movingWindow.length
        ? movingWindow.reduce((sum, row) => sum + row.count, 0) / movingWindow.length
        : null;
      const previousDate = new Date(`${point.date}T12:00:00`);
      previousDate.setDate(previousDate.getDate() - 1);
      const previous = byDate.get(this.toDateKey(previousDate)) ?? null;
      return {
        ...point,
        movingAverage,
        previousDelta: previous == null ? null : point.count - previous,
        averageDelta: movingAverage == null ? null : point.count - movingAverage,
        previousDeltaPct: previous && previous > 0
          ? ((point.count - previous) / previous) * 100
          : null,
        averageDeltaPct: movingAverage && movingAverage > 0
          ? ((point.count - movingAverage) / movingAverage) * 100
          : null,
        isToday: this.toDateKey(point.date) === todayKey
      };
    });
  }

  private getVarianceColor(point: DailyCountPoint): string {
    if (point.isToday) return '#26a69a';
    const delta = point.averageDeltaPct;
    if (delta == null) return '#42a5f5';
    if (delta <= -12) return '#ef5350';
    if (delta <= -6) return '#ffca28';
    if (delta >= 10) return '#66bb6a';
    return '#42a5f5';
  }

  private formatTooltip(seriesId: string, xLabel: string, value: number, points: DailyCountPoint[]): string[] {
    const point = points.find(row => String(row.date) === String(xLabel));
    const lines = [
      `${this.formatXAxisDate(xLabel)}${point?.isToday ? ' (Today)' : ''}`,
      seriesId === 'moving-average'
        ? `7-Day Avg: ${this.formatCount(value)}`
        : `Total Count: ${this.formatCount(value)}`
    ];

    if (seriesId !== 'moving-average' && point) {
      lines.push(`Vs Previous Day: ${this.formatComparison(point.previousDelta, point.previousDeltaPct)}`);
      lines.push(`Vs 7-Day Avg: ${this.formatComparison(point.averageDelta, point.averageDeltaPct)}`);
    }

    return lines;
  }

  protected enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.dailyCounts = [];
    this.cdr.markForCheck();
  }

  /** Format x-axis tick: month and day only (no year). */
  private formatXAxisDate(v: any): string {
    const s = String(v);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      const date = new Date(+y, +m - 1, +d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return s;
  }

  private toDateKey(value: string | Date): string {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const s = String(value);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return this.toDateKey(parsed);
    return s;
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

  private formatCount(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }

  private formatComparison(delta: number | null, percent: number | null): string {
    if (delta == null) return 'N/A';
    const count = `${delta > 0 ? '+' : ''}${this.formatCount(delta)}`;
    return `${count} (${percent == null ? 'N/A' : this.formatSignedPercent(percent)})`;
  }

  private formatSignedPercent(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
