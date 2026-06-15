import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { ConfigurationService } from '../configuration.service';
import { MachineConfig } from '../shared/models/machine.model';
import { OperatorConfig } from '../shared/models/operator.model';
import { MachineService } from '../services/machine.service';
import { OperatorService } from '../services/operator.service';
import { PolarChartComponent, PolarChartData } from '../charts/polar-chart/polar-chart.component';

type ComparisonEntityType = 'machines' | 'operators';
type WizardStep = 'chooseType' | 'chooseEntities' | 'chooseTimeframes' | 'results';
type TimeframeKey = 'primary' | 'secondary';

interface ComparisonOption {
  id: number;
  label: string;
  raw: MachineConfig | OperatorConfig;
}

interface ComparisonTimeframe {
  start: Date;
  end: Date;
}

interface MetricRow {
  label: string;
  value: string;
  rawValue: number;
  delta?: MetricDelta | null;
  format: 'percent' | 'duration' | 'number';
}

interface MetricDelta {
  direction: 'up' | 'down';
  icon: 'arrow_drop_up' | 'arrow_drop_down';
  display: string;
}

interface ComparisonColumn {
  title: string;
  subtitle: string;
  rows: MetricRow[];
  rawData: any | null;
}

interface WizardSnapshot {
  step: WizardStep;
  entityType: ComparisonEntityType | null;
  leftSelectionId: number | null;
  rightSelectionId: number | null;
  primaryTimeframe: ComparisonTimeframe | null;
  secondaryTimeframe: ComparisonTimeframe | null;
  activePicker: TimeframeKey | null;
  resultColumns: ComparisonColumn[];
  polarChartData: PolarChartData | null;
  errorMessage: string | null;
}

@Component({
  selector: 'app-comparison-dashboard',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    PolarChartComponent
  ],
  templateUrl: './comparison-dashboard.component.html',
  styleUrls: ['./comparison-dashboard.component.scss']
})
export class ComparisonDashboardComponent implements OnInit {
  step: WizardStep = 'chooseType';
  entityType: ComparisonEntityType | null = null;
  options: ComparisonOption[] = [];
  machines: ComparisonOption[] = [];
  operators: ComparisonOption[] = [];

  leftSelectionId: number | null = null;
  rightSelectionId: number | null = null;
  primaryTimeframe: ComparisonTimeframe | null = null;
  secondaryTimeframe: ComparisonTimeframe | null = null;
  activePicker: TimeframeKey | null = null;
  pickerStart: Date = this.startOfToday();
  pickerEnd: Date = new Date();
  resultColumns: ComparisonColumn[] = [];
  polarChartData: PolarChartData | null = null;
  historyStack: WizardSnapshot[] = [];
  isLoadingOptions = false;
  isLoadingResults = false;
  errorMessage: string | null = null;

  constructor(
    private configurationService: ConfigurationService,
    private machineService: MachineService,
    private operatorService: OperatorService
  ) {}

  ngOnInit(): void {
    this.loadOptions();
  }

  selectEntityType(type: ComparisonEntityType): void {
    this.pushHistory();
    this.entityType = type;
    this.options = type === 'machines' ? this.machines : this.operators;
    this.leftSelectionId = null;
    this.rightSelectionId = null;
    this.primaryTimeframe = null;
    this.secondaryTimeframe = null;
    this.resultColumns = [];
    this.polarChartData = null;
    this.errorMessage = null;
    this.step = 'chooseEntities';
  }

  onSelectionChange(changedSide: 'left' | 'right'): void {
    const changedValue = changedSide === 'left' ? this.leftSelectionId : this.rightSelectionId;
    const bothWereEmptyBeforeChange = changedSide === 'left'
      ? this.rightSelectionId === null
      : this.leftSelectionId === null;

    if (changedValue !== null && bothWereEmptyBeforeChange) {
      if (changedSide === 'left') {
        this.rightSelectionId = changedValue;
      } else {
        this.leftSelectionId = changedValue;
      }
    }
  }

  next(): void {
    if (this.step === 'chooseEntities' && this.canContinueFromEntities()) {
      this.pushHistory();
      this.primaryTimeframe = null;
      this.secondaryTimeframe = null;
      this.activePicker = null;
      this.resultColumns = [];
      this.polarChartData = null;
      this.errorMessage = null;
      this.step = 'chooseTimeframes';
      return;
    }

    if (this.step === 'chooseTimeframes' && this.canContinueFromTimeframes()) {
      this.pushHistory();
      this.buildComparison();
    }
  }

  back(): void {
    const previous = this.historyStack.pop();
    if (!previous) {
      this.startOver();
      return;
    }
    this.restoreSnapshot(previous);
  }

