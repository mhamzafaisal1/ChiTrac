import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { MachineAnalyticsService } from '../../services/machine-analytics.service';
import { MachineItemSummaryService } from '../../services/machine-item-summary.service';
import { DateTimePickerComponent } from '../../components/date-time-picker/date-time-picker.component';
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
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  private observer!: MutationObserver;

  constructor(
    private analyticsService: MachineAnalyticsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private machineItemSummaryService: MachineItemSummaryService
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

    this.machineItemSummaryService.getMachineItemSummary(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        const formattedData: any[] = [];

        data.forEach((machine: any) => {
          const summary = machine.machineSummary;

          // Add machine-wide summary
          formattedData.push({
            'Machine': machine.machine.name,
            'Item': 'TOTAL',
            'Total Time (Runtime)': `${summary.runtimeFormatted.hours}h ${summary.runtimeFormatted.minutes}m`,
            'Total Count': summary.totalCount,
            'PPH': summary.pph,
            'Standard': summary.proratedStandard,
            'Efficiency': `${summary.efficiency}%`
          });

          // Add item summaries under this machine
          Object.values(summary.itemSummaries).forEach((item: any) => {
            formattedData.push({
              'Machine': machine.machine.name,
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
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching machine item summary:', error);
        this.isLoading = false;
      }
    });
  }

  downloadMachineItemSummaryPdf(): void {
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = true;
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();
  
    this.machineItemSummaryService.getMachineItemSummary(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('MACHINE ITEM SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${this.startTime} to ${this.endTime}`, 14, 23);
  
        const head = [['Machine/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
        const body: any[] = [];
  
        data.forEach((machine: any) => {
          const summary = machine.machineSummary;
  
          // Add machine-wide summary
          body.push([
            {
              content: machine.machine.name,
              styles: {
                fillColor: [200, 230, 255],
                textColor: 0,
                fontStyle: 'bold'
              }
            },
            `${summary.runtimeFormatted.hours}h ${summary.runtimeFormatted.minutes}m`,
            summary.totalCount,
            summary.pph,
            summary.proratedStandard,
            `${summary.efficiency}%`
          ]);
  
          // Add item summaries under this machine
          Object.values(summary.itemSummaries).forEach((item: any) => {
            body.push([
              '  ' + item.name, // indented
              `${item.workedTimeFormatted.hours}h ${item.workedTimeFormatted.minutes}m`,
              item.countTotal,
              item.pph,
              item.standard,
              `${item.efficiency}%`
            ]);
          });
        });
  
        autoTable(doc, {
          head,
          body,
          startY: 30,
          styles: {
            fontSize: 8,
          },
          theme: 'striped',
          headStyles: {
            fillColor: [22, 160, 133],
            textColor: 255,
          },
          columnStyles: {
            0: { cellWidth: 50 },
          },
        });
  
        doc.save('machine_item_summary_report.pdf');
        this.isLoading = false;
        this.isDownloading = false;
      },
      error: (err) => {
        console.error('Error fetching summary data:', err);
        this.isLoading = false;
        this.isDownloading = false;
      }
    });
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
        for (const row of this.rows) {
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
}