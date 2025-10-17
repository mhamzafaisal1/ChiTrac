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
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'base-table',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatSortModule, MatIconModule],
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

  @Output() rowClicked = new EventEmitter<any>();

  @ViewChild(MatSort) sort!: MatSort;
  dataSource = new MatTableDataSource<any>();
  visibleColumns: string[] = [];

  private readonly handleResize = this.updateVisibleColumns.bind(this);

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
    this.dataSource.data = this.rows;
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
        return data[sortHeaderId];
      };
    }
  }

  private updateVisibleColumns(): void {
    const screenWidth = window.innerWidth;
    const hidden = new Set<string>();

    Object.entries(this.responsiveHiddenColumns || {}).forEach(([breakpointStr, cols]) => {
      const breakpoint = parseInt(breakpointStr, 10);
      if (screenWidth < breakpoint) {
        cols.forEach(col => hidden.add(col));
      }
    });

    this.visibleColumns = this.columns.filter(col => !hidden.has(col));
  }

  onRowClick(row: any) {
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
    const num = parseInt(value.replace('%', ''));
    if (isNaN(num)) return '';
    if (num >= 90) return 'green';
    if (num >= 70) return 'yellow';
    return 'red';
  }

  getCellClassForColumn(value: any, column: string): string {
    return this.getCellClass ? this.getCellClass(value, column) : '';
  }

  trackByIndex(index: number): number {
    return index;
  }
}
