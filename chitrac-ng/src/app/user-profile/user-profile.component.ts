import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { UserService } from '../user.service';

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

@Component({
  selector: 'app-user-profile',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSnackBarModule
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent implements OnInit {
  isLoading = false;
  isSaving = false;

  profileFormGroup = new FormGroup({
    username: new FormControl('', [Validators.required, Validators.minLength(4)]),
    email: new FormControl('', [Validators.pattern(EMAIL_PATTERN)]),
    currentPassword: new FormControl('', [Validators.maxLength(64)]),
    password: new FormControl('', [Validators.minLength(6), Validators.maxLength(64)]),
    confirmPassword: new FormControl('', [Validators.maxLength(64)])
  });

  constructor(
    private userService: UserService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.isLoading = true;
    this.userService.getProfile().subscribe({
      next: (res) => {
        this.isLoading = false;
        this.profileFormGroup.patchValue({
          username: res.user?.username || '',
          email: res.user?.email || '',
          currentPassword: '',
          password: '',
          confirmPassword: ''
        });
      },
      error: (err) => {
        this.isLoading = false;
        this.showError(err, 'Failed to load profile');
      }
    });
  }

  saveProfile(): void {
    if (this.profileFormGroup.invalid) {
      this.profileFormGroup.markAllAsTouched();
      return;
    }

    const value = this.profileFormGroup.value;
    const password = `${value.password || ''}`;
    const confirmPassword = `${value.confirmPassword || ''}`;
    const currentPassword = `${value.currentPassword || ''}`;

    if (password && password !== confirmPassword) {
      this.profileFormGroup.get('confirmPassword')?.setErrors({ mismatch: true });
      this.profileFormGroup.get('confirmPassword')?.markAsTouched();
      return;
    }

    if (password && !currentPassword) {
      this.profileFormGroup.get('currentPassword')?.setErrors({ required: true });
      this.profileFormGroup.get('currentPassword')?.markAsTouched();
      return;
    }

    const payload: any = {
      username: `${value.username || ''}`.trim(),
      email: `${value.email || ''}`.trim()
    };

    if (password) {
      payload.currentPassword = currentPassword;
      payload.password = password;
    }

    this.isSaving = true;
    this.userService.updateProfile(payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.profileFormGroup.patchValue({
          currentPassword: '',
          password: '',
          confirmPassword: ''
        });
        this.snackBar.open('Profile saved', 'Close', { duration: 3000 });
      },
      error: (err) => {
        this.isSaving = false;
        this.showError(err, 'Failed to save profile');
      }
    });
  }

  private showError(err: any, fallback: string): void {
    const message = err?.error?.error || err?.error?.message || err?.message || fallback;
    this.snackBar.open(message, 'Close', { duration: 5000 });
  }
}
