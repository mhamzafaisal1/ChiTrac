const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { tokenHashInput } = require('../utils/apiTokenHash');
const { createVerifyJwtMiddleware, createTokenAuditMiddleware } = require('../utils/authMiddleware');
const { createApiControllerAccess } = require('../utils/apiControllerAccess');
const { createRequestLoggingMiddleware } = require('../modules/requestLogging');
const timestamps = require('../schemas/timestampsSchema');
const original = { jwtSecret: config.jwtSecret, enableApiTokenCheck: config.enableApiTokenCheck };
const id = new ObjectId(), userId = new ObjectId();
let token, record, writes, lookups, logs, errors, failWrite, failLookup, listener, base;
const get = (obj, key) => key.split('.').reduce((o, part) => o?.[part], obj);
function set(obj, key, value) {
  const parts = key.split('.'); let target = obj;
  for (const part of parts.slice(0, -1)) target = target[part] ||= {};
  target[parts.at(-1)] = value;
}
const server = {
  logger: { http: doc => logs.push(doc), error: (...args) => errors.push(args) },
  db: { collection: name => name === 'auth-tokens' ? {
    async findOne(query) {
      lookups++;
      if (failLookup) throw new Error('DB unavailable');
      return query.name === record.name && query.createdBy === record.createdBy && record.isActive ? record : null;
    },
    async updateOne(query, update) {
      if (failWrite) throw new Error('Usage DB unavailable');
      writes++;
      assert.equal(String(query._id), String(id));
      for (const [key, value] of Object.entries(update.$set || {})) set(record, key, value);
      for (const [key, value] of Object.entries(update.$max || {})) {
        if (get(record, key) == null || get(record, key) < value) set(record, key, value);
      }
      record.usageCount = (record.usageCount || 0) + update.$inc.usageCount;
      return { matchedCount: 1 };
    },
  } : { findOne: async () => ({ _id: userId, active: true }) } },
};

before(async () => {
  config.jwtSecret = 'audit-test-secret';
  token = jwt.sign({ type: 'permanent', name: 'Spindle', createdBy: String(userId) }, config.jwtSecret);
  const app = express();
  app.use(createRequestLoggingMiddleware(server.logger));
  app.use(express.json());
  app.use('/api', createTokenAuditMiddleware(server));
  app.use('/api', createApiControllerAccess(server));
  app.get('/api/spindle/fail', (req, res) => res.status(500).json({ error: 'handler failed' }));
  app.get('/api/spindle/nested', createVerifyJwtMiddleware(server), createVerifyJwtMiddleware(server), (req, res) => res.json({ ok: true }));
  app.use((req, res) => res.json({ ok: true, bypassed: Boolean(req.tokenPayload?.bypassed) }));
  listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  base = `http://127.0.0.1:${listener.address().port}`;
});
beforeEach(async () => {
  config.enableApiTokenCheck = true;
  record = { _id: id, name: 'Spindle', createdBy: String(userId), isActive: true,
    allowedControllers: ['spindle'], hashedTokenVersion: 2,
    hashedToken: await bcrypt.hash(tokenHashInput(token, 2), 4), usageCount: 0,
    timestamps: timestamps.utils.stampInit(new Date('2026-09-01T00:00:00Z')) };
  writes = lookups = 0; logs = []; errors = []; failWrite = failLookup = false;
});
after(async () => {
  Object.assign(config, original);
  listener.closeAllConnections();
  await new Promise(resolve => listener.close(resolve));
});

async function request(path = '/api/spindle/data', credential = token, options = {}) {
  const res = await fetch(base + path, {
    headers: credential ? { authorization: `Bearer ${credential}` } : {}, ...options,
  });
  await res.text();
  return res;
}

test('attributes Spindle requests, stamps usage once through nested guards, and logs request outcome', async () => {
  const initial = structuredClone(record.timestamps);
  assert.equal((await request('/api/spindle/nested')).status, 200);
  assert.equal(writes, 1); assert.equal(lookups, 1); assert.equal(record.usageCount, 1);
  assert.ok(record.lastUsed instanceof Date);
  assert.deepEqual(record.timestamps.create, initial.create);
  assert.deepEqual(record.timestamps.active, initial.active);
  assert.equal(+record.timestamps.update, +record.lastUsed);
  const log = logs.at(-1);
  assert.deepEqual(log.authentication, { mode: 'token', credentialSupplied: true, result: 'verified',
    tokenId: String(id), tokenName: 'Spindle', usageRecorded: true });
  assert.equal(log.request.status, 200); assert.equal(log.request.aborted, false);
  assert.ok(log.request.durationMs >= 0);
  assert.ok(log.timestamps.start <= log.timestamps.end);
  assert.ok(!JSON.stringify(log).includes(token));
});

