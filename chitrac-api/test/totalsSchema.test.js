const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const {
  calendarRange,
  translateTotalsFilter,
  normalizeTotalsDocument,
  toNewTotalsDocument,
} = require("../utils/totalsSchema");

const FIVE_TYPES = [
  "machine",
  "operator-machine",
  "machine-item",
  "item",
  "operator-item",
];

function newDocument(type = "operator-item") {
  return {
    _id: new ObjectId(),
    id: `${type}-173878-42-99003-2026-07-06`,
    type,
    timestamps: {
      create: new Date("2026-07-06T05:00:00.000Z"),
      active: new Date("2026-07-06T05:00:00.000Z"),
      update: new Date("2026-07-06T18:00:00.000Z"),
      start: new Date("2026-07-06T13:00:00.000Z"),
      end: new Date("2026-07-06T14:00:00.000Z"),
    },
    machine: { id: 99003, name: "Machine 3" },
    operator: { id: 173878, name: { first: "A", surname: "Operator" } },
    item: { id: 42, name: "Item 42", standard: 120 },
    shift: { _id: new ObjectId(), id: "shift-a", name: "First" },
    totals: {
      runtimeMs: 100,
      faultTimeMs: 20,
      workedTimeMs: 80,
      pausedTimeMs: 10,
      breakTimeMs: 30,
      faults: 2,
      count: 7,
      misfeeds: 1,
      timeCreditMs: 90,
    },
    source: "simulator",
  };
}

test("normalizes all five totals types without replacing BSON _id", () => {
  for (const type of FIVE_TYPES) {
    const source = newDocument(type);
    const result = normalizeTotalsDocument(source);
    assert.equal(result._id, source._id);
    assert.equal(result.id, source.id);
    assert.equal(result.entityType, type);
    assert.equal(result.machineSerial, 99003);
    assert.equal(result.operatorId, 173878);
    assert.equal(result.itemId, 42);
    assert.equal(result.totalCounts, 7);
    assert.equal(result.breakTimeMs, 30);
  }
});

test("translates daily filters to half-open Chicago BSON ranges", () => {
  const filter = translateTotalsFilter({
    entityType: "machine",
    date: "2026-07-06",
    machineSerial: 99003,
  });
  assert.deepEqual(filter, {
    $and: [
      { type: "machine", "machine.id": 99003 },
      {
        "timestamps.create": {
          $gte: new Date("2026-07-06T05:00:00.000Z"),
          $lt: new Date("2026-07-07T05:00:00.000Z"),
        },
      },
    ],
  });
});

test("Chicago date ranges honor spring and fall DST boundaries", () => {
  const spring = calendarRange("2026-03-08");
  const fall = calendarRange("2026-11-01");
  assert.equal(spring.$lt - spring.$gte, 23 * 60 * 60 * 1000);
  assert.equal(fall.$lt - fall.$gte, 25 * 60 * 60 * 1000);
});

test("shift filters match embedded id and _id forms", () => {
  const oid = new ObjectId();
  const translated = translateTotalsFilter({ shiftId: oid.toString() });
  assert.ok(translated.$or);
  assert.deepEqual(
    translated.$or.map((entry) => Object.keys(entry)[0]),
    ["shift.id", "shift._id"]
  );
  assert.ok(translated.$or[1]["shift._id"].$in.some((value) => value instanceof ObjectId));
});

test("hour filters and records derive Chicago-local hour from timestamps.create", () => {
  const translated = translateTotalsFilter({ hour: { $gte: 8, $lte: 10 } });
  assert.ok(translated.$expr?.$and);

  const document = newDocument("machine-item");
  document.timestamps.create = new Date("2026-07-06T14:00:00.000Z");
  const normalized = normalizeTotalsDocument(document);
  assert.equal(normalized.hour, 9);
});

test("machine hourly charts consume derived hours from new-schema records", () => {
  const {
    buildItemHourlyStackFromRecords,
    buildOperatorEfficiencyFromRecords,
  } = require("../utils/machineFunctions");
  const itemRecord = normalizeTotalsDocument(newDocument("machine-item"));
  const operatorRecord = normalizeTotalsDocument(newDocument("operator-machine"));
  const start = new Date("2026-07-06T05:00:00.000Z");

  const itemChart = buildItemHourlyStackFromRecords([itemRecord], start);
  const performanceChart = buildOperatorEfficiencyFromRecords([operatorRecord], start);

  assert.equal(itemChart.data.items["Item 42"][0], 7);
  assert.equal(performanceChart[0].operators[0].id, 173878);
});

test("legacy backfill records become the nested schema", () => {
  const legacy = {
    _id: "operator-item-173878-42-99003-2026-07-06",
    entityType: "operator-item",
    date: "2026-07-06",
    operatorId: 173878,
    operatorName: "Operator",
    itemId: 42,
    itemName: "Item",
    itemStandard: 120,
    machineSerial: 99003,
    machineName: "Machine",
    runtimeMs: 100,
    totalCounts: 7,
    totalMisfeeds: 1,
    breakTimeMs: 30,
    timeRange: {
      start: new Date("2026-07-06T05:00:00.000Z"),
      end: new Date("2026-07-07T05:00:00.000Z"),
    },
    source: "backfill",
  };
  const result = toNewTotalsDocument(legacy);
  assert.equal(result.id, legacy._id);
  assert.equal(result._id, undefined);
  assert.equal(result.type, "operator-item");
  assert.equal(result.machine.id, 99003);
  assert.equal(result.totals.count, 7);
  assert.equal(result.totals.breakTimeMs, 30);
  assert.equal(result.entityType, undefined);
  assert.equal(result.date, undefined);
  assert.equal(result.version, undefined);
});

test("deterministic id is stable across repeated backfill conversion", () => {
  const legacy = {
    _id: "machine-99003-2026-07-06",
    entityType: "machine",
    date: "2026-07-06",
    machineSerial: 99003,
  };
  assert.equal(toNewTotalsDocument(legacy).id, toNewTotalsDocument(legacy).id);
});

test("dashboard metrics consume stored break time", async () => {
  const { buildMachineSummaryRows } = require("../utils/machineDashboardCache");
  const db = {
    collection() {
      return {
        find() {
          return {
            project() {
              return this;
            },
            async toArray() {
              return [];
            },
          };
        },
      };
    },
  };
  const start = new Date("2026-07-06T12:00:00.000Z");
  const end = new Date(start.getTime() + 200);
  const [row] = await buildMachineSummaryRows(
    db,
    null,
    { stateTickerCollectionName: "state-ticker" },
    [{
      machineSerial: 99003,
      runtimeMs: 100,
      breakTimeMs: 50,
      timeRange: { start, end },
    }],
    [],
    start,
    end,
    { useShiftElapsed: false }
  );
  assert.equal(row.metrics.downtime.total, 50);
  assert.equal(row.metrics.performance.availability.value, 2 / 3);
});
