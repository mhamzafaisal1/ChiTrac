import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Optional, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { Subject, takeUntil } from 'rxjs';
import { ShiftListItem, ShiftService } from '../../services/shift.service';
import { futureTodayShiftStart } from '../../utils/future-shift';
import { ShiftTimeRange } from '../../utils/shift-time-range';

export type TimeframePickerMode = 'custom' | 'shift' | 'today' | 'thisWeek' | 'thisMonth' | 'thisYear' |
  'yesterday' | 'lastWeek' | 'lastMonth' | 'lastYear';
export interface TimeframeSelection {
  start: Date;
  end: Date;
  shiftId: string | null;
  mode?: TimeframePickerMode;
}

@Component({
  selector: 'app-timeframe-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTimepickerModule],
  providers: [provideNativeDateAdapter()],
  templateUrl: './timeframe-picker.component.html',
  styleUrl: './timeframe-picker.component.scss',
})
export class TimeframePickerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() start: string | Date | null = null;
  @Input() end: string | Date | null = null;
  @Input() shiftId: string | null = null;
  @Input() mode: TimeframePickerMode = 'custom';
  @Input() disabled = false;
  @Input() confirmLabel = 'Confirm';
  @Input() shifts: ShiftListItem[] | null = null;
  @Input() shiftsLoadError: string | null = null;
  @Output() confirmed = new EventEmitter<TimeframeSelection>();
  pickerStart: Date | null = null;
  pickerEnd: Date | null = null;
  pickerShiftId: string | null = null;
  pickerMode: TimeframePickerMode = 'custom';
  private destroy$ = new Subject<void>();
  private futureShiftTimer?: ReturnType<typeof setTimeout>;
  private shiftTimeRange = new ShiftTimeRange();

  private applyShiftTimes(): void {
    if (!this.pickerStart || !this.pickerEnd) return;
    const shift = this.shifts?.find(s => String(s._id) === this.pickerShiftId);
    const range = this.shiftTimeRange.apply(this.pickerStart, this.pickerEnd, this.pickerMode, shift);
    this.pickerStart = range.start;
    this.pickerEnd = range.end;
  }

  get isFutureTimeframe(): boolean {
    return futureTodayShiftStart(this.pickerMode, this.pickerShiftId, this.shifts) !== null;
  }

  private scheduleShiftStartCheck(): void {
    clearTimeout(this.futureShiftTimer);
    const start = futureTodayShiftStart(this.pickerMode, this.pickerShiftId, this.shifts);
    if (start !== null) this.futureShiftTimer = setTimeout(() => this.cdr?.markForCheck(), start - Date.now());
  }

  constructor(private shiftService: ShiftService, @Optional() private cdr?: ChangeDetectorRef) {}

  ngOnInit(): void {
    if (this.shifts !== null) return;
    this.shiftService.getActiveShifts().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.shifts = res.shifts || []; this.scheduleShiftStartCheck(); },
      error: () => { this.shifts = []; this.shiftsLoadError = 'Could not load shifts'; },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['shifts']) this.scheduleShiftStartCheck();
    if (!['start', 'end', 'shiftId', 'mode'].some(key => changes[key])) return;
    this.pickerStart = this.start ? new Date(this.start) : this.startOfToday();
    this.pickerEnd = this.end ? new Date(this.end) : new Date();
    this.pickerShiftId = this.shiftId;
    this.pickerMode = this.mode === 'shift' ? 'custom' : this.mode;
    this.shiftTimeRange.reset();
    this.scheduleShiftStartCheck();
  }

  ngOnDestroy(): void { clearTimeout(this.futureShiftTimer); this.destroy$.next(); this.destroy$.complete(); }

  get valid(): boolean {
    return !!this.pickerStart && !!this.pickerEnd &&
      Number.isFinite(this.pickerStart.getTime()) && Number.isFinite(this.pickerEnd.getTime()) &&
      this.pickerEnd > this.pickerStart;
  }

  get manualEnabled(): boolean { return !this.disabled && this.pickerMode === 'custom'; }

  selectShift(id: string | null): void {
    if (this.disabled) return;
    const hasSchedule = this.shifts?.some(s => s.startTime && s.endTime &&
      [this.pickerShiftId, id].includes(String(s._id)));
    this.pickerShiftId = id;
    if (this.pickerMode === 'custom' || !hasSchedule) this.applyShiftTimes();
    else this.quickSelect(this.pickerMode);
    this.scheduleShiftStartCheck();
  }

  quickSelect(mode: TimeframePickerMode): void {
    if (this.disabled) return;
    this.pickerMode = mode;
    this.scheduleShiftStartCheck();
    if (mode === 'custom') return;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let end = now;
    switch (mode) {
      case 'thisWeek':
        start.setDate(start.getDate() - start.getDay());
        break;
      case 'thisMonth':
        start.setDate(1);
        break;
      case 'thisYear':
        start.setMonth(0, 1);
        break;
      case 'yesterday':
        end = new Date(start);
        start.setDate(start.getDate() - 1);
        break;
      case 'lastWeek':
        start.setDate(start.getDate() - start.getDay());
        end = new Date(start);
        start.setDate(start.getDate() - 7);
        break;
      case 'lastMonth':
        start.setDate(1);
        end = new Date(start);
        start.setMonth(start.getMonth() - 1);
        break;
      case 'lastYear':
        start.setMonth(0, 1);
        end = new Date(start);
        start.setFullYear(start.getFullYear() - 1);
        break;
    }
    this.pickerStart = start;
    this.pickerEnd = end;
    this.shiftTimeRange.reset();
    this.applyShiftTimes();
  }

  confirm(): void {
    if (this.disabled || this.isFutureTimeframe) return;
    if (this.pickerMode === 'today' && !this.pickerShiftId) this.pickerEnd = new Date();
    if (!this.valid) return;
    this.confirmed.emit({ start: new Date(this.pickerStart!), end: new Date(this.pickerEnd!), shiftId: this.pickerShiftId, mode: this.pickerMode });
  }

  private startOfToday(): Date {
    const start = new Date(); start.setHours(0, 0, 0, 0); return start;
  }
}
