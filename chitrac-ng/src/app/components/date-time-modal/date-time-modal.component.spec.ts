import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DateTimeModalComponent } from './date-time-modal.component';
import { DateTimeService } from '../../services/date-time.service';
import { DashboardTimeframeService } from '../../services/dashboard-timeframe.service';
import { ShiftService } from '../../services/shift.service';
import { WebsocketService } from '../../services/websocket.service';

describe('Independent dashboard timeframe and shift filters', () => {
  let component: DateTimeModalComponent;
  let dates: DateTimeService;
  beforeEach(() => {
    dates = new DateTimeService();
    TestBed.configureTestingModule({ providers: [
      { provide: DateTimeService, useValue: dates },
      { provide: DashboardTimeframeService, useValue: {} },
      { provide: ShiftService, useValue: {} },
      { provide: WebsocketService, useValue: { dashboardCache$: of({}) } },
      { provide: ChangeDetectorRef, useValue: { markForCheck() {} } },
    ] });
    component = TestBed.runInInjectionContext(() => new DateTimeModalComponent());
  });

  it('preserves a selected shift for every quick timeframe and custom dates', () => {
    for (const mode of ['today', 'thisWeek', 'thisMonth', 'thisYear', 'yesterday', 'lastWeek', 'lastMonth', 'lastYear', 'custom']) {
      component.selectShift('morning');
      if (mode === 'today') component.selectToday();
      else if (mode === 'custom') component.selectCustom();
      else component.onTimeframeSelect(mode);
      expect(component.selectedShiftId).toBe('morning');
      expect(component.selectedOption).toBe(mode);
      const start = +component.startDateTime;
      const end = +component.endDateTime;
      component.selectShift('afternoon');
      component.selectShift(null);
      expect(+component.startDateTime).toBe(start);
      expect(+component.endDateTime).toBe(end);
      expect(component.selectedOption).toBe(mode);
    }
  });

  it('commits both filters and restores them when reopened', () => {
    component.onTimeframeSelect('lastWeek');
    component.selectShift('afternoon');
    component.confirm();
    expect(dates.getTimeframe()).toBe('lastWeek');
    expect(dates.getShiftId()).toBe('afternoon');
    expect(dates.getLiveMode()).toBeFalse();
    component.selectToday();
    component.selectShift(null);
    component.resetDraftFromCommittedSelection();
    expect(component.selectedOption).toBe('lastWeek');
    expect(component.selectedShiftId).toBe('afternoon');
    expect(component.startDateTime.toISOString()).toBe(dates.getStartTime());
    expect(component.endDateTime.toISOString()).toBe(dates.getEndTime());
  });
});
