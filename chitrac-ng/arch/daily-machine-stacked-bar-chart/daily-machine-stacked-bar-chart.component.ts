import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StackedBarChartComponent, StackedBarChartData } from '../../src/app/components/stacked-bar-chart/stacked-bar-chart.component';

interface MachineStatus {
  serial: number;
  name: string;
  runningMs: number;
  pausedMs: number;
  faultedMs: number;
}

@Component({
    selector: 'app-daily-machine-stacked-bar-chart',
    imports: [
        CommonModule,
        StackedBarChartComponent
    ],
    templateUrl: './daily-machine-stacked-bar-chart.component.html',
    styleUrls: ['./daily-machine-stacked-bar-chart.component.scss']
})
export class DailyMachineStackedBarChartComponent implements OnChanges {
  @Input() data: MachineStatus[] | null = null;
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;

  chartData: StackedBarChartData | null = null;
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
    if (changes['data'] && this.data) {
      this.chartData = this.formatMachineData(this.data);
    }
  }

  private convertMsToHours(ms: number): number {
    return ms / (1000 * 60 * 60);
  }

  private formatMachineData(data: MachineStatus[]): StackedBarChartData {
    const hours: number[] = []; 

    const operators = {
      'Running': data.map(machine => this.convertMsToHours(machine.runningMs)),
      'Paused': data.map(machine => this.convertMsToHours(machine.pausedMs)),
      'Faulted': data.map(machine => this.convertMsToHours(machine.faultedMs))
    };

    return {
      title: 'Daily Machine Status',
      data: {
        hours,
        operators,
        machineNames: data.map(machine => machine.name)
      }
    };
  }
}
