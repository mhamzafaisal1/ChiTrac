import { Component, OnInit, OnDestroy, OnChanges, Input, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../../services/efficiency-screens.service';
import { DataBarComponent } from '../../../blanket-blaster/lane-components/data-bar/data-bar.component';
import { timer, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'cm-machine-oee',
  templateUrl: './cm-machine-oee.component.html',
  styleUrls: ['./cm-machine-oee.component.scss'],
  imports: [CommonModule, DataBarComponent],
  standalone: true
})
export class CmMachineOeeComponent implements OnInit, OnDestroy, OnChanges {
  @Input() machineSerial = 0;

  laneData: any = null;
  loading = true;
  error = '';
  private pollSub?: Subscription;
  private readonly POLL_INTERVAL = 6000;

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() { 
    if (this.machineSerial) this.startPolling(); 
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['machineSerial'] && this.machineSerial) {
      this.startPolling();
    }
  }

  ngOnDestroy() { 
    this.pollSub?.unsubscribe(); 
  }

  private startPolling() {
    this.pollSub?.unsubscribe();
    this.loading = true; 
    this.error = '';
    this.pollSub = timer(0, this.POLL_INTERVAL)
      .pipe(switchMap(() => this.efficiencyService.getLiveEfficiencySummary(this.machineSerial)))
      .subscribe({
        next: (res) => {
          this.loading = false;
          // The shared service separates machine metrics from operator/station lanes.
          const ld = res?.machineLane || {};
          const metric = ld.oee || {};
          this.laneData = {
            status: ld.status ?? -1,
            fault: ld?.fault ?? 'Unknown',
            machine: ld.machine ?? `Serial ${this.machineSerial}`,
            displayTimers: ld?.displayTimers ?? { on: '', run: '' },
            metric // OEE/efficiency buckets: lastSixMinutes, lastFifteenMinutes, lastHour, today
          };
        },
        error: () => { 
          this.loading = false; 
          this.error = 'Failed to load data'; 
        }
      });
  }

  get isRunning() { return this.laneData?.status === 1; }
  get isFault()   { return this.laneData?.status > 1; }
  get isStop()    { return this.laneData?.status === 0 || this.laneData?.status === -1; }
  get color()     { return this.laneData?.metric?.lastSixMinutes?.color || 'white'; }
}
