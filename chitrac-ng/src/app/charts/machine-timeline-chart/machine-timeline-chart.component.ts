import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

type TimelineStatus = 'running' | 'paused' | 'faulted' | 'offline';

interface MachineTimelineChunk {
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
  imports: [CommonModule],
  templateUrl: './machine-timeline-chart.component.html',
  styleUrls: ['./machine-timeline-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MachineTimelineChartComponent implements OnChanges {
  @Input() chartWidth = 600;
  @Input() chartHeight = 450;
  @Input() preloadedData?: MachineTimelinePayload | MachineTimelineMachine[] | null;
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
  private cdr = inject(ChangeDetectorRef);

  ngOnChanges(_changes: SimpleChanges): void {
    this.buildView();
  }

  trackMachine(_index: number, machine: TimelineViewMachine): number | string {
    return machine.serial;
  }

  trackChunk(_index: number, chunk: TimelineViewChunk): string {
    return chunk.id;
  }

  onChunkEnter(event: MouseEvent, chunk: TimelineViewChunk): void {
    const position = this.resolveTooltipPosition(event);
    this.tooltip = {
      visible: true,
      x: position.x,
      y: position.y,
      lines: chunk.tooltip,
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

  private buildView(): void {
    const payload = this.normalizePayload(this.preloadedData);
    const machines = payload.machines || [];
    const range = this.resolveRange(payload, machines);

    this.rangeStart = range.start;
    this.rangeEnd = range.end;
    this.svgWidth = Math.max(320, Math.floor(this.chartWidth || 600));
    this.svgHeight = Math.max(180, Math.floor(this.chartHeight || 360));
    const maxNameLength = machines.reduce((max, machine) => Math.max(max, String(machine.name || '').length), 0);
    this.plotLeft = Math.min(160, Math.max(92, maxNameLength * 7 + 18));
    this.plotRight = 16;
    this.plotTop = this.useExternalTitle ? 12 : 34;
    this.plotBottom = 30;
    this.innerWidth = Math.max(40, this.svgWidth - this.plotLeft - this.plotRight);
    this.innerHeight = Math.max(40, this.svgHeight - this.plotTop - this.plotBottom);

    const rowHeight = machines.length ? Math.max(18, this.innerHeight / machines.length) : 24;
    this.barHeight = Math.max(8, Math.min(18, rowHeight * 0.58));

    this.viewMachines = machines
      .map((machine, index) => this.buildMachineView(machine, index, rowHeight))
      .filter((machine) => machine.chunks.length > 0);
    this.ticks = this.buildTicks();
    this.hasInitialData = this.viewMachines.length > 0;
    this.isLoading = false;
    this.tooltip = { ...this.tooltip, visible: false };
    this.cdr.markForCheck();
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

    const rangeMs = this.rangeEnd.getTime() - this.rangeStart.getTime();
    const x = this.plotLeft + ((start.getTime() - this.rangeStart.getTime()) / rangeMs) * this.innerWidth;
    const width = Math.max(1, ((end.getTime() - start.getTime()) / rangeMs) * this.innerWidth);
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

  private buildTooltip(chunk: MachineTimelineChunk, start: Date, end: Date): string[] {
    return [
      `Start Time: ${this.formatDateTime(start)}`,
      `End Time: ${this.formatDateTime(end)}`,
      `Total Count: ${chunk.totalCount ?? 0}`,
      `Eff%: ${chunk.efficiency == null ? 'N/A' : `${chunk.efficiency.toFixed(2)}%`}`,
    ];
  }

  private resolveTooltipPosition(event: MouseEvent): { x: number; y: number } {
    const tooltipWidth = 250;
    const tooltipHeight = 86;
    const margin = 12;
    return {
      x: Math.min(event.clientX + margin, window.innerWidth - tooltipWidth - margin),
      y: Math.min(event.clientY + margin, window.innerHeight - tooltipHeight - margin),
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
}
