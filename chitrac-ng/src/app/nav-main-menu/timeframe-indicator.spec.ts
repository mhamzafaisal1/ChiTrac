import { ProductionScreenLayoutsService } from '../services/production-screen-layouts.service';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { NavMainMenuComponent } from './nav-main-menu.component';
import { DateTimeService } from '../services/date-time.service';

describe('navbar timeframe indicator', () => {
  function setup(failShiftLookup = false, library = of({systemLayouts: [], userLayouts: [], loading: false, error: ''}) as any, preloader: any = null) {
    TestBed.configureTestingModule({ providers: [{ provide: ProductionScreenLayoutsService, useValue: { state$: library, refresh() {}, ensureFresh() {} } },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false }) } }
    ] });
    const dates = new DateTimeService();
    const users = new BehaviorSubject<any>({ username: null });
    const cache = new BehaviorSubject({});
    const shifts = jasmine.createSpy('getActiveShifts').and.returnValue(failShiftLookup
      ? throwError(() => new Error('Unavailable'))
      : of({ shifts: [{ _id: 'afternoon', id: 1, name: 'Afternoon Shift' }] }));
    const component = TestBed.runInInjectionContext(() => new NavMainMenuComponent(
      { user: users } as any,
      {} as any,
      { settings$: of(null) } as any,
      { afterOpened: new Subject() } as any,
      { status$: of('disconnected'), dashboardCache$: cache, ensureConnected() {} } as any,
      { context$: of(null), setEditing() {} } as any,
      dates,
      { getActiveShifts: shifts } as any,
      { requests$: new Subject() } as any,
      preloader
    ));
    component.ngOnInit();
    return { component, dates, shifts, cache, users };
  }

  it('warms the shared production menu before it opens and releases it with the shell', fakeAsync(() => {
    const library = new Subject(); const { component } = setup(false, library);
    tick(); expect(library.observed).toBeTrue();
    component.ngOnDestroy(); expect(library.observed).toBeFalse();
  }));

  it('starts code warmup after login and permission changes without repeating it on session refresh', fakeAsync(() => {
    const downloads = new Subject();
    const preloader = { preload: jasmine.createSpy().and.returnValue(downloads) };
    const { component, users } = setup(false, undefined, preloader);
    tick(); expect(preloader.preload).not.toHaveBeenCalled();
    users.next({ username: 'admin', permissions: { level: 0 } });
    expect(preloader.preload).toHaveBeenCalledTimes(1);
    expect(downloads.observed).toBeTrue();
    users.next({ username: 'admin', permissions: { level: 0 } });
    expect(preloader.preload).toHaveBeenCalledTimes(1);
    users.next({ username: 'admin', permissions: { level: 7 } });
    expect(preloader.preload).toHaveBeenCalledTimes(2);
    users.next(null); expect(downloads.observed).toBeFalse();
    component.ngOnDestroy(); tick();
  }));

  it('tracks applied defaults and confirmed selections', fakeAsync(() => {
    const { component, dates, shifts, users } = setup();
    tick();
    expect(component.selectedTimeframeLabel).toBe('Today');
    expect(shifts).not.toHaveBeenCalled();
    users.next({ username: 'admin' });
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
