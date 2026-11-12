const { cloneDefaultDocuments } = require('../defaults/utils');

// Existing legacy site configuration takes precedence over bundled defaults.
// Do not create or seed the retired fault collection on a fresh installation.
async function initializeAlarms(db, config, defaults) {
  const alarms = db.collection(config.alarmCollectionName);
  if (await alarms.estimatedDocumentCount()) return;
  const faults = await db.collection(config.faultCollectionName).find({}).toArray();
  const records = faults.length ? faults : cloneDefaultDocuments(defaults);
  if (!records.length) return;
  await alarms.createIndex({ id: 1 }, { unique: true });
  // Upserts also make a retry or concurrent startup safe, without overwriting
  // alarms already copied by another process. Preserve source identifiers.
  await alarms.bulkWrite(records.map(record => ({ updateOne: {
    filter: { id: record.id },
    update: { $setOnInsert: { ...record, fault: true, stop: true } },
    upsert: true
  } })), { ordered: true });
}

module.exports = { initializeAlarms };
