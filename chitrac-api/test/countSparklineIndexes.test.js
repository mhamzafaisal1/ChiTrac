const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { aggregateCountBuckets } = require('../utils/countSparklineCache');
const { ensureAnalyticsIndexes } = require('../modules/analyticsIndexes');

test('Mongo sparkline reads both timestamp formats without a collection scan', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI for isolated Mongo integration',
}, async t => {
  const client = await new MongoClient(process.env.MONGODB_TEST_URI).connect();
  const db = client.db('chitrac_sparkline_index_test_' + new ObjectId().toHexString());
  t.after(async () => { try { await db.dropDatabase(); } finally { await client.close(); } });
  const config = { countCollectionName: 'count' };
  const collection = db.collection('count');
  // Exercise the actual startup index definition, without unrelated startup work.
  let legacy;
  await ensureAnalyticsIndexes({ collection: name => ({
    async createIndex(keys, options) { if (name === 'count' && options.name === 'count_legacy_timestamp') legacy = { keys, options }; },
  }) }, { countCollectionName: 'count' }, { warn: () => {} });
  assert.ok(legacy);
  await collection.createIndex({ 'timestamps.create': 1 }, { name: 'timestamps_create' });
  await collection.createIndex(legacy.keys, legacy.options);
  const end = new Date(), start = new Date(end.getTime() - 60000);
  const old = new Date(end.getTime() - 7 * 86400000), recent = new Date(+start + 1000);
  await collection.insertMany(Array.from({ length: 10000 }, (_, n) => ({ machine: { serial: 21 },
    ...(n % 2 ? { timestamp: old } : { timestamps: { create: old } }) })));
  await collection.insertMany([
    { machine: { serial: 21 }, timestamps: { create: recent } },
    { machine: { serial: 21 }, timestamp: recent },
    { machine: { serial: 21 }, timestamps: { create: recent }, timestamp: recent },
    { machine: { serial: 21 }, timestamps: { create: recent }, misfeed: true },
    { machine: { serial: 21 }, timestamps: { create: old }, timestamp: recent },
  ]);
  let pipeline;
  const observed = { collection: () => ({ aggregate: stages => {
    pipeline = stages; return collection.aggregate(stages);
  } }) };
  const buckets = await aggregateCountBuckets(observed, config, start, end);
  assert.equal([...buckets.values()].reduce((sum, count) => sum + count, 0), 3);
  const explain = await collection.aggregate(pipeline).explain('executionStats');
  const cursor = explain.stages?.find(stage => stage.$cursor)?.$cursor || explain;
  assert.ok(!JSON.stringify(cursor.queryPlanner.winningPlan).includes('COLLSCAN'));
  assert.ok(cursor.executionStats.totalDocsExamined < 20, JSON.stringify(cursor.executionStats));
});
