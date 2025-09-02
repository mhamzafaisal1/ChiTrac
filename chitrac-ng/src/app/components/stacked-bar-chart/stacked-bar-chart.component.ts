import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import * as d3 from "d3";

export interface StackedBarChartData {
  title: string;
  data: {
    hours: number[];
    operators: { [key: string]: number[] };
    machineNames?: string[];
  };
}

export type StackedBarChartMode = "time" | "machine";

@Component({
  selector: "app-stacked-bar-chart",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./stacked-bar-chart.component.html",
  styleUrl: "./stacked-bar-chart.component.scss",
})
export class StackedBarChartComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild("chartContainer", { static: true })
  private chartContainer!: ElementRef;
  @Input() data: StackedBarChartData | null = null;
  @Input() mode: StackedBarChartMode = "time";
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 450;
  // @Input() isDarkTheme: boolean = true;
  private margin = { top: 40, right: 60, bottom: 100, left: 60 };

  // Method to set chart dimensions from parent
  setAvailableSize(width: number, height: number): void {
    this.chartWidth = width;
    this.chartHeight = height;
    this.createChart(); // Re-render with new dimensions
  }
  private observer!: MutationObserver;
  private fullscreenListener!: () => void;


  private static colorMapping = new Map<string, string>();
  private static customPalette = [
    "#66bb6a",
    "#42a5f5",
    "#ffca28",
    "#ab47bc",
    "#ef5350",
    "#29b6f6",
    "#ffa726",
    "#7e57c2",
    "#26c6da",
    "#ec407a",
  ];
  private static nextColorIndex = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] && this.data) || 
        changes['chartWidth'] || 
        changes['chartHeight']) {
      this.createChart();
    }
  }

  ngAfterViewInit(): void {
    this.observer = new MutationObserver(() => {
      d3.select(this.chartContainer.nativeElement).selectAll("*").remove();
      this.createChart(); // re-render with new theme
    });
  
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Add fullscreen mode listener
    this.setupFullscreenListener();
    
    // Check initial fullscreen state
    this.checkFullscreenState();
  
    // Initial render
    this.createChart();
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    // Remove fullscreen listener
    if (this.fullscreenListener) {
      document.removeEventListener('fullscreenchange', this.fullscreenListener);
      window.removeEventListener('resize', this.fullscreenListener);
    }
  }

  private setupFullscreenListener(): void {
    this.fullscreenListener = () => {
      this.checkFullscreenState();
    };

    // Listen for both F11-style fullscreen (resize) and programmatic fullscreen
    window.addEventListener('resize', this.fullscreenListener);
    document.addEventListener('fullscreenchange', this.fullscreenListener);
  }

  private checkFullscreenState(): void {
    const isFullscreen =
      !!document.fullscreenElement ||
      window.innerHeight === screen.height;

    this.chartHeight = isFullscreen ? 500 : 450;
    
    // Re-render chart with new dimensions
    d3.select(this.chartContainer.nativeElement).selectAll("*").remove();
    this.createChart();
  }

  
  private getColorScale(keys: string[]) {
    keys.forEach((key) => {
      if (!StackedBarChartComponent.colorMapping.has(key)) {
        const color =
          StackedBarChartComponent.customPalette[
            StackedBarChartComponent.nextColorIndex
          ];
        StackedBarChartComponent.colorMapping.set(key, color);
        StackedBarChartComponent.nextColorIndex =
          (StackedBarChartComponent.nextColorIndex + 1) %
          StackedBarChartComponent.customPalette.length;
      }
    });

    return d3
      .scaleOrdinal<string>()
      .domain(keys)
      .range(keys.map((k) => StackedBarChartComponent.colorMapping.get(k)!));
  }

  private formatHour(hour: number): string {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }

  private createChart(): void {
    if (!this.data) return;

    d3.select(this.chartContainer.nativeElement).selectAll("*").remove();
    const isDarkTheme = document.body.classList.contains("dark-theme");
    const textColor = isDarkTheme ? "#e0e0e0" : "black";

    const keys = Object.keys(this.data.data.operators);
    const color = this.getColorScale(keys);

    const width = this.chartWidth - this.margin.left - this.margin.right;
    const height = this.chartHeight - this.margin.top - this.margin.bottom;

    const svg = d3
      .select(this.chartContainer.nativeElement)
      .append("svg")
      .attr("width", this.chartWidth)
      .attr("height", this.chartHeight)
      //.style("font-family", ", sans-serif")
      .style("font-size", "0.875rem")
      .attr("shape-rendering", "crispEdges"); // Add crisp edges to eliminate anti-aliasing

    const chart = svg
      .append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

    // Add title
    svg
      .append("text")
      .attr("x", this.chartWidth / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .style("font-size", "16px")
      .style("fill", textColor)
      .text(this.data.title);

      let legend;
    // Add legend
    if (keys.length > 3) {
      legend = chart.append("g").attr("transform", "translate(-60, 0)");
    } else if (keys.length == 3) {
      legend = chart.append("g").attr("transform", "translate(90, 0)");
    } else {
      legend = chart.append("g").attr("transform", "translate(0, 0)");
    }

    keys.forEach((key, i) => {
      const g = legend
        .append("g")
        .attr(
          "transform",
          `translate(${(i % 5) * 120}, ${Math.floor(i / 5) * 16})`
        );
      g.append("circle")
        .attr("r", 5)
        .attr("cx", 5)
        .attr("cy", 5)
        .attr("fill", color(key));
      g.append("text")
        .attr("x", 14)
        .attr("y", 9)
        .style("font-size", "12px")
        .style("fill", textColor)
        .text(key);
    });

    const legendHeight = Math.ceil(keys.length / 5) * 16;
    const plotTop = legendHeight + 16;

    const xLabels =
      this.mode === "machine"
        ? this.data.data.machineNames ??
          Array.from({ length: keys.length }, (_, i) => `Machine ${i + 1}`)
        : this.data.data.hours.map(String);

    const x = d3.scaleBand().domain(xLabels).range([0, width]).padding(0.2);

    const baseData = xLabels.map((_, i) => {
      const entry: any = {};
      keys.forEach((k) => (entry[k] = this.data!.data.operators[k][i] || 0));
      return entry;
    });

    const stackedData = d3.stack().keys(keys)(baseData);

    const y = d3
      .scaleLinear()
      .domain([
        0,
        d3.max(stackedData[stackedData.length - 1], (d) => d[1]) || 0,
      ])
      .nice()
      .range([height, plotTop]);

    // Bars
    // Step 1: Track actual top segments per xLabel
const topSegments = new Set<string>();
const topTracker: Record<string, boolean> = {};

[...stackedData].reverse().forEach((layer) => {
  layer.forEach((d, i) => {
    const label = xLabels[i];
    const barHeight = y(d[0]) - y(d[1]);
    if (!topTracker[label] && barHeight > 0) {
      topTracker[label] = true;
      topSegments.add(`${layer.key}-${label}`);
    }
  });
});

// Step 2: Render bars as rects
chart
  .append("g")
  .selectAll("g")
  .data(stackedData)
  .join("g")
  .attr("fill", (d) => color(d.key))
  .each(function (layer) {
    d3.select(this)
      .selectAll()
      .data(layer.map((d, i) => ({
        ...d,
        xLabel: xLabels[i],
        key: layer.key,
        isActualTop: topSegments.has(`${layer.key}-${xLabels[i]}`)
      })))
      .join("path")
      .attr("d", (d) => {
        const x0 = x(d.xLabel)!;
        const yBottom = Math.floor(y(d[1]));
        const yTop = Math.floor(y(d[0]));
        const barHeight = yBottom - yTop;
        const barWidth = x.bandwidth();

        if (d.isActualTop && barHeight >= 4) {
          const r = 4;
          return `
            M${x0 + r},${yTop}
            a${r},${r} 0 0 1 ${r},${r}
            h${barWidth - 2 * r}
            a${r},${r} 0 0 1 ${r},-${r}
            v${barHeight - r}
            h${-barWidth}
            Z
          `;
        }

        return `M${x0},${yTop}h${barWidth}v${barHeight}h${-barWidth}Z`;
      });
  });



    // X axis
    chart
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            this.mode === "time"
              ? x.domain().filter((_, i) => i % 4 === 0)
              : x.domain()
          )
          .tickFormat((d) => (this.mode === "time" ? this.formatHour(+d) : d))
      )
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("fill", textColor)
      .style("font-size", "14px");

    // Y axis
    chart
      .append("g")
      .call(d3.axisLeft(y))
      .selectAll("text")
      .style("fill", textColor)
      .style("font-size", "14px");
  }
}
