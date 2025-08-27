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
import { OperatorSummaryService } from '../../services/operator-summary.service';
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
  private observer!: MutationObserver;

  constructor(
    private operatorSummaryService: OperatorSummaryService,
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

    this.operatorSummaryService.getOperatorSummary(formattedStart, formattedEnd).subscribe({
      next: (data: any[]) => {
        // Group by composite key
        const grouped = new Map<string, OperatorSummaryRow>();

        for (const row of data) {
          const key = `${row.operatorName}-${row.machineName}-${row.itemName}`;
          if (!grouped.has(key)) {
            grouped.set(key, { ...row });
          } else {
            const existing = grouped.get(key)!;
            existing.count += row.count;
            existing.misfeed += row.misfeed;
            existing.runtimeFormatted.hours += row.runtimeFormatted.hours;
            existing.runtimeFormatted.minutes += row.runtimeFormatted.minutes;
          }
        }

        // Normalize time overflow
        for (const summary of grouped.values()) {
          if (summary.runtimeFormatted.minutes >= 60) {
            summary.runtimeFormatted.hours += Math.floor(summary.runtimeFormatted.minutes / 60);
            summary.runtimeFormatted.minutes %= 60;
          }
          const totalMs = summary.runtimeFormatted.hours * 3600000 + summary.runtimeFormatted.minutes * 60000;
          const hours = totalMs / 3600000;
          summary.pph = hours > 0 ? Math.round((summary.count / hours) * 100) / 100 : 0;
          summary.efficiency = summary.standard > 0 ? Math.round((summary.pph / summary.standard) * 10000) / 100 : 0;
        }

        // Group again by operator to compute operator-wide totals
        const byOperator = new Map<string, OperatorSummaryRow[]>();
        for (const row of grouped.values()) {
          if (!byOperator.has(row.operatorName)) {
            byOperator.set(row.operatorName, []);
          }
          byOperator.get(row.operatorName)!.push(row);
        }

        const formattedData: any[] = [];

        for (const [operatorName, rows] of byOperator.entries()) {
          const operatorTotal = {
            count: 0,
            misfeed: 0,
            runtimeMs: 0
          };

          for (const row of rows) {
            operatorTotal.count += row.count;
            operatorTotal.misfeed += row.misfeed;
            operatorTotal.runtimeMs += row.runtimeFormatted.hours * 3600000 + row.runtimeFormatted.minutes * 60000;
          }

          const totalHours = operatorTotal.runtimeMs / 3600000;
          const pph = totalHours > 0 ? operatorTotal.count / totalHours : 0;

          const proratedStandard = rows.reduce((acc, row) => {
            const weight = operatorTotal.count > 0 ? row.count / operatorTotal.count : 0;
            return acc + (weight * row.standard);
          }, 0);

          const eff = proratedStandard > 0 ? pph / proratedStandard : 0;

          formattedData.push({
            'Operator': operatorName,
            'Machine': 'TOTAL',
            'Item': 'ALL ITEMS',
            'Time (Runtime)': `${Math.floor(operatorTotal.runtimeMs / 3600000)}h ${Math.floor((operatorTotal.runtimeMs % 3600000) / 60000)}m`,
            'Count': operatorTotal.count,
            'Misfeed': operatorTotal.misfeed,
            'PPH': Math.round(pph * 100) / 100,
            'Standard': Math.round(proratedStandard * 100) / 100,
            'Efficiency': `${Math.round(eff * 10000) / 100}%`
          });

          for (const row of rows) {
            formattedData.push({
              'Operator': '  ' + row.operatorName,
              'Machine': row.machineName,
              'Item': row.itemName,
              'Time (Runtime)': `${row.runtimeFormatted.hours}h ${row.runtimeFormatted.minutes}m`,
              'Count': row.count,
              'Misfeed': row.misfeed,
              'PPH': row.pph,
              'Standard': row.standard,
              'Efficiency': `${row.efficiency}%`
            });
          }
        }

        this.columns = Object.keys(formattedData[0]);
        this.rows = formattedData;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching operator data:', error);
        this.isLoading = false;
      }
    });
  }

  downloadOperatorSummaryPdf(): void {
    if (!this.rows.length) return;

    this.isLoading = true;
    this.isDownloading = true;

    setTimeout(() => {
      try {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('OPERATOR SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${this.startTime} to ${this.endTime}`, 14, 23);

        const head = [['Operator', 'Machine', 'Item', 'Time (Runtime)', 'Count', 'Misfeed', 'PPH', 'Standard', 'Efficiency']];
        const body = this.rows.map(row => [
          row['Operator'],
          row['Machine'],
          row['Item'],
          row['Worked Time'],
          row['Count'],
          row['Misfeed'],
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
            0: { cellWidth: 30 },
            1: { cellWidth: 25 },
            2: { cellWidth: 30 }
          }
        });

        doc.save('operator_summary_report.pdf');
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
