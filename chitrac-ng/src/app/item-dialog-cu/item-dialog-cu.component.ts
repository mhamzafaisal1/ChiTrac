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
        MatSlideToggleModule],
    templateUrl: './item-dialog-cu.component.html',
    styleUrl: './item-dialog-cu.component.scss'
})
export class ItemDialogCuComponent implements OnInit {
  @Output() submitEvent = new EventEmitter();

  readonly dialogRef = inject(MatDialogRef<ItemDialogCuComponent>);
  readonly dialogData = inject(MAT_DIALOG_DATA);
  item: ItemConfig;
  itemName: string;
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
      active: new FormControl(this.item.active, [Validators.required]),
      weight: new FormControl(this.item.weight)  // optional
    });

    if (this.error) this.itemFormGroup.markAsDirty();

    this.itemFormGroup.valueChanges.pipe(
      debounceTime(100),
      distinctUntilChanged()
    ).subscribe(res => {
      this.item.number = res.number;
      this.item.name = res.name;
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
}
