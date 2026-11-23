const test = require('node:test');
const assert = require('node:assert/strict');
const spindle = require('../controllers/spindle');
const milnor = require('../controllers/milnor');
const config = require('../modules/config');
const { Settings } = require('luxon');
const { sessionShiftFilter } = require('../utils/reportShiftFilter');

async function analyticsRequest(router, path, query = {}) {
  const handler = router.stack.find(layer => layer.route.path === path).route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ query }, res);
  return res;
}

test('Milnor and Spindle cached overviews keep independent databases and select the latest ticker', async t => {
  const originalNow = Settings.now;
  Settings.now = () => Date.parse('2026-11-17T18:00:00Z');
  t.after(() => { Settings.now = originalNow; });
  const machine = { id: 90003, serial: 90003, name: 'Test machine' };
  const operator = { id: 42, name: 'Test operator' };
  function create(controller, count) {
    return controller({ logger: console, db: { collection(name) {
      return { find(query) {
        let rows;
        if (name === config.machineCollectionName) rows = [machine];
        else if (name === config.operatorCollectionName) rows = [operator];
        else if (name === config.shiftCollectionName) rows = [];
        else if (name === config.stateTickerCollectionName) rows = [
          { machine, operators: [operator], status: { code: 1, name: 'Running' }, timestamps: { update: new Date('2026-11-17T17:00:00Z') } },
          { machine, operators: [operator], status: { code: 2, name: 'Stopped' }, timestamps: { update: new Date('2026-11-17T16:00:00Z') } },
        ];
        else {
          assert.equal(name, config.totalsDailyCollectionName);
          assert.equal(query.date, '2026-11-16');
          rows = [{ machineSerial: machine.serial, operatorId: operator.id, runtimeMs: 3600000,
            workedTimeMs: 3600000, totalCounts: count, totalMisfeeds: 2, totalTimeCreditMs: 1800000 }];
        }
        return { project() { return this; }, toArray: async () => rows };
      } };
    } } });
  }
  const routers = [[create(milnor, 10), 10], [create(spindle, 20), 20]];
  for (const path of ['/machine/overview', '/operator/overview']) {
    for (const [router, count] of routers) {
      const response = await analyticsRequest(router, path, { timeframe: 'custom', start: '2026-11-16', end: '2026-11-17' });
      assert.equal(response.code, 200);
      assert.equal(response.body.length, 1);
      assert.equal(response.body[0].metrics.output.totalCount, count);
      assert.equal(response.body[0].metrics.runtime.total, 3600000);
      assert.equal(response.body[0].currentStatus.code, 1);
    }
  }
});

test('both vendor adapters preserve validation and vendor-specific failure responses', async () => {
  for (const [controller, vendor] of [[milnor, 'Milnor'], [spindle, 'Spindle']]) {
    const router = controller({ db: { collection() { throw new Error('Database unavailable'); } }, logger: { error() {} } });
    assert.deepEqual((await analyticsRequest(router, '/status')).body, { vendor, status: 'ok' });
    for (const path of ['/machine/overview', '/machine/details', '/operator/overview', '/operator/details']) {
      assert.equal((await analyticsRequest(router, path, { timeframe: 'invalid' })).code, 400);
      const response = await analyticsRequest(router, path);
      assert.equal(response.code, 500);
      assert.equal(response.body.error, `Failed to fetch ${vendor} ${path.slice(1).replace('/', ' ')}`);
    }
  }
});

function fixture(shift = null, entity = 'machine') {
  const queries = [];
  const rows = [{ _id: 'session-id', machine: { id: 90003 }, counts: [{ unexpectedField: true }], states: [{ code: 1 }] }];
  const db = { collection(name) {
    if (name === config.shiftCollectionName) return { findOne: async ({ id }) => shift?.id === id ? shift : null };
    assert.equal(name, entity === 'operator' ? config.operatorSessionCollectionName : config.machineSessionCollectionName);
    return { find(query) {
      queries.push(query);
      return { sort(order) {
        assert.deepEqual(order, { 'timestamps.start': 1, _id: 1 });
        return { toArray: async () => rows };
      } };
    } };
  } };
  const router = spindle({ db, logger: console });
  const handle = router.stack.find(layer => layer.route.path === `/${entity}/sessions`).route.stack[0].handle;
  async function request(query) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handle({ query }, res);
    return res;
  }
  return { request, queries, rows };
}

