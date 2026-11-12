const { cloneDefaultDocuments } = require('../defaults/utils');

// Existing legacy site configuration takes precedence over bundled defaults.
// Do not create or seed the retired fault collection on a fresh installation.
async function initializeAlarms(db, config, defaults) {
  const alarms = db.collection(config.alarmCollectionName);
  const count = await alarms.estimatedDocumentCount();
  if (count > 0) return { collection: config.alarmCollectionName, status: 'skipped', count };
  const faults = await db.collection(config.faultCollectionName).find({}).toArray();
  const records = faults.length ? faults : cloneDefaultDocuments(defaults);
  if (!records.length) return { collection: config.alarmCollectionName, status: 'empty', count: 0 };
  await alarms.createIndex({ id: 1 }, { unique: true });
  // Upserts also make a retry or concurrent startup safe, without overwriting
  // alarms already copied by another process. Preserve source identifiers.
  await alarms.bulkWrite(records.map(record => ({ updateOne: {
    filter: { id: record.id },
    update: { $setOnInsert: { ...record, fault: true, stop: true } },
    upsert: true
  } })), { ordered: true });
  return { collection: config.alarmCollectionName, status: 'seeded', count: records.length,
    source: faults.length ? config.faultCollectionName : 'defaults' };
}

module.exports = { initializeAlarms };
