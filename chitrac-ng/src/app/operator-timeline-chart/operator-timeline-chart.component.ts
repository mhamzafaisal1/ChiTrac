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
import * as d3 from 'd3';

type TimelineStatus = 'running' | 'paused' | 'faulted' | 'offline';

interface OperatorTimelineChunk {
  id?: string;
  status?: TimelineStatus;
  statusLabel?: string;
  start?: string | Date;
  end?: string | Date;
  durationMs?: number;
  totalCount?: number | null;
  efficiency?: number | null;
  current?: boolean;
}

interface OperatorTimelineMachine {
  serial?: number | string;
  name?: string;
  sessions?: OperatorTimelineChunk[];
}

interface OperatorTimelinePayload {
  operator?: {
    id?: number | string;
    name?: string;
  } | null;
  machines?: OperatorTimelineMachine[];
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
}

interface TimelineTick {
  x: number;
  label: string;
}

interface TimelineViewChunk extends OperatorTimelineChunk {
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
  selector: 'app-operator-timeline-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './operator-timeline-chart.component.html',
  styleUrls: ['./operator-timeline-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperatorTimelineChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static nextClipId = 0;

  @Input() chartWidth = 600;
  @Input() chartHeight = 450;
  @Input() timelineData?: OperatorTimelinePayload | OperatorTimelineMachine[] | null;
  @Input() preloadedData?: OperatorTimelinePayload | OperatorTimelineMachine[] | null;
  @Input() isModal = false;
  @Input() useExternalTitle = false;

  @ViewChild('timelineSvg')
  set timelineSvg(ref: ElementRef<SVGSVGElement> | undefined) {
    this.detachZoom();
    this.svgElement = ref?.nativeElement;
    this.configureZoom();
  }

  isLoading = false;
  hasInitialData = false;
  isZoomed = false;
  readonly clipPathId = `operator-timeline-clip-${++OperatorTimelineChartComponent.nextClipId}`;
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
  private sourceMachines: OperatorTimelineMachine[] = [];
  private baseTimeScale = d3.scaleTime<number, number>();
  private visibleTimeScale = d3.scaleTime<number, number>();
  private zoomTransform = d3.zoomIdentity;
  private pendingZoomTransform = d3.zoomIdentity;
  private zoomBehavior?: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private svgElement?: SVGSVGElement;
  private measuredWidth = 0;
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
    const dataChanged = Boolean(changes['timelineData'] || changes['preloadedData']);
    if (dataChanged) this.cancelPendingZoom();
    this.buildView(dataChanged);
  }

