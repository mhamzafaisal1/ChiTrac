const { normalizeName, validateReference, problem } = require('../../utils/productionLayouts');
const { sanitizeDailyLayout } = require('../../utils/dailyDashboardLayouts');

function createDailyLayoutStore({ db, config, systemPreferences }) {
  const users = db.collection(config.userPreferencesCollectionName || 'preferences-user');
  const systems = systemPreferences.getCollection(db, config);

  async function ensureUser(userId) {
    const now = new Date();
    try {
      await users.updateOne({ userId }, {
        $setOnInsert: { userId, timestamps: { create: now, active: now, update: now } }
      }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }

  function activationUpdates(reference, layout) {
    return {
      'dashboardLayouts.experimentalDailyDashboard': layout,
      defaultDailyDashboardLayout: reference,
      'timestamps.update': new Date()
    };
  }

  async function activate(userId, reference, entry, layout) {
    await ensureUser(userId);
    const result = await users.updateOne({ userId }, { $set: activationUpdates(reference, layout) });
    if (!result.matchedCount) throw problem(503, 'Could not save your default layout. Please try again.');
    return { layout: { ...entry, layout, scope: reference.scope }, preferences: await users.findOne({ userId }) };
  }

  return {
    async list(userId) {
      const [system, user] = await Promise.all([
        systemPreferences.ensureSystemPreferences(db, config), users.findOne({ userId })
      ]);
      const entries = (library, scope) => Object.values(library || {}).map(entry => ({ ...entry, scope }));
      return {
        layouts: [...entries(system?.dailyDashboardLayouts, 'system'), ...entries(user?.dailyDashboardLayouts, 'user')]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.scope.localeCompare(b.scope)),
        defaultLayout: user?.defaultDailyDashboardLayout || null
      };
    },
    async load(userId, reference) {
      try { reference = validateReference(reference); }
      catch { throw problem(400, 'Select a valid daily layout.'); }
      const owner = reference.scope === 'system'
        ? await systemPreferences.ensureSystemPreferences(db, config)
        : await users.findOne({ userId });
      const entry = owner?.dailyDashboardLayouts?.[reference.id];
      if (!entry) throw problem(404, 'This daily layout is no longer available. Refresh the list and choose another layout.');
      return activate(userId, reference, entry, sanitizeDailyLayout(entry.layout));
    },
    async create(userId, scope, input) {
      if (!['user', 'system'].includes(scope)) throw problem(400, 'Choose User or System.');
      const { id, name } = normalizeName(input?.name);
      const layout = sanitizeDailyLayout(input?.layout);
      const entry = { id, name, layout, createdAt: new Date().toISOString() };
      const reference = { scope, id };
      const path = 'dailyDashboardLayouts.' + id;
      if (scope === 'system') await systemPreferences.ensureSystemPreferences(db, config);
      else await ensureUser(userId);
      const collection = scope === 'system' ? systems : users;
      const identity = scope === 'system' ? { _id: systemPreferences.SINGLETON_ID } : { userId };
      const updates = { [path]: entry, 'timestamps.update': new Date() };
      if (scope === 'user') Object.assign(updates, activationUpdates(reference, layout));
      // A conditional update also prevents simultaneous creates from replacing a saved definition.
      const result = await collection.updateOne({ ...identity, [path]: { $exists: false } }, { $set: updates });
      if (!result.matchedCount) throw problem(409, 'A layout with this name already exists in ' +
        (scope === 'system' ? 'System layouts.' : 'your User layouts.') + ' Choose another name.');
      if (scope === 'user') return { layout: { ...entry, scope }, preferences: await users.findOne({ userId }) };
      try {
        return await activate(userId, reference, entry, layout);
      } catch (error) {
        throw Object.assign(problem(503, 'The System layout was created, but could not be made your default. Retry to load it.'), {
          createdLayoutRef: reference
        });
      }
    }
  };
}

function registerDailyLayoutRoutes(router, dependencies) {
  const { requireUser, requirePermissionLevel } = dependencies;
  const store = createDailyLayoutStore(dependencies);
  const authenticate = (req, res, next) => {
    if (req.tokenPayload?.bypassed || !req.authUserId) {
      return res.status(401).json({ error: 'Log in to use saved daily layouts.' });
    }
    next();
  };
  const handle = action => async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.json(await action(req)); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, ...(error.createdLayoutRef ? { createdLayoutRef: error.createdLayoutRef } : {}) });
      next(error);
    }
  };
  const access = [requireUser, authenticate, requirePermissionLevel(7)];
  router.get('/daily-layouts', ...access, handle(req => store.list(req.authUserId)));
  router.post('/daily-layouts/user', ...access, handle(req => store.create(req.authUserId, 'user', req.body)));
  router.post('/daily-layouts/system', ...access, handle(req => store.create(req.authUserId, 'system', req.body)));
  router.post('/daily-layouts/load', ...access, handle(req => store.load(req.authUserId, req.body)));
}

module.exports = { createDailyLayoutStore, registerDailyLayoutRoutes };
