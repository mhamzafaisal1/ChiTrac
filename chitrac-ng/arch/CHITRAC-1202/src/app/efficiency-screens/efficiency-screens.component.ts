import { Component, OnDestroy } from '@angular/core';
import { EfficiencyScreensService } from '../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { BlanketBlasterModule } from '../blanket-blaster/blanket-blaster.module';

@Component({
  selector: 'app-efficiency-screens',
  templateUrl: './efficiency-screens.component.html',
  styleUrls: ['./efficiency-screens.component.scss'],
  imports: [
    FormsModule,
    NgIf,
    NgFor,
    MatButtonModule,
    BlanketBlasterModule
  ],
  standalone: true
})
export class EfficiencyScreens implements OnDestroy {
  serial: string = '';
  date: string = new Date().toISOString(); // today
  lanes: any[] = [];
  pollingActive: boolean = false;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;

  constructor(private efficiencyService: EfficiencyScreensService) {}

  onSubmitSerial() {
    this.fetchOnce();
    this.startPolling();
  }

  fetchOnce() {
    if (!this.serial) return;

    this.efficiencyService.getLiveEfficiencySummary(Number(this.serial), this.date)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.lanes = res?.flipperData || [];
        },
        error: (err) => {
          console.error('Fetch error:', err);
        }
      });
  }

  startPolling() {
    this.pollingActive = true;

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() =>
          this.efficiencyService.getLiveEfficiencySummary(Number(this.serial), this.date)
        )
      )
      .subscribe({
        next: (res) => {
          this.lanes = res?.flipperData || [];
        },
        error: (err) => {
          console.error('Polling error:', err);
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
