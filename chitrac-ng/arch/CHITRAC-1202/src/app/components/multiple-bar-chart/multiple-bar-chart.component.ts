import { Component, Input, ElementRef, ViewChild, OnChanges, SimpleChanges, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface BarChartDataPoint {
  hour: number;
  counts: number;
  series: string;
}

export interface BarChartData {
  title: string;
  data: {
    hours: number[];
    series: {
      [key: string]: number[];
    };
  };
}

@Component({
    selector: 'app-multiple-bar-chart',
    imports: [CommonModule],
    templateUrl: './multiple-bar-chart.component.html',
    styleUrl: './multiple-bar-chart.component.scss'
})
export class MultipleBarChartComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() data: BarChartData | null = null;
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;
  @Input() chartWidth: number = 900;
  @Input() chartHeight: number = 400;
  @Input() title: string = '';

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
    element.innerHTML = ''; // Clear existing chart

    const margin = { top: 40, right: 120, bottom: 50, left: 80 };
    const width = this.chartWidth - margin.left - margin.right;
    const height = this.chartHeight - margin.top - margin.bottom;

    const isDarkTheme = document.body.classList.contains('dark-theme');
    const textColor = isDarkTheme ? 'white' : 'black';
    const seriesColors = ['#28a745', '#ffc107', '#dc3545']; // green, yellow, red

    const svg = d3.select(element)
      .append('svg')
      .attr('width', width + margin.left + margin.right + 100)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Transform the data for D3.js
    const transformedData = this.data.data.hours.flatMap(hour => 
      Object.entries(this.data.data.series).map(([series, counts]) => ({
        hour,
        counts: counts[hour],
        series
      }))
    );

    const x = d3.scaleBand()
      .domain(this.data.data.hours.map(h => this.formatHour(h)))
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(transformedData, d => d.counts)!])
      .nice()
      .range([height, 0]);

    // Create nested groups for each hour
    const hourGroups = svg.selectAll('.hour-group')
      .data(this.data.data.hours)
      .enter()
      .append('g')
      .attr('class', 'hour-group')
      .attr('transform', d => `translate(${x(this.formatHour(d))},0)`);

    // Add bars for each series within each hour group
    const seriesNames = Object.keys(this.data.data.series);
    const subBandWidth = x.bandwidth() / seriesNames.length;

    seriesNames.forEach((series, seriesIndex) => {
      hourGroups.append('rect')
        .attr('x', seriesIndex * subBandWidth)
        .attr('y', d => y(this.data!.data.series[series][d]))
        .attr('width', subBandWidth)
        .attr('height', d => height - y(this.data!.data.series[series][d]))
        .attr('fill', seriesColors[seriesIndex])
        .attr('rx', 0)
        .attr('ry', 0);
    });

    // Add x-axis
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('fill', textColor)
      .style('font-size', '14px');

    // Add y-axis
    svg.append('g')
      .call(d3.axisLeft(y))
      .selectAll('text')
      .style('fill', textColor)
      .style('font-size', '14px');

    // Add title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', textColor)
      .text(this.data.title);

    // Add legend
    const legend = svg.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${width + 20}, 0)`);

    seriesNames.forEach((series, i) => {
      const legendItem = legend.append('g')
        .attr('transform', `translate(0, ${i * 20})`);

      legendItem.append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', seriesColors[i]);

      legendItem.append('text')
        .attr('x', 15)
        .attr('y', 10)
        .style('fill', textColor)
        .style('font-size', '12px')
        .text(series);
    });
  }

  formatHour(hour: number): string {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }
}
