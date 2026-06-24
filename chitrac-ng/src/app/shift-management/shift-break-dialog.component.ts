import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatError } from '@angular/material/form-field';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ShiftTimeValue } from '../services/shift.service';
import { EditableBreak, toDateFromTimeValue, toTimeValue } from './shift-time.utils';

export interface ShiftBreakDialogData {
  mode: 'add' | 'edit';
  breakValue?: EditableBreak;
}

export interface ShiftBreakDialogResult {
  startTime: ShiftTimeValue;
  endTime: ShiftTimeValue;
}

@Component({
  selector: 'app-shift-break-dialog',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTimepickerModule,
    MatNativeDateModule,
    MatError,
  ],
  templateUrl: './shift-break-dialog.component.html',
  styleUrls: ['./shift-break-dialog.component.scss'],
})
export class ShiftBreakDialogComponent implements OnDestroy {
  readonly dialogRef = inject(MatDialogRef<ShiftBreakDialogComponent>);
  readonly dialogData = inject<ShiftBreakDialogData>(MAT_DIALOG_DATA);
  private readonly validationChanges = new Subject<void>();
  private readonly validationSub: Subscription;

  breakStart: Date = this.dialogData.breakValue
    ? toDateFromTimeValue(this.dialogData.breakValue.startTime)
    : this.getDefaultStart();
  breakEnd: Date = this.dialogData.breakValue
    ? toDateFromTimeValue(this.dialogData.breakValue.endTime)
    : this.getDefaultEnd();

  validationError = '';

  constructor() {
    this.validationSub = this.validationChanges
      .pipe(debounceTime(750))
      .subscribe(() => this.updateValidationError());
  }

  get actionLabel(): 'Add' | 'Edit' {
    return this.dialogData.mode === 'edit' ? 'Edit' : 'Add';
  }

  ngOnDestroy(): void {
    this.validationSub.unsubscribe();
    this.validationChanges.complete();
  }

  onBreakStartChange(nextStart: Date): void {
    const currentDurationMs = this.breakEnd.getTime() - this.breakStart.getTime();
    this.breakStart = nextStart;
    this.breakEnd = new Date(nextStart.getTime() + currentDurationMs);
    this.queueValidation();
  }

  onBreakEndChange(nextEnd: Date): void {
    this.breakEnd = nextEnd;
    this.queueValidation();
  }

  submit(): void {
    const startTime = toTimeValue(this.breakStart);
    const endTime = toTimeValue(this.breakEnd);
    this.updateValidationError();
    if (this.validationError) {
      return;
    }

    this.dialogRef.close({ startTime, endTime } as ShiftBreakDialogResult);
  }

  private queueValidation(): void {
    this.validationError = '';
    this.validationChanges.next();
  }

  private updateValidationError(): void {
    const startTime = toTimeValue(this.breakStart);
    const endTime = toTimeValue(this.breakEnd);
    this.validationError = (startTime.hour * 60 + startTime.minute) >= (endTime.hour * 60 + endTime.minute)
      ? 'Break start time must be before break end time.'
      : '';
  }

  private getDefaultStart(): Date {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    return start;
  }

  private getDefaultEnd(): Date {
    const end = new Date();
    end.setHours(10, 15, 0, 0);
    return end;
  }
}
