import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { HomeComponent } from './home.component';
import { NavigationActionsService } from '../services/navigation-actions.service';
import { User, UserService } from '../user.service';
import { routes } from '../app.routes';

describe('HomeComponent', () => {
  const user$ = new BehaviorSubject<User | null>(null);

  beforeEach(() => {
    user$.next(null);
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), {
        provide: UserService,
        useValue: {
          user: user$.asObservable(),
          hasPermissionLevel: (level: number, user: User | null) =>
            typeof user?.permissions?.level === 'number' && user.permissions.level <= level
        }
      }]
    });
  });

  it('shows the six destinations in the requested order, followed by Settings and Log In', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const tiles = Array.from(fixture.nativeElement.querySelectorAll('.home-tile')) as HTMLElement[];
    expect(tiles.map(tile => tile.querySelector('.tile-label')?.textContent?.trim())).toEqual([
      'Daily Dashboard', 'Machine Dashboard', 'Operator Dashboard', 'Comparison Dashboard',
      'Machine Report', 'Operator Report', 'Settings', 'Log In'
    ]);
    expect(tiles.slice(0, 6).map(tile => tile.getAttribute('href'))).toEqual([
      '/ng/experimental/daily-dashboard', '/ng/analytics/machine-dashboard', '/ng/operatorAnalytics',
      '/ng/comparison-dashboard', '/ng/reports/machine-report', '/ng/reports/operator-report'
    ]);
  });

  it('requests shell menus and updates the authentication label with the session', () => {
    const actions = TestBed.inject(NavigationActionsService);
    const requests: string[] = [];
    const subscription = actions.requests$.subscribe(request => requests.push(request));
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();
    expect(requests).toEqual(['settings', 'authentication']);
    user$.next({ username: 'admin', permissions: { level: 0 } });
    fixture.detectChanges();
    expect(buttons[1].querySelector('.tile-label')?.textContent?.trim()).toBe('Log Out');
    subscription.unsubscribe();
  });

  it('keeps Settings visible but disabled for users without permission', () => {
    user$.next({ username: 'restricted', permissions: { level: 8 } });
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBeTrue();
  });

  it('makes Home public and uses it as the default and fallback destination', () => {
    const home = routes.find(route => route.path === 'ng/home');
    expect(home?.loadComponent).toBeDefined();
    expect(home?.canActivate).toBeUndefined();
    expect(routes.find(route => route.path === '')?.redirectTo).toBe('ng/home');
    expect(routes.find(route => route.path === '**')?.redirectTo).toBe('ng/home');
  });
});
