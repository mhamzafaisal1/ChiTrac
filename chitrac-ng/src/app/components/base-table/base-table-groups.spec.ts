import { groupedTableRows, BaseTableGroup } from './base-table-groups';
import { BaseTableComponent } from './base-table.component';

describe('Shared grid report groups', () => {
  const columns = ['Machine', 'Worked Time', 'Efficiency'];
  const groups: BaseTableGroup[] = [
    { key: 'a', summary: { Machine: 'Alpha', 'Worked Time': '2h', Efficiency: '90%' },
      details: [{ Item: 'Sheets', 'Worked Time': '1h', Efficiency: '95%', _tooltipItemId: 7 }] },
    { key: 'b', summary: { Machine: 'Beta', 'Worked Time': '1h', Efficiency: '70%' }, details: [] }
  ];

  it('shows collapsed summaries without changing export rows', () => {
    const rows = groupedTableRows(groups, new Set(), columns, 'Machine');
    expect(rows.length).toBe(2);
    expect(rows[0].Machine).toBe('Alpha');
    expect(groups[0].summary['__baseTableGroup']).toBeUndefined();
  });
  it('puts summary, item heading and item values into the same grid columns', () => {
    const rows = groupedTableRows(groups, new Set(['a']), ['Efficiency', 'Machine', 'Worked Time'], 'Machine');
    expect(rows.map(row => row.__baseTableGroup.kind)).toEqual(['summary', 'detail-header', 'detail', 'summary']);
    expect(rows[1].Machine).toBe('Item');
    expect(rows[2].Machine).toBe('Sheets');
    expect(rows[2]._tooltipItemId).toBe(7);
    expect(rows[0].__baseTableGroup.singleItem).toBe('Sheets');
    expect(new Set(rows.map(row => row.__baseTableGroup.id)).size).toBe(rows.length);
  });
  it('preserves an explicit empty detail state', () => {
    const rows = groupedTableRows(groups, new Set(['b']), columns, 'Machine');
    expect(rows.at(-1).Machine).toBe('No item details');
    expect(rows.at(-1).__baseTableGroup.kind).toBe('empty-detail');
  });
  it('keeps item rows attached to their sorted summaries', () => {
    const table = new BaseTableComponent({} as any);
    table.rowGroups = groups;
    const rows = groupedTableRows(groups, new Set(['a']), columns, 'Machine');
    const nodes = [rows[3], rows[2], rows[0], rows[1]].map(data => ({ data }));
    table.postSortRows({ nodes } as any);
    expect(nodes.map(node => node.data.__baseTableGroup.key)).toEqual(['b', 'a', 'a', 'a']);
    expect(nodes.slice(1).map(node => node.data.__baseTableGroup.rank)).toEqual([0, 1, 2]);
  });
  it('leaves ordinary dashboard sorting untouched', () => {
    const table = new BaseTableComponent({} as any);
    const nodes = [{ data: { Machine: 'Beta' } }, { data: { Machine: 'Alpha' } }];
    table.postSortRows({ nodes } as any);
    expect(nodes[0].data.Machine).toBe('Beta');
  });
  it('maps detail identity tooltips to Item rather than Machine', () => {
    const table = new BaseTableComponent({} as any);
    table.groupIdentityColumn = 'Machine';
    table.getCellTooltip = (_row, column) => column;
    const rows = groupedTableRows(groups, new Set(['a']), columns, 'Machine');
    expect(table.getTooltipForCell(rows[0], 'Machine')).toBe('Machine');
    expect(table.getTooltipForCell(rows[2], 'Machine')).toBe('Item');
    expect(table.getTooltipForCell(rows[1], 'Machine')).toBe('');
  });
  it('does not apply numeric formatters to mixed report heading rows', () => {
    const table = new BaseTableComponent({} as any);
    table.columns = columns;
    table.rowGroups = groups;
    table.groupIdentityColumn = 'Machine';
    table.ngOnInit();
    expect(table.columnDefs.every(column => column.cellDataType === false)).toBeTrue();
    table.ngOnDestroy();
  });
});
