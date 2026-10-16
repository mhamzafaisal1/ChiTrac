import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { UserService } from './user.service';
import { AuthInterceptor } from './auth.interceptor';

describe('UserService', () => {
  let service: UserService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptorsFromDi()),
      provideHttpClientTesting(),
      { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
    ] });
    service = TestBed.inject(UserService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('restores the user with the stored Bearer token and retains it for API requests', async () => {
    localStorage.setItem('token', 'valid-login-token');
    const result = firstValueFrom(service.getCurrentUser());
    const request = http.expectOne('/api/passport/user');
    expect(request.request.headers.get('Authorization')).toBe('Bearer valid-login-token');
    request.flush({ user: { username: 'report-user', permissions: { level: 4 } } });
    expect((await result)?.username).toBe('report-user');
    expect(service.getToken()).toBe('valid-login-token');
  });

  it('clears expired credentials when the server rejects authentication', async () => {
    localStorage.setItem('token', 'expired-login-token');
    const result = firstValueFrom(service.getCurrentUser());
    http.expectOne('/api/passport/user').flush({ error: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBeNull();
    expect(service.getToken()).toBeNull();
  });
});
