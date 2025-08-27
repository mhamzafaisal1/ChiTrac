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
          const ld = res?.laneData || {};
          // Map to existing lane shape; leave missing fields empty
          const lane = {
            status: ld?.status?.code ?? 0,
            fault: ld?.fault ?? '',
            operator: null as string | null,
            operatorId: null as number | null,
            machine: ld?.machine?.name ?? `Serial ${ld?.machine?.serial ?? this.SERIAL_NUMBER}`,
            timers: ld?.timers ?? { on: 0, ready: 0 },
            displayTimers: ld?.displayTimers ?? { on: '', run: '' },
            efficiency: ld?.efficiency ?? {},
            oee: ld?.oee ?? {},
            batch: { item: '', code: '' }
          };
          this.lanes = [lane];
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
          const ld = res?.laneData || {};
          const lane = {
            status: ld?.status?.code ?? 0,
            fault: ld?.fault ?? '',
            operator: null as string | null,
            operatorId: null as number | null,
            machine: ld?.machine?.name ?? `Serial ${ld?.machine?.serial ?? this.SERIAL_NUMBER}`,
            timers: ld?.timers ?? { on: 0, ready: 0 },
            displayTimers: ld?.displayTimers ?? { on: '', run: '' },
            efficiency: ld?.efficiency ?? {},
            oee: ld?.oee ?? {},
            batch: { item: '', code: '' }
          };
          this.lanes = [lane];
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
