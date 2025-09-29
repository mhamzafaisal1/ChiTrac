import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ChartTileComponent } from "../components/chart-tile/chart-tile.component";

import { DailyMachineStackedBarChartComponent } from "../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { DailyMachineItemStackedBarChartComponent } from "../charts/daily-machine-item-stacked-bar-chart/daily-machine-item-stacked-bar-chart.component";
import { DailyCountBarChartComponent } from "../charts/daily-count-bar-chart/daily-count-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { PlantwideMetricsChartComponent } from "../charts/plantwide-metrics-chart/plantwide-metrics-chart.component";

@Component({
    selector: 'app-daily-analytics-dashboard-split',
    imports: [
        CommonModule,
        ChartTileComponent,
        DailyMachineStackedBarChartComponent,
        DailyMachineOeeBarChartComponent,
        DailyMachineItemStackedBarChartComponent,
        DailyCountBarChartComponent,
        RankedOperatorBarChartComponent,
        PlantwideMetricsChartComponent
    ],
    templateUrl: './daily-analytics-dashboard-split.component.html',
    styleUrls: ['./daily-analytics-dashboard-split.component.scss']
})
export class DailyAnalyticsDashboardSplitComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(DailyMachineItemStackedBarChartComponent) itemChart!: DailyMachineItemStackedBarChartComponent;
  
  isDarkTheme: boolean = false;
  chartWidth: number = 600;
  chartHeight: number = 450;

  constructor() {}

  ngOnInit(): void {
    this.detectTheme();
    this.calculateChartDimensions();
    
    // Listen for window resize to recalculate chart dimensions
    window.addEventListener('resize', () => {
      this.calculateChartDimensions();
    });
  }

  ngAfterViewInit(): void {
    // Call setAvailableSize on chart components after view init
    setTimeout(() => {
      if (this.itemChart) {
        this.itemChart.setAvailableSize(this.chartWidth, this.chartHeight);
      }
    }, 0);
  }

  ngOnDestroy(): void {
    // Clean up event listener
    window.removeEventListener('resize', () => {
      this.calculateChartDimensions();
    });
  }

  detectTheme() {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  private calculateChartDimensions(): void {
    // Calculate responsive chart dimensions
    let tilesPerRow = 3; // Default for large screens
    
    if (window.innerWidth <= 768) {
      tilesPerRow = 1;
    } else if (window.innerWidth <= 1200) {
      tilesPerRow = 2;
    }

    // Calculate tile dimensions based on viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const tileWidth = viewportWidth / tilesPerRow;
    const tileHeight = viewportHeight / 2; // 2 rows in the grid

    // Set chart dimensions with some padding
    this.chartWidth = Math.floor(tileWidth * 0.95); // 95% of tile width
    this.chartHeight = Math.floor(tileHeight * 0.95); // 95% of tile height

    // Update chart components with new dimensions
    if (this.itemChart) {
      this.itemChart.setAvailableSize(this.chartWidth, this.chartHeight);
    }
  }
}