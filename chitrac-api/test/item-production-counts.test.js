const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../modules/config');
const { wrapDatabase } = require('../modules/totalsCollectionAdapter');
const { getItemSummaryForRange, getItemsCachedDataForDays, combineItemsHybridData } = require('../utils/itemFunctions');

function harness() {
  const queries = [];
  const rows = [
    { type: 'machine-item', machine: { id: 1 }, item: { id: 1, name: 'Sheets', standard: 100 }, totals: { count: 5, workedTimeMs: 60000 } },
    { type: 'machine-item', machine: { id: 2 }, item: { id: 1, name: 'Sheets', standard: 100 }, totals: { count: 7, workedTimeMs: 60000 } },
    { type: 'operator-item', item: { id: 1 }, totals: { count: 900, workedTimeMs: 900000 } },
  ];
  const db = wrapDatabase({ collection: name => ({
    find(query) {
      queries.push({ name, query });
      return { toArray: async () => rows.filter(row => row.type === query.type && (!query['machine.id'] || row.machine?.id === query['machine.id'])) };
    },
    aggregate(pipeline) {
      queries.push({ name, pipeline });
      return { toArray: async () => [{ type: 1, machine: { serial: 1 }, operators: [{ id: 1 }, { id: 2 }, { id: 3 }],
        ovStart: new Date('2026-10-26T05:00:00Z'), ovEnd: new Date('2026-10-26T18:00:00Z'), sliceMs: 60000,
        countsFiltered: ['04:59:00', '06:00:00', '07:00:00', '18:00:00'].map(time => ({
          timestamps: { create: new Date(`2026-10-26T${time}Z`) }, item: { id: 1, name: 'Sheets', standard: 100 }
        }))
      }] };
    }
  }) });
  return { db, queries };
}

test('complete days count machine output once, regardless of operator attribution', async () => {
  const { db, queries } = harness();
  const rows = await getItemSummaryForRange(db, new Date('2026-10-25T05:00:00Z'), new Date('2026-10-26T05:00:00Z'));
  assert.equal(rows[0].count, 12);
  assert.equal(rows[0].workedTimeMs, 120000);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].query.type, 'machine-item');
});

test('machine filter excludes other machines before item grouping', async () => {
  const { db } = harness();
  const rows = await getItemSummaryForRange(db, new Date('2026-10-25T05:00:00Z'), new Date('2026-10-26T05:00:00Z'), { serial: 2 });
  assert.equal(rows[0].count, 7);
});

test('today and clipped windows use actual count events with an exclusive end', async () => {
  const { db, queries } = harness();
  const rows = await getItemSummaryForRange(db, new Date('2026-10-26T05:00:00Z'), new Date('2026-10-26T18:00:00Z'));
  assert.equal(rows[0].count, 2);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].name, config.machineSessionCollectionName);
  assert.ok(queries[0].pipeline[0].$match.$or.some(condition => condition['timestamps.end'] === null), 'ongoing sessions with an explicit null end must be queried');
});

test('legacy item cache reads cannot widen a plant day into the preceding UTC-midnight day', async () => {
  const { db, queries } = harness();
  await getItemsCachedDataForDays([{ dateStr: '2026-10-26', start: new Date('2026-10-26T05:00:00Z'), end: new Date('2026-10-27T05:00:00Z') }], db);
  const filter = JSON.stringify(queries[0].query);
  assert.match(filter, /2026-10-26T05:00:00/);
  assert.doesNotMatch(filter, /2026-10-25/);
  assert.doesNotMatch(filter, /2026-10-26T00:00:00/);
});

test('hybrid combination retains all machines/days and does not mutate cache documents', () => {
  const cache = [{ itemId: 1, totalCounts: 5, workedTimeMs: 10 }, { itemId: 1, totalCounts: 7, workedTimeMs: 20 }];
  const copy = structuredClone(cache);
  const result = combineItemsHybridData(cache, [{ itemId: 1, totalCounts: 3, workedTimeMs: 30 }]);
  assert.equal(result[0].totalCounts, 15);
  assert.equal(result[0].workedTimeMs, 60);
  assert.deepEqual(cache, copy);
});
