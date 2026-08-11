import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

@Component({
  selector: 'base-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule
  ],
  templateUrl: './base-table.component.html',
  styleUrls: ['./base-table.component.scss'],
})
export class BaseTableComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() columns: string[] = [];
  @Input() rows: any[] = [];
  @Input() selectedRow: any | null = null;
  @Input() disableSorting: boolean = false;
  @Input() getCellClass: ((value: any, column: string) => string) | null = null;
  @Input() responsiveHiddenColumns: { [breakpoint: number]: string[] } = {};
  @Input() columnTooltips: { [column: string]: string } = {};
  @Input() getCellTooltip: ((row: any, column: string) => string) | null = null;
  @Input() enableToolbar: boolean = true;
  @Input() exportFileName: string = 'chitrac-table-export.csv';
  @Input() columnEditMode: boolean = false;
  @Input() toggleableColumns: string[] = [];
  @Input() columnVisibility: Record<string, boolean> = {};

  @Output() rowClicked = new EventEmitter<any>();
  @Output() columnVisibilityChange = new EventEmitter<Record<string, boolean>>();

  @ViewChild(MatSort) sort!: MatSort;
  dataSource = new MatTableDataSource<any>();
  visibleColumns: string[] = [];
  searchTerm = '';

  private readonly handleResize = this.updateVisibleColumns.bind(this);

  constructor(private percentBreakpointService: PercentBreakpointService) {}

  ngOnInit() {
    this.updateData();
    this.updateVisibleColumns();
    window.addEventListener('resize', this.handleResize);
  }

  ngAfterViewInit() {
    this.setupSorting();
  }

  ngOnChanges() {
    this.updateData();
    this.updateVisibleColumns();
    this.setupSorting();
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.handleResize);
  }

  private updateData() {
    this.dataSource.data = this.rows || [];
    this.dataSource.filterPredicate = (row: any, filter: string) => {
      if (row?.isDummy) return true;
      const haystack = this.columns
        .map((column) => this.getCellExportValue(row[column]))
        .join(' ')
        .toLowerCase();
      return haystack.includes(filter);
    };
    this.applyFilter();
  }

  private setupSorting() {
    if (this.sort && !this.disableSorting) {
      this.dataSource.sort = this.sort;
      this.dataSource.sortingDataAccessor = (data: any, sortHeaderId: string) => {
        if (sortHeaderId === 'Start Time') {
          return new Date(data[sortHeaderId]).getTime();
        }
        // Handle all time-formatted columns (e.g., "1h 30m")
        if (sortHeaderId === 'Duration' || sortHeaderId === 'Total Duration' || 
            sortHeaderId === 'Total Time (Runtime)' || sortHeaderId === 'Runtime' ||
            sortHeaderId === 'Worked Time' || sortHeaderId === 'Downtime') {
          const value = data[sortHeaderId];
          if (typeof value === 'string' && value.includes('h')) {
            const [hours, minutes] = value.split(' ');
            const h = parseInt(hours) || 0;
            const m = parseInt(minutes) || 0;
            return h * 60 + m;
          }
          return 0;
        }
        const value = data[sortHeaderId];
        if (typeof value === 'string' && value.trim().endsWith('%')) {
          const percentage = Number.parseFloat(value.replace('%', ''));
          return Number.isFinite(percentage) ? percentage : Number.NEGATIVE_INFINITY;
        }
        return value;
      };
    } else if (this.disableSorting) {
      this.dataSource.sort = null;
    }
  }

  applyFilter(): void {
    this.dataSource.filter = this.searchTerm.trim().toLowerCase();
  }

  clearFilter(): void {
    this.searchTerm = '';
    this.applyFilter();
  }

  exportCsv(): void {
    const rowsToExport = this.dataSource.filteredData.filter((row) => !row?.isDummy);
    if (!rowsToExport.length) return;

    const header = this.visibleColumns.map((column) => this.escapeCsvValue(column)).join(',');
    const body = rowsToExport
      .map((row) =>
        this.visibleColumns
          .map((column) => this.escapeCsvValue(this.getCellExportValue(row[column])))
          .join(',')
      )
      .join('\r\n');

    const blob = new Blob([`${header}\r\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = this.exportFileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  getFilteredRowCount(): number {
    return this.dataSource.filteredData.filter((row) => !row?.isDummy).length;
  }

  getRealRowCount(): number {
    return (this.rows || []).filter((row) => !row?.isDummy).length;
  }

  private updateVisibleColumns(): void {
    const screenWidth = window.innerWidth;
    const hidden = new Set<string>();

    if (!this.columnEditMode) {
      Object.entries(this.responsiveHiddenColumns || {}).forEach(([breakpointStr, cols]) => {
        const breakpoint = parseInt(breakpointStr, 10);
        if (screenWidth < breakpoint) {
          cols.forEach(col => hidden.add(col));
        }
      });
    }

    this.visibleColumns = this.columns.filter(col => {
      if (hidden.has(col)) return false;
      if (this.columnEditMode) return true;
      return this.isColumnEnabled(col);
    });
  }

  onRowClick(row: any) {
    if (row?.isDummy) return;
    if (this.selectedRow !== row) {
      this.rowClicked.emit(row);
    } else {
      this.rowClicked.emit(null);
    }
  }

  isRowSelected(row: any): boolean {
    return this.selectedRow === row;
  }

  getEfficiencyClass(value: any): string {
    if (typeof value !== 'string' || !value.includes('%')) return '';
    return this.percentBreakpointService.getColorClass(value);
  }

  getCellClassForColumn(value: any, column: string): string {
    const customClass = this.getCellClass ? this.getCellClass(value, column) : '';
    if (customClass) return customClass;
    return column === 'Efficiency' ? this.getEfficiencyClass(value) : '';
  }

  getTooltipForColumn(column: string): string {
    return this.columnTooltips?.[column] || '';
  }

  hasTooltipForColumn(column: string): boolean {
    return !!this.getTooltipForColumn(column);
  }

  isColumnToggleable(column: string): boolean {
    return this.toggleableColumns.includes(column);
  }

  isColumnEnabled(column: string): boolean {
    return this.columnVisibility?.[column] !== false;
  }

  onColumnToggle(column: string, enabled: boolean): void {
    if (!this.isColumnToggleable(column)) return;

    this.columnVisibilityChange.emit({
      ...(this.columnVisibility || {}),
      [column]: enabled
    });
  }

  getTooltipForCell(row: any, column: string): string {
    const cellTooltip = this.getCellTooltip ? this.getCellTooltip(row, column) : '';
    return cellTooltip || this.getTooltipForColumn(column);
  }

  hasTooltipForCell(row: any, column: string): boolean {
    return !!this.getTooltipForCell(row, column);
  }

  getStatusAriaLabel(status: string): string {
    switch (status) {
      case 'Running Dot':
        return 'Machine running';
      case 'Paused Dot':
        return 'Machine paused';
      case 'Faulted Dot':
        return 'Machine faulted';
      case 'Offline Dot':
        return 'Machine offline';
      default:
        return 'Machine status';
    }
  }

  trackByIndex(index: number): number {
    return index;
  }

  private getCellExportValue(value: any): string {
    if (typeof value !== 'string') return value == null ? '' : String(value);
    return value.replace(/<[^>]*>/g, '').trim();
  }

  private escapeCsvValue(value: any): string {
    const text = this.getCellExportValue(value);
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }
}
