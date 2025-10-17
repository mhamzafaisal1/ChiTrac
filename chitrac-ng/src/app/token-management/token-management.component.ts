import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

// Material Imports
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';

// rxjs Imports
import { Subscription, timer } from 'rxjs';
import { startWith, switchMap, share, retry } from 'rxjs/operators';

// Service Imports
import { TokenManagementService, PermanentToken } from '../services/token-management.service';

@Component({
  selector: 'app-token-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatDividerModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatSnackBarModule,
    MatDialogModule,
    ClipboardModule
  ],
  templateUrl: './token-management.component.html',
  styleUrl: './token-management.component.scss'
})
export class TokenManagementComponent implements OnInit, OnDestroy {
  tokens: PermanentToken[] = [];
  dataSource: MatTableDataSource<PermanentToken>;
  
  sub: Subscription;
  createTokenFormGroup: FormGroup;
  generatedToken: string | null = null;
  showTokenDialog: boolean = false;

  displayedColumns: string[] = ['name', 'description', 'createdAt', 'lastUsed', 'usageCount', 'actions'];

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(
    private tokenService: TokenManagementService,
    private snackBar: MatSnackBar,
    private clipboard: Clipboard
  ) {
    this.dataSource = new MatTableDataSource<PermanentToken>([]);
  }

  private getTokensSubFunction = (res: { tokens: PermanentToken[] }) => {
    this.tokens = res.tokens;
    if (!this.dataSource) {
      this.dataSource = new MatTableDataSource<PermanentToken>(res.tokens);
    } else {
      this.dataSource.data = res.tokens;
    }
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  ngOnInit() {
    this.createTokenFormGroup = new FormGroup({
      name: new FormControl('', [Validators.required, Validators.minLength(3)]),
      description: new FormControl('', [Validators.maxLength(200)])
    });

    // Start polling after component initialization and auth is ready
    setTimeout(() => {
      this.sub = timer(0, 30 * 1000)
        .pipe(
          switchMap(() => this.tokenService.getTokens()),
          share()
        )
        .subscribe(this.getTokensSubFunction);
    }, 1000);
  }

  onCreateToken() {
    if (this.createTokenFormGroup.valid) {
      const { name, description } = this.createTokenFormGroup.value;
      
      this.tokenService.createPermanentToken(name, description || '').subscribe({
        next: (response) => {
          this.generatedToken = response.token;
          this.showTokenDialog = true;
          
          // Copy token to clipboard automatically
          this.clipboard.copy(response.token);
          
          this.snackBar.open('Token created successfully! Token copied to clipboard.', 'Close', {
            duration: 5000,
            panelClass: ['success-snackbar']
          });

          // Reset form
          this.createTokenFormGroup.reset();
          
          // Refresh table
          this.refreshTable();
        },
        error: (err) => {
          const errorMessage = err.error?.error || 'Failed to create token';
          this.snackBar.open(errorMessage, 'Close', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
    }
  }

  copyToken(token: string) {
    this.clipboard.copy(token);
    this.snackBar.open('Token copied to clipboard!', 'Close', {
      duration: 3000
    });
  }

  closeTokenDialog() {
    this.showTokenDialog = false;
    this.generatedToken = null;
  }

  deleteToken(token: PermanentToken) {
    if (confirm(`Are you sure you want to deactivate the token "${token.name}"?`)) {
      this.tokenService.deleteToken(token.id).subscribe({
        next: (response) => {
          this.snackBar.open('Token deactivated successfully', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar']
          });
          this.refreshTable();
        },
        error: (err) => {
          const errorMessage = err.error?.error || 'Failed to deactivate token';
          this.snackBar.open(errorMessage, 'Close', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
    }
  }

  private refreshTable() {
    // Make a one-off request instead of recreating the timer
    this.tokenService.getTokens().subscribe(this.getTokensSubFunction);
  }

  formatDate(date: Date | null): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

