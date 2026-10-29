const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const WebSocket = require('ws');
const { DatafeedMinuteSync, validateSnapshot, entityKey } = require('../modules/datafeedMinuteSync');
const { database } = require('./helpers/minute-sync-db');
const { buildLiveProductionStatsCache } = require('../utils/productionStatsCache');
const start = Date.parse('2026-10-29T14:00:00Z');
const token = 'test-service-token-with-at-least-32-characters';
function snapshot({ complete = false, revision = 1, count = 2, machineId = 21 } = {}) {
  const end = complete ? start + 60000 : start + 30000;
  return { type: 'minute-totals', version: 1, machineId, minuteStart: new Date(start).toISOString(), minuteEnd: new Date(start + 60000).toISOString(), calculatedAt: new Date(end).toISOString(), complete, revision,
    documents: [{ id: `machine-${machineId}-2026-10-29-14-00Z`, type: 'machine', machine: { id: machineId, serial: machineId, name: 'Machine' },
      timestamps: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, totals: { count, runtimeMs: end - start, workedTimeMs: end - start } }],
  };
}
function fixture() {
  const db = database();
  const service = new DatafeedMinuteSync({ db, token, clock: () => start + 90000, logger: { error() {} } });
  return { db, service };
}

test('active minute stays in memory, live updates do not read/write Mongo per count, and only completion persists', async () => {
  const { db, service } = fixture();
  await service.receive(snapshot(), 'producer-a');
  const metadata = db.collection('totals-minute-sync'), reads = metadata.reads, writes = metadata.writes;
  for (let revision = 2; revision < 10; revision++) await service.receive(snapshot({ revision, count: revision }), 'producer-a');
  assert.equal(db.collection('totals-minute').writes, 0);
  assert.equal(metadata.reads, reads);
  assert.equal(metadata.writes, writes);
  assert.equal(service.overlay([], start + 90000).documents[0].totals.count, 9);
  await service.receive(snapshot({ complete: true, revision: 10, count: 10 }), 'producer-a');
  assert.equal(db.collection('totals-minute').rows.length, 1);
  assert.equal(db.collection('totals-minute').rows[0].totals.count, 10);
  assert.equal(db.collection('totals-minute').rows[0].expiresAt, undefined);
  assert.ok(db.collection('totals-minute').rows[0].timestamps.update instanceof Date);
  const before = db.collection('totals-minute').writes;
  await service.receive(snapshot({ complete: true, revision: 10, count: 10 }), 'producer-a');
  await service.receive(snapshot({ revision: 99, count: 999 }), 'producer-a');
  assert.equal(db.collection('totals-minute').writes, before, 'duplicate final and late partial cannot replace committed data');
});

test('failed or partial persistence is not acknowledged and the same revision retries through commit', async () => {
  const { db, service } = fixture();
  db.collection('totals-minute').fail = true;
  await assert.rejects(service.receive(snapshot({ complete: true }), 'owner'), /Mongo unavailable/);
  assert.equal(db.collection('totals-minute-sync').rows.filter(row => row.kind === 'bucket').length, 0);
  db.collection('totals-minute').fail = false;
  db.collection('totals-minute-sync').fail = true;
  await assert.rejects(service.receive(snapshot({ complete: true }), 'owner'), /checkpoint/);
  db.collection('totals-minute-sync').fail = false;
  const ack = await service.receive(snapshot({ complete: true }), 'owner');
  assert.equal(ack.type, 'minute-totals-ack');
  assert.equal(db.collection('totals-minute').rows.length, 1);
  assert.equal(db.collection('totals-minute-sync').rows.filter(row => row.kind === 'bucket').length, 1);
});

test('ownership is exclusive across server instances sharing Mongo', async () => {
  const { db, service } = fixture();
  const second = new DatafeedMinuteSync({ db, token, clock: () => start + 90000 });
  await service.receive(snapshot(), 'owner-one');
  await assert.rejects(second.receive(snapshot(), 'owner-two'), /already owned/);
  await second.receive(snapshot({ machineId: 22 }), 'owner-two');
  const afterExpiry = new DatafeedMinuteSync({ db, token, clock: () => start + 121000 });
  await afterExpiry.receive(snapshot({ revision: 2 }), 'owner-two');
});

test('overlay replaces a whole bucket, bridges an in-flight old DB read and never doubles committed rows', async () => {
  const { db, service } = fixture();
  const old = validateSnapshot(snapshot({ count: 1 }), start + 90000).documents[0];
  await service.receive(snapshot({ revision: 2, count: 3 }), 'owner');
  assert.equal(service.overlay([old], start + 90000).documents.length, 1);
  assert.equal(service.overlay([old], start + 90000).documents[0].totals.count, 3);
  await service.receive(snapshot({ complete: true, revision: 3, count: 4 }), 'owner');
  assert.equal(service.overlay([old], start + 90000).documents[0].totals.count, 4);
  const persisted = db.collection('totals-minute').rows;
  assert.equal(service.overlay(persisted, start + 90000).documents.length, 1);
  assert.equal(new Set(service.overlay(persisted, start + 90000).documents.map(entityKey)).size, 1);
});

