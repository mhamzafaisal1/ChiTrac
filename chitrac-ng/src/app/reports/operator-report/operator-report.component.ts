import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { OperatorSummaryService } from '../../services/operator-summary.service';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { DateTimePickerComponent } from '../../components/date-time-picker/date-time-picker.component';

interface OperatorSummaryRow {
  operatorName: string;
  machineName: string;
  itemName: string;
  runtimeFormatted: { hours: number; minutes: number };
  count: number;
  misfeed: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
    selector: 'app-operator-report',
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatSlideToggleModule,
        BaseTableComponent,
        DateTimePickerComponent
    ],
    templateUrl: './operator-report.component.html',
    styleUrls: ['./operator-report.component.scss']
})
export class OperatorReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  columns: string[] = [];
  rows: any[] = [];
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  showSummaryOnly: boolean = false;
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    if (this.showSummaryOnly) {
      return this.rows.filter(row => row['Item'] === 'TOTAL');
    }
    return this.rows;
  }

  constructor(
    private operatorSummaryService: OperatorSummaryService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private dailyDashboardService: DailyDashboardService
  ) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    this.endTime = this.formatDateForInput(end);
    this.startTime = this.formatDateForInput(start);

    this.detectTheme();

    this.observer = new MutationObserver(() => {
      this.detectTheme();
    });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;
  }

  fetchAnalyticsData(): void {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    // Fetch the detailed summary for the table
    this.dailyDashboardService.getOperatorItemSessionsSummary(formattedStart, formattedEnd).subscribe({
      next: (data: any) => {
        // Process table data from the results
        this.processTableData(data.results);
        
        this.isLoading = false;
      },
      error: (error: any) => {
        console.error('Error fetching operator item summary:', error);
        this.isLoading = false;
      }
    });
  }

  private processTableData(results: any[]): void {
    const formattedData: any[] = [];

    results.forEach((operator: any) => {
      const summary = operator.operatorSummary;

      // Add operator-wide summary
      formattedData.push({
        'Operator': operator.operator.name,
        'Item': 'TOTAL',
        'Total Time (Runtime)': `${summary.runtimeFormatted.hours}h ${summary.runtimeFormatted.minutes}m`,
        'Total Count': summary.totalCount,
        'PPH': summary.pph,
        'Standard': summary.proratedStandard,
        'Efficiency': `${summary.efficiency}%`
      });

      // Add item summaries under this operator
      Object.values(summary.itemSummaries).forEach((item: any) => {
        formattedData.push({
          'Operator': operator.operator.name,
          'Item': item.name,
          'Total Time (Runtime)': `${item.workedTimeFormatted.hours}h ${item.workedTimeFormatted.minutes}m`,
          'Total Count': item.countTotal,
          'PPH': item.pph,
          'Standard': item.standard,
          'Efficiency': `${item.efficiency}%`
        });
      });
    });

    this.columns = Object.keys(formattedData[0]);
    this.rows = formattedData;
  }

  async downloadOperatorSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true;
    console.log('Starting PDF export...');

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      doc.setFontSize(14);
      doc.text('OPERATOR REPORT', margin, y); 
      y += 18;
      doc.setFontSize(10);
      doc.text(`Range: ${this.startTime} → ${this.endTime}`, margin, y); 
      y += 24;

      const head = [['Operator/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
      const body = this.displayedRows.map(row => [
        `${row['Operator']} / ${row['Item']}`,
        row['Total Time (Runtime)'],
        row['Total Count'],
        row['PPH'],
        row['Standard'],
        row['Efficiency'],
      ]);

      console.log(`Adding table with ${body.length} rows`);
      autoTable(doc, {
        head, 
        body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255 },
        columnStyles: { 0: { cellWidth: 180 } },
        theme: 'striped'
      });

      console.log('Saving PDF...');
      doc.save(`operator_report_${this.startTime}_${this.endTime}.pdf`);
      console.log('PDF export completed successfully');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  downloadOperatorSummaryCsv(): void {
    if (!this.rows.length || !this.columns.length) return;
  
    this.isLoading = true;
    this.isDownloadingCsv = true;

    setTimeout(() => {
      try {
        const csvRows: string[] = [];
      
        // Header
        csvRows.push(this.columns.join(','));
      
        // Rows
        for (const row of this.displayedRows) {
          const rowData = this.columns.map(col => {
            const cell = row[col];
            return typeof cell === 'string' && cell.includes(',')
              ? `"${cell.replace(/"/g, '""')}"` // Escape double quotes
              : cell;
          });
          csvRows.push(rowData.join(','));
        }
      
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
      
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `operator_report_${this.startTime}_${this.endTime}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Error generating CSV:', error);
      } finally {
        setTimeout(() => {
          this.isLoading = false;
          this.isDownloadingCsv = false;
        }, 500);
      }
    }, 100);
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
