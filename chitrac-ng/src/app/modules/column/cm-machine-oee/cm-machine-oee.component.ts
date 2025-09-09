import { Component, OnInit, OnDestroy, OnChanges, Input, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../../services/efficiency-screens.service';
import { BlanketBlasterModule } from '../../../blanket-blaster/blanket-blaster.module';
import { timer, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'cm-machine-oee',
  templateUrl: './cm-machine-oee.component.html',
  styleUrls: ['./cm-machine-oee.component.scss'],
  imports: [CommonModule, BlanketBlasterModule],
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
      .pipe(switchMap(() => this.efficiencyService.getMachineLiveEfficiencySummary(this.machineSerial)))
      .subscribe({
        next: (res) => {
          this.loading = false;
          const ld = res?.laneData || {};
          const metric = (ld.oee && Object.keys(ld.oee).length) ? ld.oee : (ld.efficiency || {});
          this.laneData = {
            status: ld?.status?.code ?? 0,
            fault: ld?.fault ?? 'Unknown',
            machine: ld?.machine?.name ?? `Serial ${ld?.machine?.serial ?? this.machineSerial}`,
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
