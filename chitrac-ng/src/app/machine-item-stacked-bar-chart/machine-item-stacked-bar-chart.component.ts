import { Component, Input, OnChanges, OnInit, AfterViewInit, SimpleChanges } from '@angular/core';
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
export class MachineItemStackedBarChartComponent implements OnInit, AfterViewInit, OnChanges {
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
    console.log('MachineItemStackedBarChart: Constructor margin values:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
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
    console.log('MachineItemStackedBarChart: Current margin values in ngOnChanges:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
    // Check if margin properties have changed and update chart config if it exists
    const marginChanged = changes['marginTop'] || changes['marginRight'] || 
                         changes['marginBottom'] || changes['marginLeft'];
    
    if (this.mode === 'dashboard' && this.preloadedData) {
      console.log('MachineItemStackedBarChart: Using preloaded data for dashboard mode');
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
      return;
    }

    if ((changes['startTime'] || changes['endTime'] || changes['machineSerial']) && this.isValid()) {
      console.log('MachineItemStackedBarChart: Fetching data due to input changes');
      this.fetchData();
    } else if (marginChanged && this.chartConfig) {
      console.log('MachineItemStackedBarChart: Updating chart config due to margin changes');
      // Update the existing chart config with new margin values
      this.chartConfig = {
        ...this.chartConfig,
        margin: {
          top: this.marginTop,
          right: this.marginRight,
          bottom: this.marginBottom,
          left: this.marginLeft
        }
      };
    }
  }

  ngOnInit(): void {
    console.log('MachineItemStackedBarChart: ngOnInit called');
    console.log('MachineItemStackedBarChart: Current margin values in ngOnInit:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
    // If we have preloaded data and are in dashboard mode, ensure chart is configured
    if (this.mode === 'dashboard' && this.preloadedData && !this.chartConfig) {
      console.log('MachineItemStackedBarChart: Initializing chart with preloaded data in ngOnInit');
      this.chartConfig = this.transformDataToCartesianConfig(this.preloadedData);
    }
    
    // Use setTimeout to ensure input properties are fully set before updating margins
    // This handles the case where input properties are set after component creation
    setTimeout(() => {
      console.log('MachineItemStackedBarChart: Delayed margin check in ngOnInit');
      console.log('MachineItemStackedBarChart: Current margin values after timeout:', {
        marginTop: this.marginTop,
        marginRight: this.marginRight,
        marginBottom: this.marginBottom,
        marginLeft: this.marginLeft
      });
      
      if (this.chartConfig && this.marginLeft !== 25) {
        console.log('MachineItemStackedBarChart: Updating chart margins after timeout');
        this.updateChartMargins();
      }
    }, 0);
  }

  ngAfterViewInit(): void {
    console.log('MachineItemStackedBarChart: ngAfterViewInit called');
    console.log('MachineItemStackedBarChart: Current margin values in ngAfterViewInit:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
    // If we're in dashboard mode and margins are still default, manually set them
    if (this.mode === 'dashboard' && this.marginLeft === 25) {
      console.log('MachineItemStackedBarChart: Detected default margins in dashboard mode, manually setting correct values');
      this.setMargins(30, 15, 60, 100);
    }
    
    // Force update margins after view is initialized
    if (this.chartConfig) {
      console.log('MachineItemStackedBarChart: Force updating margins in ngAfterViewInit');
      this.updateChartMargins();
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
    console.log('MachineItemStackedBarChart: Current margin values:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
    // The data structure is: { title: string, data: { hours: [], items: {} } }
    // Support both "items" (new format) and "operators" (legacy format) for backward compatibility
    if (!data || !data.data) {
      console.log('MachineItemStackedBarChart: Missing data property');
      return null;
    }

    const { hours, items, operators, machineNames } = data.data;
    
    // Use items if available, otherwise fall back to operators for backward compatibility
    const itemData = items || operators;
    
    console.log('MachineItemStackedBarChart: Extracted data:', { hours, items, operators, machineNames });
    
    if (!hours || !itemData || !Array.isArray(hours)) {
      console.log('MachineItemStackedBarChart: Invalid hours or items data');
      return null;
    }

    // Create series for each item
    const series: XYSeries[] = [];
    const itemKeys = Object.keys(itemData);
    
    console.log('MachineItemStackedBarChart: Item keys:', itemKeys);
    
    itemKeys.forEach((itemKey, index) => {
      const itemCounts = itemData[itemKey];
      console.log(`MachineItemStackedBarChart: Processing item ${itemKey}:`, itemCounts);
      
      if (Array.isArray(itemCounts) && itemCounts.length === hours.length) {
        const dataPoints = hours.map((hour: number, hourIndex: number) => ({
          x: hour,
          y: itemCounts[hourIndex] || 0
        }));

        console.log(`MachineItemStackedBarChart: Data points for ${itemKey}:`, dataPoints);

        series.push({
          id: itemKey,
          title: itemKey,
          type: 'bar',
          data: dataPoints,
          stack: 'itemStack', // Stack all series together
          color: this.getColorForSeries(index)
        });
      } else {
        console.log(`MachineItemStackedBarChart: Skipping ${itemKey} - invalid data length`);
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

    console.log('MachineItemStackedBarChart: Final config with margins:', {
      ...config,
      margin: config.margin
    });
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

  // Method to force update chart configuration with current margin values
  updateChartMargins(): void {
    console.log('MachineItemStackedBarChart: Force updating chart margins');
    console.log('MachineItemStackedBarChart: Current margin values:', {
      marginTop: this.marginTop,
      marginRight: this.marginRight,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft
    });
    
    if (this.chartConfig) {
      this.chartConfig = {
        ...this.chartConfig,
        margin: {
          top: this.marginTop,
          right: this.marginRight,
          bottom: this.marginBottom,
          left: this.marginLeft
        }
      };
      console.log('MachineItemStackedBarChart: Updated chart config with new margins:', this.chartConfig.margin);
    }
  }

  // Method to manually set margin values (for debugging/fixing input issues)
  setMargins(marginTop: number, marginRight: number, marginBottom: number, marginLeft: number): void {
    console.log('MachineItemStackedBarChart: Manually setting margins:', {
      marginTop, marginRight, marginBottom, marginLeft
    });
    
    this.marginTop = marginTop;
    this.marginRight = marginRight;
    this.marginBottom = marginBottom;
    this.marginLeft = marginLeft;
    
    // Update chart config if it exists
    if (this.chartConfig) {
      this.updateChartMargins();
    }
  }
}