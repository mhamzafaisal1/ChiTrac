import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';


import { BaseTableComponent } from '../components/base-table/base-table.component';
import { MachineAnalyticsService } from '../services/machine-analytics.service';
import { MachineItemSummaryService } from '../services/machine-item-summary.service';
import { OperatorSummaryService } from '../services/operator-summary.service';
import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { UseCarouselComponent } from '../use-carousel/use-carousel.component';
import { MachineFaultHistoryComponent } from '../machine-fault-history/machine-fault-history.component';
import { OperatorPerformanceChartComponent } from '../operator-performance-chart/operator-performance-chart.component';
import { MachineItemSummaryTableComponent } from '../machine-item-summary-table/machine-item-summary-table.component';
import { MachineItemStackedBarChartComponent } from '../machine-item-stacked-bar-chart/machine-item-stacked-bar-chart.component';
import { getStatusDotByCode } from '../../utils/status-utils';

interface OperatorSummaryRow {
  operatorName: string;
  machineName: string;
  itemName: string;
  workedTimeFormatted: { hours: number; minutes: number };
  count: number;
  misfeed: number;
  pph: number;
  standard: number;
  efficiency: number;
}

interface ItemSummary {
  itemName: string;
  workedTimeFormatted: { hours: number; minutes: number };
  count: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Component({
    selector: 'app-machine-analytics-dashboard',
    imports: [
        CommonModule,
        HttpClientModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        BaseTableComponent
    ],
    templateUrl: './machine-analytics-dashboard.component.html',
    styleUrls: ['./machine-analytics-dashboard.component.scss']
})
export class MachineAnalyticsDashboardComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  columns: string[] = [];
  rows: any[] = [];
  selectedRow: any | null = null;
  isDarkTheme: boolean = false;
  private observer!: MutationObserver;

  constructor(
    private analyticsService: MachineAnalyticsService,
    private dialog: MatDialog,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private machineItemSummaryService: MachineItemSummaryService,
    private operatorSummaryService: OperatorSummaryService
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

    this.fetchAnalyticsData();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  detectTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = isDark;

    const element = this.elRef.nativeElement;
  }

  fetchAnalyticsData(): void {
    if (!this.startTime || !this.endTime) return;

    this.analyticsService.getMachinePerformance(this.startTime, this.endTime, undefined)
      .subscribe((data: any) => {
        const responses = Array.isArray(data) ? data : [data];

        const formattedData = responses.map(response => ({
          'Status': getStatusDotByCode(response.currentStatus?.code),
          'Machine Name': response.machine.name,
          'Serial Number': response.machine.serial,
          'Runtime': `${response.metrics.runtime.formatted.hours}h ${response.metrics.runtime.formatted.minutes}m`,
          'Downtime': `${response.metrics.downtime.formatted.hours}h ${response.metrics.downtime.formatted.minutes}m`,
          'Total Count': response.metrics.output.totalCount,
          'Misfeed Count': response.metrics.output.misfeedCount,
          'Availability': `${response.metrics.performance.availability.percentage}%`,
          'Throughput': `${response.metrics.performance.throughput.percentage}%`,
          'Efficiency': `${response.metrics.performance.efficiency.percentage}%`,
          'OEE': `${response.metrics.performance.oee.percentage}%`,
          'Time Range': `${response.timeRange.start} to ${response.timeRange.end}`
        }));

        const allColumns = Object.keys(formattedData[0]);
        const columnsToHide = ['Serial Number', 'Time Range'];
        this.columns = allColumns.filter(col => !columnsToHide.includes(col));

        this.rows = formattedData;
      });
  }

  //Orignal downloadPdf function with no omition.

  // downloadPdf(): void {
  //   const doc = new jsPDF();
  
  //   const tableColumnTitles = this.columns;
  //   const tableRows = this.rows.map(row =>
  //     this.columns.map(col => row[col] ?? '')
  //   );
  
  //   doc.text('Machine Analytics Report', 14, 16);
  //   autoTable(doc, {
  //     startY: 20,
  //     head: [tableColumnTitles],
  //     body: tableRows,
  //     styles: { fontSize: 8 }
  //   });
  
  //   doc.save('machine_analytics_report.pdf');
  // }
  

