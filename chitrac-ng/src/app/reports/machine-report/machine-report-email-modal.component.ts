import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

export interface MachineReportEmailDialogData {
  startTime: string;
  endTime: string;
  summaryOnly: boolean;
}

@Component({
  selector: 'app-machine-report-email-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule
  ],
  templateUrl: './machine-report-email-modal.component.html',
  styleUrls: ['./machine-report-email-modal.component.scss']
})
export class MachineReportEmailModalComponent {
  readonly emailControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email]
  });

  constructor(
    private dialogRef: MatDialogRef<MachineReportEmailModalComponent, string | null>,
    @Inject(MAT_DIALOG_DATA) public data: MachineReportEmailDialogData
  ) {}

  submit(): void {
    if (this.emailControl.invalid) {
      this.emailControl.markAsTouched();
      return;
    }

    this.dialogRef.close(this.emailControl.value.trim());
  }
}
