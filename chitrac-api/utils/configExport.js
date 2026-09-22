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

async function exportConfigCollections(db, config, options = {}) {
  const includeIds = options.includeIds === true;
  const collectionNames = getConfigCollectionNames(config);
  const entries = await Promise.all(
    collectionNames.map(async (collectionName) => {
      let cursor = db.collection(collectionName).find({}).sort({ _id: 1 });
      if (!includeIds) {
        cursor = cursor.project({ _id: 0 });
      }

      return [collectionName, await cursor.toArray()];
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

module.exports = {
  CONFIG_COLLECTION_KEYS,
  configExportFilename,
  exportConfigCollections,
  getConfigCollectionNames,
};
