import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MultipleBarAndLineChartComponent } from '../../src/app/components/multiple-bar-and-line-chart/multiple-bar-and-line-chart.component';
@Component({
    selector: 'app-plantwide-metrics-chart',
    imports: [CommonModule, MultipleBarAndLineChartComponent],
    templateUrl: './plantwide-metrics-chart.component.html',
    styleUrls: ['./plantwide-metrics-chart.component.scss']
})
export class PlantwideMetricsChartComponent implements OnChanges {
  @Input() data: {
    hour: number;
    availability: number;
    efficiency: number;
    throughput: number;
    oee: number;
  }[] = [];

  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;

  chartInputData: any = null;
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
      const hours = this.data.map(d => d.hour); // KEEP AS NUMBERS
  
      this.chartInputData = {
        title: 'Plantwide Metrics by Hour',
        data: {
          hours,
          series: {
            Availability: this.data.map(d => d.availability),
            Efficiency: this.data.map(d => d.efficiency),
            Throughput: this.data.map(d => d.throughput),
            OEE: this.data.map(d => d.oee)
          }
        }
      };
      
    }
  }
  
  private formatHour(hour: number): string {
    // Format as '08:00', '13:00', etc.
    return hour.toString().padStart(2, '0') + ':00';
  }
}
