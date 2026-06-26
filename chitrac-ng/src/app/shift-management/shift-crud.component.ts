import { SelectionModel } from '@angular/cdk/collections';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import {
  ShiftBreakPayload,
  ShiftDefinitionPayload,
  ShiftDocument,
  ShiftService,
  ShiftTimeValue,
} from '../services/shift.service';
import {
  EditableBreak,
  doBreaksOverlap,
  formatTime,
  isBreakWithinShift,
  sortBreaksChronologically,
  toDateFromTimeValue,
  toMinutes,
  toTimeValue,
} from './shift-time.utils';
import {
  ShiftBreakDialogComponent,
  ShiftBreakDialogResult,
} from './shift-break-dialog.component';

@Component({
  selector: 'app-shift-crud',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatButtonToggleModule,
    MatTimepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
  ],
  templateUrl: './shift-crud.component.html',
  styleUrls: ['./shift-crud.component.scss'],
})
export class ShiftCrudComponent {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly shiftService = inject(ShiftService);

  /** `add` = blank form; `edit` = load `initialShift`. */
  editorMode = input<'add' | 'edit'>('add');
  initialShift = input<ShiftDocument | null>(null);
  saved = output<void>();
  canceled = output<void>();

  private editingId: string | undefined;
  private pristineState = '';

  readonly dayOptions = [
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thur', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
    { label: 'Sun', value: 7 },
  ];
  readonly displayedColumns = ['range'];

  constructor() {
    effect(() => {
      const mode = this.editorMode();
      const doc = this.initialShift();
      if (mode === 'add') {
        this.resetForm();
      } else if (mode === 'edit' && doc) {
        this.applyShiftDocument(doc);
      }
    });
  }

  shiftName = '';
  shiftActive = true;
  selectedDays: number[] = [];
  shiftStartDate = this.createDate(8, 0);
  shiftEndDate = this.createDate(16, 0);
  breaks: EditableBreak[] = [];
  selection = new SelectionModel<EditableBreak>(false, []);
  isSaving = false;

  get canEditOrDeleteBreak(): boolean {
    return this.selection.selected.length > 0;
  }

  get areAllDaysSelected(): boolean {
    return this.dayOptions.every((day) => this.selectedDays.includes(day.value));
  }

  toggleAllDays(): void {
    this.selectedDays = this.areAllDaysSelected
      ? []
      : this.dayOptions.map((day) => day.value);
  }

  formatBreakRange(breakValue: EditableBreak): string {
    return `${formatTime(breakValue.startTime)} - ${formatTime(breakValue.endTime)}`;
  }

