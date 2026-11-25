const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const downtimeRoutes = require('../controllers/downtime');
const {
  downtimeCategory,
  getMachineDowntimeSummariesBySerial,
  getMachineFaultSummariesBySerial,
} = require('../utils/faultTimeSummary');
const { buildDowntimeParetoPayload } = require('../utils/machineDashboardCache');

const at = minutes => new Date(Date.UTC(2025, 10, 25, 15, 0) + minutes * 60000);
const config = { machineSessionCollectionName: 'session-machine' };
const fakeDb = sessions => ({
  collection: () => ({ find: () => ({ project: () => ({ sort: () => ({ toArray: async () => sessions }) }) }) }),
});
const session = (code, name, start, end) => ({
  machine: { serial: 90050 },
  startState: { status: { code, name } },
  timestamps: { start: at(start), end: at(end), update: at(end) },
});

const sessions = [
  session(2110, 'LR Estop', 0, 10),
  session(0, 'Paused', 10, 25),
  session(-1, 'Offline', 25, 40),
  session(1, 'Running', 40, 60),
];

test('downtimeCategory maps status codes', () => {
  assert.equal(downtimeCategory(0), 'paused');
  assert.equal(downtimeCategory(-1), 'offline');
  assert.equal(downtimeCategory(2110), 'fault');
  assert.equal(downtimeCategory(1), null);
  assert.equal(downtimeCategory(undefined), null);
});

test('downtime summaries include fault, paused and offline, never running', async () => {
  const rows = (await getMachineDowntimeSummariesBySerial(fakeDb(sessions), config, [90050], at(0), at(60))).get(90050);
  const byCategory = Object.fromEntries(rows.map(row => [row.category, row.totalDurationSeconds]));
  assert.deepEqual(byCategory, { fault: 600, paused: 900, offline: 900 });
});

test('fault summaries stay fault-only (offline is not a fault)', async () => {
  const rows = (await getMachineFaultSummariesBySerial(fakeDb(sessions), config, [90050], at(0), at(60))).get(90050);
  assert.deepEqual(rows.map(row => row.code), [2110]);
});

test('pareto payload totals each category', async () => {
  const rows = (await getMachineDowntimeSummariesBySerial(fakeDb(sessions), config, [90050], at(0), at(60))).get(90050);
  const payload = buildDowntimeParetoPayload(rows);
  assert.equal(payload.totalDurationSeconds, 2400);
  assert.equal(payload.categories.paused.totalDurationSeconds, 900);
  assert.equal(payload.categories.fault.totalCount, 1);
  assert.equal(payload.summaries.length, 3);
});

test('the Pareto API includes historical machines and honors a requested serial', async (t) => {
  const retiredMachine = {
    ...session(0, 'Paused', 10, 25),
    machine: { serial: '90051', name: 'Retired Washer' },
  };
  const db = {
    collection(name) {
      assert.equal(name, config.machineSessionCollectionName);
      return {
        find({ $and: filters }) {
          const serials = filters.flatMap(filter => filter.$or || [])
            .find(term => term['machine.serial'])?.['machine.serial'].$in;
          const matches = [sessions[0], retiredMachine].filter(row => !serials || serials.includes(row.machine.serial));
          return { project: () => ({ sort: () => ({ toArray: async () => matches }) }) };
        },
      };
    },
  };
  const app = express();
  app.use('/api/downtime', downtimeRoutes({ db, config, logger: console }));
  const listener = await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => listener.close(resolve)));

  const url = new URL('/api/downtime/analytics/summary', `http://127.0.0.1:${listener.address().port}`);
  url.search = new URLSearchParams({ start: at(0).toISOString(), end: at(60).toISOString() });
  const fetchSummaries = async () => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    return (await response.json()).summaries;
  };

  const rows = await fetchSummaries();
  assert.deepEqual(rows.map(row => row.machineSerial), [90051, 90050]);
  assert.equal(rows[0].machineName, 'Retired Washer');
  assert.equal(rows[0].totalDurationSeconds, 900);
  url.searchParams.set('serial', '90050');
  assert.deepEqual((await fetchSummaries()).map(row => row.machineSerial), [90050]);
});
