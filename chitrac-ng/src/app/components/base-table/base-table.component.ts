import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { AgGridAngular } from 'ag-grid-angular';
import {
  _ColumnMoveModule,
  _KeyboardNavigationModule,
  _SortModule,
  CellClassParams,
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColDef,
  ColumnApiModule,
  ColumnAutoSizeModule,
  ColumnMovedEvent,
  CsvExportModule,
  DragAndDropModule,
  GridApi,
  GridReadyEvent,
  GridSizeChangedEvent,
  Module,
  SizeColumnsToFitGridStrategy,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  RowClickedEvent,
  RowStyleModule,
  TooltipModule,
  themeQuartz,
} from 'ag-grid-community';
import { parseDurationDisplay } from '../../shared/utils/duration-format';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { BaseTableHeaderComponent } from './base-table-header.component';

export function reconcileColumnOrder(columns: string[] = [], columnOrder: string[] = []): string[] {
  const availableColumns = new Set(columns);
  const seen = new Set<string>();
  const ordered = columnOrder.filter((column) => {
    if (!availableColumns.has(column) || seen.has(column)) return false;
    seen.add(column);
    return true;
  });
  return [...ordered, ...columns.filter((column) => !seen.has(column))];
}

export function haveSameColumns(previous: string[] = [], current: string[] = []): boolean {
  return previous.length === current.length && previous.every((column, index) => column === current[index]);
}

@Component({
  selector: 'base-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    AgGridAngular,
  ],
  templateUrl: './base-table.component.html',
  styleUrls: ['./base-table.component.scss'],
})
export class BaseTableComponent implements OnInit, OnChanges, OnDestroy {
  @Input() columns: string[] = [];
  @Input() rows: any[] = [];
  @Input() selectedRow: any | null = null;
  @Input() disableSorting = false;
  @Input() getCellClass: ((value: any, column: string) => string) | null = null;
  @Input() responsiveHiddenColumns: { [breakpoint: number]: string[] } = {};
  @Input() columnTooltips: { [column: string]: string } = {};
  @Input() getCellTooltip: ((row: any, column: string) => string) | null = null;
  @Input() enableToolbar = true;
  @Input() enableSearch = true;
  @Input() enableCsvExport = true;
  @Input() exportFileName = 'chitrac-table-export.csv';
  @Input() columnEditMode = false;
  @Input() toggleableColumns: string[] = [];
  @Input() columnVisibility: Record<string, boolean> = {};
  @Input() columnOrder: string[] = [];
  @Input() fillAvailableWidth = false;

  @Output() rowClicked = new EventEmitter<any>();
  @Output() columnVisibilityChange = new EventEmitter<Record<string, boolean>>();
  @Output() columnOrderChange = new EventEmitter<string[]>();

  readonly modules: Module[] = [
    ClientSideRowModelModule,
    ClientSideRowModelApiModule,
    ColumnApiModule,
    ColumnAutoSizeModule,
    CsvExportModule,
    DragAndDropModule,
    QuickFilterModule,
    RenderApiModule,
    RowApiModule,
    CellStyleModule,
    RowStyleModule,
    TooltipModule,
    _ColumnMoveModule,
    _KeyboardNavigationModule,
    _SortModule,
  ];
  readonly gridTheme = themeQuartz;
  readonly autoSizeStrategy: SizeColumnsToFitGridStrategy = {
    type: 'fitGridWidth',
    defaultMinWidth: 85,
  };

  columnDefs: ColDef<any>[] = [];
  searchTerm = '';

  private gridApi: GridApi<any> | null = null;
  private lastGridWidth = 0;
  private readonly durationColumns = new Set([
    'Duration',
    'Total Duration',
    'Total Time (Runtime)',
    'Runtime',
    'Worked Time',
    'Downtime',
    'Paused Time',
    'Fault Time',
    'Down Time',
    'Run Time',
  ]);
  private readonly handleResize = () => this.rebuildColumnDefs();

  constructor(private percentBreakpointService: PercentBreakpointService) {}

