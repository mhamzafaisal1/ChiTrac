import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { Subject, timer } from 'rxjs';
import { takeUntil, exhaustMap } from 'rxjs/operators';

@Component({
  selector: 'app-spl-efficiency-screen',
  templateUrl: './spl-efficiecny-screen.component.html',
  styleUrls: ['./spl-efficiecny-screen.component.scss'],
  standalone: true,
  imports: [CommonModule, EfficiencyScreenLaneComponent]
})
export class SplEfficiencyScreen implements OnInit, OnDestroy {
  lanes: any[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SERIAL_NUMBER = 90011;

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    this.startPolling();
  }

  fetchOnce() {
    this.isLoading = true;
    this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const latestFaultStart = res?.latestFaultStart ?? null;
          const data = res?.flipperData || [];
          this.lanes = data.map((item: any) => ({ ...item, latestFaultStart }));
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
        exhaustMap(() => this.efficiencyService.getLiveEfficiencySummary(this.SERIAL_NUMBER))
      )
      .subscribe({
        next: (res) => {
          const latestFaultStart = res?.latestFaultStart ?? null;
          const data = res?.flipperData || [];
          this.lanes = data.map((item: any) => ({ ...item, latestFaultStart }));
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
