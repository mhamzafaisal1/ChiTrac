const express = require("express");
const { DateTime } = require("luxon");

const config = require("../../modules/config");
const { formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time");
const { computeShiftElapsedMs } = require("../../utils/shiftElapsed");

module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const totalsShiftCollectionName = "totals-shift";

  function badRequest(res, message) {
    return res.status(400).json({ error: message });
  }

  function parseSerial(raw) {
    if (typeof raw === "undefined" || raw === null || raw === "") return null;
    const serial = Number.parseInt(String(raw), 10);
    return Number.isFinite(serial) && String(serial) === String(raw).trim()
      ? serial
      : NaN;
  }

  function parseRequiredInteger(raw) {
    if (typeof raw === "undefined" || raw === null || raw === "") return NaN;
    const value = Number.parseInt(String(raw), 10);
    return Number.isFinite(value) && String(value) === String(raw).trim()
      ? value
      : NaN;
  }

  function parseIsoDate(raw, label) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(`${label} is required`);
    }
    const parsed = DateTime.fromISO(raw, { zone: SYSTEM_TIMEZONE });
    if (!parsed.isValid) {
      throw new Error(`${label} must be a valid ISO date string`);
    }
    return parsed;
  }

  function todayBounds(now = DateTime.now().setZone(SYSTEM_TIMEZONE)) {
    return {
      dateStr: now.toISODate(),
      start: now.startOf("day"),
      end: now,
    };
  }

  function shiftWindowForToday(shiftDoc, now = DateTime.now().setZone(SYSTEM_TIMEZONE)) {
    const activeDays = Array.isArray(shiftDoc.activeDays) ? shiftDoc.activeDays : [];
    if (activeDays.length && !activeDays.includes(now.weekday)) {
      return null;
    }

    const startHour = shiftDoc.startTime?.hour;
    const startMinute = shiftDoc.startTime?.minute;
    const endHour = shiftDoc.endTime?.hour;
    const endMinute = shiftDoc.endTime?.minute;

    if (
      typeof startHour !== "number" ||
      typeof startMinute !== "number" ||
      typeof endHour !== "number" ||
      typeof endMinute !== "number"
    ) {
      throw new Error("Shift is missing startTime or endTime");
    }

    const start = now.startOf("day").set({
      hour: startHour,
      minute: startMinute,
      second: 0,
      millisecond: 0,
    });
    const end = now.startOf("day").set({
      hour: endHour,
      minute: endMinute,
      second: 0,
      millisecond: 0,
    });

    if (end <= start) {
      throw new Error("Shift end time must be after shift start time");
    }

    return {
      dateStr: now.toISODate(),
      start: start.toJSDate(),
      end: (end > now ? now : end).toJSDate(),
    };
  }

  function splitCustomRange(startDT, endDT) {
    const cacheSegments = [];
    const sessionSegments = [];
    let cursor = startDT.startOf("day");
    const lastDay = endDT.minus({ milliseconds: 1 }).startOf("day");

    while (cursor <= lastDay) {
      const dayStart = cursor;
      const dayEnd = cursor.plus({ days: 1 });
      const segmentStart = startDT > dayStart ? startDT : dayStart;
      const segmentEnd = endDT < dayEnd ? endDT : dayEnd;

      if (segmentEnd > segmentStart) {
        const segment = {
          dateStr: cursor.toISODate(),
          start: segmentStart.toJSDate(),
          end: segmentEnd.toJSDate(),
        };

        if (segmentStart.equals(dayStart) && segmentEnd.equals(dayEnd)) {
          cacheSegments.push(segment);
        } else {
          sessionSegments.push(segment);
        }
      }

      cursor = cursor.plus({ days: 1 });
    }

    return { cacheSegments, sessionSegments };
  }

  async function loadActiveMachines(serial) {
    const filter = { active: { $ne: false } };
    if (serial !== null) filter.serial = serial;

    const machines = await db
      .collection(config.machineCollectionName)
      .find(filter)
      .project({ _id: 0, serial: 1, name: 1 })
      .toArray();

    return new Map(
      machines
        .map((machine) => [Number(machine.serial), machine])
        .filter(([machineSerial]) => Number.isFinite(machineSerial))
    );
  }

  async function loadActiveShifts() {
    return db
      .collection(config.shiftCollectionName)
      .find({ active: true })
      .toArray();
  }

  async function buildStatusMap(serials) {
    const finiteSerials = serials.filter((serial) => Number.isFinite(serial));
    if (!finiteSerials.length) return new Map();

    const tickerFilterValues = [
      ...new Set([
        ...finiteSerials,
        ...finiteSerials.map((serial) => String(serial)),
      ]),
    ];

    const tickers = await db
      .collection(config.stateTickerCollectionName)
      .find({
        $or: [
          { "machine.id": { $in: tickerFilterValues } },
          { "machine.serial": { $in: tickerFilterValues } },
        ],
      })
      .project({
        _id: 0,
        machine: 1,
        status: 1,
        timestamp: 1,
      })
      .toArray();

    const statusMap = new Map();
    for (const ticker of tickers) {
      const machineSerial = Number(ticker.machine?.serial ?? ticker.machine?.id);
      if (!Number.isFinite(machineSerial)) continue;

      const timestamp = new Date(ticker.timestamp || 0).getTime();
      const existing = statusMap.get(machineSerial);
      if (existing && existing.timestamp >= timestamp) continue;

      statusMap.set(machineSerial, {
        timestamp,
        status: {
          code: ticker.status?.id ?? ticker.status?.code ?? 0,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.softrolColor || "None",
        },
      });
    }

    return statusMap;
  }

  function createAggregate(machine, productiveMs = 0) {
    return {
      machineSerial: Number(machine.serial),
      machineName: machine.name || `Serial ${machine.serial}`,
      runtimeMs: 0,
      workedTimeMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
      totalTimeCreditMs: 0,
      productiveMs,
      segmentKeys: new Set(),
      rangeStart: null,
      rangeEnd: null,
      hasData: false,
    };
  }

  function addSegmentProductive(aggregate, segmentKey, segmentProductiveMs, start, end) {
    if (!aggregate.segmentKeys.has(segmentKey)) {
      aggregate.productiveMs += segmentProductiveMs;
      aggregate.segmentKeys.add(segmentKey);
    }

    if (!aggregate.rangeStart || start < aggregate.rangeStart) {
      aggregate.rangeStart = start;
    }
    if (!aggregate.rangeEnd || end > aggregate.rangeEnd) {
      aggregate.rangeEnd = end;
    }
  }

  function addRecordToAggregate(aggregateMap, record, segment) {
    const serial = Number(record.machineSerial);
    if (!Number.isFinite(serial)) return;

    if (!aggregateMap.has(serial)) {
      aggregateMap.set(
        serial,
        createAggregate({
          serial,
          name: record.machineName || `Serial ${serial}`,
        })
      );
    }

    const aggregate = aggregateMap.get(serial);
    aggregate.machineName = record.machineName || aggregate.machineName;
    aggregate.runtimeMs += record.runtimeMs || 0;
    aggregate.workedTimeMs += record.workedTimeMs || 0;
    aggregate.totalCounts += record.totalCounts || record.totalCount || 0;
    aggregate.totalMisfeeds += record.totalMisfeeds || record.misfeedCount || 0;
    aggregate.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    aggregate.hasData = true;
    addSegmentProductive(
      aggregate,
      segment.key,
      segment.productiveMs,
      segment.start,
      segment.end
    );
  }

  async function addSessionFallback(aggregateMap, segment, serials, options = {}) {
    if (!serials.length) return;

    const sessionMatch = {
      $and: [
        { "machine.id": { $in: serials } },
        { "timestamps.start": { $lt: segment.end } },
        {
          $or: [
            { "timestamps.end": { $gt: segment.start } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null },
          ],
        },
      ],
    };

    if (options.shiftId) {
      sessionMatch.$and.push({
        $or: [
          { "shift._id": options.shiftId },
          { "shift._id": options.shiftObjectId || options.shiftId },
        ],
      });
    }

    const sessions = await db
      .collection(config.machineSessionCollectionName)
      .find(sessionMatch)
      .project({
        _id: 0,
        machine: 1,
        timestamps: 1,
        activeStations: 1,
        workTime: 1,
        runtime: 1,
        metrics: 1,
        operators: 1,
        states: 1,
      })
      .toArray();

    const sessionBuckets = new Map();
    for (const session of sessions) {
      const serial = Number(session.machine?.serial ?? session.machine?.id);
      if (!serials.includes(serial)) continue;

      const sessionStart = new Date(session.timestamps?.start);
      const rawSessionEnd = session.timestamps?.end
        ? new Date(session.timestamps.end)
        : segment.end;
      const clampedStart =
        sessionStart > segment.start ? sessionStart : segment.start;
      const clampedEnd = rawSessionEnd < segment.end ? rawSessionEnd : segment.end;
      const runtimeMs = Math.max(0, clampedEnd - clampedStart);
      if (runtimeMs <= 0) continue;

      const fullSessionMs = Math.max(0, rawSessionEnd - sessionStart);
      const overlapFactor = fullSessionMs > 0 ? runtimeMs / fullSessionMs : 1;
      const operators = Array.isArray(session.operators)
        ? session.operators
        : Array.isArray(session.states?.start?.operators)
          ? session.states.start.operators
          : [];
      const operatorStations = operators.filter((op) => op && op.id !== -1).length;
      const activeStations =
        Number(session.activeStations) ||
        Number(session.metrics?.stations?.active) ||
        operatorStations ||
        0;
      const storedWorkedSec =
        Number(session.metrics?.timers?.worked) ||
        Number(session.workTime) ||
        0;
      const workedTimeMs =
        storedWorkedSec > 0
          ? storedWorkedSec * 1000 * overlapFactor
          : runtimeMs * activeStations;
      const bucket =
        sessionBuckets.get(serial) || {
          machineSerial: serial,
          machineName: session.machine?.name || `Serial ${serial}`,
          runtimeMs: 0,
          workedTimeMs: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          totalTimeCreditMs: 0,
        };

      bucket.runtimeMs += runtimeMs;
      bucket.workedTimeMs += workedTimeMs;
      sessionBuckets.set(serial, bucket);
    }

    const countMatch = {
      "machine.id": { $in: serials },
      "timestamps.create": { $gte: segment.start, $lte: segment.end },
    };

    const counts = await db
      .collection("count")
      .find(countMatch)
      .project({
        _id: 0,
        machine: 1,
        item: 1,
        misfeed: 1,
      })
      .toArray();

    for (const count of counts) {
      const serial = Number(count.machine?.serial ?? count.machine?.id);
      if (!serials.includes(serial)) continue;

      const bucket =
        sessionBuckets.get(serial) || {
          machineSerial: serial,
          machineName: count.machine?.name || `Serial ${serial}`,
          runtimeMs: 0,
          workedTimeMs: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          totalTimeCreditMs: 0,
        };

      if (count.misfeed) {
        bucket.totalMisfeeds += 1;
      } else {
        bucket.totalCounts += 1;
        const standard = Number(count.item?.standard || 0);
        const pph = standard > 0 && standard < 60 ? standard * 60 : standard;
        if (pph > 0) {
          bucket.totalTimeCreditMs += (1 / pph) * 3600000;
        }
      }

      sessionBuckets.set(serial, bucket);
    }

    for (const record of sessionBuckets.values()) {
      addRecordToAggregate(aggregateMap, record, segment);
    }
  }

  async function addCacheSegment(aggregateMap, segment, collectionName, baseFilter, serials, sessionOptions = {}) {
    const filter = {
      ...baseFilter,
      entityType: "machine",
      date: segment.dateStr,
    };

    if (serials.length === 1) {
      filter.machineSerial = serials[0];
    } else if (serials.length > 1) {
      filter.machineSerial = { $in: serials };
    }

    const records = await db.collection(collectionName).find(filter).toArray();
    const foundSerials = new Set();

    for (const record of records) {
      const serial = Number(record.machineSerial);
      if (!Number.isFinite(serial)) continue;
      foundSerials.add(serial);
      addRecordToAggregate(aggregateMap, record, segment);
    }

    const missingSerials = serials.filter((serial) => !foundSerials.has(serial));
    await addSessionFallback(aggregateMap, segment, missingSerials, sessionOptions);
  }

  function toSummaryRow(aggregate, statusMap, requestStart, requestEnd) {
    const productiveMs = Math.max(aggregate.productiveMs, 0);
    const runtimeMs = aggregate.runtimeMs || 0;
    const downtimeMs = Math.max(productiveMs - runtimeMs, 0);
    const totalCounts = aggregate.totalCounts || 0;
    const totalMisfeeds = aggregate.totalMisfeeds || 0;
    const totalOutput = totalCounts + totalMisfeeds;

    let workedTimeMs = aggregate.workedTimeMs || 0;
    if (workedTimeMs === 0 && aggregate.totalTimeCreditMs > 0 && runtimeMs > 0) {
      workedTimeMs = runtimeMs;
    }

    const availability =
      productiveMs > 0 ? Math.min(Math.max(runtimeMs / productiveMs, 0), 1) : 0;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;
    const efficiency =
      workedTimeMs > 0 ? aggregate.totalTimeCreditMs / workedTimeMs : 0;
    const oee = availability * throughput * efficiency;

    return {
      machine: {
        serial: aggregate.machineSerial,
        name: aggregate.machineName,
      },
      currentStatus: statusMap.get(aggregate.machineSerial)?.status || {
        code: 0,
        name: "Unknown",
      },
      metrics: {
        runtime: {
          total: runtimeMs,
          formatted: formatDuration(runtimeMs),
        },
        downtime: {
          total: downtimeMs,
          formatted: formatDuration(downtimeMs),
        },
        output: {
          totalCount: totalCounts,
          misfeedCount: totalMisfeeds,
        },
        performance: {
          availability: {
            value: availability,
            percentage: (availability * 100).toFixed(2),
          },
          throughput: {
            value: throughput,
            percentage: (throughput * 100).toFixed(2),
          },
          efficiency: {
            value: efficiency,
            percentage: (efficiency * 100).toFixed(2),
          },
          oee: {
            value: oee,
            percentage: (oee * 100).toFixed(2),
          },
        },
      },
      timeRange: {
        start: aggregate.rangeStart || requestStart,
        end: aggregate.rangeEnd || requestEnd,
      },
    };
  }

  async function buildMachineOverview(req, res) {
    const timeframe = req.query.timeframe || "today";
    if (!["today", "custom", "shift"].includes(timeframe)) {
      return badRequest(res, "Invalid timeframe");
    }

    const serial = parseSerial(req.query.serial);
    if (Number.isNaN(serial)) {
      return badRequest(res, "serial must be numeric");
    }

    let shiftDoc = null;
    let cacheSegments = [];
    let sessionSegments = [];
    let cacheCollectionName = config.totalsDailyCollectionName;
    let cacheBaseFilter = {};
    let sessionOptions = {};

    const now = DateTime.now().setZone(SYSTEM_TIMEZONE);

    try {
      if (timeframe === "today") {
        const today = todayBounds(now);
        cacheSegments = [
          {
            key: `daily:${today.dateStr}`,
            dateStr: today.dateStr,
            start: today.start.toJSDate(),
            end: today.end.toJSDate(),
          },
        ];
      } else if (timeframe === "custom") {
        const startDT = parseIsoDate(req.query.start, "start");
        const endDT = req.query.end
          ? parseIsoDate(req.query.end, "end")
          : now;
        const clampedEndDT = endDT > now ? now : endDT;

        if (startDT >= clampedEndDT) {
          return badRequest(res, "Start date must be before end date");
        }

        const split = splitCustomRange(startDT, clampedEndDT);
        cacheSegments = split.cacheSegments.map((segment) => ({
          ...segment,
          key: `daily:${segment.dateStr}`,
        }));
        sessionSegments = split.sessionSegments.map((segment, index) => ({
          ...segment,
          key: `session:${index}:${segment.start.getTime()}-${segment.end.getTime()}`,
        }));
      } else if (timeframe === "shift") {
        const shiftIntegerId = parseRequiredInteger(req.query.shift);
        if (Number.isNaN(shiftIntegerId)) {
          return badRequest(res, "shift is required and must be an integer");
        }

        shiftDoc = await db
          .collection(config.shiftCollectionName)
          .findOne({ id: shiftIntegerId });

        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }

        const shiftWindow = shiftWindowForToday(shiftDoc, now);
        if (!shiftWindow || shiftWindow.end <= shiftWindow.start) {
          return res.json([]);
        }

        cacheCollectionName = totalsShiftCollectionName;
        cacheBaseFilter = { shiftId: shiftDoc._id.toString() };
        sessionOptions = { shiftId: shiftDoc._id.toString() };
        cacheSegments = [
          {
            key: `shift:${shiftDoc._id.toString()}:${shiftWindow.dateStr}`,
            dateStr: shiftWindow.dateStr,
            start: shiftWindow.start,
            end: shiftWindow.end,
          },
        ];
      }
    } catch (error) {
      return badRequest(res, error.message);
    }

    const activeShifts = shiftDoc ? [shiftDoc] : await loadActiveShifts();
    const machineMap = await loadActiveMachines(serial);
    const aggregateMap = new Map();
    const requestedSerials = serial !== null ? [serial] : [...machineMap.keys()];

    if (serial === null) {
      for (const machine of machineMap.values()) {
        aggregateMap.set(Number(machine.serial), createAggregate(machine));
      }
    }

    const allSegments = [...cacheSegments, ...sessionSegments];
    for (const segment of allSegments) {
      segment.productiveMs = computeShiftElapsedMs(
        activeShifts,
        segment.start,
        segment.end,
        SYSTEM_TIMEZONE
      );
    }

    for (const segment of cacheSegments) {
      await addCacheSegment(
        aggregateMap,
        segment,
        cacheCollectionName,
        cacheBaseFilter,
        requestedSerials,
        sessionOptions
      );

      if (serial === null) {
        for (const machineSerial of requestedSerials) {
          const aggregate = aggregateMap.get(machineSerial);
          if (aggregate) {
            addSegmentProductive(
              aggregate,
              segment.key,
              segment.productiveMs,
              segment.start,
              segment.end
            );
          }
        }
      }
    }

    for (const segment of sessionSegments) {
      await addSessionFallback(aggregateMap, segment, requestedSerials, sessionOptions);

      if (serial === null) {
        for (const machineSerial of requestedSerials) {
          const aggregate = aggregateMap.get(machineSerial);
          if (aggregate) {
            addSegmentProductive(
              aggregate,
              segment.key,
              segment.productiveMs,
              segment.start,
              segment.end
            );
          }
        }
      }
    }

    const aggregates = [...aggregateMap.values()].filter((aggregate) => {
      if (serial === null) return requestedSerials.includes(aggregate.machineSerial);
      return aggregate.machineSerial === serial && aggregate.hasData;
    });

    if (!aggregates.length) {
      return res.json([]);
    }

    const statusMap = await buildStatusMap(
      aggregates.map((aggregate) => aggregate.machineSerial)
    );
    const requestStart = allSegments[0]?.start || now.startOf("day").toJSDate();
    const requestEnd = allSegments[allSegments.length - 1]?.end || now.toJSDate();
    const data = aggregates
      .map((aggregate) => toSummaryRow(aggregate, statusMap, requestStart, requestEnd))
      .sort((a, b) => a.machine.serial - b.machine.serial);

    return res.json(data);
  }

  router.get("/status", async (req, res) => {
    res.json({ vendor: "Milnor", status: "ok" });
  });

  router.get("/machine-overview", async (req, res) => {
    try {
      await buildMachineOverview(req, res);
    } catch (error) {
      logger.error("[milnor] Error in machine-overview route:", error);
      res.status(500).json({ error: "Failed to fetch Milnor machine overview" });
    }
  });

  return router;
}
