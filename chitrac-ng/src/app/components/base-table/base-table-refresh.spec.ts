import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BaseTableComponent } from './base-table.component';
import { MachineDashboardComponent } from '../../machine-dashboard/machine-dashboard.component';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

describe('Machine dashboard table refresh', () => {
  let fixture: ComponentFixture<BaseTableComponent>;
  let dashboard: MachineDashboardComponent;
  const machine = (serial: number | string, efficiency = '95%') => ({
    'Serial Number': serial, 'Machine Name': `Machine ${serial}`, Efficiency: efficiency,
    OEE: efficiency, Status: 'Running Dot'
  });
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for grid update');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const row = (serial = 1): HTMLElement | null => fixture.nativeElement.querySelector(`.ag-row[row-id="machine:${serial}"]`);
  const cell = (column: string, serial = 1): HTMLElement | null => row(serial)?.querySelector(`[col-id="${column}"]`) ?? null;
  const refresh = async (rows: any[]) => {
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 50));
  };

  beforeEach(async () => {
    dashboard = new MachineDashboardComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any
    );
    await TestBed.configureTestingModule({
      imports: [BaseTableComponent],
      providers: [provideNoopAnimations(), {
        provide: PercentBreakpointService,
        useValue: new PercentBreakpointService({ getSettings: (): null => null } as any)
      }]
    }).compileComponents();
    fixture = TestBed.createComponent(BaseTableComponent);
    fixture.nativeElement.style.width = '1200px';
    fixture.componentRef.setInput('enableToolbar', false);
    fixture.componentRef.setInput('columns', ['Machine Name', 'Serial Number', 'Efficiency', 'OEE', 'Status']);
    fixture.componentRef.setInput('rowIdentity', dashboard.getMachineRowIdentity);
    fixture.componentRef.setInput('columnTooltips', { Efficiency: 'Percent of goal pace being achieved.' });
    const breakpoints = TestBed.inject(PercentBreakpointService);
    fixture.componentRef.setInput('getCellClass', (value: any, column: string) =>
      column === 'OEE' ? breakpoints.getOeColorClass(value) : column === 'Efficiency' ? breakpoints.getColorClass(value) : '');
    fixture.componentRef.setInput('rows', [machine(1), machine(2)]);
    fixture.detectChanges();
    await until(() => !!cell('Efficiency'));
    await until(() => !!(fixture.componentInstance as any).gridApi);
  });

  afterEach(() => fixture?.destroy());

  it('keeps row, cell, hover state and an open tooltip through repeated immutable refreshes', async () => {
    const originalRow = row()!;
    const originalCell = cell('Efficiency')!;
    originalRow.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    originalCell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    originalCell.dispatchEvent(new MouseEvent('mouseenter'));
    await until(() => { fixture.detectChanges(); return !!document.querySelector('.tracked-cell-tooltip'); });
    const tooltip = document.querySelector('.tracked-cell-tooltip');
    const hovered = originalRow.classList.contains('ag-row-hover');
    expect(hovered).toBeTrue();
    for (const value of ['75%', '50%', '99%']) {
      await refresh([machine('1', value), machine(2)]);
      expect(row()).toBe(originalRow);
      expect(cell('Efficiency')).toBe(originalCell);
      expect(originalCell.textContent).toContain(value);
      expect(originalRow.classList.contains('ag-row-hover')).toBeTrue();
      expect(document.querySelector('.tracked-cell-tooltip')).toBe(tooltip);
    }
    expect(originalCell.getAttribute('aria-describedby')).toContain(fixture.componentInstance.tooltipId);
    // Removing the hovered machine must dismiss the overlay rather than leave it orphaned.
    await refresh([machine(2)]);
    expect(document.querySelector('.tracked-cell-tooltip')).toBeNull();
    expect(originalCell.hasAttribute('aria-describedby')).toBeFalse();
  });

  it('removes obsolete colors when reused cells cross thresholds or become empty', async () => {
    const originalCell = cell('Efficiency')!;
    for (const [value, color] of [['75%', 'yellow'], ['50%', 'red'], ['99%', 'green'], ['', '']]) {
      await refresh([machine(1, value), machine(2)]);
      expect(cell('Efficiency')).toBe(originalCell);
      expect(['green', 'yellow', 'red'].filter(name => originalCell.classList.contains(name)))
        .toEqual(color ? [color] : []);
    }
    await refresh([machine(1, '85%'), machine(2)]);
    expect(cell('Efficiency')!.classList.contains('yellow')).toBeTrue();
    expect(cell('OEE')!.classList.contains('green')).toBeTrue();
  });

  it('preserves identity and selection when rows reorder, arrive, or disappear', async () => {
    fixture.componentRef.setInput('selectedRow', fixture.componentInstance.rows[0]);
    fixture.detectChanges();
    await until(() => !!row()?.classList.contains('selected'));
    const originalRow = row();
    await refresh([machine(3), machine(2), machine('1', '75%')]);
    expect(row()).toBe(originalRow);
    expect(row()!.classList.contains('selected')).toBeTrue();
    expect(row(3)).not.toBeNull();
    await refresh([machine(3), machine('1', '50%')]);
    expect(row()).toBe(originalRow);
    expect(row(2)).toBeNull();
    const clicked = jasmine.createSpy('rowClicked');
    fixture.componentInstance.rowClicked.subscribe(clicked);
    fixture.componentInstance.onRowClick(machine('1'));
    expect(clicked).toHaveBeenCalledWith(null);
    fixture.componentRef.setInput('selectedRow', null);
    fixture.detectChanges();
    await until(() => !row()!.classList.contains('selected'));
  });

  it('gives placeholders and missing serials separate identities without colliding with machines', () => {
    const placeholders = [{ isDummy: true }, { isDummy: true }];
    const missing = {};
    const key = dashboard.getMachineRowIdentity;
    expect(key(machine(1))).toBe(key(machine('1')));
    expect(key(placeholders[0])).toBe(key(placeholders[0]));
    expect(new Set([key(placeholders[0]), key(placeholders[1]), key(missing), key(machine(0))]).size).toBe(4);
  });

  it('preserves filtering and sorting while receiving new values and machines', async () => {
    const api = (fixture.componentInstance as any).gridApi;
    api.applyColumnState({ state: [{ colId: 'Serial Number', sort: 'desc' }] });
    fixture.componentInstance.searchTerm = 'Machine 1';
    fixture.componentInstance.applyFilter();
    await refresh([machine(2), machine(1, '75%'), machine(3)]);
    expect(api.getDisplayedRowCount()).toBe(1);
    expect(api.getDisplayedRowAtIndex(0).data.Efficiency).toBe('75%');
    expect(api.getColumnState().find((column: any) => column.colId === 'Serial Number').sort).toBe('desc');
    fixture.componentInstance.clearFilter();
    expect(api.getDisplayedRowCount()).toBe(3);
    expect(api.getDisplayedRowAtIndex(0).data['Serial Number']).toBe(3);
  });
});
