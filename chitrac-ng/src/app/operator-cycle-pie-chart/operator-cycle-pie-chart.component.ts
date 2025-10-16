import { Component, Input, OnInit, OnDestroy, ElementRef, Renderer2, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../charts/cartesian-chart/cartesian-chart.component';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { OperatorAnalyticsService } from '../services/operator-analytics.service';

@Component({
    selector: 'app-operator-cycle-pie-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatInputModule,
        MatFormFieldModule,
        CartesianChartComponent,
        DateTimePickerComponent
    ],
    templateUrl: './operator-cycle-pie-chart.component.html',
    styleUrl: './operator-cycle-pie-chart.component.scss'
})
export class OperatorCyclePieChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() operatorId: number;
  @Input() isModal: boolean = false;
  @Input() chartWidth: number;
  @Input() chartHeight: number;
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
  title = 'Operator Machine Time Breakdown (Pie Chart)';
  loading = false;
  error: string | null = null;
  isDarkTheme = false;
  private observer!: MutationObserver;

  constructor(
    private analyticsService: OperatorAnalyticsService,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (this.mode === 'standalone' && this.startTime && this.endTime) {
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

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private detectTheme(): void {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
    const element = this.elRef.nativeElement;
  }

  private processDashboardData(data: any[]): void {
    this.loading = true;
    try {
      // Find the operator data from the dashboard data
      const operatorData = data.find(item => item.operator?.id === this.operatorId);
      if (!operatorData?.cyclePie) {
        this.error = 'No cycle pie data available';
        return;
      }

      // Transform the data to cartesian chart format
      this.chartConfig = this.transformDataToCartesianConfig(operatorData.cyclePie, operatorData.operator?.name || this.operatorId);
    } catch (error) {
      console.error('Error processing dashboard data:', error);
      this.error = 'Failed to process dashboard data';
    } finally {
      this.loading = false;
    }
  }

  private transformDataToCartesianConfig(pieData: any[], operatorName?: string): CartesianChartConfig | null {
    if (!pieData || !Array.isArray(pieData) || pieData.length === 0) {
      return null;
    }

    // Create data points for pie chart (x=name, y=value)
    const dataPoints = pieData.map((item, index) => ({
      x: item.name,
      y: item.value
    }));

    const series: XYSeries[] = [{
      id: 'cycleTime',
      title: 'Cycle Time',
      type: 'pie',  // Use pie chart type
      data: dataPoints,
      color: this.getColorForSeries(0)
    }];


    return {
      title: `Operator ${operatorName || this.operatorId} - Machine Time Breakdown (Pie Chart)`,
      width: this.chartWidth || 400,  // Fallback to 400 if undefined
      height: this.chartHeight || 400, // Fallback to 400 if undefined
      orientation: 'vertical',
      xType: 'category',
      xLabel: 'Machine',
      yLabel: 'Time (minutes)',
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
      pie: {
        padAngle: 0.02,        // Small gap between pie slices
        cornerRadius: 4,       // Rounded corners
        innerRatio: 0          // Full pie (not donut)
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
    if (!this.startTime || !this.endTime) return;

    this.loading = true;
    this.error = null;

    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.analyticsService.getOperatorCyclePieData(formattedStart, formattedEnd, this.operatorId)
      .subscribe({
        next: (data) => {
          this.chartConfig = this.transformDataToCartesianConfig(data);
          this.loading = false;
        },
        error: (err) => {
          this.error = 'Failed to fetch data. Please try again.';
          this.loading = false;
          console.error('Error fetching operator cycle data:', err);
        }
      });
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
