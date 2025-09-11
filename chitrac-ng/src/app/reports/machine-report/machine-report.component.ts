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
import { Canvg } from 'canvg';

import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { MachineAnalyticsService } from '../../services/machine-analytics.service';
import { MachineItemSummaryService } from '../../services/machine-item-summary.service';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { DateTimePickerComponent } from '../../components/date-time-picker/date-time-picker.component';
import { getStatusDotByCode } from '../../../utils/status-utils';
import { LayoutGridTwoByTwoComponent } from '../../layouts/grid/layout-grid-twobytwo/layout-grid-twobytwo.component';
import { FaultStackedBarByMachineComponent } from '../../charts/fault-stacked-bar-by machine/fault-stacked-bar-by-machine.component';
import { MachineStatusStackedChartComponent } from '../../charts/machine-status-stacked-chart/machine-status-stacked-chart.component';
import { RankedOeeChartComponent } from '../../charts/ranked-oee-chart/ranked-oee-chart.component';
import { ItemStackedChartComponent } from '../../charts/item-stacked-chart/item-stacked-chart.component';

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
        DateTimePickerComponent,
        LayoutGridTwoByTwoComponent
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

  // 2x2 Grid properties
  showGrid: boolean = false;
  gridComponents = [
    MachineStatusStackedChartComponent, // Machine Status Stacked Bar
    RankedOeeChartComponent, // Ranked OEE% by Machine
    ItemStackedChartComponent, // Item Stacked Bar by Machine
    FaultStackedBarByMachineComponent  // Fault Stacked Bar by Machine
  ];

  // Chart data array for the grid
  chartDataArray: any[] = [];

  constructor(
    private analyticsService: MachineAnalyticsService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    private machineItemSummaryService: MachineItemSummaryService,
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
    const formattedStart = new Date(this.startTime).toISOString();
    const formattedEnd = new Date(this.endTime).toISOString();

    // Fetch both the detailed summary for the table and the chart data
    this.dailyDashboardService.getMachineItemSessionsSummary(formattedStart, formattedEnd).subscribe({
      next: (data) => {
        // Process chart data
        this.processChartData(data);
        
        // Process table data from the results
        this.processTableData(data.results);
        
        this.isLoading = false;
        this.showGrid = true; // Show the 2x2 grid after data is loaded
      },
      error: (error) => {
        console.error('Error fetching machine item summary:', error);
        this.isLoading = false;
      }
    });
  }

  private processChartData(data: any): void {
    if (data.charts) {
      // Prepare chart data array for the grid component
      // Keep only series/axes/legend metadata - let grid determine sizes
      this.chartDataArray = [
        {
          ...data.charts.statusStacked,
          legend: { show: true, position: 'right' }
        }, // Machine Status Stacked Bar
        {
          ...data.charts.efficiencyRanked,
          legend: { show: true, position: 'right' }
        }, // Ranked OEE% by Machine
        {
          ...data.charts.itemsStacked,
          legend: { show: true, position: 'right' }
        }, // Item Stacked Bar by Machine
        {
          ...data.charts.faultsStacked,
          legend: { show: true, position: 'right' }
        } // Fault Stacked Bar by Machine
      ];
    }
  }

  private processTableData(results: any[]): void {
    const formattedData: any[] = [];

    results.forEach((machine: any) => {
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
  }

  private async waitForChartsInGrid(expected = 4, timeoutMs = 5000): Promise<SVGSVGElement[]> {
    const gridEl = this.elRef.nativeElement.querySelector('layout-grid-twobytwo');
    console.log('Grid element found:', !!gridEl);
    
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const svgs = gridEl ? Array.from(gridEl.querySelectorAll('svg.cc-svg')) as SVGSVGElement[] : [];
      console.log(`Found ${svgs.length} SVGs, expected ${expected}`);
      
      // Check if SVGs have content and proper dimensions
      const validSvgs = svgs.filter(svg => {
        const rect = svg.getBoundingClientRect();
        const hasContent = svg.children.length > 0;
        const hasSize = rect.width > 0 && rect.height > 0;
        console.log(`SVG: width=${rect.width}, height=${rect.height}, children=${svg.children.length}, hasContent=${hasContent}, hasSize=${hasSize}`);
        return hasContent && hasSize;
      });
      
      if (validSvgs.length >= expected) {
        console.log(`Found ${validSvgs.length} valid SVGs`);
        return validSvgs;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    const finalSvgs = gridEl ? Array.from(gridEl.querySelectorAll('svg.cc-svg')) as SVGSVGElement[] : [];
    console.log(`Timeout reached. Final SVG count: ${finalSvgs.length}`);
    return finalSvgs;
  }

  private cloneInlineSvg(svg: SVGSVGElement): SVGSVGElement {
    const clone = svg.cloneNode(true) as SVGSVGElement;

    // namespaces
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Remove all style attributes to avoid overwhelming Canvg
    const removeStyles = (element: Element) => {
      element.removeAttribute('style');
      Array.from(element.children).forEach(child => removeStyles(child));
    };
    removeStyles(clone);

    // Set basic dimensions
    const bb = svg.getBoundingClientRect();
    const w = Math.max(1, Math.floor(bb.width));
    const h = Math.max(1, Math.floor(bb.height));
    
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

    // Add white background
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x','0'); 
    bg.setAttribute('y','0');
    bg.setAttribute('width',String(w)); 
    bg.setAttribute('height',String(h));
    bg.setAttribute('fill','#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    return clone;
  }

  private async svgToPngDataUrl(svgEl: SVGSVGElement): Promise<{dataUrl:string,w:number,h:number}> {
    console.log('Converting SVG to PNG:', svgEl);
    console.log('SVG children count:', svgEl.children.length);
    console.log('SVG innerHTML length:', svgEl.innerHTML.length);
    
    const clone = this.cloneInlineSvg(svgEl);
    const serialized = new XMLSerializer().serializeToString(clone);
    console.log('Serialized SVG length:', serialized.length);
    console.log('Serialized SVG preview:', serialized.substring(0, 200) + '...');
    
    const w = Number(clone.getAttribute('width')) || 1200;
    const h = Number(clone.getAttribute('height')) || 600;
    console.log('Canvas dimensions:', w, 'x', h);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; 
    ctx.fillRect(0, 0, w, h);

    try {
      console.log('Creating Canvg instance...');
      const v = await Canvg.from(ctx, serialized);
      console.log('Canvg instance created, rendering...');
      await v.render();
      console.log('Canvg render completed');
      
      const dataUrl = canvas.toDataURL('image/png');
      console.log('Data URL generated, length:', dataUrl.length);
      
      // Validate the data URL is not just a white rectangle
      const img = new Image();
      img.onload = () => {
        const testCanvas = document.createElement('canvas');
        testCanvas.width = 10;
        testCanvas.height = 10;
        const testCtx = testCanvas.getContext('2d')!;
        testCtx.drawImage(img, 0, 0, 10, 10);
        const testData = testCtx.getImageData(0, 0, 10, 10).data;
        const hasContent = Array.from(testData).some(pixel => pixel !== 255);
        console.log('Image has non-white content:', hasContent);
      };
      img.src = dataUrl;
      
      return { dataUrl, w, h };
    } catch (error) {
      console.error('Error converting SVG to PNG:', error);
      console.error('Error details:', (error as Error).message);
      console.error('Stack trace:', (error as Error).stack);
      
      // Return a placeholder image with chart number
      const placeholderCanvas = document.createElement('canvas');
      placeholderCanvas.width = w;
      placeholderCanvas.height = h;
      const placeholderCtx = placeholderCanvas.getContext('2d')!;
      placeholderCtx.fillStyle = '#f0f0f0';
      placeholderCtx.fillRect(0, 0, w, h);
      placeholderCtx.fillStyle = '#666';
      placeholderCtx.font = '16px Arial';
      placeholderCtx.textAlign = 'center';
      placeholderCtx.fillText('Chart conversion failed', w/2, h/2 - 10);
      placeholderCtx.fillText('Check console for details', w/2, h/2 + 10);
      return { dataUrl: placeholderCanvas.toDataURL('image/png'), w, h };
    }
  }

  private addImageFitted(doc: jsPDF, dataUrl: string, imgW: number, imgH: number, cursorY: number, pageMargin = 14): number {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - pageMargin*2;
    const maxH = pageH - pageMargin*2;

    // scale to fit width first
    let drawW = Math.min(maxW, imgW);
    let drawH = (imgH * drawW) / imgW;

    // if exceeds remaining height, new page
    if (cursorY + drawH > pageH - pageMargin) {
      doc.addPage();
      cursorY = pageMargin;
    }
    // if still too tall, scale down to available height
    if (drawH > (pageH - pageMargin - cursorY)) {
      drawH = pageH - pageMargin - cursorY;
      drawW = (imgW * drawH) / imgH;
    }

    doc.addImage(dataUrl, 'PNG', pageMargin, cursorY, drawW, drawH);
    return cursorY + drawH + 8; // new cursor
  }

  async downloadMachineItemSummaryPdf(): Promise<void> {
    if (!this.startTime || !this.endTime) return;

    this.isDownloading = true; // leave isLoading alone
    console.log('Starting PDF export...');

    try {
  
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const svgs = await this.waitForChartsInGrid(4, 6000);
      console.log(`Processing ${svgs.length} SVGs for PDF`);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      doc.setFontSize(14);
      doc.text('MACHINE REPORT', margin, y); y += 18;
      doc.setFontSize(10);
      doc.text(`Range: ${this.startTime} → ${this.endTime}`, margin, y); y += 14;

      for (let i = 0; i < svgs.length; i++) {
        console.log(`Processing chart ${i + 1}/${svgs.length}`);
        const { dataUrl, w, h } = await this.svgToPngDataUrl(svgs[i]);
        console.log(`Chart ${i + 1} converted: ${w}x${h}, dataUrl length: ${dataUrl.length}`);
        y = this.addImageFitted(doc, dataUrl, w, h, y, margin);
        console.log(`Chart ${i + 1} added to PDF at y=${y}`);
      }

      if (y > doc.internal.pageSize.getHeight() - 160) { doc.addPage(); y = margin; }

      const head = [['Machine/Item', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency']];
      const body = this.rows.map(row => [
        `${row['Machine']} / ${row['Item']}`,
        row['Total Time (Runtime)'],
        row['Total Count'],
        row['PPH'],
        row['Standard'],
        row['Efficiency'],
      ]);

      console.log(`Adding table with ${body.length} rows`);
      autoTable(doc, {
        head, body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255 },
        columnStyles: { 0: { cellWidth: 180 } },
        theme: 'striped'
      });

      console.log('Saving PDF...');
      doc.save(`machine_report_${this.startTime}_${this.endTime}.pdf`);
      console.log('PDF export completed successfully');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
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