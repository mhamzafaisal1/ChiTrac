import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface PolarChartAxis {
  key: string;
  label: string;
  max?: number;
}

export interface PolarChartSeries {
  name: string;
  values: Record<string, number>;
  color?: string;
}

export interface PolarChartData {
  axes: PolarChartAxis[];
  series: PolarChartSeries[];
}

interface PolarPoint {
  axis: PolarChartAxis;
  angle: number;
  value: number;
  normalized: number;
  x: number;
  y: number;
}

@Component({
  selector: 'app-polar-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './polar-chart.component.html',
  styleUrls: ['./polar-chart.component.scss']
})
export class PolarChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() data: PolarChartData | null = null;
  @Input() title: string = 'Polar Chart';
  @Input() levels: number = 5;
  @Input() maxValue: number = 100;
  @Input() showLegend: boolean = true;
  @Input() axisDirection: 'clockwise' | 'counterclockwise' = 'clockwise';
  @Input() isDarkTheme: boolean = true;

  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef<HTMLDivElement>;

  private readonly fallbackColors = [
    '#38bdf8',
    '#f97316',
    '#22c55e',
    '#f43f5e',
    '#a78bfa',
    '#14b8a6',
    '#eab308'
  ];
  private mutationObserver?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private tooltip?: d3.Selection<HTMLDivElement, unknown, null, undefined>;

  ngAfterViewInit(): void {
    this.detectTheme();
    this.createTooltip();
    this.renderChart();

    this.mutationObserver = new MutationObserver(() => {
      this.detectTheme();
      this.renderChart();
    });
    this.mutationObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.renderChart());
      this.resizeObserver.observe(this.chartContainer.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      this.chartContainer &&
      (changes['data'] || changes['title'] || changes['levels'] || changes['maxValue'] || changes['axisDirection'])
    ) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.tooltip?.remove();
  }

  getSeriesColor(series: PolarChartSeries, index: number): string {
    return series.color || this.fallbackColors[index % this.fallbackColors.length];
  }

  hasRenderableData(): boolean {
    return !!this.data?.axes?.length && !!this.data?.series?.length;
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme') || !document.body.classList.contains('light-theme');
  }

  private createTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = d3.select(this.chartContainer.nativeElement)
      .append('div')
      .attr('class', 'polar-chart-tooltip')
      .style('opacity', '0');
  }

  private renderChart(): void {
    const element = this.chartContainer?.nativeElement;
    if (!element) return;

    d3.select(element).select('svg').remove();

    if (!this.hasRenderableData()) return;

    const axes = this.data!.axes;
    const series = this.data!.series;
    const containerWidth = element.clientWidth || element.parentElement?.clientWidth || 720;
    const width = Math.max(360, Math.min(containerWidth, 820));
    const height = Math.max(430, Math.min(width * 0.88, 620));
    const margin = { top: 92, right: 96, bottom: 58, left: 96 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const radius = Math.max(95, Math.min(innerWidth, innerHeight) / 2);
    const centerX = width / 2;
    const centerY = margin.top + innerHeight / 2;
    const levelCount = Math.max(1, Math.floor(this.levels));

    const textColor = this.isDarkTheme ? '#f8fafc' : '#1f2937';
    const mutedTextColor = this.isDarkTheme ? '#cbd5e1' : '#64748b';
    const gridColor = this.isDarkTheme ? 'rgba(226, 232, 240, 0.24)' : 'rgba(100, 116, 139, 0.28)';
    const axisColor = this.isDarkTheme ? 'rgba(226, 232, 240, 0.42)' : 'rgba(71, 85, 105, 0.34)';

    const svg = d3.select(element)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', this.title)
      .style('display', 'block')
      .style('overflow', 'visible');

    const chart = svg.append('g')
      .attr('transform', `translate(${centerX},${centerY})`);

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('class', 'polar-chart-svg-title')
      .style('fill', textColor)
      .text(this.title);

    const angleScale = d3.scaleLinear()
      .domain([0, axes.length])
      .range([0, Math.PI * 2]);

    const radiusScale = d3.scaleLinear()
      .domain([0, this.maxValue])
      .range([0, radius]);

    for (let level = 1; level <= levelCount; level += 1) {
      const levelRadius = radius * (level / levelCount);
      const levelPoints = axes.map((axis, index) => {
        const angle = this.axisAngle(index, angleScale);
        return [Math.cos(angle) * levelRadius, Math.sin(angle) * levelRadius] as [number, number];
      });

      chart.append('path')
        .datum(levelPoints)
        .attr('class', 'polar-chart-grid')
        .attr('d', d3.line<[number, number]>().x(d => d[0]).y(d => d[1]).curve(d3.curveLinearClosed))
        .attr('fill', 'none')
        .attr('stroke', gridColor);

      chart.append('text')
        .attr('x', 6)
        .attr('y', -levelRadius + 4)
        .attr('class', 'polar-chart-level-label')
        .style('fill', mutedTextColor)
        .text(`${Math.round((this.maxValue * level) / levelCount)}`);
    }

    axes.forEach((axis, index) => {
      const angle = this.axisAngle(index, angleScale);
      const axisX = Math.cos(angle) * radius;
      const axisY = Math.sin(angle) * radius;
      const labelOffset = index === 0 ? 44 : 32;
      const labelX = Math.cos(angle) * (radius + labelOffset);
      const labelY = Math.sin(angle) * (radius + labelOffset);

      chart.append('line')
        .attr('class', 'polar-chart-axis')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', axisX)
        .attr('y2', axisY)
        .attr('stroke', axisColor);

      chart.append('text')
        .attr('class', 'polar-chart-axis-label')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('dy', '0.35em')
        .attr('text-anchor', this.labelAnchor(angle))
        .style('fill', textColor)
        .text(axis.label);
    });

    const line = d3.line<PolarPoint>()
      .x(d => d.x)
      .y(d => d.y)
      .curve(d3.curveLinearClosed);

    series.forEach((item, seriesIndex) => {
      const color = this.getSeriesColor(item, seriesIndex);
      const points = axes.map((axis, axisIndex): PolarPoint => {
        const axisMax = axis.max || this.maxValue;
        const rawValue = Number(item.values?.[axis.key] || 0);
        const normalized = axisMax > 0 ? Math.max(0, Math.min(rawValue / axisMax, 1)) * this.maxValue : 0;
        const angle = this.axisAngle(axisIndex, angleScale);
        const scaledRadius = radiusScale(normalized);

        return {
          axis,
          angle,
          value: rawValue,
          normalized,
          x: Math.cos(angle) * scaledRadius,
          y: Math.sin(angle) * scaledRadius
        };
      });

      chart.append('path')
        .datum(points)
        .attr('class', 'polar-chart-area')
        .attr('d', line)
        .attr('fill', color)
        .attr('fill-opacity', series.length === 1 ? 0.28 : 0.2)
        .attr('stroke', color)
        .attr('stroke-width', 2.5);

      chart.selectAll(`.polar-chart-point-${seriesIndex}`)
        .data(points)
        .enter()
        .append('circle')
        .attr('class', `polar-chart-point polar-chart-point-${seriesIndex}`)
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', 4.5)
        .attr('fill', color)
        .attr('stroke', this.isDarkTheme ? '#111827' : '#ffffff')
        .attr('stroke-width', 1.5)
        .on('mouseenter', (event, d) => this.showTooltip(event, item.name, d))
        .on('mousemove', (event) => this.moveTooltip(event))
        .on('mouseleave', () => this.hideTooltip());
    });
  }

  private axisAngle(index: number, angleScale: d3.ScaleLinear<number, number>): number {
    const direction = this.axisDirection === 'counterclockwise' ? -1 : 1;
    return (angleScale(index) * direction) - Math.PI / 2;
  }

  private labelAnchor(angle: number): 'start' | 'middle' | 'end' {
    const normalized = Math.cos(angle);
    if (normalized > 0.28) return 'start';
    if (normalized < -0.28) return 'end';
    return 'middle';
  }

  private showTooltip(event: MouseEvent, seriesName: string, point: PolarPoint): void {
    if (!this.tooltip) return;

    this.tooltip
      .style('opacity', '1')
      .html(`
        <div class="tooltip-title">${seriesName}</div>
        <div>${point.axis.label}: ${this.formatValue(point.value)}</div>
      `);
    this.moveTooltip(event);
  }

  private moveTooltip(event: MouseEvent): void {
    if (!this.tooltip) return;
    const bounds = this.chartContainer.nativeElement.getBoundingClientRect();
    this.tooltip
      .style('left', `${event.clientX - bounds.left + 12}px`)
      .style('top', `${event.clientY - bounds.top - 18}px`);
  }

  private hideTooltip(): void {
    this.tooltip?.style('opacity', '0');
  }

  private formatValue(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return Math.abs(value) >= 10 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value.toFixed(1);
  }
}
