import { Component, OnInit, OnDestroy, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Subscription, timer, Subject } from 'rxjs';
import { startWith, switchMap, share, retry, takeUntil } from 'rxjs/operators';
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
import { DateTimeService } from '../../services/date-time.service';
import { PollingService } from '../../services/polling-service.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
//import { MachineService } from '../machine.service';
//import { Duration } from 'luxon';

@Component({
    selector: 'ct-demo-flipper',
    templateUrl: './demo-flipper.component.html',
    styleUrls: ['./demo-flipper.component.scss'],
    standalone: false
})
export class DemoFlipperComponent implements OnInit, OnDestroy, OnChanges {
  @Input() serialNumber: string = '';
  @Input() machineName: string = '';

  sub: Subscription;
  subFiveMinutes: Subscription;
  subFifteenMinutes: Subscription;
  subHourly: Subscription;
  subDaily: Subscription;
  subStatus: Subscription;

  public liveMode: boolean = false;
  public hasFetchedData: boolean = false;
  public realDataArray: any[] = [];

  private pollingTimeout: any = null;
  private destroy$ = new Subject<void>();
  private readonly POLLING_INTERVAL = 6000; // 6 seconds

  selectedDate: string | null = null;

  ident(index: number, lane: any): number {
    return index;
  }

  public samplyeDataArray =  [{
        "status": 1,
        "fault": "Run",
        "operator": "Maribel Sarco",
        "operatorId": 135814,
        "machine": "Blanket2",
        "timers": {
            "on": 0,
            "ready": 0
        },
        "displayTimers": {
            "on": "",
            "run": ""
        },
        "efficiency": {
            "today": {
                "value": 98,
                "label": "today",
                "color": "#008000"
            },
            "lastHour": {
                "value": 98,
                "label": "lastHour",
                "color": "#008000"
            },
            "lastFifteenMinutes": {
                "value": 115,
                "label": "lastFifteenMinutes",
                "color": "#008000"
            },
            "lastSixMinutes": {
                "value": 124,
                "label": "lastSixMinutes",
                "color": "#008000"
            }
        },
        "batch": {
            "item": "Bath Blankets",
            "code": 7
        }
    },
    {
        "status": 3,
        "fault": "Run",
        "operator": "Blanket2 Untracked",
        "operatorId": 967802,
        "machine": "Blanket2",
        "timers": {
            "on": 0,
            "ready": 0
        },
        "displayTimers": {
            "on": "",
            "run": ""
        },
        "efficiency": {
            "today": {
                "value": 0,
                "label": "today",
                "color": "#FF0000"
            },
            "lastHour": {
                "value": 0,
                "label": "lastHour",
                "color": "#FF0000"
            },
            "lastFifteenMinutes": {
                "value": 0,
                "label": "lastFifteenMinutes",
                "color": "#FF0000"
            },
            "lastSixMinutes": {
                "value": 0,
                "label": "lastSixMinutes",
                "color": "#FF0000"
            }
        },
        "batch": {
            "item": "Bath Blankets",
            "code": 7
        }
    },
    {
        "status": 0,
        "fault": "Run",
        "operator": "Torres Jackson",
        "operatorId": 135804,
        "machine": "Blanket2",
        "timers": {
            "on": 0,
            "ready": 0
        },
        "displayTimers": {
            "on": "",
            "run": ""
        },
        "efficiency": {
            "today": {
                "value": 116,
                "label": "today",
                "color": "#008000"
            },
            "lastHour": {
                "value": 134,
                "label": "lastHour",
                "color": "#008000"
            },
            "lastFifteenMinutes": {
                "value": 123,
                "label": "lastFifteenMinutes",
                "color": "#008000"
            },
            "lastSixMinutes": {
                "value": 131,
                "label": "lastSixMinutes",
                "color": "#008000"
            }
        },
        "batch": {
            "item": "Bath Blankets",
            "code": 7
        }
    }
]
  public sampleDataArray = [{
    status: 1,
    fault: 'Run',
    operator: 'Brian Iguchi',
    machine: 'Flipper 1',
    timers: {
      on: 0,
      ready: 0,
    },
    displayTimers: {
      on: '',
      run: ''
    },
    efficiency: {
      lastFiveMinutes: {
        value: 97,
        label: 'Current',
        color: '#008000'
      },
      lastFifteenMinutes: {
        value: 89,
        label: '15 mins',
        color: '#008000'
      },
      lastHour: {
        value: 73,
        label: '1 hr',
        color: '#F89406'
      },
      today: {
        value: 54,
        label: 'Today',
        color: '#FF0000'
      }
    },
    batch: {
      item: 'Mixed Towels',
      customer: 'Hilton Chicago',
      code: 65518
    }
  }, {
    status: 1,
    fault: 'Run',
    operator: null,
    machine: 'Flipper 2',
    timers: {
      on: 0,
      ready: 0,
    },
    displayTimers: {
      on: '00:12:34',
      run: '00:56:12'
    },
    efficiency: {
      lastFiveMinutes: {
        value: 64,
        label: 'Current',
        color: '#555'
      },
      lastFifteenMinutes: {
        value: 99.5,
        label: '15 mins',
        color: '#555'
      },
      lastHour: {
        value: 105,
        label: '1 hr',
        color: '#555'
      },
      today: {
        value: 50,
        label: 'Today',
        color: '#555'
      }
    },
    batch: {
      item: 'Hand Towels',
      customer: 'Hilton Chicago',
      code: 65519
    }
   }, {
      status: -1,
      fault: 'STOPPED',
      operator: 'Jeremy Jones',
      machine: 'Flipper 3',
    timers: {
      on: 0,
      ready: 0,
    },
    displayTimers: {
      on: '00:12:34',
      run: '00:56:12'
    },
      efficiency: {
        lastFiveMinutes: {
          value: 88,
          label: 'Current',
          color: '#008000'
        },
        lastFifteenMinutes: {
          value: 87,
          label: '15 mins',
          color: '#008000'
        },
        lastHour: {
          value: 90,
          label: '1 hr',
          color: '#008000'
        },
        today: {
          value: 89,
          label: 'Today',
          color: '#008000'
        }
      },
      batch: {
        item: 'Gym Towels',
        customer: 'Hilton Chicago',
        code: 60647
      }
    }, {
      status: 30,
      fault: 'JAM @ PRIMARY',
      operator: 'Jake Carpenter',
      machine: 'Flipper 4',
    timers: {
      on: 0,
      ready: 0,
    },
    displayTimers: {
      on: '00:12:34',
      run: '00:56:12'
    },
      efficiency: {
        lastFiveMinutes: {
          value: 82,
          label: 'Current',
          color: '#F89406'
        },
        lastFifteenMinutes: {
          value: 91,
          label: '15 mins',
          color: '#008000'
        },
        lastHour: {
          value: 20,
          label: '1 hr',
          color: '#FF0000'
        },
        today: {
          value: 5,
          label: 'Today',
          color: '#FF0000'
        }
      },
      batch: {
        item: 'Gym Towels',
        customer: 'Hilton Chicago',
        code: 60647
      }
    }];

  constructor(
    private demoFlipperService: DemoFlipperService,
    private dateTimeService: DateTimeService,
    private pollingService: PollingService,
    private percentBreakpointService: PercentBreakpointService
  ) { }

  ngOnInit() {
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

    // Initial data fetch if we have a serial number
    if (this.serialNumber) {
      this.fetchData();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['serialNumber'] && this.serialNumber) {
      this.fetchData();
    }
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

  fetchData() {
    if (!this.serialNumber) return;
    
    const date = this.dateTimeService.getStartTime()?.split('T')[0] || new Date().toISOString().split('T')[0];
    
    this.demoFlipperService.getLiveEfficiencySummary(Number(this.serialNumber), date)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: any) => {
          this.realDataArray = result.flipperData;
          this.hasFetchedData = true;
        },
        error: (error: any) => {
          console.error('Service error:', error);
        }
      });
  }

  private startLivePolling() {
    if (!this.serialNumber) return;

    const date = this.dateTimeService.getStartTime()?.split('T')[0] || new Date().toISOString().split('T')[0];

    const poll = () => {
      this.demoFlipperService.getLiveEfficiencySummary(Number(this.serialNumber), date)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result: any) => {
            this.realDataArray = result.flipperData;
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
