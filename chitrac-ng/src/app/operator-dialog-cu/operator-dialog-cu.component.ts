import { Component, inject, model, OnInit, EventEmitter, Output, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators, FormArray, FormBuilder } from '@angular/forms';

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
import { MatIconModule } from '@angular/material/icon';

/*** Model Imports */
import { OperatorConfig, NameObject } from '../shared/models/operator.model';

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
        MatSlideToggleModule,
        MatIconModule
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
  
  useComplexName: boolean = false;
  operatorFormGroup: FormGroup;
  complexNameFormGroup: FormGroup;
  private fb = new FormBuilder();

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
    
    // Check if name is already a complex object
    const nameIsObject = typeof this.operator.name === 'object' && this.operator.name !== null;
    this.useComplexName = nameIsObject;
    
    if (typeof this.operator.name === 'string') {
      this.operatorName = this.operator.name;
    } else if (nameIsObject) {
      const nameObj = this.operator.name as any;
      this.operatorName = [nameObj.first, nameObj.surname].filter(Boolean).join(' ') || 'Unknown';
    }
    
    this.codeControl = new FormControl();
    
    // Initialize simple name form
    const simpleName = typeof this.operator.name === 'string' ? this.operator.name : '';
    // Only require name field if NOT using complex mode
    const nameValidators = this.useComplexName ? [] : [Validators.required, Validators.minLength(4)];
    this.operatorFormGroup = new FormGroup({
      code: new FormControl(this.operator.code, [Validators.required, Validators.min(100000)]),
      name: new FormControl(simpleName, nameValidators),
      active: new FormControl(this.operator.active)
    });

    // Initialize complex name form
    const nameObj = nameIsObject ? (this.operator.name as any) : {};
    const additionalSurnamesArray = (nameObj.additionalSurnames || []).map((surname: string) => this.fb.control(surname));
    
    this.complexNameFormGroup = this.fb.group({
      first: [nameObj.first || '', Validators.required],
      surname: [nameObj.surname || '', Validators.required],
      prefix: [nameObj.prefix || ''],
      suffix: [nameObj.suffix || ''],
      middle: [nameObj.middle || ''],
      middleInitial: [nameObj.middleInitial || ''],
      additionalSurnames: this.fb.array(additionalSurnamesArray),
      lastFirst: [nameObj.lastFirst || false]
    });

    if (this.error) {
      this.operatorFormGroup.markAsDirty();
      this.complexNameFormGroup.markAsDirty();
    }

    // Subscribe to simple name changes
    this.operatorFormGroup.valueChanges.pipe(
        debounceTime(100),
        distinctUntilChanged()
      ).subscribe(res => {
        this.operator.code = res.code;
        if (!this.useComplexName) {
          this.operator.name = res.name;
        }
        this.operator.active = res.active;
        console.log('Simple form updated:', res);
        console.log('Operator object:', this.operator);
      });

    // Subscribe to complex name changes
    this.complexNameFormGroup.valueChanges.pipe(
        debounceTime(100),
        distinctUntilChanged()
      ).subscribe(res => {
        if (this.useComplexName) {
          this.operator.name = res;
        }
        console.log('Complex form updated:', res);
        console.log('Operator object:', this.operator);
      });
  }

  toggleComplexName() {
    this.useComplexName = !this.useComplexName;
    
    // Update validators based on mode
    const nameControl = this.operatorFormGroup.get('name');
    if (this.useComplexName) {
      // Complex mode: remove required validator from simple name
      nameControl?.clearValidators();
      nameControl?.updateValueAndValidity();
      
      if (typeof this.operator.name === 'string') {
        // Try to parse simple name into first and surname
        const parts = this.operator.name.trim().split(/\s+/);
        if (parts.length > 0) {
          this.complexNameFormGroup.patchValue({
            first: parts[0],
            surname: parts.slice(1).join(' ') || ''
          });
        }
      }
    } else {
      // Simple mode: restore required validators
      nameControl?.setValidators([Validators.required, Validators.minLength(4)]);
      nameControl?.updateValueAndValidity();
    }
  }

  get isFormValid(): boolean {
    if (this.useComplexName) {
      // Complex mode: both forms must be valid
      const isValid = this.operatorFormGroup.valid && this.complexNameFormGroup.valid;
      console.log('Complex mode validation:', {
        operatorValid: this.operatorFormGroup.valid,
        complexValid: this.complexNameFormGroup.valid,
        overallValid: isValid,
        operatorErrors: this.operatorFormGroup.errors,
        complexErrors: this.complexNameFormGroup.errors
      });
      return isValid;
    } else {
      // Simple mode: only main form needs to be valid
      console.log('Simple mode validation:', {
        valid: this.operatorFormGroup.valid,
        errors: this.operatorFormGroup.errors
      });
      return this.operatorFormGroup.valid;
    }
  }

  get additionalSurnamesFormArray(): FormArray {
    return this.complexNameFormGroup.get('additionalSurnames') as FormArray;
  }

  addAdditionalSurname() {
    this.additionalSurnamesFormArray.push(this.fb.control(''));
  }

  removeAdditionalSurname(index: number) {
    this.additionalSurnamesFormArray.removeAt(index);
  }

  getDisplayName(): string {
    if (typeof this.operator.name === 'string') {
      return this.operator.name;
    }
    const nameObj = this.operator.name as any;
    return [nameObj.first, nameObj.surname].filter(Boolean).join(' ') || 'Unknown';
  };
}