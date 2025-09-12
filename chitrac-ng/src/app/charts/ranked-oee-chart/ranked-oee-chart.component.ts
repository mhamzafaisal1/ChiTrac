import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartesianChartComponent, CartesianChartConfig } from '../cartesian-chart/cartesian-chart.component';
import { DataAwareComponent } from '../../layouts/grid/layout-grid-twobytwo/layout-grid-twobytwo.component';

@Component({
  selector: 'app-ranked-oee-chart',
  standalone: true,
  imports: [CommonModule, CartesianChartComponent],
  template: `
    <div class="chart-container" [class.dark-mode]="isDarkTheme">
      <div class="loading-overlay" *ngIf="isLoading">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">Loading OEE data...</div>
        </div>
      </div>

      <div class="chart-content">
        <cartesian-chart
          *ngIf="chartConfig"
          [config]="chartConfig">
        </cartesian-chart>
      </div>

      <div class="dummy-chart-content" *ngIf="!chartConfig && !isLoading">
        <div class="loading-spinner dummy-chart">⏳</div>
      </div>
    </div>
  `,
  styles: [`
    .chart-container {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .chart-container.dark-mode {
      background: #1a1a1a;
      color: #e0e0e0;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }

    .chart-container.dark-mode .loading-overlay {
      background: rgba(26, 26, 26, 0.9);
    }

    .loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    .chart-container.dark-mode .loading-spinner {
      border-color: #444;
      border-top-color: #3498db;
    }

    .loading-spinner.dummy-chart {
      font-size: 24px;
      width: auto;
      height: auto;
      border: none;
      animation: pulse 2s ease-in-out infinite;
    }

    .loading-text {
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }

    .chart-container.dark-mode .loading-text {
      color: #aaa;
    }

    .chart-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .dummy-chart-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      color: #999;
      font-size: 16px;
    }

    .chart-container.dark-mode .dummy-chart-content {
      color: #666;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
  `]
})
export class RankedOeeChartComponent implements OnInit, OnDestroy, DataAwareComponent {
  @Input() chartConfig: CartesianChartConfig | null = null;
  @Input() chartWidth: number = 400;
  @Input() chartHeight: number = 300;
  @Input() marginTop: number = 30;
  @Input() marginRight: number = 15;
  @Input() marginBottom: number = 60;
  @Input() marginLeft: number = 25;
  @Input() showLegend: boolean = true;
  @Input() legendPosition: 'top' | 'right' = 'right';
  @Input() legendWidthPx: number = 120;

  isDarkTheme = false;
  isLoading = false;

  ngOnInit(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    new MutationObserver(() => {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
    }).observe(document.body, { attributes: true });
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  // Grid interface methods
  startPolling(): void {
    // Not needed for this static chart
  }

  stopPolling(): void {
    // Not needed for this static chart
  }

  setAvailableSize(w: number, h: number): void {
    this.chartWidth = w;
    this.chartHeight = h;
    if (this.chartConfig) {
      this.chartConfig.width = w;
      this.chartConfig.height = h;
    }
  }

  // DataAwareComponent interface
  setData(data: any): void {
    if (data) {
      this.chartConfig = data;
    }
  }
}
