const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { controllers, controllerIds, validateAllowedControllers, migrateApiTokenControllerAccess } = require('../modules/apiTokenControllers');
const { createApiControllerAccess, canonicalPath, controllerForPath } = require('../utils/apiControllerAccess');
const { createVerifyJwtMiddleware } = require('../utils/authMiddleware');
const authController = require('../controllers/auth');

const adminId = new ObjectId();
const tokenId = new ObjectId();
const user = { _id: adminId, active: true, permissions: { level: 1 }, local: { username: 'admin' } };
let tokenDoc, permanent, base, listener, usageUpdates = 0;
const original = { jwtSecret: config.jwtSecret, enableApiTokenCheck: config.enableApiTokenCheck };
const collection = {
  async findOne(query) {
    if (!tokenDoc) return null;
    if (query._id) return String(query._id) === String(tokenDoc._id) ? tokenDoc : null;
    return query.name === tokenDoc.name && (!query.createdBy || query.createdBy === tokenDoc.createdBy) &&
      (!query.isActive || tokenDoc.isActive) ? tokenDoc : null;
  },
  find() { return { sort: () => ({ toArray: async () => tokenDoc ? [tokenDoc] : [] }) }; },
  async insertOne(doc) { tokenDoc = { ...doc, _id: tokenId }; return { insertedId: tokenId }; },
  async updateOne(filter, update) {
    if (!tokenDoc || String(filter._id) !== String(tokenDoc._id) || (filter.isActive && !tokenDoc.isActive)) {
      return { matchedCount: 0 };
    }
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key === 'timestamps.update') tokenDoc.timestamps.update = value;
      else tokenDoc[key] = value;
    }
    if (update.$inc?.usageCount) { tokenDoc.usageCount++; usageUpdates++; }
    return { matchedCount: 1 };
  }
};
const server = {
  passport: new (require('passport').Passport)(),
  db: { collection: name => name === 'auth-tokens' ? collection : { findOne: async query =>
    String(query._id) === String(adminId) ? user : null } },
  logger: { error() {}, info() {} }
};
function userToken() { return jwt.sign({ userId: String(adminId) }, config.jwtSecret); }
async function request(path, token = permanent, method = 'GET', body, header = 'authorization') {
  const headers = { 'content-type': 'application/json' };
  if (token) headers[header] = header === 'authorization' ? `Bearer ${token}` : token;
  return fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function resetToken(allowedControllers = [...controllerIds]) {
  permanent = jwt.sign({ type: 'permanent', name: 'integration', createdBy: String(adminId), allowedControllers: [...controllerIds] }, config.jwtSecret);
  tokenDoc = { _id: tokenId, name: 'integration', createdBy: String(adminId), isActive: true,
    allowedControllers, hashedToken: await bcrypt.hash(permanent, 4),
    timestamps: require('../schemas/timestampsSchema').utils.stampInit(new Date()), usageCount: 0 };
}
before(async () => {
  config.jwtSecret = 'controller-access-test-secret'; config.enableApiTokenCheck = true;
  await resetToken();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-test-session'] === 'active') {
      req.isAuthenticated = () => true;
      req.user = user;
    }
    next();
  });
  app.use('/api', createApiControllerAccess(server));
  require('../controllers/alpha').registerMachineXmlRoutes(app, server);
  app.use('/api/auth', authController(server));
  const passportRoutes = require('../controllers/passport')(server);
  app.use('/api/passport', (req, res, next) => {
    if (req.method === 'GET' && req.path === '/user') return passportRoutes(req, res, next);
    return next();
  });
  app.get('/api/double-check', createVerifyJwtMiddleware(server), (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.json({ ok: true }));
  listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  base = `http://127.0.0.1:${listener.address().port}`;
});
after(async () => {
  Object.assign(config, original);
  listener.closeAllConnections();
  await new Promise(resolve => listener.close(resolve));
});

