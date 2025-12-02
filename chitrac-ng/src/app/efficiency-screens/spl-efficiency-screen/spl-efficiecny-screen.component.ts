import { Component, OnDestroy } from '@angular/core';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, exhaustMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { BlanketBlasterModule } from '../../blanket-blaster/blanket-blaster.module';

@Component({
  selector: 'app-spl-efficiency-screen',
  templateUrl: './spl-efficiecny-screen.component.html',
  styleUrls: ['./spl-efficiecny-screen.component.scss'],
  imports: [
    FormsModule,
    NgIf,
    NgFor,
    MatButtonModule,
    BlanketBlasterModule
  ],
  standalone: true
})
export class SplEfficiencyScreen implements OnDestroy {
  date: string = new Date().toISOString(); // today
  lanes: any[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true; // Start with loading state
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SERIAL_NUMBER = 90011;

  constructor(private efficiencyService: EfficiencyScreensService) {
    // Automatically start polling when component is created
    this.startPolling();
  }

  fetchOnce() {
    this.isLoading = true;
    this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER, this.date)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.lanes = res?.flipperData || [];
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Fetch error:', err);
          this.isLoading = false;
        }
      });
  }

  startPolling() {
    this.pollingActive = true;

    console.log(`Starting polling for serial ${this.SERIAL_NUMBER}, date: ${this.date}`);

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => {
          console.log(`Making API call to /api/alpha/analytics/machine-live-session-summary?serial=${this.SERIAL_NUMBER}&date=${new Date(this.date).toISOString().split('T')[0]}`);
          return this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER, this.date);
        })
      )
      .subscribe({
        next: (res) => {
          console.log('API Response received:', res);
          this.lanes = res?.flipperData || [];
          console.log('Lanes array:', this.lanes);
          // Debug: Log efficiency structure for first lane
          if (this.lanes.length > 0) {
            console.log('First lane efficiency structure:', this.lanes[0].efficiency);
            console.log('First lane efficiency keys:', Object.keys(this.lanes[0].efficiency || {}));
            if (this.lanes[0].efficiency) {
              console.log('lastFifteenMinutes:', this.lanes[0].efficiency.lastFifteenMinutes);
              console.log('lastHour:', this.lanes[0].efficiency.lastHour);
              console.log('today:', this.lanes[0].efficiency.today);
            }
          }
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Polling error:', err);
          this.isLoading = false;
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ident(index: number, lane: any): number {
    return index;
  }
}
