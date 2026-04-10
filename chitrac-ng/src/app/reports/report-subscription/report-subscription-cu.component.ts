import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';

export interface ReportSubscriptionFormValue {
  _id?: string;
  name: string;
  enabled: boolean;
  report: { name: string; type: 'summary' | 'detailed' };
  email: { to: string; cc: string; bcc: string; subject: string; bodyText: string };
  schedule: { cron: string };
}

@Component({
  selector: 'app-report-subscription-cu',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSelectModule,
  ],
  templateUrl: './report-subscription-cu.component.html',
  styleUrl: './report-subscription-cu.component.scss',
})
export class ReportSubscriptionCuComponent implements OnInit {
  form!: FormGroup;

  reportNameOptions = [
    { value: 'machine', label: 'Machine' },
    { value: 'operator', label: 'Operator' },
    { value: 'item', label: 'Item' },
    { value: 'fault', label: 'Fault' },
  ];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<ReportSubscriptionCuComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ReportSubscriptionFormValue | null
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      name: [this.data?.name ?? '', [Validators.required, Validators.maxLength(120)]],
      enabled: [this.data?.enabled ?? true, [Validators.required]],
      reportName: [this.data?.report?.name ?? 'machine', [Validators.required]],
      reportTypeSummary: [(this.data?.report?.type ?? 'summary') === 'summary'],
      cron: [this.data?.schedule?.cron ?? '', [Validators.required]],
      emailTo: [this.data?.email?.to ?? '', [Validators.required]],
      emailCc: [this.data?.email?.cc ?? ''],
      emailBcc: [this.data?.email?.bcc ?? ''],
      emailSubject: [this.data?.email?.subject ?? '', [Validators.required]],
      emailBodyText: [this.data?.email?.bodyText ?? '', [Validators.required]],
    });

  }

  get title(): string {
    return this.data?._id ? 'Edit Report Subscription' : 'Create Report Subscription';
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const reportName = this.form.value.reportName;

    const payload: ReportSubscriptionFormValue = {
      _id: this.data?._id,
      name: this.form.value.name.trim(),
      enabled: Boolean(this.form.value.enabled),
      report: {
        name: reportName,
        type: this.form.value.reportTypeSummary ? 'summary' : 'detailed',
      },
      email: {
        to: this.form.value.emailTo.trim(),
        cc: this.form.value.emailCc.trim(),
        bcc: this.form.value.emailBcc.trim(),
        subject: this.form.value.emailSubject.trim(),
        bodyText: this.form.value.emailBodyText.trim(),
      },
      schedule: {
        cron: this.form.value.cron.trim(),
      },
    };

    this.dialogRef.close(payload);
  }
}
