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
    users = new BehaviorSubject(null);
    status = new BehaviorSubject<WebsocketConnectionStatus>('connected');
    logout = jasmine.createSpy('logout').and.callFake(() => {
      users.next(null);
      return of({ username: null });
    });
    TestBed.configureTestingModule({
      imports: [NavMainMenuComponent],
      providers: [provideRouter([]), provideNoopAnimations(),
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

  it('shows Login or the username and opens the appropriate popup before logging out', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavMainMenuComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.user-menu-button');
    expect(button.querySelector('.user-menu-label')!.textContent).toBe('Login');
    expect(button.querySelector('.user-icon')!.textContent).toBe('account_circle');
    expect(button.querySelector('.user-menu-chevron')).not.toBeNull();
    button.click();
    fixture.detectChanges();
    tick();
    expect(document.querySelector('.test-login-form')).not.toBeNull();
    fixture.componentInstance.loginMenu.closeMenu();
    tick();
    users.next({ username: 'Admin', permissions: { level: 0 } });
    fixture.detectChanges();
    expect(button.querySelector('.user-menu-label')!.textContent).toBe('Admin');
    button.click();
    fixture.detectChanges();
    tick();
    const logoutButton = document.querySelector<HTMLButtonElement>('button[mat-menu-item]')!;
    expect(logoutButton.textContent).toContain('Log Out as Admin');
    expect(logout).not.toHaveBeenCalled();
    logoutButton.click();
    tick();
    fixture.detectChanges();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(button.querySelector('.user-menu-label')!.textContent).toBe('Login');
    fixture.destroy();
  }));
});
