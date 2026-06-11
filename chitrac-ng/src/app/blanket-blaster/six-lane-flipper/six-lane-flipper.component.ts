import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription, forkJoin, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatButtonModule } from "@angular/material/button";
import { DemoFlipperService } from '../../services/demo-flipper.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { BlanketBlasterModule } from '../blanket-blaster.module';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DateTimeService } from '../../services/date-time.service';
import { PollingService } from '../../services/polling-service.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

@Component({
    selector: 'ct-six-lane-flipper',
    templateUrl: './six-lane-flipper.component.html',
    styleUrls: ['./six-lane-flipper.component.scss'],
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatDatepickerModule,
        MatNativeDateModule,
        MatSelectModule,
        MatIconModule,
        BlanketBlasterModule,
        MatSlideToggleModule
    ]
})
export class SixLaneFlipperComponent implements OnInit, OnDestroy {
  sub: Subscription;
  subFiveMinutes: Subscription;
  subFifteenMinutes: Subscription;
  subHourly: Subscription;
  subDaily: Subscription;
  subStatus: Subscription;

  serialNumbers = [67808, 67806, 67807, 67805, 67804, 67803];

  public liveMode: boolean = false;
  public hasFetchedData: boolean = false;
  public realDataArray: any[] = [];

  private pollingTimeout: any = null;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  constructor(
    private demoFlipperService: DemoFlipperService,
    private dateTimeService: DateTimeService,
    private pollingService: PollingService,
    private percentBreakpointService: PercentBreakpointService
  ) {}
  
  ident(index: number, lane: any): number {
    return index;
  }

  ngOnInit() {
    this.subFiveMinutes = this.createDummySub(500);
    this.subFifteenMinutes = this.createDummySub(1000);
    this.subHourly = this.createDummySub(1000);
    this.subDaily = this.createDummySub(1000);
    this.subStatus = this.createDummySub(500);

    // Initial setup with DateTimeService
    const isLive = this.dateTimeService.getLiveMode();
    const wasConfirmed = this.dateTimeService.getConfirmed();

    if (!isLive && wasConfirmed) {
      this.fetchData();
    }
  
    // Subscribe to live mode changes
    this.dateTimeService.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isLive: boolean) => {
        this.liveMode = isLive;
  
        if (this.liveMode) {
          this.fetchData();
          this.startLivePolling();
        } else {
          this.stopLivePolling();
          this.realDataArray = [];
        }
      });
  
    // Subscribe to manual confirm from modal
    this.dateTimeService.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopLivePolling();
        this.fetchData();
      });

    // Initial data fetch
    this.fetchData();
  }
  
  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.subFiveMinutes) this.subFiveMinutes.unsubscribe();
    if (this.subFifteenMinutes) this.subFifteenMinutes.unsubscribe();
    if (this.subHourly) this.subHourly.unsubscribe();
    if (this.subDaily) this.subDaily.unsubscribe();
    if (this.subStatus) this.subStatus.unsubscribe();
    this.stopLivePolling();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private createDummySub(interval: number): Subscription {
    return new Subscription();
  }

  fetchData() {
    const date = this.dateTimeService.getStartTime()?.split('T')[0] || new Date().toISOString().split('T')[0];
    const apiCalls = this.serialNumbers.map(serial =>
      this.demoFlipperService.getLiveEfficiencySummary(serial, date)
    );

    forkJoin(apiCalls)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (results: any[]) => {
          this.realDataArray = results.flatMap((result, i) => {
            const serial = this.serialNumbers[i];
            if (!result || !Array.isArray(result.flipperData)) {
              console.warn(`Invalid flipperData for serial ${serial}:`, result);
              return [];
            }
            return result.flipperData;
          });
          this.hasFetchedData = true;
        },
        error: (err) => {
          console.error("Error during fetchData():", err);
        }
      });
  }

  private startLivePolling() {
    const date = this.dateTimeService.getStartTime()?.split('T')[0] || new Date().toISOString().split('T')[0];

    const poll = () => {
      const apiCalls = this.serialNumbers.map(serial =>
        this.demoFlipperService.getLiveEfficiencySummary(serial, date)
      );

      forkJoin(apiCalls)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (results: any[]) => {
            this.realDataArray = results.flatMap((result, i) => {
              const serial = this.serialNumbers[i];
              if (!result || !Array.isArray(result.flipperData)) {
                console.warn(`Invalid flipperData for serial ${serial}:`, result);
                return [];
              }
              return result.flipperData;
            });
            this.hasFetchedData = true;

            if (this.liveMode) {
              this.pollingTimeout = setTimeout(poll, this.POLLING_INTERVAL);
            }
          },
          error: (err) => {
            console.error("Polling error:", err);

            if (this.liveMode) {
              this.pollingTimeout = setTimeout(poll, this.POLLING_INTERVAL);
            }
          }
        });
    };

    poll();
  }

  private stopLivePolling() {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  public colorPicker = (result: any) => {
    if ((result.runTime < ((result.timeframe * 60) * 0.85)) && (result.timeframe != 1440 && result.timeframe != 5)) {
      return '#555';
    }
    return this.percentBreakpointService.getLegacyColorHex(result.efficiency);
  };
}
