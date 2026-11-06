const test = require('node:test');
const assert = require('node:assert/strict');
const spindle = require('../controllers/spindle');
const config = require('../modules/config');

test('machine details reports clipped fault and pause history independently of the current ticker', async () => {
  const machine = { id: 99004, serial: 99004, name: 'Feeder' };
  const status = { code: 124, name: 'Feeder Estop/Reset' };
  const start = new Date('2026-01-01T13:00:00Z');
  const end = new Date('2026-01-22T13:00:00Z');
  const rows = [
    { machine, status, timestamps: { start: new Date(+start - 60000), end: new Date(+start + 60000) } },
    { machine, type: 0, timestamps: { start: new Date(+end - 55 * 60000), end: new Date(+end - 51 * 60000) } },
    { machine, states: { start: { status } }, timestamps: { start: new Date(+end - 51 * 60000), end: null } },
  ];
  let expectedFaults = rows;
  const db = { collection(name) {
    return {
      find(query) {
        let records = [];
        if (name === config.machineCollectionName) records = [machine];
        if (name === config.totalsDailyCollectionName && query.entityType === 'machine') records = [{ machineSerial: 99004 }];
        if (name === config.stateTickerCollectionName) records = [{ machine, status }];
        if (name === config.machineSessionCollectionName && query.$and?.some(q => q['timestamps.start'] && q.$or)) {
          const overlap = query.$and[0];
          assert.deepEqual(overlap['timestamps.start'], { $lt: end });
          assert.deepEqual(overlap.$or[0], { 'timestamps.end': { $gt: start } });
          records = expectedFaults;
        }
        return { project() { return this; }, sort() { return this; }, toArray: async () => records };
      },
      findOne: async () => null,
    };
  } };
  const router = spindle({ db, logger: console });
  const handler = router.stack.find(l => l.route.path === '/machine/details').route.stack[0].handle;
  const req = { query: { serial: '99004', timeframe: 'custom', start: start.toISOString(), end: end.toISOString() } };
  async function get() {
    let row;
    await handler(req, { json(result) { [row] = result; } });
    return row;
  }
  const row = await get();
  assert.equal(row.performance.faultTime.total, 52 * 60000);
  assert.equal(row.performance.pausedTime.total, 4 * 60000);
  assert.equal(row.faultData.faultSummaries[0].count, 2);
  assert.equal(row.faultData.faultSummaries[0].faultType, status.name);
  assert.equal(row.faultData.faultCycles[1].faultCode, 124);
  assert.deepEqual(row.faultData.faultCycles.map(c => c.duration), [60000, 51 * 60000]);
  expectedFaults = [];
  assert.deepEqual((await get()).faultData, { faultCycles: [], faultSummaries: [] });
});
