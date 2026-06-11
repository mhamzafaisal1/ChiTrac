import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  Output,
  EventEmitter,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

import { DateTimeService } from '../../services/date-time.service';
import { DashboardTimeframeService } from '../../services/dashboard-timeframe.service';
import { ShiftListItem, ShiftService } from '../../services/shift.service';

@Component({
  selector: 'app-date-time-modal',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatNativeDateModule,
    MatRadioModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './date-time-modal.component.html',
  styleUrls: ['./date-time-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimeModalComponent implements OnInit {
  private dateTimeService = inject(DateTimeService);
  private dashboardTimeframeService = inject(DashboardTimeframeService);
  private shiftService = inject(ShiftService);
  private cdr = inject(ChangeDetectorRef);
  @Output() closeModal = new EventEmitter<void>();

  startDateTime: Date = new Date(new Date().setHours(0, 0, 0, 0));
  endDateTime: Date = new Date();
  mode: string = 'live';
  selectedTimeframe: string = '';
  shifts: ShiftListItem[] = [];
  selectedShiftId: string | null = null;
  shiftsLoadError: string | null = null;

  ngOnInit(): void {
    this.initializePickerDates();
    this.mode = this.dateTimeService.getLiveMode() ? 'live' : 'manual';
    const existing = this.dateTimeService.getShiftId();
    this.selectedShiftId = existing || null;

    this.shiftService.getActiveShifts().subscribe({
      next: (res) => {
        this.shifts = res.shifts || [];
        this.shiftsLoadError = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.shiftsLoadError = 'Could not load shifts';
        this.shifts = [];
        this.cdr.markForCheck();
      },
    });
  }

  isDisabled(): boolean {
    return this.mode === 'live';
  }

  onModeChange(newMode: string): void {
    this.mode = newMode;
    const isLive = newMode === 'live';
    this.dateTimeService.setLiveMode(isLive);
  
    if (isLive) {
      const now = new Date();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      this.startDateTime = start;
      this.endDateTime = now;
      this.selectedTimeframe = ''; // Clear timeframe selection when switching to live
      this.selectedShiftId = null;
      this.dateTimeService.setShiftId('');
    }
  }

  selectShift(shiftId: string): void {
    this.selectedShiftId = shiftId;
    this.cdr.markForCheck();
  }

  clearShiftFilter(): void {
    this.selectedShiftId = null;
    this.cdr.markForCheck();
  }

  onTimeframeSelect(timeframe: string): void {
    this.selectedTimeframe = timeframe;
    this.mode = 'manual'; // Switch to manual mode when timeframe is selected
    this.dateTimeService.setLiveMode(false);
    
    // Store the timeframe in the service instead of calculating dates
    this.dateTimeService.setTimeframe(timeframe);
    
    // For display purposes, we can still show approximate dates
    // but the actual API calls will use the timeframe parameter
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (timeframe) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        end = now;
        break;
      case 'thisWeek':
        // Calculate start of current week (Sunday)
        start = new Date(now);
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        end = now;
        break;
      case 'thisMonth':
        // Calculate start of current month
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = now;
        break;
      case 'thisYear':
        // Calculate start of current year
        start = new Date(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        end = now;
        break;
      default:
        return; // Invalid timeframe
    }

    this.startDateTime = start;
    this.endDateTime = end;
  }
  

  private setLiveModeDefaults(): void {
    const now = new Date();
    this.startDateTime = new Date(now.setHours(0, 0, 0, 0));
    this.endDateTime = new Date();
  }

  private setInitialDatesFromService(): void {
    const start = this.dateTimeService.getStartTime();
    const end = this.dateTimeService.getEndTime();
    if (start && end) {
      this.startDateTime = new Date(start);
      this.endDateTime = new Date(end);
      return;
    }
    this.setLiveModeDefaults();
  }

  private initializePickerDates(): void {
    const start = this.dateTimeService.getStartTime();
    const end = this.dateTimeService.getEndTime();
    if (start && end) {
      this.setInitialDatesFromService();
      return;
    }

    this.dashboardTimeframeService.applyDefault().subscribe((selection) => {
      this.startDateTime = selection.start;
      this.endDateTime = selection.end;
      this.selectedShiftId = selection.shiftId || null;
      this.mode = selection.mode === 'current' ? 'live' : 'manual';
      this.dateTimeService.setLiveMode(selection.mode === 'current');
      this.cdr.markForCheck();
    });
  }

  confirm(): void {
    this.dateTimeService.setStartTime(this.startDateTime.toISOString());
    this.dateTimeService.setEndTime(this.endDateTime.toISOString());
    this.dateTimeService.setLiveMode(false);
    this.dateTimeService.setShiftId(this.selectedShiftId || '');
    this.dateTimeService.setTimeframe(this.selectedTimeframe || '');
    this.dateTimeService.setConfirmed(true);
    this.dateTimeService.triggerConfirm();
    this.closeModal.emit();
  }
}
