const defaults = require('../defaults');
const { cloneDefaultDocuments } = require('../defaults/utils');
const { initializeAlarms } = require('./initializeAlarms');

const DEFAULT_COLLECTION_NAMES = Object.freeze({
  machineCollectionName: 'config-machine',
  itemCollectionName: 'config-item',
  statusCollectionName: 'config-status',
  operatorCollectionName: 'config-operator',
  shiftCollectionName: 'config-shift',
  userCollectionName: 'config-user',
  alarmCollectionName: 'config-alarm',
  maintenanceShiftCollectionName: 'config-shift-maintenance',
  faultCollectionName: 'config-fault' // Read-only source for legacy alarm migration.
});

async function ensureCollection(db, name) {
  if (!(await db.listCollections({ name }).hasNext())) {
    try { await db.createCollection(name); }
    catch (error) {
      // Another process may have created it after the existence check.
      if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
    }
  }
  return db.collection(name);
}

function collectionNames(config) {
  const names = Object.fromEntries(Object.entries(DEFAULT_COLLECTION_NAMES)
    .map(([key, fallback]) => [key, config[key] ?? fallback]));
  for (const name of Object.values(names)) {
    if (typeof name !== 'string' || !/^config-[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error('Configuration collection names must start with config- and contain only lowercase letters, numbers and hyphens');
    }
  }
  if (new Set(Object.values(names)).size !== Object.keys(names).length) {
    throw new Error('Configuration collection names must be distinct');
  }
  return names;
}

// Pure database initialization shared by API startup and the standalone CLI.
// No server, logger connection, timers, runtime collections or preferences.
async function initializeConfigCollections(db, config = {}, { onResult = () => {}, onError } = {}) {
  const names = collectionNames(config);
  const results = [];
  async function initializeCollection(name, initialize) {
    let result;
    try { result = await initialize(); }
    catch (error) {
      // Standalone callers fail fast. API startup explicitly supplies a logger
      // callback to retain its per-collection best-effort initialization.
      if (!onError) throw error;
      onError(error, name);
      results.push({ collection: name, status: 'failed', error: error.message });
      return;
    }
    results.push(result);
    onResult(result);
  }
  for (const key of ['machine', 'item', 'status', 'operator', 'shift', 'user']) {
    const name = names[`${key}CollectionName`];
    await initializeCollection(name, async () => {
      const collection = await ensureCollection(db, name);
      const count = await collection.estimatedDocumentCount();
      if (count > 0) return { collection: name, status: 'skipped', count };
      const documents = cloneDefaultDocuments(defaults[key]);
      if (documents.length) await collection.insertMany(documents);
      return { collection: name, status: 'seeded', count: documents.length };
    });
  }

  await initializeCollection(names.alarmCollectionName, async () => {
    await ensureCollection(db, names.alarmCollectionName);
    return initializeAlarms(db, names, defaults.alarm);
  });

  await initializeCollection(names.maintenanceShiftCollectionName, async () => {
    const maintenance = await ensureCollection(db, names.maintenanceShiftCollectionName);
    const count = await maintenance.estimatedDocumentCount();
    return { collection: names.maintenanceShiftCollectionName,
      status: count > 0 ? 'skipped' : 'empty', count };
  });
  return results;
}

module.exports = { initializeConfigCollections, ensureCollection, DEFAULT_COLLECTION_NAMES };
