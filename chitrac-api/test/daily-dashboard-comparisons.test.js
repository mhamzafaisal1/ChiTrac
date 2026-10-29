const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const config = require('../modules/config');
const { SYSTEM_TIMEZONE } = require('../utils/time');
const { buildPreviousDayComparisons, attachPreviousDayComparisons } = require('../utils/dailyDashboardComparisons');
const { buildTodayDailyAnalyticsCache, buildShiftDailyAnalyticsCache } = require('../utils/dailyAnalyticsDashboardCache');
const { buildTopOperatorEfficiencyFromCache, buildItemTotalsFromCache } = require('../utils/dashboardFunctions');

function harness(date, { empty = false } = {}) {
  const day = DateTime.fromISO(date, { zone: SYSTEM_TIMEZONE }).startOf('day');
  const currentDate = day.plus({ days: 1 }).toISODate();
  const duration = day.plus({ days: 1 }).toMillis() - day.toMillis();
  const machines = empty ? [] : [{ entityType: 'machine', date, machineSerial: 21, machineName: 'Same name',
    runtimeMs: duration / 2, workedTimeMs: 1000, totalTimeCreditMs: 500, totalCounts: 100, totalMisfeeds: 0 }];
  const operators = empty ? [] : Array.from({ length: 12 }, (_, index) => ({
    id: index + 1, name: 'Same name', totalWorkedTimeMs: 1000, totalTimeCreditMs: 1000 - index * 50,
    totalCounts: 10, totalMisfeeds: 0,
  }));
  const queries = [];
  const cursor = rows => ({ toArray: async () => rows, project() { return this; }, sort() { return this; }, limit() { return this; } });
  const db = { collection(name) { return {
    find(query) {
      queries.push({ name, query });
      if (name === 'totals-daily' && query.entityType === 'machine') {
        return cursor(query.date === date ? machines : query.date === currentDate ? machines.map(row => ({ ...row, date: currentDate })) : []);
      }
      if (name === 'totals-shift' && query.type) {
        const common = { timestamps: { create: day.plus({ days: 1 }).toJSDate() } };
        if (query.type === 'machine') return cursor([{ ...common, type: 'machine', machine: { id: 21, name: 'Machine' }, totals: { runtimeMs: 1000, workedTimeMs: 1000, timeCreditMs: 500, count: 10 } }]);
        if (query.type === 'item') return cursor([{ ...common, type: 'item', item: { id: 1, name: 'Sheets' }, totals: { count: 5 } }]);
        if (query.type === 'operator-machine') return cursor([{ ...common, type: 'operator-machine', operator: { id: 12, name: 'Same name' }, totals: { workedTimeMs: 1000, timeCreditMs: 2000 } }]);
      }
      return cursor([]);
    },
    findOne: async () => null,
    aggregate(pipeline) {
      queries.push({ name, pipeline });
      const match = pipeline[0].$match;
      if (name === 'totals-daily' && match.entityType === 'operator-machine') {
        return cursor(match.date === date ? operators : match.date === currentDate ? operators.map(row => row.id === 12 ? { ...row, totalTimeCreditMs: 2000 } : row) : []);
      }
      if (name === config.totalsHourlyCollectionName && match.entityType === 'item') {
        const includeZero = pipeline.some(stage => stage.$match?.totalCount?.$gte === 0);
        return cursor(!empty && match.date.$in.includes(date)
          ? [{ _id: 'Sheets', totalCount: 120 }, ...(includeZero ? [{ _id: 'Zero count', totalCount: 0 }] : [])]
          : match.date.$in.includes(currentDate) ? [{ _id: 'Sheets', totalCount: 5 }] : []);
      }
      return cursor([]);
    },
  }; } };
  return { db, day, duration, queries };
}

for (const [date, nextDate, hours] of [
  ['2026-10-27', '2026-10-28', 24],
  ['2026-03-08', '2026-03-09', 23],
  ['2026-11-01', '2026-11-02', 25],
]) {
  test(`full previous plant day ${date} uses its ${hours}-hour window and includes all operators`, async () => {
    const h = harness(date);
    const previous = await buildPreviousDayComparisons(h.db, null, nextDate);
    assert.equal(h.duration / 3600000, hours);
    assert.equal(previous.date, date);
    assert.equal(previous.machines[0].oee, 25);
    assert.equal(previous.operators.length, 12);
    assert.equal(previous.operators.find(row => row.id === 12).efficiency, 45);
    assert.deepEqual(previous.items, [{ itemName: 'Sheets', totalCount: 120 }, { itemName: 'Zero count', totalCount: 0 }]);
    const countQuery = h.queries.find(query => query.name === config.totalsHourlyCollectionName && query.pipeline);
    assert.deepEqual(countQuery.pipeline[0].$match.date.$in, [date]);
    const ordinary = await buildTopOperatorEfficiencyFromCache(h.db, h.day.toJSDate(), h.day.endOf('day').toJSDate());
    assert.equal(ordinary.length, 10, 'existing top-ten callers retain their limit');
    const items = await buildItemTotalsFromCache(h.db, h.day.toJSDate(), h.day.endOf('day').toJSDate());
    assert.deepEqual(items.items, [{ itemName: 'Sheets', totalCount: 120 }]);
  });
}

