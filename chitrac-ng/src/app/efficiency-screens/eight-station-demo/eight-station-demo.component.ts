import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { Subject, timer, forkJoin, of } from 'rxjs';
import { takeUntil, exhaustMap, catchError } from 'rxjs/operators';

/** One group of lanes (e.g. SPL1 with 4 stations). */
export interface StationGroup {
  label: string;
  serial: number;
  lanes: any[];
}

@Component({
  selector: 'app-eight-station-demo',
  templateUrl: './eight-station-demo.component.html',
  styleUrls: ['./eight-station-demo.component.scss'],
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, EfficiencyScreenLaneComponent]
})
export class EightStationDemoComponent implements OnInit, OnDestroy {
  /** Left to right: SPL1 (4), Blanket 1 (2), Blanket 2 (2). */
  groups: StationGroup[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;

  // 8 Station Demo: SPL1 (4 stations), Blanket 1 (2), Blanket 2 (2)
  private readonly SPL1_SERIAL = 90011;
  private readonly BLANKET1_SERIAL = 90009;
  private readonly BLANKET2_SERIAL = 90010;
  private readonly CONFIG: { label: string; serial: number }[] = [
    { label: 'SPL1', serial: this.SPL1_SERIAL },
    { label: 'Blanket 1', serial: this.BLANKET1_SERIAL },
    { label: 'Blanket 2', serial: this.BLANKET2_SERIAL }
  ];

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    this.startPolling();
  }

  fetchOnce() {
    this.isLoading = true;
    this.fetchAllData();
  }

  fetchAllData() {
    const requests = this.CONFIG.map(c =>
      this.efficiencyService.getLiveEfficiencySummary(c.serial).pipe(
        catchError(err => {
          console.error(`Error fetching data for ${c.label} (${c.serial}):`, err);
          return of({ flipperData: [] });
        })
      )
    );

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (responses) => {
          this.groups = this.CONFIG.map((cfg, i) => {
            const res = responses[i] || {};
            const flipperData = res?.flipperData || [];
            const latestFaultStart = res?.latestFaultStart ?? null;
            const lanes = flipperData.map((item: any) => ({
              ...item,
              latestFaultStart,
              serial: cfg.serial,
              groupLabel: cfg.label,
              machine: item.machine ? `${cfg.label} (${cfg.serial}) - ${item.machine}` : `${cfg.label} (${cfg.serial})`
            }));
            return { label: cfg.label, serial: cfg.serial, lanes };
          });
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Error fetching 8 Station Demo data:', err);
          this.isLoading = false;
        }
      });
  }

  startPolling() {
    this.pollingActive = true;
    const serials = this.CONFIG.map(c => c.serial).join(', ');
    console.log(`Starting 8 Station Demo polling (SPL1, Blanket 1, Blanket 2): ${serials}`);

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => {
          const requests = this.CONFIG.map(c =>
            this.efficiencyService.getLiveEfficiencySummary(c.serial).pipe(
              catchError(err => {
                console.error(`Error fetching data for ${c.label} (${c.serial}):`, err);
                return of({ flipperData: [] });
              })
            )
          );
          return forkJoin(requests).pipe(
            catchError(err => {
              console.error('Error in forkJoin:', err);
              return of([]);
            })
          );
        })
      )
      .subscribe({
        next: (responses: any[]) => {
          this.groups = this.CONFIG.map((cfg, i) => {
            const res = responses[i] || {};
            const flipperData = res?.flipperData || [];
            const latestFaultStart = res?.latestFaultStart ?? null;
            const lanes = flipperData.map((item: any) => ({
              ...item,
              latestFaultStart,
              serial: cfg.serial,
              groupLabel: cfg.label,
              machine: item.machine ? `${cfg.label} (${cfg.serial}) - ${item.machine}` : `${cfg.label} (${cfg.serial})`
            }));
            return { label: cfg.label, serial: cfg.serial, lanes };
          });
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

  ident(index: number, _lane: any): number {
    return index;
  }

  getLaneMode(lane: any): EfficiencyScreenLaneMode {
    if (lane?.status === 1) return 'operator';
    if (lane?.status > 1) return 'fault';
    return 'offline';
  }
}
