import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs/operators';
import { SystemPreferences, SystemPreferencesService } from '../services/system-preferences.service';

@Component({
  selector: 'app-system-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
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

  settingsForm = new FormGroup({
    userSessionExpirationHours: new FormControl<number>(48, [
      Validators.required,
      Validators.min(1)
    ])
  });

  constructor(
    private systemPreferencesService: SystemPreferencesService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadPreferences();
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
    this.settingsForm.patchValue({
      userSessionExpirationHours: Number(preferences.userSessionExpirationHours) || 48
    });
    this.settingsForm.markAsPristine();
  }

  private showError(error: any, fallbackMessage: string): void {
    const message = error?.error?.error || error?.error?.message || fallbackMessage;
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }
}
