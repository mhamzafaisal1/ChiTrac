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
    password: null
  };
  error: any = null;

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
    this.userRegistrationFormGroup = new FormGroup({
      username: new FormControl(this.user.username, [Validators.required, Validators.minLength(4)]),
      password: new FormControl(this.user.password, [Validators.required, Validators.minLength(6)]),
    });

    if (this.error) this.userRegistrationFormGroup.markAsDirty();

    this.userRegistrationFormGroup.valueChanges.pipe(
      debounceTime(1),
      distinctUntilChanged()
    ).subscribe(res => {
      this.user.username = res.username;
      this.user.password = res.password;
    });
  };


}
