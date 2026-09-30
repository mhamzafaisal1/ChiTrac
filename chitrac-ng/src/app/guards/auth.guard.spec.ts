import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { AuthGuard } from './auth.guard';
import { User, UserService } from '../user.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let router: Router;
  let userService: jasmine.SpyObj<UserService>;

  const route = (requiredPermissionLevel: number) => ({
    data: { requiredPermissionLevel }
  } as unknown as ActivatedRouteSnapshot);
  const state = { url: '/ng/settings/root/utilities' } as RouterStateSnapshot;

  beforeEach(() => {
    userService = jasmine.createSpyObj<UserService>('UserService', [
      'getCurrentUser',
      'hasPermissionLevel'
    ]);

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        provideRouter([]),
        { provide: UserService, useValue: userService }
      ]
    });

    guard = TestBed.inject(AuthGuard);
    router = TestBed.inject(Router);
  });

  it('rejects stale browser state when the server session is missing', async () => {
    userService.getCurrentUser.and.returnValue(of(null));

    const result = await firstValueFrom(guard.canActivate(route(0), state));

    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/ng/login?returnUrl=%2Fng%2Fsettings%2Froot%2Futilities'
    );
    expect(userService.hasPermissionLevel).not.toHaveBeenCalled();
  });

  it('allows an authenticated user with the required permission', async () => {
    const user: User = { username: 'root', permissions: { level: 0 } };
    userService.getCurrentUser.and.returnValue(of(user));
    userService.hasPermissionLevel.and.returnValue(true);

    const result = await firstValueFrom(guard.canActivate(route(0), state));

    expect(result).toBeTrue();
    expect(userService.hasPermissionLevel).toHaveBeenCalledWith(0, user);
  });

  it('redirects authenticated users without the required permission', async () => {
    const user: User = { username: 'viewer', permissions: { level: 7 } };
    userService.getCurrentUser.and.returnValue(of(user));
    userService.hasPermissionLevel.and.returnValue(false);

    const result = await firstValueFrom(guard.canActivate(route(0), state));

    expect(router.serializeUrl(result as UrlTree)).toBe('/ng/settings/profile');
  });
});