test('raw operator sessions support independent operator and machine filters and reject oversized exports', async () => {
  const { request, queries, rows } = fixture(null, 'operator');
  rows[0].operator = { id: 183462 };
  for (const filters of [{}, { operatorid: '183462' }, { serial: '90003' }, { operatorid: '183462', serial: '90003' }]) {
    const res = await request(filters);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, rows);
    const identities = queries.at(-1).$and.slice(2).map(q => q.$and[0].$or);
    const expected = [];
    if (filters.serial) expected.push([{ 'machine.id': 90003 }, { 'machine.id': null, 'machine.serial': 90003 }]);
    if (filters.operatorid) expected.push([{ 'operator.id': 183462 }, { 'operator.id': null, 'operator.code': 183462 }]);
    assert.deepEqual(identities, expected);
  }
  assert.equal((await request({ operatorid: 'invalid' })).code, 400);
  const oversized = await request({ timeframe: 'custom', start: '2026-01-01', end: '2026-01-09' });
  assert.equal(oversized.code, 400);
  assert.match(oversized.body.error, /7 days/);
  assert.equal(queries.length, 4);
});

test('raw sessions use a single overlap query across days and preserve the stored records', async () => {
  const { request, queries, rows } = fixture();
  const start = '2026-01-05T13:15:00Z', end = '2026-01-08T14:00:00Z';
  const res = await request({ timeframe: 'custom', start, end });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, rows);
  assert.deepEqual(queries, [{ $and: [
    { 'timestamps.start': { $lt: new Date(end) } },
    { $or: [{ 'timestamps.end': null }, { 'timestamps.end': { $gt: new Date(start) } }] },
  ] }]);
  await request({ serial: '90003', shift: '999' });
  assert.deepEqual(queries[1].$and[2].$and[0].$or, [
    { 'machine.id': 90003 }, { 'machine.id': null, 'machine.serial': 90003 },
  ]);
});

test('raw session requests reject invalid inputs before querying session history', async () => {
  const { request, queries } = fixture();
  for (const query of [{ serial: '1x' }, { timeframe: 'week' }, { timeframe: 'shift' },
    { timeframe: 'custom' }, { timeframe: 'custom', start: '2026-01-02', end: '2026-01-01' }]) {
    assert.equal((await request(query)).code, 400);
  }
  assert.equal((await request({ timeframe: 'shift', shift: '999' })).code, 404);
  assert.equal(queries.length, 0);
});

test('accepts a full plant week across DST and rejects longer requests before reading sessions', async t => {
  const originalNow = Settings.now;
  Settings.now = () => Date.parse('2026-11-04T18:00:00Z');
  t.after(() => { Settings.now = originalNow; });
  const { request, queries } = fixture();
  const custom = { timeframe: 'custom', start: '2026-10-27T08:00' };
  assert.equal((await request({ ...custom, end: '2026-11-03T08:00' })).code, 200);
  for (const query of [{ ...custom, end: '2026-11-03T08:00:00.001' }, custom]) {
    const res = await request(query);
    assert.equal(res.code, 400);
    assert.match(res.body.error, /limited to 7 days/);
  }
  assert.equal(queries.length, 1);
  assert.equal((await request({ ...custom, start: '2026-11-03T08:00', end: '2026-12-01T08:00' })).code, 200);
  assert.equal(+queries[1].$and[0]['timestamps.start'].$lt, Settings.now());
});

test('shift requests include untagged sessions only within the selected time window', async t => {
  const originalNow = Settings.now;
  Settings.now = () => Date.parse('2026-11-04T18:00:00Z');
  t.after(() => { Settings.now = originalNow; });
  const shift = { _id: 'morning', id: 1, timestamps: {
    start: new Date('2026-11-04T12:00:00Z'), end: new Date('2026-11-04T16:00:00Z'),
  } };
  const { request, queries } = fixture(shift);
  assert.equal((await request({ timeframe: 'shift', shift: '1' })).code, 200);
  assert.deepEqual(queries[0].$and, [
    { 'timestamps.start': { $lt: shift.timestamps.end } },
    { $or: [{ 'timestamps.end': null }, { 'timestamps.end': { $gt: shift.timestamps.start } }] },
    sessionShiftFilter(shift._id, { includeUntagged: true }),
  ]);
});
