import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { FaultReportComponent } from './fault-report.component';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { ShiftService } from '../../services/shift.service';

describe('Fault report labels', () => {
  let fixture: any;
  let component: any;
  const fault = (machineName?: string, machineSerial?: number) => ({
    machineName, machineSerial, timestamp: '2026-10-09T08:00:00', durationSeconds: 114,
    formatted: { minutes: 1, seconds: 54 },
  });
  const show = (summary: any) => {
    component.processReportData([summary]);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.summary-row').textContent.replace(/\s+/g, ' ').trim();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FaultReportComponent],
      providers: [provideNoopAnimations(),
        { provide: DailyDashboardService, useValue: {} },
        { provide: ShiftService, useValue: { getActiveShifts: () => of({ shifts: [] }) } }],
    });
    fixture = TestBed.createComponent(FaultReportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(async () => {
    await fixture.whenStable();
    fixture.destroy();
  });

  it('identifies the code and single-occurrence machine', () => {
    const label = show({ code: 11, name: 'Estop/Door', count: 1, faults: [fault('SPL1')] });
    expect(label).toContain('Estop/Door (Code: 11)');
    expect(label).toContain('1 occurrence on SPL1');
    expect(component.reportGroups[0].summary.Fault).toBe('Estop/Door (Code: 11)');
    component.toggleGroup(component.reportGroups[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.detail-table').textContent).toContain('SPL1');
  });

  it('keeps multiple occurrences unchanged', () => {
    const label = show({ code: '34', name: 'Jam', count: 2, faults: [fault('SPL1'), fault('SPF1')] });
    expect(label).toContain('Jam (Code: 34)');
    expect(label).toContain('2 occurrences');
    expect(label).not.toContain('occurrences on');
  });

  it('preserves zero codes and omits unavailable codes', () => {
    expect(show({ code: 0, name: 'Fault', count: 1, faults: [fault('SPL1')] })).toContain('(Code: 0)');
    expect(show({ name: 'Fault', count: 1, faults: [fault('SPL1')] })).not.toContain('(Code:');
  });

  it('uses the same missing-machine fallback as the detail row', () => {
    expect(show({ code: 11, count: 1, faults: [fault('  ', 90011)] })).toContain('1 occurrence on Machine 90011');
    expect(show({ code: 11, count: 1, faults: [fault()] })).toContain('1 occurrence on Unknown Machine');
  });

  it('does not attribute an incomplete multi-occurrence group to one machine', () => {
    expect(show({ code: 11, count: 2, faults: [fault('SPL1')] })).not.toContain('on SPL1');
  });

  it('does not show an occurrence badge without detail rows', () => {
    show({ code: 11, count: 0, faults: [] });
    expect(fixture.nativeElement.querySelector('.detail-count')).toBeNull();
  });
});
