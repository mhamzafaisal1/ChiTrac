const test = require('node:test');
const assert = require('node:assert/strict');
const { utils, validate } = require('../schemas/alarm');
const { initializeAlarms } = require('../modules/initializeAlarms');
const { alarm: defaults } = require('../defaults/alarm');

test('alarm requires explicit booleans, accepts false and optional numeric BIKO values', () => {
  const alarm = utils.initAlarm(20, 'Warning', false, false, { alarmCode: 0, alarmValue: 1.5 });
  assert.equal(validate(alarm), true);
  for (const key of ['fault', 'stop']) {
    for (const value of [undefined, null, 'false', 0]) {
      assert.equal(validate({ ...alarm, [key]: value }), false);
    }
  }
  assert.throws(() => utils.initAlarm(20, 'Warning', true), /validation failed/);
  assert.throws(() => utils.setProperty(alarm, 'alarmCode', '123'), /validation failed/);
  assert.equal(utils.setInactive(alarm).active, false);
});

function database(faults, records = []) {
  let indexes = 0;
  const alarm = {
    estimatedDocumentCount: async () => records.length,
    createIndex: async () => indexes++,
    bulkWrite: async writes => {
      for (const { updateOne: write } of writes) {
        if (!records.some(row => row.id === write.filter.id)) records.push(write.update.$setOnInsert);
      }
    }
  };
  return { records, indexes: () => indexes,
    collection: name => name === 'config-alarm' ? alarm : { find: () => ({ toArray: async () => faults }) } };
}
const config = { alarmCollectionName: 'config-alarm', faultCollectionName: 'config-fault' };

test('startup copies site faults once, preserves IDs and dates, and leaves fault source unchanged', async () => {
  const source = [{ _id: 'source', id: 12, name: 'Custom fault', timestamps: { create: new Date() } }];
  const db = database(source);
  await initializeAlarms(db, config, defaults);
  assert.deepEqual(db.records, [{ ...source[0], fault: true, stop: true }]);
  assert.equal(source[0].fault, undefined);
  db.records[0].stop = false;
  await initializeAlarms(db, config, defaults);
  assert.equal(db.records[0].stop, false);
  assert.equal(db.indexes(), 1);
});

test('startup without fault data seeds schema-valid alarms from defaults', async () => {
  const db = database([]);
  await initializeAlarms(db, config, defaults);
  assert.equal(db.records.length, defaults.length);
  assert.ok(db.records.length > 0);
  assert.ok(db.records.every(record => validate(record) && record.fault === true && record.stop === true));
  assert.ok(db.records[0].timestamps.create instanceof Date);
});

test('configuration exports use alarms and do not export the archived fault collection', () => {
  const { getConfigCollectionNames } = require('../utils/configExport');
  assert.deepEqual(getConfigCollectionNames(config), ['config-alarm']);
});

test('alarm configuration routes validate creates and partial updates and preserve false flags', async t => {
  const express = require('express');
  const { ObjectId } = require('mongodb');
  const { once } = require('node:events');
  const rows = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
  const collection = {
    findOne: async filter => rows.find(row => matches(row, filter)) || null,
    find: (query = {}) => {
      let projection;
      return {
        project(value) { projection = value; return this; },
        toArray: async () => rows.filter(row => matches(row, query)).map(row =>
          Object.fromEntries(Object.entries(row).filter(([key]) => projection?.[key] !== 0)))
      };
    },
    async updateOne(filter, update) {
      let row = rows.find(record => matches(record, filter));
      if (!row) { row = { _id: filter._id || new ObjectId() }; rows.push(row); }
      Object.assign(row, update.$set);
      return { acknowledged: true };
    },
    async deleteOne(filter) {
      const index = rows.findIndex(row => matches(row, filter));
      if (index >= 0) rows.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api', require('../controllers/status')({ xmlParser: require('../modules/xmlParser'), db: { collection: name => {
    assert.notEqual(name, 'config-fault', 'configuration routes must not open the archived fault collection');
    return collection;
  } } }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}/api/alarm/config`;
  const put = (id, body) => fetch(`${base}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal((await put(20, { name: 'Missing flags' })).status, 400);
  assert.equal((await put(20, { name: 'Warning', fault: false, stop: true, alarmCode: 0 })).status, 200);
  const created = rows[0].timestamps.create;
  assert.equal((await put(String(rows[0]._id), { alarmValue: 1.5 })).status, 200);
  assert.equal(rows[0].fault, false);
  assert.equal(rows[0].stop, true);
  assert.equal(rows[0].alarmValue, 1.5);
  assert.equal(rows[0].timestamps.create.getTime(), created.getTime());
  assert.equal((await put(20, { stop: 'false' })).status, 400);
  assert.equal((await put(21, { name: 'Other', fault: true, stop: false })).status, 200);
  assert.equal((await put(21, { id: 20 })).status, 409);
  assert.equal((await (await fetch(base)).json()).length, 2);
  const legacyBase = base.replace('/alarm/', '/fault/');
  for (const prefix of ['fault', 'faults']) {
    const url = base.replace('/alarm/', `/${prefix}/`);
    assert.deepEqual((await (await fetch(url)).json()).map(row => row.id), [21],
      'legacy reads must include non-stopping faults and exclude stopping non-fault alarms');
    const response = await fetch(`${url}/xml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/xml/);
    const parsed = await require('xml2js').parseStringPromise(await response.text());
    assert.deepEqual(parsed.faults.fault.map(row => Number(row.id[0])), [21]);
  }
  const allAlarmXML = await require('xml2js').parseStringPromise(await (await fetch(`${base}/xml`)).text());
  assert.deepEqual(allAlarmXML.alarms.alarm.map(row => Number(row.id[0])), [20, 21]);
  assert.equal((await fetch(`${legacyBase}/20`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Updated through legacy route' }) })).status, 200);
  assert.equal(rows[0].name, 'Updated through legacy route');
  assert.equal(rows[0].stop, true, 'legacy updates must not reset independent alarm flags');
  assert.equal((await fetch(`${legacyBase}/22`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Legacy creation' }) })).status, 200);
  assert.equal(rows[2].fault, true);
  assert.equal(rows[2].stop, true);
  await fetch(`${legacyBase}/22`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/20`, { method: 'DELETE' })).status, 200);
  assert.equal(rows.length, 1);
});
