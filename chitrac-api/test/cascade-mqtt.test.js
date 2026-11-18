const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CURRENT_COLLECTION,
  EVENT_COLLECTION,
  parseCascadeStatus,
  readCascadeMqttConfig,
  createCascadeStatusStore,
  isCascadeStatusStale,
  startCascadeMqttSubscriber
} = require('../modules/cascadeMqtt');

const quietLogger = { info() {}, warn() {}, error() {} };
const payload = (overrides = {}) => Buffer.from(JSON.stringify({
  source: 'cascade-bench', readyToStart: false, paused: false, running: false, lowAir: false, ...overrides
}));

function fakeDb(stored = {}) {
  const writes = { [CURRENT_COLLECTION]: [], [EVENT_COLLECTION]: [] };
  const collection = name => ({
    createIndex: async () => {},
    findOne: async () => stored[name] || null,
    insertOne: async doc => writes[name].push({ op: 'insert', doc }),
    updateOne: async (filter, update, options) => writes[name].push({ op: 'update', filter, set: update.$set, options })
  });
  return { writes, collection };
}

test('restart with unchanged signals does not log a new event', async () => {
  const signals = { readyToStart: false, paused: false, running: false, lowAir: false };
  const db = fakeDb({ [CURRENT_COLLECTION]: { source: 'cascade-bench', signals } });
  const store = createCascadeStatusStore({ db, logger: quietLogger, now: clock().now });
  assert.equal((await store.handleMessage('t', payload())).action, 'heartbeat');
  assert.equal(db.writes[EVENT_COLLECTION].length, 0);
  assert.equal((await store.handleMessage('t', payload({ running: true }))).action, 'changed');
  assert.equal(db.writes[EVENT_COLLECTION][0].doc.previous.running, false);
});

function clock(start = Date.parse('2026-11-18T21:00:00Z')) {
  let t = start;
  return { now: () => new Date(t), advance: ms => { t += ms; } };
}

test('parses the exact payload the PLC publishes', () => {
  const real = '{"source":"cascade-bench","readyToStart":false,"paused":false,"running":false,"lowAir":false}';
  assert.deepEqual(parseCascadeStatus(Buffer.from(real)), {
    ok: true,
    value: { source: 'cascade-bench', signals: { readyToStart: false, paused: false, running: false, lowAir: false } }
  });
});

test('rejects malformed payloads', () => {
  assert.equal(parseCascadeStatus('not json').ok, false);
  assert.equal(parseCascadeStatus('[]').ok, false);
  assert.equal(parseCascadeStatus(JSON.stringify({ readyToStart: false })).ok, false);
  assert.match(parseCascadeStatus(payload({ running: 'false' })).error, /running must be boolean/);
});

test('first message stores current state and one event', async () => {
  const db = fakeDb();
  const store = createCascadeStatusStore({ db, logger: quietLogger, now: clock().now });
  assert.equal((await store.handleMessage('t', payload())).action, 'first');
  assert.equal(db.writes[EVENT_COLLECTION].length, 1);
  assert.equal(db.writes[EVENT_COLLECTION][0].doc.previous, null);
  assert.equal(db.writes[CURRENT_COLLECTION][0].options.upsert, true);
});

test('repeated identical messages do not write until the heartbeat interval', async () => {
  const db = fakeDb();
  const c = clock();
  const store = createCascadeStatusStore({ db, logger: quietLogger, now: c.now, heartbeatMs: 10000 });
  await store.handleMessage('t', payload());
  for (let i = 0; i < 9; i++) {
    c.advance(1000);
    assert.equal((await store.handleMessage('t', payload())).action, 'unchanged');
  }
  c.advance(1000);
  assert.equal((await store.handleMessage('t', payload())).action, 'heartbeat');
  assert.equal(db.writes[EVENT_COLLECTION].length, 1);
  assert.deepEqual(Object.keys(db.writes[CURRENT_COLLECTION][1].set).sort(), ['lastSeenAt', 'topic']);
});

test('a signal change logs an event with the previous signals', async () => {
  const db = fakeDb();
  const c = clock();
  const store = createCascadeStatusStore({ db, logger: quietLogger, now: c.now });
  await store.handleMessage('t', payload());
  c.advance(1000);
  assert.equal((await store.handleMessage('t', payload({ running: true }))).action, 'changed');
  const event = db.writes[EVENT_COLLECTION][1].doc;
  assert.equal(event.signals.running, true);
  assert.equal(event.previous.running, false);
});

