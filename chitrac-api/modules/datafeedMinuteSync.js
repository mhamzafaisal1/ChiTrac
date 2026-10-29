const crypto = require('crypto');
const { DateTime } = require('luxon');
const MINUTE = 60000;
const RETENTION_SECONDS = 48 * 60 * 60;
const ALLOWED_TYPES = new Set(['machine', 'operator-machine', 'machine-item', 'item', 'operator-item']);
const TOTAL_FIELDS = new Set(['runtimeMs', 'faultTimeMs', 'workedTimeMs', 'pausedTimeMs', 'offlineTimeMs', 'downTimeMs', 'breakTimeMs', 'faults', 'count', 'misfeeds', 'timeCreditMs']);
const keyOf = frame => `${frame.machineId}:${new Date(frame.minuteStart).toISOString()}`;
const entityKey = doc => [doc.type, String(doc.machine?.id ?? doc.machine?.serial), new Date(doc.timestamps.start).toISOString(), doc.operator?.id ?? '', doc.item?.id ?? ''].join(':');
function validToken(supplied, expected) {
  if (!expected || expected.length < 32 || !supplied) return false;
  const a = Buffer.from(supplied), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validateSnapshot(frame, now = Date.now()) {
  if (frame?.type !== 'minute-totals' || frame.version !== 1 || !Number.isSafeInteger(frame.revision) || frame.revision <= 0 ||
      !['string', 'number'].includes(typeof frame.machineId) || !/^[-A-Za-z0-9_]{1,128}$/.test(String(frame.machineId)) || typeof frame.complete !== 'boolean') throw new Error('Invalid minute snapshot header');
  const start = new Date(frame.minuteStart).getTime(), end = new Date(frame.minuteEnd).getTime(), calculated = new Date(frame.calculatedAt).getTime();
  if (![start, end, calculated].every(Number.isFinite) || start % MINUTE !== 0 || end !== start + MINUTE || calculated < start || calculated > now + 30000 ||
      (frame.complete && (end > now || end > calculated))) throw new Error('Invalid or incomplete minute boundary');
  if (!Array.isArray(frame.documents) || !frame.documents.length || frame.documents.length > 20000) throw new Error('Invalid minute documents');
  const bucketId = DateTime.fromMillis(start, { zone: 'UTC' }).toFormat('yyyy-MM-dd-HH-mm') + 'Z';
  const seen = new Set();
  const documents = frame.documents.map(input => {
    if (!ALLOWED_TYPES.has(input.type) || String(input.machine?.id ?? input.machine?.serial) !== String(frame.machineId)) throw new Error('Minute identity mismatch');
    const id = input.type === 'machine' ? `machine-${frame.machineId}-${bucketId}`
      : input.type === 'operator-machine' ? `operator-machine-${input.operator?.id}-${frame.machineId}-${bucketId}`
      : input.type === 'machine-item' ? `machine-item-${frame.machineId}-${input.item?.id}-${bucketId}`
      : input.type === 'item' ? `item-${input.item?.id}-${frame.machineId}-${bucketId}`
      : `operator-item-${input.operator?.id}-${input.item?.id}-${frame.machineId}-${bucketId}`;
    const actualEnd = new Date(input.timestamps?.end).getTime();
    if (input.id !== id || seen.has(id) || new Date(input.timestamps?.start).getTime() !== start || actualEnd <= start || actualEnd > Math.min(end, calculated) || (frame.complete && actualEnd !== end)) throw new Error('Invalid minute document identity or interval');
    if (input.type.includes('operator') && input.operator?.id == null || input.type.includes('item') && input.item?.id == null) throw new Error('Missing entity identity');
    seen.add(id);
    const totals = {};
    for (const field of TOTAL_FIELDS) {
      const value = input.totals?.[field] ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Invalid total');
      totals[field] = value;
    }
    return { id, type: input.type, machine: input.machine, ...(input.operator ? { operator: input.operator } : {}), ...(input.item ? { item: input.item } : {}),
      timestamps: { create: new Date(start), active: new Date(start), start: new Date(start), end: new Date(actualEnd), update: new Date(calculated) },
      totals, source: 'datafeed', sync: { revision: frame.revision } };
  });
  if (documents.filter(doc => doc.type === 'machine').length !== 1) throw new Error('Snapshot must contain one machine total');
  return { ...frame, minuteStart: new Date(start), minuteEnd: new Date(end), calculatedAt: new Date(calculated), documents };
}

class DatafeedMinuteSync {
  constructor({ db, token, onChange = () => {}, clock = () => Date.now(), logger = console }) {
    this.db = db; this.token = token; this.onChange = onChange; this.clock = clock; this.logger = logger;
    this.live = new Map(); this.jobs = new Map(); this.connections = new Map(); this.leases = new Map(); this.checkpoints = new Map();
  }
  async start() {
    if (!this.token || this.token.length < 32) this.logger.warn?.('Datafeed minute synchronization requires DATAFEED_SYNC_TOKEN (at least 32 characters)');
    await this.db.collection('totals-minute').createIndex({ id: 1 }, { name: 'totals_minute_deterministic_id', unique: true, partialFilterExpression: { id: { $type: 'string' } } });
    await this.db.collection('totals-minute').createIndex({ 'timestamps.update': 1 }, { name: 'totals_minute_update_ttl', expireAfterSeconds: RETENTION_SECONDS });
    await this.db.collection('totals-minute').createIndex({ type: 1, 'timestamps.start': 1, 'machine.id': 1 }, { name: 'totals_minute_machine_id_lookup' });
    await this.db.collection('totals-minute').createIndex({ type: 1, 'timestamps.start': 1, 'operator.id': 1, 'machine.id': 1 }, { name: 'totals_minute_operator_id_lookup' });
    await this.db.collection('totals-minute-sync').createIndex({ 'timestamps.update': 1 }, { expireAfterSeconds: RETENTION_SECONDS });
    await this.db.collection('totals-minute-sync').createIndex({ kind: 1, machineId: 1, minuteStart: -1 });
  }
  run(key, work) {
    const job = (this.jobs.get(key) || Promise.resolve()).catch(() => {}).then(work);
    this.jobs.set(key, job);
    job.finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); }).catch(() => {});
    return job;
  }
  async claim(machineId, owner) {
    const now = this.clock();
    const previous = this.leases.get(String(machineId));
    try {
      const lease = await this.db.collection('totals-minute-sync').findOneAndUpdate({
        _id: `lease:${machineId}`, $or: [{ owner }, { leaseUntil: { $lte: new Date(now) } }],
      }, { $set: { kind: 'lease', machineId: String(machineId), owner, leaseUntil: new Date(now + 30000), 'timestamps.update': new Date(now) } }, { upsert: true, returnDocument: 'after' });
      if (!lease || lease.owner !== owner) throw new Error('Machine is already owned by another datafeed connection');
      if (!previous || previous.owner !== owner || previous.until <= now) {
        for (const key of this.checkpoints.keys()) if (key.startsWith(`${machineId}:`)) this.checkpoints.delete(key);
      }
      this.leases.set(String(machineId), { owner, until: now + 30000 });
    } catch (error) {
      if (error.code === 11000) throw new Error('Machine is already owned by another datafeed connection');
      throw error;
    }
  }
  async receive(raw, owner) {
    const frame = validateSnapshot(raw, this.clock());
    return this.run(String(frame.machineId), async () => {
      const lease = this.leases.get(String(frame.machineId));
      if (!lease || lease.owner !== owner || lease.until <= this.clock() + 10000) await this.claim(frame.machineId, owner);
      const key = keyOf(frame);
      const checkpoints = this.db.collection('totals-minute-sync');
      if (!this.checkpoints.has(key)) this.checkpoints.set(key, await checkpoints.findOne({ _id: key, kind: 'bucket' }));
      const saved = this.checkpoints.get(key);
      const ack = { type: 'minute-totals-ack', key, revision: frame.revision };
      if (saved && (!frame.complete || saved.revision >= frame.revision)) return ack;
      const previous = this.live.get(key);
      if (previous && (previous.revision > frame.revision || previous.revision === frame.revision && (!frame.complete || previous.committed))) {
        if (!frame.complete && previous.revision === frame.revision) {
          Object.assign(previous, { owner, receivedAt: this.clock(), connected: true });
          this.onChange();
        }
        return ack;
      }
      this.live.set(key, { ...frame, owner, receivedAt: this.clock(), connected: true });
      if (frame.complete) {
        const collection = this.db.collection('totals-minute');
        await collection.bulkWrite(frame.documents.map(document => ({ replaceOne: { filter: { id: document.id }, replacement: document, upsert: true } })), { ordered: true });
        await collection.deleteMany({ 'machine.id': frame.machineId, 'timestamps.start': frame.minuteStart, id: { $nin: frame.documents.map(doc => doc.id) } });
        // The commit marker is last. A failed/partial bulk is never acknowledged as persisted.
        await checkpoints.updateOne({ _id: key }, { $set: { kind: 'bucket', machineId: String(frame.machineId), minuteStart: frame.minuteStart,
          revision: frame.revision, 'timestamps.update': new Date(this.clock()) } }, { upsert: true });
        this.checkpoints.set(key, { revision: frame.revision });
        // Keep the committed overlay briefly to bridge reads that began before the Mongo write.
        this.live.set(key, { ...this.live.get(key), committed: true });
      }
      this.onChange();
      return ack;
    });
  }
  overlay(documents, now = this.clock()) {
    const result = new Map(documents.map(document => [entityKey(document), document]));
    const sourceTimes = [];
    for (const key of this.checkpoints.keys()) if (new Date(key.slice(-24)).getTime() < now - RETENTION_SECONDS * 1000) this.checkpoints.delete(key);
    let connected = this.connections.size > 0, stale = false;
    for (const [key, frame] of this.live) {
      if (frame.minuteStart.getTime() < now - RETENTION_SECONDS * 1000) { this.live.delete(key); this.checkpoints.delete(key); continue; }
      const expected = frame.documents.filter(doc => ['machine', 'operator-machine'].includes(doc.type));
      const persisted = documents.filter(doc => String(doc.machine?.id ?? doc.machine?.serial) === String(frame.machineId) && new Date(doc.timestamps.start).getTime() === frame.minuteStart.getTime());
      if (frame.committed && persisted.length === expected.length && expected.every(doc => persisted.some(row => row.id === doc.id && row.sync?.revision >= frame.revision))) { this.live.delete(key); continue; }
      for (const [identity, document] of result) {
        if (String(document.machine?.id ?? document.machine?.serial) === String(frame.machineId) && new Date(document.timestamps.start).getTime() === frame.minuteStart.getTime()) result.delete(identity);
      }
      for (const document of frame.documents) result.set(entityKey(document), document);
      if (!frame.complete) {
        sourceTimes.push(frame.calculatedAt); connected ||= frame.connected;
        stale ||= !frame.connected || now - frame.receivedAt > 75000 || now - frame.calculatedAt.getTime() > 75000;
      }
    }
    if (!connected) stale = true;
    return { documents: [...result.values()], status: { connected, stale, updatedAt: sourceTimes.length ? new Date(Math.max(...sourceTimes.map(Number))) : null } };
  }
  accept(ws, request) {
    if (!validToken(request.headers.authorization, this.token)) { ws.close(1008, 'Service authentication required'); return; }
    const owner = crypto.randomUUID(); const machines = new Set(); let busy = false, alive = true;
    this.connections.set(owner, ws);
    const heartbeat = setInterval(async () => {
      if (ws.readyState !== 1) return;
      if (!alive) { ws.terminate(); return; }
      alive = false; ws.ping();
      try { for (const machine of machines) await this.claim(machine, owner); }
      catch (error) { this.logger.error(`Minute sync lease: ${error.message}`); ws.close(1013, 'Lease unavailable'); }
    }, 10000);
    heartbeat.unref?.();
    ws.on('pong', () => { alive = true; });
    ws.on('message', async data => {
      if (busy || data.length > 8 * 1024 * 1024) { ws.close(1008, 'One bounded snapshot at a time'); return; }
      busy = true;
      try {
        const frame = JSON.parse(data.toString());
        machines.add(String(frame.machineId));
        const ack = await this.receive(frame, owner);
        if (ws.readyState === 1) ws.send(JSON.stringify(ack));
      } catch (error) { this.logger.error(`Minute sync rejected: ${error.message}`); ws.close(1013, 'Minute sync could not be applied'); }
      finally { busy = false; }
    });
    ws.on('close', () => {
      clearInterval(heartbeat); this.connections.delete(owner);
      for (const frame of this.live.values()) if (frame.owner === owner) frame.connected = false;
      for (const machine of machines) this.run(machine, async () => {
        if (this.leases.get(machine)?.owner === owner) this.leases.delete(machine);
        await this.db.collection('totals-minute-sync').deleteOne({ _id: `lease:${machine}`, owner });
      }).catch(error => this.logger.error(error.message));
      this.onChange();
    });
  }
  stop() { for (const ws of this.connections.values()) ws.terminate(); }
}
module.exports = { DatafeedMinuteSync, validateSnapshot, keyOf, entityKey, validToken };
