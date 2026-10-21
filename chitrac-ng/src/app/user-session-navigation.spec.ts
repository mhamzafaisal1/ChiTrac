import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, provideRouter } from '@angular/router';
import { UserService } from './user.service';
import { AuthInterceptor } from './auth.interceptor';
import { ErrorInterceptor } from './error.interceptor';
import { ErrorQueueService } from './services/error-queue.service';
import { AuthGuard } from './guards/auth.guard';

describe('Server-validated session navigation', () => {
  let user: UserService;
  let http: HttpTestingController;
  let client: HttpClient;
  const identity = { username: 'admin', permissions: { level: 0 } };
  beforeEach(() => {
    localStorage.removeItem('user'); localStorage.setItem('token', 'verified-token');
    TestBed.configureTestingModule({ providers: [
      provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting(),
      { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
      { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
      { provide: ErrorQueueService, useValue: { addError() {} } },
    ] });
    user = TestBed.inject(UserService); http = TestBed.inject(HttpTestingController); client = TestBed.inject(HttpClient);
  });
  afterEach(() => { http.verify(); localStorage.removeItem('user'); localStorage.removeItem('token'); });
  function verify(): void {
    user.getCurrentUser().subscribe();
    http.expectOne('/api/passport/user').flush({ user: identity });
  }

  it('removes a repeated navigation round trip after a simulated five-second session response', fakeAsync(() => {
    let resolved = false;
    user.getCurrentUser().subscribe(() => resolved = true);
    const request = http.expectOne('/api/passport/user');
    tick(5000);
    expect(resolved).toBeFalse();
    request.flush({ user: identity });
    let allowed: any;
    const started = Date.now();
    TestBed.inject(AuthGuard).canActivate({ data: { requiredPermissionLevel: 7 } } as any,
      { url: '/ng/settings/machines' } as RouterStateSnapshot).subscribe(value => allowed = value);
    expect(allowed).toBeTrue();
    expect(Date.now() - started).toBe(0);
    http.expectNone('/api/passport/user');
  }));

  it('shares concurrent validation, expires the cache, and checks updated permissions', fakeAsync(() => {
    user.getCurrentUser().subscribe(); user.getCurrentUser().subscribe();
    http.expectOne('/api/passport/user').flush({ user: identity });
    tick(29_999);
    user.getCurrentUser().subscribe(); http.expectNone('/api/passport/user');
    tick(1);
    let allowed: any;
    TestBed.inject(AuthGuard).canActivate({ data: { requiredPermissionLevel: 0 } } as unknown as ActivatedRouteSnapshot,
      { url: '/ng/settings/root/utilities' } as RouterStateSnapshot).subscribe(value => allowed = value);
    expect(allowed).toBeUndefined();
    http.expectOne('/api/passport/user').flush({ user: { username: 'admin', permissions: { level: 7 } } });
    expect(allowed.toString()).toBe('/ng/settings/profile');
  }));

  it('never authorizes from browser-stored identity data', () => {
    localStorage.setItem('user', JSON.stringify(identity));
    let result: any = 'pending';
    user.getCurrentUser().subscribe(value => result = value);
    expect(result).toBe('pending');
    http.expectOne('/api/passport/user').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(result).toBeNull(); expect(user.getToken()).toBeNull();
  });

  it('does not reuse a verified identity for another token', () => {
    verify(); localStorage.setItem('token', 'other-token');
    let result: any;
    user.getCurrentUser().subscribe(value => result = value);
    http.expectOne('/api/passport/user').flush({ user: { username: 'other', permissions: { level: 4 } } });
    expect(result.username).toBe('other');
  });

  it('rejects a token that expires during the session freshness window', fakeAsync(() => {
    const token = `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 1 }))}.signature`;
    localStorage.setItem('token', token); verify(); tick(1001);
    let result: any = 'pending'; user.getCurrentUser().subscribe(value => result = value);
    expect(result).toBeNull(); expect(user.getToken()).toBeNull(); http.expectNone('/api/passport/user');
  }));

  it('does not let a late response restore a logged-out session', () => {
    let result: any;
    user.getCurrentUser().subscribe(value => result = value);
    const pending = http.expectOne('/api/passport/user');
    user.logout().subscribe(); http.expectOne('/api/passport/user/logout').flush({});
    pending.flush({ user: identity });
    expect(result).toBeNull(); expect(user.getToken()).toBeNull();
  });

  it('does not let an old success overwrite a newer login', () => {
    user.getCurrentUser().subscribe(); const pending = http.expectOne('/api/passport/user');
    user.postUserLogin({}).subscribe();
    http.expectOne('/api/passport/user/login').flush({ user: { username: 'new-user', permissions: { level: 4 } }, token: 'new-token' });
    pending.flush({ user: identity });
    let result: any; user.getCurrentUser().subscribe(value => result = value);
    expect(result.username).toBe('new-user'); expect(user.getToken()).toBe('new-token');
    http.expectNone('/api/passport/user');
  });

  it('does not let an old rejection clear a newer login', () => {
    user.getCurrentUser().subscribe(); const pending = http.expectOne('/api/passport/user');
    user.postUserLogin({}).subscribe();
    http.expectOne('/api/passport/user/login').flush({ user: identity, token: 'new-token' });
    pending.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(user.getToken()).toBe('new-token');
  });

  it('preserves credentials after a temporary validation failure and supports retry', () => {
    let failure: any;
    user.getCurrentUser().subscribe({ error: error => failure = error });
    http.expectOne('/api/passport/user').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(failure.status).toBe(503); expect(user.getToken()).toBe('verified-token');
    verify();
  });

  it('clears a cached session on an API 401, including locally handled errors', () => {
    verify();
    client.get('/api/machine/config', { headers: { 'X-Skip-Error-Modal': 'true' } }).subscribe({ error() {} });
    http.expectOne('/api/machine/config').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(user.getToken()).toBeNull();
    user.getCurrentUser().subscribe();
    http.expectOne('/api/passport/user').flush({}, { status: 401, statusText: 'Unauthorized' });
  });

  it('revalidates permissions after an API 403 without discarding the login', () => {
    verify(); client.get('/api/users').subscribe({ error() {} });
    http.expectOne('/api/users').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(user.getToken()).toBe('verified-token'); verify();
  });

  it('keeps an existing session after a failed login attempt', () => {
    verify(); user.postUserLogin({}).subscribe({ error() {} });
    http.expectOne('/api/passport/user/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    user.getCurrentUser().subscribe(); http.expectNone('/api/passport/user');
    expect(user.getToken()).toBe('verified-token');
  });

  it('cancels unused verification and starts a fresh request when navigating again', () => {
    const subscription = user.getCurrentUser().subscribe();
    const request = http.expectOne('/api/passport/user'); subscription.unsubscribe();
    expect(request.cancelled).toBeTrue(); verify();
  });

  it('refreshes the verified identity after a successful profile update', () => {
    verify(); user.updateProfile({}).subscribe();
    http.expectOne('/api/users/me').flush({ user: { username: 'renamed', permissions: { level: 4 } }, token: 'updated-token' });
    let result: any; user.getCurrentUser().subscribe(value => result = value);
    expect(result.username).toBe('renamed'); expect(user.getToken()).toBe('updated-token');
    http.expectNone('/api/passport/user');
  });
});
