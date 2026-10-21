const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');
const systemPreferencesSchema = require('../schemas/system-preferences');

function harness() {
  const routes = new Map();
  const users = new Map([['alice', { userId: 'alice', theme: 'dark' }]]);
  const collection = {
    async createIndex() {},
    async findOne({ userId }) { return users.get(userId) || null; },
    async updateOne({ userId }, { $set }) {
      const user = structuredClone(users.get(userId) || {});
      for (const [path, value] of Object.entries($set)) {
        const parts = path.split('.');
        let target = user;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = value;
      }
      users.set(userId, user);
    },
  };
  const router = {};
  for (const verb of ['get', 'put', 'post', 'delete']) {
    router[verb] = (path, ...handlers) => routes.set(`${verb} ${path}`, handlers);
  }
  const path = require.resolve('../controllers/preferences');
  const localRequire = createRequire(path);
  const context = vm.createContext({
    module: { exports: {} },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../../modules/config') return { jwtSecret: 'test-secret', enableApiTokenCheck: true };
      if (name === '../../modules/systemPreferences') return { getCollection: () => collection };
      return localRequire(name);
    },
  });
  vm.runInContext(fs.readFileSync(path, 'utf8'), context);
  context.module.exports({ db: { collection: () => collection }, logger: {} });
  return {
    users,
    async request(verb, userId, body = {}) {
      let status = 200;
      let payload;
      const req = { body, headers: userId
        ? { authorization: `Bearer ${jwt.sign({ userId }, 'test-secret')}` }
        : {} };
      const res = {
        status(value) { status = value; return res; },
        json(value) { payload = value; return res; },
      };
      let proceed = true;
      const next = (error) => {
        if (error) { status = error.status || 500; payload = { error: error.message }; }
        else proceed = true;
      };
      for (const handler of routes.get(`${verb} /user`)) {
        if (!proceed || payload !== undefined) break;
        proceed = false;
        await handler(req, res, next);
      }
      return { status, payload };
    },
  };
}


test('report orders survive partial updates and remain isolated per user and report', async () => {
  const h = harness();
  const saved = await h.request('put', 'alice', { reportLayouts: { machineReport: { columnOrder: ['Efficiency', 'Machine'] } } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.reportLayouts.machineReport.columnOrder[0], 'Efficiency');
  assert.equal(saved.payload.theme, 'dark');
  await h.request('put', 'alice', { reportLayouts: { itemReport: { columnOrder: ['PPH'] } } });
  await h.request('put', 'alice', { timeFormat: '24h' });
  const preferences = (await h.request('get', 'alice')).payload;
  assert.equal(preferences.reportLayouts.machineReport.columnOrder[0], 'Efficiency');
  assert.equal(preferences.reportLayouts.itemReport.columnOrder[0], 'PPH');
  assert.equal((await h.request('get', 'bob')).payload.reportLayouts, undefined);
  assert.equal((await h.request('put', null, { reportLayouts: { itemReport: { columnOrder: [] } } })).status, 401);
  assert.equal((await h.request('put', 'alice', { reportLayouts: { itemReport: { columnOrder: [false] } } })).status, 400);
  assert.equal((await h.request('get', 'alice')).payload.reportLayouts.itemReport.columnOrder[0], 'PPH');
});

test('experimental grid layout survives saving, reloading and unrelated partial preference updates', async () => {
  const h = harness();
  const layout = { gridLayout: '2x2', chartOrder: ['machine-status', 'machine-oee'], chartVisibility: { 'machine-status': true, 'machine-oee': true } };
  const saved = await h.request('put', 'alice', { dashboardLayouts: { experimentalDailyDashboard: layout } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.dashboardLayouts.experimentalDailyDashboard.gridLayout, '2x2');
  await h.request('put', 'alice', { timeFormat: '24h' });
  const reloaded = (await h.request('get', 'alice')).payload.dashboardLayouts.experimentalDailyDashboard;
  assert.equal(reloaded.gridLayout, '2x2');
  assert.equal(reloaded.chartOrder.length, 2);
  assert.equal((await h.request('get', 'bob')).payload.dashboardLayouts, undefined);
  await h.request('put', 'alice', { dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '3x2' } } });
  assert.equal((await h.request('get', 'alice')).payload.dashboardLayouts.experimentalDailyDashboard.gridLayout, '3x2');
});

test('experimental layout rejects invalid grids and keeps legacy preferences compatible', async () => {
  const h = harness();
  for (const gridLayout of ['4x4', '', 4, null]) {
    const result = await h.request('put', 'alice', { dashboardLayouts: { experimentalDailyDashboard: { gridLayout } } });
    assert.equal(result.status, 400);
  }
  const result = await h.request('put', 'alice', { dashboardLayouts: { experimentalDailyDashboard: { chartOrder: ['machine-oee'] } } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.dashboardLayouts.experimentalDailyDashboard.gridLayout, undefined);
  assert.equal((await h.request('put', null, { dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '2x2' } } })).status, 401);
});

test('system layout schema supports promoted 2x2 defaults and rejects invalid layouts', () => {
  for (const gridLayout of ['2x2', '3x2']) {
    const preferences = systemPreferencesSchema.utils.normalizePreferences({ dashboardLayouts: { experimentalDailyDashboard: { gridLayout } } });
    assert.equal(preferences.dashboardLayouts.experimentalDailyDashboard.gridLayout, gridLayout);
  }
  assert.throws(() => systemPreferencesSchema.utils.normalizePreferences({ dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '4x4' } } }), /Schema validation failed/);
});
