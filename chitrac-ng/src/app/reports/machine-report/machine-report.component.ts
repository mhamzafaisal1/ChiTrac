import { Component, OnInit, OnDestroy } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { ReportsService } from '../../services/reports.service';
import { DateTimePickerComponent } from '../../../../arch/date-time-picker/date-time-picker.component';
import { ModalWrapperComponent } from '../../components/modal-wrapper-component/modal-wrapper-component.component';
import { MachineReportEmailModalComponent } from './machine-report-email-modal.component';
import { UserService, UserWithEmailRow } from '../../user.service';

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
        MatDialogModule,
        MatSnackBarModule,
        BaseTableComponent,
        DateTimePickerComponent
    ],
    templateUrl: './machine-report.component.html',
    styleUrls: ['./machine-report.component.scss']
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
  isEmailing: boolean = false;
  showSummaryOnly: boolean = false;
  reportEmailUsers: UserWithEmailRow[] = [];
  private observer!: MutationObserver;

  get displayedRows(): any[] {
    if (this.showSummaryOnly) {
      return this.rows.filter(row => row['Item'] === 'Total');
    }
    return this.rows;
  }

  constructor(
    private reportsService: ReportsService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private userService: UserService
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

    this.userService.getUsersWithEmail().subscribe({
      next: (users) => {
        this.reportEmailUsers = users;
      },
      error: (err) => {
        console.warn('[machine-report][email] getUsersWithEmail failed', err?.status, err?.error ?? err);
        this.reportEmailUsers = [];
      },
    });
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
      const items = itemSummaries != null ? Object.values(itemSummaries) : [];

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
          'Efficiency': item.efficiency != null ? `${item.efficiency}%` : ''
        });
      });
    });

    this.columns = formattedData.length ? Object.keys(formattedData[0]) : ['Machine', 'Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'];
    this.rows = formattedData;
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

  /** Same layout as download / email — uses current `displayedRows` (Detailed vs Summary). */
  private buildMachineReportPdfDoc(): jsPDF {
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

  private arrayBufferToBase64(buf: ArrayBuffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buf], { type: 'application/pdf' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const i = dataUrl.indexOf(',');
        resolve(i >= 0 ? dataUrl.slice(i + 1) : dataUrl);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async downloadMachineItemSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true;
    try {
      const doc = this.buildMachineReportPdfDoc();
      doc.save(`machine_report_${this.startTime}_${this.endTime}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  openEmailReportDialog(): void {
    console.log('[machine-report][email] openEmailReportDialog', {
      rowCount: this.rows.length,
      startTime: this.startTime,
      endTime: this.endTime,
      summaryOnly: this.showSummaryOnly,
    });
    if (!this.rows.length || !this.startTime || !this.endTime) {
      console.log('[machine-report][email] openEmailReportDialog aborted: missing data');
      return;
    }

    this.dialog
      .open(ModalWrapperComponent, {
        width: '440px',
        maxWidth: '95vw',
        data: {
          component: MachineReportEmailModalComponent,
          usersWithEmail: this.reportEmailUsers,
        },
        panelClass: this.isDarkTheme ? ['dark-theme'] : undefined,
      })
      .afterClosed()
      .subscribe((result: { email?: string } | undefined) => {
        console.log('[machine-report][email] modal afterClosed', result);
        if (result?.email) {
          void this.emailMachineReportPdf(result.email);
        } else {
          console.log('[machine-report][email] modal closed without sending');
        }
      });
  }

  private async emailMachineReportPdf(to: string): Promise<void> {
    console.log('[machine-report][email] emailMachineReportPdf start', { to });
    this.isEmailing = true;
    try {
      const doc = this.buildMachineReportPdfDoc();
      const buf = doc.output('arraybuffer') as ArrayBuffer;
      console.log('[machine-report][email] PDF arraybuffer bytes=', buf.byteLength);
      const pdfBase64 = await this.arrayBufferToBase64(buf);
      console.log('[machine-report][email] base64 length=', pdfBase64.length);

      this.reportsService
        .emailMachineReport({
          to,
          pdfBase64,
          start: this.startTime,
          end: this.endTime,
          summaryOnly: this.showSummaryOnly,
        })
        .pipe(finalize(() => {
          console.log('[machine-report][email] HTTP stream finalized (loading cleared)');
          this.isEmailing = false;
        }))
        .subscribe({
          next: (res) => {
            console.log('[machine-report][email] POST success', res);
            this.snackBar.open('Report sent.', 'Dismiss', { duration: 4000 });
          },
          error: (err) => {
            console.log('[machine-report][email] POST error', err?.status, err?.error ?? err);
            const msg =
              err?.error?.error ||
              err?.message ||
              'Could not send the report.';
            this.snackBar.open(msg, 'Dismiss', { duration: 6000 });
          },
        });
    } catch (e) {
      console.error('[machine-report][email] emailMachineReportPdf failed before POST', e);
      this.snackBar.open('Could not build the PDF.', 'Dismiss', { duration: 5000 });
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

        csvRows.push(this.columns.join(','));

        for (const row of this.displayedRows) {
          const rowData = this.columns.map(col => {
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
