import { Component, inject, model, OnInit, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

/*** rxjs Imports */
import { Subscription, timer } from 'rxjs';
import { startWith, switchMap, share, retry, debounceTime, distinctUntilChanged, first } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/*** Service Imports */
import { UserService } from '../user.service';

@Component({
    selector: 'app-user-register',
    imports: [CommonModule,
        MatFormFieldModule,
        MatInputModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule],
    templateUrl: './user-register.component.html',
    styleUrl: './user-register.component.scss'
})
export class UserRegisterComponent {

  sub: Subscription;

  userRegistrationFormGroup: FormGroup;

  user: any = {
    username: null,
    password: null,
    permissionLevel: 3
  };
  error: any = null;
  currentPermissionLevel = 3;

  subscribeToUser(): void {
    if (this.sub) {
      this.sub.unsubscribe();
    }
    this.sub = this.userService.user.subscribe(x => this.user = x);
  }

  constructor(private userService: UserService, private route: ActivatedRoute, private router: Router) {

  }

  onSubmit(user: any): void {
    if (!this.userRegistrationFormGroup?.valid) {
      this.userRegistrationFormGroup?.markAllAsTouched();
      return;
    }
    const permissionLevel = Number(this.userRegistrationFormGroup.get('permissionLevel')?.value ?? this.currentPermissionLevel);
    if (permissionLevel < this.currentPermissionLevel) {
      this.userRegistrationFormGroup.get('permissionLevel')?.setErrors({ min: true });
      this.userRegistrationFormGroup.get('permissionLevel')?.markAsTouched();
      return;
    }

    this.userService.postUserRegister(user).pipe(first())
      .subscribe({
        next: (resp: any) => {
          const message = resp?.message || 'User created successfully.';
          alert(message);
          const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/ng/settings/root/users/register';
          this.router.navigateByUrl(returnUrl);
        },
        error: (err: any) => {
          const message = err?.error?.message || err?.message || 'Failed to create user.';
          alert(message);
          this.error = message;
        }
      });
  }


  ngOnInit() {
    this.currentPermissionLevel = this.userService.getPermissionLevel();
    this.user.permissionLevel = this.currentPermissionLevel;

    this.userRegistrationFormGroup = new FormGroup({
      username: new FormControl(this.user.username, [Validators.required, Validators.minLength(4)]),
      password: new FormControl(this.user.password, [Validators.required, Validators.minLength(6)]),
      permissionLevel: new FormControl(this.user.permissionLevel, [Validators.required, Validators.min(this.currentPermissionLevel)]),
    });

    if (this.error) this.userRegistrationFormGroup.markAsDirty();

    this.userService.user.subscribe(currentUser => {
      this.currentPermissionLevel = this.userService.getPermissionLevel(currentUser);
      this.applyPermissionLevelValidator();
    });

    this.userRegistrationFormGroup.valueChanges.pipe(
      debounceTime(1),
      distinctUntilChanged()
    ).subscribe(res => {
      this.user.username = res.username;
      this.user.password = res.password;
      this.user.permissionLevel = Number(res.permissionLevel ?? this.currentPermissionLevel);
    });
  };

  private applyPermissionLevelValidator(): void {
    const control = this.userRegistrationFormGroup?.get('permissionLevel');
    if (!control) return;

    control.setValidators([
      Validators.required,
      Validators.min(this.currentPermissionLevel)
    ]);

    if (Number(control.value) < this.currentPermissionLevel) {
      control.setValue(this.currentPermissionLevel);
    }

    control.updateValueAndValidity({ emitEvent: false });
  }


}
