import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TokenManagementService } from './token-management.service';

describe('TokenManagementService controller access', () => {
  let service: TokenManagementService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TokenManagementService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('sends exact grants to the dedicated endpoint and delegates error display to the modal', () => {
    service.updateControllerAccess('token-id', ['general', 'milnor']).subscribe();
    const request = http.expectOne('/api/auth/tokens/token-id/controllers');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ allowedControllers: ['general', 'milnor'] });
    expect(request.request.headers.has('X-Skip-Error-Modal')).toBeTrue();
    request.flush({ success: true, allowedControllers: ['general', 'milnor'] });
  });

  it('propagates save errors for retry instead of treating them as a successful save', () => {
    const error = jasmine.createSpy('error');
    service.updateControllerAccess('token-id', []).subscribe({ error });
    http.expectOne('/api/auth/tokens/token-id/controllers').flush({ error: 'Token is inactive' }, { status: 409, statusText: 'Conflict' });
    expect(error).toHaveBeenCalledTimes(1);
  });
});
