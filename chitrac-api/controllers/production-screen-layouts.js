const express = require('express');
const config = require('../modules/config');
const systemPreferences = require('../modules/systemPreferences');
const { validateReference, stationLayout, problem } = require('../utils/productionLayouts');
const { configuredProductionStations } = require('../utils/spfLayout');

// Display reads deliberately do not activate a layout or return the owner's preferences.
function createProductionScreenLayoutStore({ db, config, systemPreferences }) {
  const systems = systemPreferences.getCollection(db, config);
  const users = db.collection(config.userPreferencesCollectionName || 'preferences-user');
  const compareNames = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const publicEntry = (entry, scope) => ({
    id: entry.id, name: entry.name, stationIds: entry.stationIds, createdAt: entry.createdAt, scope,
  });
  const readSystem = () => systems.findOne({ _id: systemPreferences.SINGLETON_ID });
  const readUser = userId => userId ? users.findOne({ userId }) : Promise.resolve(null);

  return {
    async list(userId) {
      const [system, user] = await Promise.all([readSystem(), readUser(userId)]);
      const entries = (library, scope) => Object.values(library || {})
        .map(entry => publicEntry(entry, scope))
        .sort((a, b) => compareNames.compare(a.name, b.name) || a.id.localeCompare(b.id));
      return { layouts: [
        ...entries(system?.productionScreenLayouts, 'system'),
        ...entries(user?.productionScreenLayouts, 'user'),
      ], defaultLayout: user?.defaultProductionScreenLayout || null };
    },
    async read(userId, reference) {
      reference = validateReference(reference);
      if (reference.scope === 'user' && !userId) throw problem(401, 'Log in to view your saved production layouts.');
      const owner = reference.scope === 'system' ? await readSystem() : await readUser(userId);
      const entry = owner?.productionScreenLayouts?.[reference.id];
      if (!entry) throw problem(404, 'This production layout is no longer available. Open the default production screen or choose another layout.');
      const machines = await db.collection(config.machineCollectionName || 'config-machine').find({ active: true }).toArray();
      const layout = stationLayout(entry.stationIds, configuredProductionStations(machines));
      return { layout: publicEntry(entry, reference.scope), stationLayout: layout };
    },
  };
}

function createProductionScreenLayoutRouter(dependencies) {
  const router = express.Router();
  const store = createProductionScreenLayoutStore(dependencies);
  const handle = action => async (req, res, next) => {
    // Only the interactive identity validated by the API middleware owns private layouts.
    // A permanent token's creator and caller-supplied userId are never used here.
    const userId = req.authUser?._id?.toString() || null;
    res.set('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    res.vary('Cookie');
    try { res.json(await action(store, userId, req)); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  router.get('/', handle((store, userId) => store.list(userId)));
  router.get('/:scope/:id', handle((store, userId, req) => store.read(userId, req.params)));
  return router;
}

module.exports = server => createProductionScreenLayoutRouter({ db: server.db, config, systemPreferences });
module.exports.createProductionScreenLayoutStore = createProductionScreenLayoutStore;
module.exports.createProductionScreenLayoutRouter = createProductionScreenLayoutRouter;
