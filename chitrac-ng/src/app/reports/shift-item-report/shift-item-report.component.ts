import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { MachineAnalyticsService } from '../../services/machine-analytics.service';
import { ShiftListItem, ShiftService } from '../../services/shift.service';

interface ItemSummary {
  itemName: string;
  workedTimeFormatted: { hours: number; minutes: number };
  count: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
  selector: 'app-shift-item-report',
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    BaseTableComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './shift-item-report.component.html',
  styleUrls: ['./shift-item-report.component.scss'],
})
export class ShiftItemReportComponent implements OnInit, OnDestroy {
  startDate: Date | null = null;
  endDate: Date | null = null;
  shifts: ShiftListItem[] = [];
  selectedShiftId: string | null = null;
  selectedShift: ShiftListItem | null = null;
  columns: string[] = [];
  rows: any[] = [];
  isDarkTheme = false;
  isLoading = false;
  isDownloading = false;
  isDownloadingCsv = false;
  shiftsLoadError: string | null = null;
  private observer!: MutationObserver;

  constructor(
    private analyticsService: MachineAnalyticsService,
    private shiftService: ShiftService
  ) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startDate = start;
    this.endDate = end;

    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    this.shiftService.getActiveShifts().subscribe({
      next: (res) => {
        this.shifts = res.shifts || [];
        this.shiftsLoadError = null;
      },
      error: () => {
        this.shiftsLoadError = 'Could not load shifts';
        this.shifts = [];
      },
    });
  }

  ngOnDestroy() {
    if (this.observer) this.observer.disconnect();
  }

  detectTheme() {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  onShiftChange(): void {
    this.selectedShift = this.shifts.find((s) => s._id === this.selectedShiftId) ?? null;
  }

  fetchAnalyticsData(): void {
    if (!this.startDate || !this.endDate || !this.selectedShiftId) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;

    const formattedStart = this.toQueryStartIso(this.startDate);
    const formattedEnd = this.toQueryEndIso(this.endDate);

    this.analyticsService.getItemSessionSummary(formattedStart, formattedEnd, this.selectedShiftId).subscribe({
      next: (data: ItemSummary[]) => {
        const formattedData = (data || []).map((item) => ({
          'Item Name': item.itemName,
          'Worked Time': `${item.workedTimeFormatted.hours}h ${item.workedTimeFormatted.minutes}m`,
          'Count Total': item.count,
          PPH: item.pph,
          Standard: item.standard,
          Efficiency: `${item.efficiency}%`,
        }));

        this.columns = formattedData.length
          ? Object.keys(formattedData[0])
          : ['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency'];
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
    if (!this.rows.length || !this.startDate || !this.endDate || !this.selectedShiftId) return;

    this.isLoading = true;
    this.isDownloading = true;

    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const shiftLabel = this.selectedShift?.name ?? this.selectedShiftId;
        doc.setFontSize(14);
        doc.text('SHIFT ITEM SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Shift: ${shiftLabel}`, 14, 23);
        doc.text(`Date Range: ${this.formatDateOnly(this.startDate)} to ${this.formatDateOnly(this.endDate)}`, 14, 31);

        const head = [['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency']];
        const body = this.rows.map((row) => [
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
          startY: 38,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [52, 73, 94], textColor: 255 },
          columnStyles: {
            0: { cellWidth: 50 },
            1: { cellWidth: 25 },
            2: { cellWidth: 20 },
            3: { cellWidth: 20 },
            4: { cellWidth: 20 },
            5: { cellWidth: 20 }
          }
        });

        const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-');
        doc.save(`shift_item_report_${safe(shiftLabel)}_${this.formatDateOnly(this.startDate)}_${this.formatDateOnly(this.endDate)}.pdf`);
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
    if (!this.rows.length || !this.columns.length || !this.startDate || !this.endDate || !this.selectedShiftId) return;

    this.isLoading = true;
    this.isDownloadingCsv = true;

    setTimeout(() => {
      try {
        const csvRows: string[] = [];
        csvRows.push(this.columns.join(','));

        for (const row of this.rows) {
          const rowData = this.columns.map((col) => {
            const cell = row[col];
            return typeof cell === 'string' && cell.includes(',')
              ? `"${cell.replace(/"/g, '""')}"`
              : cell;
          });
          csvRows.push(rowData.join(','));
        }

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        const shiftPart = (this.selectedShift?.name ?? this.selectedShiftId).replace(/[/\\?%*:|"<>]/g, '-');
        link.setAttribute('download', `shift_item_report_${shiftPart}_${this.formatDateOnly(this.startDate)}_${this.formatDateOnly(this.endDate)}.csv`);
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

  private toQueryStartIso(d: Date): string {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    return x.toISOString();
  }

  private toQueryEndIso(d: Date): string {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return x.toISOString();
  }

  private formatDateOnly(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
