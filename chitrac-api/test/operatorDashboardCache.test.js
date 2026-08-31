const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOperatorSummaryRows } = require("../utils/operatorDashboardCache");

function collectionFor(name, data) {
  return {
    find() {
      const rows = data[name] || [];
      return {
        project() {
          return this;
        },
        async toArray() {
          return rows;
        },
      };
    },
  };
}

test("operator dashboard derives paused and fault time from machine session types", async () => {
  const start = new Date("2026-08-31T12:00:00.000Z");
  const end = new Date("2026-08-31T12:10:00.000Z");
  const data = {
    "ticker-state": [
      {
        machine: { serial: 99001, name: "Machine 1" },
        status: { code: 1, name: "Running", timestamp: end },
        operators: [{ id: 101 }],
      },
    ],
    "session-machine": [
      {
        type: 1,
        timestamps: {
          start: new Date("2026-08-31T12:00:00.000Z"),
          end: new Date("2026-08-31T12:04:00.000Z"),
        },
        operators: [{ id: 101 }],
      },
      {
        type: 0,
        timestamps: {
          start: new Date("2026-08-31T11:55:00.000Z"),
          end: new Date("2026-08-31T12:06:00.000Z"),
        },
        operators: [{ id: 101 }],
      },
      {
        type: 42,
        timestamps: {
          start: new Date("2026-08-31T12:06:00.000Z"),
          end: new Date("2026-08-31T12:09:00.000Z"),
        },
        operators: [{ id: 101 }],
      },
    ],
  };
  const db = {
    collection(name) {
      return collectionFor(name, data);
    },
  };

  const [row] = await buildOperatorSummaryRows(
    db,
    {
      machineSessionCollectionName: "session-machine",
      stateTickerCollectionName: "ticker-state",
    },
    [
      {
        operatorId: 101,
        operatorName: "Test Operator",
        runtimeMs: 10 * 60 * 1000,
        workedTimeMs: 10 * 60 * 1000,
        totalCounts: 10,
        totalMisfeeds: 0,
        totalTimeCreditMs: 4 * 60 * 1000,
        timeRange: { start, end },
      },
    ],
    [
      {
        startTime: { hour: 7, minute: 0 },
        endTime: { hour: 7, minute: 10 },
        activeDays: [1],
      },
    ],
    start,
    end
  );

  assert.equal(row.metrics.runtime.total, 4 * 60 * 1000);
  assert.equal(row.metrics.pausedTime.total, 2 * 60 * 1000);
  assert.equal(row.metrics.faultTime.total, 3 * 60 * 1000);
});
