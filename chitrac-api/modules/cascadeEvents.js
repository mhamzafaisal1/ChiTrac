'use strict';

/**
 * Turns Cascade PLC signal snapshots into machine events and a ChiTrac status,
 * and forwards status changes to the datafeed-api in the same format other
 * machines use (POST /datafeed/post).
 *
 * Datafeed status-code contract (see chitrac-datafeed-api modules/alarms.js):
 *   1  = run time
 *   0  = paused / idle time
 *   >1 = fault; Cascade faults are sent as explicit alarm objects
 */

// Rising/falling edge of each signal -> event name.
const SIGNAL_EVENTS = {
  running: { on: 'start', off: 'stop' },
  paused: { on: 'pause', off: 'resume' },
  readyToStart: { on: 'ready', off: 'notReady' },
  rts2: { on: 'rts2On', off: 'rts2Off' },
  rts3: { on: 'rts3On', off: 'rts3Off' }
};

// Status when no Cascade fault is active. First matching rule wins.
const DEFAULT_STATUS_RULES = [
  { when: 'running', status: { code: 1, name: 'Run' } },
  { when: 'paused', status: { code: 0, name: 'Paused' } }
];
const DEFAULT_IDLE_STATUS = { code: 0, name: 'Idle' };

// Cascade stopping faults (IDs = PLC address numbers, per Rob).
//   key        payload field carrying the PLC bit
//   activeWhen value of that bit that means "faulted"
// M2103 is already published as `lowAir`. M2106 is commented "Breaker OK" in
// the PLC, but the ladder SETs it when breaker input I0000 is OFF (rungs 11/12),
// so like every other bit here it is a fault when true.
// Ascending device order breaks ties when a single snapshot reports several
// new faults. The publisher supplies no order within a snapshot.
const CASCADE_FAULT_DEFINITIONS = [
  { id: 2103, name: 'Low Air Fault', key: 'lowAir', activeWhen: true },
  { id: 2106, name: 'Breaker Fault', key: 'M2106', activeWhen: true },
  { id: 2107, name: 'Autoload Fault', key: 'M2107', activeWhen: true },
  { id: 2110, name: 'LR Estop', key: 'M2110', activeWhen: true },
  { id: 2111, name: 'LF Estop', key: 'M2111', activeWhen: true },
  { id: 2112, name: 'RF Estop', key: 'M2112', activeWhen: true },
  { id: 2113, name: 'RR Estop', key: 'M2113', activeWhen: true },
  { id: 2114, name: 'Inverter Fault', key: 'M2114', activeWhen: true },
  { id: 2115, name: 'Doors Open', key: 'M2115', activeWhen: true },
  { id: 2204, name: 'No Material', key: 'M2204', activeWhen: true }
];
// Alarm objects exactly as sent to the datafeed (strict schema: no extra fields).
const CASCADE_FAULTS = CASCADE_FAULT_DEFINITIONS.map(({ id, name }) => ({ id, name, fault: true, stop: true }));
const CASCADE_FAULT_KEYS = CASCADE_FAULT_DEFINITIONS.map(def => def.key);

// A missing bit (older payload) is never treated as a fault.
const isFaultActive = (def, signals) => signals?.[def.key] === def.activeWhen;

function resolveCascadeFaults(previous, signals, previousFaults = []) {
  const byId = new Map(CASCADE_FAULT_DEFINITIONS.map(def => [def.id, def]));
  // Keep the stored activation order; drop faults that cleared or are no longer defined.
  const activeFaults = previousFaults
    .filter(alarm => byId.has(alarm.id) && isFaultActive(byId.get(alarm.id), signals))
    .map(alarm => CASCADE_FAULTS.find(fault => fault.id === alarm.id));
  const faultChanges = [];
  CASCADE_FAULT_DEFINITIONS.forEach((def, index) => {
    const alarm = CASCADE_FAULTS[index];
    const active = isFaultActive(def, signals);
    if (active && !activeFaults.some(fault => fault.id === alarm.id)) activeFaults.push(alarm);
    if (active !== isFaultActive(def, previous)) faultChanges.push({ ...alarm, active });
  });
  return { activeFaults, faultChanges };
}

/** Event names for every signal that changed between two snapshots. */
function detectCascadeEvents(previous, signals) {
  const events = [];
  for (const [key, names] of Object.entries(SIGNAL_EVENTS)) {
    if (signals[key] === undefined) continue; // optional bit not in this payload
    const before = previous ? previous[key] : false;
    if (signals[key] !== before) events.push(signals[key] ? names.on : names.off);
  }
  return events;
}

