const LEGACY_SYSTEM_COLLECTION = 'system-preferences';
const LEGACY_USER_COLLECTION = 'user-preferences';

async function collectionExists(db, name) {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}

async function renameLegacyCollection(db, logger, legacyName, targetName) {
  if (legacyName === targetName || !(await collectionExists(db, legacyName))) {
    return;
  }

  if (await collectionExists(db, targetName)) {
    const legacyCollection = db.collection(legacyName);
    const targetCollection = db.collection(targetName);
    const legacyDocuments = await legacyCollection.find({}).toArray();
    let migratedCount = 0;

    for (const document of legacyDocuments) {
      const identity = document.userId !== undefined
        ? { userId: document.userId }
        : { _id: document._id };
      const result = await targetCollection.updateOne(
        identity,
        { $setOnInsert: document },
        { upsert: true }
      );
      migratedCount += result.upsertedCount || 0;
    }

    await legacyCollection.drop();
    logger.warn(`Merged ${legacyName} into ${targetName} and removed the legacy collection`, {
      legacyDocumentCount: legacyDocuments.length,
      migratedCount,
      retainedTargetCount: legacyDocuments.length - migratedCount
    });
    return;
  }

  await db.collection(legacyName).rename(targetName, { dropTarget: false });
  logger.info(`Renamed MongoDB collection ${legacyName} to ${targetName}`);
}

async function migratePreferenceCollections(db, config, logger) {
  const systemCollectionName = config.systemPreferencesCollectionName || 'preferences-system';
  const userCollectionName = config.userPreferencesCollectionName || 'preferences-user';

  await renameLegacyCollection(db, logger, LEGACY_SYSTEM_COLLECTION, systemCollectionName);
  await renameLegacyCollection(db, logger, LEGACY_USER_COLLECTION, userCollectionName);

  if (await collectionExists(db, userCollectionName)) {
    await db.collection(userCollectionName).updateMany(
      { 'dashboardLayouts.machineDashboard.pphDisplayMode': { $exists: true } },
      { $unset: { 'dashboardLayouts.machineDashboard.pphDisplayMode': '' } }
    );
  }
}

module.exports = {
  LEGACY_SYSTEM_COLLECTION,
  LEGACY_USER_COLLECTION,
  migratePreferenceCollections
};
