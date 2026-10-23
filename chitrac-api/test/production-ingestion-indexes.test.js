const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureProductionIngestionIndexes } = require('../modules/productionIngestionIndexes');

test('indexes machine-scoped session updates and history without changing documents', async () => {
  const indexes = [];
  const config = { machineSessionCollectionName: 'machine', operatorSessionCollectionName: 'operator', itemSessionCollectionName: 'item', totalsMinuteCollectionName: 'minute' };
  const db = { collection: name => ({ createIndex: async (keys, options) => indexes.push({ name, keys, options }) }) };
  await ensureProductionIngestionIndexes(db, config);
  for (const name of ['machine', 'operator', 'item']) {
    const current = indexes.find(index => index.name === name && index.options.name === 'production_current_sessions_by_machine');
    // Equality fields precede the start/_id ordering used by open-session ingestion.
    assert.deepEqual(current.keys, { 'machine.serial': 1, 'timestamps.end': 1, 'timestamps.start': 1, _id: 1 });
    assert.equal(current.options.unique, undefined);
  }
  assert.deepEqual(indexes.filter(index => index.options.name === 'production_session_history_by_machine').map(index => index.name).sort(), ['item', 'operator']);
  assert.deepEqual(indexes.find(index => index.name === 'minute').keys, { 'machine.id': 1, 'timestamps.start': 1 });
});

test('surfaces index creation failures rather than reporting successful setup', async () => {
  const failure = new Error('index unavailable');
  const db = { collection: () => ({ createIndex: async () => { throw failure; } }) };
  await assert.rejects(ensureProductionIngestionIndexes(db, { machineSessionCollectionName: 'm', operatorSessionCollectionName: 'o', itemSessionCollectionName: 'i' }), failure);
});
