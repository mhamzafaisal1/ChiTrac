const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { MongoClient } = require('mongodb');

const config = require('../modules/config');
const itemSchema = require('../schemas/itemCrudSchema');
const operatorSchema = require('../schemas/operator');
const shiftSchema = require('../schemas/shift');

const timestampKeys = ['create', 'active', 'update', 'start', 'end', 'inactive'];

const collections = [
  {
    name: config.operatorCollectionName,
    schema: operatorSchema.schema,
    normalizeForValidation: ({ _id, code, ...doc }) => ({
      ...doc,
      id: doc.id ?? code
    })
  },
  {
    name: config.itemCollectionName,
    schema: itemSchema,
    normalizeForValidation: (doc) => ({
      ...doc,
      _id: String(doc._id)
    })
  },
  {
    name: config.shiftCollectionName,
    schema: shiftSchema.schema,
    normalizeForValidation: (doc) => ({
      ...doc,
      _id: String(doc._id)
    })
  }
].filter(({ name }) => Boolean(name));

function toDate(value) {
  if (value === undefined || value === null) return value;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }

  return date;
}

function normalizeTimestamps(timestamps = {}) {
  const normalized = {};

  timestampKeys.forEach((key) => {
    if (timestamps[key] !== undefined && timestamps[key] !== null) {
      normalized[key] = toDate(timestamps[key]);
    }
  });

  return normalized;
}

function walkTimestampValues(doc, visitor) {
  if (doc?.timestamps) {
    timestampKeys.forEach((key) => {
      if (doc.timestamps[key] !== undefined && doc.timestamps[key] !== null) {
        visitor(doc.timestamps[key], `timestamps.${key}`);
      }
    });
  }

  if (Array.isArray(doc?.breaks)) {
    doc.breaks.forEach((shiftBreak, index) => {
      if (shiftBreak?.timestamps) {
        timestampKeys.forEach((key) => {
          if (shiftBreak.timestamps[key] !== undefined && shiftBreak.timestamps[key] !== null) {
            visitor(shiftBreak.timestamps[key], `breaks.${index}.timestamps.${key}`);
          }
        });
      }
    });
  }
}

function hasStringTimestamp(doc) {
  let found = false;
  walkTimestampValues(doc, (value) => {
    if (typeof value === 'string') found = true;
  });
  return found;
}

function allTimestampsAreDates(doc) {
  let valid = true;
  walkTimestampValues(doc, (value) => {
    if (!(value instanceof Date)) valid = false;
  });
  return valid;
}

async function main() {
  const client = new MongoClient(config.mongo.connectionString, {
    serverSelectionTimeoutMS: 15000
  });

  await client.connect();

  try {
    const db = client.db();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      process.cwd(),
      'backups',
      `alpha-config-timestamps-pre-bson-date-${stamp}.json`
    );
    const backup = {
      createdAt: new Date(),
      collections: {}
    };

    for (const { name } of collections) {
      backup.collections[name] = await db.collection(name).find({}).toArray();
    }

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

    const migrationResults = [];

    for (const { name } of collections) {
      const collection = db.collection(name);
      const docs = await collection.find({}).toArray();
      let modified = 0;

      for (const doc of docs) {
        const $set = {};

        if (doc.timestamps) {
          $set.timestamps = normalizeTimestamps(doc.timestamps);
        }

        if (name === config.shiftCollectionName && Array.isArray(doc.breaks)) {
          $set.breaks = doc.breaks.map((shiftBreak) => ({
            ...shiftBreak,
            ...(shiftBreak.timestamps
              ? { timestamps: normalizeTimestamps(shiftBreak.timestamps) }
              : {})
          }));
        }

        if (Object.keys($set).length > 0) {
          const result = await collection.updateOne({ _id: doc._id }, { $set });
          modified += result.modifiedCount;
        }
      }

      migrationResults.push({
        collection: name,
        scanned: docs.length,
        modified
      });
    }

    const ajv = new Ajv();
    const validationResults = [];

    for (const { name, schema, normalizeForValidation } of collections) {
      const collection = db.collection(name);
      const docs = await collection.find({}).toArray();
      const validate = ajv.compile(schema);
      const invalid = [];
      const stringTimestampIds = [];
      const nonDateTimestampIds = [];
      const shiftTimeFieldIds = [];

      docs.forEach((doc) => {
        if (!validate(normalizeForValidation(doc))) {
          invalid.push({
            _id: String(doc._id),
            errors: validate.errors
          });
        }

        if (hasStringTimestamp(doc)) {
          stringTimestampIds.push(String(doc._id));
        }

        if (!allTimestampsAreDates(doc)) {
          nonDateTimestampIds.push(String(doc._id));
        }

        if (name === config.shiftCollectionName && (doc.startTime !== undefined || doc.endTime !== undefined)) {
          shiftTimeFieldIds.push(String(doc._id));
        }
      });

      validationResults.push({
        collection: name,
        count: docs.length,
        invalid,
        stringTimestampIds,
        nonDateTimestampIds,
        shiftTimeFieldIds
      });
    }

    console.log(JSON.stringify({
      backupPath,
      migrationResults,
      validationResults
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
