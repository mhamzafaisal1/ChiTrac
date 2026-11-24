const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectCascadeEvents,
  deriveCascadeStatus,
  buildDatafeedStatusMessage,
  readCascadeDatafeedConfig,
  createDatafeedForwarder
} = require('../modules/cascadeEvents');
const { createCascadeStatusStore, CURRENT_COLLECTION, EVENT_COLLECTION } = require('../modules/cascadeMqtt');

const quiet = { info() {}, warn() {}, error() {} };
const off = { readyToStart: false, paused: false, running: false, lowAir: false };
const sig = o => ({ ...off, ...o });

test('edges become named events', () => {
  assert.deepEqual(detectCascadeEvents(off, sig({ running: true })), ['start']);
  assert.deepEqual(detectCascadeEvents(sig({ running: true }), off), ['stop']);
  assert.deepEqual(detectCascadeEvents(off, sig({ paused: true })), ['pause']);
  assert.deepEqual(detectCascadeEvents(sig({ paused: true }), off), ['resume']);
  assert.deepEqual(detectCascadeEvents(off, sig({ lowAir: true })), [], 'low air is reported as a Cascade fault, not a plain event');
  assert.deepEqual(detectCascadeEvents(off, sig({ readyToStart: true })), ['ready']);
  assert.deepEqual(detectCascadeEvents(sig({ readyToStart: true }), off), ['notReady']);
  assert.deepEqual(detectCascadeEvents(off, off), []);
});

test('RTS 2 / RTS3 edges become events and do not affect status', () => {
  assert.deepEqual(detectCascadeEvents(sig({ rts2: false, rts3: false }), sig({ rts2: true, rts3: false })), ['rts2On']);
  assert.deepEqual(detectCascadeEvents(sig({ rts3: true }), sig({ rts3: false })), ['rts3Off']);
  assert.deepEqual(detectCascadeEvents(off, off), []); // absent optional bits ignored
  assert.deepEqual(deriveCascadeStatus(sig({ rts2: true, rts3: true })), { code: 0, name: 'Idle' });
});

test('first snapshot reports only the signals that are on', () => {
  assert.deepEqual(detectCascadeEvents(null, off), []);
  assert.deepEqual(detectCascadeEvents(null, sig({ readyToStart: true, running: true })).sort(), ['ready', 'start']);
});

test('non-fault status priority: running > paused > idle', () => {
  assert.deepEqual(deriveCascadeStatus(sig({ running: true, paused: true })), { code: 1, name: 'Run' });
  assert.deepEqual(deriveCascadeStatus(sig({ paused: true })), { code: 0, name: 'Paused' });
  assert.deepEqual(deriveCascadeStatus(sig({ readyToStart: true })), { code: 0, name: 'Idle' });
  assert.deepEqual(deriveCascadeStatus(off), { code: 0, name: 'Idle' });
});

test('datafeed message matches the datafeed-api status shape', () => {
  const msg = buildDatafeedStatusMessage({ serial: 90050, name: 'Cascade', timestamp: new Date('2026-11-19T14:00:00Z'), status: { code: 1, name: 'Run' } });
  assert.deepEqual(msg, {
    machineInfo: { serial: 90050, name: 'Cascade' },
    timestamp: '2026-11-19T14:00:00.000Z',
    status: { code: 1, name: 'Run' }
  });
});

test('Cascade sends the exact stopping alarm for each PLC bit', async () => {
  // [id, name, payload key, value that means faulted]
  const faults = [
    [2103, 'Low Air Fault', 'lowAir', true], [2106, 'Breaker Fault'],
    [2107, 'Autoload Fault'],
    [2110, 'LR Estop'], [2111, 'LF Estop'], [2112, 'RF Estop'], [2113, 'RR Estop'],
    [2114, 'Inverter Fault'], [2115, 'Doors Open'], [2204, 'No Material']
  ];
  const sent = [];
  const store = createCascadeStatusStore({
    db: fakeDb(), logger: quiet, forwarder: { send: message => sent.push(message) },
    machine: { serial: 90050, name: 'Cascade' }
  });
  const healthy = { M2106: false }; // M2106 is set only when the breaker input is off
  const submit = bits => store.handleMessage('t', JSON.stringify({
    source: 'bench', ...sig({ running: true, ...healthy, ...bits })
  }));
  await submit({});
  assert.equal(sent.at(-1).alarm, undefined, 'healthy bench is not faulted');
  for (const [id, name, key = `M${id}`, faultedValue = true] of faults) {
    const alarm = { id, name, fault: true, stop: true };
    const on = await submit({ [key]: faultedValue });
    assert.deepEqual(on.events, [`Fault: ${name}`]);
    assert.deepEqual(sent.at(-1).alarm, alarm);
    assert.deepEqual(sent.at(-1).status, { code: id, name });
    const cleared = await submit({ [key]: !faultedValue });
    assert.deepEqual(cleared.events, [`Fault cleared: ${name}`]);
    assert.deepEqual(sent.at(-1).status, { code: 1, name: 'Run' });
    assert.equal(sent.at(-1).alarm, undefined);
  }
});

