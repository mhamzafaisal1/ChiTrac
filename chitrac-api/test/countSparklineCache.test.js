"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LOOKBACK_MINUTES,
  RETENTION_MINUTES,
  buildCountSparklineCache,
  appendCompletedMinuteCountSparklineCache,
} = require("../utils/countSparklineCache");

function createCursor(rows) {
  return {
    project() {
      return this;
    },
    async toArray() {
      return rows;
    },
  };
}

function createDb(counts, countQueries) {
  return {
    collection(name) {
      if (name === "config-machine") {
        return {
          find: () => createCursor([{ id: 99001, active: true }]),
        };
      }

      if (name === "config-shift-count-sparkline-test") {
        return {
          find: () => createCursor([]),
        };
      }

      if (name === "count") {
        return {
          find(query) {
            const range = query.$or[0]["timestamps.create"];
            countQueries.push({ start: range.$gte, end: range.$lt });
            const rows = counts.filter((count) => {
              const timestamp = new Date(count.timestamps.create);
              return timestamp >= range.$gte && timestamp < range.$lt;
            });
            return createCursor(rows);
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

const config = {
  machineCollectionName: "config-machine",
  countCollectionName: "count",
  shiftCollectionName: "config-shift-count-sparkline-test",
};

function countAt(timestamp) {
  return {
    timestamps: { create: new Date(timestamp) },
    machine: { serial: 99001 },
    misfeed: false,
  };
}

test("cold start hydrates 60 current minutes and the preceding 24 hours of history", async () => {
  const countQueries = [];
  const counts = [
    countAt("2026-09-25T11:45:20.000Z"),
    countAt("2026-09-25T10:30:10.000Z"),
  ];
  const now = new Date("2026-09-25T12:00:30.000Z");

  const cache = await buildCountSparklineCache(createDb(counts, countQueries), config, now);

  assert.equal(cache.lookbackMinutes, LOOKBACK_MINUTES);
  assert.equal(cache.retentionMinutes, RETENTION_MINUTES);
  assert.equal(cache.allMachines.length, 60);
  assert.equal(cache.history.allMachines.length, 24 * 60);
  assert.equal(cache.allMachines.find((point) => point.minuteStart === "2026-09-25T11:45:00.000Z").count, 1);
  assert.equal(cache.history.allMachines.find((point) => point.minuteStart === "2026-09-25T10:30:00.000Z").count, 1);
  assert.equal(countQueries.length, 1);
  assert.equal(countQueries[0].start.toISOString(), "2026-09-24T11:00:00.000Z");
  assert.equal(countQueries[0].end.toISOString(), "2026-09-25T12:00:00.000Z");
});

test("minute refresh moves expired current buckets into history and reads only the incremental window", async () => {
  const countQueries = [];
  const counts = [countAt("2026-09-25T11:00:20.000Z")];
  const db = createDb(counts, countQueries);
  const initial = await buildCountSparklineCache(db, config, new Date("2026-09-25T12:00:30.000Z"));

  counts.push(countAt("2026-09-25T12:00:15.000Z"));
  const updated = await appendCompletedMinuteCountSparklineCache(
    db,
    config,
    initial,
    new Date("2026-09-25T12:01:05.000Z")
  );

  assert.equal(updated.allMachines.length, 60);
  assert.equal(updated.history.allMachines.length, 24 * 60);
  assert.equal(updated.history.allMachines.at(-1).minuteStart, "2026-09-25T11:00:00.000Z");
  assert.equal(updated.history.allMachines.at(-1).count, 1);
  assert.equal(updated.allMachines.at(-1).minuteStart, "2026-09-25T12:00:00.000Z");
  assert.equal(updated.allMachines.at(-1).count, 1);
  assert.equal(updated.history.range.start.toISOString(), "2026-09-24T11:01:00.000Z");
  assert.equal(countQueries.length, 2);
  assert.equal(countQueries[1].start.toISOString(), "2026-09-25T11:59:00.000Z");
  assert.equal(countQueries[1].end.toISOString(), "2026-09-25T12:01:00.000Z");
});
