import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-spfs-efficiency-screen',
  templateUrl: './SPFs-efficiency-screen.html',
  styleUrls: ['./SPFs-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class SPFsEfficiencyScreenComponent {
  // Hardcoded sample data for 6 lanes (SPF1-SPF6)
  lanes = [
    // Lane 1: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'Alice Martinez',
      operatorId: 135830,
      machine: 'SPF1',
      timers: { on: 3600, ready: 300 },
      displayTimers: { on: '01:00:00', run: '00:05:00' },
      efficiency: {
        lastSixMinutes: { value: 94, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 91, label: '15 mins', color: '#008000' },
        lastHour: { value: 88, label: '1 hr', color: '#008000' },
        today: { value: 85, label: 'Today', color: '#008000' }
      },
      batch: {
        item: 'Napkins',
        customer: 'Hilton Chicago',
        code: 65522
      }
    },
    // Lane 2: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'Robert Taylor',
      operatorId: 135831,
      machine: 'SPF2',
      timers: { on: 4200, ready: 350 },
      displayTimers: { on: '01:10:00', run: '00:05:50' },
      efficiency: {
        lastSixMinutes: { value: 89, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 87, label: '15 mins', color: '#008000' },
        lastHour: { value: 84, label: '1 hr', color: '#008000' },
        today: { value: 81, label: 'Today', color: '#F89406' }
      },
      batch: {
        item: 'Placemats',
        customer: 'Marriott Hotel',
        code: 65523
      }
    },
    // Lane 3: Running without operator (greyed)
    {
      status: 1,
      fault: 'Run',
      operator: null,
      operatorId: null,
      machine: 'SPF3',
      timers: { on: 1800, ready: 150 },
      displayTimers: { on: '00:30:00', run: '00:02:30' },
      efficiency: {
        lastSixMinutes: { value: 58, label: 'Current', color: '#555' },
        lastFifteenMinutes: { value: 62, label: '15 mins', color: '#555' },
        lastHour: { value: 60, label: '1 hr', color: '#555' },
        today: { value: 55, label: 'Today', color: '#555' }
      },
      batch: {
        item: 'Tablecloths',
        customer: 'Hilton Chicago',
        code: 65524
      }
    },
    // Lane 4: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'Patricia Anderson',
      operatorId: 135832,
      machine: 'SPF4',
      timers: { on: 5400, ready: 480 },
      displayTimers: { on: '01:30:00', run: '00:08:00' },
      efficiency: {
        lastSixMinutes: { value: 96, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 93, label: '15 mins', color: '#008000' },
        lastHour: { value: 90, label: '1 hr', color: '#008000' },
        today: { value: 88, label: 'Today', color: '#008000' }
      },
      batch: {
        item: 'Runners',
        customer: 'Marriott Hotel',
        code: 65525
      }
    },
    // Lane 5: Stopped
    {
      status: -1,
      fault: 'STOPPED',
      operator: 'James Wilson',
      operatorId: 135833,
      machine: 'SPF5',
      timers: { on: 7200, ready: 0 },
      displayTimers: { on: '02:00:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#FF0000' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#FF0000' },
        lastHour: { value: 0, label: '1 hr', color: '#FF0000' },
        today: { value: 0, label: 'Today', color: '#FF0000' }
      },
      batch: {
        item: 'Aprons',
        customer: 'Hilton Chicago',
        code: 60652
      }
    },
    // Lane 6: Fault
    {
      status: 22,
      fault: 'MOTOR FAULT',
      operator: 'Linda Garcia',
      operatorId: 135834,
      machine: 'SPF6',
      timers: { on: 4500, ready: 0 },
      displayTimers: { on: '01:15:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#F89406' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#F89406' },
        lastHour: { value: 0, label: '1 hr', color: '#F89406' },
        today: { value: 0, label: 'Today', color: '#F89406' }
      },
      batch: {
        item: 'Cloths',
        customer: 'Marriott Hotel',
        code: 60653
      }
    }
  ];
}

