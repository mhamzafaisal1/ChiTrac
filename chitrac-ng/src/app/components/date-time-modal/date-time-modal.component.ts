import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Subscription } from 'rxjs';

import { DateTimeService } from '../../services/date-time.service';
import { DashboardTimeframeService } from '../../services/dashboard-timeframe.service';
import { ShiftListItem, ShiftService } from '../../services/shift.service';
import { WebsocketService } from '../../services/websocket.service';

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
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './date-time-modal.component.html',
  styleUrls: ['./date-time-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimeModalComponent implements OnInit, OnDestroy {
  private dateTimeService = inject(DateTimeService);
  private dashboardTimeframeService = inject(DashboardTimeframeService);
  private shiftService = inject(ShiftService);
  private websocketService = inject(WebsocketService);
  private cdr = inject(ChangeDetectorRef);
  @Output() closeModal = new EventEmitter<void>();

  startDateTime: Date = new Date(new Date().setHours(0, 0, 0, 0));
  endDateTime: Date = new Date();
  mode: string = 'live';
  selectedTimeframe: string = '';
  selectedOption: string = 'today';
  shifts: ShiftListItem[] = [];
  selectedShiftId: string | null = null;
  currentShiftId: string | null = null;
  shiftsLoadError: string | null = null;
  private dashboardCacheSub?: Subscription;

  ngOnInit(): void {
    this.initializePickerDates();
    this.mode = this.dateTimeService.getLiveMode() ? 'live' : 'manual';
    const existing = this.dateTimeService.getShiftId();
    this.selectedShiftId = existing || null;
    const existingTimeframe = this.dateTimeService.getTimeframe();
    this.selectedTimeframe = existingTimeframe || '';
    this.selectedOption = existing
      ? `shift:${existing}`
      : existingTimeframe || (this.dateTimeService.getLiveMode() ? 'today' : 'custom');

    this.shiftService.getActiveShifts().subscribe({
      next: (res) => {
        this.shifts = [...(res.shifts || [])].sort(
          (a, b) => this.shiftStartMinutes(a) - this.shiftStartMinutes(b)
        );
        this.shiftsLoadError = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.shiftsLoadError = 'Could not load shifts';
        this.shifts = [];
        this.cdr.markForCheck();
      },
    });

    this.dashboardCacheSub = this.websocketService.dashboardCache$.subscribe((cache) => {
      const activeShift = cache.activeShift;
      const currentShiftMeta = cache.currentShift?.meta;
      const shiftId = activeShift?.mode === 'current'
        ? activeShift.shiftId
        : currentShiftMeta?.mode === 'current'
          ? currentShiftMeta.shiftId
          : null;

      this.currentShiftId = shiftId ? String(shiftId) : null;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.dashboardCacheSub?.unsubscribe();
  }

  isDisabled(): boolean {
    return this.selectedOption !== 'custom';
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
    this.selectedOption = `shift:${shiftId}`;
    this.selectedShiftId = shiftId;
    this.selectedTimeframe = '';
    this.mode = 'manual';
    this.dateTimeService.setLiveMode(false);
    this.dateTimeService.setTimeframe('');
    this.cdr.markForCheck();
  }

  isSelectedShift(shift: ShiftListItem): boolean {
    return this.selectedOption === `shift:${shift._id}`;
  }

  isCurrentShift(shift: ShiftListItem): boolean {
    return Boolean(this.currentShiftId && shift?._id && String(shift._id) === this.currentShiftId);
  }

  selectCustom(): void {
    this.selectedOption = 'custom';
    this.selectedShiftId = null;
    this.selectedTimeframe = '';
    this.mode = 'manual';
    this.dateTimeService.setLiveMode(false);
    this.dateTimeService.setShiftId('');
    this.dateTimeService.setTimeframe('');
    this.cdr.markForCheck();
  }

  onTimeframeSelect(timeframe: string): void {
    this.selectedOption = timeframe;
    this.selectedTimeframe = timeframe;
    this.selectedShiftId = null;
    this.mode = 'manual'; // Switch to manual mode when timeframe is selected
    this.dateTimeService.setLiveMode(false);
    this.dateTimeService.setShiftId('');
    
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

  selectToday(): void {
    this.selectedOption = 'today';
    this.onModeChange('live');
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
      this.selectedOption = selection.shiftId ? `shift:${selection.shiftId}` : 'today';
      this.dateTimeService.setLiveMode(selection.mode === 'current');
      this.cdr.markForCheck();
    });
  }

  confirm(): void {
    this.dateTimeService.setStartTime(this.startDateTime.toISOString());
    this.dateTimeService.setEndTime(this.endDateTime.toISOString());
    this.dateTimeService.setLiveMode(this.selectedOption === 'today');
    this.dateTimeService.setShiftId(this.selectedShiftId || '');
    this.dateTimeService.setTimeframe(this.selectedTimeframe || '');
    this.dateTimeService.setConfirmed(true);
    this.dateTimeService.triggerConfirm();
    this.closeModal.emit();
  }

  private shiftStartMinutes(shift: ShiftListItem): number {
    if (!shift.startTime) return Number.MAX_SAFE_INTEGER;
    return (Number(shift.startTime.hour) * 60) + Number(shift.startTime.minute);
  }
}
