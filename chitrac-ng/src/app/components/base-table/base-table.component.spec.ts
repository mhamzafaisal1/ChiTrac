import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { CASCADE_DASHBOARD_METRICS } from '../../shared/utils/machine-presentation';
import { BaseTableComponent, haveSameColumns, reconcileColumnOrder } from './base-table.component';

@Component({
  imports: [BaseTableComponent],
  template: `
    <base-table [columns]="['Name', 'Actions']" [rows]="rows" [rowIdentity]="rowIdentity"
      [pageSize]="5" [pageSizes]="[5, 10]" [cellTemplates]="{ Actions: actions }"
      [selectedRow]="selectedRow" [enableCsvExport]="false" [fillAvailableWidth]="true"
      emptyMessage="No users found." (rowClicked)="selectedRow = $event" />
    <ng-template #actions let-row>
      <button type="button" (click)="$event.stopPropagation(); actedOn = row.id">Edit {{ row.Name }}</button>
    </ng-template>
  `,
})
class PaginatedTableHost {
  rows = Array.from({ length: 12 }, (_, index) => ({ id: index, Name: `User ${index + 1}` }));
  rowIdentity = (row: { id: number }) => String(row.id);
  actedOn: number | null = null;
  selectedRow: (typeof this.rows)[number] | null = null;
}

describe('Paginated settings table', () => {
  it('searches every page and keeps a custom action tied to its record without selecting the row', fakeAsync(() => {
    TestBed.configureTestingModule({ imports: [PaginatedTableHost], providers: [provideNoopAnimations(),
      { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } }] });
    const fixture = TestBed.createComponent(PaginatedTableHost);
    const root: HTMLElement = fixture.nativeElement;
    root.style.display = 'block';
    root.style.width = '340px';
    const render = () => { fixture.detectChanges(); tick(100); fixture.detectChanges(); };
    const input = () => root.querySelector<HTMLInputElement>('input')!;
    const search = (term: string) => {
      input().value = term;
      input().dispatchEvent(new Event('input'));
      render();
    };
    try {
      render();
      expect(root.querySelectorAll('.ag-row[row-index]').length).toBe(5);
      search('User 12');
      expect(root.querySelector('.row-count')?.textContent).toContain('1 / 12 rows');
      const row = root.querySelector<HTMLElement>('.ag-row[row-index]')!;
      const action = row.querySelector<HTMLButtonElement>('button')!;
      expect(action.textContent).toContain('Edit User 12');
      action.click();
      expect(fixture.componentInstance.actedOn).toBe(11);
      expect(fixture.componentInstance.selectedRow).toBeNull();
      search('missing');
      expect(root.textContent).toContain('No matching rows.');
      search('');
      expect(root.querySelectorAll('.ag-row[row-index]').length).toBe(5);
    } finally {
      fixture.destroy();
    }
  }));
});

describe('reconcileColumnOrder', () => {
  it('applies a saved order and appends new columns', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Machine', 'Runtime', 'OEE'],
      ['Machine', 'Status', 'Runtime']
    )).toEqual(['Machine', 'Status', 'Runtime', 'OEE']);
  });

  it('removes duplicate and obsolete saved columns', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Machine', 'Runtime'],
      ['Runtime', 'Removed', 'Runtime', 'Machine']
    )).toEqual(['Runtime', 'Machine', 'Status']);
  });

  it('uses the source column order when no preference exists', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Operator', 'Efficiency'],
      []
    )).toEqual(['Status', 'Operator', 'Efficiency']);
  });
});

describe('Mobile table column sizing', () => {
  let component: BaseTableComponent;
  let originalWidth: PropertyDescriptor;
  const setWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const definition = (name: string) => component.columnDefs.find(column => column.colId === name)!;

  beforeEach(() => {
    originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
    setWidth(390);
    component = new BaseTableComponent({ getColorClass: () => '' } as any);
    component.columns = ['Status', 'Operator Name', 'Current Machine', 'Current Machine Serial', 'Worked Time'];
    component.ngOnInit();
    spyOn(window, 'requestAnimationFrame').and.callFake(callback => { callback(0); return 0; });
  });

  afterEach(() => {
    component.ngOnDestroy();
    Object.defineProperty(window, 'innerWidth', originalWidth);
  });

  it('gives mobile names and long headers readable minimum widths with compact status', () => {
    expect(definition('Operator Name').minWidth).toBeGreaterThanOrEqual(160);
    expect(definition('Current Machine').minWidth).toBeGreaterThanOrEqual(140);
    expect(definition('Current Machine Serial').minWidth).toBeGreaterThan(120);
    expect(definition('Worked Time').minWidth).toBeGreaterThanOrEqual(100);
    expect(definition('Status').minWidth!).toBeLessThan(100);
  });

  it('uses the same column limits on initial fit, grid resize and viewport changes', () => {
    const api = jasmine.createSpyObj('GridApi', ['setGridOption', 'applyColumnState', 'sizeColumnsToFit']);
    component.onGridReady({ api } as any);
    component.onGridSizeChanged({ api, clientWidth: 358 } as any);
    expect(api.sizeColumnsToFit.calls.allArgs()).toEqual([[], []]);
    expect(definition('Operator Name').minWidth).toBeGreaterThanOrEqual(160);
    setWidth(1024);
    window.dispatchEvent(new Event('resize'));
    expect(component.columnDefs.every(column => column.minWidth === 85)).toBeTrue();
    setWidth(768);
    window.dispatchEvent(new Event('resize'));
    expect(definition('Operator Name').minWidth).toBeGreaterThanOrEqual(160);
  });

  it('keeps edit-mode controls at least 150px wide and preserves saved order and visibility', () => {
    component.columnEditMode = true;
    component.columnOrder = ['Operator Name', 'Status'];
    component.ngOnChanges({ columnEditMode: {} as any });
    expect(component.columnDefs.every(column => column.minWidth! >= 150)).toBeTrue();
    expect(component.columnDefs[0].colId).toBe('Operator Name');
    expect(component.columnDefs.every(column => !column.hide)).toBeTrue();
    component.columnEditMode = false;
    component.responsiveHiddenColumns = { 768: ['Worked Time'] };
    component.ngOnChanges({ responsiveHiddenColumns: {} as any });
    expect(definition('Worked Time').hide).toBeTrue();
  });

  it('uses mobile minimums in flex-based modal tables without calling sizeColumnsToFit', () => {
    component.fillAvailableWidth = true;
    component.ngOnChanges({ fillAvailableWidth: {} as any });
    expect(definition('Operator Name').minWidth).toBeGreaterThanOrEqual(160);
    expect(definition('Operator Name').flex).toBeGreaterThanOrEqual(160);
    const api = jasmine.createSpyObj('GridApi', ['setGridOption', 'applyColumnState', 'sizeColumnsToFit']);
    component.onGridReady({ api } as any);
    component.onGridSizeChanged({ api, clientWidth: 358 } as any);
    expect(api.sizeColumnsToFit).not.toHaveBeenCalled();
  });
});

