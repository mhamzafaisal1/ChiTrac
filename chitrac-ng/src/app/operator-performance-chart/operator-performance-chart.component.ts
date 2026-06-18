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

    // Group actual points per operator. Missing operator-hour records should not
    // be rendered as carried-forward or average values.
    const operatorMap = new Map<string, { name: string; data: { x: string; y: number }[] }>();
    hourly.forEach((hourData: any) => {
      const hourLabel = new Date(hourData.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const ops = hourData.operators && Array.isArray(hourData.operators) ? hourData.operators : [];

      ops.forEach((operator: any) => {
        if (!operator.name) return;
        const y = Number(operator.efficiency);
        if (!Number.isFinite(y)) return;
        if (!operatorMap.has(operator.name)) {
          operatorMap.set(operator.name, { name: operator.name, data: [] });
        }
        operatorMap.get(operator.name)!.data.push({ x: hourLabel, y });
      });
    });

    // Convert map to series array with guaranteed unique colors
    const series: XYSeries[] = [];
    let index = 0;
    operatorMap.forEach((operatorData, operatorName) => {
      series.push({
        id: operatorName,
        title: operatorName,
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

    return {
      title: `Operator Performance - ${data.machine?.name || 'Machine'}`,
      width: this.chartWidth || 600,
      height: this.chartHeight || 400,
      orientation: 'vertical',
      xType: 'category',
      xLabel: 'Hour',
      yLabel: 'Efficiency (%)',
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
