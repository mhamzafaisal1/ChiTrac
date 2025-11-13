import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';

@Component({
    selector: 'app-machine-item-summary-table',
    imports: [CommonModule, FormsModule, BaseTableComponent, DateTimePickerComponent, MatButtonModule],
    templateUrl: './machine-item-summary-table.component.html',
    styleUrls: ['./machine-item-summary-table.component.scss']
})
export class MachineItemSummaryTableComponent implements OnInit {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() selectedMachineSerial: number | null = null;
  @Input() itemSummaryData: any = null;
  @Input() isModal: boolean = false;

  itemColumns: string[] = ['Item Name', 'Total Count', 'Worked Time', 'PPH', 'Standard', 'Efficiency'];
  itemRows: any[] = [];
  loading: boolean = false;
  isDarkTheme: boolean = false;

  constructor(private machineAnalyticsService: MachineAnalyticsService) {}

  ngOnInit(): void {
    if (!this.startTime || !this.endTime) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      this.startTime = startOfDay.toISOString();
      this.endTime = endOfDay.toISOString();
    }

    // Load parent-passed summary
    if (this.itemSummaryData) {
      console.log('Received itemSummaryData:', this.itemSummaryData);
      this.itemRows = this.transformItemSummary(this.itemSummaryData);
    }
  }

  fetchItemSummaryData(): void {
    if (!this.startTime || !this.endTime || !this.selectedMachineSerial) return;

    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.loading = true;
    this.machineAnalyticsService.getMachineItemSummary(formattedStart, formattedEnd, this.selectedMachineSerial).subscribe({
      next: (data: any[]) => {
        const matched = data.find(machine => machine.machine?.serial === this.selectedMachineSerial);
        const summary = matched?.machineSummary?.itemSummaries;
        this.itemRows = summary ? this.transformItemSummary(summary) : [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Error fetching item summary:', err);
        this.loading = false;
      }
    });
  }

  private transformItemSummary(summary: any): any[] {
    if (!summary || typeof summary !== 'object') {
      console.log('Invalid summary data:', summary);
      return [];
    }

    return Object.values(summary).map((item: any) => {
      // Backend returns countTotal (not count) and workedTimeFormatted (already formatted)
      // Handle both structures for backward compatibility
      const count = item.countTotal ?? item.count ?? 0;
      
      // Worked time can come as formatted object or as milliseconds
      let workedTimeStr = '';
      if (item.workedTimeFormatted) {
        // Already formatted object from backend: { hours: 0, minutes: 6 }
        const hours = item.workedTimeFormatted.hours ?? 0;
        const minutes = item.workedTimeFormatted.minutes ?? 0;
        workedTimeStr = `${hours}h ${minutes}m`;
      } else if (item.workedTimeMs) {
        // Raw milliseconds - convert to hours/minutes
        const hours = Math.floor(item.workedTimeMs / (1000 * 60 * 60));
        const minutes = Math.floor((item.workedTimeMs % (1000 * 60 * 60)) / (1000 * 60));
        workedTimeStr = `${hours}h ${minutes}m`;
      } else {
        workedTimeStr = '0h 0m';
      }
      
      // Efficiency is already a percentage from backend (e.g., 59.1), not a decimal
      // Handle both formats for backward compatibility
      let efficiencyPercentage = 0;
      if (item.efficiency !== undefined) {
        // If efficiency >= 1, it's already a percentage (e.g., 59.1)
        // If efficiency < 1, it's a decimal (e.g., 0.591)
        efficiencyPercentage = item.efficiency >= 1 
          ? Math.round(item.efficiency * 100) / 100 
          : Math.round(item.efficiency * 100 * 100) / 100;
      }
      
      return {
        'Item Name': item.name || 'Unknown',
        'Total Count': count,
        'Worked Time': workedTimeStr,
        'PPH': item.pph ?? 0,
        'Standard': item.standard ?? 0,
        'Efficiency': `${efficiencyPercentage}%`
      };
    });
  }

  getEfficiencyClass(value: any, column: string): string {
    if ((column === 'Efficiency') && typeof value === 'string' && value.includes('%')) {
      const num = parseFloat(value.replace('%', ''));
      if (isNaN(num)) return '';
      if (num >= 90) return 'green';
      if (num >= 70) return 'yellow';
      return 'red';
    }
    return '';
  }
}

