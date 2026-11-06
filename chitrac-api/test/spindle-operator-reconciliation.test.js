const test = require('node:test');
const assert = require('node:assert/strict');
const spindle = require('../controllers/spindle');
const config = require('../modules/config');

test('operator output reconciles machine/item buckets and counts only events inside partial days', async () => {
  const start = '2026-01-05T12:00:00-06:00';
  const end = '2026-01-07T12:00:00-06:00';
  const common = { machineSerial: 21, operatorId: 7, operatorName: 'Sandra' };
  const items = [900, 900, 900, 894].map((totalCounts, i) => ({
    ...common, itemId: i + 1, itemName: 'Item ' + (i + 1), totalCounts, totalMisfeeds: i, workedTimeMs: 60000,
  }));
  const event = timestamp => ({ item: { id: 1, name: 'Item 1' }, timestamps: { create: new Date(timestamp) } });
  const sessions = [{ operator: { id: 7 }, machine: { id: 21 }, totalCount: 88,
    timestamps: { start: new Date(+new Date(start) - 60000), end: new Date(+new Date(start) + 60000) },
    counts: [event(+new Date(start) - 1), event(start)], misfeeds: [event(start)] }];
  const cursor = rows => ({ project() { return this; }, sort() { return this; }, toArray: async () => rows });
  const db = { collection(name) { return {
    aggregate: () => cursor([]),
    find(query = {}) {
      if (name === config.operatorCollectionName) return cursor([{ id: 7, name: 'Sandra' }]);
      if (name === config.operatorSessionCollectionName) return cursor(sessions);
      if (name === config.totalsDailyCollectionName && query.date === '2026-01-06') {
        if (query.entityType === 'operator-machine') return cursor([{ ...common, totalCounts: 922, runtimeMs: 60000 }]);
        if (query.entityType === 'operator-item') return cursor(items);
      }
      return cursor([]);
    },
  }; } };
  const router = spindle({ db, logger: console });
  async function request(path) {
    const handler = router.stack.find(l => l.route.path === '/operator/' + path).route.stack[0].handle;
    let result;
    await handler({ query: { operatorid: '7', timeframe: 'custom', start, end } },
      { json(body) { result = body; } });
    return result[0];
  }
  const overview = await request('overview'), details = await request('details');
  assert.deepEqual(overview.metrics.output, { totalCount: 3595, misfeedCount: 7 });
  assert.deepEqual(details.itemSummary.map(r => r.count).sort(), [901, 900, 900, 894].sort());
  assert.equal(details.itemSummary.reduce((sum, r) => sum + r.misfeed, 0), 7);
});
