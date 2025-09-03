import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { StackedBarChartV2Component, StackedBarChartV2Data } from '../components/stacked-bar-chart-v2/stacked-bar-chart-v2.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';

@Component({
    selector: 'app-machine-item-stacked-bar-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        StackedBarChartV2Component
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

  chartData: StackedBarChartV2Data | null = null;
  loading = false;
  error = '';
  isDarkTheme = false;

  constructor(private analyticsService: MachineAnalyticsService) {
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
    if (this.mode === 'dashboard' && this.preloadedData) {
      this.chartData = this.preloadedData;
      return;
    }

    if ((changes['startTime'] || changes['endTime'] || changes['machineSerial']) && this.isValid()) {
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
        this.chartData = response;
        this.loading = false;
      },
      error: (err) => {
        console.error('Fetch failed:', err);
        this.error = 'Could not load data.';
        this.loading = false;
      }
    });
  }
}