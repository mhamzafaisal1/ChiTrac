import { SimpleChange } from '@angular/core';
import { of } from 'rxjs';
import { TimeframePickerComponent } from './timeframe-picker.component';
import { ReportsService } from '../../services/reports.service';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { MachineReportComponent } from '../../reports/machine-report/machine-report.component';
import { OperatorReportComponent } from '../../reports/operator-report/operator-report.component';
import { ItemReportComponent } from '../../reports/item-report/item-report.component';
import { FaultReportComponent } from '../../reports/fault-report/fault-report.component';

describe('TimeframePickerComponent', () => {
  let component: TimeframePickerComponent;
  let shifts: jasmine.Spy;
  beforeEach(() => {
    shifts = jasmine.createSpy('getActiveShifts').and.returnValue(of({ shifts: [] }));
    component = new TimeframePickerComponent({ getActiveShifts: shifts } as any);
    component.start = new Date(2026, 9, 7, 8);
    component.end = new Date(2026, 9, 7, 16);
    component.ngOnChanges({ start: new SimpleChange(null, component.start, true) });
  });
  afterEach(() => component.ngOnDestroy());

  it('keeps draft edits isolated and emits cloned dates only on Confirm', () => {
    const confirmed = jasmine.createSpy('confirmed');
    component.confirmed.subscribe(confirmed);
    component.pickerStart!.setHours(10);
    component.selectShift('shift-one');
    expect((component.start as Date).getHours()).toBe(8);
    expect(confirmed).not.toHaveBeenCalled();
    component.confirm();
    const result = confirmed.calls.mostRecent().args[0];
    expect(result.shiftId).toBe('shift-one');
    expect(result.start.getHours()).toBe(10);
    expect(result.start).not.toBe(component.pickerStart);
  });

  it('rejects missing, invalid and reversed dates', () => {
    const confirmed = jasmine.createSpy('confirmed');
    component.confirmed.subscribe(confirmed);
    for (const value of [null, new Date('invalid'), new Date(2026, 9, 8)]) {
      component.pickerStart = value;
      expect(component.valid).toBeFalse();
      component.confirm();
    }
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('does not discard drafts when shifts load or the disabled input changes', () => {
    component.pickerStart!.setHours(11);
    component.ngOnChanges({ disabled: new SimpleChange(false, true, false) });
    component.ngOnChanges({ shifts: new SimpleChange([], [], false) });
    expect(component.pickerStart!.getHours()).toBe(11);
  });

  it('loads shifts only when they are not supplied by the caller', () => {
    component.shifts = [];
    component.ngOnInit();
    expect(shifts).not.toHaveBeenCalled();
    component.shifts = null;
    component.ngOnInit();
    expect(shifts).toHaveBeenCalledTimes(1);
  });

  it('presets use local calendar boundaries and clear the shift filter', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2026, 9, 8, 13, 30));
      for (const [mode, month, day] of [['today', 9, 8], ['thisWeek', 9, 4], ['thisMonth', 9, 1], ['thisYear', 0, 1]] as const) {
        component.selectShift('shift-one');
        component.quickSelect(mode);
        expect(component.pickerStart).toEqual(new Date(2026, month, day));
        expect(component.pickerEnd).toEqual(new Date(2026, 9, 8, 13, 30));
        expect(component.pickerShiftId).toBeNull();
      }
    } finally { jasmine.clock().uninstall(); }
  });

  it('does not emit or change presets while disabled', () => {
    const confirmed = jasmine.createSpy('confirmed');
    component.confirmed.subscribe(confirmed);
    component.disabled = true;
    component.quickSelect('today');
    component.selectShift('shift-one');
    component.confirm();
    expect(component.pickerMode).toBe('custom');
    expect(confirmed).not.toHaveBeenCalled();
  });
});

describe('Report timeframe query parameters', () => {
  it('applies confirmed dates and clears old results before fetching in every report', () => {
    for (const type of [MachineReportComponent, OperatorReportComponent, ItemReportComponent, FaultReportComponent]) {
      const report = Object.create(type.prototype);
      report.rows = ['old results'];
      report.reportGroups = ['old groups'];
      const fetch = jasmine.createSpy('fetch');
      report.fetchAnalyticsData = fetch;
      report.fetchFaultReport = fetch;
      const selection = { start: new Date(2026, 9, 7, 8), end: new Date(2026, 9, 7, 16), shiftId: 'shift-one', mode: 'shift' as const };
      report.applyTimeframe(selection);
      expect(report.startTime).toBe(selection.start.toISOString());
      expect(report.endTime).toBe(selection.end.toISOString());
      expect(report.selectedShiftId).toBe('shift-one');
      expect(fetch).toHaveBeenCalledTimes(1);
      if (type !== FaultReportComponent) expect(report.rows).toEqual([]);
      if (type !== ItemReportComponent) expect(report.reportGroups).toEqual([]);
      report.isLoading = true;
      report.applyTimeframe({ ...selection, shiftId: 'different' });
      expect(report.selectedShiftId).toBe('shift-one');
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('passes the optional shift to Machine, Operator, Item and Fault requests', () => {
    const get = jasmine.createSpy('get').and.returnValue(of([]));
    const reports = new ReportsService({ get } as any);
    const daily = new DailyDashboardService({ get } as any);
    reports.getMachineReport('start', 'end', undefined, 'shift-one');
    reports.getOperatorReport('start', 'end', undefined, 'shift-one');
    reports.getItemReport('start', 'end', 'shift-one');
    daily.getFaultReportSummary('start', 'end', 'shift-one');
    for (const call of get.calls.allArgs()) {
      const params = call[1].params;
      expect(params.get ? params.get('shiftId') : params.shiftId).toBe('shift-one');
    }
    reports.getItemReport('start', 'end');
    expect(get.calls.mostRecent().args[1].params.shiftId).toBeUndefined();
  });
});
