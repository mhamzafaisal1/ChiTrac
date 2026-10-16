import { groupedTableRows, BaseTableGroup } from './base-table-groups';
import { BaseTableComponent } from './base-table.component';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

describe('Shared grid report groups', () => {
  const columns = ['Machine', 'Worked Time', 'Efficiency'];
  const groups: BaseTableGroup[] = [
    { key: 'a', summary: { Machine: 'Alpha', 'Worked Time': '2h', Efficiency: '90%' },
      details: [{ Item: 'Sheets', 'Worked Time': '1h', Efficiency: '95%', _tooltipItemId: 7 }] },
    { key: 'b', summary: { Machine: 'Beta', 'Worked Time': '1h', Efficiency: '70%' }, details: [] }
  ];

  it('shows collapsed summaries without changing export rows', () => {
    const rows = groupedTableRows(groups, new Set(), 'Machine');
    expect(rows.length).toBe(2);
    expect(rows[0].Machine).toBe('Alpha');
    expect(groups[0].summary['__baseTableGroup']).toBeUndefined();
  });
  it('puts item values immediately after their summary without duplicate headings', () => {
    const rows = groupedTableRows(groups, new Set(['a']), 'Machine');
    expect(rows.map(row => row.__baseTableGroup.kind)).toEqual(['summary', 'detail', 'summary']);
    expect(rows[1].Machine).toBe('Sheets');
    expect(rows[1]._tooltipItemId).toBe(7);
    expect(rows[0].__baseTableGroup.singleItem).toBe('Sheets');
    expect(new Set(rows.map(row => row.__baseTableGroup.id)).size).toBe(rows.length);
  });
  it('preserves an explicit empty detail state', () => {
    const rows = groupedTableRows(groups, new Set(['b']), 'Machine');
    expect(rows.at(-1).Machine).toBe('No item details');
    expect(rows.at(-1).__baseTableGroup.kind).toBe('empty-detail');
  });
  it('keeps item rows attached to their sorted summaries', () => {
    const table = new BaseTableComponent({} as any);
    table.rowGroups = groups;
    const rows = groupedTableRows(groups, new Set(['a']), 'Machine');
    const nodes = [rows[2], rows[1], rows[0]].map(data => ({ data }));
    table.postSortRows({ nodes } as any);
    expect(nodes.map(node => node.data.__baseTableGroup.key)).toEqual(['b', 'a', 'a']);
    expect(nodes.slice(1).map(node => node.data.__baseTableGroup.rank)).toEqual([0, 1]);
  });
  it('leaves ordinary dashboard sorting untouched', () => {
    const table = new BaseTableComponent({} as any);
    const nodes = [{ data: { Machine: 'Beta' } }, { data: { Machine: 'Alpha' } }];
    table.postSortRows({ nodes } as any);
    expect(nodes[0].data.Machine).toBe('Beta');
  });
  it('preserves ordinary dashboard row selection', () => {
    const table = new BaseTableComponent({} as any);
    table.selectedRow = { Machine: 'Alpha' };
    expect(table.getRowClass({ data: table.selectedRow })).toContain('selected');
    expect(table.getRowClass({ data: { Machine: 'Beta' } })).not.toContain('selected');
  });
  it('maps detail identity tooltips to Item rather than Machine', () => {
    const table = new BaseTableComponent({} as any);
    table.groupIdentityColumn = 'Machine';
    table.getCellTooltip = (_row, column) => column;
    const rows = groupedTableRows(groups, new Set(['a']), 'Machine');
    expect(table.getTooltipForCell(rows[0], 'Machine')).toBe('Machine');
    expect(table.getTooltipForCell(rows[1], 'Machine')).toBe('Item');
  });
  it('keeps mixed summary and detail values free of inferred numeric formatting', () => {
    const table = new BaseTableComponent({} as any);
    table.columns = columns;
    table.rowGroups = groups;
    table.groupIdentityColumn = 'Machine';
    table.ngOnInit();
    expect(table.columnDefs.every(column => column.cellDataType === false)).toBeTrue();
    table.ngOnDestroy();
  });

  it('preserves alpha mobile minimum widths alongside grouped identity sizing', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const table = new BaseTableComponent({} as any);
    try {
      table.columns = ['Status', 'Machine Name', 'Current Machine', 'PPH'];
      table.ngOnInit();
      const minimums = table.columnDefs.map(column => column.minWidth!);
      expect(minimums[0]).toBeGreaterThanOrEqual(64);
      expect(minimums[1]).toBeGreaterThanOrEqual(160);
      expect(minimums[2]).toBeGreaterThanOrEqual(140);
      expect(minimums[3]).toBeGreaterThanOrEqual(100);
    } finally {
      table.ngOnDestroy();
      Object.defineProperty(window, 'innerWidth', descriptor);
    }
  });

  it('keeps grouped report names at least 220px on mobile and desktop', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
    try {
      for (const width of [390, 1920]) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        const table = new BaseTableComponent({} as any);
        table.columns = columns;
        table.rowGroups = groups;
        table.groupIdentityColumn = 'Machine';
        table.columnEditMode = true;
        table.ngOnInit();
        expect(table.columnDefs[0].minWidth).toBe(220);
        expect(table.columnDefs[0].width).toBe(220);
        expect(table.columnDefs[1].minWidth).toBeGreaterThanOrEqual(150);
        table.ngOnDestroy();
      }
    } finally {
      Object.defineProperty(window, 'innerWidth', descriptor);
    }
  });
});

