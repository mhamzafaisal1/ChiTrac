import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { UtilitiesService, RebootResponse, MongoUsbBackupResponse, DeleteNodeLogsResponse } from '../services/utilities.service';
import { PercentBreakpoints, SettingsService } from '../services/settings.service';
import { WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { interval, Subject, Subscription, takeUntil } from 'rxjs';

@Component({
  selector: 'app-settings-utilities',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './settings-utilities.component.html',
  styleUrl: './settings-utilities.component.scss'
})
export class SettingsUtilitiesComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private rebootCountdownSubscription: Subscription | null = null;

  isRebootLoading = false;
  isRebootScheduled = false;
  rebootRemainingSeconds = 0;
  rebootExecutesAt: string | null = null;
  isBackupLoading = false;
  isDeleteNodeLogsLoading = false;
  isConfigExportLoading = false;
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
  nodeLogsCutoffDate: Date | null = null;
  includeConfigIds = false;
  lastRebootResponse: RebootResponse | null = null;
  lastBackupResponse: MongoUsbBackupResponse | null = null;
  lastDeleteNodeLogsResponse: DeleteNodeLogsResponse | null = null;
  websocketStatus: WebsocketConnectionStatus = 'disconnected';
  websocketMessage = 'No websocket messages received.';
  websocketError: string | null = null;

  constructor(
    private utilitiesService: UtilitiesService,
    private settingsService: SettingsService,
    private websocketService: WebsocketService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadRebootStatus();

    this.settingsService.getSystemPreferences().subscribe({
      next: (settings) => {
        this.dashboardTimeframe = settings.dashboardTimeframe === 'shift' ? 'shift' : 'current';
        this.percentBreakpoints = settings.percentBreakpoints
          ? { ...settings.percentBreakpoints }
          : { poor: 0, okay: 70, good: 90 };
        this.oePercentBreakpoints = settings.oePercentBreakpoints
          ? { ...settings.oePercentBreakpoints }
          : { poor: 0, okay: 60, good: 80 };
      },
      error: () => {
        this.dashboardTimeframe = 'current';
        this.percentBreakpoints = { poor: 0, okay: 70, good: 90 };
        this.oePercentBreakpoints = { poor: 0, okay: 60, good: 80 };
      }
    });

    this.websocketService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.websocketStatus = status;
      });

    this.websocketService.message$
      .pipe(takeUntil(this.destroy$))
      .subscribe((message) => {
        this.websocketMessage = message;
      });

    this.websocketService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe((error) => {
        this.websocketError = error;
      });
  }

  ngOnDestroy(): void {
    this.stopRebootCountdown();
    this.websocketService.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleWebsocketConnection(): void {
    if (this.websocketStatus === 'connected') {
      this.websocketService.disconnect();
      return;
    }

    this.websocketService.connect();
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

  private normalizeBreakpoints(source: PercentBreakpoints): PercentBreakpoints | null {
    const rawValues = [
      source.poor,
      source.okay,
      source.good
    ];
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
        this.applyRebootStatus(response);

        this.snackBar.open(response.message || 'Reboot request completed.', 'Close', {
          duration: 5000,
          panelClass: [response.success ? 'success-snackbar' : 'warning-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to schedule server reboot';
        this.applyRebootStatus(error.error || { scheduled: false });

        this.lastRebootResponse = {
          success: false,
          available: true,
          platform: error.error?.platform || 'unknown',
          scheduled: this.isRebootScheduled,
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

  cancelReboot(): void {
    this.isRebootLoading = true;
    this.lastRebootResponse = null;

    this.utilitiesService.cancelReboot().subscribe({
      next: (response) => {
        this.lastRebootResponse = response;
        this.isRebootLoading = false;
        this.applyRebootStatus(response);
        this.snackBar.open(response.message || 'Scheduled reboot cancelled.', 'Close', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to cancel scheduled server reboot';
        this.isRebootLoading = false;
        this.applyRebootStatus(error.error || { scheduled: this.isRebootScheduled });
        this.lastRebootResponse = {
          success: false,
          available: true,
          platform: error.error?.platform || 'unknown',
          scheduled: this.isRebootScheduled,
          message
        };
        this.snackBar.open(message, 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  private loadRebootStatus(): void {
    this.utilitiesService.getRebootStatus().subscribe({
      next: (response) => this.applyRebootStatus(response),
      error: () => this.applyRebootStatus({ scheduled: false })
    });
  }

  private applyRebootStatus(response: Partial<RebootResponse>): void {
    this.isRebootScheduled = response.scheduled === true;
    this.rebootExecutesAt = response.executesAt || null;
    this.rebootRemainingSeconds = response.remainingSeconds || 0;

    if (this.isRebootScheduled && this.rebootExecutesAt) {
      this.startRebootCountdown();
    } else {
      this.stopRebootCountdown();
    }
  }

  private startRebootCountdown(): void {
    this.stopRebootCountdown();
    this.updateRebootCountdown();
    this.rebootCountdownSubscription = interval(250)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.updateRebootCountdown());
  }

  private updateRebootCountdown(): void {
    if (!this.rebootExecutesAt) return;
    this.rebootRemainingSeconds = Math.max(
      0,
      Math.ceil((new Date(this.rebootExecutesAt).getTime() - Date.now()) / 1000)
    );

    if (this.rebootRemainingSeconds === 0) {
      this.isRebootScheduled = false;
      this.stopRebootCountdown();
    }
  }

  private stopRebootCountdown(): void {
    this.rebootCountdownSubscription?.unsubscribe();
    this.rebootCountdownSubscription = null;
  }

  downloadConfigExport(): void {
    this.isConfigExportLoading = true;

    this.utilitiesService.exportConfigCollections(this.includeConfigIds).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) {
          this.handleConfigExportError('The server returned an empty configuration export.');
          return;
        }

        const filename = this.getDownloadFilename(
          response.headers.get('Content-Disposition'),
          `chitrac-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        this.isConfigExportLoading = false;
        this.snackBar.open('Configuration export downloaded.', 'Close', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.error || error.error?.message || 'Failed to export configuration collections';
        this.handleConfigExportError(message);
      }
    });
  }

  private getDownloadFilename(contentDisposition: string | null, fallback: string): string {
    const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
    return match?.[1] || fallback;
  }

  private handleConfigExportError(message: string): void {
    this.isConfigExportLoading = false;
    this.snackBar.open(message, 'Close', {
      duration: 7000,
      panelClass: ['error-snackbar']
    });
  }

  deleteOldNodeLogs(): void {
    if (!this.nodeLogsCutoffDate) {
      this.snackBar.open('Choose a log cleanup date first.', 'Close', {
        duration: 5000,
        panelClass: ['warning-snackbar']
      });
      return;
    }

    const cutoffDate = this.toMidnightDateString(this.nodeLogsCutoffDate);
    const confirmed = confirm(`Delete Node.js log files dated ${cutoffDate.substring(0, 10)} or earlier?`);

    if (!confirmed) {
      return;
    }

    this.isDeleteNodeLogsLoading = true;
    this.lastDeleteNodeLogsResponse = null;

    this.utilitiesService.deleteOldNodeLogs(cutoffDate).subscribe({
      next: (response) => {
        this.lastDeleteNodeLogsResponse = response;
        this.isDeleteNodeLogsLoading = false;

        const message = response.message || `Deleted ${response.deletedCount || 0} Node.js log files.`;
        this.snackBar.open(message, 'Close', {
          duration: 7000,
          panelClass: [response.success ? 'success-snackbar' : 'warning-snackbar']
        });
      },
      error: (error) => {
        const message = error.error?.details || error.error?.error || error.error?.message || 'Failed to delete old Node.js logs';

        this.lastDeleteNodeLogsResponse = {
          success: false,
          message
        };
        this.isDeleteNodeLogsLoading = false;

        this.snackBar.open(message, 'Close', {
          duration: 7000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  private toMidnightDateString(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}T00:00:00`;
  }
}