test('newest fault wins, survives restart, and falls back to the newest remaining fault', async () => {
  const db = fakeDb();
  const sent = [];
  const collection = db.collection;
  let persisted;
  db.collection = name => name === CURRENT_COLLECTION ? {
    ...collection(name),
    findOne: async () => persisted,
    updateOne: async (_, update) => { persisted = { ...persisted, ...structuredClone(update.$set) }; }
  } : collection(name);
  const makeStore = () => createCascadeStatusStore({
    db, logger: quiet, forwarder: { send: message => sent.push(message) },
    machine: { serial: 90050, name: 'Cascade' }
  });
  let store = makeStore();
  const submit = bits => store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ running: true, M2106: false, ...bits }) }));
  await submit({ M2110: true, M2111: true });
  assert.equal(sent.at(-1).alarm.id, 2111, 'later address wins a same-snapshot tie');
  await submit({ M2110: true, M2111: true, M2106: true }); // breaker fault
  assert.equal(sent.at(-1).alarm.id, 2106, 'most recent activation overrides both earlier faults');
  assert.deepEqual(persisted.activeFaults.map(fault => fault.id), [2110, 2111, 2106]);
  assert.deepEqual(db.writes[EVENT_COLLECTION][0].faultChanges.map(fault => fault.id), [2110, 2111]);

  store = makeStore();
  await submit({ M2106: true, M2110: true, M2111: true });
  assert.equal(sent.at(-1).alarm.id, 2106);
  assert.equal(db.writes[EVENT_COLLECTION].length, 2, 'restart does not log new activations');
  await submit({ M2106: false, M2110: true, M2111: true }); // breaker restored
  assert.equal(sent.at(-1).alarm.id, 2111);
  await submit({ M2110: true, M2111: false });
  assert.equal(sent.at(-1).alarm.id, 2110);
  await submit({ M2110: false, M2111: false });
  assert.deepEqual(sent.at(-1).status, { code: 1, name: 'Run' });
  assert.equal(sent.at(-1).alarm, undefined);
});

test('older payloads without the fault bits never report breaker or other faults', async () => {
  const sent = [];
  const store = createCascadeStatusStore({
    db: fakeDb(), logger: quiet, forwarder: { send: message => sent.push(message) },
    machine: { serial: 90050, name: 'Cascade' }
  });
  // Older payloads without the fault bits must not report faults.
  const r = await store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ running: true }) }));
  assert.deepEqual(r.status, { code: 1, name: 'Run' });
  assert.equal(sent.at(-1).alarm, undefined);
  const low = await store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ running: true, lowAir: true }) }));
  assert.deepEqual(low.status, { code: 2103, name: 'Low Air Fault' });
});

test('alarm objects carry only datafeed schema fields', () => {
  const { CASCADE_FAULTS } = require('../modules/cascadeEvents');
  for (const alarm of CASCADE_FAULTS) assert.deepEqual(Object.keys(alarm).sort(), ['fault', 'id', 'name', 'stop']);
});

test('datafeed config is off without a URL and defaults to serial 90050', () => {
  const cfg = readCascadeDatafeedConfig({});
  assert.equal(cfg.url, '');
  assert.equal(cfg.serial, 90050);
  assert.equal(cfg.name, 'Cascade');
  assert.equal(readCascadeDatafeedConfig({ CASCADE_MACHINE_SERIAL: '12' }).serial, 12);
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = responses.length ? responses.shift() : { ok: true, status: 200 };
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, text: async () => r.text || '' };
  };
  fn.calls = calls;
  return fn;
}
const tick = () => new Promise(r => setImmediate(r));

test('forwarder posts in order', async () => {
  const fetchImpl = fakeFetch([]);
  const f = createDatafeedForwarder({ url: 'http://df/datafeed/post', fetchImpl, logger: quiet });
  f.send({ n: 1 }); f.send({ n: 2 });
  await tick(); await tick(); await tick();
  assert.deepEqual(fetchImpl.calls.map(c => c.body.n), [1, 2]);
  assert.equal(fetchImpl.calls[0].url, 'http://df/datafeed/post');
  assert.equal(f.pending(), 0);
});