  startOver(): void {
    this.step = 'chooseType';
    this.entityType = null;
    this.options = [];
    this.leftSelectionId = null;
    this.rightSelectionId = null;
    this.primaryTimeframe = null;
    this.secondaryTimeframe = null;
    this.activePicker = null;
    this.resultColumns = [];
    this.polarChartData = null;
    this.errorMessage = null;
    this.historyStack = [];
  }

  isSameEntityComparison(): boolean {
    return this.leftSelectionId !== null && this.leftSelectionId === this.rightSelectionId;
  }

  canContinueFromEntities(): boolean {
    return this.leftSelectionId !== null && this.rightSelectionId !== null;
  }

  canContinueFromTimeframes(): boolean {
    if (!this.primaryTimeframe) return false;
    return !this.isSameEntityComparison() || !!this.secondaryTimeframe;
  }

  openPicker(key: TimeframeKey): void {
    this.activePicker = this.activePicker === key ? null : key;
    const current = key === 'primary' ? this.primaryTimeframe : this.secondaryTimeframe;
    this.pickerStart = current?.start ? new Date(current.start) : this.startOfToday();
    this.pickerEnd = current?.end ? new Date(current.end) : new Date();
  }

  confirmPicker(): void {
    if (!this.activePicker || !this.pickerStart || !this.pickerEnd || this.pickerEnd <= this.pickerStart) {
      return;
    }

    const nextTimeframe = {
      start: new Date(this.pickerStart),
      end: new Date(this.pickerEnd)
    };

    if (this.activePicker === 'primary') {
      this.primaryTimeframe = nextTimeframe;
    } else {
      this.secondaryTimeframe = nextTimeframe;
    }
    this.activePicker = null;
  }

  getOptionLabel(id: number | null): string {
    if (id === null) return '';
    return this.options.find(option => option.id === id)?.label || String(id);
  }

  getPrimaryPickerLabel(): string {
    if (this.isSameEntityComparison()) {
      return this.primaryTimeframe ? this.formatTimeframe(this.primaryTimeframe) : 'Select First Timeframe';
    }
    return this.primaryTimeframe ? this.formatTimeframe(this.primaryTimeframe) : 'Select Timeframe';
  }

  getSecondaryPickerLabel(): string {
    return this.secondaryTimeframe ? this.formatTimeframe(this.secondaryTimeframe) : 'Select Second Timeframe';
  }

  getNextDisabled(): boolean {
    if (this.step === 'chooseEntities') return !this.canContinueFromEntities();
    if (this.step === 'chooseTimeframes') return !this.canContinueFromTimeframes();
    return true;
  }

  getEntityTypeLabel(): string {
    return this.entityType === 'machines' ? 'machines' : this.entityType === 'operators' ? 'operators' : 'items';
  }

  getComparisonModeLabel(): string {
    if (!this.canContinueFromEntities()) return '';
    return this.isSameEntityComparison()
      ? 'Compare one selection across two timeframes'
      : 'Compare two selections across one timeframe';
  }

