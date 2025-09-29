import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../charts/cartesian-chart/cartesian-chart.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';

@Component({
    selector: 'app-machine-item-stacked-bar-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        CartesianChartComponent
    ],
    templateUrl: './machine-item-stacked-bar-chart.component.html',
    styleUrls: ['./machine-item-stacked-bar-chart.component.scss']
})
export class MachineItemStackedBarChartComponent implements OnChanges {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() machineSerial: number | null = null;
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

  chartConfig: CartesianChartConfig | null = null;
  loading = false;
  error = '';
  isDarkTheme = false;

  constructor(private analyticsService: MachineAnalyticsService) {
    console.log('MachineItemStackedBarChart: Component constructor called');
    
    // Initialize dark theme based on body class
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    
    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          this.isDarkTheme = document.body.classList.contains('dark-theme');
        }
      });
    });
    
    observer.observe(document.body, { attributes: true });
  }

  ngOnChanges(changes: SimpleChanges): void {
    console.log('MachineItemStackedBarChart: ngOnChanges called with changes:', changes);
    console.log('MachineItemStackedBarChart: Current mode:', this.mode);
    console.log('MachineItemStackedBarChart: Preloaded data:', this.preloadedData);
    
    if (this.mode === 'dashboard' && this.preloadedData) {
      console.log('MachineItemStackedBarChart: Using preloaded data for dashboard mode');
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
      return;
    }

    if ((changes['startTime'] || changes['endTime'] || changes['machineSerial']) && this.isValid()) {
      console.log('MachineItemStackedBarChart: Fetching data due to input changes');
      this.fetchData();
    }
  }

  isValid(): boolean {
    return !!this.startTime && !!this.endTime && this.machineSerial !== null;
  }

  fetchData(): void {
    if (!this.isValid()) return;

    this.loading = true;
    this.error = '';
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.analyticsService.getMachineItemHourlyStack(formattedStart, formattedEnd, this.machineSerial!).subscribe({
      next: (response) => {
        this.chartConfig = this.transformDataToCartesianConfig(response);
        this.loading = false;
      },
      error: (err) => {
        console.error('Fetch failed:', err);
        this.error = 'Could not load data.';
        this.loading = false;
      }
    });
  }

  private transformDataToCartesianConfig(data: any): CartesianChartConfig | null {
    console.log('MachineItemStackedBarChart: Transforming data:', data);
    
    // The data structure is: { title: string, data: { hours: [], operators: {} } }
    if (!data || !data.data) {
      console.log('MachineItemStackedBarChart: Missing data property');
      return null;
    }

    const { hours, operators, machineNames } = data.data;
    
    console.log('MachineItemStackedBarChart: Extracted data:', { hours, operators, machineNames });
    
    if (!hours || !operators || !Array.isArray(hours)) {
      console.log('MachineItemStackedBarChart: Invalid hours or operators data');
      return null;
    }

    // Create series for each operator/item
    const series: XYSeries[] = [];
    const operatorKeys = Object.keys(operators);
    
    console.log('MachineItemStackedBarChart: Operator keys:', operatorKeys);
    
    operatorKeys.forEach((operatorKey, index) => {
      const operatorData = operators[operatorKey];
      console.log(`MachineItemStackedBarChart: Processing operator ${operatorKey}:`, operatorData);
      
      if (Array.isArray(operatorData) && operatorData.length === hours.length) {
        const dataPoints = hours.map((hour: number, hourIndex: number) => ({
          x: hour,
          y: operatorData[hourIndex] || 0
        }));

        console.log(`MachineItemStackedBarChart: Data points for ${operatorKey}:`, dataPoints);

        series.push({
          id: operatorKey,
          title: operatorKey,
          type: 'bar',
          data: dataPoints,
          stack: 'itemStack', // Stack all series together
          color: this.getColorForSeries(index)
        });
      } else {
        console.log(`MachineItemStackedBarChart: Skipping ${operatorKey} - invalid data length`);
      }
    });
    
    console.log('MachineItemStackedBarChart: Created series:', series);

    if (series.length === 0) {
      console.log('MachineItemStackedBarChart: No valid series created, returning null');
      return null;
    }

    const config = {
      title: data.title || 'Machine Item Hourly Production',
      width: this.chartWidth || 600,
      height: this.chartHeight || 400,
      orientation: 'vertical' as const,
      xType: 'linear' as const,
      xLabel: 'Hour',
      yLabel: 'Production Count',
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

    console.log('MachineItemStackedBarChart: Final config:', config);
    return config;
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