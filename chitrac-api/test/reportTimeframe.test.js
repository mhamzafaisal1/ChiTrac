const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { sessionShiftFilter, reportShiftMiddleware } = require('../utils/reportShiftFilter');

const shiftId = '507f1f77bcf86cd799439011';
const start = '2026-09-24T15:00:00.000Z';
const end = '2026-09-24T17:00:00.000Z';

function loadController(file, overrides) {
  const filename = path.resolve(__dirname, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: { log() {} },
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
  }, { filename });
  return module.exports;
}

function fixture() {
  const queries = [];
  const shift = { _id: new ObjectId(shiftId), active: true, startTime: { hour: 8, minute: 0 }, endTime: { hour: 16, minute: 0 } };
  const db = { collection: name => ({
    findOne: async () => shift,
    find: query => { queries.push({ name, query }); return { project() { return this; }, sort() { return this; }, toArray: async () => [] }; },
    aggregate: pipeline => { queries.push({ name, pipeline }); return { toArray: async () => [] }; },
  }) };
  return { db, queries };
}

async function invoke(router, routePath, query) {
  const route = router.stack.find(layer => layer.route?.path === routePath).route;
  const req = { query, method: 'GET', originalUrl: routePath };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  for (const layer of route.stack) {
    let next = false;
    await layer.handle(req, res, error => { if (error) throw error; next = true; });
    if (!next) break;
  }
  return res;
}

test('shift filters accept both stored string and ObjectId forms and leave all-data unfiltered', () => {
  assert.deepEqual(sessionShiftFilter(null), {});
  const values = sessionShiftFilter(shiftId)['shift._id'].$in;
  assert.equal(values[0], shiftId);
  assert.equal(values[1].toHexString(), shiftId);
});

test('shift middleware rejects malformed and nonexistent IDs', async () => {
  const middleware = reportShiftMiddleware({ collection: () => ({ findOne: async () => null }) });
  for (const [value, status] of [['bad', 400], [[shiftId], 400], [shiftId, 404]]) {
    const res = { status(code) { this.code = code; return this; }, json() {} };
    await middleware({ query: { shiftId: value } }, res, () => assert.fail('invalid selection continued'));
    assert.equal(res.code, status);
  }
});

test('operator, item and partial-day machine reports pass shift ID and exact range to session helpers', async () => {
  const { db } = fixture();
  const calls = [];
  const helpers = require('../utils/reportFunctions');
  const factory = loadController('../controllers/reports/index.js', {
    './reportSubscription': () => express.Router(),
    '../../utils/reportFunctions': {
      ...helpers,
      getOperatorSessionDataForPartialDays: async (...args) => { calls.push(['operator', ...args]); return { operators: [] }; },
      getSessionDataForPartialDays: async (...args) => { calls.push(['machine', ...args]); return { machines: [], machineItems: [] }; },
    },
  });
  const router = factory({ db, logger: { debug() {}, error() {} } });
  for (const routePath of ['/analytics/operator-item-sessions-summary-cache', '/analytics/item-sessions-summary-daily-cache', '/analytics/machine-report-cache']) {
    const before = calls.length;
    const response = await invoke(router, routePath, { start, end, shiftId });
    assert.equal(response.statusCode, 200);
    assert.ok(calls.length > before, routePath);
    for (const call of calls.slice(before)) {
      assert.equal(call[4].shiftId, shiftId);
      assert.equal(call[2][0].start.toISOString(), start);
      assert.equal(call[2][0].end.toISOString(), end);
    }
  }
});

test('fault summary and detailed reports apply persisted shift filter to their aggregation', async () => {
  const { db, queries } = fixture();
  const router = require('../controllers/fault')({ db, logger: { error() {} } });
  for (const routePath of ['/analytics/fault-report-summary', '/analytics/fault-report-detailed']) {
    const response = await invoke(router, routePath, { start, end, shiftId });
    assert.equal(response.statusCode, 200);
    const match = queries.at(-1).pipeline[0].$match;
    assert.equal(match['shift._id'].$in[0], shiftId);
  }
});

test('all-data fault report does not add a shift filter', async () => {
  const { db, queries } = fixture();
  const router = require('../controllers/fault')({ db, logger: { error() {} } });
  await invoke(router, '/analytics/fault-report-summary', { start, end });
  assert.equal(queries.at(-1).pipeline[0].$match['shift._id'], undefined);
});
