import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { UtilitiesService, RebootResponse } from '../services/utilities.service';

@Component({
  selector: 'app-settings-utilities',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './settings-utilities.component.html',
  styleUrl: './settings-utilities.component.scss'
})
export class SettingsUtilitiesComponent {
  isLoading = false;
  lastResponse: RebootResponse | null = null;

  constructor(
    private utilitiesService: UtilitiesService,
    private snackBar: MatSnackBar
  ) {}

  scheduleReboot(): void {
    const confirmed = confirm('Schedule a server reboot 30 seconds from now?');

    if (!confirmed) {
      return;
    }

    this.isLoading = true;
    this.lastResponse = null;

    this.utilitiesService.rebootServer().subscribe({
      next: (response) => {
        this.lastResponse = response;
        this.isLoading = false;

        this.snackBar.open(response.message || 'Reboot request completed.', 'Close', {
          duration: 5000,
          panelClass: [response.success ? 'success-snackbar' : 'warning-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to schedule server reboot';

        this.lastResponse = {
          success: false,
          available: true,
          platform: 'unknown',
          message
        };
        this.isLoading = false;

        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
