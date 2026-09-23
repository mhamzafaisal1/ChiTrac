const CONFIG_COLLECTION_KEYS = Object.freeze([
  "machineCollectionName",
  "operatorCollectionName",
  "itemCollectionName",
  "faultCollectionName",
  "statusCollectionName",
  "userCollectionName",
  "shiftCollectionName",
  "maintenanceShiftCollectionName",
]);

function getConfigCollectionNames(config) {
  return [...new Set(
    CONFIG_COLLECTION_KEYS
      .map((key) => config?.[key])
      .filter((name) => typeof name === "string" && name.startsWith("config-"))
  )];
}

async function exportConfigCollection(db, config, collectionName, options = {}) {
  const allowedCollectionNames = getConfigCollectionNames(config);
  if (!allowedCollectionNames.includes(collectionName)) {
    const error = new Error(`Unsupported configuration collection: ${collectionName}`);
    error.code = "INVALID_CONFIG_COLLECTION";
    throw error;
  }

  const includeIds = options.includeIds === true;
  let cursor = db.collection(collectionName).find({}).sort({ _id: 1 });
  if (!includeIds) {
    cursor = cursor.project({ _id: 0 });
  }

  return cursor.toArray();
}

async function exportConfigCollections(db, config, options = {}) {
  const includeIds = options.includeIds === true;
  const collectionNames = getConfigCollectionNames(config);
  const entries = await Promise.all(
    collectionNames.map(async (collectionName) => {
      const documents = await exportConfigCollection(db, config, collectionName, { includeIds });
      return [collectionName, documents];
    })
  );

  return {
    exportedAt: new Date().toISOString(),
    includeIds,
    collections: Object.fromEntries(entries),
  };
}

function configExportFilename(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `chitrac-config-${stamp}.json`;
}

function configCollectionExportFilename(collectionName, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${collectionName}-${stamp}.json`;
}

module.exports = {
  CONFIG_COLLECTION_KEYS,
  configCollectionExportFilename,
  configExportFilename,
  exportConfigCollection,
  exportConfigCollections,
  getConfigCollectionNames,
};
