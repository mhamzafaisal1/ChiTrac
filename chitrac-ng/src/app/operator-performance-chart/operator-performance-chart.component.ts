import { Component, OnInit, OnDestroy, OnChanges, SimpleChanges, ElementRef, Renderer2, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../charts/cartesian-chart/cartesian-chart.component';

@Component({
    selector: 'app-operator-performance-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        CartesianChartComponent
    ],
    templateUrl: './operator-performance-chart.component.html',
    styleUrls: ['./operator-performance-chart.component.scss']
})
export class OperatorPerformanceChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;
  @Input() isModal: boolean = false;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';
  @Input() preloadedData: any = null;
  @Input() marginTop: number = 30;
  @Input() marginRight: number = 15;
  @Input() marginBottom: number = 60;
  @Input() marginLeft: number = 25;
  @Input() showLegend: boolean = true;
  @Input() legendPosition: 'top' | 'right' = 'right';
  @Input() legendWidthPx: number = 120;
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() machineSerial: string = '';
  chartConfig: CartesianChartConfig | null = null;
  loading = false;
  error: string | null = null;
  isDarkTheme = false;

  private observer!: MutationObserver;

  constructor(
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Handle input changes when component is used in carousel
    if (changes['chartWidth'] || changes['chartHeight'] || changes['marginTop'] ||
        changes['marginRight'] || changes['marginBottom'] || changes['marginLeft']) {
      // If chart config already exists, update it with new dimensions
      if (this.chartConfig) {
        this.chartConfig = {
          ...this.chartConfig,
          width: this.chartWidth || 600,
          height: this.chartHeight || 400,
          margin: {
            top: this.marginTop,
            right: this.marginRight,
            bottom: this.marginBottom,
            left: this.marginLeft
          }
        };
      }
    }

    // Re-render chart if preloaded data or mode changes
    if ((changes['preloadedData'] || changes['mode'] || changes['startTime'] || changes['endTime']) && 
        this.mode === 'dashboard' && this.preloadedData) {
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
    }
  }

  ngOnInit(): void {
    this.observeTheme();

    if (this.mode === 'dashboard' && this.preloadedData) {
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
      return;
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private observeTheme(): void {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    const el = this.elRef.nativeElement;
  }

  isValidInput(): boolean {
    return !!this.startTime && !!this.endTime && !!this.machineSerial;
  }

  private transformDataToCartesianConfig(data: any): CartesianChartConfig | null {
    const hourly = data.hourlyData || data.operatorEfficiency;
    if (!hourly || !Array.isArray(hourly)) {
      return null;
    }

    const hourlyRows = [...hourly]
      .map((hourData: any) => ({ ...hourData, hourDate: new Date(hourData.hour) }))
      .filter((hourData: any) => !Number.isNaN(hourData.hourDate.getTime()))
      .sort((a: any, b: any) => a.hourDate.getTime() - b.hourDate.getTime());

    const seenOperatorNames = new Map<string, Set<string>>();

    const hourlyRows = [...hourly]
      .map((hourData: any) => ({ ...hourData, hourDate: new Date(hourData.hour) }))
      .filter((hourData: any) => !Number.isNaN(hourData.hourDate.getTime()))
      .sort((a: any, b: any) => a.hourDate.getTime() - b.hourDate.getTime());

    hourlyRows.forEach((hourData: any) => {
      const ops = hourData.operators && Array.isArray(hourData.operators) ? hourData.operators : [];

      ops.forEach((operator: any) => {
        if (!operator.name) return;
        const operatorKey = this.getOperatorSeriesKey(operator);
        const nameSet = seenOperatorNames.get(operator.name) || new Set<string>();
        nameSet.add(operatorKey);
        seenOperatorNames.set(operator.name, nameSet);
      });
    });

    // Group points per operator. Missing operator-hour records stay in the
    // series as NaN so the line chart breaks instead of connecting across gaps.
    const operatorMap = new Map<string, { id?: number | string; name: string; title: string; data: { x: Date; y: number }[] }>();
    const operatorKeys = new Set<string>();

    hourlyRows.forEach((hourData: any) => {
      const ops = hourData.operators && Array.isArray(hourData.operators) ? hourData.operators : [];

      ops.forEach((operator: any) => {
        if (!operator.name) return;
        const y = Number(operator.efficiency);
        if (!Number.isFinite(y)) return;
        const operatorKey = this.getOperatorSeriesKey(operator);
        operatorKeys.add(operatorKey);
        if (!operatorMap.has(operatorKey)) {
          const duplicateName = (seenOperatorNames.get(operator.name)?.size || 0) > 1;
          operatorMap.set(operatorKey, {
            id: operator.id,
            name: operator.name,
            title: this.getOperatorSeriesTitle(operator, duplicateName),
            data: []
          });
        }
      });
    });

    hourlyRows.forEach((hourData: any) => {
      const ops = hourData.operators && Array.isArray(hourData.operators) ? hourData.operators : [];
      const efficienciesByOperator = new Map<string, number>();

      ops.forEach((operator: any) => {
        if (!operator.name) return;
        const y = Number(operator.efficiency);
        if (!Number.isFinite(y)) return;
        efficienciesByOperator.set(this.getOperatorSeriesKey(operator), y);
      });

      operatorKeys.forEach(operatorKey => {
        operatorMap.get(operatorKey)!.data.push({
          x: hourData.hourDate,
          y: efficienciesByOperator.get(operatorKey) ?? Number.NaN
        });
      });
    });

    // Convert map to series array with guaranteed unique colors
    const series: XYSeries[] = [];
    let index = 0;
    operatorMap.forEach((operatorData, operatorKey) => {
      series.push({
        id: operatorKey,
        title: operatorData.title,
        type: 'line',
        data: operatorData.data,
        color: this.getColorForSeries(index),   // distinct color for each
        options: {
          showDots: true,
          radius: 3
        }
      });
      index++;
    });

    const values = series.flatMap(operatorSeries =>
      operatorSeries.data.map(point => point.y)
    ).filter(Number.isFinite);
    const yMin = values.length
      ? Math.floor((Math.min(...values) - 5) / 10) * 10
      : 0;

    return {
      title: `Operator Performance - ${data.machine?.name || 'Machine'}`,
      width: this.chartWidth || 600,
      height: this.chartHeight || 400,
      orientation: 'vertical',
      xType: 'time',
      xLabel: 'Hour',
      yLabel: 'Efficiency (%)',
      yMin,
      xTickFormat: (value: any) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      margin: {
        top: this.marginTop,
        right: this.marginRight,
        bottom: this.marginBottom,
        left: this.marginLeft
      },
      legend: {
        show: this.showLegend,
        position: this.legendPosition
      },
      series: series
    };
  }

  private getOperatorSeriesKey(operator: any): string {
    const operatorId = operator?.id;
    if (operatorId !== undefined && operatorId !== null && operatorId !== '') {
      return `operator-${operatorId}`;
    }

    return `operator-name-${String(operator?.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  private getOperatorSeriesTitle(operator: any, duplicateName: boolean): string {
    const operatorName = operator?.name || 'Unknown';
    const operatorId = operator?.id;

    if (!duplicateName || operatorId === undefined || operatorId === null || operatorId === '') {
      return operatorName;
    }

    return `${operatorName} (#${operatorId})`;
  }

  private getColorForSeries(index: number): string {
    const colors = [
      '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
      '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
    ];
    return colors[index % colors.length];
  }

  // Method to update chart size (for grid layout compatibility)
  setAvailableSize(width: number, height: number): void {
    this.chartWidth = width;
    this.chartHeight = height;
    
    // Update the chart config if it exists
    if (this.chartConfig) {
      this.chartConfig = {
        ...this.chartConfig,
        width: width,
        height: height
      };
    }
  }
}
