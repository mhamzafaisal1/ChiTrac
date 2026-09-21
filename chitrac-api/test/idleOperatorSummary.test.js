const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildIdleOperatorSummary,
  emptyIdleOperatorSummary,
} = require("../utils/idleOperatorSummary");
const {
  cacheEnvelope,
  machineDashboardEnvelope,
  operatorDashboardEnvelope,
} = require("../modules/mongoWatchers");

const config = {
  operatorSessionCollectionName: "operator-sessions",
  stateTickerCollectionName: "state-tickers",
};

function fakeDb(operatorSessions, stateTickers) {
  return {
    collection(name) {
      const values = name === config.operatorSessionCollectionName ? operatorSessions : stateTickers;
      const cursor = {
        project() {
          return cursor;
        },
        async toArray() {
          return values;
        },
      };
      return {
        find() {
          return cursor;
        },
      };
    },
  };
}

test("idle operator summary reuses the REST definition for cached shift data", async () => {
  const db = fakeDb(
    [
      { operator: { id: 10 } },
      { operator: { id: "20" } },
      { operator: { id: 20 } },
      { operator: { id: -1 } },
    ],
    [
      { operators: [{ id: "10" }, { id: -1 }] },
      { operators: null },
    ]
  );
  const context = {
    shiftOid: "shift-1",
    mode: "complete",
    start: new Date("2026-09-21T13:00:00.000Z"),
    end: new Date("2026-09-21T21:00:00.000Z"),
  };

  const summary = await buildIdleOperatorSummary(db, config, context);

  assert.equal(summary.shiftOperators, 2);
  assert.equal(summary.activeOperators, 1);
  assert.equal(summary.idleOperators, 1);
  assert.deepEqual(summary.idleOperatorIds, [20]);
  assert.equal(summary.shiftId, "shift-1");
  assert.equal(summary.shiftMode, "complete");
});

test("idle operator summary is empty when there is no applicable shift", async () => {
  const summary = await buildIdleOperatorSummary(fakeDb([], []), config, null);

  assert.deepEqual(summary.idleOperatorIds, []);
  assert.equal(summary.idleOperators, 0);
  assert.equal(summary.shiftMode, "none");
});

test("dashboard envelopes include supporting infobox data and projection metadata", () => {
  const idleOperatorSummary = {
    ...emptyIdleOperatorSummary(),
    idleOperators: 2,
    idleOperatorIds: [20, 30],
  };
  const meta = {
    shiftId: "shift-1",
    mode: "complete",
    projectionWindow: { elapsedShiftMs: 1000, totalShiftMs: 2000 },
  };

  const combined = cacheEnvelope({
    machinesSummary: [{ machine: { serial: 1 } }],
    operatorsSummary: [{ operator: { id: 10 } }],
    idleOperatorSummary,
  }, meta);
  const machines = machineDashboardEnvelope(combined.machinesSummary, meta, idleOperatorSummary);
  const operators = operatorDashboardEnvelope(combined.operatorsSummary, meta, idleOperatorSummary);

  assert.equal(combined.idleOperatorSummary.idleOperators, 2);
  assert.equal(machines.meta.projectionWindow.totalShiftMs, 2000);
  assert.deepEqual(machines.idleOperatorSummary.idleOperatorIds, [20, 30]);
  assert.deepEqual(operators.idleOperatorSummary.idleOperatorIds, [20, 30]);
});
