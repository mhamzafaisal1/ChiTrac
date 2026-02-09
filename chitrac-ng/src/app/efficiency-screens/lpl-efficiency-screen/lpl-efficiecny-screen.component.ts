import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-lpl-efficiency-screen',
  templateUrl: './lpl-efficiecny-screen.component.html',
  styleUrls: ['./lpl-efficiecny-screen.component.scss'],
  standalone: true,
  imports: [CommonModule, EfficiencyScreenLaneComponent]
})
export class LplEfficiencyScreen implements OnDestroy, OnInit {
  lanes: any[] = [];
  pollingActive: boolean = false;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SERIAL_NUMBER = 90007;
  private readonly LPL2_SERIAL_NUMBER = 90008;
  private currentSerialNumber: number = this.SERIAL_NUMBER; // Default to LPL1

  constructor(
    private efficiencyService: EfficiencyScreensService,
    private route: ActivatedRoute
  ) {
    // Don't start polling in constructor - wait for ngOnInit
  }

  ngOnInit() {
    // Get the line parameter from the route
    this.route.params.subscribe(params => {
      const line = params['line'];
      
      // Determine which serial number to use based on the route parameter
      if (line === 'lpl2') {
        this.currentSerialNumber = this.LPL2_SERIAL_NUMBER;
        // console.log('Using LPL2 serial number:', this.currentSerialNumber);
      } else {
        // Default to LPL1 for any other value or when no parameter is provided
        this.currentSerialNumber = this.SERIAL_NUMBER;
        // console.log('Using LPL1 serial number:', this.currentSerialNumber);
      }
      
      // Start polling after determining the serial number
      this.startPolling();
    });
  }

  fetchOnce() {
    this.efficiencyService.getLiveEfficiencySummary(this.currentSerialNumber)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const latestFaultStart = res?.latestFaultStart ?? null;
          const data = res?.flipperData || [];
          this.lanes = data.map((item: any) => ({ ...item, latestFaultStart }));
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
          this.efficiencyService.getLiveEfficiencySummary(this.currentSerialNumber)
        )
      )
      .subscribe({
        next: (res) => {
          const latestFaultStart = res?.latestFaultStart ?? null;
          const data = res?.flipperData || [];
          this.lanes = data.map((item: any) => ({ ...item, latestFaultStart }));
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

  getLaneMode(lane: any): EfficiencyScreenLaneMode {
    if (lane?.status === 1) return 'operator';
    if (lane?.status > 1) return 'fault';
    return 'offline';
  }
}