test('tracks supplied tokens in bypass mode without changing access for missing, invalid, or unscoped credentials', async () => {
  config.enableApiTokenCheck = false;
  assert.equal((await request('/api/milnor/data')).status, 200);
  assert.equal(writes, 1); assert.equal(logs.at(-1).authentication.mode, 'bypass');
  assert.equal((await request('/api/spindle/data', 'invalid-credential')).status, 200);
  assert.equal(writes, 1); assert.equal(logs.at(-1).authentication.result, 'invalid');
  assert.equal(logs.at(-1).authentication.tokenId, undefined);
  assert.equal((await request('/api/spindle/data', null)).status, 200);
  assert.equal(writes, 1); assert.equal(logs.at(-1).authentication.mode, 'bypass');
});

test('public bootstrap endpoints remain public but supplied verified tokens are audited', async () => {
  assert.equal((await request('/api/utilities/settings')).status, 200);
  assert.equal(writes, 1);
  assert.equal((await request('/api/utilities/settings', 'invalid-credential')).status, 200);
  assert.equal(logs.at(-1).authentication.result, 'invalid');
  assert.equal((await request('/api/utilities/settings', null)).status, 200);
  assert.equal(writes, 1);
});

test('counts verified credentials on 403 and 500 responses while recording their distinct outcomes', async () => {
  assert.equal((await request('/api/milnor/data')).status, 403);
  assert.equal(logs.at(-1).request.status, 403);
  assert.equal((await request('/api/spindle/fail')).status, 500);
  assert.equal(logs.at(-1).request.status, 500);
  assert.equal(writes, 2);
});

test('rejects invalid, expired, and revoked tokens without usage or unverified attribution', async () => {
  const forged = jwt.sign({ type: 'permanent', name: 'Spindle', createdBy: String(userId) }, 'other-secret');
  const expired = jwt.sign({ type: 'permanent', name: 'Spindle', createdBy: String(userId), exp: 1 }, config.jwtSecret);
  for (const credential of [forged, expired]) {
    assert.equal((await request('/api/spindle/data', credential)).status, 401);
    assert.equal(logs.at(-1).authentication.tokenId, undefined);
  }
  record.isActive = false;
  assert.equal((await request()).status, 401); assert.equal(writes, 0);
});

test('concurrent requests count once each and cannot move last-used or update timestamps backwards', async () => {
  const future = new Date('2099-01-01');
  record.lastUsed = future; record.timestamps.update = future;
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/api/spindle/nested')));
  assert.ok(responses.every(res => res.status === 200));
  assert.equal(record.usageCount, 8); assert.equal(writes, 8); assert.equal(lookups, 8);
  assert.equal(+record.lastUsed, +future); assert.equal(+record.timestamps.update, +future);
});

test('initializes legacy lifecycle dates without resetting existing usage', async () => {
  delete record.timestamps;
  record.createdAt = new Date('2026-09-01'); record.usageCount = 2;
  await request();
  assert.equal(record.usageCount, 3);
  assert.equal(+record.timestamps.create, +record.createdAt);
  assert.equal(+record.timestamps.active, +record.createdAt);
  assert.ok(record.timestamps.update instanceof Date);
});

test('usage persistence failures do not turn verified credentials into 401s and are visible in both logs', async () => {
  failWrite = true;
  assert.equal((await request()).status, 200);
  assert.equal(logs.at(-1).authentication.result, 'verified');
  assert.equal(logs.at(-1).authentication.usageRecorded, false);
  assert.equal(errors.length, 1); assert.equal(writes, 0);
});

test('authentication DB failure fails closed under enforcement and leaves explicit bypass intact', async () => {
  failLookup = true;
  assert.equal((await request()).status, 503);
  assert.equal(logs.at(-1).authentication.result, 'unavailable');
  config.enableApiTokenCheck = false;
  assert.equal((await request()).status, 200);
  assert.equal(logs.at(-1).authentication.tokenId, undefined);
});

test('supports query/body tokens and all documented headers without logging credentials', async () => {
  for (const name of ['x-api-key', 'x-api-token', 'api-key', 'apikey']) {
    await request('/api/spindle/data', null, { headers: { [name]: token } });
  }
  await request(`/api/spindle/data?token=${token}&search=anything`, null);
  await request('/api/spindle/data', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(writes, 6);
  assert.ok(logs.every(log => log.authentication.tokenId === String(id)));
  assert.ok(!JSON.stringify(logs).includes(token));
  assert.ok(!JSON.stringify(logs).includes('search=anything'));
});

test('interactive user JWTs and OPTIONS do not increment API token usage', async () => {
  const userToken = jwt.sign({ userId: String(userId) }, config.jwtSecret);
  assert.equal((await request('/api/spindle/data', userToken)).status, 200);
  assert.equal(logs.at(-1).authentication.userId, String(userId));
  assert.equal((await request('/api/spindle/data', token, { method: 'OPTIONS' })).status, 200);
  assert.equal(writes, 0);
});
