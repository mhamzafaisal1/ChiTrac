import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs/operators';
import { SystemPreferences, SystemPreferencesService } from '../services/system-preferences.service';
import { PercentBreakpoints, SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-system-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  templateUrl: './system-settings.component.html',
  styleUrl: './system-settings.component.scss'
})
export class SystemSettingsComponent implements OnInit {
  preferences: SystemPreferences | null = null;
  isLoading = false;
  isSaving = false;
  isResetting = false;
  isSavingDashboardTimeframe = false;
  isSavingPercentBreakpoints = false;
  isSavingOePercentBreakpoints = false;
  dashboardTimeframe: 'current' | 'shift' = 'current';
  percentBreakpoints: PercentBreakpoints = {
    poor: 0,
    okay: 70,
    good: 90
  };
  oePercentBreakpoints: PercentBreakpoints = {
    poor: 0,
    okay: 60,
    good: 80
  };

  settingsForm = new FormGroup({
    userSessionExpirationHours: new FormControl<number>(48, [
      Validators.required,
      Validators.min(1)
    ])
  });

  constructor(
    private systemPreferencesService: SystemPreferencesService,
    private settingsService: SettingsService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadPreferences();
  }

  saveDashboardTimeframe(): void {
    this.isSavingDashboardTimeframe = true;

    this.settingsService.saveDashboardTimeframe(this.dashboardTimeframe).subscribe({
      next: () => {
        this.isSavingDashboardTimeframe = false;
        this.settingsService.loadSettings().subscribe();
        this.snackBar.open('Dashboard default timeframe saved.', 'Close', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to save dashboard default timeframe';
        this.isSavingDashboardTimeframe = false;
        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  savePercentBreakpoints(): void {
    const breakpoints = this.normalizeBreakpoints(this.percentBreakpoints);
    if (!breakpoints) return;

    this.isSavingPercentBreakpoints = true;

    this.settingsService.savePercentBreakpoints(breakpoints).subscribe({
      next: () => {
        this.isSavingPercentBreakpoints = false;
        this.settingsService.loadSettings().subscribe();
        this.snackBar.open('Percent breakpoints saved.', 'Close', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to save percent breakpoints';
        this.isSavingPercentBreakpoints = false;
        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  saveOePercentBreakpoints(): void {
    const breakpoints = this.normalizeBreakpoints(this.oePercentBreakpoints);
    if (!breakpoints) return;

    this.isSavingOePercentBreakpoints = true;

    this.settingsService.saveOePercentBreakpoints(breakpoints).subscribe({
      next: () => {
        this.isSavingOePercentBreakpoints = false;
        this.settingsService.loadSettings().subscribe();
        this.snackBar.open('OE percent breakpoints saved.', 'Close', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to save OE percent breakpoints';
        this.isSavingOePercentBreakpoints = false;
        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  loadPreferences(): void {
    this.isLoading = true;

    this.systemPreferencesService.getPreferences()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (preferences) => this.applyPreferences(preferences),
        error: (error) => this.showError(error, 'Failed to load system settings')
      });
  }

  saveSettings(): void {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      return;
    }

    const userSessionExpirationHours = Number(this.settingsForm.value.userSessionExpirationHours);

    this.isSaving = true;
    this.systemPreferencesService.updatePreferences({ userSessionExpirationHours })
      .pipe(finalize(() => this.isSaving = false))
      .subscribe({
        next: (preferences) => {
          this.applyPreferences(preferences);
          this.snackBar.open('System settings saved', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar']
          });
        },
        error: (error) => this.showError(error, 'Failed to save system settings')
      });
  }

  resetSettings(): void {
    const confirmed = confirm('Reset system settings to their configured defaults?');
    if (!confirmed) {
      return;
    }

    this.isResetting = true;
    this.systemPreferencesService.resetPreferences()
      .pipe(finalize(() => this.isResetting = false))
      .subscribe({
        next: (preferences) => {
          this.applyPreferences(preferences);
          this.snackBar.open('System settings reset', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar']
          });
        },
        error: (error) => this.showError(error, 'Failed to reset system settings')
      });
  }

  get expirationControl(): FormControl<number> {
    return this.settingsForm.controls.userSessionExpirationHours;
  }

  private applyPreferences(preferences: SystemPreferences): void {
    this.preferences = preferences;
    this.dashboardTimeframe = preferences.dashboardTimeframe === 'shift' ? 'shift' : 'current';
    this.percentBreakpoints = preferences.percentBreakpoints
      ? { ...preferences.percentBreakpoints }
      : { poor: 0, okay: 70, good: 90 };
    this.oePercentBreakpoints = preferences.oePercentBreakpoints
      ? { ...preferences.oePercentBreakpoints }
      : { poor: 0, okay: 60, good: 80 };
    this.settingsForm.patchValue({
      userSessionExpirationHours: Number(preferences.userSessionExpirationHours) || 48
    });
    this.settingsForm.markAsPristine();
  }

  private normalizeBreakpoints(source: PercentBreakpoints): PercentBreakpoints | null {
    const rawValues = [source.poor, source.okay, source.good];
    const poor = Number(source.poor);
    const okay = Number(source.okay);
    const good = Number(source.good);

    if (rawValues.some((value) => value === null || value === undefined || `${value}`.trim() === '') || ![poor, okay, good].every(Number.isFinite)) {
      this.snackBar.open('Enter valid percentage breakpoints.', 'Close', {
        duration: 5000,
        panelClass: ['warning-snackbar']
      });
      return null;
    }

    if (!(good > okay && okay > poor)) {
      this.snackBar.open('Percent breakpoints must satisfy Good > Okay > Poor.', 'Close', {
        duration: 5000,
        panelClass: ['warning-snackbar']
      });
      return null;
    }

    return { poor, okay, good };
  }

  private showError(error: any, fallbackMessage: string): void {
    const message = error?.error?.error || error?.error?.message || fallbackMessage;
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }
}
