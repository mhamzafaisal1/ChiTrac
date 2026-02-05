import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { Subject, timer, forkJoin, of } from 'rxjs';
import { takeUntil, exhaustMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-spfs-efficiency-screen',
  templateUrl: './SPFs-efficiency-screen.html',
  styleUrls: ['./SPFs-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, EfficiencyScreenLaneComponent]
})
export class SPFsEfficiencyScreenComponent implements OnInit, OnDestroy {
  lanes: any[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  // Hardcoded SPF machine serials
  private readonly SPF_SERIALS = [67808, 67806, 67807, 67805, 67804, 67803];
  //private readonly SPF_SERIALS = [90001, 90002, 90003, 90004, 90005, 90006];

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    this.startPolling();
  }

  // Commented out machine collection query - using hardcoded serials instead
  // loadSPFMachines() {
  //   this.isLoading = true;
  //   this.efficiencyService.getSPFMachines()
  //     .pipe(takeUntil(this.destroy$))
  //     .subscribe({
  //       next: (machines) => {
  //         this.spfMachines = machines || [];
  //         console.log(`Found ${this.spfMachines.length} SPF machines:`, this.spfMachines);
  //         
  //         if (this.spfMachines.length > 0) {
  //           // Start polling once machines are loaded
  //           this.startPolling();
  //         } else {
  //           console.warn('No SPF machines found');
  //           this.isLoading = false;
  //         }
  //       },
  //       error: (err) => {
  //         console.error('Error loading SPF machines:', err);
  //         this.isLoading = false;
  //       }
  //     });
  // }

  fetchOnce() {
    this.isLoading = true;
    this.fetchAllSPFData();
  }

  fetchAllSPFData() {
    // Create parallel requests for all 6 SPF machines
    const requests = this.SPF_SERIALS.map(serial =>
      this.efficiencyService.getLiveEfficiencySummary(serial)
        .pipe(
          catchError(err => {
            console.error(`Error fetching data for serial ${serial}:`, err);
            // Return empty flipperData on error
            return of({ flipperData: [] });
          })
        )
    );

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (responses) => {
          // Build one lane per SPF_SERIALS entry in exact array order (index i → SPF_SERIALS[i])
          this.lanes = this.SPF_SERIALS.map((serial, index) => {
            const response = responses[index];
            const flipperData = response?.flipperData || [];
            const latestFaultStart = response?.latestFaultStart ?? null;
            const latestPausedStart = response?.latestPausedStart ?? null;
            if (flipperData.length > 0) {
              return { ...flipperData[0], serial, latestFaultStart, latestPausedStart };
            }
            return {
              serial,
              status: -1,
              fault: 'Offline',
              operator: null,
              operatorId: null,
              machine: `Serial ${serial}`,
              timers: { on: 0, ready: 0 },
              displayTimers: { on: '', run: '' },
              efficiency: {
                lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'red' },
                lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'red' },
                lastHour: { value: 0, label: 'Last Hour', color: 'red' },
                today: { value: 0, label: 'All Day', color: 'red' }
              },
              oee: {},
              batch: { item: '', code: 0 },
              latestFaultStart,
              latestPausedStart
            };
          });

          console.log(`Fetched data for ${this.lanes.length} SPF machines`);
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Error fetching SPF data:', err);
          this.isLoading = false;
        }
      });
  }

  startPolling() {
    this.pollingActive = true;
    console.log(`Starting polling for ${this.SPF_SERIALS.length} SPF machines (serials: ${this.SPF_SERIALS.join(', ')})`);

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => {
          console.log(`Making API calls for ${this.SPF_SERIALS.length} SPF machines`);
          
          // Create parallel requests for all 6 SPF machines
          const requests = this.SPF_SERIALS.map(serial =>
            this.efficiencyService.getLiveEfficiencySummary(serial)
              .pipe(
                catchError(err => {
                  console.error(`Error fetching data for serial ${serial}:`, err);
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
          // Build one lane per SPF_SERIALS entry in exact array order (index i → SPF_SERIALS[i])
          this.lanes = this.SPF_SERIALS.map((serial, index) => {
            const response = responses[index];
            const flipperData = response?.flipperData || [];
            const latestFaultStart = response?.latestFaultStart ?? null;
            const latestPausedStart = response?.latestPausedStart ?? null;
            if (flipperData.length > 0) {
              return { ...flipperData[0], serial, latestFaultStart, latestPausedStart };
            }
            return {
              serial,
              status: -1,
              fault: 'Offline',
              operator: null,
              operatorId: null,
              machine: `Serial ${serial}`,
              timers: { on: 0, ready: 0 },
              displayTimers: { on: '', run: '' },
              efficiency: {
                lastSixMinutes: { value: 0, label: 'Last 6 Mins', color: 'red' },
                lastFifteenMinutes: { value: 0, label: 'Last 15 Mins', color: 'red' },
                lastHour: { value: 0, label: 'Last Hour', color: 'red' },
                today: { value: 0, label: 'All Day', color: 'red' }
              },
              oee: {},
              batch: { item: '', code: 0 },
              latestFaultStart,
              latestPausedStart
            };
          });

          console.log(`Updated ${this.lanes.length} SPF lanes`);
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

  /** Lane mode for shared efficiency-screen-lane: operator, fault, or offline. */
  getLaneMode(lane: any): EfficiencyScreenLaneMode {
    if (lane?.status === 1) return 'operator';
    if (lane?.status > 1) return 'fault';
    return 'offline';
  }
}

