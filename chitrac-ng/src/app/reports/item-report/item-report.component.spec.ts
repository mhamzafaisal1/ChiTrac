import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ItemReportComponent } from './item-report.component';
import { BaseTableComponent } from '../../components/base-table/base-table.component';
import { ReportsService } from '../../services/reports.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';

@Component({
  standalone: true,
  imports: [BaseTableComponent],
  template: `<base-table [columns]="report.columns" [rows]="report.rows"
    [getCellTooltip]="report.getCellTooltip" [fillAvailableWidth]="true"></base-table>`
})
class ItemTableHost {
  report = new ItemReportComponent({} as ReportsService, null!, new ElementRef(document.createElement('div')));
}

describe('Item report table sizing', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ItemTableHost],
      providers: [provideNoopAnimations(),
        { provide: ReportsService, useValue: {} },
        { provide: PercentBreakpointService, useValue: { getDashboardColor: () => 'green' } }
      ]
    });
    await TestBed.compileComponents();
  });

  it('uses flex columns without rebuilding their definitions on repeated checks', fakeAsync(() => {
    const fixture = TestBed.createComponent(ItemTableHost);
    fixture.componentInstance.report.columns = ['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency'];
    fixture.componentInstance.report.rows = [{ 'Item Name': 'Sheets', '_tooltipItemId': 1 }];
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    const table = fixture.debugElement.query(By.directive(BaseTableComponent)).componentInstance as BaseTableComponent;
    expect(table.fillAvailableWidth).toBeTrue();
    expect(table.columnDefs.every(column => Number(column.flex) > 0 && column.width === undefined)).toBeTrue();
    const definitions = table.columnDefs;
    const tooltip = table.getCellTooltip;
    fixture.detectChanges();
    expect(table.columnDefs).toBe(definitions);
    expect(table.getCellTooltip).toBe(tooltip);
    expect(tooltip?.(fixture.componentInstance.report.rows[0], 'Item Name')).toBe('Item ID: 1');
    fixture.destroy(); tick(32);
  }));

  it('keeps report formatting and tooltip IDs on data regeneration', () => {
    const service = TestBed.inject(ReportsService);
    const report = new ItemReportComponent(service, null!, new ElementRef(document.createElement('div')));
    service.getItemReport = jasmine.createSpy().and.returnValue(of([{ itemId: 7, itemName: 'Sheets',
      workedTimeFormatted: { hours: 1, minutes: 2 }, count: 500, pph: 480, standard: 450, efficiency: 106.67
    }]));
    report.ngOnInit();
    report.fetchAnalyticsData();
    expect(report.rows[0]['Item Name']).toBe('Sheets');
    expect(report.rows[0]['Efficiency']).toBe('106.67%');
    expect(report.getCellTooltip(report.rows[0], 'Item Name')).toBe('Item ID: 7');
    expect(report.getCellTooltip(report.rows[0], 'Efficiency')).toBe('');
    const callback = report.getCellTooltip;
    report.fetchAnalyticsData();
    expect(report.getCellTooltip).toBe(callback);
    report.ngOnDestroy();
  });
});
import { Component, ElementRef } from '@angular/core';
