import { Component, inject, model, OnInit, EventEmitter, Output, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

/*** Model Imports */
import { OperatorConfig } from '../shared/models/operator.model';

import { debounceTime, distinctUntilChanged } from "rxjs/operators";

@Component({
    selector: 'app-operator-dialog-cu',
    imports: [
        CommonModule,
        MatFormFieldModule,
        MatInputModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatDialogTitle,
        MatDialogContent,
        MatDialogActions,
        MatDialogClose,
        MatSlideToggleModule
    ],
    templateUrl: './operator-dialog-cu.component.html',
    styleUrl: './operator-dialog-cu.component.scss'
})

export class OperatorDialogCuComponent implements OnInit {
  @Output() submitEvent = new EventEmitter();

  readonly dialogRef = inject(MatDialogRef<OperatorDialogCuComponent>);
  readonly dialogData = inject(MAT_DIALOG_DATA);
  operator: OperatorConfig;
  operatorName: string;
  error: any = null;
  codeControl: FormControl;

  operatorFormGroup: FormGroup;

  @ViewChild('submit') submit: ElementRef;

  onSubmit() {
    console.log('submit');
    this.submit.nativeElement.click();
  }
  
  ngOnInit() {
    if (this.dialogData.error) {
      this.error = Object.assign({}, this.dialogData.error);
      delete this.dialogData.error;
    }
    this.operator = Object.assign({}, this.dialogData);
    this.operatorName = this.operator.name + '';
    this.codeControl = new FormControl();
    this.operatorFormGroup = new FormGroup({
      code: new FormControl(this.operator.code, [Validators.required, Validators.min(100000)]),
      name: new FormControl(this.operator.name, [Validators.required, Validators.minLength(4)]),
      active: new FormControl(this.operator.active) // no Validators.required
    });

    if (this.error) this.operatorFormGroup.markAsDirty();

    this.operatorFormGroup.valueChanges.pipe(
        debounceTime(100),
        distinctUntilChanged()
      ).subscribe(res => {
        this.operator.code = res.code;
        this.operator.name = res.name;
        this.operator.active = res.active;
      });
    // Removed backdrop auto-close to prevent surprise closures
  };
}