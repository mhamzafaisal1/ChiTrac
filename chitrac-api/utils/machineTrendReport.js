const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");
const { normalizeTotalsDocument } = require("./totalsSchema");

const DAY_MS = 24 * 60 * 60 * 1000;

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseWholePlantDay(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required in YYYY-MM-DD format`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`${label} must be in YYYY-MM-DD format`);
  }

  const parsed = DateTime.fromISO(value.trim(), { zone: SYSTEM_TIMEZONE });
  if (!parsed.isValid) {
    throw new Error(`${label} must be a valid date`);
  }

  return parsed.startOf("day");
}

function resolveDateRange(query) {
  const startDay = parseWholePlantDay(query.start || query.startDate, "start");
  const endDay = parseWholePlantDay(query.end || query.endDate, "end");

  if (endDay < startDay) {
    throw new Error("end must be on or after start");
  }

  const dayCount = Math.floor(endDay.diff(startDay, "days").days) + 1;
  return {
    startDate: startDay.toISODate(),
    endDate: endDay.toISODate(),
    startDay,
    endDay,
    start: startDay.toJSDate(),
    end: endDay.endOf("day").toJSDate(),
    dayCount,
  };
}

function dateKeyFromValue(value) {
  const parsed = value instanceof Date
    ? DateTime.fromJSDate(value, { zone: SYSTEM_TIMEZONE })
    : DateTime.fromJSDate(new Date(value), { zone: SYSTEM_TIMEZONE });
  return parsed.isValid ? parsed.toISODate() : null;
}

function serialFromMachine(machine) {
  const serial = Number(machine?.serial ?? machine?.id ?? machine?.serialNumber);
  return Number.isFinite(serial) ? serial : null;
}

function machineFromRecord(record) {
  return {
    serial: Number(record.machineSerial ?? record.machine?.serial ?? record.machine?.id),
    name: record.machineName || record.machine?.name || `Serial ${record.machineSerial ?? record.machine?.id}`,
  };
}

function emptyTotals() {
  return {
    runtimeMs: 0,
    workedTimeMs: 0,
    count: 0,
    misfeeds: 0,
    faultCount: 0,
    faultTimeMs: 0,
    pauseCount: 0,
    pauseTimeMs: 0,
    downtimeMs: 0,
    offlineTimeMs: 0,
    breakTimeMs: 0,
    timeCreditMs: 0,
  };
}

function addTotals(target, source) {
  target.runtimeMs += safeNumber(source.runtimeMs);
  target.workedTimeMs += safeNumber(source.workedTimeMs);
  target.count += safeNumber(source.count);
  target.misfeeds += safeNumber(source.misfeeds);
  target.faultCount += safeNumber(source.faultCount);
  target.faultTimeMs += safeNumber(source.faultTimeMs);
  target.pauseCount += safeNumber(source.pauseCount);
  target.pauseTimeMs += safeNumber(source.pauseTimeMs);
  target.downtimeMs += safeNumber(source.downtimeMs);
  target.offlineTimeMs += safeNumber(source.offlineTimeMs);
  target.breakTimeMs += safeNumber(source.breakTimeMs);
  target.timeCreditMs += safeNumber(source.timeCreditMs);
  return target;
}

function buildMetrics(totals) {
  const downtimeMs = safeNumber(totals.downtimeMs) > 0
    ? safeNumber(totals.downtimeMs)
    : safeNumber(totals.pauseTimeMs) + safeNumber(totals.faultTimeMs) + safeNumber(totals.offlineTimeMs);
  const runtimeMs = safeNumber(totals.runtimeMs);
  const count = safeNumber(totals.count);
  const misfeeds = safeNumber(totals.misfeeds);
  const workedTimeMs = safeNumber(totals.workedTimeMs);
  const timeCreditMs = safeNumber(totals.timeCreditMs);
  const availabilityDenominator = runtimeMs + downtimeMs;
  const availability = availabilityDenominator > 0 ? runtimeMs / availabilityDenominator : 0;
  const throughputDenominator = count + misfeeds;
  const throughput = throughputDenominator > 0 ? count / throughputDenominator : 0;
  const efficiency = workedTimeMs > 0 ? timeCreditMs / workedTimeMs : 0;
  const oee = availability * throughput * efficiency;

  return {
    availability,
    availabilityPercent: availability * 100,
    throughput,
    throughputPercent: throughput * 100,
    efficiency,
    efficiencyPercent: efficiency * 100,
    oee,
    oeePercent: oee * 100,
  };
}

function trendRow({ machine, bucket, totals }) {
  const resolvedTotals = {
    ...totals,
    downtimeMs: safeNumber(totals.downtimeMs) > 0
      ? safeNumber(totals.downtimeMs)
      : safeNumber(totals.pauseTimeMs) + safeNumber(totals.faultTimeMs) + safeNumber(totals.offlineTimeMs),
  };

  return {
    machine,
    bucket,
    totals: resolvedTotals,
    metrics: buildMetrics(resolvedTotals),
  };
}

function eventCodeExpression() {
  return {
    $convert: {
      input: {
        $ifNull: [
          "$type",
          {
            $ifNull: [
              "$status.code",
              {
                $ifNull: [
                  "$status.id",
                  {
                    $ifNull: [
                      "$startState.status.code",
                      "$states.start.status.code",
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      to: "int",
      onError: null,
      onNull: null,
    },
  };
}

async function getSessionEventCounts(db, config, range) {
  const results = await db.collection(config.machineSessionCollectionName).aggregate([
    {
      $match: {
        "timestamps.start": {
          $gte: range.start,
          $lte: range.end,
        },
      },
    },
    {
      $set: {
        machineSerial: {
          $ifNull: [
            "$machine.serial",
            {
              $ifNull: [
                "$machine.id",
                "$machine.serialNumber",
              ],
            },
          ],
        },
        eventCode: eventCodeExpression(),
      },
    },
    {
      $match: {
        machineSerial: { $ne: null },
        eventCode: { $ne: 1 },
      },
    },
    {
      $group: {
        _id: {
          machineSerial: "$machineSerial",
          date: {
            $dateToString: {
              date: "$timestamps.start",
              format: "%Y-%m-%d",
              timezone: SYSTEM_TIMEZONE,
            },
          },
        },
        pauseCount: {
          $sum: {
            $cond: [{ $eq: ["$eventCode", 0] }, 1, 0],
          },
        },
        faultCount: {
          $sum: {
            $cond: [{ $gt: ["$eventCode", 1] }, 1, 0],
          },
        },
      },
    },
  ]).toArray();

  return new Map(
    results.map((row) => [
      `${Number(row._id.machineSerial)}|${row._id.date}`,
      {
        pauseCount: safeNumber(row.pauseCount),
        faultCount: safeNumber(row.faultCount),
      },
    ])
  );
}

function normalizeDailyRecord(record, eventCounts) {
  const normalized = normalizeTotalsDocument(record);
  const machine = machineFromRecord(normalized);
  const date = normalized.date || dateKeyFromValue(normalized.timestamps?.create);
  const counts = eventCounts.get(`${machine.serial}|${date}`) || {};
  const downtimeMs = normalized.downTimeMs ?? normalized.downTimeMs ?? (
    safeNumber(normalized.pausedTimeMs) +
    safeNumber(normalized.faultTimeMs) +
    safeNumber(normalized.offlineTimeMs)
  );

  return trendRow({
    machine,
    bucket: {
      type: "day",
      startDate: date,
      endDate: date,
      start: normalized.timestamps?.start || normalized.dateObj || normalized.timestamps?.create,
      end: normalized.timestamps?.end || normalized.timestamps?.create,
    },
    totals: {
      runtimeMs: safeNumber(normalized.runtimeMs),
      workedTimeMs: safeNumber(normalized.workedTimeMs),
      count: safeNumber(normalized.totalCounts),
      misfeeds: safeNumber(normalized.totalMisfeeds),
      faultCount: safeNumber(counts.faultCount, normalized.totalFaults || 0),
      faultTimeMs: safeNumber(normalized.faultTimeMs),
      pauseCount: safeNumber(counts.pauseCount),
      pauseTimeMs: safeNumber(normalized.pausedTimeMs),
      downtimeMs: safeNumber(downtimeMs),
      offlineTimeMs: safeNumber(normalized.offlineTimeMs),
      breakTimeMs: safeNumber(normalized.breakTimeMs),
      timeCreditMs: safeNumber(normalized.totalTimeCreditMs),
    },
  });
}

function weekBuckets(range) {
  const buckets = [];
  let cursor = range.startDay;
  while (cursor <= range.endDay) {
    const bucketEnd = DateTime.min(cursor.plus({ days: 6 }), range.endDay);
    buckets.push({
      type: "seven-day",
      startDate: cursor.toISODate(),
      endDate: bucketEnd.toISODate(),
      start: cursor.toJSDate(),
      end: bucketEnd.endOf("day").toJSDate(),
    });
    cursor = bucketEnd.plus({ days: 1 }).startOf("day");
  }
  return buckets;
}

function fullCalendarMonthBuckets(range) {
  const buckets = [];
  let cursor = range.startDay.startOf("month");
  while (cursor <= range.endDay) {
    const monthStart = cursor.startOf("month");
    const monthEnd = cursor.endOf("month").startOf("day");
    if (monthStart >= range.startDay && monthEnd <= range.endDay) {
      buckets.push({
        type: "month",
        startDate: monthStart.toISODate(),
        endDate: monthEnd.toISODate(),
        start: monthStart.toJSDate(),
        end: monthEnd.endOf("day").toJSDate(),
      });
    }
    cursor = cursor.plus({ months: 1 }).startOf("month");
  }
  return buckets;
}

function aggregateRows(rows, buckets) {
  const aggregated = [];
  for (const bucket of buckets) {
    const byMachine = new Map();
    for (const row of rows) {
      const rowDate = row.bucket.startDate;
      if (rowDate < bucket.startDate || rowDate > bucket.endDate) continue;

      const key = row.machine.serial;
      if (!byMachine.has(key)) {
        byMachine.set(key, {
          machine: row.machine,
          totals: emptyTotals(),
        });
      }

      addTotals(byMachine.get(key).totals, row.totals);
    }

    for (const value of byMachine.values()) {
      aggregated.push(trendRow({
        machine: value.machine,
        bucket,
        totals: value.totals,
      }));
    }
  }
  return aggregated;
}

async function buildMachineTrendReport(db, config, query) {
  const range = resolveDateRange(query);
  const machineTypeFilter = {
    $or: [
      { type: "machine" },
      { entityType: "machine" },
    ],
    "timestamps.create": {
      $gte: range.start,
      $lte: range.end,
    },
  };
  const filter = machineTypeFilter;

  if (query.serial || query.machineSerial) {
    const serial = Number(query.serial || query.machineSerial);
    if (!Number.isFinite(serial)) throw new Error("serial must be numeric");
    filter.$and = [
      {
        $or: [
          { "machine.id": serial },
          { "machine.serial": serial },
          { machineSerial: serial },
        ],
      },
    ];
  }

  const [records, eventCounts] = await Promise.all([
    db.collection(config.totalsDailyCollectionName)
      .find(filter)
      .sort({ "timestamps.create": 1, "machine.id": 1 })
      .toArray(),
    getSessionEventCounts(db, config, range),
  ]);

  const daily = records
    .map((record) => normalizeDailyRecord(record, eventCounts))
    .filter((row) => Number.isFinite(serialFromMachine(row.machine)));

  const weeklyBuckets = range.dayCount >= 14 ? weekBuckets(range) : [];
  const monthlyBuckets = fullCalendarMonthBuckets(range);

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      start: range.start,
      end: range.end,
      dayCount: range.dayCount,
    },
    daily,
    weekly: weeklyBuckets.length ? aggregateRows(daily, weeklyBuckets) : [],
    monthly: monthlyBuckets.length ? aggregateRows(daily, monthlyBuckets) : [],
    meta: {
      source: config.totalsDailyCollectionName,
      recordCount: records.length,
      includesWeekly: weeklyBuckets.length > 0,
      includesMonthly: monthlyBuckets.length > 0,
      weeklyBucketType: "non-overlapping-seven-day",
      timezone: SYSTEM_TIMEZONE,
    },
  };
}

module.exports = {
  buildMachineTrendReport,
  resolveDateRange,
};
