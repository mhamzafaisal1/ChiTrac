const test = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const http = require('node:http');
const WebSocket = require('ws');
const { startWebsocketServer } = require('../modules/websocketServer');
const { buildDashboardCacheMessage, refreshProductionStatsCache } = require('../modules/mongoWatchers');

test('production deltas do not traverse unrelated dashboard or history caches', () => {
  const production = { updatedAt: 'now', machines: { '90008': { status: 1 } }, operators: {} };
  const dashboard = { production };
  for (const key of ['machines', 'operators', 'dailyAnalytics', 'counts']) {
    Object.defineProperty(dashboard, key, { enumerable: true, get() { throw new Error('Unrelated cache read: ' + key); } });
  }
  const message = buildDashboardCacheMessage({ cache: { dashboard } }, 'production', { partial: true });
  assert.deepEqual(JSON.parse(JSON.stringify(message)).cache, { dashboard: { production } });
  assert.equal(message.partial, true);
  assert.equal(message.dashboard, undefined, 'Do not duplicate the dashboard alias');
});

test('production update size is independent of retained dashboard history', () => {
  const server = { cache: { dashboard: { production: { machines: {}, operators: {} },
    machines: { history: { days: Array.from({ length: 1000 }, (_, id) => ({ id, value: 'x'.repeat(1000) })) } } } } };
  const full = JSON.stringify(buildDashboardCacheMessage(server, 'production'));
  const partial = JSON.stringify(buildDashboardCacheMessage(server, 'production', { partial: true }));
  assert.ok(partial.length < 300);
  assert.ok(full.length > partial.length * 1000);
});

async function fixture(t, count = 1) {
  const server = { config: {}, cache: {}, logger: { info() {}, error() {} },
    logDb: { collection: () => ({ insertOne: async () => {} }) } };
  const listeners = [], sockets = [], clients = [];
  t.after(async () => {
    clients.forEach(client => client.terminate());
    for (const wss of sockets) { for (const client of wss.clients) client.terminate(); }
    for (const wss of sockets) await new Promise(resolve => wss.close(resolve));
    for (const listener of listeners) await new Promise(resolve => listener.close(resolve));
  });
  for (let i = 0; i < count; i++) {
    const listener = http.createServer();
    listeners.push(listener);
    sockets.push(startWebsocketServer(server, { httpServer: listener }));
    listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  }
  async function connect(index, query = '') {
    const events = new EventEmitter();
    const client = new WebSocket(`ws://127.0.0.1:${listeners[index].address().port}/ws${query}`);
    clients.push(client);
    client.on('message', data => { const value = JSON.parse(String(data)); events.emit(value.type, value); });
    await once(events, query.includes('connection-status') ? 'connection-status' : 'dashboard-cache-update', { signal: AbortSignal.timeout(3000) });
    return events;
  }
  return { server, connect };
}

test('broadcast skips serialization with no browser recipients, including status-only clients', async t => {
  const h = await fixture(t);
  const payload = { type: 'probe', toJSON() { throw new Error('Should not serialize without recipients'); } };
  h.server.broadcastWebsocket(payload);
  await h.connect(0, '?channel=connection-status');
  h.server.broadcastWebsocket(payload);
});

test('serializes once across listeners and builds full fallback only for legacy recipients', async t => {
  const h = await fixture(t, 2);
  const modern = [await h.connect(0, '?dashboardUpdates=partial'), await h.connect(1, '?dashboardUpdates=partial')];
  let serializations = 0, legacyBuilds = 0;
  const payload = { type: 'probe', partial: true, toJSON() { serializations++; return { type: 'probe', partial: true }; } };
  const fallback = () => { legacyBuilds++; return { type: 'probe', full: true }; };
  let deliveries = modern.map(events => once(events, 'probe', { signal: AbortSignal.timeout(3000) }));
  h.server.broadcastWebsocket(payload, fallback);
  await Promise.all(deliveries);
  assert.equal(serializations, 1);
  assert.equal(legacyBuilds, 0);
  const legacy = await h.connect(0);
  deliveries = [...modern, legacy].map(events => once(events, 'probe', { signal: AbortSignal.timeout(3000) }));
  h.server.broadcastWebsocket(payload, fallback);
  const results = await Promise.all(deliveries);
  assert.equal(serializations, 2, 'Only one additional serialization for both modern clients');
  assert.equal(legacyBuilds, 1);
  assert.equal(results[0][0].partial, true);
  assert.equal(results[1][0].partial, true);
  assert.equal(results[2][0].full, true);
});

test('live production refresh uses the compact message and supplies a lazy legacy fallback', async () => {
  let delivery;
  const server = { cache: {}, minuteTotalsSync: {
    productionInputs: { documents: [], tickers: [], shifts: [], currentSessions: [] },
    overlay: documents => ({ documents, status: { connected: true, stale: false } }),
  }, broadcastWebsocket: (...args) => { delivery = args; } };
  await refreshProductionStatsCache(server, { liveOnly: true, now: new Date('2026-11-04T22:00:00Z') });
  assert.equal(delivery[0].partial, true);
  assert.equal(delivery[0].scope, 'production');
  assert.deepEqual(Object.keys(delivery[0].cache.dashboard), ['production']);
  assert.equal(delivery[1]().partial, undefined);
  assert.equal(delivery[1]().dashboard, server.cache.dashboard);
});
