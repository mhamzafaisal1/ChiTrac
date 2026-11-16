const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { utils, assertValid } = require('../schemas/alarm');
const timestamps = require('../schemas/timestampsSchema').utils;
const { safeErrorMessage } = require('./init-config');
const definitions = require('../data/versa-alarms.json');

const COLLECTION = 'config-alarm-versa';
const OMITTED_IDS = new Set([24, 68, 85]);
const FIELDS = ['id', 'name', 'stop', 'fault', 'active', 'jam', 'color'];
const HELP = `Usage: npm run import:alarms:versa -- [--dry-run | --apply]

Defaults to an offline dry run: validates bundled definitions without connecting to MongoDB.
--apply imports into config-alarm-versa using MONGO_CONN_STRING with an explicit database.
Loads chitrac-api/.env; existing environment variables take precedence.
Inserts missing IDs only. Identical records are preserved; conflicts abort the import.
Does not change config-alarm, application routes, or startup initialization.`;

function buildRecords(source, now = new Date()) {
  if (!Array.isArray(source) || !source.length) throw new Error('Alarm definitions must be a nonempty array');
  const ids = new Set();
  return source.map((row, index) => {
    if (!row || Object.keys(row).sort().join(',') !== 'id,name,stop' ||
        !Number.isSafeInteger(row.id) || row.id < 0 ||
        typeof row.stop !== 'boolean' || typeof row.name !== 'string' || !row.name.trim()) {
      throw new Error(`Invalid alarm definition at row ${index + 1}`);
    }
    if (OMITTED_IDS.has(row.id)) throw new Error(`Alarm ${row.id} is omitted pending BIKO clarification`);
    if (ids.has(row.id)) throw new Error(`Duplicate alarm ID ${row.id}`);
    ids.add(row.id);
    return utils.initAlarm(row.id, row.name, row.stop, row.stop, {
      active: true, jam: 0, color: row.stop ? 'Red' : 'Yellow',
      timestamps: timestamps.stampInit(now)
    });
  });
}

function assertMatching(existing, expected) {
  const { _id, ...record } = existing;
  assertValid(record);
  for (const field of FIELDS) {
    if (!isDeepStrictEqual(record[field], expected[field])) {
      throw new Error(`Existing alarm ${expected.id} conflicts on ${field}; no existing records will be overwritten`);
    }
  }
  for (const field of ['create', 'active', 'update']) {
    if (!(record.timestamps[field] instanceof Date) || Number.isNaN(record.timestamps[field].getTime())) {
      throw new Error(`Existing alarm ${expected.id} has an invalid ${field} timestamp`);
    }
  }
}

async function importRecords(db, records) {
  const collection = db.collection(COLLECTION);
  const filter = { id: { $in: records.map(record => record.id) } };
  const existing = await collection.find(filter).toArray();
  const byId = new Map();
  for (const row of existing) {
    if (byId.has(row.id)) throw new Error(`Duplicate existing alarm ID ${row.id}`);
    byId.set(row.id, row);
  }
  for (const record of records) {
    if (byId.has(record.id)) assertMatching(byId.get(record.id), record);
  }
  await collection.createIndex({ id: 1 }, { unique: true });
  const missing = records.filter(record => !byId.has(record.id));
  if (missing.length) {
    await collection.bulkWrite(missing.map(record => ({ updateOne: {
      // Match values as well as ID so a concurrent conflicting insert cannot be silently accepted.
      filter: Object.fromEntries(FIELDS.map(field => [field, record[field]])),
      update: { $setOnInsert: record }, upsert: true
    } })), { ordered: true });
  }
  const stored = await collection.find(filter).toArray();
  if (stored.length !== records.length || new Set(stored.map(row => row.id)).size !== records.length) {
    throw new Error('Post-import alarm count verification failed');
  }
  const expected = new Map(records.map(record => [record.id, record]));
  for (const row of stored) assertMatching(row, expected.get(row.id));
  return { verified: stored.length, previouslyPresent: existing.length };
}

async function main({
  argv = process.argv.slice(2), env = process.env,
  loadEnv = options => require('dotenv').config(options),
  createClient = uri => new (require('mongodb').MongoClient)(uri, { serverSelectionTimeoutMS: 15000 }),
  log = message => console.log(message)
} = {}) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { log(HELP); return; }
  if (argv.length > 1 || (argv.length === 1 && !['--dry-run', '--apply'].includes(argv[0]))) {
    throw new Error('Unsupported arguments. Run with --help for usage.');
  }
  const records = buildRecords(definitions);
  log(`${COLLECTION}: validated ${records.length} alarms (${records.filter(row => row.stop).length} stopping, ${records.filter(row => !row.stop).length} non-stopping). Omitted IDs: 24, 68, 85.`);
  if (argv[0] !== '--apply') { log('Dry run complete. No database connection or writes.'); return records; }
  loadEnv({ path: path.resolve(__dirname, '..', '.env'), processEnv: env });
  const uri = env.MONGO_CONN_STRING?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\/[^/?]+\/[^/?]+(?:\?.*)?$/.test(uri)) {
    throw new Error('MONGO_CONN_STRING must be a MongoDB URI with an explicit database name');
  }
  const client = createClient(uri);
  try {
    await client.connect();
    const db = client.db();
    log(`Importing into database "${db.databaseName}", collection "${COLLECTION}"`);
    const result = await importRecords(db, records);
    log(`Verified ${result.verified} alarms; ${result.previouslyPresent} were already present. Existing records were preserved.`);
    return result;
  } finally { await client.close(); }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Versa alarm import failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { buildRecords, importRecords, main, COLLECTION };
