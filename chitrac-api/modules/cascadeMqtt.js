'use strict';

/**
 * Cascade PLC MQTT subscriber.
 *
 * The IDEC FC6A on the Cascade bench publishes a JSON status payload every
 * second to the plant Mosquitto broker (Rob's Pi). This module subscribes to
 * that topic and keeps ChiTrac's copy of the latest state in MongoDB:
 *
 *   - CURRENT_COLLECTION: one document per source with the latest signals,
 *     when they last changed, and when the PLC was last heard from.
 *   - EVENT_COLLECTION: one document per signal change (not per message), so
 *     a 1 Hz publish rate does not flood the database.
 *
 * Signals are retained as published; the adapter derives the normal ChiTrac
 * running, paused and configured low-air alarm statuses for the datafeed.
 */

const os = require('os');
const {
  detectCascadeEvents,
  deriveCascadeStatus,
  sameStatus,
  buildDatafeedStatusMessage,
  readCascadeDatafeedConfig,
  createDatafeedForwarder
} = require('./cascadeEvents');

const CURRENT_COLLECTION = 'state-cascade-mqtt';
const EVENT_COLLECTION = 'log-cascade-mqtt';
const SIGNAL_KEYS = ['readyToStart', 'paused', 'running', 'lowAir'];
// Extra ready-to-start bits (M2104 "RTS 2", M2105 "RTS3"). Optional so older
// PLC payloads without them stay valid.
const OPTIONAL_SIGNAL_KEYS = ['rts2', 'rts3'];
const ALL_SIGNAL_KEYS = [...SIGNAL_KEYS, ...OPTIONAL_SIGNAL_KEYS];
const DEFAULT_TOPIC = 'chitrac/cascade/bench/status';
const DEFAULT_HEARTBEAT_MS = 10000;
const DEFAULT_STALE_AFTER_MS = 30000;

/** Parse and validate one status payload. Returns { ok, value } or { ok:false, error }. */
function parseCascadeStatus(payload) {
  let data;
  try {
    data = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'payload is not a JSON object' };
  }
  if (typeof data.source !== 'string' || !data.source.trim()) {
    return { ok: false, error: 'missing source' };
  }
  const signals = {};
  for (const key of SIGNAL_KEYS) {
    if (typeof data[key] !== 'boolean') {
      return { ok: false, error: `${key} must be boolean` };
    }
    signals[key] = data[key];
  }
  for (const key of OPTIONAL_SIGNAL_KEYS) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'boolean') {
      return { ok: false, error: `${key} must be boolean` };
    }
    signals[key] = data[key];
  }
  return { ok: true, value: { source: data.source.trim(), signals } };
}

function sameSignals(a, b) {
  return !!a && !!b && ALL_SIGNAL_KEYS.every(key => a[key] === b[key]);
}

/** Read Cascade MQTT settings from environment variables. */
function readCascadeMqttConfig(env = process.env) {
  const url = (env.CASCADE_MQTT_URL || '').trim();
  return {
    url,
    username: env.CASCADE_MQTT_USERNAME || undefined,
    password: env.CASCADE_MQTT_PASSWORD || undefined,
    topic: (env.CASCADE_MQTT_TOPIC || DEFAULT_TOPIC).trim(),
    clientId: (env.CASCADE_MQTT_CLIENT_ID || `chitrac-cascade-${os.hostname()}-${process.pid}`).trim(),
    heartbeatMs: Number(env.CASCADE_MQTT_HEARTBEAT_MS) > 0 ? Number(env.CASCADE_MQTT_HEARTBEAT_MS) : DEFAULT_HEARTBEAT_MS,
    staleAfterMs: Number(env.CASCADE_MQTT_STALE_AFTER_MS) > 0 ? Number(env.CASCADE_MQTT_STALE_AFTER_MS) : DEFAULT_STALE_AFTER_MS
  };
}

