import { Component, OnDestroy } from '@angular/core';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { BlanketBlasterModule } from '../../blanket-blaster/blanket-blaster.module';

@Component({
  selector: 'app-blanket-blastertwo-efficiency-screen',
  templateUrl: './blanket-blastertwo-efficiency-screen.component.html',
  styleUrls: ['./blanket-blastertwo-efficiency-screen.component.scss'],
  imports: [
    FormsModule,
    NgIf,
    NgFor,
    MatButtonModule,
    BlanketBlasterModule
  ],
  standalone: true
})
export class BlanketBlastertwoEfficiencyScreen implements OnDestroy {
  date: string = new Date().toISOString(); // today
  lanes: any[] = [];
  pollingActive: boolean = false;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SERIAL_NUMBER = 90010; // Blanket Blaster Two serial number

  constructor(private efficiencyService: EfficiencyScreensService) {
    // Automatically start polling when component is created
    this.startPolling();
  }

  fetchOnce() {
    this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER, this.date)
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
          this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER, this.date)
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