  ngOnDestroy(): void {
    this.detachZoom();
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = 0;
    }
    this.cancelPendingZoom();
  }

  trackMachine(_index: number, machine: TimelineViewMachine): number | string {
    return machine.serial;
  }

  trackChunk(_index: number, chunk: TimelineViewChunk): string {
    return chunk.id;
  }

  onChunkEnter(event: MouseEvent, chunk: TimelineViewChunk): void {
    const target = event.currentTarget as SVGGraphicsElement | null;
    const hostRect = target?.ownerSVGElement?.getBoundingClientRect();
    this.tooltip = {
      visible: true,
      x: hostRect ? event.clientX - hostRect.left + 12 : event.offsetX + 12,
      y: hostRect ? event.clientY - hostRect.top + 12 : event.offsetY + 12,
      lines: chunk.tooltip,
    };
    this.cdr.markForCheck();
  }

  onChunkMove(event: MouseEvent): void {
    if (!this.tooltip.visible) return;
    const target = event.currentTarget as SVGGraphicsElement | null;
    const hostRect = target?.ownerSVGElement?.getBoundingClientRect();
    this.tooltip = {
      ...this.tooltip,
      x: hostRect ? event.clientX - hostRect.left + 12 : event.offsetX + 12,
      y: hostRect ? event.clientY - hostRect.top + 12 : event.offsetY + 12,
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
    const payload = this.normalizePayload(this.timelineData ?? this.preloadedData);
    const machines = payload.machines || [];
    const range = this.resolveRange(payload, machines);

    this.rangeStart = range.start;
    this.rangeEnd = range.end;
    this.svgWidth = this.resolveSvgWidth();
    const visibleMachines = machines.filter((machine) => this.hasRenderableSession(machine));
    this.sourceMachines = visibleMachines;
    const maxNameLength = visibleMachines.reduce(
      (max, machine) => Math.max(max, String(machine.name || '').length),
      0
    );
    this.plotLeft = Math.min(170, Math.max(92, maxNameLength * 7 + 18));
    this.plotRight = 16;
    this.plotTop = this.useExternalTitle ? 20 : 48;
    this.plotBottom = 44;
    this.innerWidth = Math.max(40, this.svgWidth - this.plotLeft - this.plotRight);

    const rowCount = Math.max(1, visibleMachines.length);
    const preferredRowHeight = rowCount === 1 ? 64 : 48;
    const maxSvgHeight = Math.max(160, Math.floor(this.chartHeight || 450));
    const availableRowHeight = (maxSvgHeight - this.plotTop - this.plotBottom) / rowCount;
    const rowHeight = Math.max(28, Math.min(preferredRowHeight, availableRowHeight));
    this.innerHeight = rowCount * rowHeight;
    this.svgHeight = this.plotTop + this.innerHeight + this.plotBottom;
    this.barHeight = Math.max(14, Math.min(22, rowHeight * 0.36));

    this.baseTimeScale = d3.scaleTime<number, number>()
      .domain([this.rangeStart, this.rangeEnd])
      .range([this.plotLeft, this.plotLeft + this.innerWidth]);
    this.zoomTransform = resetZoom
      ? d3.zoomIdentity
      : this.transformForVisibleDomain(preservedDomain);
    this.renderTimeline(rowHeight, this.zoomTransform);
    this.hasInitialData = this.sourceMachines.length > 0;
    this.isLoading = false;
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
      if (this.syncMeasuredSize()) {
        this.buildView(false);
      }
    });
  }

  private syncMeasuredSize(): boolean {
    const width = Math.floor(this.host.nativeElement.clientWidth);
    if (width < 10) return false;
    if (width === this.measuredWidth) return false;
    this.measuredWidth = width;
    return true;
  }

  private resolveSvgWidth(): number {
    if (this.measuredWidth >= 10) return this.measuredWidth;
    return Math.max(320, Math.floor(this.chartWidth || 600));
  }

  private configureZoom(): void {
    if (!this.svgElement || !this.hasInitialData) return;

    const plotRight = this.plotLeft + this.innerWidth;
    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 32])
      .extent([[this.plotLeft, 0], [plotRight, this.svgHeight]])
      .translateExtent([[this.plotLeft, -Infinity], [plotRight, Infinity]])
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
    const rowCount = Math.max(1, this.sourceMachines.length);
    const rowHeight = this.innerHeight / rowCount;
    this.zoomTransform = transform;
    this.renderTimeline(rowHeight, transform);
    this.tooltip = { ...this.tooltip, visible: false };
    this.cdr.markForCheck();
  }

  private renderTimeline(rowHeight: number, transform: d3.ZoomTransform): void {
    this.visibleTimeScale = transform.rescaleX(this.baseTimeScale);
    this.viewMachines = this.sourceMachines.map((machine, index) => this.buildMachineView(machine, index, rowHeight));
    this.ticks = this.buildTicks();
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

  private hasRenderableSession(machine: OperatorTimelineMachine): boolean {
    return (machine.sessions || []).some((chunk) => {
      const start = this.parseDate(chunk.start);
      const end = this.parseDate(chunk.end);
      return Boolean(start && end && start < end);
    });
  }

  private normalizePayload(input: OperatorTimelinePayload | OperatorTimelineMachine[] | null | undefined): OperatorTimelinePayload {
    if (Array.isArray(input)) return { machines: input };
    if (input && Array.isArray(input.machines)) return input;
    return { machines: [] };
  }

  private resolveRange(payload: OperatorTimelinePayload, machines: OperatorTimelineMachine[]): { start: Date; end: Date } {
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

  private buildMachineView(machine: OperatorTimelineMachine, index: number, rowHeight: number): TimelineViewMachine {
    const y = this.plotTop + (index * rowHeight) + (rowHeight / 2);
    const serial = machine.serial ?? index + 1;
    const name = machine.name || `Serial ${serial}`;
    const chunks = (machine.sessions || [])
      .map((chunk, chunkIndex) => this.buildChunkView(serial, name, chunk, chunkIndex))
      .filter((chunk): chunk is TimelineViewChunk => Boolean(chunk));

    return {
      serial,
      name,
      y,
      barY: y - (this.barHeight / 2),
      chunks,
    };
  }

  private buildChunkView(
    machineSerial: number | string,
    machineName: string,
    chunk: OperatorTimelineChunk,
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
      id: chunk.id || `${machineSerial || machineName}-${chunkIndex}`,
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

  private buildTooltip(chunk: OperatorTimelineChunk, start: Date, end: Date): string[] {
    return [
      `Start Time: ${this.formatDateTime(start)}`,
      `End Time: ${this.formatDateTime(end)}`,
      `Total Count: ${chunk.totalCount ?? 0}`,
      `Eff%: ${chunk.efficiency == null ? 'N/A' : `${chunk.efficiency.toFixed(2)}%`}`,
    ];
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
}
