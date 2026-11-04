const Transport = require('winston-transport');
const os = require('node:os');
const timestampsSchema = require('../schemas/timestampsSchema');
const { sanitizeLogValue } = require('../utils/logSanitizer');

function logTimestamps(info) {
  const source = info.timestamps;
  return timestampsSchema.utils.stampInit(source?.create || new Date(), source?.start || null, source?.end || null);
}

function toLogDocument(info) {
  const { level, message, timestamp, timestamps, request, authentication, ...metadata } = info;
  const doc = {
    level, message: String(message ?? ''), timestamps: logTimestamps(info), hostname: os.hostname(),
    ...(request ? { request } : {}), ...(authentication ? { authentication } : {}),
    meta: metadata,
  };
  return sanitizeLogValue(doc);
}

function createLogFormat() {
  const { format } = require('winston');
  return format.combine(
    format.errors({ stack: true }),
    format(info => {
      Object.assign(info, sanitizeLogValue(info));
      info.timestamps = logTimestamps(info);
      delete info.timestamp;
      return info;
    })(),
    format.json()
  );
}

class MongoLogTransport extends Transport {
  constructor({ db, collection, ...options }) {
    super(options);
    this.collection = db.collection(collection);
  }

  log(info, callback) {
    let document;
    try { document = toLogDocument(info); }
    catch (error) { callback(error); return; }
    Promise.resolve().then(() => this.collection.insertOne(document)).then(() => {
      this.emit('logged', info);
      callback();
    }, callback);
  }
}

module.exports = { MongoLogTransport, toLogDocument, logTimestamps, createLogFormat };
