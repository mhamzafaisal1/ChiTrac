const { MongoClient } = require('mongodb');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const config = require('../modules/config');
const itemCrudSchema = require('../schemas/itemCrudSchema');
const timestampsSchema = require('../schemas/timestampsSchema');

const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);
const validate = ajv.compile(itemCrudSchema);

function normalizeTimestampObject(timestamps, now) {
  if (!timestamps || typeof timestamps !== 'object') {
    return timestampsSchema.utils.stampInit(now);
  }

  return {
    ...timestamps,
    update: now
  };
}

function normalizeItem(doc, now = new Date()) {
  const normalized = {
    id: Number(doc.id ?? doc.number),
    active: doc.active !== undefined ? Boolean(doc.active) : true,
    timestamps: normalizeTimestampObject(doc.timestamps, now),
    name: String(doc.name ?? 'Unknown')
  };

  if (doc.standard !== undefined && doc.standard !== null && doc.standard !== '') {
    normalized.standard = Number(doc.standard);
  }

  if (doc.area !== undefined && doc.area !== null && doc.area !== '') {
    normalized.area = Number(doc.area);
  }

  if (doc.department !== undefined && doc.department !== null) {
    normalized.department = String(doc.department);
  }

  if (doc.photo !== undefined && doc.photo !== null && doc.photo !== '') {
    normalized.photo = String(doc.photo);
  }

  if (doc.weight !== undefined) {
    normalized.weight = doc.weight === null || doc.weight === '' ? null : Number(doc.weight);
  }

  if (doc._id) {
    normalized._id = String(doc._id);
  }

  const valid = validate(normalized);
  if (!valid) {
    throw new Error(`Item ${doc._id ?? doc.id ?? doc.number} failed validation: ${ajv.errorsText(validate.errors)}`);
  }

  const { _id, ...replacement } = normalized;
  return replacement;
}

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const docs = await collection.find({}).toArray();
  let modified = 0;

  for (const doc of docs) {
    const replacement = normalizeItem(doc);
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
    const result = await migrateCollection(db, config.itemCollectionName);
    console.log(JSON.stringify(result, null, 2));
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
  normalizeItem,
  migrateCollection
};
