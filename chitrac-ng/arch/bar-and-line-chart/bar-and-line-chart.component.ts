import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  AfterViewInit,
  Renderer2
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface BarAndLineChartData {
  hours: number[];
  series: {
    Availability: number[];
    Efficiency: number[];
    Throughput: number[];
    OEE: number[];
  };
}

type MetricKey = keyof BarAndLineChartData['series'];

@Component({
  selector: 'app-bar-and-line-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bar-and-line-chart.component.html',
  styleUrls: ['./bar-and-line-chart.component.scss']
})
export class BarAndLineChartComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() data: BarAndLineChartData | null = null;
  @Input() title: string = 'Plantwide Metrics';
  @Input() barSeries: MetricKey[] = ['Availability', 'Efficiency', 'Throughput'];
  @Input() lineSeries: MetricKey[] = ['OEE'];
  @Input() isDarkTheme: boolean = false;

  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;

  private observer!: MutationObserver;

  // Color map for metrics
  private readonly colors: Record<MetricKey, string> = {
    Availability: '#4CAF50',
    Efficiency: '#2196F3',
    Throughput: '#FFC107',
    OEE: '#9C27B0'
  };

  constructor(private renderer: Renderer2, private elRef: ElementRef) {}

  ngAfterViewInit(): void {
    this.detectTheme();
    this.observer = new MutationObserver(() => {
      this.detectTheme();
      this.renderChart();
    });

    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data && this.data.hours.length > 0) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    const el = this.elRef.nativeElement;
  }

  getColor(metric: MetricKey): string {
    return this.colors[metric];
  }

  renderChart(): void {
    if (!this.data) return;

    const element = this.chartContainer.nativeElement;
    element.innerHTML = '';

    // Responsive sizing
    const containerWidth = element.parentElement?.offsetWidth || 900;
    const maxWidth = 900;
    const width = Math.min(containerWidth, maxWidth) - 60; // 60 for padding
    const height = 400;
    const margin = { top: 40, right: 30, bottom: 80, left: 60 };

    const textColor = this.isDarkTheme ? 'white' : 'black';
    const backgroundColor = this.isDarkTheme ? '#121212' : '#ffffff';

    const svg = d3.select(element)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .style('display', 'block')
      .style('margin', '0 auto')
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale for hours
    const x = d3.scaleBand()
      .domain(this.data.hours.map(h => this.formatHour(h)))
      .range([0, width])
      .padding(0.28); // more padding between bars

    // Y scale for metrics
    const y = d3.scaleLinear()
      .domain([0, 100])
      .nice()
      .range([height, 0]);

    // Add X axis
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('fill', textColor)
      .style('font-size', '1rem');

    // Add Y axis
    svg.append('g')
      .call(d3.axisLeft(y))
      .selectAll('text')
      .style('fill', textColor)
      .style('font-size', '1rem');

    // Draw bars for each metric
    this.barSeries.forEach((metric, i) => {
      const barWidth = x.bandwidth() / this.barSeries.length;
      const offset = (i - (this.barSeries.length - 1) / 2) * barWidth;

      svg.selectAll(`.bar-${metric}`)
        .data(this.data!.hours)
        .enter()
        .append('rect')
        .attr('class', `bar-${metric}`)
        .attr('x', d => x(this.formatHour(d))! + offset)
        .attr('y', d => y(this.data!.series[metric][d]))
        .attr('width', barWidth)
        .attr('height', d => height - y(this.data!.series[metric][d]))
        .attr('fill', this.getColor(metric));
    });

    // Draw line for OEE
    const line = d3.line<number>()
      .x(d => x(this.formatHour(d))! + x.bandwidth() / 2)
      .y(d => y(this.data!.series.OEE[d]));

    svg.append('path')
      .datum(this.data.hours)
      .attr('fill', 'none')
      .attr('stroke', this.getColor('OEE'))
      .attr('stroke-width', 2.5)
      .attr('d', line);

    // Add title (handled in template now)
  }

  formatHour(hour: number): string {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }
}
