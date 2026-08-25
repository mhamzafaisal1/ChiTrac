import { Component, OnInit, EventEmitter, Output, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

/*** rxjs Imports */
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, first } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

/*** Service Imports */
import { UserService } from '../user.service';

@Component({
    selector: 'app-user-login',
    standalone: true,
    imports: [
        CommonModule,
        MatFormFieldModule,
        MatInputModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatIconModule
    ],
    templateUrl: './user-login.component.html',
    styleUrl: './user-login.component.scss'
})
export class UserLoginComponent implements OnInit {

  sub: Subscription;
  @Output() closeModal = new EventEmitter<void>();
  @ViewChild(FormGroupDirective) loginFormDirective?: FormGroupDirective;
  @ViewChild('usernameInput') usernameInput: ElementRef;
  @ViewChild('passwordInput') passwordInput: ElementRef;

  userLoginFormGroup: FormGroup;

  user: any = {
    username: null,
    password: null
  };
  error: string | null = null;
  isLoggingIn = false;
  private loginErrorIsInvalidCredentials = false;

  subscribeToUser(): void {
    if (this.sub) {
      this.sub.unsubscribe();
    }
    this.sub = this.userService.user.subscribe(x => this.user = x);
  }

  constructor(private userService: UserService, private route: ActivatedRoute, private router: Router) {
    
  }

  ngOnInit(): void {
    this.userLoginFormGroup = new FormGroup({
      username: new FormControl(this.user.username, [Validators.required, Validators.minLength(4)]),
      password: new FormControl(this.user.password, [Validators.required, Validators.minLength(6)]),
    });

    if (this.error) this.userLoginFormGroup.markAsDirty();

    this.userLoginFormGroup.valueChanges.pipe(
      debounceTime(1),
      distinctUntilChanged()
    ).subscribe(res => {
      this.error = null;
      this.loginErrorIsInvalidCredentials = false;
      this.clearPasswordLoginError();
      this.user.username = res.username;
      this.user.password = res.password;
      this.user.active = res.active;
    });
  }

  get passwordFieldLabel(): string {
    return this.shouldShowInvalidCredentialsHint()
      ? 'Incorrect username/password'
      : 'Password';
  }

  get passwordFieldPlaceholder(): string {
    return this.shouldShowInvalidCredentialsHint()
      ? 'Incorrect username/password'
      : 'Enter password';
  }

  private clearLoginForm(): void {
    const emptyUser: { username: string | null; password: string | null } = {
      username: null,
      password: null
    };
    this.user = emptyUser;
    this.loginFormDirective?.resetForm(emptyUser);
    this.userLoginFormGroup.reset(emptyUser);
    this.userLoginFormGroup.markAsPristine();
    this.userLoginFormGroup.markAsUntouched();
  }

  private clearPassword(): void {
    this.user.password = null;
    this.userLoginFormGroup.patchValue({ password: null }, { emitEvent: false });
    this.userLoginFormGroup.get('password')?.markAsPristine();
    this.userLoginFormGroup.get('password')?.markAsUntouched();
  }

  onSubmit(event?: SubmitEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.userLoginFormGroup.invalid || this.isLoggingIn) return;

    this.error = null;
    this.loginErrorIsInvalidCredentials = false;
    this.isLoggingIn = true;
    this.userService.postUserLogin(this.userLoginFormGroup.value).pipe(first())
      .subscribe({
        next: (user) => {
          this.isLoggingIn = false;
          this.clearLoginForm();
          const returnUrl = this.route.snapshot.queryParams['returnUrl'];
          if (returnUrl && this.router.url.split('?')[0] === '/ng/login') {
            this.router.navigateByUrl(returnUrl);
          }
          this.closeModal.emit();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoggingIn = false;
          this.error = error.status === 401
            ? 'Username or password is incorrect.'
            : 'Unable to log in right now. Please try again.';
          this.loginErrorIsInvalidCredentials = error.status === 401;
          this.clearPassword();
          if (error.status === 401) {
            const passwordControl = this.userLoginFormGroup.get('password');
            passwordControl?.setErrors({ invalidLogin: true });
            passwordControl?.markAsTouched();
          }
        }
      });
  }

  private shouldShowInvalidCredentialsHint(): boolean {
    const password = this.userLoginFormGroup?.get('password')?.value;
    return this.loginErrorIsInvalidCredentials && !password;
  }

  private clearPasswordLoginError(): void {
    const passwordControl = this.userLoginFormGroup.get('password');
    const errors = passwordControl?.errors;
    if (!errors?.['invalidLogin']) return;

    const { invalidLogin, ...remainingErrors } = errors;
    passwordControl?.setErrors(Object.keys(remainingErrors).length ? remainingErrors : null);
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Prevent event from bubbling up to parent menu which might close it
    if (event.key === 'Tab') {
      event.stopPropagation();
    }
  }

}
