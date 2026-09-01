const test = require("node:test");
const assert = require("node:assert/strict");
const { getOperatorSessionDataForPartialDays } = require("../utils/reportFunctions");

function collectionFor(rows) {
  return {
    find() {
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

test("operator report session fallback splits worked, paused, and fault time by status code", async () => {
  const start = new Date("2026-08-31T12:00:00.000Z");
  const end = new Date("2026-08-31T12:10:00.000Z");
  const operator = { id: 101, name: "Test Operator" };

  const db = {
    collection() {
      return collectionFor([
        {
          status: { code: 1 },
          operator,
          timestamps: {
            start: new Date("2026-08-31T11:58:00.000Z"),
            end: new Date("2026-08-31T12:06:00.000Z"),
          },
          counts: [
            { timestamp: new Date("2026-08-31T11:59:00.000Z"), item: { name: "Outside", standard: 100 } },
            { timestamp: new Date("2026-08-31T12:03:00.000Z"), item: { name: "Sheets", standard: 350 } },
            { timestamp: new Date("2026-08-31T12:05:00.000Z"), item: { name: "Sheets", standard: 350 } },
          ],
        },
        {
          status: { code: 0 },
          operator,
          timestamps: {
            start: new Date("2026-08-31T12:00:00.000Z"),
            end: new Date("2026-08-31T12:02:00.000Z"),
          },
        },
        {
          status: { code: 42 },
          operator,
          timestamps: {
            start: new Date("2026-08-31T12:06:00.000Z"),
            end: new Date("2026-08-31T12:09:00.000Z"),
          },
        },
      ]);
    },
  };

  const { operators } = await getOperatorSessionDataForPartialDays(db, [{ start, end }]);
  const [summary] = operators;

  assert.equal(summary.runtimeMs, 6 * 60 * 1000);
  assert.equal(summary.workedTimeMs, 6 * 60 * 1000);
  assert.equal(summary.pausedTimeMs, 2 * 60 * 1000);
  assert.equal(summary.faultTimeMs, 3 * 60 * 1000);
  assert.equal(summary.totalFaults, 1);
  assert.equal(summary.totalCounts, 2);
});
