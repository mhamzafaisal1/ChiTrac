import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  Renderer2,
  Input,
  SimpleChanges,
  OnChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

import { OeeDataService } from '../services/oee-data.service';
import { DateTimePickerComponent } from '../components/date-time-picker/date-time-picker.component';
import { CartesianChartComponent, CartesianChartConfig, XYSeries } from '../charts/cartesian-chart/cartesian-chart.component';

function toDateTimeLocalString(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

@Component({
    selector: 'app-operator-line-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        DateTimePickerComponent,
        CartesianChartComponent
    ],
    templateUrl: './operator-line-chart.component.html',
    styleUrls: ['./operator-line-chart.component.scss']
})
export class OperatorLineChartComponent implements OnInit, OnDestroy, OnChanges {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() operatorId: string = '';
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

  @ViewChild('chartContainer') private chartContainer!: ElementRef;

  pickerStartTime: string = '';
  pickerEndTime: string = '';

  chartConfig: CartesianChartConfig | null = null;
  operatorName = '';
  loading = false;
  error: string | null = null;
  isDarkTheme = false;

  private observer!: MutationObserver;
  private resizeObserver!: ResizeObserver;

  constructor(
    private oeeService: OeeDataService,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit(): void {
    this.detectTheme();
    this.observeTheme();
    this.observeResize();

    if (this.mode === 'standalone' && this.isValidInput()) {
      this.fetchData();
    } else if (this.mode === 'dashboard' && this.dashboardData) {
      this.processDashboardData();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['startTime'] && this.startTime) {
      this.pickerStartTime = toDateTimeLocalString(this.startTime);
    }
    if (changes['endTime'] && this.endTime) {
      this.pickerEndTime = toDateTimeLocalString(this.endTime);
    }
    if (changes['dashboardData'] && this.mode === 'dashboard' && this.dashboardData) {
      this.processDashboardData();
    } else if (this.isValidInput()) {
      this.fetchData();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
  }

  private observeTheme(): void {
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    const el = this.elRef.nativeElement;
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const container = entry.target as HTMLElement;
        this.chartWidth = container.clientWidth - 120; // Account for margins
        this.chartHeight = Math.min(400, container.clientHeight - 120); // Max height of 400px
      }
    });

    if (this.chartContainer?.nativeElement) {
      this.resizeObserver.observe(this.chartContainer.nativeElement);
    }
  }

  private isValidInput(): boolean {
    return !!this.startTime && !!this.endTime && !!this.operatorId;
  }

  private processDashboardData(): void {
    try {
      const operatorData = this.dashboardData?.find(item => item.operator?.id === parseInt(this.operatorId));
      if (!operatorData?.dailyEfficiency) {
        this.error = 'No daily efficiency data available';
        return;
      }

      this.operatorName = operatorData.dailyEfficiency.operator.name;
      this.chartConfig = this.transformDataToCartesianConfig(operatorData.dailyEfficiency.data, this.operatorName);
    } catch (error) {
      console.error('Error processing dashboard data:', error);
      this.error = 'Failed to process dashboard data';
    }
  }

  private transformDataToCartesianConfig(efficiencyData: any[], operatorName?: string): CartesianChartConfig | null {
    if (!efficiencyData || !Array.isArray(efficiencyData) || efficiencyData.length === 0) {
      return null;
    }

    // Create data points for the line chart
    const dataPoints = efficiencyData.map((entry: any) => ({
      x: new Date(entry.date).toLocaleDateString(),
      y: entry.efficiency || 0
    }));

    const series: XYSeries[] = [{
      id: 'efficiency',
      title: 'Efficiency',
      type: 'line',
      data: dataPoints,
      color: this.getColorForSeries(0),
      options: {
        showDots: true,
        radius: 3
      }
    }];

    return {
      title: `Operator ${operatorName || this.operatorId} - Daily Efficiency`,
      width: this.chartWidth,
      height: this.chartHeight,
      orientation: 'vertical',
      xType: 'category',
      xLabel: 'Date',
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

  fetchData(): void {
    if (!this.isValidInput()) {
      this.error = 'All fields are required';
      return;
    }

    this.loading = true;
    this.error = null;

    this.oeeService.getOperatorDailyEfficiency(this.startTime, this.endTime, this.operatorId).subscribe({
      next: (response) => {
        this.operatorName = response.operator.name;
        this.chartConfig = this.transformDataToCartesianConfig(response.data, this.operatorName);
        this.loading = false;
      },
      error: (err) => {
        console.error('Error fetching data:', err);
        this.error = 'Failed to fetch data';
        this.loading = false;
      }
    });
  }

  onStartTimeChange(newValue: string) {
    if (this.mode === 'standalone') {
      this.pickerStartTime = newValue;
      this.startTime = new Date(newValue).toISOString();
      this.fetchData();
    }
  }

  onEndTimeChange(newValue: string) {
    if (this.mode === 'standalone') {
      this.pickerEndTime = newValue;
      this.endTime = new Date(newValue).toISOString();
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
