const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const spindle = require('../controllers/spindle');
const config = require('../modules/config');
const { Settings } = require('luxon');
const { isFaultSession } = require('../utils/faultTimeSummary');
const { sessionShiftFilter } = require('../utils/reportShiftFilter');

test('fault selection follows the effective starting state across session schemas', () => {
  assert.equal(isFaultSession({ states: { start: { status: { id: 12 } } }, type: 1 }), true);
  assert.equal(isFaultSession({ type: 8, startState: { status: { code: '1' } } }), false);
  assert.equal(isFaultSession({ status: { code: '0' } }), false);
  assert.equal(isFaultSession({}), false);
});

test('shift count requests validate operatorid and apply operator and shift filters together', async t => {
  const originalNow = Settings.now;
  Settings.now = () => Date.parse('2026-11-04T18:00:00Z');
  t.after(() => { Settings.now = originalNow; });
  const start = new Date('2026-11-04T12:00:00Z'), end = new Date('2026-11-04T16:00:00Z');
  let reads = 0;
  const db = { collection(name) {
    if (name === config.shiftCollectionName) return { findOne: async ({ id }) =>
      id === 2 ? { _id: 'second', timestamps: { start, end } } : null };
    assert.equal(name, config.countCollectionName);
    return { find(query) {
      reads++;
      const filters = query.$and;
      assert.deepEqual(filters[0]['timestamps.create'], { $gte: start, $lt: end });
      assert.deepEqual(filters[1].$and[0].$or, [{ 'operator.id': 42 }, { 'operator.id': null, 'operator.code': 42 }]);
      assert.deepEqual(filters[2], sessionShiftFilter('second', { includeUntagged: true }));
      return { sort() { return this; }, async *[Symbol.asyncIterator]() {}, async close() {} };
    } };
  } };
  const server = express().use(spindle({ db, logger: console })).listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/counts?timeframe=shift&shift=2&operatorid=`;
  assert.equal((await fetch(url + 'invalid')).status, 400);
  assert.deepEqual(await (await fetch(url + '42')).json(), []);
  assert.equal(reads, 1);
});

test('Spindle returns raw faults and streams count and state arrays over HTTP', async t => {
  const start = '2025-06-01T12:00:00Z', end = '2025-06-01T13:00:00Z';
  const range = { $gte: new Date(start), $lt: new Date(end) };
  const fault = { _id: 'fault', type: 2, arbitrary: [1, 2] };
  const counts = [{ _id: 'a', timestamps: { create: start } }, { _id: 'b', timestamps: { create: start }, misfeed: true, operator: { id: 123 } }];
  let closed = 0;
  const db = { collection(name) {
    if (name === config.machineSessionCollectionName) return { find(query) {
      assert.ok(query.$and.some(filter => filter.$or?.some(term => term.type)));
      return { sort: () => ({ toArray: async () => [fault, { type: 1 }, { type: 2, status: { code: 0 } }] }) };
    } };
    assert.ok([config.countCollectionName, config.machineStateCollectionName].includes(name));
    return { find(query) {
      const filters = query.$and;
      assert.deepEqual(filters[0], { 'timestamps.create': range });
      if (name === config.countCollectionName) assert.equal(filters[1].$and[0].$or[0]['operator.id'], 123);
      return { sort(order) { assert.deepEqual(order, { 'timestamps.create': 1, _id: 1 }); return this; },
        async *[Symbol.asyncIterator]() { if (name === config.countCollectionName) yield* counts; },
        async close() { closed++; } };
    } };
  } };
  const app = express();
  app.use('/api/spindle', spindle({ db, logger: console }));
  const server = app.listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const [path, expected, extra] of [
    ['fault/sessions', [fault], ''], ['states', [], ''], ['counts', counts, '&operatorid=123'],
  ]) {
    const url = `http://127.0.0.1:${server.address().port}/api/spindle/${path}?timeframe=custom&start=${start}&end=${end}${extra}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    const oversized = await fetch(url.replace(end, '2025-06-12T00:00:00Z'));
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /7 days/);
  }
  assert.equal(closed, 2);
});