  ngOnInit(): void {
    if (!this.columnDefs.length) this.rebuildColumnDefs();
    window.addEventListener('resize', this.handleResize);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const columnDefinitionInputs = [
      'columns',
      'columnTooltips',
      'disableSorting',
      'responsiveHiddenColumns',
      'columnEditMode',
      'toggleableColumns',
      'columnVisibility',
      'columnOrder',
      'fillAvailableWidth',
      'getCellClass',
      'getCellTooltip',
    ];

    const columnsChanged = changes['columns']
      ? !haveSameColumns(changes['columns'].previousValue, changes['columns'].currentValue)
      : false;
    const otherColumnDefinitionInputChanged = columnDefinitionInputs
      .filter((input) => input !== 'columns')
      .some((input) => changes[input]);

    if (!this.columnDefs.length || columnsChanged || otherColumnDefinitionInputChanged) {
      this.rebuildColumnDefs();
    }

    if (changes['selectedRow'] && this.gridApi) {
      this.gridApi.redrawRows();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
  }

  onGridReady(event: GridReadyEvent<any>): void {
    this.gridApi = event.api;
    this.applyFilter();
    this.applySavedColumnOrder();
    this.fitColumnsToGrid();
  }

  onGridSizeChanged(event: GridSizeChangedEvent<any>): void {
    if (this.fillAvailableWidth) return;
    if (event.clientWidth <= 0 || Math.abs(event.clientWidth - this.lastGridWidth) < 1) return;

    this.lastGridWidth = event.clientWidth;
    event.api.sizeColumnsToFit({ defaultMinWidth: this.columnEditMode ? 150 : 85 });
  }

  onColumnMoved(event: ColumnMovedEvent<any>): void {
    if (!this.columnEditMode || !event.finished || event.source !== 'uiColumnMoved') return;

    const orderedColumns = event.api
      .getAllGridColumns()
      .map((column) => column.getColId())
      .filter((column) => this.columns.includes(column));

    this.columnOrderChange.emit(orderedColumns);
  }

  onGridRowClicked(event: RowClickedEvent<any>): void {
    this.onRowClick(event.data);
  }

  applyFilter(): void {
    this.gridApi?.setGridOption('quickFilterText', this.searchTerm.trim().toLowerCase());
  }

  clearFilter(): void {
    this.searchTerm = '';
    this.applyFilter();
  }

  exportCsv(): void {
    this.gridApi?.exportDataAsCsv({
      fileName: this.exportFileName,
      processCellCallback: (params) => this.getCellExportValue(params.value),
    });
  }

  getFilteredRowCount(): number {
    if (!this.gridApi) return this.getRealRowCount();

    let count = 0;
    this.gridApi.forEachNodeAfterFilter((node) => {
      if (!node.data?.isDummy) count += 1;
    });
    return count;
  }

  getRealRowCount(): number {
    return (this.rows || []).filter((row) => !row?.isDummy).length;
  }

  onRowClick(row: any): void {
    if (row?.isDummy) return;
    this.rowClicked.emit(this.selectedRow !== row ? row : null);
  }

  getRowClass = (params: { data?: any }): string[] => {
    const classes: string[] = [];
    if (params.data?.cssClass) classes.push(params.data.cssClass);
    if (params.data?.isDummy) classes.push('dummy-row');
    if (params.data === this.selectedRow) classes.push('selected');
    return classes;
  };

  getEfficiencyClass(value: any): string {
    if (typeof value !== 'string' || !value.includes('%')) return '';
    return this.percentBreakpointService.getColorClass(value);
  }

  getCellClassForColumn(value: any, column: string): string {
    const customClass = this.getCellClass ? this.getCellClass(value, column) : '';
    if (customClass) return customClass;
    return column === 'Efficiency' ? this.getEfficiencyClass(value) : '';
  }

  isColumnToggleable(column: string): boolean {
    return this.toggleableColumns.includes(column);
  }

  isColumnEnabled(column: string): boolean {
    if (!this.isColumnToggleable(column)) return true;
    return this.columnVisibility?.[column] !== false;
  }

  onColumnToggle(column: string, enabled: boolean): void {
    if (!this.isColumnToggleable(column)) return;

    this.columnVisibilityChange.emit({
      ...(this.columnVisibility || {}),
      [column]: enabled,
    });
  }

  getTooltipForCell(row: any, column: string): string {
    const cellTooltip = this.getCellTooltip ? this.getCellTooltip(row, column) : '';
    return cellTooltip || this.columnTooltips?.[column] || '';
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

  private rebuildColumnDefs(): void {
    const hiddenColumns = this.getResponsiveHiddenColumns();
    const orderedColumns = reconcileColumnOrder(this.columns, this.columnOrder);

    this.columnDefs = orderedColumns.map((column) => ({
      colId: column,
      field: column,
      headerName: column,
      headerTooltip: this.columnTooltips?.[column] || undefined,
      hide: !this.columnEditMode && (hiddenColumns.has(column) || !this.isColumnEnabled(column)),
      sortable: !this.disableSorting && !this.columnEditMode,
      sortingOrder: ['asc', 'desc'],
      suppressMovable: !this.columnEditMode,
      suppressHeaderMenuButton: true,
      resizable: false,
      minWidth: this.columnEditMode ? 150 : 85,
      flex: this.fillAvailableWidth ? this.getInitialColumnWidth(column) : undefined,
      width: this.fillAvailableWidth ? undefined : this.getInitialColumnWidth(column),
      comparator: this.getComparator(column),
      tooltipValueGetter: (params) => this.getTooltipForCell(params.data, column) || undefined,
      cellClass: (params: CellClassParams<any>) => {
        const classes = [this.getCellClassForColumn(params.value, column)];
        if (this.columnEditMode && this.isColumnToggleable(column) && !this.isColumnEnabled(column)) {
          classes.push('column-disabled');
        }
        return classes.filter(Boolean);
      },
      cellRenderer: column === 'Status' ? (params: any) => this.createStatusCell(params.value) : undefined,
      headerComponentParams: {
        innerHeaderComponent: BaseTableHeaderComponent,
        innerHeaderComponentParams: {
          editMode: this.columnEditMode,
          toggleable: this.isColumnToggleable(column),
          enabled: this.isColumnEnabled(column),
          onToggle: (enabled: boolean) => this.onColumnToggle(column, enabled),
        },
      },
    }));

    if (this.gridApi) {
      this.gridApi.setGridOption('columnDefs', this.columnDefs);
      this.applySavedColumnOrder();
      this.fitColumnsToGrid();
    }
  }

  private applySavedColumnOrder(): void {
    if (!this.gridApi) return;

    const orderedColumns = reconcileColumnOrder(this.columns, this.columnOrder);
    this.gridApi.applyColumnState({
      state: orderedColumns.map((colId) => ({ colId })),
      applyOrder: true,
    });
  }

  private fitColumnsToGrid(): void {
    if (this.fillAvailableWidth) return;

    requestAnimationFrame(() => {
      this.gridApi?.sizeColumnsToFit({ defaultMinWidth: this.columnEditMode ? 150 : 85 });
    });
  }

  private getResponsiveHiddenColumns(): Set<string> {
    const hidden = new Set<string>();
    if (this.columnEditMode) return hidden;

    Object.entries(this.responsiveHiddenColumns || {}).forEach(([breakpointString, columns]) => {
      if (window.innerWidth < Number.parseInt(breakpointString, 10)) {
        columns.forEach((column) => hidden.add(column));
      }
    });
    return hidden;
  }

  private getComparator(column: string): (a: any, b: any) => number {
    if (this.durationColumns.has(column)) {
      return (a, b) => parseDurationDisplay(a) - parseDurationDisplay(b);
    }
    if (column === 'Start Time') {
      return (a, b) => new Date(a).getTime() - new Date(b).getTime();
    }
    return (a, b) => {
      const first = this.getSortableValue(a);
      const second = this.getSortableValue(b);
      if (typeof first === 'number' && typeof second === 'number') return first - second;
      return String(first).localeCompare(String(second), undefined, { numeric: true });
    };
  }

  private getInitialColumnWidth(column: string): number {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 120;

    context.font = '500 14px Montserrat';
    return Math.max(85, Math.ceil(context.measureText(column).width + 55));
  }

  private getSortableValue(value: any): string | number {
    if (typeof value === 'string' && value.trim().endsWith('%')) {
      const percentage = Number.parseFloat(value.replace('%', ''));
      return Number.isFinite(percentage) ? percentage : Number.NEGATIVE_INFINITY;
    }
    return value == null ? '' : value;
  }

  private createStatusCell(status: string): HTMLElement {
    const element = document.createElement('span');
    const statusClasses: Record<string, string> = {
      'Running Dot': 'green',
      'Paused Dot': 'yellow',
      'Faulted Dot': 'red',
      'Offline Dot': 'white',
    };
    element.className = `status-dot ${statusClasses[status] || 'white'}`;
    element.textContent = '\u25cf';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', this.getStatusAriaLabel(status));
    return element;
  }

  private getCellExportValue(value: any): string {
    if (typeof value !== 'string') return value == null ? '' : String(value);
    return value.replace(/<[^>]*>/g, '').trim();
  }
}
