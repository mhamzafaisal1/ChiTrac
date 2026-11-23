import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';
import { DailyDashboardLayout } from './daily-layout.models';

describe('Named daily layout preference client', () => {
  let settings: SettingsService;
  let http: HttpTestingController;
  let preferences: any;
  const layout: DailyDashboardLayout = {
    gridLayout: '2x2',
    chartOrder: ['machine-status', 'machine-oee', 'item-totals', 'top-operators', 'machine-timeline', 'machine-group-efficiency', 'daily-counts'],
    chartVisibility: { 'machine-status': true, 'machine-oee': true, 'item-totals': true, 'top-operators': true, 'machine-timeline': false, 'machine-group-efficiency': false, 'daily-counts': false }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    settings = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
    settings.userPreferences$.subscribe(value => preferences = value);
  });
  afterEach(() => http.verify());

  it('lists without altering the dashboard and restores create/load results through effective preferences', () => {
    settings.getDailyLayouts().subscribe();
    http.expectOne('/api/preferences/daily-layouts').flush({ layouts: [], defaultLayout: null });
    expect(preferences).toBeNull();
    const response = { layout: { name: 'Daily', id: 'a', scope: 'user', layout }, preferences: {
      theme: 'dark', defaultDailyDashboardLayout: { scope: 'user', id: 'a' }, dashboardLayouts: { experimentalDailyDashboard: layout }
    } };
    settings.createDailyLayout('user', 'Daily', layout).subscribe();
    const create = http.expectOne('/api/preferences/daily-layouts/user');
    expect(create.request.body).toEqual({ name: 'Daily', layout });
    expect(create.request.headers.has('X-Skip-Error-Modal')).toBeTrue();
    create.flush(response);
    expect(preferences.dashboardLayouts.experimentalDailyDashboard).toEqual(layout);
    settings.loadDailyLayout({ scope: 'system', id: 'b' }).subscribe();
    const load = http.expectOne('/api/preferences/daily-layouts/load');
    expect(load.request.body).toEqual({ scope: 'system', id: 'b' });
    load.flush({ ...response, preferences: { ...response.preferences, defaultDailyDashboardLayout: { scope: 'system', id: 'b' } } });
    expect(preferences.defaultDailyDashboardLayout.scope).toBe('system');
    settings.clearUserPreferences();
    expect(preferences).toBeNull();
  });

  it('preserves the working layout on save failure and cancels pending daily requests on logout', () => {
    settings.setDailyDashboardChartOrder(layout.chartOrder, layout.chartVisibility, layout.gridLayout);
    settings.createDailyLayout('system', 'Daily', layout).subscribe({ error() {} });
    http.expectOne('/api/preferences/daily-layouts/system').flush({ error: 'Duplicate name' }, { status: 409, statusText: 'Conflict' });
    expect(preferences.dashboardLayouts.experimentalDailyDashboard).toEqual(layout);
    settings.loadDailyLayout({ scope: 'user', id: 'a' }).subscribe();
    const pending = http.expectOne('/api/preferences/daily-layouts/load');
    settings.clearUserPreferences();
    expect(pending.cancelled).toBeTrue();
    expect(preferences).toBeNull();
  });
});