describe('haveSameColumns', () => {
  it('treats a new array with the same ordered columns as unchanged', () => {
    expect(haveSameColumns(
      ['Status', 'Machine', 'Runtime'],
      ['Status', 'Machine', 'Runtime']
    )).toBeTrue();
  });

  it('detects reordered, added, and removed columns', () => {
    expect(haveSameColumns(['Status', 'Machine'], ['Machine', 'Status'])).toBeFalse();
    expect(haveSameColumns(['Status'], ['Status', 'Machine'])).toBeFalse();
    expect(haveSameColumns(['Status', 'Machine'], ['Status'])).toBeFalse();
  });
});


describe('Rendered dashboard numeric placeholders', () => {
  it('preserves Cascade em dashes beside real numbers through refresh, sorting and CSV export', fakeAsync(() => {
    TestBed.configureTestingModule({ imports: [BaseTableComponent], providers: [provideNoopAnimations(),
      { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } }] });
    const fixture = TestBed.createComponent(BaseTableComponent), root: HTMLElement = fixture.nativeElement;
    root.style.width = '1600px';
    const columns = ['Machine Name', ...CASCADE_DASHBOARD_METRICS, 'Availability'];
    const row = (name: string, value: number | string) => ({ 'Machine Name': name,
      ...Object.fromEntries(CASCADE_DASHBOARD_METRICS.map(column => [column,value])), Availability: '75%' });
    fixture.componentRef.setInput('columns',columns);
    fixture.componentRef.setInput('mixedValueColumns',CASCADE_DASHBOARD_METRICS);
    fixture.componentRef.setInput('enableToolbar',false);
    fixture.componentRef.setInput('rows',[row('SPF',12),row('Cascade','—'),row('Blanket',3)]);
    fixture.detectChanges(); tick(100); fixture.detectChanges();
    const cell = (index: number,column: string) => root.querySelector<HTMLElement>('.ag-row[row-index="' + index + '"] .ag-cell[col-id="' + column + '"]')?.textContent?.trim();
    for (const column of CASCADE_DASHBOARD_METRICS) {
      expect(cell(0,column)).withContext(column + ' normal value').toBe('12');
      expect(cell(1,column)).withContext(column + ' Cascade value').toBe('—');
    }
    expect(root.textContent).not.toContain('Invalid Number');
    const api = (fixture.componentInstance as any).gridApi;
    const csv = api.getDataAsCsv(); expect(csv).toContain('—'); expect(csv).not.toContain('Invalid Number');
    api.applyColumnState({ state: [{ colId: 'Total Count', sort: 'asc' }] });
    const sorted: string[] = []; api.forEachNodeAfterFilterAndSort((node: any) => sorted.push(node.data['Machine Name']));
    expect(sorted.indexOf('Blanket')).toBeLessThan(sorted.indexOf('SPF'));
    fixture.componentRef.setInput('rows',[row('SPF',0),row('Cascade','—')]);
    fixture.detectChanges(); tick(100); fixture.detectChanges();
    expect(root.textContent).not.toContain('Invalid Number');
    const values: any[] = []; api.forEachNode((node: any) => values.push(node.data['Total Count']));
    expect(values).toEqual([0,'—']); fixture.destroy();
  }));
  it('keeps ordinary table data-type behavior unless a mixed column is explicitly configured', () => {
    const table = new BaseTableComponent({} as any); table.columns = ['Total Count','PPH']; table.ngOnInit();
    expect(table.columnDefs.every(column => column.cellDataType === undefined)).toBeTrue();
    table.mixedValueColumns = ['Total Count']; table.ngOnChanges({ mixedValueColumns: {} as any });
    expect(table.columnDefs[0].cellDataType).toBeFalse(); expect(table.columnDefs[1].cellDataType).toBeUndefined();
    table.ngOnDestroy();
  });
});
