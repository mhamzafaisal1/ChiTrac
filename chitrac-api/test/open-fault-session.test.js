const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPEN_FAULT_SESSION_STALE_MS,
  effectiveFaultSessionEnd,
  effectiveFaultSessionEndExpression,
} = require('../utils/openFaultSession');
const { buildFaultSessionMatch } = require('../controllers/fault');
const { getMachineFaultSummariesBySerial } = require('../utils/faultTimeSummary');

const at = minutes => new Date(Date.UTC(2026, 10, 25, 15, 0) + minutes * 60000);
const now = at(30);

// Minimal evaluator for the operators used by effectiveFaultSessionEndExpression,
// so the MongoDB expression is checked against the JavaScript rule.
function evaluate(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return expr.slice(1).split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
  }
  if (expr instanceof Date || typeof expr !== 'object' || expr === null) return expr;
  const [op, args] = Object.entries(expr)[0];
  const values = args.map(arg => evaluate(arg, doc));
  switch (op) {
    case '$ifNull': return values[0] ?? values[1];
    case '$min': return new Date(Math.min(...values.map(Number)));
    case '$max': return new Date(Math.max(...values.map(Number)));
    case '$add': return new Date(values.reduce((sum, v) => sum + Number(v), 0));
    default: throw new Error(`unsupported ${op}`);
  }
}

const cases = {
  closed: { session: { timestamps: { start: at(0), end: at(3), update: at(3) } }, expected: at(3) },
  'open and still reported on (Cascade heartbeat)': { session: { timestamps: { start: at(0), end: null, update: at(29.9) } }, expected: now },
  'open, last update 20 min ago (orphaned)': { session: { timestamps: { start: at(0), end: null, update: at(10) } }, expected: at(15) },
  'open, never updated (legacy cap from start)': { session: { timestamps: { start: at(0) } }, expected: at(5) },
  'open, update missing but end field missing too': { session: { timestamps: { start: at(26) } }, expected: now },
};

for (const [name, { session, expected }] of Object.entries(cases)) {
  test(`open fault session end: ${name}`, () => {
    assert.equal(+effectiveFaultSessionEnd(session, now), +expected);
    assert.equal(+evaluate(effectiveFaultSessionEndExpression(now), session), +expected, 'MongoDB expression agrees');
  });
}

test('stale window is five minutes', () => {
  assert.equal(OPEN_FAULT_SESSION_STALE_MS, 5 * 60 * 1000);
});

test('fault history match includes datafeed sessions whose end is null', () => {
  const match = buildFaultSessionMatch(at(0), now);
  const endClause = match.$and.find(clause => clause.$or?.some(alt => 'timestamps.end' in alt)).$or;
  assert.ok(endClause.some(alt => alt['timestamps.end'] === null), 'matches end: null (and missing)');
  assert.ok(!endClause.some(alt => alt['timestamps.end']?.$exists === false), 'no longer relies on $exists: false');
});

test('dashboard fault summaries count a live open fault up to now, not 5 min', async () => {
  const sessions = [
    { machine: { serial: 90050 }, startState: { status: { code: 2110, name: 'LR Estop' } },
      timestamps: { start: at(0), end: null, update: at(29.9) } },
    { machine: { serial: 90050 }, startState: { status: { code: 2111, name: 'LF Estop' } },
      timestamps: { start: at(0), end: null, update: at(1) } }, // orphaned
  ];
  const db = { collection: () => ({ find: () => ({ project: () => ({ sort: () => ({ toArray: async () => sessions }) }) }) }) };
  const result = await getMachineFaultSummariesBySerial(db, { machineSessionCollectionName: 'session-machine' }, [90050], at(0), now);
  const byName = Object.fromEntries(result.get(90050).map(row => [row.name, row.totalDurationSeconds]));
  assert.equal(byName['LR Estop'], 30 * 60);
  assert.equal(byName['LF Estop'], 6 * 60);
});
