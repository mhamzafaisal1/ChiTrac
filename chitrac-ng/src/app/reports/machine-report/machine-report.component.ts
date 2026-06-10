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
import { ReportsService } from '../../services/reports.service';
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';
import { getStatusDotByCode } from '../../../utils/status-utils';

@Component({
    selector: 'app-machine-report',
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
    templateUrl: './machine-report.component.html',
    styleUrls: ['./machine-report.component.scss'] // ❗️Use plural: styleUrls
})

export class MachineReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  columns: string[] = [];
  rows: any[] = [];
  columnTooltips: { [column: string]: string } = {
    'Total Time (Runtime)': 'Amount of time machine has been running',
    'Total Count': 'Amount of pieces fed into the machine/line.',
    'PPH': 'Pieces Per Hour',
    'Standard': 'Pieces Per Hour Goal',
    'Efficiency': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  isEmailing: boolean = false;
  showSummaryOnly: boolean = false;
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    if (this.showSummaryOnly) {
      return this.rows.filter(row => row['Item'] === 'Total');
    }
    return this.rows;
  }

  constructor(
    private reportsService: ReportsService,
    private renderer: Renderer2,
    private elRef: ElementRef
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
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    // Fetch the machine report for the table
    this.reportsService.getMachineReport(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        const results = data?.results ?? (Array.isArray(data) ? data : []);
        this.processTableData(results);
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching machine report:', error);
        this.isLoading = false;
      }
    });
  }

  private processTableData(results: any[]): void {
    const formattedData: any[] = [];

    if (!results || !Array.isArray(results)) {
      this.columns = ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
      this.rows = [];
      return;
    }

    results.forEach((machine: any) => {
      const summary = machine.machineSummary;
      if (!summary) return;

      const itemSummaries = summary.itemSummaries;
      const items = itemSummaries != null
        ? Object.entries(itemSummaries).map(([itemId, item]: [string, any]) => ({ ...item, itemId }))
        : [];

      const totalItem = items.find((item: any) => item.name === 'Total');
      const otherItems = items.filter((item: any) => item.name !== 'Total');
      const sortedItems = totalItem ? [totalItem, ...otherItems] : items;

      sortedItems.forEach((item: any) => {
        const wt = item.workedTimeFormatted;
        const hours = wt != null && typeof wt.hours === 'number' ? wt.hours : 0;
        const minutes = wt != null && typeof wt.minutes === 'number' ? wt.minutes : 0;

        formattedData.push({
          'Machine': machine.machine?.name ?? '',
          'Item': item.name ?? '',
          'Total Time (Runtime)': `${hours}h ${minutes}m`,
          'Total Count': item.countTotal ?? 0,
          'PPH': item.pph ?? 0,
          'Standard': item.standard != null ? Number(item.standard).toFixed(2) : '',
          'Efficiency': item.efficiency != null ? `${item.efficiency}%` : '',
          '_tooltipMachineSerial': machine.machine?.serial ?? '',
          '_tooltipItemId': item.name === 'Total' ? '' : item.itemId
        });
      });
    });

    this.columns = ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
    this.rows = formattedData;
  }

  getCellTooltip(row: any, column: string): string {
    if (column === 'Machine' && row?._tooltipMachineSerial != null && row._tooltipMachineSerial !== '') {
      return `Serial: ${row._tooltipMachineSerial}`;
    }
    if (column === 'Item' && row?._tooltipItemId != null && row._tooltipItemId !== '') {
      return `Item ID: ${row._tooltipItemId}`;
    }
    return '';
  }

  getEfficiencyClass(value: any, column: string): string {
    if (column === 'Efficiency' && typeof value === 'string' && value.includes('%')) {
      const num = parseInt(value.replace('%', ''));
      if (isNaN(num)) return '';
      if (num >= 90) return 'green';
      if (num >= 70) return 'yellow';
      return 'red';
    }
    return '';
  }

  async downloadMachineItemSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true;
    console.log('Starting PDF export...');

    try {
      const doc = this.buildMachineReportPdf();

      console.log('Saving PDF...');
      doc.save(`machine_report_${this.startTime}_${this.endTime}.pdf`);
      console.log('PDF export completed successfully');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  openEmailReportDialog(): void {
    if (!this.rows.length || !this.startTime || !this.endTime) return;

    const to = window.prompt('Enter recipient email address:');
    if (!to) return;

    this.isEmailing = true;

    try {
      const doc = this.buildMachineReportPdf();
      const dataUri = doc.output('datauristring');
      const pdfBase64 = dataUri.split(',')[1] ?? '';

      this.reportsService.emailMachineReport({
        to: to.trim(),
        pdfBase64,
        start: new Date(this.startTime).toISOString(),
        end: new Date(this.endTime).toISOString(),
        summaryOnly: this.showSummaryOnly
      }).subscribe({
        next: () => {
          window.alert('Machine report email sent successfully.');
          this.isEmailing = false;
        },
        error: (error) => {
          console.error('Error emailing machine report:', error);
          window.alert('Failed to send machine report email.');
          this.isEmailing = false;
        }
      });
    } catch (error) {
      console.error('Failed to generate PDF for email:', error);
      window.alert('Failed to prepare machine report email.');
      this.isEmailing = false;
    }
  }

  downloadMachineItemSummaryCsv(): void {
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
        link.setAttribute('download', `machine_report_${this.startTime}_${this.endTime}.csv`);
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

  private buildMachineReportPdf(): jsPDF {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const margin = 24;
    let y = margin;

    doc.setFontSize(14);
    doc.text('MACHINE REPORT', margin, y);
    y += 18;
    doc.setFontSize(10);
    doc.text(`Range: ${this.startTime} → ${this.endTime}`, margin, y);
    y += 24;

    const head = [['Machine/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
    const body = this.displayedRows.map(row => [
      `${row['Machine']} / ${row['Item']}`,
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

    return doc;
  }
}
