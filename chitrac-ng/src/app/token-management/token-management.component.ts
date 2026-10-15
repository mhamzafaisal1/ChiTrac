import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { SettingsService } from '../services/settings.service';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { SummaryCardVisibilityDialogComponent, SummaryCardVisibilityDialogResult } from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';

// rxjs Imports
import { EMPTY, Subscription, timer } from 'rxjs';
import { catchError, switchMap, share } from 'rxjs/operators';

// Service Imports
import { TokenManagementService, PermanentToken, ApiControllerOption, TokenListResponse } from '../services/token-management.service';

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
    MatTooltipModule,
    ClipboardModule
  ],
  templateUrl: './token-management.component.html',
  styleUrl: './token-management.component.scss'
})
export class TokenManagementComponent implements OnInit, OnDestroy {
  private readonly settings = inject(SettingsService);
  private readonly dialog = inject(MatDialog);
  controllers: ApiControllerOption[] = [];
  tokens: PermanentToken[] = [];
  deactivatedTokens: PermanentToken[] = [];
  dataSource: MatTableDataSource<PermanentToken>;
  deactivatedDataSource: MatTableDataSource<PermanentToken>;
  
  sub: Subscription;
  createTokenFormGroup: FormGroup;
  generatedToken: string | null = null;
  showTokenDialog: boolean = false;
  private tokenLoadErrorShown = false;

  displayedColumns: string[] = ['name', 'description', 'created', 'lastUsed', 'usageCount', 'actions'];
  deactivatedDisplayedColumns: string[] = ['name', 'description', 'created', 'deactivated', 'lastUsed', 'usageCount'];

  @ViewChild('activePaginator') activePaginator!: MatPaginator;
  @ViewChild('activeSort') activeSort!: MatSort;
  @ViewChild('deactivatedPaginator') deactivatedPaginator!: MatPaginator;
  @ViewChild('deactivatedSort') deactivatedSort!: MatSort;

  constructor(
    private tokenService: TokenManagementService,
    private snackBar: MatSnackBar,
    private clipboard: Clipboard
  ) {
    this.dataSource = new MatTableDataSource<PermanentToken>([]);
    this.deactivatedDataSource = new MatTableDataSource<PermanentToken>([]);
  }

  private getTokensSubFunction = (res: TokenListResponse) => {
    this.controllers = res.controllers || [];
    this.tokenLoadErrorShown = false;
    this.tokens = res.tokens;
    this.deactivatedTokens = res.deactivatedTokens || [];
    this.dataSource.data = this.tokens;
    this.deactivatedDataSource.data = this.deactivatedTokens;
    this.configureDataSources();
  }

  private handleTokenLoadError = () => {
    if (!this.tokenLoadErrorShown) {
      this.snackBar.open('Failed to load API tokens', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      this.tokenLoadErrorShown = true;
    }
    return EMPTY;
  };

  private configureDataSources(): void {
    this.dataSource.sortingDataAccessor = this.tokenSortingDataAccessor;
    this.deactivatedDataSource.sortingDataAccessor = this.tokenSortingDataAccessor;

    if (this.activePaginator) this.dataSource.paginator = this.activePaginator;
    if (this.activeSort) this.dataSource.sort = this.activeSort;
    if (this.deactivatedPaginator) this.deactivatedDataSource.paginator = this.deactivatedPaginator;
    if (this.deactivatedSort) this.deactivatedDataSource.sort = this.deactivatedSort;
  }

  private tokenSortingDataAccessor = (token: PermanentToken, property: string): string | number => {
    if (property === 'created') {
      return token.timestamps?.create ? new Date(token.timestamps.create).getTime() : 0;
    }
    if (property === 'deactivated') {
      return token.timestamps?.inactive ? new Date(token.timestamps.inactive).getTime() : 0;
    }
    if (property === 'lastUsed') {
      return token.lastUsed ? new Date(token.lastUsed).getTime() : 0;
    }
    return (token as any)[property] ?? '';
  };

  ngOnInit() {
    this.createTokenFormGroup = new FormGroup({
      name: new FormControl('', [Validators.required, Validators.minLength(3)]),
      description: new FormControl('', [Validators.maxLength(200)])
    });

    // Start polling after component initialization and auth is ready
    this.sub = timer(1000, 30 * 1000)
      .pipe(
        switchMap(() => this.tokenService.getTokens().pipe(
          catchError(this.handleTokenLoadError)
        )),
        share()
      )
      .subscribe(this.getTokensSubFunction);
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

  editControllerAccess(token: PermanentToken): void {
    if (!token.isActive || !this.controllers.length) return;
    const controllers = [...this.controllers];
    const ref = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '760px', maxWidth: '96vw',
      data: {
        title: `Controller Access: ${token.name}`,
        description: '',
        cards: controllers,
        visibility: Object.fromEntries(controllers.map(controller =>
          [controller.id, (token.allowedControllers || []).includes(controller.id)])),
        showLabel: 'Allowed', hideLabel: 'Not Allowed',
        emptyShownText: 'No controllers allowed', emptyHiddenText: 'All controllers allowed',
        compactCards: true, applyLabel: 'Save',
        save: (result: SummaryCardVisibilityDialogResult) => this.tokenService.updateControllerAccess(
          token.id, controllers.filter(controller => result.visibility[controller.id] === true).map(controller => controller.id)
        )
      }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.snackBar.open('Controller access updated', 'Close', { duration: 3000 });
      this.refreshTable();
    });
  }

  private refreshTable() {
    // Make a one-off request instead of recreating the timer
    this.tokenService.getTokens().pipe(
      catchError(this.handleTokenLoadError)
    ).subscribe(this.getTokensSubFunction);
  }

  formatDate(date: Date | null): string {
    if (!date) return 'Never';
    return this.settings.formatTime(date, { year: 'numeric', month: 'short', day: 'numeric', second: '2-digit' });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

