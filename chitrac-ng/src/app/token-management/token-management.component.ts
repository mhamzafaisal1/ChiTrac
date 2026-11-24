import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { SettingsService } from '../services/settings.service';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

// Material Imports
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
import { BaseTableColumnOptions, BaseTableComponent } from '../components/base-table/base-table.component';
import { PageLoadStateComponent } from '../components/page-load-state/page-load-state.component';

// rxjs Imports
import { EMPTY, Subscription, timer } from 'rxjs';
import { catchError, switchMap, share } from 'rxjs/operators';

// Service Imports
import { TokenManagementService, PermanentToken, ApiControllerOption, TokenListResponse } from '../services/token-management.service';

@Component({
  selector: 'app-token-management',
  standalone: true,
  imports: [
    PageLoadStateComponent,
    BaseTableComponent,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
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
  
  sub: Subscription;
  createTokenFormGroup: FormGroup;
  generatedToken: string | null = null;
  showTokenDialog: boolean = false;
  private tokenLoadErrorShown = false;
  isLoading = true;
  loadError: string | null = null;

  readonly displayedColumns = ['Name', 'Description', 'Created', 'Last Used', 'Usage Count', 'Actions'];
  readonly deactivatedDisplayedColumns = ['Name', 'Description', 'Created', 'Deactivated', 'Last Used', 'Usage Count'];
  readonly pageSizes = [5, 10, 25, 50];
  readonly rowIdentity = (token: PermanentToken) => token.id;
  readonly columnOptions: Record<string, BaseTableColumnOptions<PermanentToken>> = {
    Name: { field: 'name' },
    Description: { valueGetter: ({ data }) => data?.description || '-', sortable: false, minWidth: 160 },
    Created: this.dateColumn(token => token.timestamps?.create),
    Deactivated: this.dateColumn(token => token.timestamps?.inactive),
    'Last Used': this.dateColumn(token => token.lastUsed),
    'Usage Count': { field: 'usageCount' },
    Actions: { sortable: false, minWidth: 136 },
  };
  readonly getCellTooltip = (token: PermanentToken, column: string) =>
    column === 'Description' ? token.description || '' : '';


  constructor(
    private tokenService: TokenManagementService,
    private snackBar: MatSnackBar,
    private clipboard: Clipboard
  ) {}

  private getTokensSubFunction = (res: TokenListResponse) => {
    this.isLoading = false;
    this.loadError = null;
    this.controllers = res.controllers || [];
    this.tokenLoadErrorShown = false;
    this.tokens = res.tokens;
    this.deactivatedTokens = res.deactivatedTokens || [];
  }

  private handleTokenLoadError = () => {
    this.isLoading = false;
    this.loadError = 'Failed to load API tokens. Please try again.';
    if (!this.tokenLoadErrorShown) {
      this.snackBar.open('Failed to load API tokens', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      this.tokenLoadErrorShown = true;
    }
    return EMPTY;
  };

  private dateColumn(getDate: (token: PermanentToken) => Date | null | undefined): BaseTableColumnOptions<PermanentToken> {
    const displayDate = (value: number | null) => this.formatDate(value == null ? null : new Date(value));
    return {
      valueGetter: ({ data }) => {
        const date = data && getDate(data);
        return date ? new Date(date).getTime() : null;
      },
      valueFormatter: ({ value }) => displayDate(value),
      getQuickFilterText: ({ value }) => displayDate(value),
      minWidth: 200,
    };
  }

  ngOnInit() {
    this.createTokenFormGroup = new FormGroup({
      name: new FormControl('', [Validators.required, Validators.minLength(3)]),
      description: new FormControl('', [Validators.maxLength(200)])
    });

    // The route guard has already resolved authentication; fetch immediately.
    this.sub = timer(0, 30 * 1000)
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
    this.isLoading = true;
    this.loadError = null;
    // Make a one-off request instead of recreating the timer
    this.tokenService.getTokens().pipe(
      catchError(this.handleTokenLoadError)
    ).subscribe(this.getTokensSubFunction);
  }

  retryLoad(): void { this.refreshTable(); }

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

