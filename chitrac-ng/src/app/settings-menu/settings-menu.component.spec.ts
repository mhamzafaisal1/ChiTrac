import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of } from 'rxjs';
import { routes } from '../app.routes';
import { AuthGuard } from '../guards/auth.guard';
import { HomeComponent } from '../home/home.component';
import { PermissionLevels, User, UserService } from '../user.service';
import { SettingsMenuComponent } from './settings-menu.component';
import { ProductionScreenLayoutsService } from '../services/production-screen-layouts.service';

@Component({ standalone: true, template: '' })
class LoginStubComponent {}

describe('Settings menu', () => {
  const user$ = new BehaviorSubject<User | null>(null);
  const expectedLabels = ['Machines', 'Profile', 'Operators', 'Items', 'System Settings',
    'API Tokens', 'Users', 'Server Logs', 'Utilities', 'Shifts', 'Maintenance Shifts'];

  beforeEach(() => {
    user$.next({ username: 'root', permissions: { level: 0 } });
    TestBed.configureTestingModule({
      imports: [SettingsMenuComponent],
      providers: [provideNoopAnimations(),
        { provide: ProductionScreenLayoutsService, useValue: { state$: of({ systemLayouts: [], userLayouts: [], loading: false, error: '' }), refresh() {} } },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        provideRouter([
        routes.find(route => route.path === 'ng/settings')!,
        { path: 'ng/home', component: HomeComponent },
        { path: 'ng/login', component: LoginStubComponent },
        { path: 'ng/settings/profile', component: LoginStubComponent },
      ]), {
        provide: UserService,
        useValue: {
          user: user$.asObservable(),
          getCurrentUser: () => of(user$.value),
          hasPermissionLevel: (level: number, user: User | null) =>
            typeof user?.permissions?.level === 'number' && user.permissions.level <= level,
        },
      }],
    });
  });

  it('provides all eleven settings links in the established menu order with matching route permissions', () => {
    const fixture = TestBed.createComponent(SettingsMenuComponent);
    fixture.detectChanges();
    const tiles = Array.from(fixture.nativeElement.querySelectorAll('.home-tile')) as HTMLAnchorElement[];
    expect(tiles.map(tile => tile.querySelector('.tile-label')!.textContent!.trim())).toEqual(['Main Menu', ...expectedLabels]);
    expect(tiles[0].getAttribute('href')).toBe('/ng/home');
    expect(fixture.nativeElement.querySelector('header, h1, .back-link')).toBeNull();
    fixture.componentInstance.destinations.forEach((destination, index) => {
      expect(tiles[index + 1].getAttribute('href')).toBe(destination.path);
      const route = routes.find(route => `/${route.path}` === destination.path);
      expect(route?.canActivate).toContain(AuthGuard);
      expect(route?.data?.['requiredPermissionLevel']).toBe(destination.permission);
    });
  });

  it('updates available tiles as permissions change and removes them on logout', () => {
    const fixture = TestBed.createComponent(SettingsMenuComponent);
    const cases: [number, string[]][] = [
      [7, ['Machines', 'Profile', 'Items', 'System Settings']],
      [4, ['Machines', 'Profile', 'Operators', 'Items', 'System Settings', 'Shifts', 'Maintenance Shifts']],
      [0, expectedLabels],
    ];
    for (const [level, labels] of cases) {
      user$.next({ username: 'user', permissions: { level } });
      fixture.detectChanges();
      const tiles = Array.from(fixture.nativeElement.querySelectorAll('.tile-label')) as HTMLElement[];
      expect(tiles.map(tile => tile.textContent!.trim())).toEqual(['Main Menu', ...labels]);
    }
    user$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.home-tile').length).toBe(0);
  });

  it('navigates from Home to the submenu and back through its actual links', async () => {
    const harness = await RouterTestingHarness.create('/ng/home');
    const settings = harness.routeNativeElement!.querySelector('a[routerlink="/ng/settings"]') as HTMLAnchorElement;
    settings.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/ng/settings');
    expect(harness.routeNativeElement!.querySelectorAll('.home-tile').length).toBe(12);
    (harness.routeNativeElement!.querySelector('.home-tile') as HTMLAnchorElement).click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/ng/home');
    harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.tile-label')!.textContent!.trim()).toBe('Daily Dashboard');
    expect(harness.routeNativeElement!.textContent).not.toContain('Main Menu');
  });

  it('supports direct entry with the existing Settings permission guard', async () => {
    const route = routes.find(route => route.path === 'ng/settings')!;
    expect(route.canActivate).toContain(AuthGuard);
    expect(route.data?.['requiredPermissionLevel']).toBe(PermissionLevels.settings);
    const harness = await RouterTestingHarness.create('/ng/settings');
    expect(harness.routeNativeElement!.querySelector('.tile-label')!.textContent!.trim()).toBe('Main Menu');
    expect(harness.routeNativeElement!.querySelector('h1')).toBeNull();
  });

  it('redirects anonymous direct entry to Home with the submenu return URL', async () => {
    user$.next(null);
    await RouterTestingHarness.create('/ng/settings');
    expect(TestBed.inject(Router).url).toBe('/ng/home?returnUrl=%2Fng%2Fsettings');
  });

  it('rejects direct entry when the user lacks Settings permission', async () => {
    user$.next({ username: 'restricted', permissions: { level: 8 } });
    await RouterTestingHarness.create('/ng/settings');
    expect(TestBed.inject(Router).url).toBe('/ng/home');
  });
});
