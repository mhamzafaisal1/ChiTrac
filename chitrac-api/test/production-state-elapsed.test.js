const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductionStatsCache, loadProductionStatsCache } = require('../utils/productionStatsCache');

const now = new Date('2026-10-23T15:00:10Z');
const ticker = (status = 37) => ({ machine: { id: 90007, serial: 90007 },
  status: { code: status, name: 'Current state' }, timestamps: { active: '2026-10-23T13:19:00Z' },
  operators: [{ id: 1, station: 1 }, { id: 2, station: 2 }] });
const session = (status = 37, start = '2026-10-23T15:00:00Z') => ({
  machine: { serial: 90007 }, status: { code: status }, timestamps: { start, end: null },
});
const build = (tickers, sessions) => buildProductionStatsCache([], tickers, [], now, sessions);

test('uses the current fault session start rather than an old ticker activity time for all stations', () => {
  const cache = build([ticker()], [session()]);
  assert.equal(cache.machines['90007'].statusSince, '2026-10-23T15:00:00Z');
  assert.equal(cache.operators['90007:1'].statusSince, cache.machines['90007'].statusSince);
  assert.equal(cache.operators['90007:2'].statusSince, cache.machines['90007'].statusSince);
});

test('repeated updates preserve the state session start and changing fault codes selects the new session', () => {
  const state = ticker(0);
  state.timestamps.active = '2026-10-23T15:00:09Z';
  assert.equal(build([state], [session(0)]).machines['90007'].statusSince, '2026-10-23T15:00:00Z');
  const sessions = [session(37, '2026-10-23T14:00:00Z'), session(38)];
  assert.equal(build([ticker(38)], sessions).machines['90007'].statusSince, '2026-10-23T15:00:00Z');
  assert.equal(build([ticker(37)], sessions).machines['90007'].statusSince, null);
});

test('does not invent elapsed time from mismatched, missing, invalid, closed, or future sessions', () => {
  const closed = session(); closed.timestamps.end = now;
  const sessions = [closed, session(37, 'invalid'), session(37, '2026-10-23T16:00:00Z')];
  assert.equal(build([ticker()], sessions).machines['90007'].statusSince, null);
  assert.equal(build([ticker()], [session(0)]).machines['90007'].statusSince, null);
  assert.equal(build([ticker()], []).machines['90007'].statusSince, null);
});

test('loads bounded current sessions and uses Mongo time when a reference time is not supplied', async () => {
  const calls = [];
  const config = { totalsMinuteCollectionName: 'minutes', stateTickerCollectionName: 'tickers',
    shiftCollectionName: 'shifts', machineSessionCollectionName: 'sessions' };
  const data = { minutes: [], tickers: [ticker()], shifts: [], sessions: [session()] };
  const db = {
    async command(query) { calls.push(query); return { localTime: now }; },
    collection(name) { return { find(query) {
      calls.push({ name, query });
      return { project() { return this; }, async toArray() { return data[name]; } };
    } }; },
  };
  const cache = await loadProductionStatsCache(db, config);
  assert.deepEqual(cache.updatedAt, now);
  assert.deepEqual(calls[0], { hello: 1 });
  assert.deepEqual(calls.find(call => call.name === 'sessions').query,
    { 'machine.serial': { $in: [90007] }, 'timestamps.end': null });
  assert.equal(cache.machines['90007'].statusSince, '2026-10-23T15:00:00Z');
  assert.ok(cache.elapsedAsOf >= now);
});
