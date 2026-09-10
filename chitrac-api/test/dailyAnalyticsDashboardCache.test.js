const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMachineTimelineFromSessions,
} = require("../utils/dailyAnalyticsDashboardCache");

const config = {
  machineCollectionName: "machines",
  machineSessionCollectionName: "sessions",
};

function fakeDb(machines, sessions) {
  return {
    collection(name) {
      const values = name === config.machineCollectionName ? machines : sessions;
      const cursor = {
        project() {
          return cursor;
        },
        sort() {
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

async function buildChunk(session, start = "2026-09-10T10:00:00.000Z", end = "2026-09-10T11:00:00.000Z") {
  const db = fakeDb([{ serial: 1001, name: "Machine 1" }], [session]);
  const timeline = await buildMachineTimelineFromSessions(db, config, start, end);
  return timeline.machines[0].sessions.find((chunk) => chunk.id === String(session._id));
}

test("legacy multistation efficiency uses station-adjusted worked time", async () => {
  const chunk = await buildChunk({
    _id: "legacy-running",
    machine: { serial: 1001, name: "Machine 1" },
    timestamps: {
      start: new Date("2026-09-10T10:10:00.000Z"),
      end: new Date("2026-09-10T10:20:00.000Z"),
    },
    startState: { status: { id: 1, name: "Running" } },
    runtime: 600,
    workTime: 600,
    totalTimeCredit: 1200,
    operators: [{ id: 10 }, { id: 20 }, { id: -1 }],
  });

  assert.equal(chunk.efficiency, 100);
});

test("modern worked-time metrics remain authoritative", async () => {
  const chunk = await buildChunk({
    _id: "modern-running",
    machine: { serial: 1001, name: "Machine 1" },
    timestamps: {
      start: new Date("2026-09-10T10:10:00.000Z"),
      end: new Date("2026-09-10T10:20:00.000Z"),
    },
    startState: { status: { id: 1, name: "Running" } },
    runtime: 600,
    workTime: 600,
    totalTimeCredit: 1200,
    operators: [{ id: 10 }, { id: 20 }],
    metrics: {
      timers: { worked: 900000 },
      totals: { timeCredit: 450000 },
    },
  });

  assert.equal(chunk.efficiency, 50);
});

test("timeline chunks retain fault metadata and full session duration", async () => {
  const chunk = await buildChunk({
    _id: "fault-session",
    machine: { serial: 1001, name: "Machine 1" },
    timestamps: {
      start: new Date("2026-09-10T09:55:00.000Z"),
      end: new Date("2026-09-10T10:05:00.000Z"),
    },
    startState: { status: { id: 42, name: "Guard Open" } },
  });

  assert.equal(chunk.status, "faulted");
  assert.equal(chunk.statusCode, 42);
  assert.equal(chunk.statusLabel, "Guard Open");
  assert.equal(chunk.durationMs, 5 * 60 * 1000);
  assert.equal(chunk.totalDurationMs, 10 * 60 * 1000);
});
