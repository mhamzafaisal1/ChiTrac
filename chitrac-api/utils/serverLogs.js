const timestampsSchema = require('../schemas/timestampsSchema');
const { sanitizeLogValue } = require('./logSanitizer');

function serverLogQuery({ start, end, level } = {}) {
  const query = {};
  if (start || end) {
    const range = {};
    if (start) range.$gte = timestampsSchema.utils.toDate(start);
    if (end) range.$lte = timestampsSchema.utils.toDate(end);
    // Keep the indexed range match before the mixed-format sort. A canonical
    // timestamp wins; a legacy timestamp is only used when it is absent/null.
    query.$or = [
      { 'timestamps.create': range },
      { 'timestamps.create': null, timestamp: range },
    ];
  }
  if (level) query.level = level;
  return query;
}

function formatServerLog(log) {
  const timestamp = log.timestamps?.create || log.timestamp;
  return sanitizeLogValue({
    _id: log._id,
    timestamps: log.timestamps?.create ? log.timestamps : timestampsSchema.utils.stampInit(timestamp),
    // Compatibility alias for existing log-viewer clients, not a stored field.
    timestamp,
    level: log.level || 'unknown', message: log.message || '', hostname: log.hostname || 'unknown',
    request: log.request, authentication: log.authentication,
    meta: log.request || log.authentication ? {
      ...(log.meta && typeof log.meta === 'object' ? log.meta : {}),
      ...(log.request ? { request: log.request } : {}),
      ...(log.authentication ? { authentication: log.authentication } : {}),
    } : log.meta,
  });
}

async function fetchServerLogs(logDb, options = {}) {
  const { limit = 100, skip = 0 } = options;
  const logs = await logDb.collection('api-http').aggregate([
    { $match: serverLogQuery(options) },
    { $addFields: { _logTimestamp: { $ifNull: ['$timestamps.create', '$timestamp'] } } },
    { $sort: { _logTimestamp: -1, _id: -1 } },
    { $skip: skip }, { $limit: limit },
    { $project: { _logTimestamp: 0 } },
  ], { allowDiskUse: true }).toArray();
  return logs.map(formatServerLog);
}

async function getServerLogsCount(logDb, options = {}) {
  return logDb.collection('api-http').countDocuments(serverLogQuery(options));
}

module.exports = { fetchServerLogs, getServerLogsCount, serverLogQuery, formatServerLog };
