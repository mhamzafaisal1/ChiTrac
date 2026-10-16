import { of, throwError } from 'rxjs';
import { ShiftComparisonReportComponent } from './shift-comparison-report.component';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { ShiftService } from '../../services/shift.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { BaseTableComponent } from '../../components/base-table/base-table.component';

describe('Shift comparison report data', () => {
  const response = (name: string, count: number) => ({ results: [{ machine: { name }, machineSummary: {
    itemSummaries: { Total: { name: 'Total', countTotal: count, workedTimeFormatted: { hours: 1 }, pph: count },
      1: { name: 'Sheets', countTotal: count, workedTimeFormatted: { hours: 1 }, pph: count } }
  } }] });
  let service: any;
  let component: ShiftComparisonReportComponent;
  beforeEach(() => {
    service = jasmine.createSpyObj('DailyDashboardService', ['getMachineItemSessionsSummary']);
    service.getMachineItemSessionsSummary.and.callFake((_start: string, _end: string, _serial: unknown, shiftId: string) =>
      of(response(shiftId, shiftId === 'morning' ? 100 : 200)));
    component = new ShiftComparisonReportComponent(service, {} as any);
    component.selectedDate = new Date(2026, 9, 15);
    component.firstShiftId = 'morning';
    component.secondShiftId = 'afternoon';
  });

  it('requests both shift IDs and populates separate comparison panels', () => {
    component.fetchAnalyticsData();
    expect(service.getMachineItemSessionsSummary).toHaveBeenCalledTimes(2);
    expect(service.getMachineItemSessionsSummary.calls.argsFor(0)[3]).toBe('morning');
    expect(service.getMachineItemSessionsSummary.calls.argsFor(1)[3]).toBe('afternoon');
    expect(component.firstRows[0]['Total Count']).toBe(100);
    expect(component.secondRows[0]['Total Count']).toBe(200);
    expect(component.isLoading).toBeFalse();
  });

  it('keeps detailed and summary row references stable across change detection and mode toggles', () => {
    component.fetchAnalyticsData();
    expect(component.firstDisplayedRows).toBe(component.firstRows);
    component.showSummaryOnly = true;
    const first = component.firstDisplayedRows;
    const second = component.secondDisplayedRows;
    expect(first.length).toBe(1);
    expect(first[0]['Item']).toBe('Total');
    expect(component.firstDisplayedRows).toBe(first);
    expect(component.secondDisplayedRows).toBe(second);
    component.showSummaryOnly = false;
    expect(component.firstDisplayedRows).toBe(component.firstRows);
    component.showSummaryOnly = true;
    expect(component.firstDisplayedRows).toBe(first);
    component.fetchAnalyticsData();
    expect(component.firstDisplayedRows).not.toBe(first);
    expect(component.firstDisplayedRows[0]['Total Count']).toBe(100);
  });

  it('clears stale results and loading state when either shift request fails', () => {
    component.fetchAnalyticsData();
    spyOn(console, 'error');
    service.getMachineItemSessionsSummary.and.returnValue(throwError(() => new Error('offline')));
    component.fetchAnalyticsData();
    expect(component.firstRows).toEqual([]);
    expect(component.secondRows).toEqual([]);
    expect(component.isLoading).toBeFalse();
  });

  it('allows one shift to have no data without dropping the other panel', () => {
    service.getMachineItemSessionsSummary.and.returnValues(of({ results: [] }), of(response('afternoon', 200)));
    component.fetchAnalyticsData();
    expect(component.firstRows).toEqual([]);
    expect(component.secondRows.length).toBe(2);
    expect(component.hasResults).toBeTrue();
  });

  it('keeps rendered grid callbacks and summary data stable across change detection', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [ShiftComparisonReportComponent],
      providers: [provideNoopAnimations(), { provide: DailyDashboardService, useValue: service },
        { provide: ShiftService, useValue: { getActiveShifts: () => of({ shifts: [] }) } },
        { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } }]
    });
    const fixture = TestBed.createComponent(ShiftComparisonReportComponent);
    fixture.detectChanges();
    const report = fixture.componentInstance;
    report.firstShiftId = 'morning';
    report.secondShiftId = 'afternoon';
    report.fetchAnalyticsData();
    fixture.detectChanges(); tick(100); fixture.detectChanges();
    const tables = fixture.debugElement.queryAll(By.directive(BaseTableComponent)).map(table => table.componentInstance as BaseTableComponent);
    expect(tables.length).toBe(2);
    const callbacks = tables.map(table => table.getCellClass);
    report.showSummaryOnly = true;
    fixture.detectChanges(); tick(100); fixture.detectChanges();
    const rows = tables.map(table => table.rows);
    fixture.detectChanges(); tick(100); fixture.detectChanges();
    tables.forEach((table, index) => {
      expect(table.getCellClass).toBe(callbacks[index]);
      expect(table.rows).toBe(rows[index]);
      expect(table.rows.length).toBe(1);
    });
    fixture.destroy();
  }));
});
