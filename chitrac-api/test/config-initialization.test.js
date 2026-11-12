const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const defaults = require('../defaults');
const { initializeConfigCollections, ensureCollection } = require('../modules/initializeConfigCollections');
const { main, runInitialization, safeErrorMessage } = require('../scripts/init-config');

function memoryDb(seed = {}) {
  const rows = new Map(Object.entries(structuredClone(seed)));
  const writes = [];
  const db = {
    databaseName: 'isolated_config_test', rows, writes,
    listCollections: ({ name }) => ({ hasNext: async () => rows.has(name) }),
    async createCollection(name) {
      if (rows.has(name)) throw Object.assign(new Error('Already exists'), { code: 48 });
      rows.set(name, []);
      writes.push({ operation: 'create', name });
    },
    collection(name) {
      return {
        estimatedDocumentCount: async () => (rows.get(name) || []).length,
        find: () => ({ toArray: async () => structuredClone(rows.get(name) || []) }),
        async insertMany(documents) {
          writes.push({ operation: 'insert', name });
          rows.set(name, [...(rows.get(name) || []), ...structuredClone(documents)]);
        },
        async createIndex() { writes.push({ operation: 'index', name }); },
        async bulkWrite(operations) {
          writes.push({ operation: 'upsert', name });
          const documents = rows.get(name) || [];
          for (const { updateOne: write } of operations) {
            if (!documents.some(row => row.id === write.filter.id)) documents.push(structuredClone(write.update.$setOnInsert));
          }
          rows.set(name, documents);
        }
      };
    }
  };
  return db;
}

test('fresh initialization creates only current config collections and seeds all bundled defaults', async () => {
  const db = memoryDb();
  const results = await initializeConfigCollections(db);
  assert.equal(results.length, 8);
  for (const key of ['machine', 'item', 'status', 'operator', 'shift', 'user', 'alarm']) {
    assert.equal(db.rows.get(`config-${key}`).length, defaults[key].length);
  }
  assert.deepEqual(db.rows.get('config-shift-maintenance'), []);
  assert.ok(!db.rows.has('config-fault'));
  assert.ok(db.writes.every(write => write.name.startsWith('config-')));
  assert.ok(db.rows.get('config-alarm').every(row => row.fault === true && row.stop === true));
  const machine = db.rows.get('config-machine')[0];
  assert.ok(machine.timestamps.create instanceof Date);
  assert.ok(defaults.machine[0].timestamps.create.$date, 'source defaults must remain unmodified');
  machine.name = 'Site customization';
  assert.notEqual(defaults.machine[0].name, machine.name);
  assert.ok(!JSON.stringify(results).includes('password'), 'reports must never contain default account credentials');
});

test('repeat runs preserve custom records and flags and do not replenish populated collections', async () => {
  const db = memoryDb();
  await initializeConfigCollections(db);
  db.rows.set('config-item', [{ id: 500, name: 'Only site item' }]);
  db.rows.get('config-alarm')[0].fault = false;
  db.rows.get('config-alarm')[0].stop = false;
  db.rows.set('config-shift-maintenance', [{ id: 123 }]);
  const before = structuredClone([...db.rows]);
  db.writes.length = 0;
  const results = await initializeConfigCollections(db);
  assert.deepEqual([...db.rows], before);
  assert.deepEqual(db.writes, []);
  assert.ok(results.every(row => row.status === 'skipped'));
});

test('existing empty collections are seeded without affecting runtime data or preferences', async () => {
  const db = memoryDb({ 'config-machine': [], count: [{ count: 7 }], 'preferences-system': [{ custom: true }] });
  await initializeConfigCollections(db);
  assert.equal(db.rows.get('config-machine').length, defaults.machine.length);
  assert.deepEqual(db.rows.get('count'), [{ count: 7 }]);
  assert.deepEqual(db.rows.get('preferences-system'), [{ custom: true }]);
});

test('legacy faults are copied into alarms with identity and dates preserved, without editing the source', async () => {
  const fault = { _id: 'legacy', id: 333, name: 'Site fault', timestamps: { create: new Date() } };
  const db = memoryDb({ 'config-fault': [fault] });
  const results = await initializeConfigCollections(db);
  assert.deepEqual(db.rows.get('config-alarm'), [{ ...fault, fault: true, stop: true }]);
  assert.deepEqual(db.rows.get('config-fault'), [fault]);
  assert.ok(!db.writes.some(write => write.name === 'config-fault'));
  assert.equal(results.find(row => row.collection === 'config-alarm').source, 'config-fault');
});

test('collection overrides work and malformed or colliding names fail before any write', async () => {
  const db = memoryDb();
  await initializeConfigCollections(db, { machineCollectionName: 'config-site-machine' });
  assert.ok(db.rows.has('config-site-machine'));
  assert.ok(!db.rows.has('config-machine'));
  for (const config of [{ machineCollectionName: 'count' }, { alarmCollectionName: 'config-item' }]) {
    const clean = memoryDb();
    await assert.rejects(initializeConfigCollections(clean, config));
    assert.deepEqual(clean.writes, []);
  }
});

test('creation tolerates NamespaceExists races but propagates permission failures', async () => {
  const db = memoryDb();
  db.createCollection = async () => { throw Object.assign(new Error('Race'), { codeName: 'NamespaceExists' }); };
  await ensureCollection(db, 'config-machine');
  db.createCollection = async () => { throw new Error('Not authorized'); };
  await assert.rejects(ensureCollection(db, 'config-machine'), /Not authorized/);
});

function fakeClient(db) {
  return { connected: false, closed: false,
    async connect() { this.connected = true; }, db: () => db,
    async close() { this.closed = true; } };
}

