import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs/operators';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SettingsService } from '../../services/settings.service';
import { TimeFormat } from '../../utils/time-format';

@Component({
  selector: 'app-time-format-setting',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonToggleModule],
  template: `
    <section aria-labelledby="time-format-heading">
      <h3 id="time-format-heading">Time Format</h3>
      <mat-button-toggle-group
        [formControl]="control"
        (change)="save($event.value)"
        aria-label="Your time display format">
        <mat-button-toggle value="12h">AM/PM</mat-button-toggle>
        <mat-button-toggle value="24h">24-hour</mat-button-toggle>
      </mat-button-toggle-group>
    </section>
  `,
  styles: [`:host { display: block; margin: 24px 0; } h3 { margin: 0 0 12px; }`]
})
export class TimeFormatSettingComponent {
  readonly settings = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);
  isSaving = false;
  readonly control = new FormControl<TimeFormat>('12h', { nonNullable: true });

  constructor() {
    this.settings.timeFormat$.pipe(takeUntilDestroyed()).subscribe(value => this.control.setValue(value));
  }

  save(timeFormat: TimeFormat): void {
    this.isSaving = true;
    this.control.disable();
    this.settings.saveTimeFormat(timeFormat).pipe(finalize(() => {
      this.isSaving = false;
      this.control.enable();
    })).subscribe({
      next: () => this.snackBar.open('Time format saved.', 'Close', { duration: 3000 }),
      error: () => {
        this.control.setValue(this.settings.getTimeFormat());
        this.snackBar.open('Could not save time format. Please try again.', 'Close', { duration: 5000 });
      }
    });
  }
}
