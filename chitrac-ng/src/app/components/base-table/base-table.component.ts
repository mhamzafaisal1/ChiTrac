import {
  Component,
  ElementRef,
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
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  _ColumnMoveModule,
  _KeyboardNavigationModule,
  _SortModule,
  CellClassParams,
  CellMouseOverEvent,
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
  PostSortRowsParams,
  GetRowIdParams,
} from 'ag-grid-community';
import { parseDurationDisplay } from '../../shared/utils/duration-format';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { BaseTableHeaderComponent } from './base-table-header.component';
import { BaseTableGroup, groupedTableRows } from './base-table-groups';
import { BaseTableGroupCellComponent } from './base-table-group-cell.component';

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

let nextTooltipId = 0;

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
    OverlayModule,
  ],
  templateUrl: './base-table.component.html',
  styleUrls: ['./base-table.component.scss'],
})
export class BaseTableComponent implements OnInit, OnChanges, OnDestroy {
  @Input() columns: string[] = [];
  @Input() rows: any[] = [];
  /** Supply before grid creation when immutable refreshes should preserve row nodes. */
  @Input() rowIdentity: ((row: any) => string) | null = null;
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
  @Input() columnReorderOnly = false;
  @Input() toggleableColumns: string[] = [];
  @Input() columnVisibility: Record<string, boolean> = {};
  @Input() columnOrder: string[] = [];
  @Input() fillAvailableWidth = false;
  @Input() rowGroups: BaseTableGroup[] | null = null;
  @Input() groupIdentityColumn = '';
  groupedRows: any[] = [];
  private expandedGroups = new Set<string>();

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
  };

  columnDefs: ColDef<any>[] = [];
  searchTerm = '';

  private gridApi: GridApi<any> | null = null;
  private lastGridWidth = 0;
  tooltipOrigin: ElementRef<HTMLElement> | null = null;
  visibleTooltip = '';
  readonly tooltipId = `tracked-table-tooltip-${nextTooltipId++}`;
  readonly tooltipPositions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  ];
  private hoveredCell: { rowId: string; column: string; element: HTMLElement } | null = null;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly dismissTooltipOnScroll = () => this.closeCellTooltip();
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
    window.addEventListener('scroll', this.dismissTooltipOnScroll, true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rowGroups'] || changes['groupIdentityColumn'] || changes['columns']) {
      const validKeys = new Set(this.rowGroups?.map(group => group.key));
      this.expandedGroups = new Set([...this.expandedGroups].filter(key => validKeys.has(key)));
      this.refreshGroupedRows();
    }
    const columnDefinitionInputs = [
      'columns',
      'columnTooltips',
      'disableSorting',
      'responsiveHiddenColumns',
      'columnEditMode',
      'columnReorderOnly',
      'toggleableColumns',
      'columnVisibility',
      'columnOrder',
      'fillAvailableWidth',
      'getCellClass',
      'getCellTooltip',
      'groupIdentityColumn',
      'rowGroups',
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
    if (changes['rows'] || changes['columnTooltips'] || changes['getCellTooltip']) {
      this.refreshCellTooltip();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('scroll', this.dismissTooltipOnScroll, true);
    this.closeCellTooltip();
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
    event.api.sizeColumnsToFit();
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
    if (this.rowGroups) {
      if (event.data?.__baseTableGroup?.kind === 'summary') this.toggleGroup(event.data.__baseTableGroup.key);
      return;
    }
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
    this.rowClicked.emit(this.isSelectedRow(row) ? null : row);
  }

  private isSelectedRow(row: any): boolean {
    if (!row || !this.selectedRow) return false;
    return this.rowIdentity
      ? this.rowIdentity(row) === this.rowIdentity(this.selectedRow)
      : row === this.selectedRow;
  }

  readonly getDataRowId = (params: GetRowIdParams): string => this.rowIdentity!(params.data);

  getRowClass = (params: { data?: any }): string[] => {
    const classes: string[] = [];
    const group = params.data?.__baseTableGroup;
    if (group) {
      classes.push(`report-${group.kind}`);
    }
    if (params.data?.cssClass) classes.push(params.data.cssClass);
    if (params.data?.isDummy) classes.push('dummy-row');
    if (!group && this.isSelectedRow(params.data)) classes.push('selected');
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
    if (row?.__baseTableGroup?.kind === 'detail' && column === this.groupIdentityColumn) column = 'Item';
    const cellTooltip = this.getCellTooltip ? this.getCellTooltip(row, column) : '';
    return cellTooltip || this.columnTooltips?.[column] || '';
  }

  onCellMouseOver(event: CellMouseOverEvent): void {
    if (!this.rowIdentity || this.rowGroups || !event.data || event.data.isDummy) return;
    const element = (event.event?.target as HTMLElement | null)?.closest<HTMLElement>('.ag-cell');
    if (!element || this.hoveredCell?.element === element) return;
    this.closeCellTooltip();
    const column = event.column.getColId();
    if (!this.getTooltipForCell(event.data, column)) return;
    this.hoveredCell = { rowId: this.rowIdentity(event.data), column, element };
    this.tooltipOrigin = new ElementRef(element);
    this.tooltipTimer = setTimeout(() => {
      this.tooltipTimer = null;
      this.refreshCellTooltip(true);
      // Match AG Grid's default maximum display time without restarting on refresh.
      this.tooltipHideTimer = setTimeout(() => this.closeCellTooltip(), 10000);
    }, 700);
  }

  closeCellTooltip(): void {
    if (this.tooltipTimer !== null) clearTimeout(this.tooltipTimer);
    if (this.tooltipHideTimer !== null) clearTimeout(this.tooltipHideTimer);
    this.tooltipTimer = null;
    this.tooltipHideTimer = null;
    const element = this.hoveredCell?.element;
    if (element) {
      const descriptions = (element.getAttribute('aria-describedby') || '').split(/\s+/)
        .filter(id => id && id !== this.tooltipId);
      if (descriptions.length) element.setAttribute('aria-describedby', descriptions.join(' '));
      else element.removeAttribute('aria-describedby');
    }
    this.visibleTooltip = '';
    this.hoveredCell = null;
    this.tooltipOrigin = null;
  }

  private refreshCellTooltip(show = false): void {
    if (!this.hoveredCell || !this.rowIdentity) return;
    const { rowId, column, element } = this.hoveredCell;
    const currentRow = this.rows.find(row => this.rowIdentity!(row) === rowId);
    const message = currentRow && this.getTooltipForCell(currentRow, column);
    if (!message || !element.isConnected) {
      this.closeCellTooltip();
    } else if (show || this.visibleTooltip) {
      this.visibleTooltip = message;
      const descriptions = new Set((element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      descriptions.add(this.tooltipId);
      element.setAttribute('aria-describedby', [...descriptions].join(' '));
    }
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
    this.closeCellTooltip();
    const hiddenColumns = this.getResponsiveHiddenColumns();
    const orderedColumns = reconcileColumnOrder(this.columns, this.columnOrder);

    this.columnDefs = orderedColumns.map((column) => ({
      colId: column,
      field: column,
      headerName: column,
      cellDataType: this.rowGroups ? false : undefined,
      // Expansion updates renderer metadata while the displayed identity stays the same.
      equals: this.rowGroups && column === this.groupIdentityColumn ? () => false : undefined,
      headerTooltip: this.columnTooltips?.[column] || undefined,
      hide: !this.columnEditMode && (hiddenColumns.has(column) || !this.isColumnEnabled(column)),
      sortable: !this.disableSorting && !this.columnEditMode,
      sortingOrder: ['asc', 'desc'],
      suppressMovable: !this.columnEditMode,
      suppressHeaderMenuButton: true,
      resizable: false,
      minWidth: this.getMinimumColumnWidth(column),
      flex: this.fillAvailableWidth ? this.getInitialColumnWidth(column) : undefined,
      width: this.fillAvailableWidth ? undefined : this.getInitialColumnWidth(column),
      comparator: this.rowGroups ? (a, b, nodeA, nodeB) => this.getComparator(column)(
        nodeA.data?.__baseTableGroup?.summary[column] ?? a,
        nodeB.data?.__baseTableGroup?.summary[column] ?? b) : this.getComparator(column),
      // AG Grid hides its own cell tooltip on every refresh, even for identical text.
      // Tracked tables use the connected overlay below, owned by the hover session.
      tooltipValueGetter: this.rowIdentity && !this.rowGroups ? undefined
        : (params) => this.getTooltipForCell(params.data, column) || undefined,
      cellClass: (params: CellClassParams<any>) => {
        // These dynamic classes are managed by rules so reused cells lose old colors.
        return this.getCellClassForColumn(params.value, column).split(/\s+/)
          .filter(name => name && !['green', 'yellow', 'red', 'white', 'column-disabled'].includes(name));
      },
      cellClassRules: {
        ...Object.fromEntries(['green', 'yellow', 'red', 'white'].map(name => [name,
          (params: CellClassParams<any>) => this.getCellClassForColumn(params.value, column).split(/\s+/).includes(name)
        ])),
        'column-disabled': () => this.columnEditMode && this.isColumnToggleable(column) && !this.isColumnEnabled(column),
      },
      cellRenderer: this.rowGroups && column === this.groupIdentityColumn ? BaseTableGroupCellComponent
        : column === 'Status' ? (params: any) => this.createStatusCell(params.value) : undefined,
      cellRendererParams: { onToggle: (key: string) => this.toggleGroup(key) },
      headerComponentParams: {
        innerHeaderComponent: BaseTableHeaderComponent,
        innerHeaderComponentParams: {
          editMode: this.columnEditMode,
          reorderOnly: this.columnReorderOnly,
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
      this.gridApi?.sizeColumnsToFit();
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

  private getMinimumColumnWidth(column: string): number {
    if (this.rowGroups && column === this.groupIdentityColumn) return 220;
    if (window.innerWidth <= 768) return this.getInitialColumnWidth(column);
    return this.columnEditMode ? 150 : 85;
  }

  private getInitialColumnWidth(column: string): number {
    if (this.rowGroups && column === this.groupIdentityColumn) return 220;
    const mobile = window.innerWidth <= 768;
    const nameColumns = ['Operator Name', 'Machine Name', 'Operator', 'Machine', 'Item', 'Item Name', 'Fault Type'];
    const mobileMinimum = column === 'Status' ? 64 : nameColumns.includes(column) ? 160 : column === 'Current Machine' ? 140 : 100;
    const minimum = mobile ? Math.max(mobileMinimum, this.columnEditMode ? 150 : 0) : 85;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return Math.max(minimum, 120);

    context.font = mobile ? '500 12px Montserrat' : '500 14px Montserrat';
    // Leave room for padding and sorting without squeezing mobile headers.
    return Math.max(minimum, Math.ceil(context.measureText(column).width + (mobile ? 40 : 55)));
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

  private refreshGroupedRows(): void {
    this.groupedRows = groupedTableRows(this.rowGroups ?? [], this.expandedGroups, this.groupIdentityColumn);
  }

  private toggleGroup(key: string): void {
    if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
    else this.expandedGroups.add(key);
    this.refreshGroupedRows();
  }

  readonly getGroupedRowId = (params: GetRowIdParams): string => params.data.__baseTableGroup.id;

  readonly postSortRows = (params: PostSortRowsParams): void => {
    if (!this.rowGroups) return;
    // Sort summaries with AG Grid, then keep each group's details attached.
    const groups = new Map<string, typeof params.nodes>();
    for (const node of params.nodes) {
      const key = node.data.__baseTableGroup.key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(node);
    }
    params.nodes.splice(0, params.nodes.length, ...[...groups.values()].flatMap(nodes =>
      nodes.sort((a, b) => a.data.__baseTableGroup.rank - b.data.__baseTableGroup.rank)));
  };
}
