import { Component, OnDestroy, OnInit } from '@angular/core';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';

@Component({
  selector: 'app-blanket-blasterone-efficiency-screen',
  templateUrl: './blanket-blasterone-efficiency-screen.component.html',
  styleUrls: ['./blanket-blasterone-efficiency-screen.component.scss'],
  imports: [CommonModule, EfficiencyScreenLaneComponent],
  standalone: true
})
export class BlanketBlasteroneEfficiencyScreen implements OnInit, OnDestroy {
  lanes: any[] = [];
  machineLane: any | null = null;
  isLoading = true;
  pollingActive: boolean = false;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SERIAL_NUMBER = 90009; // Blanket Blaster One serial number

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    this.startPolling();
  }

  fetchOnce() {
    this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.lanes = res?.flipperData || [];
          this.machineLane = res?.machineLane ?? null;
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

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() =>
          this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER)
        )
      )
      .subscribe({
        next: (res) => {
          this.lanes = res?.flipperData || [];
          this.machineLane = res?.machineLane ?? null;
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

  getLaneMode(lane: any): EfficiencyScreenLaneMode {
    if (lane?.status === 1) return 'operator';
    if (lane?.status > 1) return 'fault';
    return 'offline';
  }
}
