import { Component, inject } from '@angular/core';
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
export class ShiftBreakDialogComponent {
  readonly dialogRef = inject(MatDialogRef<ShiftBreakDialogComponent>);
  readonly dialogData = inject<ShiftBreakDialogData>(MAT_DIALOG_DATA);

  breakStart: Date = this.dialogData.breakValue
    ? toDateFromTimeValue(this.dialogData.breakValue.startTime)
    : this.getDefaultStart();
  breakEnd: Date = this.dialogData.breakValue
    ? toDateFromTimeValue(this.dialogData.breakValue.endTime)
    : this.getDefaultEnd();

  validationError = '';

  get actionLabel(): 'Add' | 'Edit' {
    return this.dialogData.mode === 'edit' ? 'Edit' : 'Add';
  }

  submit(): void {
    const startTime = toTimeValue(this.breakStart);
    const endTime = toTimeValue(this.breakEnd);
    if ((startTime.hour * 60 + startTime.minute) >= (endTime.hour * 60 + endTime.minute)) {
      this.validationError = 'Break start time must be before break end time.';
      return;
    }

    this.dialogRef.close({ startTime, endTime } as ShiftBreakDialogResult);
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