  private loadOptions(): void {
    this.isLoadingOptions = true;
    forkJoin({
      machines: this.configurationService.getMachineConfigs(),
      operators: this.configurationService.getOperatorConfigs()
    }).subscribe({
      next: ({ machines, operators }) => {
        this.machines = machines
          .filter(machine => machine.active !== false && machine.serial !== null && machine.serial !== undefined)
          .map(machine => ({
            id: Number(machine.serial),
            label: `${machine.name || 'Machine'} (${machine.serial})`,
            raw: machine
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

        this.operators = operators
          .filter(operator => operator.active !== false && operator.code !== null && operator.code !== undefined)
          .map(operator => ({
            id: Number(operator.code),
            label: `${this.operatorName(operator)} (${operator.code})`,
            raw: operator
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

        this.isLoadingOptions = false;
      },
      error: () => {
        this.errorMessage = 'Unable to load machines and operators.';
        this.isLoadingOptions = false;
      }
    });
  }

  private buildComparison(): void {
    if (!this.entityType || !this.primaryTimeframe || this.leftSelectionId === null || this.rightSelectionId === null) {
      return;
    }

    this.step = 'results';
    this.isLoadingResults = true;
    this.errorMessage = null;
    const sameEntity = this.isSameEntityComparison();
    const leftId = this.leftSelectionId;
    const rightId = this.rightSelectionId;
    const firstFrame = this.primaryTimeframe;
    const secondFrame = sameEntity ? this.secondaryTimeframe! : this.primaryTimeframe;

    const firstRequest = this.fetchSummary(firstFrame);
    const secondRequest = sameEntity ? this.fetchSummary(secondFrame) : firstRequest;

    forkJoin([firstRequest, secondRequest]).subscribe({
      next: ([firstRows, secondRows]) => {
        const firstData = this.findSummaryRow(firstRows, leftId);
        const secondData = this.findSummaryRow(secondRows, rightId);
        const nextColumns = [
          {
            title: sameEntity ? this.getOptionLabel(leftId) : this.getOptionLabel(leftId),
            subtitle: sameEntity ? this.formatTimeframe(firstFrame) : this.formatTimeframe(this.primaryTimeframe!),
            rows: this.toMetricRows(firstData),
            rawData: firstData
          },
          {
            title: sameEntity ? this.getOptionLabel(rightId) : this.getOptionLabel(rightId),
            subtitle: sameEntity ? this.formatTimeframe(secondFrame) : this.formatTimeframe(this.primaryTimeframe!),
            rows: this.toMetricRows(secondData),
            rawData: secondData
          }
        ];
        this.resultColumns = this.applyDifferenceIndicators(nextColumns);
        this.polarChartData = this.buildPolarChartData(this.resultColumns);
        this.isLoadingResults = false;
      },
      error: () => {
        this.resultColumns = [];
        this.polarChartData = null;
        this.errorMessage = 'Unable to load comparison metrics.';
        this.isLoadingResults = false;
      }
    });
  }

  private fetchSummary(timeframe: ComparisonTimeframe) {
    const start = timeframe.start.toISOString();
    const end = timeframe.end.toISOString();
    return this.entityType === 'machines'
      ? this.machineService.getMachinesSummary(start, end)
      : this.operatorService.getOperatorSummary(start, end);
  }

  private findSummaryRow(rows: any[], id: number): any | null {
    if (!Array.isArray(rows)) return null;
    if (this.entityType === 'machines') {
      return rows.find(row => Number(row?.machine?.serial) === id) || null;
    }
    return rows.find(row => Number(row?.operator?.id) === id) || null;
  }

  private toMetricRows(row: any | null): MetricRow[] {
    const performance = row?.metrics?.performance || {};
    const output = row?.metrics?.output || {};
    const runtime = row?.metrics?.runtime || {};

    return [
      {
        label: 'Availability%',
        value: this.percentValue(performance.availability),
        rawValue: this.percentNumber(performance.availability),
        format: 'percent'
      },
      {
        label: 'Efficiency%',
        value: this.percentValue(performance.efficiency),
        rawValue: this.percentNumber(performance.efficiency),
        format: 'percent'
      },
      {
        label: 'Throughput%',
        value: this.percentValue(performance.throughput),
        rawValue: this.percentNumber(performance.throughput),
        format: 'percent'
      },
      {
        label: 'OEE%',
        value: this.percentValue(performance.oee),
        rawValue: this.percentNumber(performance.oee),
        format: 'percent'
      },
      {
        label: 'Runtime',
        value: this.durationValue(runtime),
        rawValue: this.runtimeMsValue(runtime),
        format: 'duration'
      },
      {
        label: 'Total Count',
        value: this.numberValue(output.totalCount),
        rawValue: Number(output.totalCount || 0),
        format: 'number'
      }
    ];
  }

  private applyDifferenceIndicators(columns: ComparisonColumn[]): ComparisonColumn[] {
    if (columns.length !== 2) return columns;

    const [leftColumn, rightColumn] = columns;
    const leftRows = leftColumn.rows.map((leftRow, index) => {
      const rightRow = rightColumn.rows[index];
      return {
        ...leftRow,
        delta: this.buildMetricDelta(leftRow.rawValue, rightRow?.rawValue ?? 0, leftRow.format)
      };
    });
    const rightRows = rightColumn.rows.map((rightRow, index) => {
      const leftRow = leftColumn.rows[index];
      return {
        ...rightRow,
        delta: this.buildMetricDelta(rightRow.rawValue, leftRow?.rawValue ?? 0, rightRow.format)
      };
    });

    return [
      { ...leftColumn, rows: leftRows },
      { ...rightColumn, rows: rightRows }
    ];
  }

  private buildMetricDelta(value: number, comparisonValue: number, format: MetricRow['format']): MetricDelta | null {
    const diff = value - comparisonValue;
    if (Math.abs(diff) < 0.0001) return null;

    return {
      direction: diff > 0 ? 'up' : 'down',
      icon: diff > 0 ? 'arrow_drop_up' : 'arrow_drop_down',
      display: `${diff > 0 ? '+' : '-'}${this.formatDeltaValue(Math.abs(diff), format)}`
    };
  }

  private formatDeltaValue(value: number, format: MetricRow['format']): string {
    if (format === 'percent') {
      return `${value.toFixed(2)}%`;
    }
    if (format === 'duration') {
      return this.durationFromMs(value);
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  private buildPolarChartData(columns: ComparisonColumn[]): PolarChartData {
    const totalCounts = columns.map(column => this.totalCountValue(column.rawData));
    const totalCountMax = Math.max(...totalCounts, 1);

    return {
      axes: [
        { key: 'totalCount', label: 'Total Count', max: totalCountMax },
        { key: 'availability', label: 'Availability%', max: 100 },
        { key: 'efficiency', label: 'Efficiency%', max: 100 },
        { key: 'throughput', label: 'Throughput%', max: 100 },
        { key: 'oee', label: 'OEE%/OOE%', max: 100 }
      ],
      series: columns.map((column, index) => {
        const performance = column.rawData?.metrics?.performance || {};
        return {
          name: column.title,
          color: index === 0 ? '#38bdf8' : '#f97316',
          values: {
            totalCount: this.totalCountValue(column.rawData),
            availability: this.percentNumber(performance.availability),
            efficiency: this.percentNumber(performance.efficiency),
            throughput: this.percentNumber(performance.throughput),
            oee: this.percentNumber(performance.oee)
          }
        };
      })
    };
  }

  private totalCountValue(row: any | null): number {
    return Number(row?.metrics?.output?.totalCount || 0);
  }

  private percentNumber(metric: any): number {
    if (metric?.percentage !== undefined && metric?.percentage !== null) {
      return Number(metric.percentage) || 0;
    }
    if (metric?.value !== undefined && metric?.value !== null) {
      return (Number(metric.value) || 0) * 100;
    }
    return 0;
  }

  private percentValue(metric: any): string {
    if (metric?.percentage !== undefined && metric?.percentage !== null) {
      return `${Number(metric.percentage).toFixed(2)}%`;
    }
    if (metric?.value !== undefined && metric?.value !== null) {
      return `${(Number(metric.value) * 100).toFixed(2)}%`;
    }
    return '0.00%';
  }

  private durationValue(runtime: any): string {
    if (runtime?.formatted) {
      const hours = runtime.formatted.hours || 0;
      const minutes = runtime.formatted.minutes || 0;
      return `${hours}h ${minutes}m`;
    }
    const totalMs = this.runtimeMsValue(runtime);
    return this.durationFromMs(totalMs);
  }

  private runtimeMsValue(runtime: any): number {
    return Number(runtime?.total || 0);
  }

  private durationFromMs(totalMs: number): string {
    const totalMinutes = Math.floor(totalMs / 60000);
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }

  private numberValue(value: any): string {
    return Number(value || 0).toLocaleString();
  }

  private operatorName(operator: OperatorConfig): string {
    if (typeof operator.name === 'string') return operator.name || 'Operator';
    const name = operator.name || {};
    return [name.first, name.surname].filter(Boolean).join(' ') || 'Operator';
  }

  private formatTimeframe(timeframe: ComparisonTimeframe): string {
    return `${this.formatDate(timeframe.start)} - ${this.formatDate(timeframe.end)}`;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  private startOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private pushHistory(): void {
    this.historyStack.push({
      step: this.step,
      entityType: this.entityType,
      leftSelectionId: this.leftSelectionId,
      rightSelectionId: this.rightSelectionId,
      primaryTimeframe: this.primaryTimeframe ? { ...this.primaryTimeframe } : null,
      secondaryTimeframe: this.secondaryTimeframe ? { ...this.secondaryTimeframe } : null,
      activePicker: this.activePicker,
      resultColumns: this.resultColumns.map(column => ({
        ...column,
        rows: column.rows.map(row => ({ ...row }))
      })),
      polarChartData: this.clonePolarChartData(this.polarChartData),
      errorMessage: this.errorMessage
    });
  }

  private restoreSnapshot(snapshot: WizardSnapshot): void {
    this.step = snapshot.step;
    this.entityType = snapshot.entityType;
    this.options = this.entityType === 'machines' ? this.machines : this.entityType === 'operators' ? this.operators : [];
    this.leftSelectionId = snapshot.leftSelectionId;
    this.rightSelectionId = snapshot.rightSelectionId;
    this.primaryTimeframe = snapshot.primaryTimeframe ? { ...snapshot.primaryTimeframe } : null;
    this.secondaryTimeframe = snapshot.secondaryTimeframe ? { ...snapshot.secondaryTimeframe } : null;
    this.activePicker = snapshot.activePicker;
    this.resultColumns = snapshot.resultColumns.map(column => ({
      ...column,
      rows: column.rows.map(row => ({ ...row }))
    }));
    this.polarChartData = this.clonePolarChartData(snapshot.polarChartData);
    this.errorMessage = snapshot.errorMessage;
    this.isLoadingResults = false;
  }

  private clonePolarChartData(data: PolarChartData | null): PolarChartData | null {
    if (!data) return null;
    return {
      axes: data.axes.map(axis => ({ ...axis })),
      series: data.series.map(series => ({
        ...series,
        values: { ...series.values }
      }))
    };
  }
}
