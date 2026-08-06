import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReportsService, ReportSubscriptionDto, ReportSubscriptionPayload } from '../../services/reports.service';
import { ReportSubscriptionCuComponent, ReportSubscriptionFormValue } from './report-subscription-cu.component';
import { ReportSubscriptionDeleteConfirmComponent } from './report-subscription-delete-confirm.component';

@Component({
  selector: 'app-report-subscription',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './report-subscription.component.html',
  styleUrl: './report-subscription.component.scss',
})
export class ReportSubscriptionComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  displayedColumns = ['report', 'name', 'type', 'enabled', 'emailTo', 'schedule', 'lastAttempt', 'lastResult'];
  dataSource = new MatTableDataSource<ReportSubscriptionDto>([]);
  isLoading = false;
  selectedSubscription: ReportSubscriptionDto | null = null;

  constructor(private reportsService: ReportsService) {}

  ngOnInit(): void {
    this.loadSubscriptions();
  }

  get hasSubscriptions(): boolean {
    return this.dataSource.data.length > 0;
  }

  loadSubscriptions(): void {
    this.isLoading = true;
    this.reportsService.listReportSubscriptions().subscribe({
      next: (rows) => {
        this.dataSource.data = rows ?? [];
        if (this.selectedSubscription?._id) {
          this.selectedSubscription =
            this.dataSource.data.find((x) => x._id === this.selectedSubscription?._id) ?? null;
        }
        this.isLoading = false;
      },
      error: (error) => {
        this.isLoading = false;
        this.snackBar.open(error?.error?.error || 'Failed to load report subscriptions.', 'Close', {
          duration: 4000,
        });
      },
    });
  }

  openCreateDialog(): void {
    const dialogRef = this.dialog.open(ReportSubscriptionCuComponent, {
      data: null,
      disableClose: true,
      width: '860px',
      maxWidth: '94vw',
      maxHeight: '90vh',
    });

    dialogRef.afterClosed().subscribe((formValue: ReportSubscriptionFormValue | null) => {
      if (!formValue) return;
      const payload = this.toPayload(formValue);
      this.reportsService.createReportSubscription(payload).subscribe({
        next: () => {
          this.snackBar.open('Report subscription created.', 'Close', { duration: 2500 });
          this.loadSubscriptions();
        },
        error: (error) => {
          this.snackBar.open(error?.error?.error || 'Failed to create report subscription.', 'Close', {
            duration: 4000,
          });
        },
      });
    });
  }

  openEditDialog(subscription?: ReportSubscriptionDto): void {
    const target = subscription ?? this.selectedSubscription;
    if (!target) return;

    const dialogRef = this.dialog.open(ReportSubscriptionCuComponent, {
      data: target,
      disableClose: true,
      width: '860px',
      maxWidth: '94vw',
      maxHeight: '90vh',
    });

    dialogRef.afterClosed().subscribe((formValue: ReportSubscriptionFormValue | null) => {
      if (!formValue || !target._id) return;
      const payload = this.toPayload(formValue);
      this.reportsService.updateReportSubscription(target._id, payload).subscribe({
        next: () => {
          this.snackBar.open('Report subscription updated.', 'Close', { duration: 2500 });
          this.loadSubscriptions();
        },
        error: (error) => {
          this.snackBar.open(error?.error?.error || 'Failed to update report subscription.', 'Close', {
            duration: 4000,
          });
        },
      });
    });
  }

  deleteSubscription(subscription?: ReportSubscriptionDto): void {
    const target = subscription ?? this.selectedSubscription;
    if (!target) return;

    const dialogRef = this.dialog.open(ReportSubscriptionDeleteConfirmComponent, {
      data: { name: target.name },
      disableClose: true,
    });
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed || !target._id) return;
      this.reportsService.deleteReportSubscription(target._id).subscribe({
        next: () => {
          this.snackBar.open('Report subscription deleted.', 'Close', { duration: 2500 });
          this.selectedSubscription = null;
          this.loadSubscriptions();
        },
        error: (error) => {
          this.snackBar.open(error?.error?.error || 'Failed to delete report subscription.', 'Close', {
            duration: 4000,
          });
        },
      });
    });
  }

  selectRow(row: ReportSubscriptionDto): void {
    this.selectedSubscription = this.selectedSubscription?._id === row._id ? null : row;
  }

  isRowSelected(row: ReportSubscriptionDto): boolean {
    return this.selectedSubscription?._id === row._id;
  }

  getStatusLabel(row: ReportSubscriptionDto): string {
    return row.enabled ? 'Enabled' : 'Disabled';
  }

  getResultLabel(row: ReportSubscriptionDto): string {
    if (!row.log?.status) return 'No runs yet';
    return row.log.status === 'success' ? 'Success' : 'Needs attention';
  }

  getResultDetail(row: ReportSubscriptionDto): string {
    return row.log?.details || '';
  }

  formatDate(value: any): string {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  }

  formatSchedule(row: ReportSubscriptionDto): string {
    const cron = row.schedule?.cron || '';
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return cron || '-';

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.length === 6 ? parts.slice(1) : parts;
    const time = this.formatCronTime(hour, minute);
    if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') return `Monthly on day ${dayOfMonth} at ${time}`;
    if (dayOfWeek !== '*' && month === '*') return `Weekly on ${this.weekdayName(dayOfWeek)} at ${time}`;
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return `Daily at ${time}`;
    return cron;
  }

  getNextRun(row: ReportSubscriptionDto): string {
    if (!row.enabled) return 'Paused';
    const cron = row.schedule?.cron || '';
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return 'Custom schedule';
    const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = parts.length === 6 ? parts.slice(1) : parts;
    const minute = Number(minuteRaw);
    const hour = Number(hourRaw);
    if (!Number.isFinite(minute) || !Number.isFinite(hour) || monthRaw !== '*') return 'Custom schedule';

    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);

    if (dayOfMonthRaw === '*' && dayOfWeekRaw === '*') {
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toLocaleString();
    }

    if (dayOfWeekRaw !== '*') {
      const target = Number(dayOfWeekRaw);
      if (!Number.isFinite(target)) return 'Custom schedule';
      const today = next.getDay();
      let delta = (target - today + 7) % 7;
      if (delta === 0 && next <= now) delta = 7;
      next.setDate(next.getDate() + delta);
      return next.toLocaleString();
    }

    if (dayOfMonthRaw !== '*') {
      const day = Number(dayOfMonthRaw);
      if (!Number.isFinite(day)) return 'Custom schedule';
      next.setDate(Math.min(day, this.daysInMonth(next)));
      if (next <= now) {
        next.setMonth(next.getMonth() + 1, 1);
        next.setDate(Math.min(day, this.daysInMonth(next)));
      }
      return next.toLocaleString();
    }

    return 'Custom schedule';
  }

  private formatCronTime(hour: string, minute: string): string {
    const h = Number(hour);
    const m = Number(minute);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return `${hour}:${minute}`;
    return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  private weekdayName(value: string): string {
    const index = Number(value);
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[index] || value;
  }

  private daysInMonth(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  private toPayload(formValue: ReportSubscriptionFormValue): ReportSubscriptionPayload {
    return {
      name: formValue.name,
      enabled: formValue.enabled,
      report: formValue.report,
      email: formValue.email,
      schedule: formValue.schedule,
    };
  }
}
