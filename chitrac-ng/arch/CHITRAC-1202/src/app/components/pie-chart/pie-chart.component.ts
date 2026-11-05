import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface PieChartDataPoint {
  name: string;
  value: number;
}

@Component({
    selector: 'pie-chart',
    imports: [CommonModule],
    templateUrl: './pie-chart.component.html',
    styleUrls: ['./pie-chart.component.scss']
})
export class PieChartComponent implements OnChanges, AfterViewInit {
  @Input() data: PieChartDataPoint[] = [];
  @Input() title: string = '';
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;

  ngAfterViewInit(): void {
    if (this.data.length) this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] || changes['chartWidth'] || changes['chartHeight']) && this.chartContainer) {
      this.renderChart();
    }
  }

  renderChart(): void {
    const element = this.chartContainer.nativeElement;
    element.innerHTML = '';

    const width = this.chartWidth;
    const height = this.chartHeight;
    const margin = { top: 40, right: 40, bottom: 100, left: 40 };
    const radius = Math.min(width - margin.left - margin.right, height - margin.top - margin.bottom) / 2;
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? 'white' : 'black';

    const svg = d3.select(element)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', width)
      .attr('height', height)
      .style('display', 'block')
      .style('margin', '0 auto')
      //.style('font-family', "'Inter', sans-serif")
      .style('font-size', '0.875rem')
      .append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    const color = d3.scaleOrdinal()
      .domain(this.data.map(d => d.name))
      .range(d3.schemeSet2);

    const pie = d3.pie<PieChartDataPoint>().value(d => d.value);
    const arc = d3.arc<d3.PieArcDatum<PieChartDataPoint>>()
      .innerRadius(0)
      .outerRadius(radius);

    const data_ready = pie(this.data);

    svg.selectAll('path')
      .data(data_ready)
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', d => color(d.data.name) as string)
      .attr('stroke', 'white')
      .style('stroke-width', '2px');

    const polylines = svg.selectAll('polyline')
      .data(data_ready)
      .enter()
      .append('polyline')
      .attr('stroke', textColor)
      .attr('fill', 'none')
      .attr('stroke-width', 1);

    const labels = svg.selectAll('text')
      .data(data_ready)
      .enter()
      .append('text')
      .attr('dy', '0.35em')
      .style('fill', textColor)
      .style('font-size', '12px');

    data_ready.forEach((d, i) => {
      const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
      const labelRadius = radius * 1.35;
      const breakRadius = radius * 1.1;

      const startPos = arc.centroid(d);
      const breakPoint = [
        Math.sin(midAngle) * breakRadius,
        -Math.cos(midAngle) * breakRadius
      ];
      const endPoint = [
        Math.sin(midAngle) * labelRadius,
        -Math.cos(midAngle) * labelRadius
      ];
      const align = midAngle < Math.PI ? 'start' : 'end';
      const labelShift = midAngle < Math.PI ? 15 : -15;

      polylines.nodes()[i].setAttribute('points', `${startPos} ${breakPoint} ${endPoint}`);
      d3.select(labels.nodes()[i])
        .attr('transform', `translate(${endPoint[0] + labelShift}, ${endPoint[1]})`)
        .style('text-anchor', align)
        .text(`${d.data.name} (${d.data.value}%)`);
    });

    // Title
    // d3.select(element).select('svg')
    //   .append('text')
    //   .attr('x', width / 2)
    //   .attr('y', margin.top / 2)
    //   .attr('text-anchor', 'middle')
    //   .style('fill', textColor)
    //   .style('font-size', '16px')
    //   .text(this.title);
  }
}
