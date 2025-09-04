import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface MultipleBarChartData {
  title: string;
  data: {
    hours: number[];
    series: {
      [key: string]: number[]; // e.g., 'Availability', 'Efficiency', 'Throughput', 'OEE'
    };
  };
}

@Component({
    selector: 'app-multiple-bar-and-line-chart',
    imports: [CommonModule],
    templateUrl: './multiple-bar-and-line-chart.component.html',
    styleUrls: ['./multiple-bar-and-line-chart.component.scss']
})
export class MultipleBarAndLineChartComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() data: MultipleBarChartData | null = null;
  @Input() chartWidth: number = 900;
  @Input() chartHeight: number = 500;
  @Input() title: string = '';

  // pass-through props (added to mirror other charts)
  @Input() showLegend!: boolean;
  @Input() legendPosition!: 'top' | 'right';
  @Input() legendWidthPx!: number;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;

  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;

  private observer!: MutationObserver;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data) {
      this.renderChart();
    }
  }

  ngAfterViewInit(): void {
    this.observer = new MutationObserver(() => {
      this.renderChart();
    });


    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  renderChart(): void {
    if (!this.data) return;

    const element = this.chartContainer.nativeElement;
    element.innerHTML = '';

    const margin = { 
      top: this.marginTop || 40, 
      right: this.marginRight || 40, 
      bottom: this.marginBottom || 100, 
      left: this.marginLeft || 40 
    };
    const width = this.chartWidth - margin.left - margin.right;
    const height = this.chartHeight - margin.top - margin.bottom;

    const isDarkTheme = document.body.classList.contains('dark-theme');
    const textColor = isDarkTheme ? 'white' : 'black';
    const seriesColors = {
      Availability: '#66bb6a',
      Efficiency: '#ffca28',
      Throughput: '#ef5350',
      OEE: '#ab47bc'
    };
    

    const svg = d3.select(element)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    // Move title to the top of the SVG
    svg.append('text')
      .attr('x', (width + margin.left + margin.right) / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', textColor)
      .text(this.data.title);

    const chartGroup = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Render legend at the top, horizontal (if enabled)
    const barMetrics = ['Availability', 'Efficiency', 'Throughput'];
    const legendHeight = this.showLegend !== false ? this.renderLegend(chartGroup, [...barMetrics, 'OEE'], seriesColors, textColor, width) : 0;
    const chartTop = this.showLegend !== false ? legendHeight + 10 : 0; // 10px gap below legend

    const x = d3.scaleBand()
      .domain(this.data.data.hours.map(h => this.formatHour(h)))
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(Object.values(this.data.data.series).flat())!])
      .nice()
      .range([height, 0]);

    // Create groups for bars
    const hourGroups = chartGroup.selectAll('.hour-group')
      .data(this.data.data.hours)
      .enter()
      .append('g')
      .attr('class', 'hour-group')
      .attr('transform', d => `translate(${x(this.formatHour(d))},${chartTop})`);

    const subBarWidth = x.bandwidth() / barMetrics.length;

    barMetrics.forEach((metric, i) => {
      hourGroups.append('rect')
        .attr('x', subBarWidth * i)
        .attr('y', d => {
          const value = this.data!.data.series[metric][this.data!.data.hours.indexOf(d)];
          return y(value);
        })
        .attr('width', subBarWidth)
        .attr('height', d => {
          const value = this.data!.data.series[metric][this.data!.data.hours.indexOf(d)];
          return height - y(value);
        })
        .attr('fill', seriesColors[metric as keyof typeof seriesColors])
        .style('filter', 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.1))');
    });
    
    
    // Add line for OEE
    if (this.data.data.series['OEE']) {
      const line = d3.line<number>()
        .x(d => x(this.formatHour(d))! + x.bandwidth() / 2)
        .y(d => y(this.data!.data.series['OEE'][this.data!.data.hours.indexOf(d)]) + chartTop);

      chartGroup.append('path')
        .datum(this.data.data.hours)
        .attr('fill', 'none')
        .attr('stroke', seriesColors.OEE)
        .attr('stroke-width', 2.5)
        .attr('d', line);
    }

    // Axes
    chartGroup.append('g')
      .attr('transform', `translate(0,${height + chartTop})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('fill', textColor)
      .style('font-size', '14px');

    chartGroup.append('g')
      .attr('transform', `translate(0,${chartTop})`)
      .call(d3.axisLeft(y))
      .selectAll('text')
      .style('fill', textColor)
      .style('font-size', '14px');
  }

  private renderLegend(
    svg: d3.Selection<SVGGElement, unknown, null, undefined>,
    metrics: string[],
    seriesColors: { [key: string]: string },
    textColor: string,
    width: number
  ): number {
    const maxPerRow = Math.max(1, Math.floor(width / 120));
    const rowHeight = 16;
    const rowCount = Math.ceil(metrics.length / maxPerRow);
    const legend = svg.append('g').attr('transform', `translate(0, 0)`);
    metrics.forEach((metric, i) => {
      const col = i % maxPerRow;
      const row = Math.floor(i / maxPerRow);
      const legendRow = legend.append('g')
        .attr('transform', `translate(${col * 120}, ${row * rowHeight})`);
      legendRow.append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', seriesColors[metric as keyof typeof seriesColors]);
      legendRow.append('text')
        .attr('x', 14)
        .attr('y', 9)
        .style('font-size', '12px')
        .style('fill', textColor)
        .text(metric);
    });
    return rowCount * rowHeight;
  }

  formatHour(hour: number): string {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }
}