test('invalid messages are ignored without writes', async () => {
  const db = fakeDb();
  const store = createCascadeStatusStore({ db, logger: quietLogger });
  assert.equal((await store.handleMessage('t', 'garbage')).action, 'ignored');
  assert.equal(db.writes[EVENT_COLLECTION].length + db.writes[CURRENT_COLLECTION].length, 0);
});

test('staleness check', () => {
  const now = new Date('2026-11-18T21:01:00Z');
  assert.equal(isCascadeStatusStale({ lastSeenAt: new Date('2026-11-18T21:00:50Z') }, now, 30000), false);
  assert.equal(isCascadeStatusStale({ lastSeenAt: new Date('2026-11-18T21:00:00Z') }, now, 30000), true);
  assert.equal(isCascadeStatusStale(null, now), true);
});

test('config reads env with defaults', () => {
  const cfg = readCascadeMqttConfig({ CASCADE_MQTT_URL: ' mqtt://192.168.70.186:1883 ', CASCADE_MQTT_USERNAME: 'cascade-plc' });
  assert.equal(cfg.url, 'mqtt://192.168.70.186:1883');
  assert.equal(cfg.topic, 'chitrac/cascade/bench/status');
  assert.equal(cfg.username, 'cascade-plc');
  assert.equal(cfg.password, undefined);
});

test('subscriber connects with credentials, subscribes on connect and stores messages', async () => {
  const client = new EventEmitter();
  let connectArgs;
  const subscriptions = [];
  client.subscribe = (topic, options, cb) => { subscriptions.push(topic); cb && cb(null); };
  client.end = (force, opts, cb) => cb();
  const db = fakeDb();
  const sub = startCascadeMqttSubscriber({
    db,
    logger: quietLogger,
    config: readCascadeMqttConfig({ CASCADE_MQTT_URL: 'mqtt://pi:1883', CASCADE_MQTT_USERNAME: 'u', CASCADE_MQTT_PASSWORD: 'p' }),
    mqttConnect: (url, options) => { connectArgs = { url, options }; return client; }
  });
  assert.equal(connectArgs.url, 'mqtt://pi:1883');
  assert.equal(connectArgs.options.username, 'u');
  assert.equal(connectArgs.options.password, 'p');
  assert.equal(connectArgs.options.reconnectPeriod, 5000);
  client.emit('connect');
  assert.deepEqual(subscriptions, ['chitrac/cascade/bench/status']);
  client.emit('message', 'chitrac/cascade/bench/status', payload());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(db.writes[EVENT_COLLECTION].length, 1);
  await sub.stop();
});

test('messages arriving together are processed in order without duplicate events', async () => {
  const db = fakeDb();
  const store = createCascadeStatusStore({ db, logger: quietLogger, now: clock().now });
  const results = await Promise.all([
    store.handleMessage('t', payload()),
    store.handleMessage('t', payload()),
    store.handleMessage('t', payload({ running: true }))
  ]);
  assert.deepEqual(results.map(r => r.action), ['first', 'unchanged', 'changed']);
  assert.equal(db.writes[EVENT_COLLECTION].length, 2);
});

test('GET /api/cascade/status and /events return stored state with stale flag', async () => {
  const express = require('express');
  const lastSeen = new Date('2026-11-18T21:00:00Z');
  const docs = {
    [CURRENT_COLLECTION]: [{ source: 'cascade-bench', signals: { readyToStart: false, paused: false, running: true, lowAir: false }, lastSeenAt: lastSeen }],
    [EVENT_COLLECTION]: [{ source: 'cascade-bench', timestamp: lastSeen }]
  };
  let limitUsed;
  const db = { collection: name => ({ find: () => ({ sort: () => ({
    toArray: async () => docs[name],
    limit: n => { limitUsed = n; return { toArray: async () => docs[name] }; }
  }) }) }) };
  const server = { db, logger: quietLogger };
  const app = express();
  app.use('/api/cascade', require('../controllers/cascade')(server, {
    now: () => new Date('2026-11-18T21:00:10Z'),
    env: { CASCADE_MQTT_URL: 'mqtt://pi:1883' }
  }));
  const http = app.listen(0);
  const base = `http://127.0.0.1:${http.address().port}/api/cascade`;
  try {
    const status = await (await fetch(`${base}/status`)).json();
    assert.equal(status.enabled, true);
    assert.equal(status.sources[0].signals.running, true);
    assert.equal(status.sources[0].stale, false);
    const events = await (await fetch(`${base}/events?limit=9999`)).json();
    assert.equal(events.events.length, 1);
    assert.equal(limitUsed, 500);
  } finally {
    http.close();
  }
});
