const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateTotalsMinuteTtl, RETENTION_SECONDS, TTL_INDEX_NAME } = require('../scripts/migrate-totals-minute-ttl');

function fixture({ documents = [], indexes = [], exists = true, fail } = {}) {
  const state = { documents: structuredClone(documents), indexes: structuredClone(indexes), operations: [] };
  const collection = {
    listIndexes: () => ({ toArray: async () => {
      if (!exists) throw Object.assign(new Error('not found'), { code: 26 });
      return structuredClone(state.indexes);
    } }),
    countDocuments: async filter => state.documents.filter(document => filter.$expr
      ? !(document.timestamps?.update instanceof Date)
      : Object.hasOwn(document, 'expiresAt')).length,
    createIndex: async (key, options) => {
      if (fail === 'create') throw new Error('create failed');
      state.operations.push('create');
      state.indexes.push({ key, ...options });
    },
    dropIndex: async name => {
      if (fail === 'drop') throw new Error('drop failed');
      state.operations.push('drop');
      state.indexes = state.indexes.filter(index => index.name !== name);
    },
    updateMany: async (filter, update) => {
      assert.deepEqual(filter, { expiresAt: { $exists: true } });
      assert.deepEqual(update, { $unset: { expiresAt: '' } });
      state.operations.push('unset');
      let modifiedCount = 0;
      for (const document of state.documents) {
        if (Object.hasOwn(document, 'expiresAt')) { delete document.expiresAt; modifiedCount++; }
      }
      return { modifiedCount };
    },
  };
  return { state, db: {
    collection: name => { assert.equal(name, 'minutes'); return collection; },
    command: async command => {
      if (fail === 'collMod') throw new Error('collMod failed');
      assert.equal(command.collMod, 'minutes');
      state.operations.push('collMod');
      state.indexes.find(index => index.name === command.index.name).expireAfterSeconds = command.index.expireAfterSeconds;
    },
  } };
}

const legacyIndex = { name: 'totals_minute_ttl', key: { expiresAt: 1 }, expireAfterSeconds: 0 };
const record = {
  _id: 'mongo-id', id: 'minute-id', machine: { id: 42 }, totals: { count: 7 },
  timestamps: { start: new Date('2026-10-26T12:00:00Z'), update: new Date('2026-10-26T12:01:00Z') },
  expiresAt: new Date('2026-10-28T12:01:00Z'),
};
const options = { collectionName: 'minutes', apply: true };

test('defaults to a read-only migration report', async () => {
  const { db, state } = fixture({ documents: [record], indexes: [legacyIndex] });
  const report = await migrateTotalsMinuteTtl(db, { collectionName: 'minutes' });
  assert.equal(report.apply, false);
  assert.equal(report.recordsWithExpiresAt, 1);
  assert.equal(report.invalidUpdateTimestamps, 0);
  assert.equal(report.retentionSeconds, 172800);
  assert.deepEqual(report.legacyTtlIndexes, ['totals_minute_ttl']);
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.documents, [record]);
});

test('installs last-update TTL before removing the old index and field, preserving other data', async () => {
  const lookup = { name: 'lookup', key: { 'machine.id': 1 } };
  const { db, state } = fixture({ documents: [record], indexes: [legacyIndex, lookup] });
  const report = await migrateTotalsMinuteTtl(db, options);
  const { expiresAt, ...expected } = record;
  assert.equal(report.modifiedRecords, 1);
  assert.deepEqual(state.documents, [expected]);
  assert.deepEqual(state.operations, ['create', 'drop', 'unset']);
  assert.deepEqual(state.indexes, [lookup, {
    name: TTL_INDEX_NAME, key: { 'timestamps.update': 1 }, expireAfterSeconds: RETENTION_SECONDS,
  }]);
  state.operations = [];
  const repeated = await migrateTotalsMinuteTtl(db, options);
  assert.equal(repeated.modifiedRecords, 0);
  assert.deepEqual(state.operations, ['unset']);
});

test('reuses a last-update index and adjusts its retention without rebuilding it', async () => {
  for (const expireAfterSeconds of [undefined, 0, 60, RETENTION_SECONDS]) {
    const { db, state } = fixture({ indexes: [
      { name: 'existing_update', key: { 'timestamps.update': 1 }, expireAfterSeconds }, legacyIndex,
    ] });
    await migrateTotalsMinuteTtl(db, options);
    assert.equal(state.indexes[0].name, 'existing_update');
    assert.equal(state.indexes[0].expireAfterSeconds, RETENTION_SECONDS);
    assert.equal(state.operations.includes('create'), false);
    assert.equal(state.operations.includes('collMod'), expireAfterSeconds !== RETENTION_SECONDS);
  }
});

test('refuses missing, string, null and array update dates without modifying fields or indexes', async () => {
  for (const update of [undefined, null, '2026-10-26T12:01:00Z', [new Date()]]) {
    const invalid = { ...record, timestamps: { update } };
    const { db, state } = fixture({ documents: [invalid], indexes: [legacyIndex] });
    await assert.rejects(migrateTotalsMinuteTtl(db, options), /BSON Date timestamps.update/);
    assert.deepEqual(state.operations, []);
    assert.deepEqual(state.documents, [invalid]);
  }
});

test('preserves old expiry on replacement-index failure and retains fields on drop failure', async () => {
  for (const fail of ['create', 'drop', 'collMod']) {
    const indexes = fail === 'collMod'
      ? [legacyIndex, { name: 'existing_update', key: { 'timestamps.update': 1 } }]
      : [legacyIndex];
    const { db, state } = fixture({ documents: [record], indexes, fail });
    await assert.rejects(migrateTotalsMinuteTtl(db, options), new RegExp(`${fail} failed`));
    assert.deepEqual(state.documents, [record]);
    assert.ok(state.indexes.some(index => index.name === legacyIndex.name));
  }
});

test('supports a fresh collection without requiring existing indexes', async () => {
  const { db, state } = fixture({ exists: false });
  await migrateTotalsMinuteTtl(db, options);
  assert.deepEqual(state.operations, ['create', 'unset']);
  assert.deepEqual(state.indexes[0].key, { 'timestamps.update': 1 });
});