test('forwarder retries network/5xx failures without losing order', async () => {
  const fetchImpl = fakeFetch([new Error('ECONNREFUSED'), { ok: false, status: 503 }]);
  const timers = [];
  const f = createDatafeedForwarder({ url: 'u', fetchImpl, logger: quiet, setTimer: (fn) => { timers.push(fn); return 1; } });
  f.send({ n: 1 }); f.send({ n: 2 });
  await tick();
  assert.equal(f.pending(), 2);
  timers.shift()(); await tick(); await tick();
  assert.equal(f.pending(), 2);           // 503, still queued
  timers.shift()(); await tick(); await tick(); await tick();
  assert.equal(f.pending(), 0);
  assert.deepEqual(fetchImpl.calls.map(c => c.body.n), [1, 1, 1, 2]);
});

test('forwarder drops 4xx rejections instead of retrying forever', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 400, text: 'Invalid datafeed event' }]);
  const errors = [];
  const f = createDatafeedForwarder({ url: 'u', fetchImpl, logger: { ...quiet, error: m => errors.push(m) } });
  f.send({ status: { code: 1 } }); f.send({ status: { code: 0 } });
  await tick(); await tick(); await tick();
  assert.equal(f.pending(), 0);
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(errors[0], /400/);
});

test('forwarder caps the queue', async () => {
  const f = createDatafeedForwarder({ url: 'u', maxQueue: 2, fetchImpl: async () => { throw new Error('down'); }, logger: quiet, setTimer: () => 1 });
  f.send(1); await tick(); f.send(2); f.send(3);
  assert.equal(f.pending(), 2);
});

function fakeDb() {
  const writes = { [CURRENT_COLLECTION]: [], [EVENT_COLLECTION]: [] };
  return {
    writes,
    collection: name => ({
      createIndex: async () => {},
      findOne: async () => null,
      insertOne: async doc => writes[name].push(doc),
      updateOne: async () => {}
    })
  };
}

test('store logs signal changes and forwards derived status changes', async () => {
  const sent = [];
  const db = fakeDb();
  let t = Date.parse('2026-11-19T14:00:00Z');
  const store = createCascadeStatusStore({
    db, logger: quiet, now: () => new Date(t += 1000),
    forwarder: { send: m => sent.push(m) }, machine: { serial: 90050, name: 'Cascade' }
  });
  const msg = o => Buffer.from(JSON.stringify({ source: 'cascade-bench', ...off, ...o }));

  await store.handleMessage('t', msg({}));                       // first: Idle
  await store.handleMessage('t', msg({ readyToStart: true }));   // ready, still Idle -> no send
  await store.handleMessage('t', msg({ readyToStart: true, running: true })); // start -> Run
  await store.handleMessage('t', msg({ readyToStart: true, running: true, lowAir: true })); // fault -> 2103
  await store.handleMessage('t', msg({ readyToStart: true, running: true })); // cleared -> Run

  const events = db.writes[EVENT_COLLECTION];
  assert.deepEqual(events.map(e => e.events), [[], ['ready'], ['start'], ['Fault: Low Air Fault'], ['Fault cleared: Low Air Fault']]);
  assert.deepEqual(events.map(e => e.status.code), [0, 0, 1, 2103, 1]);
  assert.deepEqual(sent.map(m => m.status.code), [0, 1, 2103, 1]);
  assert.equal(sent[0].machineInfo.serial, 90050);
});

test('store without a forwarder never sends', async () => {
  const db = fakeDb();
  const store = createCascadeStatusStore({ db, logger: quiet });
  const r = await store.handleMessage('t', Buffer.from(JSON.stringify({ source: 's', ...off, running: true })));
  assert.equal(r.status.code, 1);
  assert.deepEqual(r.events, ['start']);
});



test('fresh unchanged PLC messages heartbeat the datafeed without duplicate change events', async () => {
  const db = fakeDb(), sent = [];
  let at = Date.parse('2026-11-19T14:00:00Z');
  const store = createCascadeStatusStore({ db, logger: quiet, now: () => new Date(at),
    heartbeatMs: 10000, datafeedHeartbeatMs: 5000,
    forwarder: { send: message => sent.push(message) }, machine: { serial: 90050, name: 'Cascade Bench' } });
  for (let second = 0; second <= 15; second++) {
    at = Date.parse('2026-11-19T14:00:00Z') + second * 1000;
    await store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ running: true }) }));
  }
  assert.equal(sent.length, 4);
  assert.equal(db.writes[EVENT_COLLECTION].length, 1);
  assert.ok(sent.every(message => message.status.code === 1));
  assert.equal(sent[3].timestamp, '2026-11-19T14:00:15.000Z');
});

test('restart initializes the datafeed from a fresh unchanged snapshot without a fake change', async () => {
  const db = fakeDb(), sent = [];
  const collection = db.collection;
  db.collection = name => ({ ...collection(name), findOne: async () => ({ signals: sig({ running: true }), status: { code: 1, name: 'Run' } }) });
  const store = createCascadeStatusStore({ db, logger: quiet,
    forwarder: { send: message => sent.push(message) }, machine: { serial: 90050, name: 'Cascade Bench' } });
  await store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ running: true }) }));
  assert.equal(db.writes[EVENT_COLLECTION].length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status.code, 1);
});

