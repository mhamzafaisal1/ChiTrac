import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { first } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { UserService } from '../user.service';

@Component({
  selector: 'app-forgot-password',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    RouterLink,
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  form = new FormGroup({
    emailAddress: new FormControl('', [
      Validators.required,
      Validators.email,
    ]),
  });

  loading = false;
  message: string | null = null;
  error: string | null = null;

  constructor(private userService: UserService) {}

  onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }
    const emailAddress = String(this.form.get('emailAddress')?.value ?? '').trim();
    this.loading = true;
    this.error = null;
    this.message = null;
    this.userService
      .requestPasswordReset(emailAddress)
      .pipe(first())
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.message = res?.message ?? 'If an account exists, check your email for a reset link.';
        },
        error: (err) => {
          this.loading = false;
          this.error =
            err?.error?.error ||
            err?.error?.message ||
            'Could not send reset email.';
        },
      });
  }
}
