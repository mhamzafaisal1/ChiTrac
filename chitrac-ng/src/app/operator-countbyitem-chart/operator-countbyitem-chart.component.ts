import { Component, OnInit, Input, OnDestroy, ElementRef, Renderer2, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

import { OperatorCountbyitemService } from '../services/operator-countbyitem.service';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../charts/cartesian-chart/cartesian-chart.component';

interface CountByItemData {
  title: string;
  data: {
    hours: number[];
    operators: {
      [itemName: string]: number[];
    };
  };
}

@Component({
    selector: 'app-operator-countbyitem-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        DateTimePickerComponent,
        CartesianChartComponent
    ],
    templateUrl: './operator-countbyitem-chart.component.html',
    styleUrl: './operator-countbyitem-chart.component.scss'
})
export class OperatorCountbyitemChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() operatorId?: number;
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() isModal: boolean = false;
  @Input() chartHeight: number = 400;
  @Input() chartWidth: number = 800;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';
  @Input() dashboardData?: any[];
  @Input() marginTop: number = 30;
  @Input() marginRight: number = 15;
  @Input() marginBottom: number = 60;
  @Input() marginLeft: number = 25;
  @Input() showLegend: boolean = true;
  @Input() legendPosition: 'top' | 'right' = 'right';
  @Input() legendWidthPx: number = 120;

  chartConfig: CartesianChartConfig | null = null;
  loading = false;
  error: string | null = null;
  isDarkTheme = false;
  private observer!: MutationObserver;

  constructor(
    private countByItemService: OperatorCountbyitemService,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit() {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (this.mode === 'standalone' && this.isValidInput()) {
      this.fetchData();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.mode === 'dashboard' && changes['dashboardData']?.currentValue) {
      this.processDashboardData(changes['dashboardData'].currentValue);
    } else if (this.mode === 'standalone' && 
              (changes['startTime']?.currentValue || changes['endTime']?.currentValue)) {
      this.fetchData();
    }
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  private detectTheme() {
    const dark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = dark;
    const el = this.elRef.nativeElement;
  }

  isValidInput(): boolean {
    return !!this.operatorId && !!this.startTime && !!this.endTime;
  }

  private processDashboardData(data: any[]): void {
    this.loading = true;
    try {
      // Debug: Log the received data structure
      console.log('Count by Item Dashboard Data:', {
        dataLength: data.length,
        operatorId: this.operatorId,
        firstItem: data[0],
        operatorData: data.find(item => item.operator?.id === this.operatorId)
      });

      // Find the operator data from the dashboard data
      const operatorData = data.find(item => item.operator?.id === parseInt(this.operatorId.toString()));
      if (!operatorData) {
        this.error = 'No operator data found';
        return;
      }

      console.log('Found operator data:', operatorData);
      console.log('Available data properties:', Object.keys(operatorData));
      console.log('Count by item data:', operatorData.countByItem);

      // Check for countByItem data or alternative data properties
      let countByItemData = operatorData.countByItem;
      if (!countByItemData) {
        // Try alternative data properties
        countByItemData = operatorData.itemCount || operatorData.itemSummary || operatorData.items;
        console.log('Trying alternative data properties:', countByItemData);
      }

      if (!countByItemData) {
        this.error = 'No count by item data available. Available properties: ' + Object.keys(operatorData).join(', ');
        return;
      }

      // Transform the data to cartesian chart format
      this.chartConfig = this.transformDataToCartesianConfig(countByItemData, operatorData.operator?.name || this.operatorId);
    } catch (error) {
      console.error('Error processing dashboard data:', error);
      this.error = 'Failed to process dashboard data';
    } finally {
      this.loading = false;
    }
  }

  private transformDataToCartesianConfig(rawData: any, operatorName?: string): CartesianChartConfig | null {
    // Handle the actual data structure from the API
    if (!rawData || !rawData.data) {
      return null;
    }

    const { hours, operators } = rawData.data;
    if (!hours || !operators || !Array.isArray(hours)) {
      return null;
    }

    // Get all item names from the operators object
    const items = Object.keys(operators);
    if (items.length === 0) {
      return null;
    }

    // Create series for each item
    const series: XYSeries[] = [];
    
    items.forEach((item, index) => {
      const itemData = operators[item];
      if (!Array.isArray(itemData)) {
        return;
      }

      const dataPoints = hours.map((hour: number, hourIndex: number) => ({
        x: hour,
        y: itemData[hourIndex] || 0
      }));

      series.push({
        id: item,
        title: item,
        type: 'bar',
        data: dataPoints,
        stack: 'itemStack', // Stack all series together
        color: this.getColorForSeries(index)
      });
    });

    // Debug: Log chart dimensions and data
    console.log('Count by Item Chart Debug:', {
      chartWidth: this.chartWidth,
      chartHeight: this.chartHeight,
      hoursLength: hours.length,
      itemsCount: items.length,
      seriesCount: series.length,
      firstDataPoint: series[0]?.data?.[0],
      allSeriesData: series.map(s => ({ id: s.id, dataLength: s.data.length, sampleData: s.data.slice(0, 3) })),
      rawDataStructure: { hours: hours.slice(0, 5), operators: Object.keys(operators) }
    });

    // Check if we have valid data
    if (series.length === 0) {
      console.warn('No series created - no items found in data');
      return null;
    }

    // Check if all series have data
    const hasData = series.some(s => s.data.length > 0 && s.data.some(d => d.y > 0));
    if (!hasData) {
      console.warn('No valid data points found in any series');
      return null;
    }

    return {
      title: `Operator ${operatorName || this.operatorId} - Count by Item`,
      width: this.chartWidth || 800,  // Fallback to 800 if undefined
      height: this.chartHeight || 400, // Fallback to 400 if undefined
      orientation: 'vertical',
      xType: 'linear',
      xLabel: 'Hour',
      yLabel: 'Count',
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

  fetchData(): void {
    if (!this.isValidInput()) return;

    this.loading = true;
    this.error = null;

    this.countByItemService.getOperatorCountByItem(this.startTime, this.endTime, this.operatorId)
      .subscribe({
        next: (data) => {
          this.chartConfig = this.transformDataToCartesianConfig(data.data, data.operator?.name);
          this.loading = false;
        },
        error: (err) => {
          this.error = 'Failed to fetch data. Please try again.';
          this.loading = false;
          console.error('Error fetching operator count by item data:', err);
        }
      });
  }

  onTimeRangeChange(): void {
    if (this.mode === 'standalone') {
      this.fetchData();
    }
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
