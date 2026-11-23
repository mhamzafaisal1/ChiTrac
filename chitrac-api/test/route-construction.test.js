const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const express = require('express');

// /api and /api/alpha must share one instance of each domain controller. Building
// them twice duplicated startup side effects such as scheduled report jobs.
test('each domain controller is constructed once and still serves /api/alpha', async () => {
  const shared = ['machine', 'operator', 'item', 'fault', 'dashboard', 'reports'];
  const counts = {};
  const originalLoad = Module._load;
  Module._load = function (request) {
    const loaded = originalLoad.apply(this, arguments);
    const match = request.match(/controllers\/(\w+)$|^\.\.\/(\w+)$/);
    const name = match && (match[1] || match[2]);
    if (!shared.includes(name) || typeof loaded !== 'function' || loaded.__counted) return loaded;
    const counted = function (...args) { counts[name] = (counts[name] || 0) + 1; return loaded.apply(this, args); };
    return Object.assign(counted, loaded, { __counted: true });
  };
  const config = require('../modules/config');
  const previousTokenCheck = config.enableApiTokenCheck;
  let listener;
  try {
    const collection = new Proxy({}, { get: (_, key) => (key === 'find' || key === 'aggregate')
      ? () => ({ toArray: async () => [], sort() { return this; }, project() { return this; }, limit() { return this; } })
      : async () => null });
    const server = {
      db: { collection: () => collection, listCollections: () => ({ toArray: async () => [] }) },
      logger: new Proxy({}, { get: () => () => {} }),
      appRoot: { path: require('path').join(__dirname, '..') },
      passport: new (require('passport').Passport)(),
      config, scheduledJobs: {}, cache: {},
      xmlParser: require('../modules/xmlParser'), defaults: require('../defaults'),
    };
    config.enableApiTokenCheck = false;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = { _id: 'test', active: true, permissions: { level: 0 }, local: { username: 'test' } };
      next();
    });
    require('../routes').init(app, server);

    assert.deepEqual(Object.fromEntries(shared.map(name => [name, counts[name]])),
      Object.fromEntries(shared.map(name => [name, 1])));

    listener = app.listen(0, '127.0.0.1');
    await new Promise(resolve => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}`;
    for (const path of ['/api/alpha/shifts', '/api/alpha/item/config', '/api/alpha/operator/config',
      '/api/alpha/analytics/machine/config', '/api/alpha/report-subscriptions']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    assert.equal((await fetch(base + '/api/alpha/does-not-exist')).status, 404);
  } finally {
    Module._load = originalLoad;
    config.enableApiTokenCheck = previousTokenCheck;
    if (listener) await new Promise(resolve => listener.close(resolve));
  }
});
