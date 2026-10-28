import { ProductionScreenLayoutsService, ProductionScreenMenuState } from '../services/production-screen-layouts.service';
import { Component, EventEmitter, Output } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { NavMainMenuComponent } from './nav-main-menu.component';
import { DateTimeModalComponent } from '../components/date-time-modal/date-time-modal.component';
import { UserLoginComponent } from '../user-login/user-login.component';
import { UserService } from '../user.service';
import { SettingsService } from '../services/settings.service';
import { WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { DateTimeService } from '../services/date-time.service';
import { ShiftService } from '../services/shift.service';

@Component({ selector: 'app-date-time-modal', template: '', standalone: true })
class DateTimeStub {
  @Output() closeModal = new EventEmitter<void>();
}

@Component({ selector: 'app-user-login', template: '<form class="test-login-form">Login form</form>', standalone: true })
class LoginStub {
  @Output() closeModal = new EventEmitter<void>();
}

describe('DMC navigation indicators', () => {
  let users: BehaviorSubject<any>;
  let status: BehaviorSubject<WebsocketConnectionStatus>;
  let logout: jasmine.Spy;

  beforeEach(() => {
    users = new BehaviorSubject<any>({username:'Admin',permissions:{level:0}});
    status = new BehaviorSubject<WebsocketConnectionStatus>('connected');
    logout = jasmine.createSpy('logout').and.callFake(() => {
      users.next(null);
      return of({ username: null });
    });
    TestBed.configureTestingModule({
      imports: [NavMainMenuComponent],
      providers: [{ provide: ProductionScreenLayoutsService, useValue: { state$: of({systemLayouts: [], userLayouts: [], loading: false, error: ''}), refresh() {} } },provideRouter([{path:'ng/home',children:[]}]), provideNoopAnimations(),
        { provide: UserService, useValue: { user: users, hasPermissionLevel: () => true, logout } },
        { provide: SettingsService, useValue: { settings$: of(null) } },
        { provide: MatDialog, useValue: { afterOpened: new Subject() } },
        { provide: WebsocketService, useValue: { status$: status, dashboardCache$: of({}), ensureConnected() {} } },
        { provide: LayoutEditService, useValue: { context$: of(null), setEditing() {} } },
        { provide: DateTimeService, useValue: { timeframe$: of('today'), shiftId$: of(''), liveMode$: of(true) } },
        { provide: ShiftService, useValue: {} },
      ]
    }).overrideComponent(NavMainMenuComponent, {
      remove: { imports: [DateTimeModalComponent, UserLoginComponent] },
      add: { imports: [DateTimeStub, LoginStub] }
    });
  });

  it('renders the generic production link first, then scope groups with distinct named URLs', fakeAsync(() => {
    const library = TestBed.inject(ProductionScreenLayoutsService) as any;
    library.state$ = of({
      systemLayouts: [{ name: 'Line A', scope: 'system', id: 'a'.repeat(64) }],
      userLayouts: [{ name: 'Line A', scope: 'user', id: 'a'.repeat(64) }],
      loading: false, error: '',
    });
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    fixture.componentInstance.openMenu('productionScreens');
    fixture.detectChanges(); tick(); fixture.detectChanges();
    const links = Array.from(fixture.nativeElement.querySelectorAll('mat-sidenav a')) as HTMLAnchorElement[];
    const productionLinks = links.filter(link => link.pathname === '/ng/production-screen');
    expect(productionLinks.length).toBe(3);
    expect(productionLinks[0].textContent).toContain('Production Screen');
    expect(productionLinks[0].search).toBe('');
    expect(productionLinks[1].search).toContain('layoutScope=system');
    expect(productionLinks[2].search).toContain('layoutScope=user');
    expect(fixture.nativeElement.textContent).toContain('System layouts');
    expect(fixture.nativeElement.textContent).toContain('Your layouts');
    expect(fixture.nativeElement.textContent).not.toContain('Blanket Blaster 1');
    fixture.destroy();
  }));

  it('retains the generic production link when the library is empty, loading or unavailable', fakeAsync(() => {
    const states = new BehaviorSubject<ProductionScreenMenuState>({ systemLayouts: [], userLayouts: [], loading: true, error: '' });
    (TestBed.inject(ProductionScreenLayoutsService) as any).state$ = states;
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges(); fixture.componentInstance.openMenu('productionScreens');
    fixture.detectChanges(); tick();
    const variants: ProductionScreenMenuState[] = [
      { systemLayouts: [], userLayouts: [], loading: true, error: '' },
      { systemLayouts: [], userLayouts: [], loading: false, error: '' },
      { systemLayouts: [], userLayouts: [], loading: false, error: 'Could not load saved layouts.' },
    ];
    for (const state of variants) {
      states.next(state); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('mat-sidenav a[href="/ng/production-screen"]')).not.toBeNull();
    }
    expect(fixture.nativeElement.textContent).toContain('Retry');
    fixture.destroy();
  }));

  it('announces connection changes and retains the last-update information in the tooltip', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    tick();
    for (const [state, label] of [
      ['connected', 'Connected'], ['connecting', 'Connecting'],
      ['disconnected', 'Disconnected'], ['error', 'Connection Error']
    ] as const) {
      status.next(state);
      fixture.detectChanges();
      const indicator = fixture.nativeElement.querySelector('.connection-status');
      expect(indicator.querySelector('.connection-status-label').textContent.trim()).toBe(label);
      expect(indicator.querySelector('.timeframe-label').textContent.trim()).toBe('Today');
      expect(indicator.classList.contains(state)).toBeTrue();
      expect(indicator.getAttribute('role')).toBe('status');
      expect(indicator.querySelector('.connection-status-dot')).not.toBeNull();
    }
    fixture.componentInstance.dashboardUpdatedAt = new Date('2026-10-19T12:00:00Z');
    expect(fixture.componentInstance.getConnectionStatusTooltip()).toContain('Last dashboard cache update:');
    fixture.destroy();
  }));

  it('hides the toolbar while signed out and removes it immediately after logout', fakeAsync(() => {
    users.next(null);
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges(); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
    users.next({username:'Admin',permissions:{level:0}}); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.user-menu-button');
    expect(button.querySelector('.user-menu-label')!.textContent).toBe('Admin');
    button.click(); fixture.detectChanges(); tick();
    const logoutButton=document.querySelector<HTMLButtonElement>('button[mat-menu-item]')!;
    expect(logoutButton.textContent).toContain('Log Out as Admin');
    expect(logout).not.toHaveBeenCalled(); logoutButton.click(); tick(); fixture.detectChanges();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.user-menu-button')).toBeNull(); fixture.destroy();
  }));

  it('shows the tooltip after 500ms and follows the pointer even after opening', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    tick();
    const indicator: HTMLElement = fixture.nativeElement.querySelector('.connection-status');
    indicator.dispatchEvent(new MouseEvent('mouseenter', { clientX: 100, clientY: 20 }));
    tick(300);
    indicator.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 20 }));
    tick(199);
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    tick(1);
    fixture.detectChanges();
    tick();
    const tooltip = document.querySelector<HTMLElement>('#connection-status-tooltip')!;
    expect(tooltip.textContent).toContain('Connected');
    const initialLeft = tooltip.getBoundingClientRect().left;
    indicator.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 30 }));
    fixture.detectChanges();
    tick();
    expect(tooltip.getBoundingClientRect().left - initialLeft).toBeCloseTo(200, 0);
    indicator.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    fixture.destroy();
  }));

  it('keeps the connection tooltip separate from the timeframe tooltip and cancels delayed opening on exit', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    tick();
    const indicator: HTMLElement = fixture.nativeElement.querySelector('.connection-status');
    indicator.dispatchEvent(new MouseEvent('mouseenter', { clientX: 100, clientY: 20 }));
    tick(200);
    indicator.dispatchEvent(new MouseEvent('mouseleave'));
    tick(500);
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    indicator.dispatchEvent(new MouseEvent('mouseenter', { clientX: 100, clientY: 20 }));
    tick(500);
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).not.toBeNull();
    indicator.querySelector('.timeframe-label')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    fixture.destroy();
  }));

  it('supports keyboard dismissal, stays inside the viewport, and cleans up on destruction', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    tick();
    const indicator: HTMLElement = fixture.nativeElement.querySelector('.connection-status');
    indicator.dispatchEvent(new FocusEvent('focus'));
    tick(500);
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).not.toBeNull();
    indicator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    indicator.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 20 }));
    tick(500);
    fixture.detectChanges();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    indicator.dispatchEvent(new MouseEvent('mouseenter', { clientX: window.innerWidth - 2, clientY: window.innerHeight - 2 }));
    tick(500);
    fixture.detectChanges();
    tick();
    const bounds = document.querySelector<HTMLElement>('#connection-status-tooltip')!.getBoundingClientRect();
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    fixture.destroy();
    expect(document.querySelector('#connection-status-tooltip')).toBeNull();
    tick(500);
  }));
});
