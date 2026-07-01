import { AfterViewInit, Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  ManagedUser,
  UserManagementService,
  UserRoleOption,
  UserSaveRequest
} from '../services/user-management.service';
import { UserService } from '../user.service';

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

@Component({
  selector: 'app-user-management',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatDialogModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule
  ],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent implements OnInit, AfterViewInit {
  users: ManagedUser[] = [];
  dataSource = new MatTableDataSource<ManagedUser>([]);
  displayedColumns: string[] = ['username', 'email', 'permissionLevel', 'active', 'updatedAt', 'actions'];
  selectedUser: ManagedUser | null = null;
  isSaving = false;
  isSendingReset = false;
  isLoading = false;
  currentPermissionLevel = 3;
  roleOptions: UserRoleOption[] = [];
  private userDialogRef: MatDialogRef<unknown> | null = null;

  userFormGroup = new FormGroup({
    username: new FormControl('', [Validators.required, Validators.minLength(4)]),
    email: new FormControl('', [Validators.pattern(EMAIL_PATTERN)]),
    role: new FormControl('', [Validators.required]),
    active: new FormControl(true),
    password: new FormControl('', [Validators.minLength(6), Validators.maxLength(64)]),
    confirmPassword: new FormControl('')
  });

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild('userDialog') userDialog!: TemplateRef<unknown>;

  constructor(
    private userManagementService: UserManagementService,
    private userService: UserService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.userService.user.subscribe(user => {
      this.currentPermissionLevel = this.userService.getPermissionLevel(user);
    });
    this.userFormGroup.valueChanges.subscribe(() => this.validatePasswordConfirmation());
    this.loadUsers();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadUsers(): void {
    this.isLoading = true;
    this.userManagementService.getUsers().subscribe({
      next: (res) => {
        this.users = res.users;
        this.roleOptions = res.roles || [];
        this.dataSource.data = res.users;
        this.isLoading = false;
      },
      error: (err) => {
        this.isLoading = false;
        this.showError(err, 'Failed to load users');
      }
    });
  }

  newUser(): void {
    this.selectedUser = null;
    this.resetUserForm();
    this.openUserDialog();
  }

  clearUserForm(): void {
    this.resetUserForm();
  }

  closeUserDialog(): void {
    this.userDialogRef?.close();
  }

  private resetUserForm(): void {
    this.configurePasswordValidators(true);
    this.userFormGroup.reset({
      username: '',
      email: '',
      role: this.getRoleForLevel(this.currentPermissionLevel),
      active: true,
      password: '',
      confirmPassword: ''
    });
  }

  editUser(user: ManagedUser): void {
    this.selectedUser = user;
    this.configurePasswordValidators(false);
    this.userFormGroup.reset({
      username: user.username,
      email: user.email || '',
      role: this.getAvailableRoleName(user),
      active: user.active !== false,
      password: '',
      confirmPassword: ''
    });
    this.openUserDialog();
  }

  saveUser(): void {
    if (this.userFormGroup.invalid) {
      this.userFormGroup.markAllAsTouched();
      return;
    }

    const value = this.userFormGroup.value;
    const password = `${value.password || ''}`;
    if (password !== `${value.confirmPassword || ''}`) {
      this.validatePasswordConfirmation();
      this.userFormGroup.get('confirmPassword')?.markAsTouched();
      return;
    }

    const payload: UserSaveRequest = {
      username: `${value.username || ''}`.trim(),
      email: `${value.email || ''}`.trim(),
      role: `${value.role || ''}`.trim(),
      active: value.active !== false
    };

    if (password) {
      payload.password = password;
      payload.confirmPassword = `${value.confirmPassword || ''}`;
    }

    if (!this.selectedUser && !payload.password) {
      this.userFormGroup.get('password')?.setErrors({ required: true });
      this.userFormGroup.get('password')?.markAsTouched();
      return;
    }

    this.isSaving = true;
    const request$ = this.selectedUser
      ? this.userManagementService.updateUser(this.selectedUser._id, payload)
      : this.userManagementService.createUser(payload);

    request$.subscribe({
      next: (res) => {
        this.isSaving = false;
        this.applySavedUser(res.user);
        this.editUser(res.user);
        this.closeUserDialog();
        this.snackBar.open('User saved', 'Close', { duration: 3000 });
      },
      error: (err) => {
        this.isSaving = false;
        this.showError(err, 'Failed to save user');
      }
    });
  }

  sendPasswordReset(): void {
    const user = this.selectedUser;
    if (!user || !user.email || this.isSendingReset) return;
    if (!confirm(`Email a password reset link to ${user.email}?`)) return;

    this.isSendingReset = true;
    this.userManagementService.sendPasswordReset(user._id).subscribe({
      next: () => {
        this.isSendingReset = false;
        this.snackBar.open(`Password reset email sent to ${user.email}`, 'Close', { duration: 4000 });
      },
      error: (err) => {
        this.isSendingReset = false;
        this.showError(err, 'Failed to send password reset email');
      }
    });
  }

  deleteUser(user: ManagedUser): void {
    if (!confirm(`Delete ${user.username}?`)) return;

    this.userManagementService.deleteUser(user._id).subscribe({
      next: () => {
        this.snackBar.open('User deleted', 'Close', { duration: 3000 });
        this.loadUsers();
        if (this.selectedUser?._id === user._id) {
          this.selectedUser = null;
          this.closeUserDialog();
        }
      },
      error: (err) => this.showError(err, 'Failed to delete user')
    });
  }

  formatDate(date: Date | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  }

  get availableRoleOptions(): UserRoleOption[] {
    return this.roleOptions.filter(option => option.level >= this.currentPermissionLevel);
  }

  private getRoleForLevel(level: number): string {
    return this.availableRoleOptions.find(option => option.level === level)?.name
      || this.availableRoleOptions[0]?.name
      || '';
  }

  private getAvailableRoleName(user: ManagedUser): string {
    const byName = this.availableRoleOptions.find(
      option => option.name.toLowerCase() === `${user.role || ''}`.toLowerCase()
    );
    return byName?.name || this.getRoleForLevel(user.permissions?.level ?? this.currentPermissionLevel);
  }

  private configurePasswordValidators(required: boolean): void {
    const password = this.userFormGroup.get('password');
    const confirmation = this.userFormGroup.get('confirmPassword');
    password?.setValidators([
      ...(required ? [Validators.required] : []),
      Validators.minLength(6),
      Validators.maxLength(64)
    ]);
    confirmation?.setValidators(required ? [Validators.required] : []);
    password?.updateValueAndValidity({ emitEvent: false });
    confirmation?.updateValueAndValidity({ emitEvent: false });
  }

  private validatePasswordConfirmation(): void {
    const password = this.userFormGroup.get('password');
    const confirmation = this.userFormGroup.get('confirmPassword');
    if (!password || !confirmation) return;

    const errors = { ...(confirmation.errors || {}) };
    if (`${password.value || ''}` !== `${confirmation.value || ''}`) {
      errors['passwordMismatch'] = true;
    } else {
      delete errors['passwordMismatch'];
    }
    confirmation.setErrors(Object.keys(errors).length ? errors : null, { emitEvent: false });
  }

  private applySavedUser(user: ManagedUser): void {
    const index = this.users.findIndex(x => x._id === user._id);
    this.users = index >= 0
      ? [...this.users.slice(0, index), user, ...this.users.slice(index + 1)]
      : [...this.users, user];
    this.dataSource.data = this.users;
  }

  private openUserDialog(): void {
    if (this.userDialogRef) {
      return;
    }

    this.userDialogRef = this.dialog.open(this.userDialog, {
      width: '460px',
      maxWidth: 'calc(100vw - 32px)',
      disableClose: this.isSaving || this.isSendingReset,
      autoFocus: 'first-tabbable'
    });

    this.userDialogRef.afterClosed().subscribe(() => {
      this.userDialogRef = null;
    });
  }

  private showError(err: any, fallback: string): void {
    const message = err?.error?.error || err?.error?.message || err?.message || fallback;
    this.snackBar.open(message, 'Close', { duration: 5000 });
  }
}
