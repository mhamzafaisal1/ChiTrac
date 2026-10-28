const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCurrentOperators } = require('../utils/machineFunctions');
const { buildOperatorFaultHistoryFromSessions, buildItemSummaryFromItemSessions } = require('../utils/operatorFunctions');
const config = require('../modules/config');

function matches(document, query) {
  return Object.entries(query).every(([path, expected]) => {
    if (path === '$and') return expected.every(part => matches(document, part));
    if (path === '$or') return expected.some(part => matches(document, part));
    const actual = path.split('.').reduce((object, key) => object?.[key], document);
    if (expected === null) return actual == null;
    if (expected && typeof expected === 'object') {
      if ('$exists' in expected) return expected.$exists === (actual !== undefined);
      if ('$lt' in expected) return new Date(actual) < expected.$lt;
      if ('$gt' in expected) return new Date(actual) > expected.$gt;
    }
    return actual === expected;
  });
}

function database(data) {
  return { collection: name => ({ find: query => {
    const documents = (data[name] || []).filter(doc => matches(doc, query));
    return {
      project() { return this; }, sort() { return this; }, limit() { return this; },
      async toArray() { return documents; },
    };
  } }) };
}

test('current operators are found by canonical machine id, including sessions without serial', async () => {
  const db = database({
    [config.machineSessionCollectionName]: [{ machine: { id: 21 }, operators: [{ id: 11 }] }],
    [config.operatorSessionCollectionName]: [{ machine: { id: 21, name: 'Machine' }, operator: { id: 11, name: 'Operator' }, totalCount: 3 }],
  });
  const operators = await buildCurrentOperators(db, 21);
  assert.equal(operators.length, 1);
  assert.equal(operators[0].machineSerial, 21);
  assert.equal(operators[0].metrics.validCount, 3);
});

test('fault history reads canonical and legacy sessions but rejects conflicting serial aliases', async () => {
  const base = { operator: { id: 11 }, status: { code: 10, name: 'Door' },
    timestamps: { start: new Date('2026-10-26T15:00:00Z'), end: new Date('2026-10-26T15:01:00Z') } };
  const db = database({ [config.operatorSessionCollectionName]: [
    { ...base, _id: 'canonical', machine: { id: 21 } },
    { ...base, _id: 'legacy', machine: { serial: 21 } },
    { ...base, _id: 'other-machine', machine: { id: 22, serial: 21 } },
  ] });
  const result = await buildOperatorFaultHistoryFromSessions(db, 11,
    new Date('2026-10-26T14:00:00Z'), new Date('2026-10-26T16:00:00Z'), 21);
  assert.deepEqual(result.faultCycles.map(row => row.id), ['canonical', 'legacy']);
  assert.equal(result.faultSummaries[0].totalDurationSeconds, 120);
});

test('operator item summary reads the singular operator id written by the datafeed', async () => {
  const db = database({ [config.itemSessionCollectionName]: [{
    machine: { id: 21, serial: 99 }, operator: { id: 11 }, item: { id: 101, name: 'Sheets', standard: 120 },
    timestamps: { start: new Date('2026-10-26T15:00:00Z'), end: new Date('2026-10-26T15:01:00Z') },
    totalCount: 2, workTime: 60,
  }] });
  const result = await buildItemSummaryFromItemSessions(db, 11,
    new Date('2026-10-26T14:00:00Z'), new Date('2026-10-26T16:00:00Z'), 21);
  assert.equal(result.operatorSummary.totalCount, 2);
  assert.equal(result.sessions[0].machine.serial, 21);
});
