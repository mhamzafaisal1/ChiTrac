import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';
import { normalizeSpfLayout, configuredProductionStations } from '../efficiency-screens/experimental-spf/spf-stations';

describe('Experimental SPF preference persistence', () => {
  it('saves through the per-user API, reloads the layout and clears it for the next account', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const settings = TestBed.inject(SettingsService), http = TestBed.inject(HttpTestingController);
    const layout = normalizeSpfLayout({ stationOrder: ['500:2','500:1','600:1'], stationVisibility: {} }, configuredProductionStations([{id:500,name:'A',active:true,stations:[1,2]},{id:600,name:'B',active:true,stations:[1]}] as any));
    let effective: any; settings.userPreferences$.subscribe(value => effective = value);
    settings.saveExperimentalSpfLayout(layout).subscribe(); const save = http.expectOne('/api/preferences/user');
    expect(save.request.method).toBe('PUT'); expect(save.request.body).toEqual({ dashboardLayouts: { experimentalSpf: layout } });
    save.flush({ userId: 'alice', dashboardLayouts: { experimentalSpf: layout }, theme: 'dark' });
    expect(effective.dashboardLayouts.experimentalSpf).toEqual(layout);
    settings.loadUserPreferences().subscribe(); http.expectOne('/api/preferences/user').flush({ userId: 'alice', dashboardLayouts: { experimentalSpf: layout } });
    expect(effective.dashboardLayouts.experimentalSpf.stationOrder[0]).toBe('500:2');
    settings.clearUserPreferences(); expect(effective).toBeNull();
    settings.loadUserPreferences().subscribe(); http.expectOne('/api/preferences/user').flush({ userId: 'bob' });
    expect(effective.dashboardLayouts?.experimentalSpf).toBeUndefined(); http.verify();
  });
});
