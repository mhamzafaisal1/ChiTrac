import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { Subject, timer, forkJoin, of } from 'rxjs';
import { takeUntil, exhaustMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-spfs-efficiency-screen',
  templateUrl: './SPFs-efficiency-screen.html',
  styleUrls: ['./SPFs-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule, NgFor, NgIf]
})
export class SPFsEfficiencyScreenComponent implements OnInit, OnDestroy {
  lanes: any[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  // Hardcoded SPF machine serials
  private readonly SPF_SERIALS = [67808, 67806, 67807, 67805, 67804, 67803];

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    // Start polling immediately with hardcoded serials
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
          // Combine all responses into a single lanes array
          this.lanes = [];
          
          responses.forEach((response, index) => {
            const serial = this.SPF_SERIALS[index];
            const flipperData = response?.flipperData || [];
            
            // Each SPF machine should have one operator, so take the first lane from flipperData
            if (flipperData.length > 0) {
              // Use the first (and likely only) operator from the response
              this.lanes.push(flipperData[0]);
            } else {
              // If no data, create an offline/empty lane entry
              this.lanes.push({
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
                batch: { item: '', code: 0 }
              });
            }
          });

          // Sort lanes by machine name to maintain consistent order
          this.lanes.sort((a, b) => {
            const nameA = a.machine || '';
            const nameB = b.machine || '';
            return nameA.localeCompare(nameB);
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
          // Combine all responses into a single lanes array
          // Wait for all 6 calls to complete before showing lanes
          this.lanes = [];
          
          responses.forEach((response, index) => {
            const serial = this.SPF_SERIALS[index];
            const flipperData = response?.flipperData || [];
            
            if (flipperData.length > 0) {
              this.lanes.push(flipperData[0]);
            } else {
              // Create offline/empty lane entry
              this.lanes.push({
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
                batch: { item: '', code: 0 }
              });
            }
          });

          // Sort lanes by machine name
          this.lanes.sort((a, b) => {
            const nameA = a.machine || '';
            const nameB = b.machine || '';
            return nameA.localeCompare(nameB);
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
}

