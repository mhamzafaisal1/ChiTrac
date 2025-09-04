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
  @Input() chartWidth!: number;
  @Input() chartHeight!: number;
  @Input() showLegend: boolean = true;
  @Input() legendPosition: "top" | "right" = "right";
  @Input() legendWidthPx: number = 120;
  @Input() marginTop!: number;
  @Input() marginRight!: number;
  @Input() marginBottom!: number;
  @Input() marginLeft!: number;
  // @Input() isDarkTheme: boolean = true;

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
        changes['chartHeight'] ||
        changes['marginTop'] ||
        changes['marginRight'] ||
        changes['marginBottom'] ||
        changes['marginLeft'] ||
        changes['legendWidthPx']) {
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
    // No longer override dimensions - let parent component control all sizing
    // Re-render chart with current dimensions
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

    const host = d3.select(this.chartContainer.nativeElement);
    host.selectAll("*").remove();

    const isDark = document.body.classList.contains("dark-theme");
    const textColor = isDark ? "#e0e0e0" : "black";

    const keys = Object.keys(this.data.data.operators);
    const color = this.getColorScale(keys);

    // Legend flags (top/right).  IMPORTANT: top legend affects height; right legend does NOT change plot size.
    const legendRight = this.showLegend && this.legendPosition === "right";
    const legendTop   = this.showLegend && this.legendPosition === "top";
    
    // Gap between chart and legend
    const chartLegendGap = - 65; // Adjust this value to change the gap size

    const topLegendHeight = legendTop ? Math.ceil(keys.length / 5) * 16 + 8 : 0;

    // ⬅️ Plot area is EXACTLY as before (no width deducted for right legend)
    const width  = this.chartWidth  - this.marginLeft - this.marginRight + chartLegendGap;
    const height = this.chartHeight - this.marginTop  - this.marginBottom - topLegendHeight;

    const svg = host.append("svg")
      .attr("width", this.chartWidth)
      .attr("height", this.chartHeight)
      .style("font-size", "0.875rem")
      .attr("shape-rendering", "crispEdges");

    // Title (same as before)
    svg.append("text")
      .attr("x", this.chartWidth / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .style("font-size", "16px")
      .style("fill", textColor)
      .text(this.data.title);

    // Main chart group (same left/top anchor)
    const chart = svg.append("g")
      .attr("transform", `translate(${this.marginLeft},${this.marginTop + topLegendHeight})`);

    // Top legend (unchanged)
    if (legendTop) {
      const lg = svg.append("g")
        .attr("transform", `translate(${this.marginLeft},${this.marginTop})`);
      keys.forEach((key, i) => {
        const g = lg.append("g")
          .attr("transform", `translate(${(i % 5) * 120}, ${Math.floor(i / 5) * 16})`);
        g.append("circle").attr("r", 5).attr("cx", 5).attr("cy", 5).attr("fill", color(key));
        g.append("text").attr("x", 14).attr("y", 9).style("font-size", "12px").style("fill", textColor).text(key);
      });
    }

    // ✅ Right legend (NEW) — uses the empty space to the right, does NOT shrink the plot
    if (legendRight) {
      const x0 = this.chartWidth - this.marginRight - this.legendWidthPx - chartLegendGap;
      const y0 = (this.chartHeight / 2) - 50;
      const lg = svg.append("g").attr("transform", `translate(${x0},${y0})`);
      keys.forEach((key, i) => {
        const g = lg.append("g").attr("transform", `translate(0,${i * 16})`);
        g.append("rect").attr("width", 10).attr("height", 10).attr("fill", color(key));
        g.append("text").attr("x", 14).attr("y", 9).style("fill", textColor).style("font-size", "12px").text(key);
      });
    }

    // ----- SCALES (identical to before) -----
    const xLabels = this.mode === "machine"
      ? (this.data.data.machineNames ?? Array.from({ length: keys.length }, (_, i) => `Machine ${i + 1}`))
      : this.data.data.hours.map(String);

    const x = d3.scaleBand().domain(xLabels).range([0, width]).padding(0.2); // same padding as before

    const baseData = xLabels.map((_, i) => {
      const entry: any = {};
      keys.forEach(k => entry[k] = this.data!.data.operators[k][i] || 0);
      return entry;
    });

    const stackedData = d3.stack().keys(keys)(baseData);
    const y = d3.scaleLinear()
      .domain([0, d3.max(stackedData[stackedData.length - 1], d => d[1]) || 0])
      .nice()
      .range([height, 0]);

    // Bars (unchanged shape/spacing)
    const topSegments = new Set<string>(); const seen: Record<string, boolean> = {};
    [...stackedData].reverse().forEach(layer => {
      layer.forEach((d, i) => {
        const lbl = xLabels[i], h = y(d[0]) - y(d[1]);
        if (!seen[lbl] && h > 0) { seen[lbl] = true; topSegments.add(`${(layer as any).key}-${lbl}`); }
      });
    });

    chart.append("g").selectAll("g")
      .data(stackedData).join("g")
      .attr("fill", d => color((d as any).key))
      .selectAll("path")
      .data(layer => (layer as any).map((d: any, i: number) => ({
        ...d, xLabel: xLabels[i], key: (layer as any).key,
        isTop: topSegments.has(`${(layer as any).key}-${xLabels[i]}`)
      })))
      .join("path")
      .attr("d", (d: any) => {
        const x0 = x(d.xLabel)!;
        const yB = Math.floor(y(d[1]));
        const yT = Math.floor(y(d[0]));
        const h  = yB - yT;
        const bw = Math.floor(x.bandwidth());
        if (d.isTop && h >= 4) {
          const r = 4;
          return `M${x0 + r},${yT}a${r},${r} 0 0 1 ${r},${r}h${bw - 2*r}a${r},${r} 0 0 1 ${r},-${r}v${h - r}h${-bw}Z`;
        }
        return `M${x0},${yT}h${bw}v${h}h${-bw}Z`;
      });

    // Axes (same tick angles/sizes)
    chart.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x) as any)
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("fill", textColor)
      .style("font-size", "14px");

    chart.append("g")
      .call(d3.axisLeft(y) as any)
      .selectAll("text")
      .style("fill", textColor)
      .style("font-size", "14px");
  }
}
