import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import {
  MaintenanceShiftDefinitionPayload,
  MaintenanceShiftDocument,
  ShiftService,
} from '../services/shift.service';
import {
  toDateFromTimeValue,
  toMinutes,
  toTimeValue,
} from './shift-time.utils';

@Component({
  selector: 'app-maintenance-shift-crud',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatTimepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
  ],
  templateUrl: './maintenance-shift-crud.component.html',
  styleUrls: ['./shift-crud.component.scss'],
})
export class MaintenanceShiftCrudComponent {
  private readonly snackBar = inject(MatSnackBar);
  private readonly shiftService = inject(ShiftService);

  /** `add` = blank form; `edit` = load `initialShift`. */
  editorMode = input<'add' | 'edit'>('add');
  initialShift = input<MaintenanceShiftDocument | null>(null);
  saved = output<void>();

  private editingId: string | undefined;

  readonly dayOptions = [
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thur', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
    { label: 'Sun', value: 7 },
  ];

  shiftName = '';
  shiftActive = true;
  selectedDays: number[] = [];
  shiftStartDate = this.createDate(22, 0);
  shiftEndDate = this.createDate(23, 0);
  isSaving = false;

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

  saveShift(): void {
    const shiftValidation = this.validateShiftTimes();
    if (shiftValidation) {
      this.snackBar.open(shiftValidation, 'Close', { duration: 3500 });
      return;
    }

    const payload = this.buildShiftPayload();
    this.isSaving = true;
    this.shiftService.saveMaintenanceShiftDefinition(payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.snackBar.open('Maintenance shift saved.', 'Close', { duration: 2500 });
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.isSaving = false;
        const msg =
          err instanceof HttpErrorResponse && err.error && typeof err.error === 'object' && 'error' in err.error
            ? String((err.error as { error?: string }).error)
            : 'Could not save maintenance shift.';
        this.snackBar.open(msg, 'Close', { duration: 4500 });
      },
    });
  }

  private validateShiftTimes(): string | null {
    if (this.selectedDays.length === 0) {
      return 'Select at least one day for the maintenance shift.';
    }

    const shiftStart = toMinutes(toTimeValue(this.shiftStartDate));
    const shiftEnd = toMinutes(toTimeValue(this.shiftEndDate));
    if (shiftStart >= shiftEnd) {
      return 'Maintenance shift start time must be before maintenance shift end time.';
    }

    return null;
  }

  private buildShiftPayload(): MaintenanceShiftDefinitionPayload {
    const now = new Date().toISOString();
    const shiftStart = toTimeValue(this.shiftStartDate);
    const shiftEnd = toTimeValue(this.shiftEndDate);

    const shiftStartDateIso = toDateFromTimeValue(shiftStart).toISOString();
    const shiftEndDateIso = toDateFromTimeValue(shiftEnd).toISOString();
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
    this.shiftStartDate = this.createDate(22, 0);
    this.shiftEndDate = this.createDate(23, 0);
  }

  private applyShiftDocument(doc: MaintenanceShiftDocument): void {
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
  }
}
