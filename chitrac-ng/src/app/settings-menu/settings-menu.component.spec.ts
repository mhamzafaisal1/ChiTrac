import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { routes } from '../app.routes';
import { AuthGuard } from '../guards/auth.guard';
import { HomeComponent } from '../home/home.component';
import { PermissionLevels, User, UserService } from '../user.service';
import { SettingsMenuComponent } from './settings-menu.component';

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
      providers: [provideRouter([
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
    expect(tiles.map(tile => tile.querySelector('.tile-label')!.textContent!.trim())).toEqual(expectedLabels);
    fixture.componentInstance.destinations.forEach((destination, index) => {
      expect(tiles[index].getAttribute('href')).toBe(destination.path);
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
      expect(tiles.map(tile => tile.textContent!.trim())).toEqual(labels);
    }
    user$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.home-tile').length).toBe(0);
  });

  it('navigates from Home to the submenu and back through its actual links', async () => {
    const harness = await RouterTestingHarness.create('/ng/home');
    const settings = harness.routeNativeElement!.querySelector('button[routerlink="/ng/settings"]') as HTMLButtonElement;
    settings.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/ng/settings');
    expect(harness.routeNativeElement!.querySelectorAll('.home-tile').length).toBe(11);
    (harness.routeNativeElement!.querySelector('.back-link') as HTMLAnchorElement).click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/ng/home');
  });

  it('supports direct entry with the existing Settings permission guard', async () => {
    const route = routes.find(route => route.path === 'ng/settings')!;
    expect(route.canActivate).toContain(AuthGuard);
    expect(route.data?.['requiredPermissionLevel']).toBe(PermissionLevels.settings);
    const harness = await RouterTestingHarness.create('/ng/settings');
    expect(harness.routeNativeElement!.querySelector('h1')!.textContent).toBe('Settings');
  });

  it('redirects anonymous direct entry to login with the submenu return URL', async () => {
    user$.next(null);
    await RouterTestingHarness.create('/ng/settings');
    expect(TestBed.inject(Router).url).toBe('/ng/login?returnUrl=%2Fng%2Fsettings');
  });

  it('rejects direct entry when the user lacks Settings permission', async () => {
    user$.next({ username: 'restricted', permissions: { level: 8 } });
    await RouterTestingHarness.create('/ng/settings');
    expect(TestBed.inject(Router).url).toBe('/ng/settings/profile');
  });
});
