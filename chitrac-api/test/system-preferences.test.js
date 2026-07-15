const assert = require('node:assert/strict');
const test = require('node:test');

const systemPreferencesSchema = require('../schemas/system-preferences');

test('normalizes default system preferences with Date timestamps', () => {
  const preferences = systemPreferencesSchema.utils.normalizePreferences({}, {}, {
    defaultTheme: 'dark',
    logLevel: 'info',
    userSessionExpirationHours: 48
  });

  assert.equal(preferences._id, 'system-preferences');
  assert.equal(preferences.schemaVersion, systemPreferencesSchema.utils.CURRENT_SCHEMA_VERSION);
  assert.ok(preferences.timestamps.create instanceof Date);
  assert.ok(preferences.timestamps.active instanceof Date);
  assert.ok(preferences.timestamps.update instanceof Date);
});
