const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionStatsCache,
  productionWindowRanges,
  scheduledBreakMs,
  scheduledShiftMs,
  statsFromTotals,
} = require("../utils/productionStatsCache");

function totalDocument(type, minuteStart, machine, operator, totals) {
  return {
    type,
    timestamps: { start: new Date(minuteStart), create: new Date(minuteStart) },
    machine,
    operator,
    totals,
  };
}

test("uses the current partial minute plus five preceding minute buckets for Current", () => {
  const ranges = productionWindowRanges(new Date("2026-09-24T14:05:30.000Z"));
  assert.equal(ranges.lastSixMinutes.start.toISOString(), "2026-09-24T14:00:00.000Z");
  assert.equal(ranges.lastSixMinutes.end.toISOString(), "2026-09-24T14:05:30.000Z");
  assert.equal(ranges.lastFifteenMinutes.start.toISOString(), "2026-09-24T13:51:00.000Z");
  assert.equal(ranges.lastHour.start.toISOString(), "2026-09-24T13:06:00.000Z");
  assert.equal(ranges.last24Hours.start.toISOString(), "2026-09-23T14:06:00.000Z");
});

test("subtracts scheduled breaks from elapsed time but retains their production totals", () => {
  const start = new Date("2026-09-24T14:00:00.000Z");
  const end = new Date("2026-09-24T14:05:30.000Z");
  const shifts = [{
    active: true,
    activeDays: [4],
    startTime: { hour: 9, minute: 0 },
    endTime: { hour: 17, minute: 0 },
    breaks: [{ startTime: { hour: 9, minute: 3 }, endTime: { hour: 9, minute: 4 } }],
  }];
  const breakTimeMs = scheduledBreakMs(shifts, start, end);
  const shiftTimeMs = scheduledShiftMs(shifts, start, end);
  const stats = statsFromTotals({
    validCount: 9,
    rejectCount: 1,
    runtimeMs: 330000,
    workedTimeMs: 330000,
    pausedTimeMs: 0,
    faultTimeMs: 0,
    offlineTimeMs: 0,
    timeCreditMs: 165000,
  }, { start, end }, breakTimeMs, shiftTimeMs);

  assert.equal(breakTimeMs, 60000);
  assert.equal(shiftTimeMs, 330000);
  assert.equal(stats.availabilityPercent, 100);
  assert.equal(stats.efficiencyPercent, 50);
  assert.equal(stats.throughputPercent, 90);
  assert.equal(stats.oeePercent, 45);
  assert.equal(stats.runtimeMs, 330000);
  assert.equal(stats.shiftTimeMs, 330000);
  assert.equal(stats.breakTimeMs, 60000);
});

test("uses valid shift time instead of time since midnight for All Day OEE", () => {
  const now = new Date("2026-09-24T16:00:00.000Z");
  const machine = { id: 90007, serial: 90007, name: "LPL1" };
  const documents = [totalDocument("machine", "2026-09-24T15:59:00.000Z", machine, null, {
    runtimeMs: 4 * 60 * 60 * 1000,
    workedTimeMs: 4 * 60 * 60 * 1000,
    count: 100,
    misfeeds: 0,
    timeCreditMs: 4.36 * 60 * 60 * 1000,
  })];
  const shifts = [{
    active: true,
    activeDays: [4],
    startTime: { hour: 7, minute: 0 },
    endTime: { hour: 13, minute: 30 },
    breaks: [],
  }];

  const cache = buildProductionStatsCache(documents, [], shifts, now);
  const allDay = cache.machines["90007"].stats.today;

  assert.equal(allDay.shiftTimeMs, 4 * 60 * 60 * 1000);
  assert.equal(allDay.availabilityPercent, 100);
  assert.equal(allDay.efficiencyPercent, 109);
  assert.equal(allDay.throughputPercent, 100);
  assert.equal(allDay.oeePercent, 109);
});

test("groups operators by operator-machine and returns N/A-compatible null percentages", () => {
  const now = new Date("2026-09-24T14:05:30.000Z");
  const machine = { id: 90001, serial: 90001, name: "SPF1" };
  const operator = { id: 11, name: "Sandra Frei", station: 1 };
  const documents = [
    totalDocument("machine", "2026-09-24T14:05:00.000Z", machine, null, {
      runtimeMs: 30000,
      workedTimeMs: 30000,
      count: 2,
      misfeeds: 1,
      timeCreditMs: 20000,
    }),
    totalDocument("operator-machine", "2026-09-24T14:05:00.000Z", machine, operator, {
      runtimeMs: 30000,
      workedTimeMs: 30000,
      count: 2,
      misfeeds: 1,
      timeCreditMs: 20000,
    }),
  ];
  const tickers = [
    { machine, operators: [operator], status: { code: 1, name: "System_Running" } },
    {
      machine: { id: 90002, serial: 90002, name: "SPF2" },
      operators: [{ id: 11, name: "Sandra Frei", station: 1 }],
      status: { code: 1, name: "System_Running" },
    },
  ];

  const cache = buildProductionStatsCache(documents, tickers, [], now);
  assert.ok(cache.operators["90001:11"]);
  assert.ok(cache.operators["90002:11"]);
  assert.equal(cache.operators["90001:11"].stats.lastSixMinutes.validCount, 2);
  assert.equal(cache.operators["90001:11"].stats.lastSixMinutes.rejectCount, 1);
  assert.equal(cache.operators["90002:11"].stats.lastSixMinutes.hasData, false);
  assert.equal(cache.operators["90002:11"].stats.lastSixMinutes.efficiencyPercent, null);
  assert.equal(cache.operators["90002:11"].stats.lastSixMinutes.oeePercent, null);
});

test("counts activity outside configured shifts", () => {
  const now = new Date("2026-09-24T04:05:30.000Z");
  const machine = { serial: 90001, name: "SPF1" };
  const documents = [totalDocument("machine", "2026-09-24T04:05:00.000Z", machine, null, {
    runtimeMs: 30000,
    workedTimeMs: 30000,
    count: 1,
    timeCreditMs: 30000,
  })];
  const shifts = [{
    active: true,
    activeDays: [3],
    startTime: { hour: 9, minute: 0 },
    endTime: { hour: 17, minute: 0 },
    breaks: [],
  }];

  const cache = buildProductionStatsCache(documents, [], shifts, now);
  assert.equal(cache.machines["90001"].stats.lastSixMinutes.runtimeMs, 30000);
  assert.equal(cache.machines["90001"].stats.lastSixMinutes.validCount, 1);
});
