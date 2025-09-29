import { Component, OnInit, OnDestroy, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ColumnLayoutComponent } from '../../layouts/column/column-layout/column-layout.component';
import { CmOperatorEfficiencyComponent } from '../../modules/column/cm-operator-efficiency/cm-operator-efficiency.component';

type ColumnModuleDef = { component: Type<any>; inputs?: Record<string, any> };

@Component({
  selector: 'spl-col-efficiency-screen',
  templateUrl: './spl-col-efficiency-screen.component.html',
  styleUrls: ['./spl-col-efficiency-screen.component.scss'],
  imports: [
    CommonModule,
    ColumnLayoutComponent
  ],
  standalone: true
})
export class SplColEfficiencyScreenComponent implements OnInit, OnDestroy {
  
  columnModules: ColumnModuleDef[] = [];
  loading: boolean = true;
  error: string = '';
  
  readonly SPL1_MACHINE_SERIAL = 67800;
  private readonly STATIONS = [1, 2, 3, 4]; // SPL1 has 4 lanes/stations

  constructor() {}

  ngOnInit() {
    this.buildColumnModules();
  }

  ngOnDestroy() {
    // Components handle their own cleanup
  }

  private buildColumnModules() {
    this.columnModules = this.STATIONS.map(station => ({
      component: CmOperatorEfficiencyComponent,
      inputs: { 
        station: station, // Use station number for the new API
        machineSerial: this.SPL1_MACHINE_SERIAL 
      }
    }));
  }
}
