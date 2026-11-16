const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const createRoutes = require('../controllers/biko');

function message(status) {
  return {
    timestamp: '2026-08-18T18:41:11.108+00:00',
    machineInfo: { serial: 123, name: 'Versa' },
    programInfo: { id: 1 }, item: { id: 2 }, stack: { count: 3 },
    ...(status === undefined ? {} : { status })
  };
}

function responseBody(body) {
  return { receivedBody: { ...body, timestamp: new Date(body.timestamp).toISOString() } };
}

async function setup(t, { definition = null, lookupError, insertError } = {}) {
  const stored = [];
  const queries = [];
  const warnings = [];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/biko', createRoutes({
    logger: { warn: text => warnings.push(text) },
    db: { collection(name) {
      if (name === 'config-alarm-versa') return { findOne: async filter => {
        queries.push(filter);
        if (lookupError) throw lookupError;
        return definition;
      } };
      assert.equal(name, 'versa', 'must not read Chicago configuration or write other collections');
      return { insertOne: async document => {
        if (insertError) throw insertError;
        stored.push(structuredClone(document));
        return { acknowledged: true };
      } };
    } }
  }));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => listener.close());
  const url = `http://127.0.0.1:${listener.address().port}/api/biko/versa`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { stored, queries, warnings, post, url };
}

test('Versa alarms enrich nested status, including alarmCode zero and false stop', async t => {
  for (const stop of [true, false]) {
    await t.test(`stop=${stop}`, async t => {
      const definition = { id: 0, stop, name: 'Configured alarm', fault: stop, color: 'Red', _id: 'config-only' };
      const h = await setup(t, { definition });
      const body = message({ code: 0, alarmCode: 0, alarmValue: 0, name: 'Producer name', stop: !stop, extra: 'keep' });
      const response = await h.post(body);
      assert.equal(response.status, 200);
      const expected = { ...body, status: { ...body.status, stop, name: definition.name } };
      assert.deepEqual(await response.json(), responseBody(expected));
      assert.deepEqual(h.queries, [{ id: 0 }]);
      assert.deepEqual(h.stored, [{ ...expected, timestamp: new Date(body.timestamp) }]);
      assert.deepEqual(h.warnings, []);
    });
  }
});

test('integer string codes use numeric lookup while preserving the incoming code', async t => {
  const h = await setup(t, { definition: { id: 26, stop: false, name: 'Warning' } });
  const response = await h.post(message({ code: 0, alarmCode: '26', alarmValue: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.queries, [{ id: 26 }]);
  assert.equal(h.stored[0].status.alarmCode, '26');
  assert.equal(h.stored[0].status.name, 'Warning');
});

test('normal messages are stored without an alarm lookup or enrichment', async t => {
  const h = await setup(t);
  for (const status of [undefined, { code: 0 }, { code: 1 }, null]) {
    const body = message(status);
    // A top-level alarmCode is not the nested Versa alarm discriminator.
    body.alarmCode = 18;
    const response = await h.post(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), responseBody(body));
  }
  assert.equal(h.stored.length, 4);
  assert.deepEqual(h.queries, []);
});

test('unknown and omitted alarms retain the incoming status and produce a warning', async t => {
  const h = await setup(t);
  for (const id of [24, 68, 85, 999]) {
    const body = message({ code: 0, alarmCode: id, alarmValue: 0, name: 'Original name' });
    const response = await h.post(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), responseBody(body));
    assert.deepEqual(h.stored.at(-1).status, body.status);
    assert.match(h.warnings.at(-1), new RegExp(`alarmCode ${id};`));
  }
  assert.equal(h.warnings.length, 4);
});

test('malformed codes are stored unchanged with a warning and no configuration lookup', async t => {
  const h = await setup(t);
  const malformed = [null, '', ' ', true, false, -1, 1.5, '1.5', '12a', 'abc', [], {}, Number.MAX_SAFE_INTEGER + 1];
  for (const alarmCode of malformed) {
    const body = message({ alarmCode, alarmValue: 0, name: 'Original name', stop: false });
    const response = await h.post(body);
    assert.equal(response.status, 200, `retain alarmCode ${JSON.stringify(alarmCode)}`);
    assert.deepEqual(await response.json(), responseBody(body));
    assert.deepEqual(h.stored.at(-1), { ...body, timestamp: new Date(body.timestamp) });
    assert.match(h.warnings.at(-1), /Invalid Versa status.alarmCode/);
  }
  assert.deepEqual(h.queries, []);
  assert.equal(h.stored.length, malformed.length);
  assert.equal(h.warnings.length, malformed.length);
});

test('invalid definitions preserve the message without partial enrichment and warn', async t => {
  for (const definition of [{ stop: 'false', name: 'Invalid' }, { stop: false, name: '' },
    { name: 'Missing stop' }, { stop: true }, { stop: true, name: '   ' }]) {
    await t.test(JSON.stringify(definition), async t => {
      const h = await setup(t, { definition });
      const body = message({ alarmCode: 18, alarmValue: 0, name: 'Producer name', stop: false });
      const response = await h.post(body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), responseBody(body));
      assert.deepEqual(h.stored, [{ ...body, timestamp: new Date(body.timestamp) }]);
      assert.deepEqual(h.queries, [{ id: 18 }]);
      assert.equal(h.warnings.length, 1);
      assert.match(h.warnings[0], /Invalid config-alarm-versa definition for alarmCode 18/);
    });
  }
});

test('lookup and insertion failures reach error middleware without reporting success', async t => {
  for (const options of [{ lookupError: new Error('Lookup unavailable') }, { insertError: new Error('Insert unavailable') }]) {
    await t.test(Object.keys(options)[0], async t => {
      const h = await setup(t, options);
      const response = await h.post(message({ alarmCode: 18 }));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /unavailable/);
      assert.deepEqual(h.stored, []);
    });
  }
});

test('URL-encoded messages retain the existing unwrapped response format', async t => {
  const h = await setup(t, { definition: { id: 0, stop: true, name: 'Emergency stop' } });
  const response = await fetch(h.url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'status[code]=0&status[alarmCode]=0&status[alarmValue]=1'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: { code: '0', alarmCode: '0', alarmValue: '1', stop: true, name: 'Emergency stop' } });
});
