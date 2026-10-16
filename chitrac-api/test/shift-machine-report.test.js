const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { wrapDatabase } = require('../modules/totalsCollectionAdapter');
const { sessionShiftFilter } = require('../utils/reportShiftFilter');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const morningId = new ObjectId('600000000000000000000001');
const afternoonId = new ObjectId('600000000000000000000002');
const instant = (day, time) => new Date(`2026-01-${day}T${time}:00-06:00`);
const shifts = [
  { _id: morningId, name: 'Morning', active: true, activeDays: [1, 2, 3, 4, 5, 6, 7],
    timestamps: { start: instant('06', '06:00'), end: instant('06', '12:00') } },
  { _id: afternoonId, name: 'Afternoon', active: true, activeDays: [1, 2, 3, 4, 5, 6, 7],
    timestamps: { start: instant('06', '12:00'), end: instant('06', '18:00') } }
];
const get = (record, path) => path.split('.').reduce((value, key) => value?.[key], record);
const equal = (a, b) => a instanceof ObjectId || b instanceof ObjectId
  ? a?.constructor === b?.constructor && String(a) === String(b)
  : a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(record, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$and' || key === '$or') {
      assert.ok(value.length, 'MongoDB rejects empty logical arrays');
      return key === '$and' ? value.every(q => matches(record, q)) : value.some(q => matches(record, q));
    }
    const actual = get(record, key);
    if (!value || typeof value !== 'object' || value instanceof Date || value instanceof ObjectId) return equal(actual, value);
    return Object.entries(value).every(([operator, expected]) => {
      if (operator === '$in') return expected.some(candidate => candidate === null ? actual == null : equal(actual, candidate));
      if (operator === '$exists') return (actual !== undefined) === expected;
      if (operator === '$gte') return actual >= expected;
      if (operator === '$lte') return actual <= expected;
      if (operator === '$lt') return actual < expected;
      if (operator === '$gt') return actual > expected;
      throw new Error(`Unsupported test query: ${operator}`);
    });
  });
}

const cursor = rows => ({ toArray: async () => rows, project() { return this; } });
function session(day, times, shift) {
  return {
    type: 1, machine: { serial: 90001, name: 'SPF1' }, operators: [{ id: 1 }],
    ...(shift ? { shift } : {}),
    timestamps: { start: instant(day, '05:00'), end: instant(day, '19:00') },
    counts: times.map(time => ({ timestamps: { create: instant(day, time) }, item: { id: 1, name: 'Sheets', standard: 100 } }))
  };
}
function totals(day, count = 100) {
  return ['machine', 'machine-item'].map(type => ({
    type, machine: { id: 90001, name: 'SPF1' }, shift: { id: morningId },
    ...(type === 'machine-item' ? { item: { id: 1, name: 'Sheets', standard: 100 } } : {}),
    timestamps: { create: instant(day, '00:00') },
    totals: { count, runtimeMs: 3600000, workedTimeMs: 3600000 }
  }));
}

