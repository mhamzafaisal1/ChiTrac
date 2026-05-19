import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { UtilitiesService, RebootResponse, MongoUsbBackupResponse } from '../services/utilities.service';

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
  isRebootLoading = false;
  isBackupLoading = false;
  lastRebootResponse: RebootResponse | null = null;
  lastBackupResponse: MongoUsbBackupResponse | null = null;

  constructor(
    private utilitiesService: UtilitiesService,
    private snackBar: MatSnackBar
  ) {}

  scheduleReboot(): void {
    const confirmed = confirm('Schedule a server reboot 30 seconds from now?');

    if (!confirmed) {
      return;
    }

    this.isRebootLoading = true;
    this.lastRebootResponse = null;

    this.utilitiesService.rebootServer().subscribe({
      next: (response) => {
        this.lastRebootResponse = response;
        this.isRebootLoading = false;

        this.snackBar.open(response.message || 'Reboot request completed.', 'Close', {
          duration: 5000,
          panelClass: [response.success ? 'success-snackbar' : 'warning-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to schedule server reboot';

        this.lastRebootResponse = {
          success: false,
          available: true,
          platform: 'unknown',
          message
        };
        this.isRebootLoading = false;

        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  backupMongoDbToUsb(): void {
    const confirmed = confirm('Back up the ChiTrac database to the mounted USB drive?');

    if (!confirmed) {
      return;
    }

    this.isBackupLoading = true;
    this.lastBackupResponse = null;

    this.utilitiesService.backupMongoDbToUsb().subscribe({
      next: (response) => {
        this.lastBackupResponse = response;
        this.isBackupLoading = false;

        const message = response.success
          ? `Backup completed: ${response.backupPath || 'USB drive'}`
          : response.message || response.error || 'Backup request completed.';

        this.snackBar.open(message, 'Close', {
          duration: 7000,
          panelClass: [response.success ? 'success-snackbar' : 'warning-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.details || error.error?.error || error.error?.message || 'Failed to back up MongoDB to USB';

        this.lastBackupResponse = {
          success: false,
          message
        };
        this.isBackupLoading = false;

        this.snackBar.open(message, 'Close', {
          duration: 7000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
