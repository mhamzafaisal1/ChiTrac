import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TimeframePickerComponent } from '../components/timeframe-picker/timeframe-picker.component';
import { ReportsService } from '../services/reports.service';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { ShiftService } from '../services/shift.service';
import { MachineReportComponent } from './machine-report/machine-report.component';
import { OperatorReportComponent } from './operator-report/operator-report.component';
import { ItemReportComponent } from './item-report/item-report.component';
import { FaultReportComponent } from './fault-report/fault-report.component';

for (const type of [MachineReportComponent, OperatorReportComponent, ItemReportComponent, FaultReportComponent]) {
  describe(`${type.name} report controls`, () => {
    let fixture: any;
    let component: any;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [type],
        providers: [
          provideNoopAnimations(),
          { provide: ReportsService, useValue: {} },
          { provide: DailyDashboardService, useValue: {} },
          { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } },
          { provide: ShiftService, useValue: { getActiveShifts: () => of({ shifts: [] }) } },
        ],
      });
      fixture = TestBed.createComponent(type as Type<any>);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('uses Generate Report as the only generation action and preserves export actions', () => {
      const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
      expect(buttons.some(button => button.textContent?.includes('Fetch Data'))).toBeFalse();
      const action = fixture.nativeElement.querySelector('.picker-actions button') as HTMLButtonElement;
      expect(action.textContent).toContain('Generate Report');
      const fetch = spyOn(component, type === FaultReportComponent ? 'fetchFaultReport' : 'fetchAnalyticsData');
      action.click();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.textContent).toContain('Download CSV');
      expect(fixture.nativeElement.textContent).toContain('PDF');
      if (type === MachineReportComponent) expect(fixture.nativeElement.textContent).toContain('Email PDF');
      component.isLoading = true;
      fixture.detectChanges();
      expect(action.disabled).toBeTrue();
      action.click();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    if (type === MachineReportComponent || type === OperatorReportComponent) {
      it('shows the single item name, keeps multiple-item counts and hides empty badges', () => {
        const badge = (items: any[]) => {
          component.reportGroups = [{ key: 'one', summary: { Machine: 'SPF1', Operator: 'Operator' }, details: items }];
          fixture.detectChanges();
          return fixture.nativeElement.querySelector('.detail-count') as HTMLElement | null;
        };
        expect(badge([{ Item: 'Bath Towel' }])?.textContent?.trim()).toBe('Bath Towel');
        expect(badge([{ Item: 'Bath Towel' }, { Item: 'Hand Towel' }])?.textContent?.trim()).toBe('2 items');
        expect(badge([])).toBeNull();
        const longName = 'Extra Large Hospitality Bath Towel With Extended Item Description';
        expect(badge([{ Item: longName }])?.textContent?.trim()).toBe(longName);
        expect(badge([{ Item: '' }])?.textContent?.trim()).toBe('Unknown Item');
      });
    }
  });
}

describe('Shared timeframe action label', () => {
  it('defaults to Confirm for comparison and other non-report callers', () => {
    TestBed.configureTestingModule({
      imports: [TimeframePickerComponent],
      providers: [provideNoopAnimations(), { provide: ShiftService, useValue: {} }],
    });
    const fixture = TestBed.createComponent(TimeframePickerComponent);
    fixture.componentRef.setInput('shifts', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.picker-actions button').textContent).toContain('Confirm');
    fixture.destroy();
  });
});
