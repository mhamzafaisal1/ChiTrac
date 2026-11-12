const path = require('node:path');
const { initializeConfigCollections } = require('../modules/initializeConfigCollections');

const ENV_FILE = path.resolve(__dirname, '..', '.env');
const HELP = `Usage: npm run init:config
   or: node scripts/init-config.js

Loads .env from the project root (existing environment variables take precedence).
Requires MONGO_CONN_STRING with an explicit database name.
Seeds missing or empty config-* collections; leaves populated collections intact.
Does not start the API, initialize runtime collections, or clear any data.`;

function validateConnectionString(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('MONGO_CONN_STRING is required');
  const uri = value.trim();
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGO_CONN_STRING must be a MongoDB URI');
  const address = uri.split('?')[0];
  const slash = address.indexOf('/', address.indexOf('://') + 3);
  if (slash < 0 || !address.slice(slash + 1)) {
    throw new Error('MONGO_CONN_STRING must include an explicit database name');
  }
  return uri;
}

async function runInitialization(connectionString, {
  createClient = uri => new (require('mongodb').MongoClient)(uri, { serverSelectionTimeoutMS: 15000 }),
  log = message => console.log(message)
} = {}) {
  const uri = validateConnectionString(connectionString);
  const client = createClient(uri);
  try {
    await client.connect();
    const db = client.db();
    log(`Initializing configuration in database "${db.databaseName}"`);
    const results = await initializeConfigCollections(db, {}, {
      onResult: row => log(`${row.collection}: ${row.status} (${row.count} documents)`)
    });
    log('Configuration initialization complete.');
    return results;
  } finally { await client.close(); }
}

async function main({
  argv = process.argv.slice(2), env = process.env,
  loadEnv = options => require('dotenv').config(options),
  createClient, log = message => console.log(message)
} = {}) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { log(HELP); return; }
  if (argv.length) throw new Error('Unsupported arguments. Run with --help for usage.');
  loadEnv({ path: ENV_FILE, processEnv: env });
  return runInitialization(env.MONGO_CONN_STRING, { createClient, log });
}

function safeErrorMessage(error) {
  // Driver errors must not expose a connection URI or its credentials.
  let message = String(error.message || error);
  const uri = process.env.MONGO_CONN_STRING;
  if (uri) message = message.split(uri).join('[redacted MongoDB URI]');
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted MongoDB URI]');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Configuration initialization failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { main, runInitialization, safeErrorMessage };
