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
    
    const now = new Date();
    let start: Date;
    let end: Date;

    if (timeframe === 'thisWeek') {
      // Calculate start of current week (Sunday)
      start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      
      // Calculate end of current week (Saturday)
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'thisMonth') {
      // Calculate start of current month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      
      // Calculate end of current month
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    } else {
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