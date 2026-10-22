/** Indexes shared by datafeed session updates and production totals rebuilds. */
async function ensureProductionIngestionIndexes(db, config) {
  const currentSessionKeys = {
    'machine.serial': 1,
    'timestamps.end': 1,
    'timestamps.start': 1,
    _id: 1,
  };
  const historyKeys = {
    'machine.serial': 1,
    'timestamps.start': 1,
    'timestamps.end': 1,
  };
  const collections = [
    config.machineSessionCollectionName,
    config.operatorSessionCollectionName,
    config.itemSessionCollectionName,
  ];
  await Promise.all([
    db.collection(config.totalsMinuteCollectionName).createIndex(
      { 'machine.id': 1, 'timestamps.start': 1 },
      { name: 'production_minute_bucket_by_machine' }
    ),
    ...collections.map(async (name, index) => {
      const collection = db.collection(name);
      await collection.createIndex(currentSessionKeys, { name: 'production_current_sessions_by_machine' });
      // Machine history already has a compatible index in analyticsIndexes.
      if (index > 0) {
        await collection.createIndex(historyKeys, { name: 'production_session_history_by_machine' });
      }
    }),
  ]);
}

module.exports = { ensureProductionIngestionIndexes };
