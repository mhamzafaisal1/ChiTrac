import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, Subscription, first } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { UserService, PasswordResetVerifyResponse } from '../user.service';

function passwordMatchValidator(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const pass = group.get('password');
    const confirm = group.get('confirmPassword');
    if (!pass || !confirm) return null;
    const a = pass.value;
    const b = confirm.value;
    if (a == null || b == null || a === '' || b === '') return null;
    return a === b ? null : { passwordMismatch: true };
  };
}

@Component({
  selector: 'app-password-reset',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './password-reset.component.html',
  styleUrl: './password-reset.component.scss',
})
export class PasswordResetComponent implements OnInit, OnDestroy {
  resetForm: FormGroup | null = null;

  private resetToken = '';

  /** Populated after successful GET verify; used for POST body.user */
  private verifiedAccount: {
    _id: string;
    username: string;
    emailAddress: string;
  } | null = null;

  verifyLoading = false;
  verifyError: string | null = null;
  verifiedUsername: string | null = null;

  submitError: string | null = null;
  submitting = false;

  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.subs.add(
      combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(
        ([params, query]) => {
          this.submitError = null;
          this.verifiedAccount = null;
          this.verifiedUsername = null;
          this.resetForm = null;

          const raw =
            params.get('token')?.trim() || query.get('token')?.trim() || '';
          let token = raw;
          if (token) {
            try {
              token = decodeURIComponent(token);
            } catch {
              /* use raw */
            }
          }
          this.resetToken = token;

          if (!token) {
            this.verifyLoading = false;
            this.verifyError =
              'This reset link is missing a token. Open the link from your email.';
            return;
          }
          this.verifyToken(token);
        }
      )
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private verifyToken(token: string): void {
    this.verifyLoading = true;
    this.verifyError = null;
    this.userService.verifyPasswordResetToken(token).subscribe({
      next: (res: PasswordResetVerifyResponse) => {
        this.verifyLoading = false;
        const username = res?.username ?? '';
        const _id = res?._id != null ? String(res._id) : '';
        const emailAddress = res?.emailAddress ?? '';
        if (!username || !_id) {
          this.verifyError = 'Could not load account information.';
          return;
        }
        this.verifiedUsername = username;
        this.verifiedAccount = { _id, username, emailAddress };
        this.buildForm();
      },
      error: (err) => {
        this.verifyLoading = false;
        this.verifyError =
          err?.error?.error ||
          err?.error?.message ||
          'This reset link is invalid or has expired.';
      },
    });
  }

  private buildForm(): void {
    this.resetForm = new FormGroup(
      {
        password: new FormControl('', [
          Validators.required,
          Validators.minLength(6),
        ]),
        confirmPassword: new FormControl('', [
          Validators.required,
          Validators.minLength(6),
        ]),
      },
      { validators: [passwordMatchValidator()] }
    );

    const runGroupValidity = () =>
      this.resetForm?.updateValueAndValidity({ emitEvent: false });
    this.subs.add(
      this.resetForm.get('password')!.valueChanges.subscribe(runGroupValidity)
    );
    this.subs.add(
      this.resetForm
        .get('confirmPassword')!
        .valueChanges.subscribe(runGroupValidity)
    );
  }

  get formReady(): boolean {
    return !!this.resetForm && this.resetForm.valid && !this.submitting;
  }

  onSubmit(): void {
    if (
      !this.resetForm?.valid ||
      !this.resetToken ||
      !this.verifiedAccount
    ) {
      this.resetForm?.markAllAsTouched();
      return;
    }
    const password = this.resetForm.get('password')?.value as string;
    this.submitting = true;
    this.submitError = null;
    this.userService
      .postPasswordReset({
        _id: this.verifiedAccount._id,
        local: { username: this.verifiedAccount.username },
        emailAddress: this.verifiedAccount.emailAddress,
        newPassword: password,
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.submitting = false;
          void this.router.navigateByUrl('/ng/login');
        },
        error: (err) => {
          this.submitting = false;
          this.submitError =
            err?.error?.error ||
            err?.error?.message ||
            'Could not reset password. Try again or request a new link.';
        },
      });
  }
}
