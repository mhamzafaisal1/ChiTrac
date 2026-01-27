// machine-efficiency-screen.component.ts
import { Component, OnDestroy } from '@angular/core';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { BlanketBlasterModule } from '../../blanket-blaster/blanket-blaster.module';

@Component({
  selector: 'app-machine-efficiency-lane',
  templateUrl: './machine-efficiency-lane.component.html',
  styleUrls: ['./machine-efficiency-lane.component.scss'],
  imports: [
    FormsModule,
    NgIf,
    NgFor,
    MatButtonModule,
    BlanketBlasterModule
  ],
  standalone: true
})
export class MachineEfficiencyLaneComponent implements OnDestroy {
  lanes: any[] = [];
  pollingActive = false;
  serialInput: number | null = null;

  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private SERIAL_NUMBER = 90011; // default; replaced when user clicks Get

  constructor(private efficiencyService: EfficiencyScreensService) {
    this.startPolling();
  }

  onGet() {
    if (this.serialInput == null || Number.isNaN(this.serialInput)) return;
    this.SERIAL_NUMBER = Number(this.serialInput);
    this.fetchOnce();
  }

  fetchOnce() {
    this.efficiencyService.getMachineLiveEfficiencySummary(this.SERIAL_NUMBER)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          // Handle flipperData format (array) like operator route
          const flipperData = res?.flipperData || [];
          this.lanes = flipperData.length > 0 ? flipperData : [];
        },
        error: (err) => { console.error('Fetch error:', err); }
      });
  }

  startPolling() {
    this.pollingActive = true;
    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.efficiencyService.getMachineLiveEfficiencySummary(this.SERIAL_NUMBER))
      )
      .subscribe({
        next: (res) => {
          // Handle flipperData format (array) like operator route
          const flipperData = res?.flipperData || [];
          this.lanes = flipperData.length > 0 ? flipperData : [];
        },
        error: (err) => { console.error('Polling error:', err); }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ident(index: number, lane: any): number { return index; }
}
