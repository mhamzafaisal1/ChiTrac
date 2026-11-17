const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyLayoutStore, registerDailyLayoutRoutes } = require('../controllers/preferences/daily-layouts');
const { chartIds } = require('../utils/dailyDashboardLayouts');
const schema = require('../schemas/system-preferences');
const systemModule = require('../modules/systemPreferences');

function layout(gridLayout = '3x2') {
  return { gridLayout, chartOrder: [...chartIds].reverse(), chartVisibility: Object.fromEntries(chartIds.map((id, i) => [id, i < (gridLayout === '2x2' ? 4 : 6)])) };
}
function get(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
function set(object, path, value) {
  const parts = path.split('.'); let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ||= {};
  target[parts.at(-1)] = structuredClone(value);
}
function harness() {
  const userDocs = new Map([['alice', { userId: 'alice', theme: 'dark', dashboardLayouts: { machineDashboard: { summaryCardOrder: ['counts'] } } }], ['bob', { userId: 'bob' }]]);
  const systemDocs = new Map([['system-preferences', { _id: 'system-preferences', systemName: 'Test', productionScreenLayouts: {} }]]);
  let failActivation = false;
  function collection(docs, key) {
    return {
      async findOne(filter) { const doc = docs.get(filter[key]); return doc ? structuredClone(doc) : null; },
      async updateOne(filter, update, options = {}) {
        let doc = docs.get(filter[key]);
        if (!doc) {
          if (!options.upsert) return { matchedCount: 0 };
          doc = { [key]: filter[key] };
          for (const [path, value] of Object.entries(update.$setOnInsert || {})) set(doc, path, value);
          docs.set(filter[key], doc);
        }
        for (const [path, value] of Object.entries(filter)) {
          if (path !== key && value?.$exists !== undefined && (get(doc, path) !== undefined) !== value.$exists) return { matchedCount: 0 };
        }
        if (failActivation && key === 'userId' && update.$set?.defaultDailyDashboardLayout &&
            !Object.keys(update.$set).some(path => path.startsWith('dailyDashboardLayouts.'))) {
          failActivation = false; throw Error('temporary database failure');
        }
        for (const [path, value] of Object.entries(update.$set || {})) set(doc, path, value);
        return { matchedCount: 1 };
      }
    };
  }
  const users = collection(userDocs, 'userId'), systems = collection(systemDocs, '_id');
  const dependencies = {
    db: { collection: () => users }, config: {},
    systemPreferences: { SINGLETON_ID: 'system-preferences', getCollection: () => systems, ensureSystemPreferences: () => systems.findOne({ _id: 'system-preferences' }) }
  };
  return { store: createDailyLayoutStore(dependencies), dependencies, userDocs, systemDocs, failNextActivation() { failActivation = true; } };
}

test('User layouts persist both grids, all chart ordering and hidden charts without changing other preferences', async () => {
  const h = harness();
  for (const grid of ['3x2', '2x2']) {
    const result = await h.store.create('alice', 'user', { name: grid, layout: layout(grid) });
    assert.deepEqual(result.preferences.dashboardLayouts.experimentalDailyDashboard, layout(grid));
    assert.equal(result.preferences.defaultDailyDashboardLayout.id, result.layout.id);
    assert.equal(result.preferences.theme, 'dark');
    assert.deepEqual(result.preferences.dashboardLayouts.machineDashboard.summaryCardOrder, ['counts']);
    const loaded = await h.store.load('alice', { scope: 'user', id: result.layout.id });
    assert.deepEqual(loaded.layout.layout, layout(grid));
  }
  assert.equal((await h.store.list('alice')).layouts.length, 2);
  assert.equal((await h.store.list('bob')).layouts.length, 0);
});

test('shared layouts are visible to other users but never replace their current defaults', async () => {
  const h = harness();
  const saved = await h.store.create('alice', 'system', { name: 'Shared', layout: layout('2x2') });
  assert.equal((await h.store.list('bob')).layouts[0].scope, 'system');
  assert.equal(h.userDocs.get('bob').defaultDailyDashboardLayout, undefined);
  const loaded = await h.store.load('bob', { scope: 'system', id: saved.layout.id });
  assert.deepEqual(loaded.preferences.dashboardLayouts.experimentalDailyDashboard, layout('2x2'));
  await h.store.create('alice', 'user', { name: 'Private', layout: layout() });
  const privateLayout = (await h.store.list('alice')).layouts.find(entry => entry.scope === 'user');
  await assert.rejects(h.store.load('bob', { scope: 'user', id: privateLayout.id }), error => error.status === 404);
});

test('older User and System layouts load with missing charts appended hidden, preserving both grids and saved definitions', async () => {
  for (const scope of ['user', 'system']) {
    for (const grid of ['2x2', '3x2']) {
      const h = harness();
      const saved = await h.store.create('alice', scope, { name: 'Older layout', layout: layout(grid) });
      const owner = scope === 'user' ? h.userDocs.get('alice') : h.systemDocs.get('system-preferences');
      const entry = owner.dailyDashboardLayouts[saved.layout.id];
      const missing = entry.layout.chartOrder.filter(id => !entry.layout.chartVisibility[id]);
      entry.layout.chartOrder = entry.layout.chartOrder.filter(id => !missing.includes(id));
      for (const id of missing) delete entry.layout.chartVisibility[id];
      const oldDefinition = structuredClone(entry);

      // Startup and settings validation must also accept the older stored shape.
      if (scope === 'system') {
        assert.doesNotThrow(() => schema.utils.normalizePreferences({ logLevel: 'warn' }, owner));
      }
      const loaded = await h.store.load('alice', { scope, id: entry.id });
      const normalized = loaded.preferences.dashboardLayouts.experimentalDailyDashboard;
      assert.deepEqual(normalized.chartOrder, [...oldDefinition.layout.chartOrder, ...chartIds.filter(id => missing.includes(id))]);
      assert.equal(normalized.gridLayout, grid);
      assert.equal(Object.values(normalized.chartVisibility).filter(Boolean).length, grid === '2x2' ? 4 : 6);
      for (const id of missing) assert.equal(normalized.chartVisibility[id], false);
      assert.deepEqual(loaded.layout.layout, normalized);
      assert.deepEqual(entry, oldDefinition);
    }
  }
});

test('normalized names reject duplicates atomically, while the same name in different scopes is allowed', async () => {
  const h = harness();
  const results = await Promise.allSettled([
    h.store.create('alice', 'system', { name: '  Daily   View ', layout: layout() }),
    h.store.create('bob', 'system', { name: 'daily view', layout: layout('2x2') })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  await h.store.create('alice', 'user', { name: 'daily view', layout: layout() });
  assert.equal((await h.store.list('alice')).layouts.length, 2);
});

test('invalid charts, flags, visible counts, grids, names and references cannot mutate preferences', async () => {
  const h = harness(), before = structuredClone(h.userDocs.get('alice'));
  const invalid = [null, {}, { ...layout(), gridLayout: '4x4' },
    { ...layout(), chartOrder: [...chartIds.slice(1), chartIds[1]] },
    { ...layout(), chartOrder: [...chartIds.slice(1), 'unknown'] },
    { ...layout(), chartVisibility: { ...layout().chartVisibility, unknown: false } },
    { ...layout(), chartVisibility: { ...layout().chartVisibility, 'machine-status': 'true' } },
    { ...layout(), chartVisibility: { ...layout().chartVisibility, 'daily-counts': true } },
    { ...layout(), chartVisibility: {} }];
  for (const invalidLayout of invalid) await assert.rejects(h.store.create('alice', 'user', { name: 'Invalid', layout: invalidLayout }), error => error.status === 400);
  for (const name of ['', '   ', 'x'.repeat(81)]) await assert.rejects(h.store.create('alice', 'user', { name, layout: layout() }), error => error.status === 400);
  for (const ref of [null, { scope: 'other', id: 'abc' }, { scope: 'user', id: '$where' }]) await assert.rejects(h.store.load('alice', ref), error => error.status === 400);
  assert.deepEqual(h.userDocs.get('alice'), before);
});

test('partial System create failures can activate the saved layout without creating a duplicate', async () => {
  const h = harness(); h.failNextActivation(); let reference;
  await assert.rejects(h.store.create('alice', 'system', { name: 'Shared', layout: layout() }), error => {
    reference = error.createdLayoutRef; return error.status === 503 && !!reference;
  });
  const result = await h.store.load('alice', reference);
  assert.deepEqual(result.preferences.defaultDailyDashboardLayout, reference);
  assert.equal((await h.store.list('alice')).layouts.length, 1);
});

test('system preference normalization and startup migrations preserve independently managed daily libraries', async () => {
  const h = harness(); const saved = await h.store.create('alice', 'system', { name: 'Saved', layout: layout() });
  const existing = h.systemDocs.get('system-preferences');
  const normalized = schema.utils.normalizePreferences({ logLevel: 'warn' }, existing);
  assert.deepEqual(normalized.dailyDashboardLayouts[saved.layout.id].layout, layout());
  const updates = [];
  await systemModule.ensureSystemPreferences({ collection: () => ({ findOne: async () => existing, updateOne: async (filter, update) => updates.push(update) }) }, {});
  assert.equal(Object.hasOwn(updates[0].$set, 'dailyDashboardLayouts'), false);
});

test('daily routes require an authenticated account and the production screens’ level-7 permission', async () => {
  const h = harness(), routes = new Map();
  const router = { get: (path, ...handlers) => routes.set('GET ' + path, handlers), post: (path, ...handlers) => routes.set('POST ' + path, handlers) };
  registerDailyLayoutRoutes(router, { ...h.dependencies,
    requireUser: (req, res, next) => req.authUserId ? next() : res.status(401).json({ error: 'Missing token' }),
    requirePermissionLevel: level => (req, res, next) => req.level <= level ? next() : res.status(403).json({ error: 'Insufficient permissions' })
  });
  async function request(path, req) {
    let status = 200, body;
    const res = { set() {}, status: value => (status = value, res), json: value => (body = value, res) };
    for (const handler of routes.get(path)) {
      if (body !== undefined) break;
      await handler(req, res, error => { if (error) { status = error.status || 500; body = {}; } });
    }
    return { status, body };
  }
  assert.equal((await request('GET /daily-layouts', {})).status, 401);
  assert.equal((await request('GET /daily-layouts', { authUserId: 'alice', level: 7, tokenPayload: { bypassed: true } })).status, 401);
  assert.equal((await request('POST /daily-layouts/system', { authUserId: 'alice', level: 8 })).status, 403);
  assert.equal((await request('POST /daily-layouts/system', { authUserId: 'alice', level: 7, body: { name: 'Shared', layout: layout() } })).status, 200);
});
