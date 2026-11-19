'use strict';

/**
 * Standalone runner for the Cascade MQTT subscriber.
 *
 *   node scripts/cascade-mqtt-subscriber.js            # store to MongoDB (MONGO_CONN_STRING)
 *   node scripts/cascade-mqtt-subscriber.js --dry-run  # print only, no database
 *
 * Settings come from chitrac-api/.env:
 *   CASCADE_MQTT_URL=mqtt://192.168.70.186:1883
 *   CASCADE_MQTT_USERNAME=cascade-plc
 *   CASCADE_MQTT_PASSWORD=...
 *   CASCADE_MQTT_TOPIC=chitrac/cascade/bench/status   (optional)
 *   CASCADE_DATAFEED_URL=http://<datafeed-host>:50100/datafeed/post (optional; off when unset)
 *   CASCADE_MACHINE_SERIAL=90050                      (optional)
 *
 * --dry-run prints the datafeed messages it would send instead of sending them.
 */

const path = require('path');
const config = require(path.join(__dirname, '..', 'modules', 'config'));
const {
  readCascadeMqttConfig,
  startCascadeMqttSubscriber
} = require(path.join(__dirname, '..', 'modules', 'cascadeMqtt'));
const { readCascadeDatafeedConfig } = require(path.join(__dirname, '..', 'modules', 'cascadeEvents'));

function dryRunDb() {
  const collection = name => ({
    createIndex: async () => {},
    findOne: async () => null,
    insertOne: async doc => console.log(`[dry-run] ${name} insert`, JSON.stringify(doc)),
    updateOne: async (filter, update) => console.log(`[dry-run] ${name} update`, JSON.stringify(filter), JSON.stringify(update.$set))
  });
  return { collection };
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const mqttConfig = readCascadeMqttConfig();
  if (!mqttConfig.url) {
    console.error('CASCADE_MQTT_URL is not set (e.g. mqtt://192.168.70.186:1883)');
    process.exitCode = 1;
    return;
  }

  let db;
  let mongoClient;
  if (dryRun) {
    db = dryRunDb();
  } else {
    const { MongoClient } = require('mongodb');
    if (!config.mongo?.connectionString) throw new Error('MONGO_CONN_STRING is required');
    mongoClient = new MongoClient(config.mongo.connectionString.trim());
    await mongoClient.connect();
    db = mongoClient.db();
  }

  const logger = {
    info: msg => console.log(new Date().toISOString(), msg),
    warn: msg => console.warn(new Date().toISOString(), msg),
    error: msg => console.error(new Date().toISOString(), msg)
  };
  let datafeedConfig = readCascadeDatafeedConfig();
  let fetchImpl;
  if (dryRun) {
    datafeedConfig = { ...datafeedConfig, url: datafeedConfig.url || 'dry-run' };
    fetchImpl = async (url, init) => {
      console.log(`[dry-run] datafeed POST ${url}`, init.body);
      return { ok: true, status: 200, text: async () => '' };
    };
  }
  const subscriber = startCascadeMqttSubscriber({ db, logger, config: mqttConfig, datafeedConfig, fetchImpl });

  const shutdown = async () => {
    await subscriber.stop();
    if (mongoClient) await mongoClient.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, dryRunDb };
