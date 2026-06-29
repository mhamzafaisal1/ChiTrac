import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { displayInteger } from '../shared/utils/display-number';

interface ItemSummaryRow {
  machineName?: string;
  itemName: string;
  workedTimeFormatted?: {
    hours: number;
    minutes: number;
  };
  count: number;
  misfeed: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
    selector: 'app-operator-item-summary-table',
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        BaseTableComponent
    ],
    templateUrl: './operator-item-summary-table.component.html',
    styleUrls: ['./operator-item-summary-table.component.scss']
})
export class OperatorItemSummaryTableComponent implements OnInit, OnChanges {
  @Input() startTime: string = '';
  @Input() endTime: string = '';
  @Input() operatorId?: number;
  @Input() isModal: boolean = false;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';
  @Input() dashboardData?: any[]; // For receiving data from dashboard

  itemColumns: string[] = ['Machine', 'Item', 'Worked Time', 'Count', 'Misfeed', 'PPH', 'Standard', 'Efficiency'];
  itemRows: any[] = [];
  loading: boolean = false;
  isDarkTheme: boolean = false;

  constructor(private percentBreakpointService: PercentBreakpointService) {}

  ngOnInit(): void {
    // Standalone API-driven mode removed; component now relies on dashboardData when used
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.mode === 'dashboard' && changes['dashboardData']?.currentValue) {
      this.processDashboardData(changes['dashboardData'].currentValue);
    }
  }

  private processDashboardData(data: any[]): void {
    this.loading = true;
    try {
      // Extract itemSummary from the dashboard data
      const itemSummary = data.find(item => item.operator?.id === this.operatorId)?.itemSummary || [];
      
      this.itemRows = itemSummary.map((row: ItemSummaryRow) => ({
        'Machine': row.machineName || 'N/A',
        'Item': row.itemName,
        'Worked Time': `${row.workedTimeFormatted?.hours || 0}h ${row.workedTimeFormatted?.minutes || 0}m`,
        'Count': row.count || 0,
        'Misfeed': row.misfeed || 0,
        'PPH': displayInteger(row.pph),
        'Standard': displayInteger(row.standard),
        'Efficiency': `${row.efficiency || 0}%`
      }));
    } catch (error) {
      console.error('Error processing dashboard data:', error);
    } finally {
      this.loading = false;
    }
  }

  getEfficiencyClass = (value: any, column: string): string => {
    if ((column === 'Efficiency') && typeof value === 'string' && value.includes('%')) {
      return this.percentBreakpointService.getColorClass(value);
    }
    return '';
  };
}
