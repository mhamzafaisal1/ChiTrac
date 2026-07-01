import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { MachineConfig } from '../shared/models/machine.model';

@Component({
  selector: 'app-machine-dialog-cu',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatSlideToggleModule
  ],
  templateUrl: './machine-dialog-cu.component.html',
  styleUrl: './machine-dialog-cu.component.scss'
})
export class MachineDialogCuComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<MachineDialogCuComponent>);
  readonly dialogData = inject(MAT_DIALOG_DATA);

  machine: MachineConfig;
  machineName = '';
  error: { message?: string; fieldErrors?: Record<string, string> } | null = null;
  machineFormGroup: FormGroup;

  ngOnInit(): void {
    if (this.dialogData.error) {
      this.error = { ...this.dialogData.error };
      delete this.dialogData.error;
    }

    this.machine = { ...this.dialogData };
    this.machineName = this.machine.name || '';
    this.machineFormGroup = new FormGroup({
      serial: new FormControl(this.machine.serial, [
        Validators.required,
        Validators.min(1)
      ]),
      name: new FormControl(this.machine.name, [
        Validators.required,
        Validators.minLength(2)
      ]),
      ipAddress: new FormControl(this.machine.ipAddress, [
        Validators.required,
        Validators.pattern(
          /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
        )
      ]),
      lanes: new FormControl(this.machine.lanes, [
        Validators.required,
        Validators.min(1)
      ]),
      active: new FormControl(this.machine.active, [Validators.required])
    });

    Object.keys(this.error?.fieldErrors || {}).forEach(field => {
      const control = this.machineFormGroup.get(field);
      control?.setErrors({ ...(control.errors || {}), duplicate: true });
      control?.markAsTouched();
    });

    this.dialogRef.backdropClick().subscribe(() => {
      if (this.machineFormGroup.pristine) this.dialogRef.close();
    });
  }

  getDuplicateError(field: string): string {
    return this.error?.fieldErrors?.[field] || '';
  }

  submit(): void {
    if (this.machineFormGroup.invalid) return;

    const values = this.machineFormGroup.getRawValue();
    const lanes = Number(values.lanes);
    this.dialogRef.close({
      ...this.machine,
      serial: Number(values.serial),
      name: String(values.name).trim(),
      ipAddress: String(values.ipAddress).trim(),
      lanes,
      active: !!values.active,
      stations: Array.from({ length: lanes }, (_, index) => index + 1)
    });
  }
}
