import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlanketBlasterModule } from '../../../blanket-blaster/blanket-blaster.module';
import { CmOperatorEfficiencyComponent } from '../../../modules/column/cm-operator-efficiency/cm-operator-efficiency.component';

@Component({
  selector: 'ct-column-layout',
  templateUrl: './column-layout.component.html',
  styleUrls: ['./column-layout.component.scss'],
  imports: [
    CommonModule,
    BlanketBlasterModule,
    CmOperatorEfficiencyComponent
  ],
  standalone: true
})
export class ColumnLayoutComponent implements OnInit {
  
  @Input() columnModules: any[] = [];

  // Dummy data for testing when no column modules are provided
  dummyColumnModules: any[] = [];

  constructor() { }

  ngOnInit() {
    // Generate dummy data if no column modules are provided
    if (this.columnModules.length === 0) {
      this.generateDummyData();
    }
  }

  private generateDummyData() {
    // Generate 8 dummy lane objects to test responsive behavior
    const dummyLanes = [
      {
        status: 2,
        operator: 'John Smith',
        fault: 'MOTOR OVERHEAT',
        machine: 'Machine A-001',
        batch: {
          item: 'Widget Type 1',
        },
        displayTimers: {
          on: '02:15:30'
        }
      },
      {
        status: 3,
        operator: 'Sarah Johnson',
        fault: 'SENSOR FAILURE',
        machine: 'Machine B-002',
        batch: {
          item: 'Widget Type 2',
        },
        displayTimers: {
          on: '01:45:12'
        }
      },
      {
        status: 2,
        operator: 'Mike Wilson',
        fault: 'BELT MISALIGNMENT',
        machine: 'Machine C-003',
        batch: {
          item: 'Widget Type 3',
        },
        displayTimers: {
          on: '03:22:45'
        }
      },
      {
        status: 4,
        operator: 'Lisa Brown',
        fault: 'POWER SUPPLY',
        machine: 'Machine D-004',
        batch: {
          item: 'Widget Type 4',
        },
        displayTimers: {
          on: '00:58:33'
        }
      },
      {
        status: 2,
        operator: 'David Lee',
        fault: 'CONVEYOR STOP',
        machine: 'Machine E-005',
        batch: {
          item: 'Widget Type 5',
        },
        displayTimers: {
          on: '01:12:18'
        }
      },
      {
        status: 3,
        operator: 'Emma Davis',
        fault: 'TEMPERATURE HIGH',
        machine: 'Machine F-006',
        batch: {
          item: 'Widget Type 6',
        },
        displayTimers: {
          on: '02:33:07'
        }
      },
      {
        status: 2,
        operator: 'Tom Anderson',
        fault: 'VALVE STUCK',
        machine: 'Machine G-007',
        batch: {
          item: 'Widget Type 7',
        },
        displayTimers: {
          on: '01:55:42'
        }
      },
      {
        status: 5,
        operator: 'Rachel Green',
        fault: 'SYSTEM ERROR',
        machine: 'Machine H-008',
        batch: {
          item: 'Widget Type 8',
        },
        displayTimers: {
          on: '04:11:29'
        }
      }
    ];

    this.dummyColumnModules = dummyLanes;
  }

  get columnsToDisplay() {
    return this.columnModules.length > 0 ? this.columnModules : this.dummyColumnModules;
  }

  trackByIndex(index: number, item: any): number {
    return index;
  }
}