test('restart compares changed signals with stored state rather than assuming all signals were off', async () => {
  const db = fakeDb(), collection = db.collection;
  db.collection = name => ({ ...collection(name), findOne: async () => ({ signals: sig({ running: true }), status: { code: 1, name: 'Run' } }) });
  const store = createCascadeStatusStore({ db, logger: quiet });
  const result = await store.handleMessage('t', JSON.stringify({ source: 'bench', ...sig({ paused: true }) }));
  assert.equal(result.action, 'changed');
  assert.deepEqual(result.events, ['stop', 'pause']);
  assert.equal(result.status.code, 0);
});

test('overflow preserves the in-flight message and never removes the wrong acknowledgement', async () => {
  let release;
  const calls = [];
  const f = createDatafeedForwarder({ url: 'u', maxQueue: 3, logger: quiet, fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body.n);
    if (body.n === 1) await new Promise(resolve => { release = resolve; });
    return { ok: true };
  } });
  f.send({ n: 1 }); f.send({ n: 2 }); f.send({ n: 3 }); f.send({ n: 4 });
  assert.equal(f.pending(), 3);
  release(); await tick(); await tick();
  assert.deepEqual(calls, [1, 3, 4]);
  assert.equal(f.pending(), 0);
  f.stop();
});

test('queued messages retain their original payload after the producer changes it', async () => {
  let release;
  const calls = [];
  const f = createDatafeedForwarder({ url: 'u', logger: quiet, fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return { ok: true };
  } });
  f.send({ status: { code: 1 } });
  const next = { status: { code: 0 } }; f.send(next); next.status.code = 19;
  release(); await tick(); await tick();
  assert.deepEqual(calls.map(body => body.status.code), [1, 0]);
  f.stop();
});

test('an unresponsive datafeed request times out and schedules a retry', async () => {
  const timers = [];
  const f = createDatafeedForwarder({ url: 'u', logger: quiet, requestTimeoutMs: 10,
    setTimer: fn => { timers.push(fn); return 1; }, clearTimer() {},
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  f.send({ status: { code: 1 } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.pending(), 1);
  assert.equal(timers.length, 1);
  f.stop();
});

test('stopping aborts an in-flight request without scheduling another retry', async () => {
  let signal;
  const timers = [];
  const f = createDatafeedForwarder({ url: 'u', logger: quiet, setTimer: fn => { timers.push(fn); return 1; },
    fetchImpl: (_url, init) => { signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))); } });
  f.send({ status: { code: 1 } }); f.stop(); await tick();
  assert.equal(signal.aborted, true);
  assert.equal(timers.length, 0);
});

test('HTTP 408 and 429 keep their place for retry', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 408 }, { ok: false, status: 429 }]);
  const timers = [];
  const f = createDatafeedForwarder({ url: 'u', fetchImpl, logger: quiet, setTimer: fn => { timers.push(fn); return 1; } });
  f.send({ n: 1 }); await tick(); timers.shift()(); await tick(); timers.shift()(); await tick();
  assert.deepEqual(fetchImpl.calls.map(call => call.body.n), [1, 1, 1]);
  assert.equal(f.pending(), 0); f.stop();
});

test('datafeed configuration rejects partial serials and invalid queue or timing settings', () => {
  for (const value of ['90050x', '-1', '0', '1.5']) assert.throws(() => readCascadeDatafeedConfig({ CASCADE_MACHINE_SERIAL: value }), /positive integer/);
  for (const key of ['CASCADE_DATAFEED_RETRY_MS', 'CASCADE_DATAFEED_MAX_QUEUE', 'CASCADE_DATAFEED_HEARTBEAT_MS', 'CASCADE_DATAFEED_TIMEOUT_MS']) {
    assert.throws(() => readCascadeDatafeedConfig({ [key]: '0.5' }), /positive integer/);
  }
  assert.throws(() => readCascadeDatafeedConfig({ CASCADE_DATAFEED_URL: 'file:///tmp/datafeed' }), /HTTP/);
});

test('standalone dry-run can process the first snapshot without a database or real POST', async t => {
  const { dryRunDb } = require('../scripts/cascade-mqtt-subscriber');
  const logged = [];
  t.mock.method(console, 'log', (...args) => logged.push(args));
  const store = createCascadeStatusStore({ db: dryRunDb(), logger: quiet });
  assert.equal((await store.handleMessage('t', JSON.stringify({ source: 'bench', ...off }))).action, 'first');
  assert.equal(logged.length, 2);
});
