const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCountSparklineCache,
  appendCompletedMinuteCountSparklineCache,
} = require("../utils/countSparklineCache");

const shifts = [{
  active: true, activeDays: [2],
  startTime: { hour: 8, minute: 0 }, endTime: { hour: 12, minute: 45 },
  breaks: [{ startTime: { hour: 10, minute: 0 }, endTime: { hour: 10, minute: 15 } }],
}];
const config = {
  countCollectionName: "count", machineCollectionName: "config-machine",
  shiftCollectionName: "sparkline-test-shifts",
};

function count(timestamp, serial = 90011, extra = {}) {
  return { timestamps: { create: new Date(timestamp) }, machine: { serial }, ...extra };
}

function createDb(documents, machines = [{ serial: 90011 }]) {
  const queries = [];
  return {
    queries,
    collection(name) {
      if (name !== "count") {
        const cursor = {
          project() { return cursor; },
          async toArray() { return name === config.machineCollectionName ? machines : shifts; },
        };
        return { find: () => cursor };
      }
      return {
        aggregate(pipeline) {
          queries.push(pipeline);
          // Model the database's grouped response while asserting the production query contract.
          assert.deepEqual(pipeline[0].$match.misfeed, { $ne: true });
          assert.equal(pipeline[1].$project.timestamp.$convert.to, "date");
          assert.equal(pipeline[1].$project.serial.$convert.to, "double");
          assert.deepEqual(pipeline[3].$group.count, { $sum: 1 });
          assert.equal(pipeline[3].$group._id.minute.$dateToString.timezone, "UTC");
          const range = pipeline[2].$match.timestamp;
          const buckets = new Map();
          for (const document of documents) {
            const timestamp = new Date(document.timestamps?.create ?? document.timestamp);
            const serial = Number(document.machine?.serial ?? document.machine?.id);
            if (document.misfeed === true || !Number.isFinite(serial) ||
                !(timestamp >= range.$gte && timestamp < range.$lt)) continue;
            timestamp.setUTCSeconds(0, 0);
            const minute = timestamp.toISOString();
            const key = `${serial}|${minute}`;
            const bucket = buckets.get(key) || { _id: { serial, minute }, count: 0 };
            bucket.count += 1;
            buckets.set(key, bucket);
          }
          return { async toArray() { return [...buckets.values()]; } };
        },
      };
    },
  };
}

function point(cache, minute, history = false, serial = "90011") {
  const machines = history ? cache.history.machines : cache.machines;
  return machines[serial].find((value) => value.minuteStart === minute);
}

test("includes working-through-break counts and preserves their break classification", async () => {
  const db = createDb([count("2026-10-06T14:59:10Z"), count("2026-10-06T15:01:10Z")]);
  const cache = await buildCountSparklineCache(db, config, new Date("2026-10-06T15:05:00Z"));
  assert.equal(point(cache, "2026-10-06T14:59:00.000Z").shiftState, "shift");
  assert.equal(point(cache, "2026-10-06T15:01:00.000Z").shiftState, "break");
  assert.equal(point(cache, "2026-10-06T15:01:00.000Z").count, 1);
});

test("reconciles late outside-shift counts older than the former one-minute overlap", async () => {
  const documents = [count("2026-10-06T17:46:10Z")];
  const db = createDb(documents);
  const before = await buildCountSparklineCache(db, config, new Date("2026-10-06T17:49:00Z"));
  documents.push(count("2026-10-06T17:46:20Z"));
  const after = await appendCompletedMinuteCountSparklineCache(db, config, before, new Date("2026-10-06T17:50:00Z"));
  assert.equal(point(before, "2026-10-06T17:46:00.000Z").count, 1);
  assert.equal(point(after, "2026-10-06T17:46:00.000Z").count, 2);
  assert.equal(point(after, "2026-10-06T17:46:00.000Z").shiftState, "outsideShift");
  assert.equal(after.allMachines.find((p) => p.minuteStart === "2026-10-06T17:46:00.000Z").count, 2);
});

test("reconciles late counts in comparison history, including unconfigured machines", async () => {
  const documents = [];
  const db = createDb(documents);
  const before = await buildCountSparklineCache(db, config, new Date("2026-10-06T17:49:00Z"));
  documents.push(count("2026-10-05T17:46:10Z", 90012));
  const after = await appendCompletedMinuteCountSparklineCache(db, config, before, new Date("2026-10-06T17:50:00Z"));
  assert.equal(point(after, "2026-10-05T17:46:00.000Z", true, "90012").count, 1);
  assert.deepEqual(after.machineSerials, [90011, 90012]);
  assert.equal(db.queries.at(-1)[2].$match.timestamp.$gte.toISOString(), "2026-10-05T16:50:00.000Z");
});

test("removes stale counts after correction instead of merging them forever", async () => {
  const documents = [count("2026-10-06T17:46:10Z")];
  const db = createDb(documents);
  const before = await buildCountSparklineCache(db, config, new Date("2026-10-06T17:49:00Z"));
  documents.length = 0;
  const after = await appendCompletedMinuteCountSparklineCache(db, config, before, new Date("2026-10-06T17:50:00Z"));
  assert.equal(point(after, "2026-10-06T17:46:00.000Z").count, 0);
});

test("retains legacy timestamps, excludes misfeeds, and displays completed minutes only", async () => {
  const db = createDb([
    { timestamp: new Date("2026-10-06T17:46:10Z"), machine: { id: "90011" } },
    count("2026-10-06T17:46:20Z", 90011, { misfeed: true }),
    count("2026-10-06T17:50:00Z"),
    count("2026-10-05T16:49:00Z"),
  ]);
  const cache = await buildCountSparklineCache(db, config, new Date("2026-10-06T17:50:30Z"));
  assert.equal(point(cache, "2026-10-06T17:46:00.000Z").count, 1);
  assert.equal(cache.allMachines.length, 60);
  assert.equal(cache.allMachines.at(-1).minuteStart, "2026-10-06T17:49:00.000Z");
  assert.equal(cache.history.allMachines.reduce((sum, p) => sum + p.count, 0), 0);
});
