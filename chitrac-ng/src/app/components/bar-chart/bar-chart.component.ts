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

export interface BarChartDataPoint {
  hour: number;
  counts: number;
  label?: string;
}

@Component({
  selector: 'bar-chart',
  imports: [CommonModule],
  templateUrl: './bar-chart.component.html',
  styleUrls: ['./bar-chart.component.scss']
})
export class BarChartComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() data: BarChartDataPoint[] = [];
  @Input() title: string = '';
  @Input() mode: 'time' | 'oee' | 'count' = 'time';
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() extraBottomMargin: boolean = false;
  @Input() showLegend: boolean = false;          // left as prop
  @Input() legendPosition: 'top' | 'right' = 'right'; // left as prop
  @Input() legendWidthPx: number = 120;          // left as prop
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;

  private observer!: MutationObserver;

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] && this.data.length > 0) || 
        changes['chartWidth'] || 
        changes['chartHeight'] || 
        changes['extraBottomMargin'] ||
        changes['showLegend'] ||
        changes['legendPosition'] ||
        changes['legendWidthPx'] ||
        changes['marginTop'] ||
        changes['marginRight'] ||
        changes['marginBottom'] ||
        changes['marginLeft']) {
      this.renderChart();
    }
  }

  ngAfterViewInit(): void {
    this.observer = new MutationObserver(() => this.renderChart());
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  renderChart(): void {
    const element = this.chartContainer.nativeElement;
    element.innerHTML = '';

    const bottomMargin = this.extraBottomMargin ? 150 : this.marginBottom;

    const margin = { 
      top: this.marginTop, 
      right: this.marginRight, 
      bottom: bottomMargin, 
      left: this.marginLeft 
    };
    
    const width = this.chartWidth - margin.left - margin.right;
    const height = this.chartHeight - margin.top - margin.bottom;

    const isDarkTheme = document.body.classList.contains('dark-theme');
    const textColor = isDarkTheme ? '#e0e0e0' : '#333';

    const svg = d3.select(element)
      .append('svg')
        .attr('width', this.chartWidth)
        .attr('height', this.chartHeight)
        .style('font-size', '0.875rem');

    svg.append('text')
      .attr('x', this.chartWidth / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', textColor)
      .text(this.title);

    const chartGroup = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xLabels = this.mode === 'time'
      ? this.data.map(d => this.formatHour(d.hour))
      : this.data.map((d, i) => d.label || `#${i + 1}`);

    const x = d3.scaleBand()
      .domain(xLabels)
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(this.data, d => d.counts)!])
      .nice()
      .range([height, 0]);

    chartGroup.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end')
        .style('fill', textColor)
        .style('font-size', '14px');

    chartGroup.append('g')
      .call(d3.axisLeft(y))
      .selectAll('text')
        .style('fill', textColor)
        .style('font-size', '14px');

    chartGroup.selectAll('.bar')
      .data(this.data)
      .enter()
      .append('rect')
        .attr('class', 'bar')
        .attr('x', (d, i) => {
          const label = this.mode === 'time' ? this.formatHour(d.hour) : (d.label || `#${i + 1}`);
          return x(label)!;
        })
        .attr('y', d => y(d.counts))
        .attr('width', x.bandwidth())
        .attr('height', d => height - y(d.counts))
        .attr('fill', d => this.getBarColor(d.counts));
  }

  private formatHour(hour: number): string {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }

  private getBarColor(value: number): string {
    if (this.mode === 'count') {
      return '#42a5f5';
    }
    if (value >= 85) return '#66bb6a';
    if (value >= 60) return '#ffca28';
    return '#ef5350';
  }
}