function deriveCascadeStatus(signals, rules = DEFAULT_STATUS_RULES, idle = DEFAULT_IDLE_STATUS) {
  const rule = rules.find(r => signals[r.when] === true);
  return { ...(rule ? rule.status : idle) };
}

function sameStatus(a, b) {
  return !!a && !!b && a.code === b.code && a.name === b.name;
}

function buildDatafeedStatusMessage({ serial, name, timestamp, status, alarm }) {
  return {
    machineInfo: { serial, name },
    timestamp: new Date(timestamp).toISOString(),
    status: { code: status.code, name: status.name },
    ...(alarm ? { alarm } : {})
  };
}

function readCascadeDatafeedConfig(env = process.env) {
  function positiveInteger(key, fallback) {
    const raw = env[key];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(key + ' must be a positive integer');
    return value;
  }
  const url = (env.CASCADE_DATAFEED_URL || '').trim();
  if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('CASCADE_DATAFEED_URL must use HTTP or HTTPS');
  return {
    url,
    serial: positiveInteger('CASCADE_MACHINE_SERIAL', 90050),
    name: (env.CASCADE_MACHINE_NAME || 'Cascade').trim(),
    retryMs: positiveInteger('CASCADE_DATAFEED_RETRY_MS', 5000),
    maxQueue: positiveInteger('CASCADE_DATAFEED_MAX_QUEUE', 500),
    heartbeatMs: positiveInteger('CASCADE_DATAFEED_HEARTBEAT_MS', 5000),
    requestTimeoutMs: positiveInteger('CASCADE_DATAFEED_TIMEOUT_MS', 30000)
  };
}

/** Ordered, bounded in-memory forwarding. The request being sent is never evicted. */
function createDatafeedForwarder({ url, retryMs = 5000, maxQueue = 500, requestTimeoutMs = 30000,
  fetchImpl = globalThis.fetch, logger = console, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!url) throw new Error('datafeed url is required');
  for (const [key, value] of Object.entries({ retryMs, maxQueue, requestTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(key + ' must be a positive integer');
  }
  const queue = [];
  let sending = false;
  let stopped = false;
  let retryTimer = null;
  let inFlight = null;
  let controller = null;

  async function post(message) {
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(new Error('Cascade datafeed request timed out')), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message), signal: requestController.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error('datafeed responded ' + response.status + (text ? ': ' + text.slice(0, 200) : ''));
        error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
        throw error;
      }
    } finally {
      clearTimeout(timer);
      controller = null;
    }
  }

  async function drain() {
    if (sending || stopped) return;
    sending = true;
    try {
      while (queue.length && !stopped) {
        inFlight = queue[0];
        try {
          await post(inFlight);
          queue.shift();
        } catch (error) {
          if (stopped) return;
          if (error.permanent) {
            logger.error('Cascade datafeed: rejected ' + JSON.stringify(inFlight.status) + ': ' + error.message);
            queue.shift();
            continue;
          }
          logger.warn('Cascade datafeed: send failed (' + error.message + '); retrying in ' + retryMs + ' ms, ' + queue.length + ' queued');
          retryTimer = setTimer(() => { retryTimer = null; drain(); }, retryMs);
          return;
        } finally {
          inFlight = null;
        }
      }
    } finally {
      sending = false;
    }
  }

  return {
    send(message) {
      if (stopped) return false;
      if (queue.length >= maxQueue) {
        // Prefer the latest waiting state, while preserving the in-flight head.
        if (inFlight && queue.length === 1) {
          logger.warn('Cascade datafeed: queue full; cannot replace in-flight message');
          return false;
        }
        queue.splice(inFlight ? 1 : 0, 1);
        logger.warn('Cascade datafeed: queue full, dropped oldest waiting message');
      }
      queue.push(structuredClone(message));
      if (!retryTimer) drain();
      return true;
    },
    pending: () => queue.length,
    stop() {
      stopped = true;
      if (retryTimer) clearTimer(retryTimer);
      retryTimer = null;
      controller?.abort(new Error('Cascade datafeed forwarding stopped'));
    }
  };
}

module.exports = {
  CASCADE_FAULTS,
  CASCADE_FAULT_DEFINITIONS,
  CASCADE_FAULT_KEYS,
  resolveCascadeFaults,
  SIGNAL_EVENTS,
  DEFAULT_STATUS_RULES,
  DEFAULT_IDLE_STATUS,
  detectCascadeEvents,
  deriveCascadeStatus,
  sameStatus,
  buildDatafeedStatusMessage,
  readCascadeDatafeedConfig,
  createDatafeedForwarder
};