test('controller catalogue and schema reject unsupported, duplicate and malformed grants', () => {
  assert.deepEqual(controllers.map(c => c.label), ['General', 'Settings', 'Spindle', 'Milnor', 'Softrol']);
  for (const value of [undefined, null, 'general', {}, ['minor'], ['General'], ['general', 'general'], [1]]) {
    assert.equal(validateAllowedControllers(value), false);
  }
  assert.equal(validateAllowedControllers([]), true);
  assert.equal(validateAllowedControllers([...controllerIds]), true);
});
test('migration explicitly grants legacy records only and does not replace empty arrays', async () => {
  const records = [{}, { allowedControllers: [] }, { allowedControllers: null }];
  const db = { collection: name => {
    assert.equal(name, 'auth-tokens');
    return { updateMany: async (query, update) => {
      assert.deepEqual(query, { allowedControllers: { $exists: false } });
      let modifiedCount = 0;
      for (const record of records) if (!Object.hasOwn(record, 'allowedControllers')) {
        record.allowedControllers = update.$set.allowedControllers; modifiedCount++;
      }
      return { modifiedCount };
    } };
  } };
  await migrateApiTokenControllerAccess(db);
  await migrateApiTokenControllerAccess(db);
  assert.deepEqual(records, [{ allowedControllers: [...controllerIds] }, { allowedControllers: [] }, { allowedControllers: null }]);
});
test('scopes protect all five controller groups, aliases and mixed-case paths', async () => {
  const paths = { general: ['/machine/config', '/alpha/data', '/operator/config', '/item/config', '/reports/items', '/machine/1/xml'],
    settings: ['/preferences/system', '/system-preferences', '/utilities/admin'],
    spindle: ['/spindle/data'], milnor: ['/MiLnOr/data'], softrol: ['/softrol/data'] };
  for (const id of controllerIds) {
    await resetToken([id]);
    for (const [group, groupPaths] of Object.entries(paths)) for (const path of groupPaths) {
      const response = await request('/api' + path);
      assert.equal(response.status, group === id ? 200 : 403, `${id}: ${path}`);
    }
  }
});
test('empty and malformed database permissions fail closed even with forged JWT grants', async () => {
  for (const grants of [[], null, undefined, ['general', 'unknown'], 'general']) {
    await resetToken(grants);
    if (grants === undefined) delete tokenDoc.allowedControllers;
    assert.equal((await request('/api/machine/config')).status, 403);
  }
});
test('scope edits and token revocation take effect on the next request without regenerating JWT', async () => {
  await resetToken(['general']);
  assert.equal((await request('/api/machine/config')).status, 200);
  tokenDoc.allowedControllers = ['milnor'];
  assert.equal((await request('/api/machine/config')).status, 403);
  assert.equal((await request('/api/milnor/data')).status, 200);
  tokenDoc.isActive = false;
  assert.equal((await request('/api/milnor/data')).status, 401);
  tokenDoc.isActive = true; tokenDoc.timestamps.inactive = new Date();
  assert.equal((await request('/api/milnor/data')).status, 401);
  delete tokenDoc.timestamps.inactive; tokenDoc.hashedToken = await bcrypt.hash('another-token', 4);
  assert.equal((await request('/api/milnor/data')).status, 401);
});
test('all supported token header formats enforce the same scope and nested checks count once', async () => {
  await resetToken(['general']);
  for (const header of ['authorization', 'x-api-key', 'x-api-token', 'api-key', 'apikey']) {
    assert.equal((await request('/api/machine/config', permanent, 'GET', undefined, header)).status, 200);
    assert.equal((await request('/api/milnor/data', permanent, 'GET', undefined, header)).status, 403);
  }
  const before = usageUpdates;
  assert.equal((await request('/api/double-check')).status, 200);
  assert.equal(usageUpdates - before, 1);
});
test('directly registered machine XML route is protected and still returns XML for General', async () => {
  const url = '/api/machine/levelone/multilaneDemo/xml';
  await resetToken(['milnor']);
  assert.equal((await request(url)).status, 403);
  tokenDoc.allowedControllers = ['general'];
  const response = await request(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /xml/);
  assert.match(await response.text(), /<levelOne>/);
});
test('public bootstrap routes remain accessible while private API routes reject anonymous access', async () => {
  assert.equal((await request('/api/machine/config', null)).status, 200);
  for (const [method, path] of [['GET', '/utilities/settings'], ['POST', '/passport/user/login'],
    ['GET', '/passport/user/logout'], ['POST', '/users/password-reset/complete']]) {
    assert.equal((await request('/api' + path, null, method, method === 'POST' ? {} : undefined)).status, 200);
  }
  assert.equal((await request('/api/utilities/settings/other', null)).status, 401);
  assert.equal((await request('/api/passport/user/register', null, 'POST', {})).status, 401);
});

