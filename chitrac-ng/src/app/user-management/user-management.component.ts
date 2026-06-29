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

import { ManagedUser, UserManagementService, UserSaveRequest } from '../services/user-management.service';
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
  private userDialogRef: MatDialogRef<unknown> | null = null;

  userFormGroup = new FormGroup({
    username: new FormControl('', [Validators.required, Validators.minLength(4)]),
    email: new FormControl('', [Validators.pattern(EMAIL_PATTERN)]),
    role: new FormControl('user', [Validators.required]),
    permissionLevel: new FormControl(3, [Validators.required, Validators.min(0)]),
    groups: new FormControl(''),
    restrictions: new FormControl(''),
    active: new FormControl(true),
    password: new FormControl('', [Validators.minLength(6), Validators.maxLength(64)])
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
      this.applyPermissionLevelValidator();
    });
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
    this.userFormGroup.reset({
      username: '',
      email: '',
      role: 'user',
      permissionLevel: this.currentPermissionLevel,
      groups: '',
      restrictions: '',
      active: true,
      password: ''
    });
  }

  editUser(user: ManagedUser): void {
    this.selectedUser = user;
    this.userFormGroup.reset({
      username: user.username,
      email: user.email || '',
      role: user.role || 'user',
      permissionLevel: user.permissions?.level ?? 3,
      groups: (user.groups || []).join(', '),
      restrictions: (user.restrictions || []).join(', '),
      active: user.active !== false,
      password: ''
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
    const permissionLevel = Number(value.permissionLevel ?? this.currentPermissionLevel);

    if (permissionLevel < this.currentPermissionLevel) {
      this.userFormGroup.get('permissionLevel')?.setErrors({ min: true });
      this.userFormGroup.get('permissionLevel')?.markAsTouched();
      return;
    }

    const payload: UserSaveRequest = {
      username: `${value.username || ''}`.trim(),
      email: `${value.email || ''}`.trim(),
      role: `${value.role || 'user'}`.trim(),
      permissions: {
        level: permissionLevel
      },
      groups: this.parseList(value.groups),
      restrictions: this.parseList(value.restrictions),
      active: value.active !== false
    };

    if (!this.selectedUser && password) {
      payload.password = password;
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

  private parseList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(x => `${x}`.trim()).filter(Boolean);
    return `${value || ''}`.split(',').map(x => x.trim()).filter(Boolean);
  }

  private applyPermissionLevelValidator(): void {
    const control = this.userFormGroup.get('permissionLevel');
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