test('joins by identity before ranking, preserves current values/order and distinguishes zero from missing', () => {
  const data = {
    machineOee: [{ serial: '22', name: 'Same name', oee: 80 }, { serial: 21, name: 'Same name', oee: 60 }],
    itemTotals: { items: [{ itemName: 'Zero count', totalCount: 5 }, { itemName: 'New item', totalCount: 3 }] },
    topOperators: [{ id: '12', name: 'Same name', efficiency: 100 }, { id: 99, name: 'Same name', efficiency: 95 }],
    machineGroupEfficiency: [{ efficiencyPreviousDay: { value: 0 } }, { efficiencyPreviousDay: null }],
  };
  const previous = { date: '2026-10-27', machines: [{ serial: 21, oee: 50 }, { serial: 22, oee: 0 }],
    items: [{ itemName: 'Zero count', totalCount: 0 }],
    operators: [{ id: 12, efficiency: 45, metrics: { runtime: { total: 1000 } } }],
  };
  attachPreviousDayComparisons(data, previous);
  assert.deepEqual(data.machineOee.map(row => [row.serial, row.oee, row.previousDay.value]), [['22', 80, 0], [21, 60, 50]]);
  assert.deepEqual(data.itemTotals.items[0].previousDay, { date: previous.date, value: 0 });
  assert.equal(data.itemTotals.items[1].previousDay, null);
  assert.equal(data.topOperators[0].previousDay.value, 45);
  assert.equal(data.topOperators[1].previousDay, null);
  assert.equal(data.machineGroupEfficiency[0].previousDay.value, 0);
  assert.equal(data.machineGroupEfficiency[1].previousDay, null);
});

test('missing historical records remain unavailable, including a new installation', async () => {
  const h = harness('2026-10-27', { empty: true });
  const previous = await buildPreviousDayComparisons(h.db, null, '2026-10-28');
  assert.deepEqual(previous, { date: '2026-10-27', machines: [], items: [], operators: [] });
  const data = { machineOee: [{ serial: 1, oee: 70 }], itemTotals: { items: [] }, topOperators: [], machineGroupEfficiency: [] };
  attachPreviousDayComparisons(data, previous);
  assert.equal(data.machineOee[0].previousDay, null);
});

test('invalid historical values and missing operator work time do not become markers', () => {
  const data = { machineOee: [{ serial: 1 }, { serial: 2 }], itemTotals: { items: [{ itemName: 'Bad' }] },
    topOperators: [{ id: 1 }, { id: 2 }], machineGroupEfficiency: [] };
  attachPreviousDayComparisons(data, { date: '2026-10-27', machines: [{ serial: 1, oee: NaN }, { serial: 2, oee: -1 }],
    items: [{ itemName: 'Bad', totalCount: Infinity }],
    operators: [{ id: 1, efficiency: 0, metrics: { runtime: { total: 0 } } }, { id: 2, efficiency: 0, metrics: { runtime: { total: 1000 } } }],
  });
  assert.deepEqual(data.machineOee.map(row => row.previousDay), [null, null]);
  assert.equal(data.itemTotals.items[0].previousDay, null);
  assert.equal(data.topOperators[0].previousDay, null);
  assert.equal(data.topOperators[1].previousDay.value, 0);
});

test('both today and historical shift WebSocket envelopes carry full previous-day comparisons', async () => {
  const h = harness('2026-10-27');
  const start = h.day.plus({ days: 1 }).toJSDate();
  const end = h.day.plus({ days: 1, hours: 8 }).toJSDate();
  const today = await buildTodayDailyAnalyticsCache(h.db, null, config, { now: end, start, end, dateStr: '2026-10-28' });
  const shift = await buildShiftDailyAnalyticsCache(h.db, null, config, {
    dateStr: '2026-10-28', start, end, shiftOid: 'shift-id', shiftDoc: null, mode: 'historical',
  });
  for (const envelope of [today, shift]) {
    assert.equal(envelope.data.machineOee[0].previousDay.value, 25);
    assert.deepEqual(envelope.data.itemTotals.items[0].previousDay, { date: '2026-10-27', value: 120 });
    const operator = envelope.data.topOperators.find(row => String(row.id) === '12');
    assert.equal(operator.efficiency, 200);
    assert.deepEqual(operator.previousDay, { date: '2026-10-27', value: 45 });
  }
});