/** Handles parsed messages and writes state; independent of the MQTT library so it can be tested. */
function createCascadeStatusStore({ db, logger = console, now = () => new Date(), heartbeatMs = DEFAULT_HEARTBEAT_MS,
  datafeedHeartbeatMs = 5000, forwarder = null, machine = null } = {}) {
  if (!db) throw new Error('db is required');
  const current = db.collection(CURRENT_COLLECTION);
  const events = db.collection(EVENT_COLLECTION);
  const lastBySource = new Map();
  const lastForwardedBySource = new Map();
  let indexesReady = null;

  function forwardStatus(source, status, at, force = false) {
    if (!forwarder || !machine) return;
    const previous = lastForwardedBySource.get(source);
    if (!force && previous !== undefined && at.getTime() - previous < datafeedHeartbeatMs) return;
    const accepted = forwarder.send(buildDatafeedStatusMessage({ serial: machine.serial, name: machine.name, timestamp: at, status }));
    if (accepted !== false) lastForwardedBySource.set(source, at.getTime());
  }

  function ensureIndexes() {
    if (!indexesReady) {
      indexesReady = Promise.all([
        current.createIndex({ source: 1 }, { unique: true }),
        events.createIndex({ source: 1, timestamp: -1 })
      ]).catch(error => {
        indexesReady = null;
        throw error;
      });
    }
    return indexesReady;
  }

  // Process one message at a time so a burst of messages can't race past the
  // last-known-state check and log duplicate events.
  let queue = Promise.resolve();
  function handleMessage(topic, payload) {
    const run = queue.then(() => processMessage(topic, payload));
    queue = run.catch(() => {});
    return run;
  }

  async function processMessage(topic, payload) {
    const parsed = parseCascadeStatus(payload);
    if (!parsed.ok) {
      logger.warn(`Cascade MQTT: ignored message on ${topic}: ${parsed.error}`);
      return { action: 'ignored', error: parsed.error };
    }
    await ensureIndexes();

    const { source, signals } = parsed.value;
    const at = now();
    let last = lastBySource.get(source);

    // After a restart, compare against what is already stored so an unchanged
    // machine does not get a fresh "change" event every time the server starts.
    if (!last) {
      const stored = await current.findOne({ source });
      if (stored && stored.signals) {
        last = { signals: stored.signals, writtenAt: 0, status: stored.status || deriveCascadeStatus(stored.signals) };
        lastBySource.set(source, last);
      }
    }

    if (last && sameSignals(last.signals, signals)) {
      // A fresh PLC snapshot proves liveness. Do not replay stored state on a
      // timer after the PLC disappears; let the datafeed watchdog mark Offline.
      // The first fresh snapshot after a bridge restart also initializes the datafeed.
      forwardStatus(source, deriveCascadeStatus(signals), at);
      if (at - last.writtenAt < heartbeatMs) return { action: 'unchanged' };
      await current.updateOne({ source }, { $set: { lastSeenAt: at, topic } }, { upsert: true });
      last.writtenAt = at;
      return { action: 'heartbeat' };
    }

    const previous = last ? last.signals : null;
    const eventNames = detectCascadeEvents(previous, signals);
    const status = deriveCascadeStatus(signals);
    const statusChanged = !last || !sameStatus(last.status, status);
    await events.insertOne({ source, topic, timestamp: at, signals, previous, events: eventNames, status, statusChanged });
    await current.updateOne(
      { source },
      { $set: { source, topic, signals, status, lastChangedAt: at, lastSeenAt: at } },
      { upsert: true }
    );
    lastBySource.set(source, { signals, writtenAt: at, status });
    logger.info(`Cascade MQTT: ${source} ${eventNames.length ? eventNames.join(', ') : 'received'} -> status ${status.code} ${status.name}`);
    forwardStatus(source, status, at, statusChanged);
    return { action: previous ? 'changed' : 'first', events: eventNames, status, statusChanged };
  }

  return { handleMessage, ensureIndexes };
}

/** Is the latest stored state too old to trust? Use when displaying CURRENT_COLLECTION docs. */
function isCascadeStatusStale(doc, nowDate = new Date(), staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  if (!doc || !doc.lastSeenAt) return true;
  return nowDate - new Date(doc.lastSeenAt) > staleAfterMs;
}

/**
 * Connect to the broker and start storing status. `mqttConnect` defaults to the
 * `mqtt` package's connect(); it is injectable for tests.
 */
function startCascadeMqttSubscriber({ db, logger = console, config = readCascadeMqttConfig(), datafeedConfig = readCascadeDatafeedConfig(), mqttConnect, fetchImpl, now } = {}) {
  if (!config.url) throw new Error('CASCADE_MQTT_URL is required');
  const connect = mqttConnect || require('mqtt').connect;
  let forwarder = null;
  if (datafeedConfig && datafeedConfig.url) {
    forwarder = createDatafeedForwarder({ url: datafeedConfig.url, retryMs: datafeedConfig.retryMs,
      maxQueue: datafeedConfig.maxQueue, requestTimeoutMs: datafeedConfig.requestTimeoutMs, fetchImpl, logger });
    logger.info(`Cascade MQTT: forwarding statuses and fresh-snapshot heartbeats to ${datafeedConfig.url} as serial ${datafeedConfig.serial}`);
  }
  const machine = datafeedConfig ? { serial: datafeedConfig.serial, name: datafeedConfig.name } : null;
  const store = createCascadeStatusStore({ db, logger, now, heartbeatMs: config.heartbeatMs,
    datafeedHeartbeatMs: datafeedConfig?.heartbeatMs, forwarder, machine });

  const client = connect(config.url, {
    clientId: config.clientId,
    username: config.username,
    password: config.password,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000
  });

  client.on('connect', () => {
    logger.info(`Cascade MQTT: connected to ${config.url}, subscribing to ${config.topic}`);
    client.subscribe(config.topic, { qos: 0 }, error => {
      if (error) logger.error(`Cascade MQTT: subscribe failed: ${error.message}`);
    });
  });
  client.on('reconnect', () => logger.warn('Cascade MQTT: reconnecting...'));
  client.on('close', () => logger.warn('Cascade MQTT: connection closed'));
  client.on('error', error => logger.error(`Cascade MQTT: ${error.message}`));
  client.on('message', (topic, payload) => {
    store.handleMessage(topic, payload).catch(error => {
      logger.error(`Cascade MQTT: failed to store message: ${error.message}`);
    });
  });

  return {
    client,
    store,
    forwarder,
    stop: () => new Promise(resolve => {
      if (forwarder) forwarder.stop();
      client.end(false, {}, () => resolve());
    })
  };
}

module.exports = {
  CURRENT_COLLECTION,
  EVENT_COLLECTION,
  SIGNAL_KEYS,
  OPTIONAL_SIGNAL_KEYS,
  DEFAULT_TOPIC,
  parseCascadeStatus,
  readCascadeMqttConfig,
  createCascadeStatusStore,
  isCascadeStatusStale,
  startCascadeMqttSubscriber
};
