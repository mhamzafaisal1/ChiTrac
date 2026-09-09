import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';

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
  @Input() chartWidth = 600;
  @Input() chartHeight = 450;
  @Input() timelineData?: OperatorTimelinePayload | OperatorTimelineMachine[] | null;
  @Input() preloadedData?: OperatorTimelinePayload | OperatorTimelineMachine[] | null;
  @Input() isModal = false;
  @Input() useExternalTitle = false;

  isLoading = false;
  hasInitialData = false;
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
  private measuredWidth = 0;
  private resizeFrame = 0;
  private resizeObserver?: ResizeObserver;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);

  ngAfterViewInit(): void {
    this.setupResizeObserver();
    this.scheduleSizeSync();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.buildView();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = 0;
    }
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

  private buildView(): void {
    const payload = this.normalizePayload(this.timelineData ?? this.preloadedData);
    const machines = payload.machines || [];
    const range = this.resolveRange(payload, machines);

    this.rangeStart = range.start;
    this.rangeEnd = range.end;
    this.svgWidth = this.resolveSvgWidth();
    const visibleMachines = machines.filter((machine) => this.hasRenderableSession(machine));
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

    this.viewMachines = visibleMachines.map((machine, index) => this.buildMachineView(machine, index, rowHeight));
    this.ticks = this.buildTicks();
    this.hasInitialData = this.viewMachines.length > 0;
    this.isLoading = false;
    this.tooltip = { ...this.tooltip, visible: false };
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
        this.buildView();
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

    const rangeMs = this.rangeEnd.getTime() - this.rangeStart.getTime();
    const x = this.plotLeft + ((start.getTime() - this.rangeStart.getTime()) / rangeMs) * this.innerWidth;
    const width = Math.max(1, ((end.getTime() - start.getTime()) / rangeMs) * this.innerWidth);
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
    const rangeMs = this.rangeEnd.getTime() - this.rangeStart.getTime();
    return Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const date = new Date(this.rangeStart!.getTime() + (rangeMs * ratio));
      return {
        x: this.plotLeft + (this.innerWidth * ratio),
        label: this.formatTime(date),
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
}
