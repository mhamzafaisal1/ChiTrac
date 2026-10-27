import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { UserService } from '../user.service';
import { SettingsService } from './settings.service';
import { ProductionScreenLayoutsService, ProductionScreenMenuState } from './production-screen-layouts.service';

describe('Production screen navigation library', () => {
  let http: HttpTestingController, service: ProductionScreenLayoutsService;
  let identity: BehaviorSubject<any>, created: Subject<void>, latest: ProductionScreenMenuState;
  const url = '/api/production-screen-layouts';
  const layout = (name: string, scope: 'system' | 'user', id = name) => ({ name, scope, id, stationIds: [] as string[], createdAt: '' });

  beforeEach(() => {
    identity = new BehaviorSubject(null); created = new Subject();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: UserService, useValue: { user: identity } },
      { provide: SettingsService, useValue: { productionLayoutsChanged$: created } },
    ] });
    service = TestBed.inject(ProductionScreenLayoutsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('shares a single read and sorts System and User groups independently with distinct identities', () => {
    identity.next({ username: 'alice' });
    const first = service.state$.subscribe(state => latest = state);
    const second = service.state$.subscribe();
    const request = http.expectOne(url);
    expect(request.request.method).toBe('GET');
    request.flush({ layouts: [layout('Zoo', 'system'), layout('Alpha', 'user'), layout('Line 10', 'system'), layout('Line 2', 'system'), layout('Alpha', 'system')], defaultLayout: null });
    expect(latest.systemLayouts.map(entry => entry.name)).toEqual(['Alpha', 'Line 2', 'Line 10', 'Zoo']);
    expect(latest.userLayouts.map(entry => entry.name)).toEqual(['Alpha']);
    expect(latest.error).toBe(''); first.unsubscribe(); second.unsubscribe();
  });

  it('cancels previous-account requests and immediately clears private layouts on logout', () => {
    identity.next({ username: 'alice' });
    const subscription = service.state$.subscribe(state => latest = state);
    http.expectOne(url).flush({ layouts: [layout('Private', 'user')], defaultLayout: null });
    expect(latest.userLayouts.length).toBe(1);
    service.refresh(); const pending = http.expectOne(url);
    identity.next(null);
    expect(pending.cancelled).toBeTrue(); expect(latest.userLayouts).toEqual([]);
    http.expectOne(url).flush({ layouts: [layout('Shared', 'system')], defaultLayout: null });
    expect(latest.systemLayouts.length).toBe(1); expect(latest.userLayouts).toEqual([]);
    subscription.unsubscribe();
  });

  it('keeps errors retryable and refreshes after layout creation', () => {
    const subscription = service.state$.subscribe(state => latest = state);
    http.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(latest.error).toContain('Could not load');
    service.refresh(); http.expectOne(url).flush({ layouts: [], defaultLayout: null });
    expect(latest.error).toBe('');
    created.next(); http.expectOne(url).flush({ layouts: [layout('New', 'system')], defaultLayout: null });
    expect(latest.systemLayouts[0].name).toBe('New'); subscription.unsubscribe();
  });

  it('keeps current entries visible while refreshing and only shows loading when empty', () => {
    identity.next({ username: 'alice' });
    const subscription = service.state$.subscribe(state => latest = state);
    expect(latest.loading).toBeTrue();
    http.expectOne(url).flush({ layouts: [layout('Shared', 'system'), layout('Mine', 'user')], defaultLayout: null });
    service.refresh();
    expect(latest.loading).toBeFalse();
    expect(latest.systemLayouts.map(entry => entry.name)).toEqual(['Shared']);
    expect(latest.userLayouts.map(entry => entry.name)).toEqual(['Mine']);
    http.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(latest.error).toContain('Could not load'); expect(latest.systemLayouts.length).toBe(1);
    identity.next(null);
    expect(latest.userLayouts).toEqual([]); expect(latest.systemLayouts.length).toBe(1);
    http.expectOne(url).flush({ layouts: [layout('Shared', 'system')], defaultLayout: null });
    subscription.unsubscribe();
  });

  it('reads a named layout using GET without activating it or changing settings', () => {
    service.read({ scope: 'user', id: 'a'.repeat(64) }).subscribe();
    const request = http.expectOne(url + '/user/' + 'a'.repeat(64));
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('X-Skip-Error-Modal')).toBe('true');
    request.flush({ layout: layout('Mine', 'user'), stationLayout: { stationOrder: [], stationVisibility: {} } });
  });
});
