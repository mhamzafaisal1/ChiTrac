import { PreviousDayComparison, yesterdayMarker, yesterdayTooltip, YESTERDAY_MARKER_STYLE } from '../yesterday-comparison';
// charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';

import { DateTimeService } from '../../services/date-time.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { Observable } from 'rxjs';

import { toDateTimeLocalInput } from '../../shared/utils/date-input';
import { DailyLiveChartBase } from '../daily-live-chart.base';
@Component({
  selector: 'app-daily-machine-oee-bar-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  templateUrl: './daily-machine-oee-bar-chart.component.html',
  styleUrls: ['./daily-machine-oee-bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailyMachineOeeBarChartComponent extends DailyLiveChartBase implements OnInit, OnChanges {
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend!: boolean;
  @Input() legendPosition!: "top" | "right";
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
    // console.log('DailyMachineOeeBarChart: Input changes:', changes);
    // console.log('DailyMachineOeeBarChart: Current dimensions:', this.chartWidth, 'x', this.chartHeight);
    if (changes['preloadedData'] && this.preloadedData) {
      this.stopPolling();
      this.consumeResponse('once')({ machineOee: this.preloadedData });
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

    // default [start,end] = [midnight, now]
    const now = new Date();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    this.startTime = toDateTimeLocalInput(start);
    this.endTime = toDateTimeLocalInput(now);

    if (!this.preloadedData) this.enterDummy();
    if (this.useExternalTitle) return;

    // Consolidated initial fetch logic - only one fetch call
    this.startTimeframeSync(isLive, wasConfirmed);
  }

  // ---- flow ----

  protected clearChart(): void {
    this.chartConfig = null;
    this.lastResponse = null;
  }

  protected loadData(start: string, end: string): Observable<any> {
    return this.dashboardService.getDailyMachineOee(start, end);
  }

  protected consumeResponse =
    (_source: 'once' | 'poll') =>
    (res: any) => {
      this.lastResponse = res;
      // Handle the API response structure with machineOee array
      let rows: Array<any> = [];
      
      if (res && res.machineOee && Array.isArray(res.machineOee)) {
        rows = res.machineOee;
      } else if (Array.isArray(res)) {
        rows = res;
      }
      
      // Normalize and sort by OEE desc to match "Ranked OEE% by Machine"
      const normalized = rows.map((m: any) => ({
        id: String(m.serial ?? m.id ?? `machine-${rows.indexOf(m)}`),
        previousDay: m.previousDay as PreviousDayComparison | null,
        name: m.name ?? m.machine ?? m.serial ?? 'Unknown',
        oee: Number(m.oee ?? m.efficiency ?? 0)
      })).sort((a, b) => b.oee - a.oee);

      this.chartConfig = normalized.length ? this.formatChartData(normalized) : null;
      this.isLoading = false;          // set to false unconditionally
      this.dummyMode = false;
      this.hasInitialData = !!this.chartConfig;
      
      this.cdr.markForCheck();        // <— critical
    };

  private formatChartData(data: Array<{id: string; name: string; oee: number; previousDay?: PreviousDayComparison | null}>): CartesianChartConfig {
    // Convert machine OEE data to cartesian chart format with color-coded horizontal bars
    const series: XYSeries[] = [{
      id: 'machines', title: 'OEE', type: 'bar',
      data: data.map(machine => ({
        x: machine.id, y: machine.oee, color: this.getOeeColor(machine.oee),
        ...yesterdayMarker(machine.previousDay, this.showYesterday),
      })),
      options: { barPadding: 0.2, endMarker: YESTERDAY_MARKER_STYLE },
    }];

    return {
      title: this.useExternalTitle ? '' : 'Ranked OEE% by Machine',
      showAxisLabels: false,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'horizontal',  // horizontal bars: machines on Y, OEE % on X
      yTickFormat: (key: any) => data.find(row => row.id === String(key))?.name ?? String(key),
      xType: 'linear',  // OEE values are numeric (X-axis = bar length)
      fitToContentMargins: this.useExternalTitle,
      margin: {
        top: this.useExternalTitle ? 4 : Math.max(this.marginTop || 40, 60),
        right: this.useExternalTitle ? 8 : Math.max(this.marginRight || 30, (this.legendPosition === 'right' ? 120 : 30)),
        bottom: this.useExternalTitle ? 22 : Math.max(this.marginBottom || 50, 80),
        left: Math.max(this.marginLeft || 50, 120)  // space for machine names
      },
      legend: {
        show: false,  // No legend needed for individual machine bars
        position: 'top'  // Required property, but not used since show is false
      },
      tooltip: {
        show: true,
        delayMs: 750,
        formatter: ({ xLabel, value }) => [
          `Machine: ${data.find(row => row.id === String(xLabel))?.name ?? xLabel}`,
          `OEE%: ${this.formatPercent(value)}`,
          yesterdayTooltip(data.find(row => row.id === String(xLabel))?.previousDay)
        ]
      },
      series: series
    };
  }

  private getOeeColor(oee: number): string {
    return this.percentBreakpointService.getOeColorHex(oee);
  }

  protected enterDummy(): void {
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.chartConfig = null;
    this.lastResponse = null;
    this.cdr.markForCheck();          // <— ensure overlay shows/hides
  }

  // ---- utils ----

  private formatPercent(value: number): string {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }
}
