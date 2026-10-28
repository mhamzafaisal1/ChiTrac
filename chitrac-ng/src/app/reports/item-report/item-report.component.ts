import { Component, OnInit, OnDestroy, ElementRef, Renderer2, inject } from '@angular/core';
import { ReportColumnLayoutService } from '../report-column-layout.service';
import { reportCsv, reportPdfTable } from '../report-columns';
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
import { ReportsService } from '../../services/reports.service';
import { TimeframePickerComponent, TimeframeSelection, TimeframePickerMode } from '../../components/timeframe-picker/timeframe-picker.component';
import { displayInteger } from '../../shared/utils/display-number';
import { formatDurationParts } from '../../shared/utils/duration-format';

interface ItemSummary {
  itemId?: number | string;
  itemName: string;
  workedTimeFormatted: { hours: number; minutes: number; seconds?: number };
  count: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
    providers: [ReportColumnLayoutService],
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
        TimeframePickerComponent
    ],
    templateUrl: './item-report.component.html',
    styleUrls: ['./item-report.component.scss']
})
export class ItemReportComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  selectedShiftId: string | null = null;
  timeframeMode: TimeframePickerMode = 'today';
  readonly layout = inject(ReportColumnLayoutService);
  get columns(): string[] { return this.layout.columns; }
  rows: any[] = [];
  columnTooltips: { [column: string]: string } = {
    'Worked Time': 'Amount of time item has been run across all machines.',
    'Count Total': 'Amount of pieces fed for this item.',
    'PPH': 'Pieces Per Hour',
    'Standard': 'Pieces Per Hour Goal',
    'Efficiency': 'Percent of goal pace being achieved.',
  };
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  isDownloading: boolean = false;
  isDownloadingCsv: boolean = false;
  private observer!: MutationObserver;

  constructor(
    private reportsService: ReportsService,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit(): void {
    this.layout.initialize('itemReport', 'Item Report');
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

  applyTimeframe(selection: TimeframeSelection): void {
    if (this.isLoading) return;
    this.startTime = selection.start.toISOString();
    this.endTime = selection.end.toISOString();
    this.selectedShiftId = selection.shiftId;
    this.timeframeMode = selection.mode || 'custom';
    this.rows = [];
    this.fetchAnalyticsData();
  }

  fetchAnalyticsData(): void {
    if (this.isLoading) return;
    if (!this.startTime || !this.endTime) return;

    this.isLoading = true;
    this.isDownloading = false;
    this.isDownloadingCsv = false;

    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    this.reportsService.getItemReport(formattedStart, formattedEnd, this.selectedShiftId).subscribe({
      next: (data: ItemSummary[] | { results?: ItemSummary[] }) => {
        const items = Array.isArray(data)
          ? data
          : (data?.results ?? []);

        const formattedData = items.map(item => ({
          'Item Name': item.itemName,
          'Worked Time': formatDurationParts(item.workedTimeFormatted),
          'Count Total': item.count,
          'PPH': displayInteger(item.pph),
          'Standard': displayInteger(item.standard),
          'Efficiency': `${item.efficiency}%`,
          '_tooltipItemId': item.itemId ?? ''
        }));

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

        const { head, body } = reportPdfTable('itemReport', this.columns, this.rows);

        autoTable(doc, {
          head,
          body,
          startY: 30,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [52, 73, 94], textColor: 255 },
          columnStyles: Object.fromEntries(this.columns.map((column, index) => [index, {
            cellWidth: column === 'Item Name' ? 50 : column === 'Worked Time' ? 25 : 20
          }]))
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
        const csvContent = reportCsv(this.columns, this.rows);
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

  readonly getCellTooltip = (row: any, column: string): string => {
    if (column === 'Item Name' && row?._tooltipItemId != null && row._tooltipItemId !== '') {
      return `Item ID: ${row._tooltipItemId}`;
    }
    return '';
  };

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}


