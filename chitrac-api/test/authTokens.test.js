const assert = require("node:assert/strict");
const test = require("node:test");

const { partitionTokens } = require("../controllers/auth");

test("partitionTokens includes active and legacy tokens in the active list", () => {
  const createdAt = new Date("2026-09-01T12:00:00.000Z");
  const result = partitionTokens([
    { _id: "active", name: "Active", isActive: true, createdAt },
    { _id: "legacy", name: "Legacy", createdAt }
  ]);

  assert.deepEqual(result.tokens.map((token) => token.id), ["active", "legacy"]);
  assert.equal(result.tokens[1].isActive, true);
  assert.equal(result.deactivatedTokens.length, 0);
});

test("partitionTokens includes current and legacy deactivated tokens", () => {
  const createdAt = new Date("2026-09-01T12:00:00.000Z");
  const deactivatedAt = new Date("2026-09-02T12:00:00.000Z");
  const result = partitionTokens([
    { _id: "current", name: "Current", isActive: false, createdAt },
    { _id: "legacy", name: "Legacy", createdAt, deactivatedAt }
  ]);

  assert.deepEqual(result.deactivatedTokens.map((token) => token.id), ["current", "legacy"]);
  assert.equal(result.deactivatedTokens[1].isActive, false);
  assert.deepEqual(result.deactivatedTokens[1].timestamps.inactive, deactivatedAt);
  assert.equal(result.tokens.length, 0);
});
