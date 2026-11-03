import { Component, OnInit, OnDestroy, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ColumnLayoutComponent } from '../../layouts/column/column-layout/column-layout.component';
import { CmOperatorEfficiencyComponent } from '../../modules/column/cm-operator-efficiency/cm-operator-efficiency.component';

type ColumnModuleDef = { component: Type<any>; inputs?: Record<string, any> };

@Component({
  selector: 'spf-col-efficiency-screen',
  templateUrl: './spf-col-efficiency-screen.component.html',
  styleUrls: ['./spf-col-efficiency-screen.component.scss'],
  imports: [
    CommonModule,
    ColumnLayoutComponent
  ],
  standalone: true
})
export class SpfColEfficiencyScreenComponent implements OnInit, OnDestroy {
  
  columnModules: ColumnModuleDef[] = [];
  
  // SPF machine data - all 6 SPFs
  readonly SPF_MACHINES = [
    { serial: 68011, name: 'SPF1' }, // TODO: confirm serial from DB
    { serial: 68012, name: 'SPF2' },
    { serial: 68013, name: 'SPF3' },
    { serial: 68014, name: 'SPF4' },
    { serial: 68015, name: 'SPF5' },
    { serial: 68016, name: 'SPF6' }
  ];

  constructor() {}

  ngOnInit() {
    this.buildColumnModules();
  }

  ngOnDestroy() {
    // Components handle their own cleanup
  }

  private buildColumnModules() {
    this.columnModules = this.SPF_MACHINES.map(machine => ({
      component: CmOperatorEfficiencyComponent,
      inputs: { 
        station: 1, // Each SPF has only 1 lane/station
        machineSerial: machine.serial 
      }
    }));
  }
}
