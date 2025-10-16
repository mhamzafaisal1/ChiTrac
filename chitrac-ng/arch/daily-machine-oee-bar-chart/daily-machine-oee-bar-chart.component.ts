import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BarChartComponent, BarChartDataPoint } from '../../src/app/components/bar-chart/bar-chart.component';

@Component({
    selector: 'app-daily-machine-oee-bar-chart',
    imports: [CommonModule, BarChartComponent],
    templateUrl: './daily-machine-oee-bar-chart.component.html',
    styleUrls: ['./daily-machine-oee-bar-chart.component.scss']
})
export class DailyMachineOeeBarChartComponent implements OnChanges {
  @Input() data: any[] = [];
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 200;

  chartData: BarChartDataPoint[] = [];
  isDarkTheme = false;

  constructor() {
    this.isDarkTheme = document.body.classList.contains('dark-theme');

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
    if (changes['data'] && Array.isArray(this.data)) {
      this.chartData = this.data.map((machine: any, i: number) => ({
        hour: i,
        counts: machine.oee,
        label: machine.name
      }));
    }
  }
}
