import {
    Component, Input, ElementRef, ViewChild,
    OnChanges, SimpleChanges, AfterViewInit, OnDestroy
  } from '@angular/core';
  import { CommonModule } from '@angular/common';
  import * as d3 from 'd3';
  
  /* ===== Public Types (use everywhere) ===== */
  export type XYOrientation = 'vertical' | 'horizontal';
  export type SeriesType = 'bar' | 'line' | 'area' | 'dot' | 'lollipop';
  export type XType = 'category' | 'time' | 'linear';
  
  export interface XYPoint { x: string | number | Date; y: number; }
  
  export interface XYSeries {
    id: string;
    title: string;
    type: SeriesType;
    data: XYPoint[];
    stack?: string | null;          // same non-null label => stacked
    yAxis?: 'left' | 'right';       // reserved for future dual-axis
    color?: string;
    options?: {
      showDots?: boolean;           // for line/area
      areaOpacity?: number;         // for area
      barPadding?: number;          // 0..0.5 (defaults to 0.2)
      radius?: number;              // for dot/lollipop (default 3-5)
    };
  }
  
  export interface CartesianChartConfig {
    title?: string;
    width?: number;                 // default 900
    height?: number;                // default 500
    orientation?: XYOrientation;    // default 'vertical'
    xType?: XType;                  // default 'category'
    xLabel?: string;
    yLabel?: string;
    xTickFormat?: (v:any)=>string;
    yTickFormat?: (v:number)=>string;
    margin?: { top:number; right:number; bottom:number; left:number };
    legend?: { show: boolean; position: 'top'|'right' };
    series: XYSeries[];
  }
  
  @Component({
    selector: 'cartesian-chart',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './cartesian-chart.component.html',
    styleUrls: ['./cartesian-chart.component.scss']
  })
  export class CartesianChartComponent implements OnChanges, AfterViewInit, OnDestroy {
    @Input() config!: CartesianChartConfig;
  
    @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  
    private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private rootG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private resizeObserver?: ResizeObserver;
  
    /** external API */
    updateData = (cfgOrSeries: CartesianChartConfig | XYSeries[]) => {
      if (Array.isArray(cfgOrSeries)) {
        this.config = { ...(this.config || {}), series: cfgOrSeries };
      } else {
        this.config = { ...cfgOrSeries };
      }
      this.render();
    };
  
    updateSize = (w: number, h: number) => {
      this.config = { ...(this.config || {}), width: w, height: h, series: this.config?.series || [] };
      this.render();
    };
  
    ngAfterViewInit(): void {
      this.initSvg();
      this.render();
    }
  
    ngOnChanges(changes: SimpleChanges): void {
      if (this.host) this.render();
    }
  
    ngOnDestroy(): void {
      this.resizeObserver?.disconnect();
    }
  
    /* ===== Render ===== */
    private initSvg() {
      const el = this.host.nativeElement;
      d3.select(el).selectAll('*').remove();
  
      this.svg = d3.select(el)
        .append('svg')
        .attr('class', 'cc-svg');
  
      this.rootG = this.svg.append('g').attr('class', 'cc-root');
    }
  
    private render() {
      if (!this.config || !this.config.series?.length) {
        if (this.svg) this.svg.selectAll('*').remove();
        this.initSvg();
        return;
      }
  
      const cfg = this.withDefaults(this.config);
      const { width, height, margin, orientation } = cfg;
  
      // size
      this.svg
        .attr('width', width)
        .attr('height', height);
  
      // clear
      this.rootG.selectAll('*').remove();
      const g = this.rootG.attr('transform', `translate(${margin.left},${margin.top})`);
  
      const innerW = Math.max(10, width - margin.left - margin.right);
      const innerH = Math.max(10, height - margin.top - margin.bottom);
  
      const isHorizontal = orientation === 'horizontal';
      const isDark = document.body.classList.contains('dark-theme');
      const textColor = isDark ? '#e0e0e0' : '#333';
  
      // ===== Title =====
      if (cfg.title) {
        g.append('text')
          .attr('class', 'cc-title')
          .attr('x', innerW / 2)
          .attr('y', -10)
          .attr('text-anchor', 'middle')
          .style('fill', textColor)
          .text(cfg.title);
      }
  
      // ===== Domains =====
      const allX = this.collectXDomain(cfg);
      const yMax = this.collectYMax(cfg, allX);
  
      // ===== Scales =====
      const xScale = this.buildXScale(cfg, allX, innerW, innerH, isHorizontal);
      const yScale = isHorizontal
        ? d3.scaleBand().domain(allX.map(String)).range([0, innerH]).padding(0.1) // horizontal: category on Y for bars/lollipops
        : d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);
  
      const yScaleH = isHorizontal
        ? d3.scaleLinear().domain([0, yMax]).nice().range([0, innerW])
        : d3.scaleBand().domain(allX.map(String)).range([0, innerH]).padding(0.1);
  
      // ===== Axes =====
      const xAxisG = g.append('g').attr('class', 'cc-x-axis');
      const yAxisG = g.append('g').attr('class', 'cc-y-axis');

      const isCategory = !isHorizontal && cfg.xType === 'category';
      let rotateTicks = false;
      let tickValues: (string|number|Date)[] | undefined;

      // auto thin for category band
      if (isCategory) {
        const labels = (xScale as d3.ScaleBand<string>).domain();
        const maxLen = labels.reduce((m, s) => Math.max(m, s.length), 0);
        const approxLabelW = Math.max(8, maxLen * 7);       // ~7px per char
        const ticksFit = Math.max(1, Math.floor(innerW / (approxLabelW + 8)));
        const showEvery = Math.max(1, Math.ceil(labels.length / ticksFit));
        tickValues = labels.filter((_, i) => i % showEvery === 0);
        rotateTicks = (approxLabelW > (xScale as d3.ScaleBand<string>).bandwidth());
      }

      if (!isHorizontal) {
        const ax =
          cfg.xType === 'time'   ? d3.axisBottom(xScale as d3.ScaleTime<number, number>) :
          cfg.xType === 'linear' ? d3.axisBottom(xScale as d3.ScaleLinear<number, number>) :
                                   d3.axisBottom(xScale as d3.ScaleBand<string>).tickValues(tickValues as string[]);
        if (cfg.xTickFormat) (ax as any).tickFormat(cfg.xTickFormat);
        (ax as any).tickPadding(8);               // add padding between ticks and axis label

        xAxisG.attr('transform', `translate(0,${innerH})`).call(ax as any);

        const xt = xAxisG.selectAll<SVGTextElement, unknown>('text')
                         .style('fill', textColor).style('font-size', '12px');

        if (rotateTicks) {
          xt.attr('transform', 'rotate(-45)')
            .style('text-anchor', 'end')
            .attr('dx', '-0.5em')                 // nudge left
            .attr('dy', '0.25em');                // nudge down so they don't sit on the axis
        }

        yAxisG.call(
            d3.axisLeft(yScale as d3.ScaleLinear<number, number>)
              .tickFormat(cfg.yTickFormat ? (d: d3.NumberValue) => cfg.yTickFormat!(+d) : undefined)
          )
          .selectAll('text').style('fill', textColor).style('font-size', '12px');
      } else {
        // horizontal: x is linear, y is band
        const ax = d3.axisBottom(yScaleH as d3.ScaleLinear<number, number>);
        if (cfg.yTickFormat) (ax as any).tickFormat(cfg.yTickFormat);
        xAxisG.attr('transform', `translate(0,${innerH})`).call(ax as any)
              .selectAll('text').style('fill', textColor).style('font-size', '12px');
        yAxisG.call(d3.axisLeft(yScale as d3.ScaleBand<string>))
              .selectAll('text').style('fill', textColor).style('font-size', '12px');
      }

      // ===== Axis Labels =====
      if (cfg.xLabel) {
        g.append('text')
          .attr('class', 'cc-x-label')
          .attr('x', innerW / 2)
          .attr('y', innerH + Math.max(28, (cfg.margin?.bottom ?? 50) - 8)) // use bottom margin
          .attr('text-anchor', 'middle')
          .style('fill', textColor)
          .style('font-size', '14px')
          .text(cfg.xLabel);
      }

      if (cfg.yLabel) {
        g.append('text')
          .attr('class', 'cc-y-label')
          .attr('transform', 'rotate(-90)')
          .attr('x', -innerH / 2)
          .attr('y', -Math.max(28, (cfg.margin?.left ?? 50) - 12)) // left of y-axis
          .attr('text-anchor', 'middle')
          .style('fill', textColor).style('font-size', '14px')
          .text(cfg.yLabel);
      }

      // ===== Legend =====
      if (cfg.legend.show) {
        const items = cfg.series.map(s => ({ id: s.id, title: s.title, color: s.color || this.colorForSeries(s.id) }));
        
        if (cfg.legend.position === 'top') {
          const lg = g.append('g').attr('class', 'cc-legend').attr('transform', `translate(0, -20)`);
          let xOff = 0;
          items.forEach(it => {
            const row = lg.append('g').attr('transform', `translate(${xOff},0)`);
            row.append('rect').attr('width', 12).attr('height', 12).attr('fill', it.color);
            row.append('text').attr('x', 16).attr('y', 10).text(it.title).style('fill', textColor).style('font-size','12px');
            xOff += 16 + (it.title.length * 7) + 18;
          });
        } else if (cfg.legend.position === 'right') {
          const lg = g.append('g').attr('class', 'cc-legend').attr('transform', `translate(${innerW + 20}, 0)`);
          let yOff = 0;
          items.forEach(it => {
            const row = lg.append('g').attr('transform', `translate(0, ${yOff})`);
            row.append('rect').attr('width', 12).attr('height', 12).attr('fill', it.color);
            row.append('text').attr('x', 16).attr('y', 10).text(it.title).style('fill', textColor).style('font-size','12px');
            yOff += 20;
          });
        }
      }
  
      // ===== Series Render =====
      // bars (grouped/stacked), areas (stacked/normal), lines, dots, lollipops
      // Bars
      const barSeries = cfg.series.filter(s => s.type === 'bar');
      const barStacks = this.groupByStack(barSeries);
      barStacks.forEach(stackGroup => {
        if (stackGroup.length === 1 || stackGroup.every(s => !s.stack)) {
          // grouped (or single)
          this.renderGroupedBars(g, stackGroup, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal);
        } else {
          // stacked (all share same stack label)
          this.renderStackedBars(g, stackGroup, cfg, xScale, yScale, yScaleH, allX, innerW, innerH, isHorizontal);
        }
      });
  
      // Areas
      const areaSeries = cfg.series.filter(s => s.type === 'area');
      const areaStacks = this.groupByStack(areaSeries);
      areaStacks.forEach(stackGroup => {
        if (stackGroup.length === 1 || stackGroup.every(s => !s.stack)) {
          this.renderAreas(g, stackGroup, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal, false);
        } else {
          this.renderAreas(g, stackGroup, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal, true, allX);
        }
      });
  
      // Lines
      const lineSeries = cfg.series.filter(s => s.type === 'line');
      this.renderLines(g, lineSeries, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal);
  
      // Dots
      const dotSeries = cfg.series.filter(s => s.type === 'dot');
      this.renderDots(g, dotSeries, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal);
  
      // Lollipops
      const lolSeries = cfg.series.filter(s => s.type === 'lollipop');
      this.renderLollipops(g, lolSeries, cfg, xScale, yScale, yScaleH, innerW, innerH, isHorizontal);
    }
  
    /* ===== Helpers ===== */
    private withDefaults(cfg: CartesianChartConfig): CartesianChartConfig {
      const legend = cfg.legend || { show: true, position: 'top' };
      const baseMargin = cfg.margin || { top: 50, right: 30, bottom: 50, left: 50 };
      
      // Increase right margin for right-side legend to prevent clipping
      let margin = legend.position === 'right' && legend.show 
        ? { ...baseMargin, right: Math.max(baseMargin.right, 120) }
        : baseMargin;

      // heuristic: increase bottom margin if many/long category labels
      if ((cfg.xType ?? 'category') === 'category') {
        const labels = Array.from(new Set(cfg.series.flatMap(s => s.data.map(p => String(p.x)))));
        const maxLen = labels.reduce((m, s) => Math.max(m, s.length), 0);
        const needsRotate = labels.length * (maxLen * 7) > ((cfg.width ?? 900) - (margin.left + margin.right));
        // ticks + x-label space
        margin.bottom = Math.max(margin.bottom, needsRotate ? 92 : 56);
      }
      
      return {
        title: cfg.title || '',
        width: cfg.width ?? 900,
        height: cfg.height ?? 500,
        orientation: cfg.orientation || 'vertical',
        xType: cfg.xType || 'category',
        xLabel: cfg.xLabel,
        yLabel: cfg.yLabel,
        xTickFormat: cfg.xTickFormat,
        yTickFormat: cfg.yTickFormat,
        margin,
        legend,
        series: cfg.series || []
      };
    }
  
    private collectXDomain(cfg: CartesianChartConfig): (string|number|Date)[] {
      const all = new Set<string | number | Date>();
      cfg.series.forEach(s => s.data.forEach(p => all.add(p.x)));
      const arr = Array.from(all);
      // keep numeric/time sorted
      if (cfg.xType === 'linear') return (arr as number[]).sort((a,b)=>Number(a)-Number(b));
      if (cfg.xType === 'time')   return (arr as Date[]).sort((a,b)=>+new Date(a)-+new Date(b));
      return arr.map(String); // category
    }
  
    private collectYMax(cfg: CartesianChartConfig, xDom: any[]): number {
      // for stacked bars/areas, sum per x within stack; else max across series
      let max = 0;
      const stacks = this.groupByStack(cfg.series.filter(s => s.type === 'bar' || s.type === 'area'));
      const stackedMax = stacks.map(group => {
        if (group.length <= 1 || group.every(s => !s.stack)) return 0;
        const byX: Record<string, number> = {};
        group.forEach(s => s.data.forEach(p => {
          const key = String(p.x);
          byX[key] = (byX[key] || 0) + (p.y || 0);
        }));
        return Math.max(0, ...Object.values(byX));
      });
      const nonStackMax = cfg.series
        .filter(s => s.type !== 'bar' && s.type !== 'area')
        .reduce((m, s) => Math.max(m, ...s.data.map(p => p.y || 0)), 0);
      const simpleBarsAreas = cfg.series
        .filter(s => (s.type === 'bar' || s.type === 'area') && (!s.stack))
        .reduce((m, s) => Math.max(m, ...s.data.map(p => p.y || 0)), 0);
  
      max = Math.max(nonStackMax, simpleBarsAreas, ...stackedMax);
      return Number.isFinite(max) ? max : 0;
    }
  
    private buildXScale(
      cfg: CartesianChartConfig,
      xDomain: any[],
      innerW: number,
      innerH: number,
      isHorizontal: boolean
    ) {
      if (cfg.xType === 'category') {
        // Get barPadding from series options (use first series as reference, or default to 0.2)
        const barPadding = cfg.series[0]?.options?.barPadding ?? 0.2;
        return d3.scaleBand<string>()
          .domain(xDomain.map(String))
          .range(isHorizontal ? [0, innerH] : [0, innerW])
          .padding(barPadding);
      }
      if (cfg.xType === 'time') {
        return d3.scaleTime()
          .domain(d3.extent(xDomain as Date[]) as [Date, Date])
          .range([0, isHorizontal ? innerW : innerW]);
      }
      // linear
      return d3.scaleLinear()
        .domain(d3.extent(xDomain as number[]) as [number, number])
        .nice()
        .range([0, innerW]);
    }
  
    private groupByStack(series: XYSeries[]): XYSeries[][] {
      if (!series.length) return [];
      // group by stack label; no stack goes as its own group
      const map = new Map<string, XYSeries[]>();
      series.forEach(s => {
        const k = s.stack || `__no_stack__${s.id}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(s);
      });
      return Array.from(map.values());
    }
  
    private colorForSeries(id: string): string {
      const palette = d3.schemeTableau10;
      const i = Math.abs(this.hash(id)) % palette.length;
      return palette[i];
    }
  
    private hash(s: string) { let h=0; for (let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return h; }
  
    /* ===== Renderers ===== */
  
    private renderGroupedBars(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      innerW: number, innerH: number, isHorizontal: boolean
    ) {
      // category axis only for bars (v1). If xType is time/linear, infer step.
      const keys = Array.from(new Set(series.flatMap(s => s.data.map(p => String(p.x)))));
      // Get barPadding from series options (use first series as reference, or default to 0.2)
      const barPadding = series[0]?.options?.barPadding ?? 0.2;
      const band = (cfg.xType === 'category'
        ? (isHorizontal ? yScale : xScale)
        : d3.scaleBand<string>().domain(keys).range(isHorizontal ? [0, innerH] : [0, innerW]).padding(barPadding)
      ) as d3.ScaleBand<string>;
  
      const sub = d3.scaleBand<string>()
        .domain(series.map(s => s.id))
        .range([0, band.bandwidth()])
        .padding(0.05);
  
      series.forEach(s => {
        const color = s.color || this.colorForSeries(s.id);
        const sel = g.append('g').attr('class','cc-bar-group');
  
        s.data.forEach(p => {
          const xKey = String(p.x);
          if (isHorizontal) {
            const y = band(xKey)! + sub(s.id)!;
            const w = (yScaleH as d3.ScaleLinear<number, number>)(p.y || 0);
            sel.append('rect')
              .attr('x', 0)
              .attr('y', y)
              .attr('width', w)
              .attr('height', sub.bandwidth())
              .attr('fill', color);
          } else {
            const x = band(xKey)! + sub(s.id)!;
            const y = (yScale as d3.ScaleLinear<number, number>)(p.y || 0);
            sel.append('rect')
              .attr('x', x)
              .attr('y', y)
              .attr('width', sub.bandwidth())
              .attr('height', innerH - y)
              .attr('fill', color);
          }
        });
      });
    }
  
    private renderStackedBars(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      xDomain: any[], innerW: number, innerH: number, isHorizontal: boolean
    ) {
      // build wide matrix per x: {x, s1: y, s2: y, ...}
      const keys = series.map(s => s.id);
      const rows = (xDomain as any[]).map(x => {
        const row: any = { __x: String(x) };
        series.forEach(s => {
          const found = s.data.find(p => String(p.x) === String(x));
          row[s.id] = found ? (found.y || 0) : 0;
        });
        return row;
      });
  
      const stack = d3.stack<any>().keys(keys);
      const stacked = stack(rows);
  
      // Get barPadding from series options (use first series as reference, or default to 0.2)
      const barPadding = series[0]?.options?.barPadding ?? 0.2;
      const band = (cfg.xType === 'category'
        ? (isHorizontal ? yScale : xScale)
        : d3.scaleBand<string>().domain((xDomain as any[]).map(String)).range(isHorizontal ? [0, innerH] : [0, innerW]).padding(barPadding)
      ) as d3.ScaleBand<string>;
  
      stacked.forEach(layer => {
        const sId = layer.key;
        const color = (series.find(ss => ss.id === sId)?.color) || this.colorForSeries(sId);
        const grp = g.append('g').attr('class','cc-bar-stacked').attr('fill', color);
  
        layer.forEach((d, i) => {
          const xKey = rows[i].__x as string;
          if (isHorizontal) {
            const y = band(xKey)!;
            const x0 = (yScaleH as d3.ScaleLinear<number, number>)(d[0]);
            const x1 = (yScaleH as d3.ScaleLinear<number, number>)(d[1]);
            grp.append('rect')
              .attr('x', x0)
              .attr('y', y)
              .attr('width', Math.max(0, x1 - x0))
              .attr('height', band.bandwidth());
          } else {
            const x = band(xKey)!;
            const y0 = (yScale as d3.ScaleLinear<number, number>)(d[1]);
            const y1 = (yScale as d3.ScaleLinear<number, number>)(d[0]);
            grp.append('rect')
              .attr('x', x)
              .attr('y', y0)
              .attr('width', band.bandwidth())
              .attr('height', Math.max(0, y1 - y0));
          }
        });
      });
    }
  
    private renderAreas(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      innerW: number, innerH: number, isHorizontal: boolean,
      stacked = false, xDomain?: any[]
    ) {
      const xAcc = (p: XYPoint) => cfg.xType === 'time' ? (xScale as d3.ScaleTime<number,number>)(p.x as Date)
        : cfg.xType === 'linear' ? (xScale as d3.ScaleLinear<number,number>)(p.x as number)
        : (xScale as d3.ScaleBand<string>)(String(p.x))! + (xScale.bandwidth ? xScale.bandwidth()/2 : 0);
  
      if (!stacked) {
        series.forEach(s => {
          const color = s.color || this.colorForSeries(s.id);
          const area = d3.area<XYPoint>()
            .x(d => isHorizontal ? (yScaleH as d3.ScaleLinear<number, number>)(d.y) : xAcc(d))
            .y0(d => isHorizontal
              ? (xScale as d3.ScaleBand<string>)(String(d.x))! + ((xScale.bandwidth?.() ?? 0) / 2) - ((xScale.bandwidth?.() ?? 0) / 4)
              : innerH)
            .y1(d => isHorizontal
              ? (xScale as d3.ScaleBand<string>)(String(d.x))! + ((xScale.bandwidth?.() ?? 0) / 2) + ((xScale.bandwidth?.() ?? 0) / 4)
              : (yScale as d3.ScaleLinear<number, number>)(d.y));
          g.append('path')
            .datum(s.data)
            .attr('fill', color)
            .attr('fill-opacity', s.options?.areaOpacity ?? 0.25)
            .attr('stroke', color)
            .attr('stroke-width', 1.5)
            .attr('d', area);
        });
        return;
      }
  
      // stacked areas
      const keys = series.map(s => s.id);
      const rows = (xDomain as any[]).map(x => {
        const row: any = { __x: x };
        series.forEach(s => {
          const f = s.data.find(p => String(p.x) === String(x));
          row[s.id] = f ? (f.y || 0) : 0;
        });
        return row;
      });
      const stack = d3.stack<any>().keys(keys);
      const stackedData = stack(rows);
  
      stackedData.forEach(layer => {
        const id = layer.key;
        const color = (series.find(s => s.id === id)?.color) || this.colorForSeries(id);
        const area = d3.area<any>()
          .x((d, i) => {
            const xv = rows[i].__x;
            if (isHorizontal) {
              return (yScaleH as d3.ScaleLinear<number, number>)(d[1]);
            }
            if (cfg.xType === 'time') return (xScale as d3.ScaleTime<number,number>)(xv as Date);
            if (cfg.xType === 'linear') return (xScale as d3.ScaleLinear<number,number>)(xv as number);
            return (xScale as d3.ScaleBand<string>)(String(xv))! + (xScale.bandwidth?.() ?? 0)/2;
          })
          .y0((d, i) => {
            const xv = rows[i].__x;
            if (isHorizontal) {
              const bandCenter = (xScale as d3.ScaleBand<string>)(String(xv))! + ((xScale.bandwidth?.() ?? 0) / 2);
              return bandCenter - ((xScale.bandwidth?.() ?? 0) / 4);
            }
            return (yScale as d3.ScaleLinear<number, number>)(d[0]);
          })
          .y1((d, i) => {
            const xv = rows[i].__x;
            if (isHorizontal) {
              const bandCenter = (xScale as d3.ScaleBand<string>)(String(xv))! + ((xScale.bandwidth?.() ?? 0) / 2);
              return bandCenter + ((xScale.bandwidth?.() ?? 0) / 4);
            }
            return (yScale as d3.ScaleLinear<number, number>)(d[1]);
          });
        g.append('path')
          .datum(layer)
          .attr('fill', color)
          .attr('fill-opacity', series.find(s => s.id === id)?.options?.areaOpacity ?? 0.25)
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
          .attr('d', area);
      });
    }
  
    private renderLines(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      innerW: number, innerH: number, isHorizontal: boolean
    ) {
      const xAcc = (p: XYPoint) => cfg.xType === 'time' ? (xScale as d3.ScaleTime<number,number>)(p.x as Date)
        : cfg.xType === 'linear' ? (xScale as d3.ScaleLinear<number,number>)(p.x as number)
        : (xScale as d3.ScaleBand<string>)(String(p.x))! + (xScale.bandwidth ? xScale.bandwidth()/2 : 0);
  
      series.forEach(s => {
        const color = s.color || this.colorForSeries(s.id);
        const line = d3.line<XYPoint>()
          .x(d => isHorizontal ? (yScaleH as d3.ScaleLinear<number, number>)(d.y) : xAcc(d))
          .y(d => isHorizontal
            ? (xScale as d3.ScaleBand<string>)(String(d.x))! + ((xScale.bandwidth?.() ?? 0) / 2)
            : (yScale as d3.ScaleLinear<number, number>)(d.y));
        g.append('path')
          .datum(s.data)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('d', line);
  
        if (s.options?.showDots) {
          g.selectAll(`.cc-dot-${s.id}`)
            .data(s.data)
            .enter()
            .append('circle')
            .attr('r', s.options?.radius ?? 3)
            .attr('fill', color)
            .attr('cx', d => isHorizontal ? (yScaleH as d3.ScaleLinear<number, number>)(d.y) : xAcc(d))
            .attr('cy', d => isHorizontal
              ? (xScale as d3.ScaleBand<string>)(String(d.x))! + ((xScale.bandwidth?.() ?? 0) / 2)
              : (yScale as d3.ScaleLinear<number, number>)(d.y));
        }
      });
    }
  
    private renderDots(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      innerW: number, innerH: number, isHorizontal: boolean
    ) {
      const xAcc = (p: XYPoint) => cfg.xType === 'time' ? (xScale as d3.ScaleTime<number,number>)(p.x as Date)
        : cfg.xType === 'linear' ? (xScale as d3.ScaleLinear<number,number>)(p.x as number)
        : (xScale as d3.ScaleBand<string>)(String(p.x))! + (xScale.bandwidth ? xScale.bandwidth()/2 : 0);
  
      series.forEach(s => {
        const color = s.color || this.colorForSeries(s.id);
        const r = s.options?.radius ?? 4;
        g.selectAll(`.cc-dot-only-${s.id}`)
          .data(s.data)
          .enter()
          .append('circle')
          .attr('r', r)
          .attr('fill', color)
          .attr('cx', d => isHorizontal ? (yScaleH as d3.ScaleLinear<number, number>)(d.y) : xAcc(d))
          .attr('cy', d => isHorizontal
            ? (xScale as d3.ScaleBand<string>)(String(d.x))! + ((xScale.bandwidth?.() ?? 0) / 2)
            : (yScale as d3.ScaleLinear<number, number>)(d.y));
      });
    }
  
    private renderLollipops(
      g: d3.Selection<SVGGElement, unknown, null, undefined>,
      series: XYSeries[],
      cfg: CartesianChartConfig,
      xScale: any, yScale: any, yScaleH: any,
      innerW: number, innerH: number, isHorizontal: boolean
    ) {
      const xAcc = (p: XYPoint) => cfg.xType === 'time' ? (xScale as d3.ScaleTime<number,number>)(p.x as Date)
        : cfg.xType === 'linear' ? (xScale as d3.ScaleLinear<number,number>)(p.x as number)
        : (xScale as d3.ScaleBand<string>)(String(p.x))! + (xScale.bandwidth ? xScale.bandwidth()/2 : 0);
  
      series.forEach(s => {
        const color = s.color || this.colorForSeries(s.id);
        const r = s.options?.radius ?? 5;
  
        const grp = g.append('g').attr('class','cc-lollipop');
        s.data.forEach(p => {
          if (isHorizontal) {
            const yBand = (xScale as d3.ScaleBand<string>)(String(p.x))!;
            const xEnd = (yScaleH as d3.ScaleLinear<number, number>)(p.y);
            grp.append('line')
              .attr('x1', 0).attr('y1', yBand + (xScale.bandwidth?.() ?? 0)/2)
              .attr('x2', xEnd).attr('y2', yBand + (xScale.bandwidth?.() ?? 0)/2)
              .attr('stroke', '#888');
            grp.append('circle')
              .attr('cx', xEnd).attr('cy', yBand + (xScale.bandwidth?.() ?? 0)/2)
              .attr('r', r).attr('fill', color).attr('stroke', '#000').attr('stroke-width', 0.5);
          } else {
            const x = xAcc(p);
            const yEnd = (yScale as d3.ScaleLinear<number, number>)(p.y);
            grp.append('line')
              .attr('x1', x).attr('y1', (yScale as d3.ScaleLinear<number, number>)(0))
              .attr('x2', x).attr('y2', yEnd)
              .attr('stroke', '#888');
            grp.append('circle')
              .attr('cx', x).attr('cy', yEnd)
              .attr('r', r).attr('fill', color).attr('stroke', '#000').attr('stroke-width', 0.5);
          }
        });
      });
    }
  }
  