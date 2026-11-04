const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { EventEmitter } = require('node:events');
const winston = require('winston');
const { ObjectId } = require('mongodb');
const { MongoLogTransport, createLogFormat } = require('../modules/mongoLogTransport');
const { sanitizeLogValue } = require('../utils/logSanitizer');
const { createRequestLoggingMiddleware } = require('../modules/requestLogging');
const { fetchServerLogs, getServerLogsCount, serverLogQuery } = require('../utils/serverLogs');
const { ensureLogIndexes } = require('../scripts/ensure-log-indexes');
const schema = require('../schemas/timestampsSchema');

test('actual Winston transport stores BSON timestamp subschema, request attribution and redacted metadata', async () => {
  const documents = [];
  const transport = new MongoLogTransport({ db: { collection: () => ({ insertOne: async doc => documents.push(doc) }) }, collection: 'api-http', level: 'http' });
  const logger = winston.createLogger({ format: createLogFormat(), transports: [transport] });
  const tokenId = new ObjectId();
  logger.http({ message: 'GET /api/spindle/data?%74oken=secret-query', request: { status: 200 },
    authentication: { tokenId: String(tokenId), tokenName: 'Spindle', mode: 'token', result: 'verified' },
    headers: { authorization: 'Bearer secret-header', 'x-api-key': 'secret-api-key' },
    payload: { token: 'secret-body', hashedToken: 'secret-hash' }, objectId: tokenId });
  logger.error(new Error('Failed /path?token=secret-error-query'));
  logger.end(); await once(logger, 'finish');
  assert.equal(documents.length, 2);
  for (const doc of documents) {
    assert.ok(doc.timestamps.create instanceof Date);
    assert.ok(doc.timestamps.active instanceof Date);
    assert.ok(doc.timestamps.update instanceof Date);
    assert.equal(+doc.timestamps.create, +doc.timestamps.active);
    assert.equal(+doc.timestamps.create, +doc.timestamps.update);
    assert.equal(doc.timestamp, undefined);
    assert.ok(doc.hostname);
    assert.ok(!JSON.stringify(doc).includes('secret-'));
  }
  assert.equal(documents[0].authentication.tokenName, 'Spindle');
  assert.equal(documents[0].authentication.tokenId, String(tokenId));
  assert.ok(documents[0].meta.objectId instanceof ObjectId);
  assert.ok(documents[1].meta.stack);
  logger.close();
});

test('Mongo transport reports failed writes through its callback', async () => {
  const error = new Error('database unavailable');
  const transport = new MongoLogTransport({ db: { collection: () => ({ insertOne: async () => { throw error; } }) }, collection: 'api-http' });
  const result = await new Promise(resolve => transport.log({ level: 'http', message: 'request' }, resolve));
  assert.equal(result, error);
  transport.end();
});

test('sanitizes nested and string credentials without changing safe token identity or dates', () => {
  const date = new Date();
  const raw = { tokenId: 'id', tokenName: 'Spindle', timestamps: { create: date },
    values: [{ TOKEN: 'secret-a', refresh_token: 'secret-b', password: 'secret-c', _bsontype: 'ObjectId' }],
    message: 'GET /x?%74oken=secret-d&ApiKey=secret-e authorization: Bearer secret-f',
    preview: '{"x-api-token":"secret-g","hashedToken":"secret-h"}' };
  raw.circular = raw;
  const safe = sanitizeLogValue(raw);
  assert.ok(!JSON.stringify(safe).includes('secret-'));
  assert.equal(safe.tokenId, 'id'); assert.equal(safe.tokenName, 'Spindle');
  assert.equal(safe.timestamps.create, date); assert.equal(safe.circular, '[Circular]');
  assert.equal(raw.values[0].TOKEN, 'secret-a');
  const serialized = JSON.stringify({ password: 'secret-quoted"suffix' });
  assert.ok(!sanitizeLogValue(serialized).includes('suffix'));
});

