import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BarChartComponent, BarChartDataPoint } from '../../src/app/components/bar-chart/bar-chart.component';

@Component({
    selector: 'app-ranked-operator-bar-chart',
    imports: [CommonModule, BarChartComponent],
    templateUrl: './ranked-operator-bar-chart.component.html',
    styleUrls: ['./ranked-operator-bar-chart.component.scss']
})
export class RankedOperatorBarChartComponent implements OnChanges {
  @Input() data: any[] = [];
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;

  chartData: BarChartDataPoint[] = [];
  isDarkTheme = false;

  constructor() {
    this.isDarkTheme = document.body.classList.contains('dark-theme');

    const observer = new MutationObserver(() => {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
    });

    observer.observe(document.body, { attributes: true });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && Array.isArray(this.data)) {
      this.chartData = this.data.map((op: any, i: number) => ({
        hour: i,
        counts: op.efficiency,
        label: op.name
      }));
    }
  }
}
