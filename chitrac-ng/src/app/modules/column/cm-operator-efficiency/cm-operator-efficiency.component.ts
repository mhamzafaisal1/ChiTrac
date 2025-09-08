import { Component, OnInit, OnDestroy, OnChanges, Input, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../../services/efficiency-screens.service';
import { BlanketBlasterModule } from '../../../blanket-blaster/blanket-blaster.module';
import { timer, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'cm-operator-efficiency',
  templateUrl: './cm-operator-efficiency.component.html',
  styleUrls: ['./cm-operator-efficiency.component.scss'],
  imports: [CommonModule, BlanketBlasterModule],
  standalone: true
})
export class CmOperatorEfficiencyComponent implements OnInit, OnDestroy, OnChanges {
  
  @Input() operatorId: string | number = '';
  @Input() machineSerial: number = 0;
  
  laneData: any = null;
  loading: boolean = true;
  error: string = '';
  
  private pollSub?: Subscription;
  private readonly POLL_INTERVAL = 6000;

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    if (this.operatorId && this.machineSerial) {
      this.startPolling();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['operatorId'] || changes['machineSerial']) {
      if (this.operatorId && this.machineSerial) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    }
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.loading = true;
    this.error = '';
    this.pollSub = timer(0, this.POLL_INTERVAL)
      .pipe(
        switchMap(() => this.efficiencyService.getLiveEfficiencySummary(
          this.machineSerial,
          new Date().toISOString()
        ))
      )
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.error = '';
          const lanes = res?.flipperData ?? [];
          this.laneData = lanes.find((lane: any) =>
            (String(lane.operatorId) === String(this.operatorId) || String(lane.operator) === String(this.operatorId)) &&
            (lane.serial === this.machineSerial || res?.serial === this.machineSerial)
          ) ?? null;
        },
        error: (err) => {
          this.loading = false;
          this.error = 'Failed to load data';
          console.error('Polling error:', err);
        }
      });
  }

  private stopPolling() {
    this.pollSub?.unsubscribe();
  }

  // Helper methods for template
  get isRunning(): boolean {
    return this.laneData?.status === 1;
  }

  get isRunningWithOperator(): boolean {
    return this.isRunning && this.laneData?.operator != null;
  }

  get isRunningWithoutOperator(): boolean {
    return this.isRunning && this.laneData?.operator == null;
  }

  get isFault(): boolean {
    return this.laneData?.status > 1;
  }

  get isStop(): boolean {
    return this.laneData?.status === 0 || this.laneData?.status === -1;
  }

  get efficiencyColor(): string {
    return this.laneData?.efficiency?.lastSixMinutes?.color || 'white';
  }
}