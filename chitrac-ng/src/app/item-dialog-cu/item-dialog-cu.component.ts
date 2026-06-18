import { Component, inject, model, OnInit, EventEmitter, Output } from '@angular/core';
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
import { MatCheckboxModule } from '@angular/material/checkbox';

/*** Model Imports */
import { ItemConfig } from '../shared/models/item.model';

import { debounceTime, distinctUntilChanged } from "rxjs/operators";

@Component({
    selector: 'app-item-dialog-cu',
    imports: [CommonModule,
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
        MatCheckboxModule],
    templateUrl: './item-dialog-cu.component.html',
    styleUrl: './item-dialog-cu.component.scss'
})
export class ItemDialogCuComponent implements OnInit {
  @Output() submitEvent = new EventEmitter();

  readonly dialogRef = inject(MatDialogRef<ItemDialogCuComponent>);
  readonly dialogData = inject(MAT_DIALOG_DATA);
  item: ItemConfig;
  itemName: string;
  selectedPhotoName = '';
  selectedPhotoPreview: string | null = null;
  error: any = null;
  codeControl: FormControl;

  itemFormGroup: FormGroup;

  ngOnInit() {
    if (this.dialogData.error) {
      this.error = Object.assign({}, this.dialogData.error);
      delete this.dialogData.error;
    }
    this.item = Object.assign({}, this.dialogData);
    this.itemName = this.item.name + '';
    this.codeControl = new FormControl();
    this.itemFormGroup = new FormGroup({
      number: new FormControl(this.item.number, [Validators.required, Validators.min(1)]),
      name: new FormControl(this.item.name, [Validators.required, Validators.minLength(4)]),
      standard: new FormControl(this.item.standard ?? 0, [Validators.required, Validators.min(0)]),
      active: new FormControl(this.item.active, [Validators.required]),
      weight: new FormControl(this.item.weight),  // optional
      applyAfterMachinesOffline: new FormControl(false)
    });

    if (this.error) this.itemFormGroup.markAsDirty();

    this.itemFormGroup.valueChanges.pipe(
      debounceTime(100),
      distinctUntilChanged()
    ).subscribe(res => {
      this.item.number = res.number;
      this.item.name = res.name;
      this.item.standard = res.standard;
      this.item.active = res.active;
      this.item.weight = res.weight;
      // Preserve additional properties that aren't in the form
      // These properties are read-only in the current UI but needed for validation
    });
    this.dialogRef.backdropClick().subscribe(result => {
      if (!this.itemFormGroup.pristine) {
        console.log('Are you sure?');
      } else {
        this.dialogRef.close();
      }
    });
  };

  getPhotoUrl(photo?: string): string | null {
    if (!photo) return null;
    const fileName = photo.split(/[\\/]/).pop();
    return fileName ? `/uploads/images/${encodeURIComponent(fileName)}` : null;
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.error = {
        message: 'Only JPG and PNG item images are allowed.',
        details: []
      };
      input.value = '';
      return;
    }

    this.error = null;
    this.item.photoFile = file;
    this.selectedPhotoName = file.name;
    if (this.selectedPhotoPreview) URL.revokeObjectURL(this.selectedPhotoPreview);
    this.selectedPhotoPreview = URL.createObjectURL(file);
    this.itemFormGroup.markAsDirty();
  }

  submit() {
    if (!this.itemFormGroup.valid) return;

    const formValue = this.itemFormGroup.getRawValue();
    this.dialogRef.close({
      ...this.item,
      number: formValue.number,
      name: formValue.name,
      standard: formValue.standard,
      active: formValue.active,
      weight: formValue.weight,
      photo: this.item.photo,
      photoFile: this.item.photoFile,
      applyAfterMachinesOffline: formValue.applyAfterMachinesOffline
    });
  }
}
