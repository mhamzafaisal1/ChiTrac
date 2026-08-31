const test = require("node:test");
const assert = require("node:assert/strict");
const Ajv = require("ajv");
const timestampsSchema = require("../schemas/timestampsSchema");

const validate = new Ajv().compile(timestampsSchema.schema);

const baseTimestamps = () => ({
  create: new Date("2026-08-31T14:00:00.000Z"),
  active: new Date("2026-08-31T14:00:00.000Z"),
  update: new Date("2026-08-31T14:00:00.000Z"),
});

test("timestamps schema allows optional sync timestamp", () => {
  const timestamps = {
    ...baseTimestamps(),
    sync: new Date("2026-08-31T15:00:00.000Z"),
  };

  assert.equal(validate(timestamps), true);
});

test("timestamp helpers preserve and stamp sync", () => {
  const timestamps = {
    ...baseTimestamps(),
    sync: "2026-08-31T15:00:00.000Z",
  };
  const update = new Date("2026-08-31T16:00:00.000Z");
  const sync = new Date("2026-08-31T17:00:00.000Z");

  const updated = timestampsSchema.utils.stampUpdate(timestamps, update);
  const synced = timestampsSchema.utils.stampSync(updated, sync);

  assert.deepEqual(updated.sync, new Date("2026-08-31T15:00:00.000Z"));
  assert.deepEqual(synced.update, update);
  assert.deepEqual(synced.sync, sync);
});
