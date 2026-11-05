const collections = ['api-http', 'api-error', 'ws-log', 'ws-error'];

async function ensureLogIndexes(db, { apply = false } = {}) {
  const report = [];
  for (const name of collections) {
    const indexes = [
      { key: { 'timestamps.create': -1 }, options: { name: 'log_created', sparse: true } },
      ...(name === 'api-http' ? [{ key: { 'authentication.tokenId': 1, 'timestamps.create': -1 },
        options: { name: 'log_token_created', partialFilterExpression: { 'authentication.tokenId': { $type: 'string' } } } }] : []),
    ];
    for (const index of indexes) {
      if (apply) await db.collection(name).createIndex(index.key, index.options);
      report.push({ collection: name, ...index, applied: apply });
    }
  }
  return report;
}

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    if (process.argv.some(arg => arg.startsWith('--') && arg !== '--apply')) throw new Error('Usage: node scripts/ensure-log-indexes.js [--apply]');
    if (!apply) {
      console.log(JSON.stringify(await ensureLogIndexes(null), null, 2));
      return;
    }
    const config = require('../modules/config');
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(config.mongoLog.connectionString);
    try {
      await client.connect();
      console.log(JSON.stringify(await ensureLogIndexes(client.db(), { apply }), null, 2));
    } finally { await client.close(); }
  })().catch(() => { console.error('Log index setup failed; check database connectivity and index permissions.'); process.exitCode = 1; });
}

module.exports = { ensureLogIndexes };
