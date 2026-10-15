import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';

describe('SettingsService time format', () => {
  let settings: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    settings = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('defaults to AM/PM and saves only the user preference', () => {
    expect(settings.getTimeFormat()).toBe('12h');
    settings.saveTimeFormat('24h').subscribe();
    const request = http.expectOne('/api/preferences/user');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ timeFormat: '24h' });
    request.flush({ timeFormat: '24h', theme: 'dark' });
    expect(settings.getTimeFormat()).toBe('24h');
    expect(settings.formatTime(new Date(2026, 9, 7, 13, 5))).toBe('13:05');
  });

  it('restores saved settings on load and resets them on logout', () => {
    settings.loadUserPreferences().subscribe();
    http.expectOne('/api/preferences/user').flush({ timeFormat: '24h' });
    expect(settings.getTimeFormat()).toBe('24h');
    settings.clearUserPreferences();
    expect(settings.getTimeFormat()).toBe('12h');
  });

  it('keeps the previous setting if saving fails', () => {
    settings.saveTimeFormat('24h').subscribe({ error: () => {} });
    http.expectOne('/api/preferences/user').flush({}, { status: 500, statusText: 'Error' });
    expect(settings.getTimeFormat()).toBe('12h');
  });

  it('does not inherit time format from system preferences', () => {
    settings.loadSettings().subscribe();
    http.expectOne('/api/utilities/settings').flush({ timeFormat: '24h' });
    expect(settings.getTimeFormat()).toBe('12h');
  });
});
