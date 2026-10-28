const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { createApiControllerAccess } = require('../utils/apiControllerAccess');
const { normalizeName } = require('../utils/productionLayouts');
const { createProductionScreenLayoutRouter } = require('../controllers/production-screen-layouts');

const alice = new ObjectId();
const bob = new ObjectId();
const entry = name => ({ ...normalizeName(name), stationIds: ['10:3', '10:1', '10:2'], createdAt: '2026-10-27T12:00:00Z', secret: 'not display data' });
const systemEntries = ['Zebra', 'Line 10', 'alpha', 'Line 2'].map(entry);
const aliceEntries = ['Zoo', 'Alpha'].map(entry);
const bobEntry = entry('Bob private');
const system = { _id: 'system-preferences', secret: 'system secret', productionScreenLayouts: Object.fromEntries(systemEntries.map(layout => [layout.id, layout])) };
const preferences = new Map([
  [String(alice), { userId: String(alice), secret: 'alice secret', productionScreenLayouts: Object.fromEntries(aliceEntries.map(layout => [layout.id, layout])), defaultProductionScreenLayout: { scope: 'user', id: aliceEntries[0].id } }],
  [String(bob), { userId: String(bob), productionScreenLayouts: { [bobEntry.id]: bobEntry } }],
]);
const initial = structuredClone([...preferences]);
let base, listener, permanent, tokenDoc;
const original = { jwtSecret: config.jwtSecret, enableApiTokenCheck: config.enableApiTokenCheck };
const readonly = read => ({ findOne: read, async updateOne() { throw new Error('Display routes must not write preferences'); } });
const systems = readonly(async () => structuredClone(system));
const users = readonly(async query => structuredClone(preferences.get(query.userId) || null));
const db = { collection(name) {
  if (name === 'preferences-user') return users;
  if (name === 'preferences-system') return systems;
  if (name === 'config-machine') return { find: () => ({ toArray: async () => [{ id: 10, active: true, stations: [1, 2, 3] }] }) };
  if (name === config.userCollectionName) return { findOne: async query => [alice, bob].some(id => String(id) === String(query._id)) ? { _id: query._id, active: true, permissions: { level: 9 } } : null };
  if (name === 'auth-tokens') return { findOne: async () => tokenDoc, updateOne: async () => ({ matchedCount: 1 }) };
  throw Error('Unexpected collection ' + name);
} };

before(async () => {
  config.jwtSecret = 'production-screen-layout-tests';
  config.enableApiTokenCheck = true;
  const server = { db, logger: {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createApiControllerAccess(server));
  app.use('/api/production-screen-layouts', createProductionScreenLayoutRouter({ db, config: {}, systemPreferences: { SINGLETON_ID: 'system-preferences', getCollection: () => systems } }));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  base = 'http://127.0.0.1:' + listener.address().port + '/api/production-screen-layouts';
  permanent = jwt.sign({ type: 'permanent', name: 'display', createdBy: String(alice) }, config.jwtSecret);
  tokenDoc = { _id: new ObjectId(), name: 'display', createdBy: String(alice), isActive: true, allowedControllers: ['general'], hashedToken: await bcrypt.hash(permanent, 4) };
});
after(async () => {
  Object.assign(config, original);
  listener.closeAllConnections();
  await new Promise(resolve => listener.close(resolve));
});
const request = (path = '', token, method = 'GET') => fetch(base + path, { method, headers: token ? { Authorization: 'Bearer ' + token } : {} });
const login = id => jwt.sign({ userId: String(id) }, config.jwtSecret);

test('anonymous menu reads return sorted System layouts only, with no owner preferences or writes', async () => {
  const response = await request('?userId=' + alice);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.deepEqual(body.layouts.map(layout => layout.name), ['alpha', 'Line 2', 'Line 10', 'Zebra']);
  assert.ok(body.layouts.every(layout => layout.scope === 'system' && !('secret' in layout)));
  assert.equal(body.defaultLayout, null);
  assert.ok(!JSON.stringify(body).includes('system secret'));
});

test('any signed-in production viewer sees System layouts first, then only their own sorted User layouts', async () => {
  const response = await request('?userId=' + bob, login(alice));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.layouts.map(layout => [layout.scope, layout.name]), [
    ['system', 'alpha'], ['system', 'Line 2'], ['system', 'Line 10'], ['system', 'Zebra'],
    ['user', 'Alpha'], ['user', 'Zoo'],
  ]);
  assert.deepEqual(body.defaultLayout, preferences.get(String(alice)).defaultProductionScreenLayout);
});

test('direct links preserve saved station order, scope identity and user defaults', async () => {
  for (const [scope, layout, token] of [
    ['system', systemEntries[2], undefined], ['user', aliceEntries[1], login(alice)],
  ]) {
    const response = await request('/' + scope + '/' + layout.id, token);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.layout.scope, scope);
    assert.deepEqual(body.stationLayout.stationOrder, ['10:3', '10:1', '10:2']);
    assert.ok(!('preferences' in body));
    assert.ok(!('secret' in body.layout));
  }
  assert.deepEqual([...preferences], initial);
});

test('private links cannot be viewed anonymously or by another account, even with a spoofed userId', async () => {
  assert.equal((await request('/user/' + aliceEntries[0].id)).status, 401);
  assert.equal((await request('/user/' + aliceEntries[0].id + '?userId=' + alice, login(bob))).status, 404);
});

test('permanent tokens do not inherit private layouts from their creator', async () => {
  const response = await request('', permanent);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).layouts.every(layout => layout.scope === 'system'));
  assert.equal((await request('/user/' + aliceEntries[0].id, permanent)).status, 401);
});

test('missing or malformed links fail clearly, and supplied invalid tokens and anonymous writes remain rejected', async () => {
  assert.equal((await request('/system/' + 'f'.repeat(64))).status, 404);
  assert.equal((await request('/system/' + 'A'.repeat(64))).status, 400);
  assert.equal((await request('', 'invalid-token')).status, 401);
  assert.equal((await request('', undefined, 'POST')).status, 401);
  assert.deepEqual([...preferences], initial);
});

test('disabled authentication never assigns a permanent-token creator or arbitrary caller a private identity', async () => {
  config.enableApiTokenCheck = false;
  try {
    assert.ok((await (await request('?userId=' + alice)).json()).layouts.every(layout => layout.scope === 'system'));
    assert.equal((await request('/user/' + aliceEntries[0].id)).status, 401);
  } finally { config.enableApiTokenCheck = true; }
});
