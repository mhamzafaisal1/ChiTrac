import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';

describe('Experimental layout preferences', () => {
  let settings: SettingsService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    settings = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('saves and reloads grid, chart order and visibility together', () => {
    const layout = { gridLayout: '2x2', chartOrder: ['machine-status'], chartVisibility: { 'machine-status': true } };
    settings.saveExperimentalDailyDashboardChartOrder(layout.chartOrder, layout.chartVisibility, '2x2').subscribe();
    const request = http.expectOne('/api/preferences/user');
    expect(request.request.body).toEqual({ dashboardLayouts: { experimentalDailyDashboard: layout } });
    request.flush({ dashboardLayouts: { experimentalDailyDashboard: layout } });
    let effective: any;
    settings.userPreferences$.subscribe(value => effective = value);
    expect(effective.dashboardLayouts.experimentalDailyDashboard).toEqual(layout);
    settings.loadUserPreferences().subscribe();
    http.expectOne('/api/preferences/user').flush({ dashboardLayouts: { experimentalDailyDashboard: layout } });
    expect(effective.dashboardLayouts.experimentalDailyDashboard.gridLayout).toBe('2x2');
  });

  it('keeps local edits and restores promoted system defaults on logout', () => {
    settings.loadSettings().subscribe();
    http.expectOne('/api/utilities/settings').flush({ dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '2x2' } } });
    settings.setExperimentalDailyDashboardChartOrder([], {}, '3x2');
    let effective: any;
    settings.userPreferences$.subscribe(value => effective = value);
    expect(effective.dashboardLayouts.experimentalDailyDashboard.gridLayout).toBe('3x2');
    settings.clearUserPreferences();
    expect(effective.dashboardLayouts.experimentalDailyDashboard.gridLayout).toBe('2x2');
  });
});
