import { Component, OnInit, OnDestroy, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EfficiencyScreensService } from '../../../services/efficiency-screens.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { ColumnLayoutComponent } from '../../../layouts/column/column-layout/column-layout.component';
import { CmOperatorEfficiencyComponent } from '../cm-operator-efficiency/cm-operator-efficiency.component';

type ColumnModuleDef = { component: Type<any>; inputs?: Record<string, any> };

@Component({
  selector: 'cm-operator-efficiency-test',
  templateUrl: './cm-operator-efficiency-test.component.html',
  styleUrls: ['./cm-operator-efficiency-test.component.scss'],
  imports: [
    CommonModule,
    ColumnLayoutComponent
  ],
  standalone: true
})
export class CmOperatorEfficiencyTestComponent implements OnInit, OnDestroy {
  
  columnModules: ColumnModuleDef[] = [];
  loading: boolean = true;
  error: string = '';
  
  private destroy$ = new Subject<void>();
  private readonly POLL_INTERVAL = 6000;
  private readonly SPL1_MACHINE_SERIAL = 90011;

  constructor(private efficiencyService: EfficiencyScreensService) {}

  ngOnInit() {
    this.startPolling();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startPolling() {
    timer(0, this.POLL_INTERVAL)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.efficiencyService.getLiveEfficiencySummary(this.SPL1_MACHINE_SERIAL, new Date().toISOString()))
      )
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.error = '';
          
          // Get all lanes from the API response and filter for operators
          const lanes = (res?.flipperData ?? []).filter((l: any) => l.operatorId || l.operator);
          
          // Take exactly four operators (or deterministically sort if more than 4)
          const ops = lanes
            .sort((a: any, b: any) => {
              // Sort by operator name for consistent ordering
              const nameA = a.operatorId ?? a.operator ?? '';
              const nameB = b.operatorId ?? b.operator ?? '';
              return nameA.localeCompare(nameB);
            })
            .slice(0, 4)
            .map((l: any) => ({
              operatorId: l.operatorId ?? l.operator,
              machineSerial: this.SPL1_MACHINE_SERIAL
            }));

          this.buildColumnModules(ops);
        },
        error: (err) => {
          this.loading = false;
          this.error = 'Failed to load data';
          console.error('Polling error:', err);
          
          // Fallback to mock data on error
          const mockOps = [
            { operatorId: 'John Smith', machineSerial: this.SPL1_MACHINE_SERIAL },
            { operatorId: 'Sarah Johnson', machineSerial: this.SPL1_MACHINE_SERIAL },
            { operatorId: 'Mike Wilson', machineSerial: this.SPL1_MACHINE_SERIAL },
            { operatorId: 'Lisa Brown', machineSerial: this.SPL1_MACHINE_SERIAL }
          ];
          this.buildColumnModules(mockOps);
        }
      });
  }

  private buildColumnModules(ops: Array<{ operatorId: string | number; machineSerial: number }>) {
    this.columnModules = ops.map(op => ({
      component: CmOperatorEfficiencyComponent,
      inputs: { 
        operatorId: String(op.operatorId), 
        machineSerial: op.machineSerial 
      }
    }));
  }

}