test('validates boundaries, entity identities, metric values and incomplete writes', () => {
  for (const mutate of [
    frame => { frame.complete = true; },
    frame => { frame.documents[0].machine.id = 999; },
    frame => { frame.documents[0].totals.count = -1; },
    frame => { frame.documents[0].totals.count = Infinity; },
    frame => { frame.documents[0].id = 'wrong-id'; },
    frame => { frame.documents.push(frame.documents[0]); },
  ]) {
    const frame = snapshot(); mutate(frame);
    assert.throws(() => validateSnapshot(frame, start + 90000));
  }
  assert.throws(() => validateSnapshot(snapshot({ complete: true }), start + 30000), /boundary/);
});

test('API cache can consume live totals without issuing Mongo reads', async () => {
  const { service } = fixture();
  await service.receive(snapshot({ count: 7 }), 'owner');
  service.productionInputs = { documents: [], tickers: [], shifts: [], currentSessions: [] };
  const cache = buildLiveProductionStatsCache(service, new Date(start + 30000));
  assert.equal(cache.machines['21'].stats.lastFifteenMinutes.validCount, 7);
});

test('real WebSocket authenticates before accepting data and acknowledges only applied snapshots', async t => {
  const { service } = fixture();
  const server = http.createServer();
  const wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws, req) => service.accept(ws, req));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    service.stop();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });
  const url = `ws://127.0.0.1:${server.address().port}/ws?channel=datafeed-minute`;
  const denied = new WebSocket(url);
  const closed = once(denied, 'close'); await once(denied, 'open');
  const [code] = await closed; assert.equal(code, 1008);
  const client = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
  await once(client, 'open');
  const response = once(client, 'message'); client.send(JSON.stringify(snapshot()));
  assert.equal(JSON.parse((await response)[0].toString()).type, 'minute-totals-ack');
  client.terminate();
});

test('UTC IDs cannot overwrite a legacy local-time ID belonging to a different minute', async () => {
  const { db, service } = fixture();
  const legacy = validateSnapshot(snapshot({ complete: true }), start + 90000).documents[0];
  legacy.id = 'machine-21-2026-10-29-14-00';
  legacy.timestamps.start = new Date(start + 5 * 3600000);
  legacy.timestamps.end = new Date(start + 5 * 3600000 + 60000);
  db.collection('totals-minute').rows.push(legacy);
  await service.receive(snapshot({ complete: true }), 'owner');
  assert.equal(db.collection('totals-minute').rows.length, 2);
  assert.ok(db.collection('totals-minute').rows.some(row => row.id === legacy.id && row.timestamps.start.getTime() === start + 5 * 3600000));
});

test('server owns minute lookup, identity and timestamps.update TTL indexes', async () => {
  const { db, service } = fixture(); await service.start();
  const indexes = db.collection('totals-minute').indexes;
  assert.ok(indexes.some(index => index.options.unique && index.keys.id === 1));
  assert.ok(indexes.some(index => index.keys['timestamps.update'] === 1 && index.options.expireAfterSeconds === 172800));
  assert.equal(indexes.some(index => index.keys.expiresAt), false);
});

test('service channel is isolated from browser broadcasts and client-session inventory', async t => {
  const { service } = fixture();
  const { startWebsocketServer } = require('../modules/websocketServer');
  const app = http.createServer();
  const server = { config: {}, cache: {}, minuteTotalsSync: service, logger: { info() {}, error() {} }, logDb: { collection: () => ({ insertOne: async () => {} }) } };
  const wss = startWebsocketServer(server, { httpServer: app });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${app.address().port}/ws`;
  const browser = new WebSocket(url);
  const events = new (require('node:events').EventEmitter)();
  browser.on('message', data => events.emit(JSON.parse(data.toString()).type));
  await once(browser, 'open');
  const producer = new WebSocket(`${url}?channel=datafeed-minute`, { headers: { Authorization: `Bearer ${token}` } });
  const received = [];
  producer.on('message', data => received.push(JSON.parse(data.toString()).type));
  await once(producer, 'open');
  t.after(async () => {
    browser.terminate(); producer.terminate(); service.stop();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => app.close(resolve));
  });
  const broadcast = once(events, 'browser-only');
  server.broadcastWebsocket({ type: 'browser-only' }); await broadcast;
  const reply = once(producer, 'message'); producer.send(JSON.stringify(snapshot())); await reply;
  assert.deepEqual(received, ['minute-totals-ack']);
  assert.equal(server.clientSessions.length, 1);
});
