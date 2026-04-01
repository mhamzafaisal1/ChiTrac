import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogRef } from '@angular/material/dialog';
import { ModalWrapperComponent } from '../../components/modal-wrapper-component/modal-wrapper-component.component';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-machine-report-email-modal',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './machine-report-email-modal.component.html',
  styleUrls: ['./machine-report-email-modal.component.scss'],
})
export class MachineReportEmailModalComponent {
  private dialogRef = inject(MatDialogRef<ModalWrapperComponent>);

  email = '';
  validationMessage = '';

  cancel(): void {
    console.log('[machine-report][email] modal cancel');
    this.dialogRef.close();
  }

  send(): void {
    const trimmed = this.email.trim();
    if (!trimmed) {
      console.log('[machine-report][email] modal send blocked: empty email');
      this.validationMessage = 'Enter an email address.';
      return;
    }
    if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
      console.log('[machine-report][email] modal send blocked: invalid format');
      this.validationMessage = 'Enter a valid email address.';
      return;
    }
    this.validationMessage = '';
    console.log('[machine-report][email] modal send closing with email', trimmed);
    this.dialogRef.close({ email: trimmed });
  }
}
