const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

function loadModule(file, overrides, environment = {}) {
  const filename = path.resolve(__dirname, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    process: { env: environment },
  }, { filename });
  return module.exports;
}

function createApp(environment = {}, permissionLevel = 7) {
  const config = {
    enableApiTokenCheck: true,
    jwtSecret: 'routes-cleanup-test-secret',
    userSessionExpirationHours: 8,
  };
  const userId = '507f1f77bcf86cd799439011';
  let saved = { _id: 'system-preferences', createdAt: 'legacy', updatedAt: 'legacy' };
  const systemCollection = {
    createIndex: async () => {},
    findOne: async () => saved,
    updateOne: async (filter, update) => {
      saved = { ...saved, ...update.$set };
      for (const key of Object.keys(update.$unset || {})) delete saved[key];
    },
  };
  const userCollection = {
    findOne: async () => ({ active: true, permissions: { level: permissionLevel } }),
  };
  const userPreferencesCollection = {
    createIndex: async () => {},
    findOne: async () => null,
  };
  const systemPreferences = {
    SINGLETON_ID: 'system-preferences',
    getCollection: () => systemCollection,
    ensureSystemPreferences: async () => saved,
    applySystemPreferences: () => {},
  };
  const preferencesFactory = loadModule('../controllers/preferences/index.js', {
    '../../modules/config': config,
    '../../modules/systemPreferences': systemPreferences,
  });
  const controllerFactory = name => () => {
    const router = express.Router();
    router.get('/', (req, res) => res.json({ controller: name }));
    return router;
  };
  const alphaFactory = controllerFactory('alpha');
  alphaFactory.registerMachineXmlRoutes = () => {};
  const controllers = ['machine', 'item', 'operator', 'status', 'softrol', 'milnor',
    'spindle', 'biko', 'auth', 'users', 'passport', 'history', 'utilities', 'jira',
    'dashboard', 'fault', 'reports'];
  const overrides = Object.fromEntries(controllers.map(name => [
    `../controllers/${name}`, controllerFactory(name),
  ]));
  overrides['../controllers/alpha'] = alphaFactory;
  overrides['../controllers/preferences'] = preferencesFactory;
  overrides['../utils/authMiddleware'] = {
    createVerifyJwtMiddleware: () => (req, res, next) => next(),
  };
  const routes = loadModule('../routes/index.js', overrides, environment);
  const app = express();
  app.use(express.json());
  const server = {
    appRoot: { path: path.resolve(__dirname, '..') },
    config: { softrol: true, milnor: true },
    logger: { error() {}, warn() {} },
    db: { collection: name => name === 'preferences-user' ? userPreferencesCollection : userCollection },
  };
  routes.init(app, server);
  return { app, config, userId, getSaved: () => saved };
}

async function withServer(app, callback) {
  const listener = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    await callback(`http://127.0.0.1:${listener.address().port}`);
  } finally {
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  }
}

test('canonical and legacy system preferences URLs share reads, writes, and reset behavior', async () => {
  const { app, config, userId, getSaved } = createApp();
  const token = jwt.sign({ userId }, config.jwtSecret);
  await withServer(app, async base => {
    for (const url of ['/api/preferences/system', '/api/preferences/system/config',
      '/api/system-preferences', '/api/system-preferences/config']) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200);
      assert.equal((await response.json())._id, 'system-preferences');
    }
    for (const [method, url, hours] of [
      ['PUT', '/api/system-preferences', 12],
      ['POST', '/api/preferences/system/config', 24],
    ]) {
      const response = await fetch(base + url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userSessionExpirationHours: hours }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).userSessionExpirationHours, hours);
      assert.equal(Object.hasOwn(getSaved(), 'createdAt'), false);
      assert.equal(Object.hasOwn(getSaved(), 'updatedAt'), false);
    }
    const response = await fetch(base + '/api/system-preferences/config', {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).userSessionExpirationHours, 8);
  });
});

test('system preferences writes require authentication and sufficient permission through either URL', async () => {
  const { app, config, userId } = createApp({}, 8);
  const token = jwt.sign({ userId }, config.jwtSecret);
  await withServer(app, async base => {
    for (const url of ['/api/preferences/system', '/api/system-preferences/config']) {
      assert.equal((await fetch(base + url, { method: 'PUT' })).status, 401);
      assert.equal((await fetch(base + url, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}` },
      })).status, 403);
    }
    assert.equal((await fetch(base + '/api/preferences/user')).status, 401);
  });
});

test('integration routes and documentation are enabled only by explicit true environment flags', async () => {
  for (const value of ['false', 'true']) {
    const { app } = createApp({ SPINDLE: value, MILNOR: value, SOFTROL: value });
    const docsPaths = app._router.stack.filter(layer => layer.route).map(layer => layer.route.path);
    await withServer(app, async base => {
      for (const name of ['spindle', 'milnor', 'softrol']) {
        const response = await fetch(base + `/api/${name}`);
        assert.equal(response.status, value === 'true' ? 200 : 404);
        assert.equal(docsPaths.includes(`/docs/api/${name}`), value === 'true');
      }
      for (const url of ['/api/machine/levelone/multilaneDemo/xml',
        '/api/machine/levelone/90001/xml', '/api/machine/leveltwo/90001/xml']) {
        assert.equal((await fetch(base + url)).status, 404);
      }
    });
  }
});