  downloadMachineItemSummaryPdf(start: string, end: string): void {
    const formattedStart = new Date(start).toISOString();
    const formattedEnd = new Date(end).toISOString();
  
    this.machineItemSummaryService.getMachineItemSummary(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('MACHINE ITEM SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${start} to ${end}`, 14, 23);
  
        const head = [['Machine/Item', 'Worked Time', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
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
            `${summary.workedTimeFormatted.hours}h ${summary.workedTimeFormatted.minutes}m`,
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
      },
      error: (err) => {
        console.error('Error fetching summary data:', err);
      }
    });
  }

  downloadOperatorSummaryPdf(start: string, end: string): void {
    const formattedStart = new Date(start).toISOString();
    const formattedEnd = new Date(end).toISOString();
  
    this.operatorSummaryService.getOperatorSummary(formattedStart, formattedEnd).subscribe({
      next: (data: OperatorSummaryRow[]) => {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('OPERATOR SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${start} to ${end}`, 14, 23);
  
        const head = [['Operator', 'Machine', 'Item', 'Worked Time', 'Count', 'Misfeed', 'PPH', 'Standard', 'Efficiency']];
        const body: any[] = [];
  
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
            existing.workedTimeFormatted.hours += row.workedTimeFormatted.hours;
            existing.workedTimeFormatted.minutes += row.workedTimeFormatted.minutes;
          }
        }
  
        // Normalize time overflow
        for (const summary of grouped.values()) {
          if (summary.workedTimeFormatted.minutes >= 60) {
            summary.workedTimeFormatted.hours += Math.floor(summary.workedTimeFormatted.minutes / 60);
            summary.workedTimeFormatted.minutes %= 60;
          }
          const totalMs = summary.workedTimeFormatted.hours * 3600000 + summary.workedTimeFormatted.minutes * 60000;
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
  
        for (const [operatorName, rows] of byOperator.entries()) {
          const operatorTotal = {
            count: 0,
            misfeed: 0,
            workedTimeMs: 0
          };
  
          for (const row of rows) {
            operatorTotal.count += row.count;
            operatorTotal.misfeed += row.misfeed;
            operatorTotal.workedTimeMs += row.workedTimeFormatted.hours * 3600000 + row.workedTimeFormatted.minutes * 60000;
          }
  
          const totalHours = operatorTotal.workedTimeMs / 3600000;
          const pph = totalHours > 0 ? operatorTotal.count / totalHours : 0;
  
          const proratedStandard = rows.reduce((acc, row) => {
            const weight = operatorTotal.count > 0 ? row.count / operatorTotal.count : 0;
            return acc + (weight * row.standard);
          }, 0);
  
          const eff = proratedStandard > 0 ? pph / proratedStandard : 0;
  
          body.push([
            {
              content: operatorName,
              styles: { fillColor: [200, 230, 255], textColor: 0, fontStyle: 'bold' }
            },
            'TOTAL',
            'ALL ITEMS',
            `${Math.floor(operatorTotal.workedTimeMs / 3600000)}h ${Math.floor((operatorTotal.workedTimeMs % 3600000) / 60000)}m`,
            operatorTotal.count,
            operatorTotal.misfeed,
            Math.round(pph * 100) / 100,
            Math.round(proratedStandard * 100) / 100,
            `${Math.round(eff * 10000) / 100}%`
          ]);
  
          for (const row of rows) {
            body.push([
              '  ' + row.operatorName,
              row.machineName,
              row.itemName,
              `${row.workedTimeFormatted.hours}h ${row.workedTimeFormatted.minutes}m`,
              row.count,
              row.misfeed,
              row.pph,
              row.standard,
              `${row.efficiency}%`
            ]);
          }
        }
  
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
      },
      error: (err) => {
        console.error("Failed to fetch operator summary:", err);
      }
    });
  }
  
  downloadItemSummaryPdf(start: string, end: string): void {
    const formattedStart = new Date(start).toISOString();
    const formattedEnd = new Date(end).toISOString();
  
    this.analyticsService.getItemSummary(formattedStart, formattedEnd).subscribe({
      next: (data: ItemSummary[]) => {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('ITEM SUMMARY REPORT', 14, 15);
        doc.setFontSize(11);
        doc.text(`Date Range: ${start} to ${end}`, 14, 23);
  
        const head = [['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency']];
        const body = data.map((item: ItemSummary) => [
          item.itemName,
          `${item.workedTimeFormatted.hours}h ${item.workedTimeFormatted.minutes}m`,
          item.count,
          item.pph,
          item.standard,
          `${item.efficiency}%`
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
      },
      error: (err) => {
        console.error("Failed to fetch item summary:", err);
      }
    });
  }

  onRowClick(row: any): void {
    if (this.selectedRow === row) {
      this.selectedRow = null;
      return;
    }

    this.selectedRow = row;

    setTimeout(() => {
      const element = document.querySelector('.mat-row.selected');
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);

    const carouselTabs = [
      { 
        label: 'Item Summary', 
        component: MachineItemSummaryTableComponent,
        componentInputs: {
          startTime: this.startTime,
          endTime: this.endTime,
          selectedMachineSerial: row['Serial Number']
        }
      },
      { 
        label: 'Item Stacked Chart', 
        component: MachineItemStackedBarChartComponent,
        componentInputs: {
          startTime: this.startTime,
          endTime: this.endTime,
          machineSerial: row['Serial Number']
        }
      },
      { 
        label: 'Fault Summaries', 
        component: MachineFaultHistoryComponent,
        componentInputs: {
          viewType: 'summary'
        }
      },
      { 
        label: 'Fault Cycles', 
        component: MachineFaultHistoryComponent,
        componentInputs: {
          viewType: 'cycles'
        }
      },
      { 
        label: 'Performance Chart', 
        component: OperatorPerformanceChartComponent 
      }
    ];

    const dialogRef = this.dialog.open(ModalWrapperComponent, {
      width: '95vw',
      height: '90vh',
      maxHeight: '90vh',
      maxWidth: '95vw',
      panelClass: 'performance-chart-dialog',
      data: {
        component: UseCarouselComponent,
        componentInputs: {
          tabData: carouselTabs
        },
        machineSerial: row['Serial Number'],
        startTime: this.startTime,
        endTime: this.endTime
      }
    });

    dialogRef.afterClosed().subscribe(() => {
      if (this.selectedRow === row) {
        this.selectedRow = null;
      }
    });
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
