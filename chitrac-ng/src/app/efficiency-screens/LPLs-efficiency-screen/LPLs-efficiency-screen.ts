import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { EfficiencyScreenLaneComponent, type EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { Subject, timer, forkJoin, of } from 'rxjs';
import { takeUntil, exhaustMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-lpls-efficiency-screen',
  templateUrl: './LPLs-efficiency-screen.html',
  styleUrls: ['./LPLs-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, EfficiencyScreenLaneComponent]
})
export class LPLsEfficiencyScreenComponent implements OnInit, OnDestroy {
  lanes: any[] = [];
  pollingActive: boolean = false;
  isLoading: boolean = true;
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  // Hardcoded LPL machine serials (2 machines, 3 operators each = 6 lanes)
  private readonly LPL_SERIALS = [90007, 90008];

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    // Start polling immediately with hardcoded serials
    this.startPolling();
  }

  fetchOnce() {
    this.isLoading = true;
    this.fetchAllLPLData();
  }

  fetchAllLPLData() {
    // Create parallel requests for both LPL machines
    const requests = this.LPL_SERIALS.map(serial =>
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
          // Combine all operators from both machines into a single lanes array
          this.lanes = [];
          
          responses.forEach((response) => {
            const flipperData = response?.flipperData || [];
            const latestFaultStart = response?.latestFaultStart ?? null;
            if (flipperData.length > 0) {
              this.lanes.push(...flipperData.map((item: any) => ({ ...item, latestFaultStart })));
            }
          });

          this.lanes.sort((a, b) => {
            const machineA = a.machine || '';
            const machineB = b.machine || '';
            if (machineA !== machineB) {
              return machineA.localeCompare(machineB);
            }
            const operatorA = a.operator || '';
            const operatorB = b.operator || '';
            return operatorA.localeCompare(operatorB);
          });

          console.log(`Fetched data for ${this.lanes.length} LPL operators (expected 6)`);
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Error fetching LPL data:', err);
          this.isLoading = false;
        }
      });
  }

  startPolling() {
    this.pollingActive = true;
    console.log(`Starting polling for ${this.LPL_SERIALS.length} LPL machines (serials: ${this.LPL_SERIALS.join(', ')})`);

    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => {
          console.log(`Making API calls for ${this.LPL_SERIALS.length} LPL machines`);
          
          // Create parallel requests for both LPL machines
          const requests = this.LPL_SERIALS.map(serial =>
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
          // Combine all operators from both machines into a single lanes array
          // Wait for all calls to complete before showing lanes
          this.lanes = [];
          
          responses.forEach((response) => {
            const flipperData = response?.flipperData || [];
            const latestFaultStart = response?.latestFaultStart ?? null;
            if (flipperData.length > 0) {
              this.lanes.push(...flipperData.map((item: any) => ({ ...item, latestFaultStart })));
            }
          });

          this.lanes.sort((a, b) => {
            const machineA = a.machine || '';
            const machineB = b.machine || '';
            if (machineA !== machineB) {
              return machineA.localeCompare(machineB);
            }
            const operatorA = a.operator || '';
            const operatorB = b.operator || '';
            return operatorA.localeCompare(operatorB);
          });

          console.log(`Updated ${this.lanes.length} LPL lanes (expected 6)`);
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

