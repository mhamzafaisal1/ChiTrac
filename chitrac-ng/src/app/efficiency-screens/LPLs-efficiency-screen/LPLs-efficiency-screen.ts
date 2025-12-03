import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-lpls-efficiency-screen',
  templateUrl: './LPLs-efficiency-screen.html',
  styleUrls: ['./LPLs-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class LPLsEfficiencyScreenComponent {
  // Hardcoded sample data for 6 lanes
  lanes = [
    // Lane 1: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'Sarah Johnson',
      operatorId: 135820,
      machine: 'Large Piece Line 1',
      timers: { on: 4800, ready: 450 },
      displayTimers: { on: '01:20:00', run: '00:07:30' },
      efficiency: {
        lastSixMinutes: { value: 95, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 92, label: '15 mins', color: '#008000' },
        lastHour: { value: 89, label: '1 hr', color: '#008000' },
        today: { value: 87, label: 'Today', color: '#008000' }
      },
      batch: {
        item: 'King Sheets',
        customer: 'Marriott Hotel',
        code: 65520
      }
    },
    // Lane 2: Running without operator (greyed)
    {
      status: 1,
      fault: 'Run',
      operator: null,
      operatorId: null,
      machine: 'Large Piece Line 2',
      timers: { on: 2700, ready: 200 },
      displayTimers: { on: '00:45:00', run: '00:03:20' },
      efficiency: {
        lastSixMinutes: { value: 72, label: 'Current', color: '#555' },
        lastFifteenMinutes: { value: 68, label: '15 mins', color: '#555' },
        lastHour: { value: 65, label: '1 hr', color: '#555' },
        today: { value: 62, label: 'Today', color: '#555' }
      },
      batch: {
        item: 'Queen Sheets',
        customer: 'Marriott Hotel',
        code: 65521
      }
    },
    // Lane 3: Stopped
    {
      status: -1,
      fault: 'STOPPED',
      operator: 'Michael Brown',
      operatorId: 135805,
      machine: 'Large Piece Line 3',
      timers: { on: 9000, ready: 0 },
      displayTimers: { on: '02:30:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#FF0000' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#FF0000' },
        lastHour: { value: 0, label: '1 hr', color: '#FF0000' },
        today: { value: 0, label: 'Today', color: '#FF0000' }
      },
      batch: {
        item: 'Duvet Covers',
        customer: 'Hilton Chicago',
        code: 60650
      }
    },
    // Lane 4: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'Thomas Lee',
      operatorId: 135821,
      machine: 'Large Piece Line 4',
      timers: { on: 3900, ready: 380 },
      displayTimers: { on: '01:05:00', run: '00:06:20' },
      efficiency: {
        lastSixMinutes: { value: 91, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 88, label: '15 mins', color: '#008000' },
        lastHour: { value: 86, label: '1 hr', color: '#008000' },
        today: { value: 83, label: 'Today', color: '#008000' }
      },
      batch: {
        item: 'Pillowcases',
        customer: 'Hilton Chicago',
        code: 60651
      }
    },
    // Lane 5: Stopped
    {
      status: -1,
      fault: 'STOPPED',
      operator: 'David Miller',
      operatorId: 135822,
      machine: 'Large Piece Line 5',
      timers: { on: 10800, ready: 0 },
      displayTimers: { on: '03:00:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#FF0000' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#FF0000' },
        lastHour: { value: 0, label: '1 hr', color: '#FF0000' },
        today: { value: 0, label: 'Today', color: '#FF0000' }
      },
      batch: {
        item: 'Comforters',
        customer: 'Marriott Hotel',
        code: 60652
      }
    },
    // Lane 6: Fault
    {
      status: 25,
      fault: 'SENSOR ERROR',
      operator: 'Emma Davis',
      operatorId: 135799,
      machine: 'Large Piece Line 6',
      timers: { on: 6300, ready: 0 },
      displayTimers: { on: '01:45:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#F89406' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#F89406' },
        lastHour: { value: 0, label: '1 hr', color: '#F89406' },
        today: { value: 0, label: 'Today', color: '#F89406' }
      },
      batch: {
        item: 'Curtains',
        customer: 'Marriott Hotel',
        code: 60653
      }
    }
  ];
}