test('finish and close log exactly once, while aborted requests are distinguishable', () => {
  for (const aborted of [false, true]) {
    const logs = [];
    const req = { method: 'GET', originalUrl: '/api/spindle/data?token=secret', headers: {}, authAudit: { result: 'verified', tokenName: 'Spindle' } };
    const res = Object.assign(new EventEmitter(), { headersSent: !aborted, statusCode: 200, writableFinished: !aborted });
    createRequestLoggingMiddleware({ http: log => logs.push(log) })(req, res, () => {});
    if (!aborted) res.emit('finish');
    res.emit('close'); res.emit('finish');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].request.aborted, aborted);
    assert.equal(logs[0].request.status, aborted ? null : 200);
    assert.equal(logs[0].request.path, '/api/spindle/data');
    assert.ok(logs[0].timestamps.start instanceof Date);
    assert.ok(logs[0].timestamps.end instanceof Date);
  }
});

// An in-memory collection implements the query/sort stages used by the reader,
// exercising mixed legacy/canonical records and pagination without a live DB.
function logDb(records) {
  const get = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(branch => matches(doc, branch));
    const actual = get(doc, key);
    if (value === null) return actual == null;
    if (value && typeof value === 'object') return actual instanceof Date && Object.entries(value).every(([op, bound]) => op === '$gte' ? actual >= bound : actual <= bound);
    return actual === value;
  });
  return { collection: name => {
    assert.equal(name, 'api-http');
    return {
      countDocuments: async query => records.filter(doc => matches(doc, query)).length,
      aggregate(pipeline, options) {
        assert.equal(options.allowDiskUse, true);
        assert.deepEqual(pipeline[1], { $addFields: { _logTimestamp: { $ifNull: ['$timestamps.create', '$timestamp'] } } });
        let data = records.filter(doc => matches(doc, pipeline[0].$match));
        data.sort((a, b) => +(b.timestamps?.create || b.timestamp) - +(a.timestamps?.create || a.timestamp) || b._id.localeCompare(a._id));
        data = data.slice(pipeline[3].$skip, pipeline[3].$skip + pipeline[4].$limit);
        return { toArray: async () => data };
      },
    };
  } };
}

test('mixed-format logs filter/count/sort consistently before pagination and preserve original dates', async () => {
  const old = new Date('2026-09-01'), mid = new Date('2026-10-01'), recent = new Date('2026-11-01');
  const db = logDb([
    { _id: 'a', timestamp: old, level: 'http', message: 'old /x?token=secret-legacy' },
    { _id: 'b', timestamps: schema.utils.stampInit(mid), level: 'http', message: 'middle' },
    { _id: 'c', timestamp: recent, level: 'error', message: 'legacy recent' },
    { _id: 'd', timestamp: recent, timestamps: schema.utils.stampInit(old), level: 'http', message: 'canonical date wins' },
    { _id: 'e', timestamps: schema.utils.stampInit(recent), level: 'http', message: 'new',
      authentication: { tokenId: 'token-id', tokenName: 'Spindle' }, request: { status: 200 } },
  ]);
  const options = { start: mid, end: recent };
  assert.equal(await getServerLogsCount(db, options), 3);
  assert.deepEqual((await fetchServerLogs(db, options)).map(doc => doc._id), ['e', 'c', 'b']);
  const page = await fetchServerLogs(db, { ...options, skip: 1, limit: 1 });
  assert.equal(page[0]._id, 'c'); assert.equal(+page[0].timestamp, +recent);
  assert.equal(+page[0].timestamps.create, +recent);
  assert.equal(await getServerLogsCount(db, { ...options, level: 'http' }), 2);
  const all = await fetchServerLogs(db);
  assert.equal(all[0].meta.authentication.tokenName, 'Spindle');
  assert.ok(!JSON.stringify(all).includes('secret-legacy'));
  assert.throws(() => serverLogQuery({ start: 'invalid-date' }), /Invalid/);
});

test('log index setup is read-only by default and apply only creates the declared indexes', async () => {
  const preview = await ensureLogIndexes(null);
  assert.equal(preview.length, 5); assert.ok(preview.every(item => !item.applied));
  const writes = [];
  const db = { collection: name => ({ createIndex: async (key, options) => writes.push({ name, key, options }) }) };
  const applied = await ensureLogIndexes(db, { apply: true });
  assert.equal(writes.length, 5); assert.ok(applied.every(item => item.applied));
  assert.deepEqual(writes.filter(item => item.options.name === 'log_token_created')[0].key,
    { 'authentication.tokenId': 1, 'timestamps.create': -1 });
  assert.ok(writes.every(item => item.options.expireAfterSeconds === undefined));
});
