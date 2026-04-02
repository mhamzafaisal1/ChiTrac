import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogRef } from '@angular/material/dialog';
import { ModalWrapperComponent } from '../../components/modal-wrapper-component/modal-wrapper-component.component';
import { UserWithEmailRow } from '../../user.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-machine-report-email-modal',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './machine-report-email-modal.component.html',
  styleUrls: ['./machine-report-email-modal.component.scss'],
})
export class MachineReportEmailModalComponent {
  private dialogRef = inject(MatDialogRef<ModalWrapperComponent>);

  @Input() usersWithEmail: UserWithEmailRow[] = [];

  email = '';
  selectedUserId: string | null = null;
  validationMessage = '';

  get showUserDropdown(): boolean {
    return (this.usersWithEmail?.length ?? 0) > 0;
  }

  cancel(): void {
    console.log('[machine-report][email] modal cancel');
    this.dialogRef.close();
  }

  send(): void {
    if (this.selectedUserId) {
      const u = this.usersWithEmail.find((x) => x._id === this.selectedUserId);
      const fromUser = u?.emailAddress?.trim();
      if (fromUser) {
        this.validationMessage = '';
        console.log('[machine-report][email] modal send (user selection)', u?.local?.username, fromUser);
        this.dialogRef.close({ email: fromUser });
        return;
      }
    }

    const trimmed = this.email.trim();
    if (!trimmed) {
      console.log('[machine-report][email] modal send blocked: no user and empty email');
      this.validationMessage = 'Select a user or enter an email address.';
      return;
    }
    if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
      console.log('[machine-report][email] modal send blocked: invalid format');
      this.validationMessage = 'Enter a valid email address.';
      return;
    }
    this.validationMessage = '';
    console.log('[machine-report][email] modal send closing with manual email', trimmed);
    this.dialogRef.close({ email: trimmed });
  }
}
