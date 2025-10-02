import { Component, OnInit, OnDestroy, ElementRef, Renderer2, Inject, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { OeeDataService } from '../services/oee-data.service';
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
export class OperatorPerformanceChartComponent implements OnInit, OnDestroy {
  @Input() chartWidth: number;
  @Input() chartHeight: number;
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

  startTime = '';
  endTime = '';
  machineSerial = '';
  chartConfig: CartesianChartConfig | null = null;
  loading = false;
  error: string | null = null;
  isDarkTheme = false;

  private observer!: MutationObserver;

  constructor(
    private oeeService: OeeDataService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    @Inject(MAT_DIALOG_DATA) private data: any
  ) {
    this.startTime = data?.startTime ?? '';
    this.endTime = data?.endTime ?? '';
    this.machineSerial = data?.machineSerial ?? '';
    this.chartWidth = data?.chartWidth ?? this.chartWidth;
    this.chartHeight = data?.chartHeight ?? this.chartHeight;
    this.isModal = data?.isModal ?? this.isModal;
    this.mode = data?.mode ?? this.mode;
    this.preloadedData = data?.preloadedData ?? this.preloadedData;
  }

  ngOnInit(): void {
    if (!this.startTime || !this.endTime) {
      const now = new Date();
      const before = new Date(now);
      before.setHours(before.getHours() - 24);
      this.startTime = before.toISOString();
      this.endTime = now.toISOString();
    }

    this.observeTheme();
    
    if (this.mode === 'dashboard' && this.preloadedData) {
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
      return;
    }

    if (this.machineSerial && this.startTime && this.endTime) {
      this.fetchData();
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

  fetchData(): void {
    if (!this.isValidInput()) {
      this.error = 'All fields are required';
      return;
    }

    this.loading = true;
    this.error = null;

    this.oeeService.getOperatorEfficiency(this.startTime, this.endTime, this.machineSerial).subscribe({
      next: (data) => {
        this.chartConfig = this.transformDataToCartesianConfig(data);
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to fetch data.';
        this.loading = false;
      }
    });
  }

  private transformDataToCartesianConfig(data: any): CartesianChartConfig | null {
    const hourly = data.hourlyData || data.operatorEfficiency;
    if (!hourly || !Array.isArray(hourly)) {
      return null;
    }

    // Group points per operator
    const operatorMap = new Map<string, { name: string; data: { x: string; y: number }[] }>();

    hourly.forEach((hourData: any) => {
      if (hourData.operators && Array.isArray(hourData.operators)) {
        const hourLabel = new Date(hourData.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        hourData.operators.forEach((operator: any) => {
          if (!operatorMap.has(operator.name)) {
            operatorMap.set(operator.name, { name: operator.name, data: [] });
          }

          operatorMap.get(operator.name)!.data.push({
            x: hourLabel,
            y: operator.efficiency ?? 0
          });
        });
      }
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

    console.log("Generated series:", series); // Debug: confirm unique colors

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
