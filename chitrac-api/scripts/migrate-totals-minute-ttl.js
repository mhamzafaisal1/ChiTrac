const RETENTION_SECONDS = 48 * 60 * 60;
const TTL_INDEX_NAME = 'totals_minute_update_ttl';

function singleFieldIndex(index, field) {
  return Object.keys(index.key).length === 1 && index.key[field] === 1;
}

async function migrateTotalsMinuteTtl(db, { apply = false, collectionName = 'totals-minute' } = {}) {
  const collection = db.collection(collectionName);
  let indexes;
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    if (error.code !== 26) throw error; // A fresh database has no collection yet.
    indexes = [];
  }
  const [recordsWithExpiresAt, invalidUpdateTimestamps] = await Promise.all([
    collection.countDocuments({ expiresAt: { $exists: true } }),
    collection.countDocuments({ $expr: { $ne: [{ $type: '$timestamps.update' }, 'date'] } }),
  ]);
  const legacyIndexes = indexes.filter(index =>
    singleFieldIndex(index, 'expiresAt') && index.expireAfterSeconds !== undefined
  );
  const updateIndex = indexes.find(index =>
    singleFieldIndex(index, 'timestamps.update') && !index.partialFilterExpression
  );
  const report = {
    apply, collection: collectionName, recordsWithExpiresAt, invalidUpdateTimestamps,
    ttlField: 'timestamps.update', retentionSeconds: RETENTION_SECONDS,
    ttlIndex: updateIndex?.name || TTL_INDEX_NAME,
    legacyTtlIndexes: legacyIndexes.map(index => index.name),
  };
  if (!apply) return report;
  if (invalidUpdateTimestamps > 0) {
    throw new Error('Migration stopped: totals-minute records need BSON Date timestamps.update values. No fields or indexes were changed.');
  }

  // Install the replacement before retiring any old TTL index or expiry fields.
  if (!updateIndex) {
    await collection.createIndex(
      { 'timestamps.update': 1 },
      { name: TTL_INDEX_NAME, expireAfterSeconds: RETENTION_SECONDS }
    );
  } else if (updateIndex.expireAfterSeconds !== RETENTION_SECONDS) {
    await db.command({
      collMod: collectionName,
      index: { name: updateIndex.name, expireAfterSeconds: RETENTION_SECONDS },
    });
  }
  for (const index of legacyIndexes) await collection.dropIndex(index.name);
  const result = await collection.updateMany(
    { expiresAt: { $exists: true } },
    { $unset: { expiresAt: '' } }
  );
  return { ...report, modifiedRecords: result.modifiedCount };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: node scripts/migrate-totals-minute-ttl.js [--apply]');
  }
  const config = require('../modules/config');
  if (!config.mongo?.connectionString?.trim()) throw new Error('MONGO_CONN_STRING is required');
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(config.mongo.connectionString.trim(), { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    console.log(JSON.stringify(await migrateTotalsMinuteTtl(client.db(), {
      apply: args.includes('--apply'), collectionName: config.totalsMinuteCollectionName,
    }), null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { migrateTotalsMinuteTtl, RETENTION_SECONDS, TTL_INDEX_NAME };