  addBreak(): void {
    const dialogRef = this.dialog.open(ShiftBreakDialogComponent, {
      data: { mode: 'add' },
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((result?: ShiftBreakDialogResult) => {
      if (!result) {
        return;
      }
      const validationMessage = this.validateBreak(result, -1);
      if (validationMessage) {
        this.snackBar.open(validationMessage, 'Close', { duration: 3500 });
        return;
      }

      this.breaks = sortBreaksChronologically([...this.breaks, result]);
      this.selection.clear();
    });
  }

  editBreak(): void {
    const selected = this.selection.selected[0];
    if (!selected) {
      return;
    }

    const selectedIndex = this.breaks.findIndex(
      (breakValue) =>
        breakValue.startTime.hour === selected.startTime.hour &&
        breakValue.startTime.minute === selected.startTime.minute &&
        breakValue.endTime.hour === selected.endTime.hour &&
        breakValue.endTime.minute === selected.endTime.minute
    );
    if (selectedIndex === -1) {
      this.selection.clear();
      return;
    }

    const dialogRef = this.dialog.open(ShiftBreakDialogComponent, {
      data: { mode: 'edit', breakValue: selected },
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((result?: ShiftBreakDialogResult) => {
      if (!result) {
        return;
      }
      const validationMessage = this.validateBreak(result, selectedIndex);
      if (validationMessage) {
        this.snackBar.open(validationMessage, 'Close', { duration: 3500 });
        return;
      }

      const updatedBreaks = [...this.breaks];
      updatedBreaks[selectedIndex] = result;
      this.breaks = sortBreaksChronologically(updatedBreaks);
      this.selection.clear();
    });
  }

  deleteBreak(): void {
    const selected = this.selection.selected[0];
    if (!selected) {
      return;
    }

    this.breaks = this.breaks.filter((breakValue) => breakValue !== selected);
    this.selection.clear();
  }

  cancel(): void {
    if (!this.isPristine() && !confirm('Discard unsaved shift changes?')) {
      return;
    }

    if (this.editorMode() === 'add') {
      this.resetForm();
    } else {
      const doc = this.initialShift();
      if (doc) {
        this.applyShiftDocument(doc);
      }
    }
    this.canceled.emit();
  }

  saveShift(): void {
    const shiftValidation = this.validateShiftTimes();
    if (shiftValidation) {
      this.snackBar.open(shiftValidation, 'Close', { duration: 3500 });
      return;
    }

    const sortedBreaks = sortBreaksChronologically(this.breaks);
    const breaksValidation = this.validateAllBreaks(sortedBreaks);
    if (breaksValidation) {
      this.snackBar.open(breaksValidation, 'Close', { duration: 3500 });
      return;
    }

    this.breaks = sortedBreaks;
    this.selection.clear();

    const payload = this.buildShiftPayload();
    this.isSaving = true;
    this.shiftService.saveShiftDefinition(payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.snackBar.open('Shift saved.', 'Close', { duration: 2500 });
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.isSaving = false;
        const msg =
          err instanceof HttpErrorResponse && err.error && typeof err.error === 'object' && 'error' in err.error
            ? String((err.error as { error?: string }).error)
            : 'Could not save shift.';
        this.snackBar.open(msg, 'Close', { duration: 4500 });
      },
    });
  }

  selectBreakRow(row: EditableBreak): void {
    this.selection.toggle(row);
  }

  private isPristine(): boolean {
    return this.getFormState() === this.pristineState;
  }

  private capturePristineState(): void {
    this.pristineState = this.getFormState();
  }

  private getFormState(): string {
    return JSON.stringify({
      editingId: this.editingId ?? null,
      shiftName: this.shiftName,
      shiftActive: this.shiftActive,
      selectedDays: [...this.selectedDays].sort((a, b) => a - b),
      shiftStart: toTimeValue(this.shiftStartDate),
      shiftEnd: toTimeValue(this.shiftEndDate),
      breaks: this.breaks.map((breakValue) => ({
        startTime: breakValue.startTime,
        endTime: breakValue.endTime,
      })),
    });
  }

  private validateShiftTimes(): string | null {
    if (this.selectedDays.length === 0) {
      return 'Select at least one day for the shift.';
    }

    const shiftStart = toMinutes(toTimeValue(this.shiftStartDate));
    const shiftEnd = toMinutes(toTimeValue(this.shiftEndDate));
    if (shiftStart >= shiftEnd) {
      return 'Shift start time must be before shift end time.';
    }

    return null;
  }

  private validateBreak(candidate: EditableBreak, editingIndex: number): string | null {
    if (toMinutes(candidate.startTime) >= toMinutes(candidate.endTime)) {
      return 'Break start time must be before break end time.';
    }

    const shiftStart = toTimeValue(this.shiftStartDate);
    const shiftEnd = toTimeValue(this.shiftEndDate);
    if (!isBreakWithinShift(candidate, shiftStart, shiftEnd)) {
      return 'Break must stay within shift start and end times.';
    }

    const conflicts = this.breaks.some((existingBreak, index) => {
      if (index === editingIndex) {
        return false;
      }
      return doBreaksOverlap(existingBreak, candidate);
    });
    if (conflicts) {
      return 'Break overlaps with an existing break.';
    }

    return null;
  }

  private validateAllBreaks(breaks: EditableBreak[]): string | null {
    for (let i = 0; i < breaks.length; i += 1) {
      const candidate = breaks[i];
      const validation = this.validateBreak(candidate, i);
      if (validation) {
        return validation;
      }
    }
    return null;
  }

  private buildShiftPayload(): ShiftDefinitionPayload {
    const now = new Date().toISOString();
    const shiftStart = toTimeValue(this.shiftStartDate);
    const shiftEnd = toTimeValue(this.shiftEndDate);

    const shiftStartDateIso = toDateFromTimeValue(shiftStart).toISOString();
    const shiftEndDateIso = toDateFromTimeValue(shiftEnd).toISOString();

    const breakPayloads: ShiftBreakPayload[] = this.breaks.map((breakValue) => {
      const breakStartDate = toDateFromTimeValue(breakValue.startTime);
      const breakEndDate = toDateFromTimeValue(breakValue.endTime);
      return {
        active: true,
        timestamps: {
          create: now,
          active: now,
          update: now,
          start: breakStartDate.toISOString(),
          end: breakEndDate.toISOString(),
        },
        breakTime: breakEndDate.getTime() - breakStartDate.getTime(),
        startTime: breakValue.startTime,
        endTime: breakValue.endTime,
      };
    });

    const shiftStartMinutes = toMinutes(shiftStart);
    const shiftEndMinutes = toMinutes(shiftEnd);

    return {
      ...(this.editingId ? { _id: this.editingId } : {}),
      active: this.shiftActive,
      name: this.shiftName.trim() || undefined,
      timestamps: {
        create: now,
        active: now,
        update: now,
        start: shiftStartDateIso,
        end: shiftEndDateIso,
      },
      shiftTime: (shiftEndMinutes - shiftStartMinutes) * 60 * 1000,
      breaks: breakPayloads,
      startTime: shiftStart,
      endTime: shiftEnd,
      activeDays: [...this.selectedDays].sort((a, b) => a - b),
    };
  }

  private createDate(hour: number, minute: number): Date {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date;
  }

  private resetForm(): void {
    this.editingId = undefined;
    this.shiftName = '';
    this.shiftActive = true;
    this.selectedDays = [];
    this.shiftStartDate = this.createDate(8, 0);
    this.shiftEndDate = this.createDate(16, 0);
    this.breaks = [];
    this.selection.clear();
    this.capturePristineState();
  }

  private applyShiftDocument(doc: ShiftDocument): void {
    this.editingId = doc._id;
    this.shiftName = doc.name ?? '';
    this.shiftActive = doc.active !== false;
    this.selectedDays = doc.activeDays ? [...doc.activeDays] : [];
    if (doc.startTime) {
      this.shiftStartDate = toDateFromTimeValue(doc.startTime);
    }
    if (doc.endTime) {
      this.shiftEndDate = toDateFromTimeValue(doc.endTime);
    }
    this.breaks = sortBreaksChronologically(
      (doc.breaks ?? []).map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
      }))
    );
    this.selection.clear();
    this.capturePristineState();
  }
}
