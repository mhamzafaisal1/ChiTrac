import { Component, ChangeDetectionStrategy, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

@Component({
  selector: 'app-date-time-modal',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
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
export class DateTimeModalComponent {
  private dateTimeService = inject(DateTimeService);
  @Output() closeModal = new EventEmitter<void>();

  startDateTime: Date = new Date(new Date().setHours(0, 0, 0, 0));
  endDateTime: Date = new Date();
  mode: string = 'live';
  selectedTimeframe: string = '';

  ngOnInit(): void {
    this.setLiveModeDefaults();
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
    }
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
      case 'current':
        start = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago
        end = now;
        break;
      case 'lastFifteen':
        start = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
        end = now;
        break;
      case 'lastHour':
        start = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
        end = now;
        break;
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

  confirm(): void {
    this.dateTimeService.setStartTime(this.startDateTime.toISOString());
    this.dateTimeService.setEndTime(this.endDateTime.toISOString());
    this.dateTimeService.setLiveMode(false); 
    this.dateTimeService.setConfirmed(true);
    this.dateTimeService.triggerConfirm();
    this.closeModal.emit();
  }
}