for (const identity of ['Machine', 'Operator']) {
  describe(`${identity} report rendered expansion`, () => {
    beforeEach(() => TestBed.configureTestingModule({
      imports: [BaseTableComponent],
      providers: [provideNoopAnimations(), { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } }]
    }));

    it('gives details and empty details a distinct themed background without a row-edge inset', fakeAsync(() => {
      const fixture = TestBed.createComponent(BaseTableComponent);
      const root: HTMLElement = fixture.nativeElement;
      root.style.width = '800px';
      root.style.setProperty('--theme-color-table-row-background', '#37414b');
      root.style.setProperty('--sg-color-blue-gray-light-300', '#1e2832');
      fixture.componentRef.setInput('columns', [identity, 'Efficiency']);
      fixture.componentRef.setInput('groupIdentityColumn', identity);
      fixture.componentRef.setInput('rowGroups', [
        { key: 'a', summary: { [identity]: 'Alpha' }, details: [{ Item: 'Sheets' }] },
        { key: 'b', summary: { [identity]: 'Beta' }, details: [] }
      ]);
      fixture.componentRef.setInput('enableToolbar', false);
      fixture.detectChanges(); tick(100); fixture.detectChanges();
      for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('.group-label'))) {
        button.click();
        fixture.detectChanges(); tick(100); fixture.detectChanges();
      }
      const detail = root.querySelector<HTMLElement>('.report-detail')!;
      const empty = root.querySelector<HTMLElement>('.report-empty-detail')!;
      const summary = root.querySelector<HTMLElement>('.report-summary')!;
      expect(getComputedStyle(detail).backgroundColor).toBe('rgb(30, 40, 50)');
      expect(getComputedStyle(empty).backgroundColor).toBe('rgb(30, 40, 50)');
      expect(getComputedStyle(summary).backgroundColor).toBe('rgb(55, 65, 75)');
      for (const row of [summary, detail, empty]) {
        expect(getComputedStyle(row).borderLeftWidth).toBe('0px');
        expect(getComputedStyle(row).borderRightWidth).toBe('0px');
        const firstCell = row.querySelector<HTMLElement>('.ag-cell[col-id="' + identity + '"]')!;
        expect(firstCell.getBoundingClientRect().left).toBeCloseTo(row.getBoundingClientRect().left, 0);
      }
      detail.style.transition = 'none';
      empty.style.transition = 'none';
      root.style.setProperty('--sg-color-blue-gray-light-300', '#eef0f9');
      expect(getComputedStyle(detail).backgroundColor).toBe('rgb(238, 240, 249)');
      expect(getComputedStyle(empty).backgroundColor).toBe('rgb(238, 240, 249)');
      fixture.destroy();
    }));

    it('preserves dashboard selection accents without consuming row width', fakeAsync(() => {
      const fixture = TestBed.createComponent(BaseTableComponent);
      const root: HTMLElement = fixture.nativeElement;
      root.style.width = '800px';
      root.style.setProperty('--border-left', '#00a6e7');
      const row = { [identity]: 'Alpha' };
      fixture.componentRef.setInput('columns', [identity]);
      fixture.componentRef.setInput('rows', [row]);
      fixture.componentRef.setInput('selectedRow', row);
      fixture.componentRef.setInput('enableToolbar', false);
      fixture.detectChanges(); tick(100); fixture.detectChanges();
      const selected = root.querySelector<HTMLElement>('.ag-row.selected')!;
      expect(getComputedStyle(selected).borderLeftWidth).toBe('0px');
      expect(getComputedStyle(selected).boxShadow).toContain('inset');
      expect(getComputedStyle(selected).boxShadow).toContain('4px');
      expect(selected.querySelector('.ag-cell')!.getBoundingClientRect().left)
        .toBeCloseTo(selected.getBoundingClientRect().left, 0);
      fixture.destroy();
    }));

    it('keeps repeated and simultaneous expansions header-free and unselected with reordered columns', fakeAsync(() => {
      const fixture = TestBed.createComponent(BaseTableComponent);
      const groups: BaseTableGroup[] = ['Alpha', 'Beta'].map(key => ({
        key, summary: { [identity]: key, Efficiency: '90%' },
        details: [{ Item: 'Sheets', Efficiency: '95%' }, { Item: 'Towels', Efficiency: '85%' }]
      }));
      const source = JSON.stringify(groups);
      fixture.componentRef.setInput('columns', [identity, 'Efficiency']);
      fixture.componentRef.setInput('columnOrder', ['Efficiency', identity]);
      fixture.componentRef.setInput('groupIdentityColumn', identity);
      fixture.componentRef.setInput('rowGroups', groups);
      fixture.componentRef.setInput('rows', groups.map(group => group.summary));
      fixture.componentRef.setInput('enableToolbar', false);
      fixture.nativeElement.style.width = '800px';
      fixture.detectChanges(); tick(100); fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      const emit = spyOn(fixture.componentInstance.rowClicked, 'emit');
      const click = (index: number) => {
        const button = root.querySelectorAll('.group-label')[index] as HTMLButtonElement;
        const wasExpanded = button.getAttribute('aria-expanded') === 'true';
        button.click();
        fixture.detectChanges(); tick(100); fixture.detectChanges();
        const refreshed = root.querySelectorAll('.group-label')[index];
        expect(refreshed.getAttribute('aria-expanded')).toBe(String(!wasExpanded));
        expect(refreshed.querySelector('mat-icon')!.textContent).toContain(wasExpanded ? 'chevron_right' : 'expand_more');
        expect(root.querySelector('.report-detail-header')).toBeNull();
        expect(root.querySelector('.ag-row.selected, .ag-row.ag-row-selected')).toBeNull();
        expect(root.querySelectorAll('.ag-header-row').length).toBe(1);
      };
      for (let repeat = 0; repeat < 3; repeat++) {
        click(0); click(1);
        expect(root.querySelectorAll('.report-detail').length).toBe(4);
        expect(root.querySelectorAll('.report-summary').length).toBe(2);
        click(0); click(1);
        expect(root.querySelectorAll('.report-detail').length).toBe(0);
      }
      expect(emit).not.toHaveBeenCalled();
      expect(fixture.componentInstance.columnDefs.map(column => column.colId)).toEqual(['Efficiency', identity]);
      expect(JSON.stringify(groups)).toBe(source);
      fixture.destroy();
    }));
  });
}
