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
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';

interface ItemSummary {
  itemName: string;
  workedTimeFormatted: { hours: number; minutes: number };
  count: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
    selector: 'app-item-report',
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
    templateUrl: './item-report.component.html',
    styleUrls: ['./item-report.component.scss']
})
export class ItemReportComponent implements OnInit, OnDestroy {
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
    this.isDownloadingCsv = false;

    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.analyticsService.getItemSessionSummary(formattedStart, formattedEnd).subscribe({
      next: (data: ItemSummary[]) => {
        const formattedData = data.map(item => ({
          'Item Name': item.itemName,
          'Worked Time': `${item.workedTimeFormatted.hours}h ${item.workedTimeFormatted.minutes}m`,
          'Count Total': item.count,
          'PPH': item.pph,
          'Standard': item.standard,
          'Efficiency': `${item.efficiency}%`
        }));

        this.columns = Object.keys(formattedData[0]);
        this.rows = formattedData;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching item data:', error);
        this.isLoading = false;
      }
    });
  }

  downloadItemSummaryPdf(): void {
    if (!this.rows.length) return;

    this.isLoading = true;
    this.isDownloading = true;

    setTimeout(() => {
      try {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('ITEM SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${this.startTime} to ${this.endTime}`, 14, 23);

        const head = [['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency']];
        const body = this.rows.map(row => [
          row['Item Name'],
          row['Worked Time'],
          row['Count Total'],
          row['PPH'],
          row['Standard'],
          row['Efficiency']
        ]);

        autoTable(doc, {
          head,
          body,
          startY: 30,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [52, 73, 94], textColor: 255 },
          columnStyles: {
            0: { cellWidth: 50 }, // Item Name column wider
            1: { cellWidth: 25 }, // Worked Time
            2: { cellWidth: 20 }, // Count Total
            3: { cellWidth: 20 }, // PPH
            4: { cellWidth: 20 }, // Standard
            5: { cellWidth: 20 }  // Efficiency
          }
        });

        doc.save('item_summary_report.pdf');
      } catch (error) {
        console.error('Error generating PDF:', error);
      } finally {
        setTimeout(() => {
          this.isLoading = false;
          this.isDownloading = false;
        }, 500);
      }
    }, 100);
  }

  downloadItemSummaryCsv(): void {
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
        link.setAttribute('download', `item_report_${this.startTime}_${this.endTime}.csv`);
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
