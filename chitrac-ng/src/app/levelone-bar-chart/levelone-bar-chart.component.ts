import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { BarChartComponent, BarChartDataPoint } from '../components/bar-chart/bar-chart.component';
import { BarChartData } from '../components/multiple-bar-chart/multiple-bar-chart.component';
import { StackedBarChartData } from '../components/stacked-bar-chart/stacked-bar-chart.component';

@Component({
    selector: 'app-levelone-bar-chart',
    imports: [CommonModule, BarChartComponent],
    templateUrl: './levelone-bar-chart.component.html',
    styleUrls: ['./levelone-bar-chart.component.scss']
})
export class LeveloneBarChartComponent {
  singleChartData: BarChartDataPoint[] = [];
  singleChartTitle: string = '';
  multipleChartData: BarChartData | null = null;
  stackedChartData: StackedBarChartData | null = null;
  chartWidth: number = 600;
  chartHeight: number = 400;

  constructor(private http: HttpClient) {
    // Load data for single bar chart
    this.http.get<{ title: string, data: BarChartDataPoint[] }>('assets/data/dummyBarChartData.json')
      .subscribe(res => {
        this.singleChartData = res.data;
        this.singleChartTitle = res.title;
      });

    // Load data for multiple bar chart
    this.http.get<BarChartData>('assets/data/dummyMultipleBarChartData.json')
      .subscribe(res => {
        this.multipleChartData = res;
      });

    // Load data for stacked bar chart
    this.http.get<StackedBarChartData>('assets/data/dummyStackedBarChart.json')
      .subscribe(res => {
        this.stackedChartData = res;
      });
  }
}
