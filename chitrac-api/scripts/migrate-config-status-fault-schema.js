const { MongoClient } = require('mongodb');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const config = require('../modules/config');
const statusSchema = require('../schemas/status');
const timestampsSchema = require('../schemas/timestampsSchema');

const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);
const validate = ajv.compile(statusSchema.schema);

function normalizeTimestampObject(timestamps, now) {
  if (!timestamps || typeof timestamps !== 'object') {
    return timestampsSchema.utils.stampInit(now);
  }

  return {
    ...timestamps,
    update: now
  };
}

function normalizeStatus(doc, now = new Date()) {
  const normalized = {
    id: Number(doc.id ?? doc.code),
    active: doc.active !== undefined ? Boolean(doc.active) : true,
    timestamps: normalizeTimestampObject(doc.timestamps, now),
    name: String(doc.name ?? doc.description ?? 'Unknown')
  };

  if (doc.jam !== undefined && doc.jam !== null && doc.jam !== '') {
    normalized.jam = Number(doc.jam);
  }

  const color = doc.color ?? doc.softrolColor;
  if (color !== undefined && color !== null && color !== '') {
    normalized.color = String(color);
  }

  if (doc._id) {
    normalized._id = String(doc._id);
  }

  const valid = validate(normalized);
  if (!valid) {
    throw new Error(`Status ${doc._id ?? doc.id ?? doc.code} failed validation: ${ajv.errorsText(validate.errors)}`);
  }

  const { _id, ...replacement } = normalized;
  return replacement;
}

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const docs = await collection.find({}).toArray();
  let modified = 0;

  for (const doc of docs) {
    const replacement = normalizeStatus(doc);
    await collection.replaceOne({ _id: doc._id }, replacement);
    modified += 1;
  }

  return {
    collection: collectionName,
    scanned: docs.length,
    modified
  };
}

async function main() {
  const client = new MongoClient(config.mongo.connectionString, { serverSelectionTimeoutMS: 15000 });
  await client.connect();

  try {
    const db = client.db();
    const results = [];
    results.push(await migrateCollection(db, config.statusCollectionName));
    results.push(await migrateCollection(db, config.faultCollectionName));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = {
  normalizeStatus,
  migrateCollection
};
