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

  displayedColumns = ['report', 'name', 'type', 'enabled', 'emailTo', 'cron'];
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
