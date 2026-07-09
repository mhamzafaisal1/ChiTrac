const { MongoClient } = require('mongodb');
const Ajv = require('ajv');
const config = require('../modules/config');
const machineSchema = require('../schemas/machine');
const ipAddressSchema = require('../schemas/ipAddress');
const timestampsSchema = require('../schemas/timestampsSchema');
const ajv = new Ajv({ strictSchema: false });
const validateMachine = ajv.compile(machineSchema.schema);

function toAddressArray(value) {
  if (Array.isArray(value) && value.length) {
    return [...new Set(value.map(Number).filter(Number.isInteger))]
      .filter((entry) => entry > 0)
      .sort((a, b) => a - b);
  }

  const count = Number(value);
  if (Number.isInteger(count) && count > 0) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  return [1];
}

function toIpAddress(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return ipAddressSchema.utils.initIPAddress(
      Number(value.firstOctet),
      Number(value.secondOctet),
      Number(value.thirdOctet),
      Number(value.fourthOctet)
    );
  }

  const octets = String(value || '0.0.0.0').split('.').map(Number);
  return ipAddressSchema.utils.initIPAddress(
    octets[0] || 0,
    octets[1] || 0,
    octets[2] || 0,
    octets[3] || 0
  );
}

function inferType(doc) {
  const normalizedName = String(doc.name || '').toUpperCase();
  if (doc.type) return doc.type;
  if (normalizedName.startsWith('SPF')) return 'SPF';
  if (normalizedName.startsWith('CASCADE')) return 'Cascade';
  if (normalizedName.startsWith('LPL')) return 'LPL';
  if (normalizedName.startsWith('BLANKET')) return 'Blanket';
  if (normalizedName.startsWith('SPL')) return 'SPL';
  return 'Unknown';
}

function normalizeGroups(groups) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return undefined;
  }

  const normalized = {};
  ['area', 'category', 'department'].forEach((key) => {
    if (typeof groups[key] === 'string' && groups[key].trim()) {
      normalized[key] = groups[key].trim();
    }
  });

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeTimestamps(timestamps) {
  const now = new Date();
  if (!timestamps) return timestampsSchema.utils.stampInit(now);

  const create = timestamps.create ? new Date(timestamps.create) : now;
  const active = timestamps.active ? new Date(timestamps.active) : create;
  const normalized = timestampsSchema.utils.stampUpdate(
    { create, active },
    now
  );

  if (timestamps.start) normalized.start = new Date(timestamps.start);
  if (timestamps.end) normalized.end = new Date(timestamps.end);
  if (timestamps.inactive) normalized.inactive = new Date(timestamps.inactive);

  return normalized;
}

function normalizeMachine(doc) {
  const id = Number(doc.id ?? doc.serial);
  if (!Number.isInteger(id)) {
    throw new Error(`Machine ${doc._id} is missing an integer id/serial`);
  }

  const normalized = {
    _id: doc._id,
    id,
    active: doc.active !== false,
    name: String(doc.name || '').trim(),
    timestamps: normalizeTimestamps(doc.timestamps),
    ipAddress: toIpAddress(doc.ipAddress),
    lanes: toAddressArray(doc.lanes),
    type: inferType(doc),
    polled: doc.polled === true
  };

  normalized.stations = toAddressArray(doc.stations || doc.lanes);

  if (typeof doc.simulated === 'boolean') {
    normalized.simulated = doc.simulated;
  }

  const groups = normalizeGroups(doc.groups);
  if (groups) {
    normalized.groups = groups;
  }

  const { _id, ...schemaDocument } = normalized;
  if (!validateMachine(schemaDocument)) {
    throw new Error(`Normalized machine ${doc._id} failed schema validation: ${ajv.errorsText(validateMachine.errors)}`);
  }

  return normalized;
}

async function main() {
  const client = new MongoClient(config.mongo.connectionString);
  await client.connect();

  try {
    const db = client.db();
    const collection = db.collection(config.machineCollectionName);
    const docs = await collection.find({}).toArray();
    let modified = 0;

    for (const doc of docs) {
      const normalized = normalizeMachine(doc);
      await collection.replaceOne({ _id: doc._id }, normalized);
      modified += 1;
    }

    console.log(JSON.stringify({
      collection: config.machineCollectionName,
      scanned: docs.length,
      modified
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = {
  normalizeMachine
};
