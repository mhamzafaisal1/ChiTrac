import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { forkJoin } from 'rxjs';
import { ConfigurationService } from '../configuration.service';
import { ConfigurationCacheService } from './configuration-cache.service';
import { WebsocketService } from './websocket.service';
import { ShiftService } from './shift.service';
import { EfficiencyScreensService } from './efficiency-screens.service';

class TestSocket {
  static OPEN = 1; static CONNECTING = 0;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  sent: any[] = [];
  constructor(public url: string) { TestSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: any) { this.onmessage?.({ data: JSON.stringify(message) }); }
  send(message: string) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.onclose?.(); }
}

describe('shared configuration websocket cache', () => {
  const names = { machine: 'config-machine', operator: 'config-operator', item: 'config-item',
    shift: 'config-shift', maintenanceShift: 'config-shift-maintenance', fault: 'config-fault', status: 'config-status' };
  const initial = (): any => ({ type: 'configuration-cache', epoch: 'server-1', revision: 1, names, collections: {
    'config-machine': [{ _id: 'm1', id: 1, name: 'SPF1', active: true, stations: [1, 2] }],
    'config-operator': [{ _id: 'o1', id: 123 }, { _id: 'o2', id: 500001 }],
    'config-item': [], 'config-fault': [{ code: 2 }], 'config-status': [{ code: 1 }],
    'config-shift': [{ _id: 's2', active: false, name: 'Later', startTime: { hour: 15, minute: 0 } },
      { _id: 's1', active: true, name: 'Morning', startTime: { hour: 6, minute: 0 } }],
    'config-shift-maintenance': [], 'config-user': [{ password: 'excluded' }]
  } });
  let originalSocket: typeof WebSocket;
  let websocket: WebsocketService;
  let cache: ConfigurationCacheService;
  let configuration: ConfigurationService;
  let http: HttpTestingController;
  let socket: TestSocket;
  beforeEach(() => {
    originalSocket = window.WebSocket;
    (window as any).WebSocket = TestSocket;
    TestSocket.instances = [];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    websocket = TestBed.inject(WebsocketService);
    cache = TestBed.inject(ConfigurationCacheService);
    configuration = TestBed.inject(ConfigurationService);
    http = TestBed.inject(HttpTestingController);
    websocket.ensureConnected();
    socket = TestSocket.instances[0]; socket.open();
  });
  afterEach(() => { websocket.disconnect(); (window as any).WebSocket = originalSocket; http.verify(); });

  it('waits for initial sync, completes forkJoin reads, preserves filters and never fetches config by REST', () => {
    let completed = false;
    let result: any;
    forkJoin({ machines: configuration.getMachineConfigs(), operators: configuration.getOperatorConfigs(),
      items: configuration.getItemConfigs(), shifts: TestBed.inject(ShiftService).getActiveShifts(),
      maintenance: TestBed.inject(ShiftService).getAllMaintenanceShifts(),
      faults: configuration.getFaultConfigs(), statuses: configuration.getStatusConfigs()
    }).subscribe({ next: value => result = value, complete: () => completed = true });
    expect(result).toBeUndefined();
    socket.receive(initial());
    expect(completed).toBeTrue();
    expect(result.machines[0].name).toBe('SPF1');
    expect(result.operators.map((row: any) => row.id)).toEqual([123]);
    expect(result.items).toEqual([]);
    expect(result.shifts.shifts.map((row: any) => row._id)).toEqual(['s1']);
    expect(result.maintenance.shifts).toEqual([]);
    expect(TestSocket.instances.length).toBe(1);
    http.expectNone(request => /config|shifts/.test(request.url));
  });

  it('reuses cached values for repeated reads and protects nested configuration from editor mutations', () => {
    socket.receive(initial());
    configuration.getMachineConfigs().subscribe(rows => { rows[0].name = 'Draft'; rows[0].stations.push(8); });
    configuration.getMachineConfigs().subscribe(rows => {
      expect(rows[0].name).toBe('SPF1'); expect(rows[0].stations).toEqual([1, 2]);
    });
    expect(socket.sent).toEqual([jasmine.objectContaining({ type: 'server-info-request' })]);
  });

  it('updates live subscribers only when their collection changes and applies empty arrays as deletions', () => {
    const machines: any[][] = [];
    const sub = configuration.watchMachineConfigs().subscribe(rows => machines.push(rows));
    socket.receive(initial());
    socket.receive({ type: 'configuration-cache-update', epoch: 'server-1', revision: 2, names, collections: { 'config-item': [{ _id: 'i1' }] } });
    expect(machines.length).toBe(1);
    socket.receive({ type: 'configuration-cache-update', epoch: 'server-1', revision: 3, names, collections: { 'config-machine': [] } });
    expect(machines).toEqual([jasmine.any(Array), []]);
    sub.unsubscribe();
  });

  it('rejects stale updates, requests a full sync on a revision gap, and accepts a restarted server', () => {
    socket.receive(initial());
    socket.receive({ type: 'configuration-cache-update', epoch: 'server-1', revision: 3, names, collections: { 'config-machine': [] } });
    expect(socket.sent.at(-1).type).toBe('configuration-cache-request');
    socket.receive({ ...initial(), revision: 3, collections: { ...initial().collections, 'config-machine': [] } });
    socket.receive(initial());
    cache.read('machine').subscribe(rows => expect(rows).toEqual([]));
    socket.receive({ ...initial(), epoch: 'server-2' });
    cache.read('machine').subscribe(rows => expect(rows.length).toBe(1));
    websocket.configurationCache$.subscribe(state => expect(state!.collections['config-user']).toBeUndefined()).unsubscribe();
  });

  it('resynchronizes after a disconnected client reconnects without configuration REST requests', fakeAsync(() => {
    socket.receive(initial());
    const seen: any[][] = [];
    const sub = configuration.watchMachineConfigs().subscribe(rows => seen.push(rows));
    socket.close(); tick(10000);
    const nextSocket = TestSocket.instances.at(-1)!; nextSocket.open();
    nextSocket.receive({ ...initial(), revision: 4, collections: { ...initial().collections, 'config-machine': [] } });
    expect(seen.at(-1)).toEqual([]);
    sub.unsubscribe();
  }));

  it('reports an unavailable initial sync instead of presenting an empty configuration as loaded', fakeAsync(() => {
    let failure: any;
    cache.read('machine').subscribe({ error: error => failure = error });
    tick(15000);
    expect(failure?.name).toBe('TimeoutError');
  }));

  it('retains REST writes and uses the cached machine catalog for SPF lists', () => {
    socket.receive(initial());
    configuration.postMachineConfig({ name: 'New' } as any).subscribe();
    http.expectOne({ method: 'POST', url: '/api/machine/config' }).flush({ _id: 'm2' });
    TestBed.inject(EfficiencyScreensService).getSPFMachines().subscribe(rows => {
      expect(rows[0].serial).toBe(1); expect(rows[0].name).toBe('SPF1');
    });
    http.expectNone({ method: 'GET', url: '/api/machine/config' });
    http.expectNone('/api/machine/spf');
  });
  it('closes the live connection and clears synchronized snapshots when signing out', () => {
    socket.receive(initial());
    let configuration:any, dashboard:any, session:any;
    const subscriptions=[websocket.configurationCache$.subscribe(value=>configuration=value),websocket.dashboardCache$.subscribe(value=>dashboard=value),websocket.sessionId$.subscribe(value=>session=value)];
    expect(configuration).not.toBeNull(); websocket.resetSession();
    expect(socket.readyState).toBe(3);expect(configuration).toBeNull();expect(dashboard).toEqual({});expect(session).toBeNull();
    subscriptions.forEach(subscription=>subscription.unsubscribe());
  });

  it('keeps public connection status valid while clearing private snapshots on logout', () => {
    socket.receive(initial());
    socket.receive({ type: 'dashboard-cache', cache: { today: { machinesSummary: [{ id: 1 }] } } });
    let status: string | undefined, configuration: any, message: string | undefined;
    const subscriptions = [websocket.status$.subscribe(value => status = value), websocket.configurationCache$.subscribe(value => configuration = value), websocket.message$.subscribe(value => message = value)];
    websocket.ensureConnected('status');
    const publicSocket = TestSocket.instances.at(-1)!;
    expect(socket.readyState).toBe(3);
    expect(new URL(publicSocket.url).searchParams.get('channel')).toBe('connection-status');
    expect(configuration).toBeNull();
    expect(websocket.getDashboardCacheSnapshot()).toEqual({});
    expect(message).toBe('No websocket messages received.');
    publicSocket.open();
    expect(status).toBe('connected');
    expect(publicSocket.sent[0].type).toBe('connection-status-request');
    // Ignore data from an older server or a queued callback during logout.
    publicSocket.receive(initial()); socket.open(); socket.receive(initial());
    expect(configuration).toBeNull();
    websocket.ensureConnected('status');
    expect(TestSocket.instances.at(-1)).toBe(publicSocket);
    websocket.ensureConnected();
    const privateSocket = TestSocket.instances.at(-1)!;
    expect(privateSocket).not.toBe(publicSocket);
    expect(new URL(privateSocket.url).searchParams.has('channel')).toBeFalse();
    privateSocket.open(); privateSocket.receive(initial());
    expect(configuration).not.toBeNull();
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });

  it('retains status-only mode through connection fallback and automatic reconnect', fakeAsync(() => {
    websocket.ensureConnected('status');
    const first = TestSocket.instances.at(-1)!;
    first.onerror?.();
    const fallback = TestSocket.instances.at(-1)!;
    expect(new URL(fallback.url).searchParams.get('channel')).toBe('connection-status');
    fallback.open(); fallback.close(); tick(10000);
    const reconnected = TestSocket.instances.at(-1)!;
    expect(new URL(reconnected.url).searchParams.get('channel')).toBe('connection-status');
    reconnected.open();
    expect(reconnected.sent[0].type).toBe('connection-status-request');
  }));
});