test('standalone CLI needs only the main URI, reports results, and always closes its connection', async () => {
  const db = memoryDb();
  const client = fakeClient(db);
  const messages = [];
  const results = await runInitialization('mongodb://example.test/config_test', { createClient: () => client, log: message => messages.push(message) });
  assert.equal(results.length, 8);
  assert.equal(client.connected, true);
  assert.equal(client.closed, true);
  assert.match(messages.at(-1), /complete/);
  assert.ok(messages.some(message => message.includes('config-alarm')));
  assert.ok(!messages.some(message => message.includes('mongodb://')));
  for (const failConnect of [false, true]) {
    const broken = fakeClient(memoryDb());
    if (failConnect) broken.connect = async () => { throw new Error('Connection failed'); };
    else broken.db = () => { throw new Error('Seed failed'); };
    await assert.rejects(runInitialization('mongodb://example.test/config_test', { createClient: () => broken, log() {} }), /failed/);
    assert.equal(broken.closed, true);
  }
});

test('missing URI or database and unsupported arguments fail before connecting', async () => {
  for (const uri of [undefined, '', 'http://example.test/db', 'mongodb://example.test',
    'mongodb://example.test/?retryWrites=true', 'mongodb://example.test?appName=x/y']) {
    await assert.rejects(runInitialization(uri, { createClient() { assert.fail('Must not connect'); } }), /MONGO_CONN_STRING/);
  }
  await assert.rejects(main({ argv: ['--reset'], loadEnv() { assert.fail('Must not load environment'); } }), /Unsupported arguments/);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/init-config.js'), '--reset'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported arguments/);
});

test('a seed write failure stops later initialization, closes the client and does not report success', async () => {
  const db = memoryDb();
  const collection = db.collection.bind(db);
  db.collection = name => {
    const target = collection(name);
    if (name === 'config-item') target.insertMany = async () => { throw new Error('Insert not authorized'); };
    return target;
  };
  const client = fakeClient(db);
  const messages = [];
  await assert.rejects(runInitialization('mongodb://example.test/config_test', {
    createClient: () => client, log: message => messages.push(message)
  }), /Insert not authorized/);
  assert.equal(client.closed, true);
  assert.equal(db.rows.get('config-machine').length, defaults.machine.length);
  assert.ok(!db.rows.has('config-status'), 'later collections must not be initialized after a failure');
  assert.ok(!messages.some(message => message.includes('complete')));
});

test('API startup logs each collection failure and continues, including alarm and maintenance failures', async () => {
  const db = memoryDb();
  const collection = db.collection.bind(db);
  db.collection = name => {
    const target = collection(name);
    if (name === 'config-item') target.insertMany = async () => { throw new Error('Item insert denied'); };
    if (name === 'config-alarm') target.createIndex = async () => { throw new Error('Alarm index denied'); };
    if (name === 'config-shift-maintenance') target.estimatedDocumentCount = async () => { throw new Error('Maintenance read denied'); };
    return target;
  };
  const errors = [];
  const successes = [];
  const results = await initializeConfigCollections(db, {}, {
    onError: (error, name) => errors.push({ name, message: error.message }),
    onResult: row => successes.push(row.collection)
  });
  assert.deepEqual(errors, [
    { name: 'config-item', message: 'Item insert denied' },
    { name: 'config-alarm', message: 'Alarm index denied' },
    { name: 'config-shift-maintenance', message: 'Maintenance read denied' }
  ]);
  assert.equal(results.length, 8);
  assert.deepEqual(results.filter(row => row.status === 'failed').map(row => row.collection), errors.map(row => row.name));
  for (const key of ['machine', 'status', 'operator', 'shift', 'user']) {
    assert.equal(db.rows.get(`config-${key}`).length, defaults[key].length);
    assert.ok(successes.includes(`config-${key}`));
  }
  assert.ok(!successes.includes('config-item'), 'failed collections must not be reported as initialized');
});

test('environment loading is anchored to the project, and help does not load credentials or connect', async () => {
  const client = fakeClient(memoryDb());
  let envPath;
  await main({ argv: [], env: {}, createClient: () => client, log() {}, loadEnv(options) {
    envPath = options.path;
    options.processEnv.MONGO_CONN_STRING = 'mongodb://example.test/config_test';
  } });
  assert.equal(envPath, path.resolve(__dirname, '..', '.env'));
  await main({ argv: ['--help'], loadEnv() { assert.fail('Help must not load .env'); },
    createClient() { assert.fail('Help must not connect'); }, log: text => assert.match(text, /init:config/) });
  assert.ok(!require.cache[path.resolve(__dirname, '../index.js')], 'standalone imports must not load the API');
});

test('driver errors redact connection strings', () => {
  assert.ok(!safeErrorMessage(new Error('Failed mongodb://name:secret@example.test/db')).includes('secret'));
});

test('initializer and defaults can be copied to another project without a server checkout', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chitrac-config-init-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('chitrac-config-init-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.cpSync(path.resolve(__dirname, '../defaults'), path.join(root, 'defaults'), { recursive: true });
  for (const file of ['modules/initializeConfigCollections.js', 'modules/initializeAlarms.js', 'scripts/init-config.js']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(root, file));
  }
  const portable = require(path.join(root, 'modules/initializeConfigCollections'));
  const db = memoryDb();
  await portable.initializeConfigCollections(db);
  assert.equal(db.rows.get('config-alarm').length, defaults.alarm.length);
  const help = spawnSync(process.execPath, [path.join(root, 'scripts/init-config.js'), '--help'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /MONGO_CONN_STRING/);
});
