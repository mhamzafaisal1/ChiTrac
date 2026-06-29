import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { UserManagementService } from '../services/user-management.service';

@Component({
  selector: 'app-password-reset',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
  ],
  templateUrl: './password-reset.component.html',
  styleUrl: './password-reset.component.scss'
})
export class PasswordResetComponent implements OnInit {
  token = '';
  isSaving = false;
  isComplete = false;
  errorMessage = '';

  passwordForm = new FormGroup({
    password: new FormControl('', [
      Validators.required,
      Validators.minLength(6),
      Validators.maxLength(64)
    ]),
    confirmPassword: new FormControl('', [
      Validators.required,
      Validators.maxLength(64)
    ])
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userManagementService: UserManagementService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token')?.trim() || '';
    if (!this.token) {
      this.errorMessage = 'This password reset link is invalid or has expired.';
    }
  }

  submit(): void {
    this.errorMessage = '';
    if (!this.token || this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      if (!this.token) this.errorMessage = 'This password reset link is invalid or has expired.';
      return;
    }

    const password = this.passwordForm.controls.password.value || '';
    const confirmPassword = this.passwordForm.controls.confirmPassword.value || '';
    if (password !== confirmPassword) {
      this.passwordForm.controls.confirmPassword.setErrors({ mismatch: true });
      this.passwordForm.controls.confirmPassword.markAsTouched();
      return;
    }

    this.isSaving = true;
    this.userManagementService.completePasswordReset(this.token, password).subscribe({
      next: () => {
        this.isSaving = false;
        this.isComplete = true;
        setTimeout(() => this.router.navigate(['/ng/login']), 2000);
      },
      error: (err) => {
        this.isSaving = false;
        this.errorMessage = err?.error?.error || 'This password reset link is invalid or has expired.';
      }
    });
  }
}
