import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';

describe('Named production layout preference client',()=>{
 it('lists scopes without overwriting the working layout, then activates create/load responses and clears defaults on logout',()=>{
  TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
  const service=TestBed.inject(SettingsService),http=TestBed.inject(HttpTestingController);let preferences:any;service.userPreferences$.subscribe(value=>preferences=value);
  service.getProductionLayouts().subscribe();http.expectOne('/api/preferences/production-layouts').flush({layouts:[],defaultLayout:null});expect(preferences).toBeNull();
  const stationIds=['100:3','100:1','200:2'];const result:any={stations:[],layout:{id:'a',scope:'user',name:'New',stationIds},preferences:{theme:'dark',defaultProductionScreenLayout:{scope:'user',id:'a'},dashboardLayouts:{experimentalSpf:{stationOrder:stationIds,stationVisibility:{}}}}};
  service.createProductionLayout('user','New',stationIds).subscribe();const create=http.expectOne('/api/preferences/production-layouts/user');
  expect(create.request.body).toEqual({name:'New',stationIds});expect(create.request.headers.has('X-Skip-Error-Modal')).toBeTrue();create.flush(result);expect(preferences.defaultProductionScreenLayout.id).toBe('a');
  service.loadProductionLayout({scope:'system',id:'b'}).subscribe();const load=http.expectOne('/api/preferences/production-layouts/load');expect(load.request.body).toEqual({scope:'system',id:'b'});
  load.flush({...result,preferences:{...result.preferences,defaultProductionScreenLayout:{scope:'system',id:'b'}}});expect(preferences.defaultProductionScreenLayout.scope).toBe('system');
  service.clearUserPreferences();expect(preferences).toBeNull();http.verify();
 });
});
