const systemPreferencesSchema = require('../schemas/system-preferences');

const SINGLETON_ID = 'system-preferences';

function getCollection(db, config = {}) {
  return db.collection(config.systemPreferencesCollectionName || 'system-preferences');
}

async function ensureSystemPreferences(db, config = {}) {
  const collection = getCollection(db, config);
  const existing = await collection.findOne({ _id: SINGLETON_ID });
  if (existing) return existing;

  const preferences = systemPreferencesSchema.utils.normalizePreferences({}, {}, config);
  const { _id, ...updates } = preferences;
  await collection.updateOne(
    { _id },
    { $set: updates, $setOnInsert: { _id } },
    { upsert: true }
  );

  return collection.findOne({ _id: SINGLETON_ID });
}

function applySystemPreferences(config, preferences = {}) {
  if (typeof preferences.systemName === 'string' && preferences.systemName.trim()) {
    config.systemName = preferences.systemName.trim();
  }

  if (typeof preferences.defaultTheme === 'string' && preferences.defaultTheme.trim()) {
    config.defaultTheme = preferences.defaultTheme.trim();
  }

  if (typeof preferences.logLevel === 'string' && preferences.logLevel.trim()) {
    config.logLevel = preferences.logLevel.trim();
  }

  if (typeof preferences.httpsEnabled === 'boolean') {
    config.httpsEnabled = preferences.httpsEnabled;
    config.httpsEnabledSource = 'system-preferences';
  } else {
    config.httpsEnabledSource = config.httpsEnabledEnvConfigured ? 'env' : 'default';
  }

  if (Array.isArray(preferences.userPermissionsLevels)) {
    config.userPermissionsLevels = preferences.userPermissionsLevels.map(label => `${label}`.trim());
  }

  config.systemPreferences = preferences;
  return config;
}

async function loadAndApplySystemPreferences(server) {
  const preferences = await ensureSystemPreferences(server.db, server.config);
  applySystemPreferences(server.config, preferences);
  server.systemPreferences = preferences;
  return preferences;
}

module.exports = {
  SINGLETON_ID,
  getCollection,
  ensureSystemPreferences,
  applySystemPreferences,
  loadAndApplySystemPreferences
};
