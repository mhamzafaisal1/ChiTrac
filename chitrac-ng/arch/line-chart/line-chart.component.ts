import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges,
  AfterViewInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface LineChartDataPoint {
  label: string;
  value: number;
}

@Component({
    selector: 'line-chart',
    imports: [CommonModule],
    templateUrl: './line-chart.component.html',
    styleUrls: ['./line-chart.component.scss']
})
export class LineChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('chartContainer') private chartContainer!: ElementRef;
  @Input() data: LineChartDataPoint[] = [];
  @Input() title: string = '';
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;

  private margin = { top: 40, right: 40, bottom: 100, left: 40 };

  ngAfterViewInit(): void {
    if (this.data.length > 0) {
      this.renderChart();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] || changes['chartWidth'] || changes['chartHeight']) &&
      this.chartContainer &&
      this.data.length > 0) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    // optional cleanup
  }

  renderChart(): void {
    const element = this.chartContainer.nativeElement;
    element.innerHTML = '';

    const width = this.chartWidth;
    const height = this.chartHeight;

    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#e0e0e0' : '#333';

    const svg = d3.select(element)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', width)
      .attr('height', height)
      .style('display', 'block')
      .style('margin', '0 auto')
      //.style('font-family', "'Inter', sans-serif")
      .style('font-size', '0.875rem');

    const chartTop = this.margin.top;
    const chartBottom = height - this.margin.bottom;
    const chartLeft = this.margin.left;
    const chartRight = width - this.margin.right;

    const x = d3.scalePoint()
      .domain(this.data.map(d => d.label))
      .range([chartLeft, chartRight])
      .padding(0.5);

    const rawYMax = d3.max(this.data, d => d.value) ?? 100;
    const yMax = Math.ceil(rawYMax * 1.05);

    const y = d3.scaleLinear()
      .domain([0, yMax])
      .range([chartBottom, chartTop])
      .nice();

    const line = d3.line<LineChartDataPoint>()
      .x(d => x(d.label)!)
      .y(d => y(d.value));

    svg.append('g')
      .attr('transform', `translate(0,${chartBottom})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('fill', textColor);

    svg.append('g')
      .attr('transform', `translate(${chartLeft},0)`)
      .call(d3.axisLeft(y))
      .selectAll('text')
      .style('fill', textColor);

    svg.selectAll('.tick line')
      .style('stroke', textColor)
      .style('stroke-opacity', 0.2);

    svg.append('path')
      .datum(this.data)
      .attr('fill', 'none')
      .attr('stroke', '#4c2c92')
      .attr('stroke-width', 2)
      .attr('d', line);

    svg.selectAll('circle')
      .data(this.data)
      .enter()
      .append('circle')
      .attr('cx', d => x(d.label)!)
      .attr('cy', d => y(d.value))
      .attr('r', 4)
      .attr('fill', '#4c2c92');

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', this.margin.top / 2)
      .attr('text-anchor', 'middle')
      .style('fill', textColor)
      .style('font-size', '16px')
      .text(this.title);

    // Legend (same styling as stacked bar chart — left aligned, single item)
    // const legend = svg.append("g")
    //   .attr("font-size", 10)
    //   .attr("text-anchor", "start")
    //   .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);


    // legend.append("g")
    //   .attr("transform", `translate(0, 0)`)
    //   .each(function () {
    //     const g = d3.select(this);
    //     g.append("rect")
    //       .attr("width", 14)
    //       .attr("height", 14)
    //       .attr("fill", '#4c2c92');
    //     g.append("text")
    //       .attr("x", 20)
    //       .attr("y", 11)
    //       .style("fill", textColor)
    //       .text("Data");
    //   });
  }
}
