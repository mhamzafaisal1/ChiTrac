import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { ConfigurationService } from './configuration.service';
import { MachineGridComponent } from './machine-grid/machine-grid.component';
import { ItemGridComponent } from './item-grid/item-grid.component';
import { OperatorGridComponent } from './operator-grid/operator-grid.component';
import { TokenManagementComponent } from './token-management/token-management.component';
import { TokenManagementService } from './services/token-management.service';
import { SettingsService } from './services/settings.service';
import { Component, NgZone } from '@angular/core';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { AuthGuard } from './guards/auth.guard';
import { NavigationFeedbackComponent } from './components/navigation-feedback/navigation-feedback.component';
import { UserProfileComponent } from './user-profile/user-profile.component';

for (const [type, method, name] of [
  [MachineGridComponent, 'getMachineConfigs', 'machines'],
  [ItemGridComponent, 'getItemConfigs', 'items'],
  [OperatorGridComponent, 'getOperatorConfigs', 'operators'],
] as const) {
  describe(`${name} settings loading`, () => {
    let response: Subject<any>;
    let get: jasmine.Spy;
    beforeEach(() => {
      response = new Subject(); get = jasmine.createSpy(method).and.callFake(() => response);
      TestBed.configureTestingModule({ imports: [type], providers: [provideNoopAnimations(),
        { provide: ConfigurationService, useValue: { [method]: get } },
        { provide: MatDialog, useValue: {} },
      ] });
    });
    it('renders the page and a spinner before a slow REST response, then enables editing', fakeAsync(() => {
      const fixture = TestBed.createComponent(type as any);
      try {
        fixture.detectChanges(); tick(1);
        expect(get).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(`Loading ${name}`);
        expect(fixture.nativeElement.querySelector('[inert]')).not.toBeNull();
        tick(5000); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
        response.next([]); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
        expect(fixture.nativeElement.querySelector('[inert]')).toBeNull();
      } finally { fixture.destroy(); }
    }));
    it('stops loading on failure, avoids an immediate retry loop and supports an explicit retry', fakeAsync(() => {
      const fixture = TestBed.createComponent(type as any);
      try {
        fixture.detectChanges(); tick(1);
        response.error(new Error('offline')); fixture.detectChanges(); tick(1000);
        expect(get).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
        response = new Subject();
        fixture.nativeElement.querySelector('app-page-load-state button').click(); fixture.detectChanges(); tick(1);
        expect(get).toHaveBeenCalledTimes(2);
        response.next([]); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
      } finally { fixture.destroy(); }
    }));
  });
}

describe('API Tokens initial loading', () => {
  it('starts fetching immediately instead of waiting one second', fakeAsync(() => {
    const response = new Subject<any>();
    const getTokens = jasmine.createSpy('getTokens').and.returnValue(response);
    TestBed.configureTestingModule({ imports: [TokenManagementComponent], providers: [provideNoopAnimations(),
      { provide: TokenManagementService, useValue: { getTokens } },
      { provide: MatSnackBar, useValue: { open() {} } },
      { provide: MatDialog, useValue: {} }, { provide: Clipboard, useValue: {} },
      { provide: SettingsService, useValue: { formatTime: () => '', timeFormat$: of('12h') } },
    ] });
    const fixture = TestBed.createComponent(TokenManagementComponent);
    try {
      fixture.detectChanges(); tick(0);
      expect(getTokens).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
      response.next({ tokens: [], controllers: [], deactivatedTokens: [] }); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    } finally { fixture.destroy(); }
  }));
});

@Component({ standalone: true, template: '<h1>Dashboard</h1>' })
class DashboardStub {}
@Component({ standalone: true, imports: [RouterOutlet, NavigationFeedbackComponent], template:
  '<app-navigation-feedback #feedback/><div [attr.inert]="feedback.pending() ? \'\' : null"><router-outlet/></div>' })
class NavigationTestShell {}

describe('Dashboard to settings with delayed REST responses', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    TestBed.configureTestingModule({ imports: [NavigationTestShell], providers: [
      provideNoopAnimations(), provideHttpClient(), provideHttpClientTesting(),
      provideRouter([{ path: 'dashboard', component: DashboardStub },
        { path: 'ng/settings/machines', component: MachineGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: 7 } }]),
      { provide: MatDialog, useValue: {} },
    ] });
  });
  afterEach(() => localStorage.removeItem('token'));

  it('loads settings immediately with a recently verified session while its data is still pending', fakeAsync(() => {
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(UserService).getCurrentUser().subscribe();
    http.expectOne('/api/passport/user').flush({ user: { username: 'admin', permissions: { level: 0 } } });
    const fixture = TestBed.createComponent(NavigationTestShell);
    const router = TestBed.inject(Router);
    const zone = TestBed.inject(NgZone);
    try {
      fixture.detectChanges(); zone.run(() => router.navigateByUrl('/dashboard')); tick();
      zone.run(() => router.navigateByUrl('/ng/settings/machines')); tick(1); fixture.detectChanges();
      tick(1); // ngOnInit schedules the initial table request after the first render.
      expect(router.url).toBe('/ng/settings/machines');
      http.expectNone('/api/passport/user');
      const data = http.expectOne('/api/machine/config');
      expect(fixture.nativeElement.querySelector('machine-grid')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.navigation-loading')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-page-load-state [role="status"]').textContent).toContain('Loading machines');
      tick(5000); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
      data.flush([]); tick(); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull(); http.verify();
    } finally { fixture.destroy(); }
  }));

  it('reacts during a cold-session check, then renders the page while settings data loads', fakeAsync(() => {
    const fixture = TestBed.createComponent(NavigationTestShell);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    try {
      fixture.detectChanges();
      TestBed.inject(NgZone).run(() => router.navigateByUrl('/ng/settings/machines')); tick(); fixture.detectChanges();
      const session = http.expectOne('/api/passport/user');
      expect(fixture.nativeElement.querySelector('.navigation-loading')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('machine-grid')).toBeNull();
      tick(5000); session.flush({ user: { username: 'admin', permissions: { level: 0 } } }); tick(1); fixture.detectChanges();
      tick(1); // ngOnInit schedules the initial table request after the first render.
      expect(router.url).toBe('/ng/settings/machines');
      expect(fixture.nativeElement.querySelector('.navigation-loading')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-page-load-state [role="status"]')).not.toBeNull();
      http.expectOne('/api/machine/config').flush([]); tick(); http.verify();
    } finally { fixture.destroy(); }
  }));
});

describe('Profile loading feedback', () => {
  it('blocks editing during loading and provides Retry after failure', () => {
    let response = new Subject<any>();
    TestBed.configureTestingModule({ imports: [UserProfileComponent], providers: [provideNoopAnimations(),
      { provide: UserService, useValue: { getProfile: () => response } },
      { provide: MatSnackBar, useValue: { open() {} } },
      { provide: SettingsService, useValue: { timeFormat$: of('12h') } },
    ] });
    const fixture = TestBed.createComponent(UserProfileComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form').hasAttribute('inert')).toBeTrue();
    response.error(new Error('offline')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    response = new Subject(); fixture.nativeElement.querySelector('app-page-load-state button').click(); fixture.detectChanges();
    response.next({ user: { username: 'admin' } }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form').hasAttribute('inert')).toBeFalse();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
  });
});
