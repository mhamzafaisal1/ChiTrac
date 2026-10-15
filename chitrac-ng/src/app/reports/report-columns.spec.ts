import { REPORT_COLUMNS, reconcileReportColumns, reportCsvColumns, reportPdfTable, reportCsv, ReportLayoutId } from './report-columns';
import { TestBed } from '@angular/core/testing';
import { BaseTableHeaderComponent } from '../components/base-table/base-table-header.component';

describe('Report column order and exports', () => {
  for (const id of Object.keys(REPORT_COLUMNS) as ReportLayoutId[]) {
    it(`${id} reconciles duplicate, removed and missing columns`, () => {
      const order = reconcileReportColumns(id, ['Efficiency', 'Unknown', 'Efficiency']);
      expect(order[0]).toBe('Efficiency');
      expect(order.length).toBe(REPORT_COLUMNS[id].length);
      expect(new Set(order).size).toBe(order.length);
    });

    it(`${id} preserves headers, values and identity widths when identity moves`, () => {
      const identity = REPORT_COLUMNS[id][0];
      const order = [...REPORT_COLUMNS[id].slice(1), identity];
      const row = Object.fromEntries([...REPORT_COLUMNS[id], 'Item'].map(column => [column, `${column} value`]));
      const pdf = reportPdfTable(id, order, [row]);
      expect(pdf.identityIndex).toBe(order.length - 1);
      expect(pdf.head[0][0]).toBe(order[0]);
      expect(pdf.body[0][0]).toBe(row[order[0]]);
      expect(pdf.body[0].at(-1)).toBe(id === 'itemReport' ? row[identity] : `${row[identity]} / ${row['Item']}`);
      const csvColumns = reportCsvColumns(id, order);
      expect(csvColumns[0]).toBe(order[0]);
      expect(csvColumns.slice(-2)).toEqual(id === 'itemReport' ? ['Efficiency', identity] : [identity, 'Item']);
      expect(reportCsv(csvColumns, [row]).split('\n')[0]).toBe(csvColumns.join(','));
    });
  }

  it('escapes quotes, commas and newlines while keeping values aligned', () => {
    expect(reportCsv(['PPH', 'Item Name'], [{ PPH: 120, 'Item Name': 'Sheets, "large"\nwhite' }]))
      .toBe('PPH,Item Name\n120,"Sheets, ""large""\nwhite"');
  });
});

describe('Reorder-only item report headers', () => {
  for (const reorderOnly of [true, false]) {
    it(`preserves dashboard header spacing when reorderOnly is ${reorderOnly}`, () => {
      TestBed.configureTestingModule({ imports: [BaseTableHeaderComponent] });
      const fixture = TestBed.createComponent(BaseTableHeaderComponent);
      fixture.componentInstance.agInit({ displayName: 'Item Name', editMode: true, reorderOnly,
        toggleable: false, enabled: true, onToggle: () => {} } as any);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.visibility-toggle-slot').length).toBe(reorderOnly ? 0 : 1);
      expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeNull();
      fixture.destroy();
    });
  }
});
