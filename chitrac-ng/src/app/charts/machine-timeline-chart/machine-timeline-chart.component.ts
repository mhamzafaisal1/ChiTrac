import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import * as d3 from 'd3';

type TimelineStatus = 'running' | 'paused' | 'faulted' | 'offline';

interface MachineTimelineChunk {
  id?: string;
  status?: TimelineStatus;
  statusLabel?: string;
  statusCode?: number | string;
  start?: string | Date;
  end?: string | Date;
  durationMs?: number;
  totalDurationMs?: number;
  totalCount?: number | null;
  efficiency?: number | null;
  current?: boolean;
}

interface MachineTimelineMachine {
  serial?: number;
  name?: string;
  sessions?: MachineTimelineChunk[];
}

interface MachineTimelinePayload {
  machines?: MachineTimelineMachine[];
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
}

interface TimelineTick {
  x: number;
  label: string;
}

interface TimelineViewChunk extends MachineTimelineChunk {
  id: string;
  status: TimelineStatus;
  x: number;
  width: number;
  color: string;
  tooltip: string[];
}

interface TimelineViewMachine {
  serial: number | string;
  name: string;
  y: number;
  barY: number;
  chunks: TimelineViewChunk[];
}

@Component({
  selector: 'app-machine-timeline-chart',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './machine-timeline-chart.component.html',
  styleUrls: ['./machine-timeline-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MachineTimelineChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static nextClipId = 0;

  @ViewChild('tooltipEl') tooltipEl?: ElementRef<HTMLElement>;

  @ViewChild('timelineSvg')
  set timelineSvg(ref: ElementRef<SVGSVGElement> | undefined) {
    this.detachZoom();
    this.svgElement = ref?.nativeElement;
    this.configureZoom();
  }

  @Input() chartWidth = 600;
  @Input() chartHeight = 450;
  @Input() preloadedData?: MachineTimelinePayload | MachineTimelineMachine[] | null;
  @Input() useExternalTitle = false;

  isLoading = false;
  hasInitialData = false;
  dummyMode = true;
  isZoomed = false;
  zoomLevel = 1;
  readonly clipPathId = `machine-timeline-clip-${++MachineTimelineChartComponent.nextClipId}`;
  viewMachines: TimelineViewMachine[] = [];
  ticks: TimelineTick[] = [];
  tooltip: { visible: boolean; x: number; y: number; lines: string[] } = {
    visible: false,
    x: 0,
    y: 0,
    lines: [],
  };

  svgWidth = 600;
  svgHeight = 360;
  plotLeft = 116;
  plotRight = 16;
  plotTop = 18;
  plotBottom = 30;
  innerWidth = 468;
  innerHeight = 312;
  barHeight = 14;

  private rangeStart: Date | null = null;
  private rangeEnd: Date | null = null;
  private sourceMachines: MachineTimelineMachine[] = [];
  private baseTimeScale = d3.scaleTime<number, number>();
  private visibleTimeScale = d3.scaleTime<number, number>();
  private zoomTransform = d3.zoomIdentity;
  private pendingZoomTransform = d3.zoomIdentity;
  private zoomBehavior?: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private svgElement?: SVGSVGElement;
  private measuredWidth = 0;
  private measuredHeight = 0;
  private resizeFrame = 0;
  private zoomFrame = 0;
  private resizeObserver?: ResizeObserver;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  ngAfterViewInit(): void {
    this.setupResizeObserver();
    this.scheduleSizeSync();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.preloadedData) {
      this.cancelPendingZoom();
      this.zoomTransform = d3.zoomIdentity;
      this.enterDummy();
      return;
    }
    const dataChanged = Boolean(changes['preloadedData']);
    if (dataChanged) this.cancelPendingZoom();
    this.buildView(dataChanged);
  }

  ngOnDestroy(): void {
    this.detachZoom();
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.cancelPendingZoom();
  }

  zoomBy(factor: number): void {
    if (!this.svgElement || !this.zoomBehavior) return;
    d3.select(this.svgElement).call(this.zoomBehavior.scaleBy, factor);
  }

  resetZoom(): void {
    if (!this.svgElement || !this.zoomBehavior) {
      this.applyZoomTransform(d3.zoomIdentity);
      return;
    }
    d3.select(this.svgElement).call(this.zoomBehavior.transform, d3.zoomIdentity);
  }

  trackMachine(_index: number, machine: TimelineViewMachine): number | string {
    return machine.serial;
  }

  trackChunk(_index: number, chunk: TimelineViewChunk): string {
    return chunk.id;
  }

  onChunkEnter(event: MouseEvent, chunk: TimelineViewChunk): void {
    this.tooltip = {
      visible: true,
      x: 0,
      y: 0,
      lines: chunk.tooltip,
    };
    this.cdr.detectChanges();

    const position = this.resolveTooltipPosition(event);
    this.tooltip = {
      ...this.tooltip,
      x: position.x,
      y: position.y,
    };
    this.cdr.markForCheck();
  }

  onChunkMove(event: MouseEvent): void {
    if (!this.tooltip.visible) return;
    const position = this.resolveTooltipPosition(event);
    this.tooltip = {
      ...this.tooltip,
      x: position.x,
      y: position.y,
    };
    this.cdr.markForCheck();
  }

  onChunkLeave(): void {
    this.tooltip = { ...this.tooltip, visible: false };
    this.cdr.markForCheck();
  }

  private buildView(resetZoom = false): void {
    const preservedDomain = !resetZoom && this.isZoomed
      ? this.visibleTimeScale.domain().map((date) => new Date(date))
      : null;
    const payload = this.normalizePayload(this.preloadedData);
    const machines = payload.machines || [];
    const range = this.resolveRange(payload, machines);

    this.rangeStart = range.start;
    this.rangeEnd = range.end;
    this.svgWidth = this.resolveSvgWidth();
    this.svgHeight = this.resolveSvgHeight();
    const visibleMachines = machines.filter((machine) => this.hasRenderableSession(machine));
    this.sourceMachines = visibleMachines;
    const maxNameLength = visibleMachines.reduce(
      (max, machine) => Math.max(max, String(machine.name || '').length),
      0
    );
    this.plotLeft = Math.min(160, Math.max(92, maxNameLength * 7 + 18));
    this.plotRight = 16;
    this.plotTop = 40;
    this.plotBottom = 30;
    this.innerWidth = Math.max(40, this.svgWidth - this.plotLeft - this.plotRight);
    this.innerHeight = Math.max(40, this.svgHeight - this.plotTop - this.plotBottom);

    const rowHeight = visibleMachines.length ? Math.max(18, this.innerHeight / visibleMachines.length) : 24;
    this.barHeight = Math.max(8, Math.min(18, rowHeight * 0.58));

    this.baseTimeScale = d3.scaleTime<number, number>()
      .domain([this.rangeStart, this.rangeEnd])
      .range([this.plotLeft, this.plotLeft + this.innerWidth]);
    this.zoomTransform = resetZoom
      ? d3.zoomIdentity
      : this.transformForVisibleDomain(preservedDomain);
    this.renderTimeline(rowHeight, this.zoomTransform);
    this.hasInitialData = this.sourceMachines.length > 0;
    this.isLoading = false;
    this.dummyMode = false;
    this.tooltip = { ...this.tooltip, visible: false };
    this.configureZoom();
    this.cdr.markForCheck();
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.scheduleSizeSync());
    this.resizeObserver.observe(this.host.nativeElement);
  }

  private scheduleSizeSync(): void {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (this.syncMeasuredSize() && this.preloadedData) this.buildView(false);
    });
  }

  private syncMeasuredSize(): boolean {
    const width = Math.floor(this.host.nativeElement.clientWidth);
    const height = Math.floor(this.host.nativeElement.clientHeight);
    if (width < 10 || height < 10) return false;
    if (width === this.measuredWidth && height === this.measuredHeight) return false;
    this.measuredWidth = width;
    this.measuredHeight = height;
    return true;
  }

  private resolveSvgWidth(): number {
    if (this.measuredWidth >= 10) return this.measuredWidth;
    return Math.max(320, Math.floor(this.chartWidth || 600));
  }

  private resolveSvgHeight(): number {
    if (this.measuredHeight >= 10) return this.measuredHeight;
    return Math.max(180, Math.floor(this.chartHeight || 360));
  }

  private configureZoom(): void {
    if (!this.svgElement || !this.hasInitialData) return;

    const plotRight = this.plotLeft + this.innerWidth;
    const plotBottom = this.plotTop + this.innerHeight;
    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 32])
      .extent([[this.plotLeft, this.plotTop], [plotRight, plotBottom]])
      .translateExtent([[this.plotLeft, this.plotTop], [plotRight, plotBottom]])
      .filter((event: Event) => this.isPlotInteraction(event))
      .on('start', () => this.hideTooltip())
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        this.scheduleZoomRender(event.transform);
      });

    const selection = d3.select(this.svgElement);
    this.ngZone.runOutsideAngular(() => {
      selection.call(this.zoomBehavior!);
      selection.on('dblclick.zoom', null);
      selection.call(this.zoomBehavior!.transform, this.zoomTransform);
    });
  }

  private detachZoom(): void {
    if (this.svgElement) d3.select(this.svgElement).on('.zoom', null);
    this.zoomBehavior = undefined;
  }

  private isPlotInteraction(event: Event): boolean {
    if (!this.svgElement) return false;
    if (event instanceof MouseEvent && event.button !== 0 && event.type !== 'wheel') return false;

    const pointerEvent = event instanceof TouchEvent && event.touches.length
      ? event.touches[0]
      : event;
    const [x, y] = d3.pointer(pointerEvent, this.svgElement);
    return x >= this.plotLeft
      && x <= this.plotLeft + this.innerWidth
      && y >= this.plotTop
      && y <= this.plotTop + this.innerHeight;
  }

  private scheduleZoomRender(transform: d3.ZoomTransform): void {
    this.pendingZoomTransform = d3.zoomIdentity.translate(transform.x, 0).scale(transform.k);
    if (this.zoomFrame) return;

    this.zoomFrame = requestAnimationFrame(() => {
      this.zoomFrame = 0;
      this.ngZone.run(() => this.applyZoomTransform(this.pendingZoomTransform));
    });
  }

  private cancelPendingZoom(): void {
    if (this.zoomFrame) cancelAnimationFrame(this.zoomFrame);
    this.zoomFrame = 0;
    this.pendingZoomTransform = d3.zoomIdentity;
  }

  private applyZoomTransform(transform: d3.ZoomTransform): void {
    const rowHeight = this.sourceMachines.length
      ? Math.max(18, this.innerHeight / this.sourceMachines.length)
      : 24;
    this.zoomTransform = transform;
    this.renderTimeline(rowHeight, transform);
    this.tooltip = { ...this.tooltip, visible: false };
    this.cdr.markForCheck();
  }

  private renderTimeline(rowHeight: number, transform: d3.ZoomTransform): void {
    this.visibleTimeScale = transform.rescaleX(this.baseTimeScale);
    this.viewMachines = this.sourceMachines.map((machine, index) => this.buildMachineView(machine, index, rowHeight));
    this.ticks = this.buildTicks();
    this.zoomLevel = transform.k;
    this.isZoomed = transform.k > 1.001;
  }

  private transformForVisibleDomain(domain: Date[] | null): d3.ZoomTransform {
    if (!domain || domain.length !== 2 || !this.rangeStart || !this.rangeEnd) return d3.zoomIdentity;

    const fullStart = this.rangeStart.getTime();
    const fullEnd = this.rangeEnd.getTime();
    const visibleStart = Math.max(fullStart, domain[0].getTime());
    const visibleEnd = Math.min(fullEnd, domain[1].getTime());
    if (visibleStart >= visibleEnd) return d3.zoomIdentity;

    const scale = Math.min(32, (fullEnd - fullStart) / (visibleEnd - visibleStart));
    if (scale <= 1.001) return d3.zoomIdentity;
    const translateX = this.plotLeft - (scale * this.baseTimeScale(new Date(visibleStart)));
    return d3.zoomIdentity.translate(translateX, 0).scale(scale);
  }

  private hideTooltip(): void {
    if (!this.tooltip.visible) return;
    this.ngZone.run(() => {
      this.tooltip = { ...this.tooltip, visible: false };
      this.cdr.markForCheck();
    });
  }

  private hasRenderableSession(machine: MachineTimelineMachine): boolean {
    return (machine.sessions || []).some((chunk) => {
      const start = this.parseDate(chunk.start);
      const end = this.parseDate(chunk.end);
      return Boolean(start && end && start < end);
    });
  }

  private normalizePayload(input: MachineTimelinePayload | MachineTimelineMachine[] | null | undefined): MachineTimelinePayload {
    if (Array.isArray(input)) return { machines: input };
    if (input && Array.isArray(input.machines)) return input;
    return { machines: [] };
  }

  private resolveRange(payload: MachineTimelinePayload, machines: MachineTimelineMachine[]): { start: Date; end: Date } {
    const payloadStart = this.parseDate(payload.range?.start);
    const payloadEnd = this.parseDate(payload.range?.end);
    if (payloadStart && payloadEnd && payloadStart < payloadEnd) {
      return { start: payloadStart, end: payloadEnd };
    }

    const dates = machines
      .flatMap((machine) => machine.sessions || [])
      .flatMap((chunk) => [this.parseDate(chunk.start), this.parseDate(chunk.end)])
      .filter((date): date is Date => Boolean(date));

    if (dates.length) {
      const start = new Date(Math.min(...dates.map((date) => date.getTime())));
      const end = new Date(Math.max(...dates.map((date) => date.getTime())));
      if (start < end) return { start, end };
    }

    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  private buildMachineView(machine: MachineTimelineMachine, index: number, rowHeight: number): TimelineViewMachine {
    const y = this.plotTop + (index * rowHeight) + (rowHeight / 2);
    const name = machine.name || `Serial ${machine.serial ?? index + 1}`;
    const chunks = (machine.sessions || [])
      .map((chunk, chunkIndex) => this.buildChunkView(machine, chunk, chunkIndex))
      .filter((chunk): chunk is TimelineViewChunk => Boolean(chunk));

    return {
      serial: machine.serial ?? name,
      name,
      y,
      barY: y - (this.barHeight / 2),
      chunks,
    };
  }

  private buildChunkView(
    machine: MachineTimelineMachine,
    chunk: MachineTimelineChunk,
    chunkIndex: number
  ): TimelineViewChunk | null {
    const start = this.parseDate(chunk.start);
    const end = this.parseDate(chunk.end);
    if (!start || !end || !this.rangeStart || !this.rangeEnd || start >= end) return null;

    const x = this.visibleTimeScale(start);
    const width = Math.max(1, this.visibleTimeScale(end) - x);
    const status = this.normalizeStatus(chunk.status);

    return {
      ...chunk,
      id: chunk.id || `${machine.serial || machine.name}-${chunkIndex}`,
      status,
      x,
      width,
      color: this.statusColor(status),
      tooltip: this.buildTooltip(chunk, start, end),
    };
  }

  private buildTicks(): TimelineTick[] {
    if (!this.rangeStart || !this.rangeEnd) return [];
    const tickCount = this.svgWidth < 420 ? 3 : 5;
    const [visibleStart, visibleEnd] = this.visibleTimeScale.domain();
    const rangeMs = visibleEnd.getTime() - visibleStart.getTime();
    const includeDate = visibleStart.toDateString() !== visibleEnd.toDateString();
    return Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const date = new Date(visibleStart.getTime() + (rangeMs * ratio));
      return {
        x: this.visibleTimeScale(date),
        label: includeDate ? this.formatTickDateTime(date) : this.formatTime(date),
      };
    });
  }

  private buildTooltip(chunk: MachineTimelineChunk, start: Date, end: Date): string[] {
    const lines = [
      `Start Time: ${this.formatDateTime(start)}`,
      `End Time: ${this.formatDateTime(end)}`,
    ];

    const status = this.normalizeStatus(chunk.status);
    if (status === 'faulted') {
      lines.push(`Fault Code: ${chunk.statusCode ?? 'N/A'}`);
      lines.push(`Fault Name: ${chunk.statusLabel || 'Faulted'}`);
    } else if (status === 'paused') {
      const durationMs = chunk.totalDurationMs ?? chunk.durationMs ?? Math.max(0, end.getTime() - start.getTime());
      lines.push(`Total Duration: ${this.formatDuration(durationMs)}`);
    } else {
      lines.push(`Total Count: ${chunk.totalCount ?? 0}`);
      lines.push(`Eff%: ${chunk.efficiency == null ? 'N/A' : `${chunk.efficiency.toFixed(2)}%`}`);
    }

    return lines;
  }

  private formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, '0'))
      .join(':');
  }

  private resolveTooltipPosition(event: MouseEvent): { x: number; y: number } {
    const target = event.currentTarget as SVGGraphicsElement | null;
    const host = target?.ownerSVGElement?.parentElement;
    const bounds = host?.getBoundingClientRect();
    if (!bounds) {
      return { x: event.offsetX + 12, y: event.offsetY };
    }

    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const tooltipNode = this.tooltipEl?.nativeElement;
    const tooltipWidth = tooltipNode?.offsetWidth || 0;
    const tooltipHeight = tooltipNode?.offsetHeight || 0;
    const gutter = 8;
    let left = x + 12;
    let top = y;

    if (tooltipWidth && left + tooltipWidth + gutter > bounds.width) {
      left = x - tooltipWidth - 12;
    }
    if (tooltipHeight && top + tooltipHeight + gutter > bounds.height) {
      top = bounds.height - tooltipHeight - gutter;
    }

    return {
      x: Math.max(gutter, Math.min(left, bounds.width - tooltipWidth - gutter)),
      y: Math.max(gutter, top),
    };
  }

  private normalizeStatus(status: unknown): TimelineStatus {
    return status === 'paused' || status === 'faulted' || status === 'offline' ? status : 'running';
  }

  private statusColor(status: TimelineStatus): string {
    switch (status) {
      case 'running': return '#66bb6a';
      case 'paused': return '#ffca28';
      case 'faulted': return '#ef5350';
      case 'offline': return 'var(--sg-color-blue-gray-medium-100, #8b949e)';
    }
  }

  private parseDate(value: string | Date | undefined | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private formatTickDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private enterDummy(): void {
    this.sourceMachines = [];
    this.isZoomed = false;
    this.zoomLevel = 1;
    this.isLoading = true;
    this.dummyMode = true;
    this.hasInitialData = false;
    this.viewMachines = [];
    this.ticks = [];
    this.tooltip = { ...this.tooltip, visible: false };
    this.cdr.markForCheck();
  }
}
