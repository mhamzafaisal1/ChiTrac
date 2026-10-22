const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');
const systemPreferencesSchema = require('../schemas/system-preferences');

function harness(machines = [
  ...[90001,90002,90003,90004,90005,90006].map(id => ({id,active:true,stations:[1]})),
  {id:80000,active:true,stations:[1,2,4]}, {id:70000,active:false,stations:[1,2]}
]) {
  const routes = new Map();
  const users = new Map([['alice', { userId: 'alice', theme: 'dark' }]]);
  const collection = {
    async createIndex() {},
    find() { return { async toArray() { return machines; } }; },
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


test('SPF selection and order persist per user without overwriting other layouts or preferences', async () => {
  const h = harness();
  const ids = ['90001','90002','90003','90004','90005','90006'];
  const layout = { stationOrder: [...ids].reverse(), stationVisibility: Object.fromEntries(ids.map((id,i) => [id, i < 3])) };
  const saved = await h.request('put', 'alice', { dashboardLayouts: { experimentalSpf: layout } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.dashboardLayouts.experimentalSpf.stationOrder[0], '90006:1');
  assert.equal(saved.payload.theme, 'dark');
  await h.request('put', 'alice', { dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '2x2' } } });
  await h.request('put', 'alice', { timeFormat: '24h' });
  const preferences = (await h.request('get', 'alice')).payload;
  assert.equal(Object.values(preferences.dashboardLayouts.experimentalSpf.stationVisibility).filter(Boolean).length, 3);
  assert.equal(preferences.dashboardLayouts.experimentalDailyDashboard.gridLayout, '2x2');
  assert.equal((await h.request('get', 'bob')).payload.dashboardLayouts, undefined);
  assert.equal((await h.request('put', null, { dashboardLayouts: { experimentalSpf: layout } })).status, 401);
  const bad = { ...layout, stationVisibility: Object.fromEntries(ids.map(id => [id,false])) };
  assert.equal((await h.request('put', 'alice', { dashboardLayouts: { experimentalSpf: bad } })).status, 400);
  assert.equal((await h.request('get', 'alice')).payload.dashboardLayouts.experimentalSpf.stationOrder[0], '90006:1');
});


test('production layouts save exact active configured stations and reject unknown, inactive or excessive selections', async () => {
  const h=harness();const ids=['80000:4','80000:1','90001:1'];
  const layout={stationOrder:ids,stationVisibility:Object.fromEntries(ids.map(id=>[id,true]))};
  const saved=await h.request('put','alice',{dashboardLayouts:{experimentalSpf:layout}});
  assert.equal(saved.status,200);assert.equal(saved.payload.dashboardLayouts.experimentalSpf.stationOrder[0],'80000:4');
  for (const invalid of ['80000:3','70000:1','12345:1']) {
    const bad={stationOrder:[invalid,...ids.slice(1)],stationVisibility:{}};
    assert.equal((await h.request('put','alice',{dashboardLayouts:{experimentalSpf:bad}})).status,400);
  }
  const many={stationOrder:['80000:1','80000:2','80000:4','90001:1','90002:1','90003:1','90004:1'],stationVisibility:{}};
  assert.equal((await h.request('put','alice',{dashboardLayouts:{experimentalSpf:many}})).status,400);
  assert.equal((await h.request('get','alice')).payload.dashboardLayouts.experimentalSpf.stationOrder[0],'80000:4');
  assert.equal((await h.request('get','bob')).payload.dashboardLayouts,undefined);
});


test('ordinary production layout saves clear a named default reference and preserve the named library',async()=>{
 const h=harness();const id='a'.repeat(64);h.users.get('alice').productionScreenLayouts={[id]:{id,name:'Private',stationIds:['80000:1','80000:2','80000:4'],createdAt:new Date().toISOString()}};
 h.users.get('alice').defaultProductionScreenLayout={scope:'user',id};
 const saved=await h.request('put','alice',{dashboardLayouts:{experimentalSpf:{stationOrder:['80000:4','80000:1','80000:2'],stationVisibility:{}}}});
 assert.equal(saved.status,200);assert.equal(saved.payload.defaultProductionScreenLayout,null);assert.equal(saved.payload.productionScreenLayouts[id].stationIds[0],'80000:1');
});
