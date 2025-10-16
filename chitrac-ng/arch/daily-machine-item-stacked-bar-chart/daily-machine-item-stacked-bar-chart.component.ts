import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StackedBarChartComponent, StackedBarChartData } from '../../src/app/components/stacked-bar-chart/stacked-bar-chart.component';

@Component({
    selector: 'app-daily-machine-item-stacked-bar-chart',
    imports: [CommonModule, StackedBarChartComponent],
    templateUrl: './daily-machine-item-stacked-bar-chart.component.html',
    styleUrls: ['./daily-machine-item-stacked-bar-chart.component.scss']
})
export class DailyMachineItemStackedBarChartComponent implements OnChanges {
  @Input() data: StackedBarChartData | null = null;
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;

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
    // Chart will re-render via input change
  }
}