test('public display reads work anonymously without exposing settings or mutations', async () => {
  for (const path of ['/machine/analytics/machine-dashboard-daily-cached',
    '/machine/analytics/machines-summary-daily-cached', '/machine/analytics/shift-projection-window',
    '/operator/analytics/operators-summary-daily-cached', '/item/analytics/items-summary-daily-cache',
    '/dashboard/analytics/daily-summary-dashboard/machines', '/reports/shifts', '/operator/config',
    '/alpha/analytics/machine-hourly-states', '/fault/analytics/fault-sessions-history',
    '/reports/analytics/machine-report-cache', '/reports/analytics/operator-item-sessions-summary-cache',
    '/reports/analytics/item-sessions-summary-daily-cache', '/fault/analytics/fault-report-summary',
    '/fault/analytics/fault-report-detailed', '/reports/report-subscriptions',
    `/reports/report-subscriptions/${new ObjectId()}`]) {
    assert.equal((await request('/api' + path, null)).status, 200, path);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.equal((await request('/api' + path, null, method, {})).status, 401, `${method} ${path}`);
    }
  }
  for (const path of ['/auth/tokens', '/users', '/preferences/user', '/preferences/system',
    '/utilities/server-logs', '/alpha/shifts', '/alpha/repopulate-states',
    '/system-preferences', '/milnor/data', '/spindle/data', '/softrol/data',
    '/reports/report-subscriptions/not-an-id', '/reports/report-subscriptions/123/other',
    '/machine/analytics/unknown']) {
    assert.equal((await request('/api' + path, null)).status, 401, path);
  }
  assert.equal((await request('/api/reports/analytics/machine-report-email', null, 'POST', {})).status, 401);
});

test('public display endpoints still enforce supplied token validity and controller scope', async () => {
  const path = '/api/machine/analytics/machine-dashboard-daily-cached';
  await resetToken([]);
  for (const header of ['authorization', 'x-api-key', 'x-api-token', 'api-key', 'apikey']) {
    assert.equal((await request(path, permanent, 'GET', undefined, header)).status, 403);
  }
  assert.equal((await request(`${path}?token=${encodeURIComponent(permanent)}`, null)).status, 403);
  tokenDoc.allowedControllers = ['general'];
  assert.equal((await request(path)).status, 200);
  tokenDoc.isActive = false;
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, 'invalid-token')).status, 401);
  await resetToken();
});
test('valid interactive users retain access; inactive, missing and fabricated user identities do not', async () => {
  assert.equal((await request('/api/milnor/data', userToken())).status, 200);
  user.active = false;
  assert.equal((await request('/api/machine/config', userToken())).status, 401);
  user.active = true;
  for (const payload of [{ userId: 'test-user-id' }, { userId: String(new ObjectId()) }, { type: 'other', userId: String(adminId) }]) {
    assert.equal((await request('/api/machine/config', jwt.sign(payload, config.jwtSecret))).status, 401);
  }
});

test('current user restores a valid login token without a Passport session', async () => {
  const response = await request('/api/passport/user', userToken());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.username, user.local.username);
  assert.deepEqual(body.user.permissions, user.permissions);
  assert.equal(body.user.password, undefined);
  assert.equal((await request('/api/reports/shifts', userToken())).status, 200);
});

test('current user rejects anonymous, expired, inactive and permanent-token identities', async () => {
  assert.equal((await request('/api/passport/user', null)).status, 401);
  const expired = jwt.sign({ userId: String(adminId) }, config.jwtSecret, { expiresIn: -1 });
  assert.equal((await request('/api/passport/user', expired)).status, 401);
  assert.equal((await request('/api/passport/user', permanent)).status, 401);
  user.active = false;
  try {
    assert.equal((await request('/api/passport/user', userToken())).status, 401);
  } finally { user.active = true; }
});

