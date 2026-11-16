const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecords, importRecords, main, COLLECTION } = require('../scripts/import-versa-alarms');
const definitions = require('../data/versa-alarms.json');
const { validate } = require('../schemas/alarm');

const importedAt = new Date('2026-11-16T12:00:00Z');
const records = () => buildRecords(definitions, importedAt);

function database(initial = []) {
  const rows = structuredClone(initial);
  const calls = [];
  const collection = {
    find: filter => ({ toArray: async () => rows.filter(row => filter.id.$in.includes(row.id)) }),
    createIndex: async (keys, options) => { calls.push('index'); assert.deepEqual(keys, { id: 1 }); assert.equal(options.unique, true); },
    bulkWrite: async writes => {
      calls.push('write');
      for (const { updateOne: write } of writes) {
        assert.equal(write.upsert, true);
        assert.deepEqual(write.filter, Object.fromEntries(['id', 'name', 'stop', 'fault', 'active', 'jam', 'color'].map(key => [key, write.update.$setOnInsert[key]])));
        if (!rows.some(row => row.id === write.filter.id)) rows.push(structuredClone(write.update.$setOnInsert));
      }
    }
  };
  return { rows, calls, collection: name => { assert.equal(name, COLLECTION); return collection; } };
}

test('approved source produces 104 schema-valid records with exact fields and fresh BSON dates', () => {
  const result = records();
  assert.equal(result.length, 104);
  assert.equal(result.filter(row => row.stop).length, 26);
  assert.equal(result.filter(row => !row.stop).length, 78);
  assert.deepEqual(result.map(row => row.id), Array.from({ length: 107 }, (_, id) => id).filter(id => ![24, 68, 85].includes(id)));
  for (const row of result) {
    assert.equal(validate(row), true);
    assert.deepEqual(Object.keys(row).sort(), ['active', 'color', 'fault', 'id', 'jam', 'name', 'stop', 'timestamps']);
    assert.equal(row.fault, row.stop);
    assert.equal(row.color, row.stop ? 'Red' : 'Yellow');
    assert.equal(row.active, true);
    assert.equal(row.jam, 0);
    assert.equal(row.name, definitions.find(source => source.id === row.id).name);
    for (const value of Object.values(row.timestamps)) {
      assert.ok(value instanceof Date);
      assert.equal(+value, +importedAt);
    }
  }
});

test('invalid definitions and deferred IDs fail before import', () => {
  for (const source of [[], null, [{ id: 1, name: 'Warning', stop: 'no' }],
    [{ id: '1', name: 'Warning', stop: false }], [{ id: 1, name: ' ', stop: false }],
    [{ id: 1, name: 'Warning', stop: false, french: 'text' }],
    ...[24, 68, 85].map(id => [{ id, name: 'Deferred', stop: false }]),
    [definitions[0], definitions[0]]]) {
    assert.throws(() => buildRecords(source));
  }
});

test('import is repeatable, preserves original timestamps, and leaves unrelated/deferred records intact', async () => {
  const unrelated = { id: 999, name: 'Existing site record' };
  const deferred = { id: 24, name: 'Existing deferred record' };
  const db = database([unrelated, deferred]);
  assert.deepEqual(await importRecords(db, records()), { verified: 104, previouslyPresent: 0 });
  const before = structuredClone(db.rows);
  assert.deepEqual(await importRecords(db, buildRecords(definitions, new Date('2026-11-17T12:00:00Z'))), { verified: 104, previouslyPresent: 104 });
  assert.deepEqual(db.rows, before);
  assert.equal(db.calls.filter(call => call === 'write').length, 1);
});

test('preflight rejects conflicts, invalid dates, and duplicate stored IDs without writes or index changes', async () => {
  const first = records()[0];
  for (const initial of [
    [{ ...first, name: 'Site override' }], [{ ...first, fault: false }],
    [{ ...first, timestamps: { ...first.timestamps, create: {} } }], [first, first]
  ]) {
    const db = database(initial);
    await assert.rejects(importRecords(db, records()));
    assert.deepEqual(db.calls, []);
    assert.deepEqual(db.rows, initial);
  }
});

test('partial previous import is completed without changing existing records', async () => {
  const db = database(records().slice(0, 9));
  assert.deepEqual(await importRecords(db, records()), { verified: 104, previouslyPresent: 9 });
  assert.equal(db.rows.length, 104);
});

test('post-import verification detects incomplete writes', async () => {
  const db = database();
  db.collection(COLLECTION).bulkWrite = async () => {};
  await assert.rejects(importRecords(db, records()), /verification failed/);
});

test('CLI defaults to offline dry run and help requires no environment or MongoDB', async () => {
  const forbidden = () => { throw new Error('Unexpected environment or database access'); };
  for (const argv of [[], ['--dry-run'], ['--help']]) {
    await main({ argv, env: {}, loadEnv: forbidden, createClient: forbidden, log: () => {} });
  }
  await assert.rejects(main({ argv: ['--unknown'] }), /Unsupported arguments/);
});

test('apply requires an explicit database and closes the client on success or failure', async () => {
  for (const uri of ['', 'mongodb://localhost:27017', 'mongodb://localhost:27017/?authSource=admin']) {
    await assert.rejects(main({ argv: ['--apply'], env: { MONGO_CONN_STRING: uri }, loadEnv: () => {}, log: () => {} }), /explicit database/);
  }
  for (const failure of [false, true]) {
    let closed = false;
    const db = database();
    db.databaseName = 'alpha-test';
    const options = { argv: ['--apply'], env: { MONGO_CONN_STRING: 'mongodb://localhost:27017/alpha-test' },
      loadEnv: () => {}, log: () => {}, createClient: () => ({
        connect: async () => { if (failure) throw new Error('Connection failed'); },
        db: () => db, close: async () => { closed = true; }
      }) };
    if (failure) await assert.rejects(main(options), /Connection failed/);
    else assert.equal((await main(options)).verified, 104);
    assert.equal(closed, true);
  }
});
