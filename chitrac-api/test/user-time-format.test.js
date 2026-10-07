const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');

function harness() {
  const routes = new Map();
  const users = new Map([['alice', { userId: 'alice', theme: 'dark' }]]);
  const collection = {
    async createIndex() {},
    async findOne({ userId }) { return users.get(userId) || null; },
    async updateOne({ userId }, { $set }) { users.set(userId, { ...users.get(userId), ...$set }); },
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

test('saves user time format without overwriting theme or another user', async () => {
  const h = harness();
  const saved = await h.request('put', 'alice', { timeFormat: '24h' });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.timeFormat, '24h');
  assert.equal(saved.payload.theme, 'dark');
  assert.equal((await h.request('get', 'bob')).payload.timeFormat, undefined);
  assert.equal((await h.request('get', 'alice')).payload.timeFormat, '24h');
});

test('accepts both formats and rejects malformed values without changing the saved preference', async () => {
  const h = harness();
  assert.equal((await h.request('put', 'alice', { timeFormat: '12h' })).status, 200);
  for (const timeFormat of ['invalid', null, true, 24, {}]) {
    assert.equal((await h.request('put', 'alice', { timeFormat })).status, 400);
  }
  assert.equal(h.users.get('alice').timeFormat, '12h');
});

test('does not allow anonymous preference updates', async () => {
  const h = harness();
  assert.equal((await h.request('put', null, { timeFormat: '24h' })).status, 401);
  assert.equal(h.users.get('alice').timeFormat, undefined);
});
