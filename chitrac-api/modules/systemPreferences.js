const systemPreferencesSchema = require('../schemas/system-preferences');

const SINGLETON_ID = 'system-preferences';

function getCollection(db, config = {}) {
  return db.collection(config.systemPreferencesCollectionName || 'system-preferences');
}

async function ensureSystemPreferences(db, config = {}) {
  const collection = getCollection(db, config);
  const existing = await collection.findOne({ _id: SINGLETON_ID });
  if (existing) {
    const needsMigration =
      existing.userSessionExpirationHours === undefined ||
      !existing.timestamps?.create ||
      !existing.timestamps?.update ||
      Object.prototype.hasOwnProperty.call(existing, 'createdAt') ||
      Object.prototype.hasOwnProperty.call(existing, 'updatedAt');

    if (needsMigration) {
      const preferences = systemPreferencesSchema.utils.normalizePreferences({}, existing, config);
      const { _id, ...updates } = preferences;
      await collection.updateOne(
        { _id: SINGLETON_ID },
        {
          $set: updates,
          $unset: { createdAt: '', updatedAt: '' }
        }
      );
      return collection.findOne({ _id: SINGLETON_ID });
    }
    return existing;
  }

  const preferences = systemPreferencesSchema.utils.normalizePreferences({}, {}, config);
  const { _id, ...updates } = preferences;
  await collection.updateOne(
    { _id },
    {
      $set: updates,
      $setOnInsert: { _id },
      $unset: { createdAt: '', updatedAt: '' }
    },
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

  if (preferences.dashboardTimeframe === 'current' || preferences.dashboardTimeframe === 'shift') {
    config.dashboardTimeframe = preferences.dashboardTimeframe;
  } else {
    config.dashboardTimeframe = 'current';
  }

  if (preferences.percentBreakpoints) {
    config.percentBreakpoints = { ...preferences.percentBreakpoints };
  }

  if (preferences.oePercentBreakpoints) {
    config.oePercentBreakpoints = { ...preferences.oePercentBreakpoints };
  }

  if (Number.isFinite(Number(preferences.userSessionExpirationHours)) && Number(preferences.userSessionExpirationHours) > 0) {
    config.userSessionExpirationHours = Number(preferences.userSessionExpirationHours);
    config.userSessionExpirationMs = config.userSessionExpirationHours * 60 * 60 * 1000;
  }

  if (Array.isArray(preferences.userPermissionsLevels)) {
    config.userPermissionsLevels = preferences.userPermissionsLevels.map(label => `${label}`.trim());
  }

  if (Array.isArray(preferences.operatorPaceHandicap)) {
    config.operatorPaceHandicap = preferences.operatorPaceHandicap.map(rule => ({
      daysOfEmployment: Number(rule.daysOfEmployment),
      handicapFactor: Number(rule.handicapFactor)
    }));
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