function harness({ sessions = [], cached = [] } = {}) {
  let shiftCacheQueries = 0;
  let sessionQueries = 0;
  const db = wrapDatabase({ collection(name) {
    if (name === config.shiftCollectionName || name === 'config-shift') return {
      find: () => cursor(shifts), findOne: async query => shifts.find(shift => equal(shift._id, query._id)) || null
    };
    if (name === config.totalsShiftCollectionName || name === config.totalsDailyCollectionName) return {
      find(query) {
        if (name === config.totalsShiftCollectionName) shiftCacheQueries++;
        return cursor(cached.filter(record => matches(record, query)));
      }
    };
    if (name === config.machineCollectionName) return { find: () => cursor([{ serial: 90001, stations: [1] }]) };
    if (name === config.machineSessionCollectionName) return {
      find: query => cursor(sessions.filter(record => matches(record, query))),
      aggregate(pipeline) {
        sessionQueries++;
        const start = pipeline[1].$addFields.ovStart.$max[1];
        const end = pipeline[1].$addFields.ovEnd.$min[1];
        const conditions = pipeline[3].$project.countsFiltered.$map.input.$filter.cond.$let.in.$and;
        const exclusive = Object.hasOwn(conditions[1], '$lt');
        return cursor(sessions.filter(record => matches(record, pipeline[0].$match)).map(record => {
          const ovStart = new Date(Math.max(record.timestamps.start, start));
          const ovEnd = new Date(Math.min(record.timestamps.end, end));
          return { ...record, ovStart, ovEnd, sliceMs: ovEnd - ovStart,
            countsFiltered: record.counts.filter(count => count.timestamps.create >= start &&
              (exclusive ? count.timestamps.create < end : count.timestamps.create <= end)) };
        }));
      }
    };
    throw new Error(`Unexpected test collection: ${name}`);
  } });
  const filename = require.resolve('../controllers/reports');
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, Date, Map, Set,
    require(name) {
      // Subscription scheduling/index creation is unrelated to this report handler.
      if (name === './reportSubscription') return () => require('express').Router();
      return localRequire(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const router = context.module.exports({ db, logger: {} });
  const handler = router.stack.find(layer => layer.route?.path === '/analytics/machine-report-cache').route.stack.at(-1).handle;
  return {
    get shiftCacheQueries() { return shiftCacheQueries; },
    get sessionQueries() { return sessionQueries; },
    async request(start, end, shiftId = String(morningId)) {
      let status = 200, body;
      const res = { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } };
      await handler({ query: { start: start.toISOString(), end: end.toISOString(), ...(shiftId ? { shiftId } : {}) },
        method: 'GET', originalUrl: '/api/reports/analytics/machine-report-cache' }, res);
      return { status, body };
    }
  };
}

test('partial-only shifts bypass totals cache and separate untagged counts at a shared boundary', async () => {
  const h = harness({ sessions: [session('06', ['05:30', '06:00', '08:00', '12:00', '13:00', '18:00', '18:30'])] });
  for (const shiftId of [morningId, afternoonId]) {
    const result = await h.request(instant('06', '00:00'), instant('06', '23:00'), String(shiftId));
    assert.equal(result.status, 200);
    assert.equal(result.body.results.length, 1);
    assert.equal(result.body.results[0].machineSummary.totalCount, 2);
    assert.equal(result.body.results[0].machineSummary.runtimeMs, 6 * 3600000);
  }
  assert.equal(h.shiftCacheQueries, 0);
});
test('explicitly tagged sessions from another shift are excluded even when timestamps overlap', async () => {
  const h = harness({ sessions: [session('06', ['08:00']),
    session('06', ['08:01'], { _id: morningId }), session('06', ['08:02'], { id: String(morningId) }),
    session('06', ['08:03'], { _id: afternoonId })] });
  const result = await h.request(instant('06', '00:00'), instant('06', '23:00'));
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].machineSummary.totalCount, 3);
});
test('complete historical days continue to use shift cache without querying session aggregates', async () => {
  const h = harness({ cached: totals('07') });
  const result = await h.request(instant('07', '00:00'), instant('08', '00:00'));
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].machineSummary.totalCount, 100);
  assert.equal(h.shiftCacheQueries, 1);
  assert.equal(h.sessionQueries, 0);
});
test('mixed ranges combine complete-day cache with clipped partial-day sessions', async () => {
  const h = harness({ cached: totals('07'), sessions: [session('06', ['08:00', '09:00'])] });
  const result = await h.request(instant('06', '06:00'), instant('08', '00:00'));
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].machineSummary.totalCount, 102);
  assert.equal(h.shiftCacheQueries, 1);
  assert.equal(h.sessionQueries, 1);
});
test('missing historical cache falls back to selected-shift session windows', async () => {
  const h = harness({ sessions: [session('07', ['05:30', '08:00', '13:00'])] });
  const result = await h.request(instant('07', '00:00'), instant('08', '00:00'));
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].machineSummary.totalCount, 1);
  assert.equal(h.shiftCacheQueries, 1);
});
test('empty shifts return a successful empty report rather than an error', async () => {
  const h = harness();
  const result = await h.request(instant('06', '00:00'), instant('06', '23:00'));
  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 0);
  assert.equal(h.shiftCacheQueries, 0);
});
test('ordinary unfiltered machine reports retain their session behavior', async () => {
  const h = harness({ sessions: [session('06', ['05:30', '08:00', '13:00'])] });
  const result = await h.request(instant('06', '00:00'), instant('06', '23:00'), null);
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].machineSummary.totalCount, 3);
});
test('invalid and missing shift IDs keep their client-error status', async () => {
  const h = harness();
  assert.equal((await h.request(instant('06', '00:00'), instant('06', '23:00'), 'invalid')).status, 400);
  assert.equal((await h.request(instant('06', '00:00'), instant('06', '23:00'), String(new ObjectId()))).status, 404);
});
test('strict shift matching remains the default for other session filter callers', () => {
  const query = sessionShiftFilter(String(morningId));
  assert.equal(matches({}, query), false);
  assert.equal(matches({ shift: { _id: morningId } }, query), true);
  const fallback = sessionShiftFilter(String(morningId), { includeUntagged: true });
  assert.equal(matches({}, fallback), true);
  assert.equal(matches({ shiftId: String(morningId) }, fallback), true);
  assert.equal(matches({ shift: { id: String(afternoonId) } }, fallback), false);
});
