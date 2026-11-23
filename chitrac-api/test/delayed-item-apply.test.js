const { test, afterEach } = require('node:test');
const schedule = require('node-schedule');
const assert = require('node:assert/strict');
const express = require('express');
const config = require('../modules/config');

// Minimal in-memory collections for the item controller's delayed-apply path.
function createDb({ machinesOnline }) {
  const collections = {};
  const matches = (doc, filter = {}) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$ne' in value) return doc?.status?.code !== value.$ne;
    return key.split('.').reduce((v, k) => v?.[k], doc) === value;
  });
  const collection = name => collections[name] ||= {
    docs: [],
    async findOne(filter) {
      if (name === config.stateTickerCollectionName) return machinesOnline.value ? { status: { code: 1 } } : null;
      return this.docs.find(doc => matches(doc, filter)) || null;
    },
    find(filter) { return { toArray: async () => this.docs.filter(doc => matches(doc, filter)) }; },
    async insertOne(doc) { this.docs.push({ ...doc }); return { acknowledged: true }; },
    async updateOne(filter, update, options = {}) {
      let doc = this.docs.find(d => matches(d, filter));
      if (!doc && options.upsert) { doc = { ...filter, ...(update.$setOnInsert || {}) }; this.docs.push(doc); }
      if (!doc) return { matchedCount: 0 };
      for (const [key, value] of Object.entries(update.$set || {})) {
        const parts = key.split('.'); let target = doc;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = value;
      }
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const index = this.docs.findIndex(d => matches(d, filter));
      if (index >= 0) this.docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
  };
  return { collection, collections };
}

// The item controller keeps its router at module level, so load a fresh copy per simulated process.
function itemController() {
  delete require.cache[require.resolve('../controllers/item')];
  return require('../controllers/item');
}

function createServer(db) {
  const noop = () => {};
  return {
    db, scheduledJobs: {},
    logger: { info: noop, debug: noop, warn: noop, error: noop },
    appRoot: { path: require('path').join(__dirname, '..') },
    xmlParser: require('../modules/xmlParser'),
  };
}

async function postDelayedItem(server, body) {
  const app = express();
  app.use(express.json());
  app.use('/api', itemController()(server));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/item/config?applyAfterMachinesOffline=true`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
}

// Invoking a job by hand leaves its timer scheduled; cancel everything between tests.
afterEach(() => schedule.gracefulShutdown());

const pendingJobs = server => Object.entries(server.scheduledJobs).filter(([key, job]) => key.startsWith('delayedItemConfigApply:') && job);
const cancelAll = server => pendingJobs(server).forEach(([, job]) => job.cancel());

test('a delayed item change survives a restart and is applied once machines are offline', async () => {
  const machinesOnline = { value: true };
  const db = createDb({ machinesOnline });
  const first = createServer(db);
  const response = await postDelayedItem(first, { id: 901, name: 'Test Towel', active: true });
  assert.equal(response.status, 202);
  const pending = db.collections['pending-item-config'].docs;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'scheduled');
  assert.equal(pending[0].itemPayload.name, 'Test Towel');
  cancelAll(first); // simulate the process stopping before the job ran

  // A fresh controller (server restart) picks the change back up.
  const restarted = createServer(db);
  itemController()(restarted);
  await new Promise(resolve => setTimeout(resolve, 20));
  let jobs = pendingJobs(restarted);
  assert.equal(jobs.length, 1);

  // Machines still online: the attempt is rescheduled and the record kept.
  await jobs[0][1].invoke();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempt, 2);
  jobs = pendingJobs(restarted);
  assert.equal(jobs.length, 1);

  // Machines offline: applied, record removed, item written.
  machinesOnline.value = false;
  await jobs[0][1].invoke();
  assert.equal(pending.length, 0);
  assert.equal(db.collections[config.itemCollectionName].docs.filter(doc => doc.id === 901).length, 1);
  cancelAll(restarted);
});

test('a delayed change that fails to apply is kept as failed instead of disappearing', async () => {
  const machinesOnline = { value: false };
  const db = createDb({ machinesOnline });
  db.collection(config.itemCollectionName).docs.push({ id: 902, name: 'Existing' });
  const server = createServer(db);
  assert.equal((await postDelayedItem(server, { id: 902, name: 'Duplicate id', active: true })).status, 202);
  const [[, job]] = pendingJobs(server);
  await job.invoke();
  const [record] = db.collections['pending-item-config'].docs;
  assert.equal(record.status, 'failed');
  assert.match(record.error, /Already exists/);

  // Failed records are not retried after a restart.
  const restarted = createServer(db);
  itemController()(restarted);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pendingJobs(restarted).length, 0);
});
