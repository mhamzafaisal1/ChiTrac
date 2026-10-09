import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
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

export type TimeframePickerMode = 'custom' | 'shift' | 'today' | 'thisWeek' | 'thisMonth' | 'thisYear';
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
  @Input() shifts: ShiftListItem[] | null = null;
  @Input() shiftsLoadError: string | null = null;
  @Output() confirmed = new EventEmitter<TimeframeSelection>();
  pickerStart: Date | null = null;
  pickerEnd: Date | null = null;
  pickerShiftId: string | null = null;
  pickerMode: TimeframePickerMode = 'custom';
  private destroy$ = new Subject<void>();

  constructor(private shiftService: ShiftService) {}

  ngOnInit(): void {
    if (this.shifts !== null) return;
    this.shiftService.getActiveShifts().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => this.shifts = res.shifts || [],
      error: () => { this.shifts = []; this.shiftsLoadError = 'Could not load shifts'; },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!['start', 'end', 'shiftId', 'mode'].some(key => changes[key])) return;
    this.pickerStart = this.start ? new Date(this.start) : this.startOfToday();
    this.pickerEnd = this.end ? new Date(this.end) : new Date();
    this.pickerShiftId = this.shiftId;
    this.pickerMode = this.mode;
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  get valid(): boolean {
    return !!this.pickerStart && !!this.pickerEnd &&
      Number.isFinite(this.pickerStart.getTime()) && Number.isFinite(this.pickerEnd.getTime()) &&
      this.pickerEnd > this.pickerStart;
  }

  get manualEnabled(): boolean { return !this.disabled && this.pickerMode === 'custom'; }

  selectShift(id: string | null): void {
    if (this.disabled) return;
    this.pickerShiftId = id;
    this.pickerMode = id ? 'shift' : 'custom';
  }

  quickSelect(mode: TimeframePickerMode): void {
    if (this.disabled) return;
    this.pickerShiftId = null;
    this.pickerMode = mode;
    if (mode === 'custom') return;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (mode === 'thisWeek') start.setDate(start.getDate() - start.getDay());
    if (mode === 'thisMonth') start.setDate(1);
    if (mode === 'thisYear') { start.setMonth(0, 1); }
    this.pickerStart = start;
    this.pickerEnd = now;
  }

  confirm(): void {
    if (this.disabled || !this.valid) return;
    this.confirmed.emit({ start: new Date(this.pickerStart!), end: new Date(this.pickerEnd!), shiftId: this.pickerShiftId, mode: this.pickerMode });
  }

  private startOfToday(): Date {
    const start = new Date(); start.setHours(0, 0, 0, 0); return start;
  }
}
