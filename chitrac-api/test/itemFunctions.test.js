const test = require("node:test");
const assert = require("node:assert/strict");
const { buildItemSummaryRows } = require("../utils/itemFunctions");

test("item summary efficiency uses count, worked time, and standard", () => {
  const [row] = buildItemSummaryRows([
    {
      itemId: 10,
      itemName: "Sheets",
      itemStandard: 100,
      totalCounts: 100,
      workedTimeMs: 7200000,
      totalTimeCreditMs: 3600000,
    },
  ]);

  assert.equal(row.count, 100);
  assert.equal(row.pph, 50);
  assert.equal(row.efficiency, 50);
});

test("item summary falls back to count and standard when time credit is missing", () => {
  const [row] = buildItemSummaryRows([
    {
      itemId: 11,
      itemName: "Towels",
      itemStandard: 100,
      totalCounts: 100,
      workedTimeMs: 3600000,
    },
  ]);

  assert.equal(row.pph, 100);
  assert.equal(row.efficiency, 100);
});
