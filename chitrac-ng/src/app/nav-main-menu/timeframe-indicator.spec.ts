import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { NavMainMenuComponent } from './nav-main-menu.component';
import { DateTimeService } from '../services/date-time.service';

describe('navbar timeframe indicator', () => {
  function setup(failShiftLookup = false) {
    TestBed.configureTestingModule({ providers: [
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false }) } }
    ] });
    const dates = new DateTimeService();
    const cache = new BehaviorSubject({});
    const shifts = jasmine.createSpy('getActiveShifts').and.returnValue(failShiftLookup
      ? throwError(() => new Error('Unavailable'))
      : of({ shifts: [{ _id: 'afternoon', id: 1, name: 'Afternoon Shift' }] }));
    const component = TestBed.runInInjectionContext(() => new NavMainMenuComponent(
      { user: of({ username: null }) } as any,
      {} as any,
      { settings$: of(null) } as any,
      { afterOpened: new Subject() } as any,
      { status$: of('disconnected'), dashboardCache$: cache, ensureConnected() {} } as any,
      { context$: of(null), setEditing() {} } as any,
      dates,
      { getActiveShifts: shifts } as any
    ));
    component.ngOnInit();
    return { component, dates, shifts, cache };
  }

  it('tracks applied defaults and confirmed selections', fakeAsync(() => {
    const { component, dates, shifts } = setup();
    tick();
    expect(component.selectedTimeframeLabel).toBe('today');
    expect(shifts).not.toHaveBeenCalled();
    dates.setLiveMode(false);
    dates.setShiftId('afternoon');
    dates.triggerConfirm();
    tick();
    expect(component.selectedTimeframeLabel).toBe('Afternoon Shift');
    dates.setShiftId('');
    dates.setTimeframe('');
    tick();
    expect(component.selectedTimeframeLabel).toBe('Custom');
    dates.setTimeframe('thisWeek');
    tick();
    expect(component.selectedTimeframeLabel).toBe('This Week');
    component.ngOnDestroy();
  }));

  it('falls back on lookup failure and updates when matching cache metadata arrives', fakeAsync(() => {
    const { component, dates, cache } = setup(true);
    dates.setShiftId('afternoon');
    dates.setLiveMode(false);
    tick();
    expect(component.selectedTimeframeLabel).toBe('Shift');
    cache.next({ currentShift: { meta: { shiftId: 'afternoon', shift: { name: 'Afternoon Shift' } } } });
    tick();
    expect(component.selectedTimeframeLabel).toBe('Afternoon Shift');
    component.ngOnDestroy();
    dates.setLiveMode(true);
    dates.setShiftId('');
    tick();
    expect(component.selectedTimeframeLabel).toBe('Afternoon Shift');
  }));
});
