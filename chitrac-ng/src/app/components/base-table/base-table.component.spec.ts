import { BaseTableComponent, haveSameColumns, reconcileColumnOrder } from './base-table.component';

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