test('current user retains cookie-session authentication without a login token', async () => {
  const response = await fetch(base + '/api/passport/user', { headers: { 'x-test-session': 'active' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, user.local.username);
});
test('authenticated Passport sessions work without Bearer credentials, including nested admin checks', async () => {
  const response = await fetch(base + '/api/auth/tokens', { headers: { 'x-test-session': 'active' } });
  assert.equal(response.status, 200);
  user.active = false;
  try {
    assert.equal((await fetch(base + '/api/machine/config', { headers: { 'x-test-session': 'active' } })).status, 401);
  } finally { user.active = true; }
});
test('permanent tokens cannot manage tokens, mint user identities or edit users even with Settings access', async () => {
  await resetToken([...controllerIds]);
  for (const [method, path] of [['GET', '/auth/tokens'], ['POST', '/auth/createPermanentToken'],
    ['PUT', `/auth/tokens/${tokenId}/controllers`], ['POST', '/auth/generateTestToken'],
    ['PUT', '/users/me'], ['POST', '/passport/user/register']]) {
    assert.equal((await request('/api' + path, permanent, method, method === 'GET' ? undefined : {})).status, 403);
  }
});
test('admin controller updates validate input, retain secrets and timestamps, and serialize safe fields', async () => {
  await resetToken([]);
  const hash = tokenDoc.hashedToken;
  const created = tokenDoc.timestamps.create;
  const url = `/api/auth/tokens/${tokenId}/controllers`;
  for (const body of [{}, { allowedControllers: null }, { allowedControllers: ['minor'] },
    { allowedControllers: ['general', 'general'] }, { allowedControllers: [], isActive: true }]) {
    assert.equal((await request(url, userToken(), 'PUT', body)).status, 400);
  }
  const response = await request(url, userToken(), 'PUT', { allowedControllers: ['milnor', 'general'] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).allowedControllers, ['general', 'milnor']);
  assert.equal(tokenDoc.hashedToken, hash);
  assert.equal(tokenDoc.timestamps.create, created);
  const list = await (await request('/api/auth/tokens', userToken())).json();
  assert.deepEqual(list.controllers, controllers);
  assert.deepEqual(list.tokens[0].allowedControllers, ['general', 'milnor']);
  assert.equal(list.tokens[0].hashedToken, undefined);
  user.permissions.level = 3;
  assert.equal((await request(url, userToken(), 'PUT', { allowedControllers: [] })).status, 403);
  user.permissions.level = 1;
  tokenDoc.isActive = false;
  assert.equal((await request(url, userToken(), 'PUT', { allowedControllers: [] })).status, 409);
  assert.equal((await request('/api/auth/tokens/not-an-id/controllers', userToken(), 'PUT', { allowedControllers: [] })).status, 400);
  assert.equal((await request(`/api/auth/tokens/${new ObjectId()}/controllers`, userToken(), 'PUT', { allowedControllers: [] })).status, 404);
});
test('new tokens have no access, ignoring attempted grants on creation', async () => {
  tokenDoc = null;
  const response = await request('/api/auth/createPermanentToken', userToken(), 'POST',
    { name: 'new-token', description: 'Integration', allowedControllers: ['general'] });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.deepEqual(created.tokenInfo.allowedControllers, []);
  assert.deepEqual(tokenDoc.allowedControllers, []);
  assert.equal((await request('/api/machine/config', created.token)).status, 403);
  tokenDoc.allowedControllers = ['general'];
  assert.equal((await request('/api/machine/config', created.token)).status, 200);
  const olderToken = jwt.sign({ type: 'permanent', name: 'new-token', createdBy: String(adminId) }, config.jwtSecret);
  assert.equal((await request('/api/machine/config', olderToken)).status, 401);
});
test('path normalization rejects ambiguous encodings and resolves exact group boundaries', () => {
  assert.equal(canonicalPath('/MiLnOr/data/'), '/milnor/data');
  assert.equal(controllerForPath('/milnor-other/data'), 'general');
  for (const path of ['/milnor%2fdata', '/%256dilnor/data', '/milnor//data', '/bad%ZZ']) {
    assert.throws(() => canonicalPath(path));
  }
});
test('explicit global authentication bypass remains supported', async () => {
  config.enableApiTokenCheck = false;
  try { assert.equal((await request('/api/machine/config', null)).status, 200); }
  finally { config.enableApiTokenCheck = true; }
});
