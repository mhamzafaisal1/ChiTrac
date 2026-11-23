import { fakeAsync, tick } from '@angular/core/testing';
import { MachineReportComponent } from './machine-report/machine-report.component';
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


describe('Cascade machine reports and exports', () => {
  it('keeps a nonexpandable time summary and em dashes in CSV and PDF data', () => {
    const component: any = Object.create(MachineReportComponent.prototype); component.layout = { columns: [...REPORT_COLUMNS.machineReport] };
    const summary = { runtimeFormatted: { hours: 1, minutes: 0, seconds: 0 }, totalCount: 12, pph: 12, proratedStandard: 100, efficiency: 12,
      itemSummaries: { Total: { name: 'Total', countTotal: 12 }, 1: { name: 'Sheets', countTotal: 12 } } };
    component.processTableData([{ machine: { serial: 41, name: 'Renamed machine', type: 'Cascade' }, machineSummary: summary },
      { machine: { serial: 42, name: 'Cascade is only a name', type: 'SPF' }, machineSummary: summary }]);
    expect(component.reportGroups[0].expandable).toBeFalse(); expect(component.reportGroups[0].details).toEqual([]);
    expect(component.reportGroups[1].details.length).toBe(1);
    for (const key of ['Total Count','PPH','Standard','Efficiency']) expect(component.rows[0][key]).toBe('—');
    expect(component.rows[0]['Total Time (Runtime)']).not.toBe('—');
    expect(component.rows.filter((row: any) => row.Machine === 'Renamed machine').length).toBe(1);
    expect(reportCsv(component.columns,component.displayedRows)).toContain('—,—,—,—');
    expect(reportPdfTable('machineReport',component.layout.columns,component.displayedRows).body[0].slice(-4)).toEqual(['—','—','—','—']);
    component.showSummaryOnly = true; expect(component.displayedRows.some((row: any) => row.Machine === 'Renamed machine')).toBeTrue();
    expect(summary.totalCount).toBe(12);
  });
});


describe('Machine report CSV encoding', () => {
  it('downloads UTF-8 with a BOM and preserves em dashes and non-ASCII names', async () => {
    let downloaded!: Blob;
    spyOn(URL,'createObjectURL').and.callFake(blob => { downloaded = blob as Blob; return 'blob:csv-test'; });
    spyOn(HTMLAnchorElement.prototype,'click');
    fakeAsync(() => {
      const component: any = Object.create(MachineReportComponent.prototype);
      component.layout = { columns: [...REPORT_COLUMNS.machineReport] };
      component.rows = [{ Machine: 'Cascadé', Item: 'Total', 'Total Count': '—', PPH: '—', Standard: '—', Efficiency: '—' }];
      component.downloadMachineItemSummaryCsv(); tick(100); tick(500);
    })();
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(Array.from(bytes.slice(0,3))).toEqual([0xEF,0xBB,0xBF]);
    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).toContain('Cascadé'); expect(text).toContain('—,—,—,—');
  });
});
