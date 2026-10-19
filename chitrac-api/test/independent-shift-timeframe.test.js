const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { DateTime } = require('luxon');
const { SYSTEM_TIMEZONE } = require('../utils/time');
const { buildShiftScopedSessionWindows, durationInWindows } = require('../utils/shiftWindows');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const date = value => DateTime.fromISO(value, { zone: SYSTEM_TIMEZONE }).toJSDate();
const shift = (start = '06:00', end = '12:00', activeDays = [1, 2, 3, 4, 5, 6, 7]) => ({
  _id: new ObjectId('600000000000000000000001'), activeDays,
  timestamps: { start: date(`2026-01-05T${start}`), end: date(`2026-01-05T${end}`) },
});

test('a shift repeats throughout a quick-select range, clipping custom boundaries', () => {
  const windows = buildShiftScopedSessionWindows(shift(), date('2026-01-05T08:00'), date('2026-01-07T10:00'));
  assert.equal(windows.length, 3);
  assert.equal(+windows[0].start, +date('2026-01-05T08:00'));
  assert.equal(+windows[2].end, +date('2026-01-07T10:00'));
  assert.equal(durationInWindows(date('2026-01-05'), date('2026-01-08'), windows), 14 * 3600000);
});

test('inactive days and empty ranges do not return all-day data', () => {
  assert.deepEqual(buildShiftScopedSessionWindows(shift('06:00', '12:00', [1]), date('2026-01-06'), date('2026-01-07')), []);
  assert.deepEqual(buildShiftScopedSessionWindows(shift(), date('2026-01-06'), date('2026-01-06')), []);
});

test('overnight shifts include the preceding active day tail only inside the requested range', () => {
  const windows = buildShiftScopedSessionWindows(shift('22:00', '06:00', [1]), date('2026-01-06'), date('2026-01-07'));
  assert.equal(windows.length, 1);
  assert.equal(+windows[0].start, +date('2026-01-06'));
  assert.equal(+windows[0].end, +date('2026-01-06T06:00'));
});

test('shift windows follow local clocks across both daylight-saving transitions', () => {
  for (const [day, hours] of [['2026-03-08', 3], ['2026-11-01', 5]]) {
    const windows = buildShiftScopedSessionWindows(shift('00:00', '04:00'), date(day), date(`${day}T12:00`));
    assert.equal(windows.length, 1);
    assert.equal(windows[0].end - windows[0].start, hours * 3600000);
  }
});

function summaryHarness(cachedDays = []) {
  const queriedDays = [];
  const sessionWindows = [];
  const filename = require.resolve('../utils/shiftSummaryRecords');
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, Date, Number, Map,
    require(name) {
      if (name === './reportFunctions') return {
        getSessionDataForPartialDays: async (db, windows, id, options) => {
          sessionWindows.push(...windows);
          assert.equal(options.includeUntaggedShift, true);
          assert.equal(options.exclusiveEnd, true);
          return { machines: [{ machineSerial: 1, totalCounts: 7 }], machineItems: [] };
        },
      };
      return localRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const db = { collection: () => ({ find(query) {
    const day = DateTime.fromJSDate(query['timestamps.create'].$gte, { zone: SYSTEM_TIMEZONE }).toISODate();
    queriedDays.push(day);
    return { toArray: async () => cachedDays.includes(day) ? [{ machineSerial: 1, totalCounts: 10 }] : [] };
  } }) };
  return { queriedDays, sessionWindows, run: (start, end) => context.module.exports.getShiftSummaryRecords(db, shift(), date(start), date(end), 'machine') };
}

test('dashboard shift summaries aggregate all cached dates, not just the first date', async () => {
  const h = summaryHarness(['2026-01-05', '2026-01-06']);
  const rows = await h.run('2026-01-05', '2026-01-07');
  assert.deepEqual(h.queriedDays, ['2026-01-05', '2026-01-06']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalCounts, 20);
  assert.equal(h.sessionWindows.length, 0);
});

test('dashboard shift summaries use clipped sessions for partial or missing cached dates', async () => {
  const h = summaryHarness(['2026-01-05']);
  const rows = await h.run('2026-01-05', '2026-01-07T08:00');
  assert.equal(rows[0].totalCounts, 24);
  assert.equal(h.sessionWindows.length, 2);
  assert.equal(+h.sessionWindows[1].end, +date('2026-01-07T08:00'));
});

test('operator shift counts use recurring half-open windows and retain the overlap query', async () => {
  const { getOperatorSessionDataForPartialDays } = require('../utils/reportFunctions');
  const sessions = [{ type: 1, operator: { id: 1, name: 'Operator One' },
    timestamps: { start: date('2026-01-05T05:00'), end: date('2026-01-06T19:00') },
    counts: ['2026-01-05T08:00', '2026-01-05T12:00', '2026-01-06T08:00', '2026-01-06T13:00'].map(value => ({
      timestamps: { create: date(value) }, item: { id: 1, name: 'Sheets', standard: 100, count: 1 },
    })),
  }];
  const db = { collection: () => ({ find(query) {
    assert.ok(query.$or, 'time overlap filter must survive the shift OR filter');
    assert.ok(query.$and[0].$or, 'untagged shift opt-in is explicit');
    return { project() { return this; }, toArray: async () => sessions };
  } }) };
  const windows = buildShiftScopedSessionWindows(shift(), date('2026-01-05'), date('2026-01-07'));
  const result = await getOperatorSessionDataForPartialDays(db, windows, undefined, {
    shiftId: String(shift()._id), includeUntaggedShift: true, exclusiveEnd: true,
  });
  assert.equal(result.operators.reduce((total, record) => total + record.totalCounts, 0), 2);
});

test('fault reports count one occurrence once while clipping its duration across shift windows', async () => {
  const config = require('../modules/config');
  const selected = shift();
  const db = { collection(name) {
    assert.equal(name, config.machineSessionCollectionName);
    return { aggregate(pipeline) {
      assert.equal(pipeline[0].$match.$and.length, 4, 'keep time overlap and fault-only conditions');
      return { toArray: async () => [{ _id: 'fault-one', code: 99, name: 'Test fault', machine: { serial: 1 },
        ovStart: date('2026-01-05T05:00'), ovEnd: date('2026-01-06T19:00'), faultTimestamp: date('2026-01-05T05:00') }] };
    } };
  } };
  const router = require('../controllers/fault')({ db, logger: console });
  const handler = router.stack.find(layer => layer.route?.path === '/analytics/fault-report-summary').route.stack.at(-1).handle;
  let response;
  await handler({ reportShift: selected, query: { shiftId: String(selected._id), start: date('2026-01-05').toISOString(), end: date('2026-01-07').toISOString() } },
    { json(value) { response = value; }, status(code) { assert.equal(code, 200); return this; } });
  assert.equal(response.summaries[0].count, 1);
  assert.equal(response.summaries[0].totalDurationSeconds, 12 * 3600);
});
