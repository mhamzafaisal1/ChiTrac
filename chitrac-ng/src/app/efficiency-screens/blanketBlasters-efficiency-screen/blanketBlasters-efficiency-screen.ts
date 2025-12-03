import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-blanket-blasters-efficiency-screen',
  templateUrl: './blanketBlasters-efficiency-screen.html',
  styleUrls: ['./blanketBlasters-efficiency-screen.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class BlanketBlastersEfficiencyScreenComponent {
  // Hardcoded sample data for 4 lanes
  lanes = [
    // Lane 1: Running with operator
    {
      status: 1,
      fault: 'Run',
      operator: 'John Smith',
      operatorId: 135796,
      machine: 'Blanket Blaster 1',
      timers: { on: 3600, ready: 300 },
      displayTimers: { on: '01:00:00', run: '00:05:00' },
      efficiency: {
        lastSixMinutes: { value: 92, label: 'Current', color: '#008000' },
        lastFifteenMinutes: { value: 88, label: '15 mins', color: '#008000' },
        lastHour: { value: 85, label: '1 hr', color: '#008000' },
        today: { value: 82, label: 'Today', color: '#F89406' }
      },
      batch: {
        item: 'Hotel Towels',
        customer: 'Hilton Chicago',
        code: 65518
      }
    },
    // Lane 2: Running without operator (greyed)
    {
      status: 1,
      fault: 'Run',
      operator: null,
      operatorId: null,
      machine: 'Blanket Blaster 2',
      timers: { on: 1800, ready: 150 },
      displayTimers: { on: '00:30:00', run: '00:02:30' },
      efficiency: {
        lastSixMinutes: { value: 64, label: 'Current', color: '#555' },
        lastFifteenMinutes: { value: 99.5, label: '15 mins', color: '#555' },
        lastHour: { value: 105, label: '1 hr', color: '#555' },
        today: { value: 50, label: 'Today', color: '#555' }
      },
      batch: {
        item: 'Gym Towels',
        customer: 'Hilton Chicago',
        code: 65519
      }
    },
    // Lane 3: Stopped
    {
      status: -1,
      fault: 'STOPPED',
      operator: 'Jeremy Jones',
      operatorId: 135804,
      machine: 'Blanket Blaster 3',
      timers: { on: 7200, ready: 0 },
      displayTimers: { on: '02:00:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#FF0000' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#FF0000' },
        lastHour: { value: 0, label: '1 hr', color: '#FF0000' },
        today: { value: 0, label: 'Today', color: '#FF0000' }
      },
      batch: {
        item: 'Bath Blankets',
        customer: 'Hilton Chicago',
        code: 60647
      }
    },
    // Lane 4: Fault
    {
      status: 30,
      fault: 'JAM @ PRIMARY',
      operator: 'Jake Carpenter',
      operatorId: 135798,
      machine: 'Blanket Blaster 4',
      timers: { on: 5400, ready: 0 },
      displayTimers: { on: '01:30:00', run: '' },
      efficiency: {
        lastSixMinutes: { value: 0, label: 'Current', color: '#F89406' },
        lastFifteenMinutes: { value: 0, label: '15 mins', color: '#F89406' },
        lastHour: { value: 0, label: '1 hr', color: '#F89406' },
        today: { value: 0, label: 'Today', color: '#F89406' }
      },
      batch: {
        item: 'Hand Towels',
        customer: 'Hilton Chicago',
        code: 60648
      }
    }
  ];
}
