import { Component, DestroyRef, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
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
import { MatIconModule } from '@angular/material/icon';
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

type WizardStep = 'report' | 'schedule' | 'delivery' | 'review';
type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'custom';

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
    MatIconModule,
    MatSlideToggleModule,
    MatSelectModule,
  ],
  templateUrl: './report-subscription-cu.component.html',
  styleUrl: './report-subscription-cu.component.scss',
})
export class ReportSubscriptionCuComponent implements OnInit {
  form!: FormGroup;
  step: WizardStep = 'report';
  schedulePresetOptions: { value: SchedulePreset; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'custom', label: 'Custom Cron' },
  ];
  timeOptions = this.buildTimeOptions();
  weekdayOptions = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];
  monthDayOptions = Array.from({ length: 31 }, (_, index) => index + 1);
  private readonly stepOrder: WizardStep[] = ['report', 'schedule', 'delivery', 'review'];

  reportNameOptions = [
    { value: 'machine', label: 'Machine' },
    { value: 'operator', label: 'Operator' },
    { value: 'item', label: 'Item' },
    { value: 'fault', label: 'Fault' },
  ];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<ReportSubscriptionCuComponent>,
    private destroyRef: DestroyRef,
    @Inject(MAT_DIALOG_DATA) public data: ReportSubscriptionFormValue | null
  ) {}

  ngOnInit(): void {
    const initialCron = this.data?.schedule?.cron ?? '';
    const initialPreset = this.inferSchedulePreset(initialCron);

    this.form = this.fb.group({
      name: [this.data?.name ?? '', [Validators.required, Validators.maxLength(120)]],
      enabled: [this.data?.enabled ?? true, [Validators.required]],
      reportName: [this.data?.report?.name ?? 'machine', [Validators.required]],
      reportTypeSummary: [(this.data?.report?.type ?? 'summary') === 'summary'],
      schedulePreset: [initialPreset, [Validators.required]],
      scheduleTime: [this.inferScheduleTime(initialCron), [Validators.required]],
      scheduleWeekday: [this.inferScheduleWeekday(initialCron), [Validators.required]],
      scheduleMonthDay: [this.inferScheduleMonthDay(initialCron), [Validators.required]],
      cron: [initialCron, [Validators.required, this.cronValidator()]],
      emailTo: [this.data?.email?.to ?? '', [Validators.required, this.emailListValidator(true)]],
      emailCc: [this.data?.email?.cc ?? '', [this.emailListValidator(false)]],
      emailBcc: [this.data?.email?.bcc ?? '', [this.emailListValidator(false)]],
      emailSubject: [this.data?.email?.subject ?? '', [Validators.required]],
      emailBodyText: [this.data?.email?.bodyText ?? '', [Validators.required]],
    });

    this.form.get('schedulePreset')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((preset: SchedulePreset) => {
        if (preset !== 'custom') {
          this.updateCronFromPreset();
        }
      });

    ['scheduleTime', 'scheduleWeekday', 'scheduleMonthDay'].forEach((controlName) => {
      this.form.get(controlName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.form.get('schedulePreset')?.value !== 'custom') {
            this.updateCronFromPreset();
          }
        });
    });

    if (initialPreset !== 'custom' || !initialCron) {
      this.updateCronFromPreset();
    }
  }

  get title(): string {
    return this.data?._id ? 'Edit Report Subscription' : 'Create Report Subscription';
  }

  get stepIndex(): number {
    return this.stepOrder.indexOf(this.step);
  }

  get isFirstStep(): boolean {
    return this.stepIndex === 0;
  }

  get isLastStep(): boolean {
    return this.stepIndex === this.stepOrder.length - 1;
  }

  get selectedReportLabel(): string {
    const reportName = this.form?.value?.reportName;
    return this.reportNameOptions.find((option) => option.value === reportName)?.label ?? 'Report';
  }

  get selectedReportTypeLabel(): string {
    return this.form?.value?.reportTypeSummary ? 'Summary' : 'Detailed';
  }

  get scheduleSummary(): string {
    const preset = this.form?.value?.schedulePreset as SchedulePreset;
    const time = this.form?.value?.scheduleTime || '08:00';
    if (preset === 'daily') return `Daily at ${this.formatTimeLabel(time)}`;
    if (preset === 'weekly') {
      const weekday = this.weekdayOptions.find((option) => option.value === Number(this.form?.value?.scheduleWeekday))?.label ?? 'Monday';
      return `${weekday}s at ${this.formatTimeLabel(time)}`;
    }
    if (preset === 'monthly') {
      return `Day ${this.form?.value?.scheduleMonthDay || 1} of each month at ${this.formatTimeLabel(time)}`;
    }
    return this.form?.value?.cron || 'Custom cron';
  }

  get canContinue(): boolean {
    return this.isCurrentStepValid();
  }

  back(): void {
    if (this.isFirstStep) return;
    this.step = this.stepOrder[this.stepIndex - 1];
  }

  next(): void {
    if (!this.isCurrentStepValid()) {
      this.markCurrentStepTouched();
      return;
    }
    if (!this.isLastStep) {
      this.step = this.stepOrder[this.stepIndex + 1];
    }
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

  isStepComplete(targetStep: WizardStep): boolean {
    const controls = this.getStepControls(targetStep);
    return controls.every((controlName) => this.form.get(controlName)?.valid);
  }

  private isCurrentStepValid(): boolean {
    return this.isStepComplete(this.step);
  }

  private markCurrentStepTouched(): void {
    this.getStepControls(this.step).forEach((controlName) => this.form.get(controlName)?.markAsTouched());
  }

  private getStepControls(targetStep: WizardStep): string[] {
    if (targetStep === 'report') return ['name', 'enabled', 'reportName', 'reportTypeSummary'];
    if (targetStep === 'schedule') return ['schedulePreset', 'scheduleTime', 'scheduleWeekday', 'scheduleMonthDay', 'cron'];
    if (targetStep === 'delivery') return ['emailTo', 'emailCc', 'emailBcc', 'emailSubject', 'emailBodyText'];
    return ['name', 'enabled', 'reportName', 'reportTypeSummary', 'cron', 'emailTo', 'emailCc', 'emailBcc', 'emailSubject', 'emailBodyText'];
  }

  private updateCronFromPreset(): void {
    const preset = this.form.get('schedulePreset')?.value as SchedulePreset;
    if (preset === 'custom') return;

    const { hour, minute } = this.parseTime(this.form.get('scheduleTime')?.value);
    const weekday = Number(this.form.get('scheduleWeekday')?.value ?? 1);
    const monthDay = Number(this.form.get('scheduleMonthDay')?.value ?? 1);
    let cron = `0 ${minute} ${hour} * * *`;

    if (preset === 'weekly') {
      cron = `0 ${minute} ${hour} * * ${weekday}`;
    } else if (preset === 'monthly') {
      cron = `0 ${minute} ${hour} ${monthDay} * *`;
    }

    this.form.get('cron')?.setValue(cron, { emitEvent: false });
  }

  private inferSchedulePreset(cron: string): SchedulePreset {
    const parts = this.normalizeCronParts(cron);
    if (!parts) return 'daily';

    const dayOfMonth = parts[3];
    const month = parts[4];
    const dayOfWeek = parts[5];

    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return 'daily';
    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') return 'weekly';
    if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') return 'monthly';
    return 'custom';
  }

  private inferScheduleTime(cron: string): string {
    const parts = this.normalizeCronParts(cron);
    if (!parts) return '08:00';
    const minute = this.padTimePart(parts[1], 59);
    const hour = this.padTimePart(parts[2], 23);
    return `${hour}:${minute}`;
  }

  private inferScheduleWeekday(cron: string): number {
    const parts = this.normalizeCronParts(cron);
    const weekday = Number(parts?.[5]);
    return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1;
  }

  private inferScheduleMonthDay(cron: string): number {
    const parts = this.normalizeCronParts(cron);
    const day = Number(parts?.[3]);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
  }

  private normalizeCronParts(cron: string): string[] | null {
    const parts = `${cron || ''}`.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 5) {
      return ['0', ...parts];
    }
    if (parts.length === 6) {
      return parts;
    }
    return null;
  }

  private parseTime(value: string): { hour: number; minute: number } {
    const [hourValue, minuteValue] = `${value || '08:00'}`.split(':');
    const hour = Number(hourValue);
    const minute = Number(minuteValue);
    return {
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
      minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
    };
  }

  private padTimePart(value: string, maxValue: number): string {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue)) return '00';
    return String(Math.max(0, Math.min(numberValue, maxValue))).padStart(2, '0');
  }

  private formatTimeLabel(value: string): string {
    const { hour, minute } = this.parseTime(value);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(2000, 0, 1, hour, minute));
  }

  private cronValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = `${control.value || ''}`.trim();
      if (!value) return null;
      return this.normalizeCronParts(value) ? null : { cron: true };
    };
  }

  private emailListValidator(required: boolean): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = `${control.value || ''}`.trim();
      if (!value) return required ? { required: true } : null;

      const emailPattern = /^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/;
      const emails = value.split(';').map((email) => email.trim()).filter(Boolean);
      if (!emails.length) return required ? { required: true } : null;
      return emails.every((email) => emailPattern.test(email)) ? null : { emailList: true };
    };
  }

  private buildTimeOptions(): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 15) {
        const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        options.push({
          value,
          label: this.formatTimeLabel(value),
        });
      }
    }
    return options;
  }
}
