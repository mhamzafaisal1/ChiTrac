const { createVendorAnalytics } = require("../shared/vendorAnalytics");
const express = require("express");
const { sessionMachineQuery, sessionOperatorQuery } = require("../../utils/sessionIdentity");
const { sessionShiftFilter } = require("../../utils/reportShiftFilter");
const { realFaultSessionQuery, isFaultSession, sessionStateCode, getMachineStateTimeBySerial } = require("../../utils/faultTimeSummary");
const { DateTime } = require("luxon");

const config = require("../../modules/config");
const { SYSTEM_TIMEZONE } = require("../../utils/time");

const { computeShiftElapsedMs } = require("../../utils/shiftElapsed");

const {
  buildLatestTickerMap,
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
} = require("../../utils/machineFunctions");

module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const totalsShiftCollectionName = "totals-shift";

  const {
    badRequest,
    parseSerial,
    parseOperatorId,
    parseRequiredInteger,
    parseIsoDate,
    todayBounds,
    shiftWindowForToday,
    splitCustomRange,
    loadActiveMachines,
    loadActiveShifts,
    addSegmentProductive,
    addCacheSegment,
    buildMachineOverview,
    buildOperatorOverview,
    queryEntityRecords,
    buildHourlyMachineItemRecordsFromCounts,
    queryMachineCounts,
    buildSessionOperatorEfficiencyRecords,
    buildCurrentOperatorsFast,
    buildOperatorDetails,
  } = createVendorAnalytics(server, {
    createAggregate,
    addRecordToAggregate,
    addSessionFallback,
    resolveDetailsTimeframe,
  });

  function createAggregate(machine, productiveMs = 0) {
    return {
      machineSerial: Number(machine.serial),
      machineName: machine.name || `Serial ${machine.serial}`,
      runtimeMs: 0,
      faultTimeMs: 0,
      pausedTimeMs: 0,
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
    // A daily total cannot supply a fault or pause duration for only part of that day.
    if (!segment.partialDay) {
      aggregate.pausedTimeMs += Number(record.pausedTimeMs) || 0;
      aggregate.faultTimeMs += Number(record.faultTimeMs) || 0;
    }
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
        type: 1,
        status: 1,
        "startState.status": 1,
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

      const stateCode = options.classifyRuntime ? sessionStateCode(session) : null;
      if (stateCode === null || stateCode === 1) {
        bucket.runtimeMs += runtimeMs;
        bucket.workedTimeMs += workedTimeMs;
      }
      bucket.totalCounts +=
        (Number(session.metrics?.totals?.counts?.valid) ||
          Number(session.totalCount) ||
          0) * overlapFactor;
      bucket.totalMisfeeds +=
        (Number(session.metrics?.totals?.counts?.misfeed) ||
          Number(session.misfeedCount) ||
          0) * overlapFactor;
      bucket.totalTimeCreditMs +=
        (Number(session.metrics?.totals?.timeCredit) ||
          Number(session.totalTimeCredit) ||
          0) *
        1000 *
        overlapFactor;
      sessionBuckets.set(serial, bucket);
    }

    if (!options.skipRawCounts) {
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
    }

    for (const record of sessionBuckets.values()) {
      record.totalCounts = Math.round(record.totalCounts);
      record.totalMisfeeds = Math.round(record.totalMisfeeds);
      addRecordToAggregate(aggregateMap, record, segment);
    }
  }

  async function resolveDetailsWindow(req, { maxDays } = {}) {
    const timeframe = req.query.timeframe || "today";
    const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
    if (timeframe === "today") return { timeframe, now, ...todayBounds(now) };
    if (timeframe === "custom") {
      try {
        const start = parseIsoDate(req.query.start, "start");
        const requestedEnd = req.query.end ? parseIsoDate(req.query.end, "end") : now;
        const end = requestedEnd > now ? now : requestedEnd;
        if (maxDays && end > start.plus({ days: maxDays })) {
          return { error: { status: 400, message: `Session requests are limited to ${maxDays} days. Split longer ranges into separate requests.` } };
        }
        if (start >= end) return { error: { status: 400, message: "Start date must be before end date" } };
        return { timeframe, now, start, end };
      } catch (error) {
        return { error: { status: 400, message: error.message } };
      }
    }
    if (timeframe !== "shift") return { error: { status: 400, message: "Invalid timeframe" } };
    const id = parseRequiredInteger(req.query.shift);
    if (Number.isNaN(id)) return { error: { status: 400, message: "shift is required and must be an integer" } };
    const shiftDoc = await db.collection(config.shiftCollectionName).findOne({ id });
    if (!shiftDoc) return { error: { status: 404, message: "Shift not found" } };
    try {
      const window = shiftWindowForToday(shiftDoc, now);
      if (!window || window.end <= window.start) return { timeframe, now, shiftDoc };
      return { timeframe, now, shiftDoc, dateStr: window.dateStr,
        start: DateTime.fromJSDate(window.start, { zone: SYSTEM_TIMEZONE }),
        end: DateTime.fromJSDate(window.end, { zone: SYSTEM_TIMEZONE }) };
    } catch (error) {
      return { error: { status: 400, message: error.message } };
    }
  }

  async function resolveDetailsTimeframe(req, keyPrefix) {
    const window = await resolveDetailsWindow(req);
    if (window.error) return window;
    const { timeframe, now, start, end, dateStr, shiftDoc = null } = window;
    let cacheSegments = [];
    let sessionSegments = [];
    let cacheCollectionName = config.totalsDailyCollectionName;
    let cacheBaseFilter = {};
    let sessionOptions = {};

    if (timeframe === "custom") {
      const split = splitCustomRange(start, end);
      cacheSegments = split.cacheSegments.map(segment => ({
        ...segment, key: `${keyPrefix}-daily:${segment.dateStr}`,
      }));
      sessionSegments = split.sessionSegments.map((segment, index) => ({
        ...segment, key: `${keyPrefix}-session:${index}:${segment.start.getTime()}-${segment.end.getTime()}`,
      }));
    } else if (start) {
      let key = `${keyPrefix}-daily:${dateStr}`;
      if (shiftDoc) {
        cacheCollectionName = totalsShiftCollectionName;
        cacheBaseFilter = { shiftId: shiftDoc._id.toString() };
        sessionOptions = { shiftId: shiftDoc._id.toString() };
        key = `${keyPrefix}-shift:${shiftDoc._id.toString()}:${dateStr}`;
      }
      cacheSegments = [{ key, dateStr, start: start.toJSDate(), end: end.toJSDate() }];
    }

    const activeShifts = shiftDoc ? [shiftDoc] : await loadActiveShifts();
    const allSegments = [...cacheSegments, ...sessionSegments];
    for (const segment of allSegments) {
      segment.productiveMs = computeShiftElapsedMs(
        activeShifts,
        segment.start,
        segment.end,
        SYSTEM_TIMEZONE
      );
    }

    return {
      timeframe,
      shiftDoc,
      cacheSegments,
      sessionSegments,
      cacheCollectionName,
      cacheBaseFilter,
      sessionOptions,
      activeShifts,
      allSegments,
      now,
    };
  }

  async function buildMachineDetails(req, res) {
    const serial = parseSerial(req.query.serial);
    if (Number.isNaN(serial)) {
      return badRequest(res, "serial must be numeric");
    }

    const resolved = await resolveDetailsTimeframe(req, "machine-detail");
    if (resolved.error) {
      return res.status(resolved.error.status).json({ error: resolved.error.message });
    }
    if (
      resolved.timeframe === "custom" &&
      !resolved.cacheSegments.length &&
      resolved.sessionSegments.length
    ) {
      resolved.cacheSegments = resolved.sessionSegments.map((segment) => ({
        ...segment,
        key: `machine-detail-daily:${segment.dateStr}`,
        partialDay: true,
      }));
      resolved.sessionSegments = [];
      resolved.cacheCollectionName = config.totalsDailyCollectionName;
      resolved.cacheBaseFilter = {};
      resolved.sessionOptions = {};
      resolved.allSegments = resolved.cacheSegments;
    }
    if (!resolved.allSegments.length) return res.json([]);

    const machineMap = await loadActiveMachines(serial);
    const requestedSerials = serial !== null ? [serial] : [...machineMap.keys()];
    const aggregateMap = new Map();

    if (serial === null) {
      for (const machine of machineMap.values()) {
        aggregateMap.set(Number(machine.serial), createAggregate(machine));
      }
    }

    for (const segment of resolved.cacheSegments) {
      await addCacheSegment(
        aggregateMap,
        segment,
        resolved.cacheCollectionName,
        resolved.cacheBaseFilter,
        requestedSerials,
        { ...resolved.sessionOptions, skipRawCounts: true, classifyRuntime: true }
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

    for (const segment of resolved.sessionSegments) {
      await addSessionFallback(
        aggregateMap,
        segment,
        requestedSerials,
        { ...resolved.sessionOptions, skipRawCounts: true, classifyRuntime: true }
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

    const requestStart = new Date(Math.min(...resolved.allSegments.map(segment => +segment.start)));
    const requestEnd = new Date(Math.max(...resolved.allSegments.map(segment => +segment.end)));
    const stateTimes = await getMachineStateTimeBySerial(db, config, requestedSerials, requestStart, requestEnd, {
      ...resolved.sessionOptions, includeUntaggedShift: true, includeFaultData: true,
    });
    if (serial !== null && stateTimes.has(serial) && !aggregateMap.has(serial)) {
      aggregateMap.set(serial, createAggregate({ serial, name: machineMap.get(serial)?.name }));
    }
    const aggregates = [...aggregateMap.values()].filter((aggregate) => {
      if (serial !== null) return aggregate.machineSerial === serial && (aggregate.hasData || stateTimes.has(serial));
      return requestedSerials.includes(aggregate.machineSerial);
    });

    if (!aggregates.length) return res.json([]);

    const serials = aggregates.map((aggregate) => aggregate.machineSerial);
    const serialFilter =
      serials.length === 1 ? { machineSerial: serials[0] } : { machineSerial: { $in: serials } };

    const [
      machineItemRecords,
      operatorMachineRecords,
      machineItemHourlyRecords,
      operatorMachineHourlyRecords,
      stateTickerData,
    ] = await Promise.all([
      queryEntityRecords(
        resolved.cacheCollectionName,
        "machine-item",
        resolved.cacheSegments,
        resolved.cacheBaseFilter,
        serialFilter
      ),
      queryEntityRecords(
        resolved.cacheCollectionName,
        "operator-machine",
        resolved.cacheSegments,
        resolved.cacheBaseFilter,
        serialFilter
      ),
      resolved.cacheCollectionName === config.totalsDailyCollectionName
        ? queryEntityRecords(
            config.totalsHourlyCollectionName,
            "machine-item",
            resolved.cacheSegments,
            {},
            serialFilter
          )
        : [],
      resolved.cacheCollectionName === config.totalsDailyCollectionName
        ? queryEntityRecords(
            config.totalsHourlyCollectionName,
            "operator-machine",
            resolved.cacheSegments,
            {},
            serialFilter
          )
        : [],
      db
        .collection(config.stateTickerCollectionName)
        .find({
          $or: [
            { "machine.serial": { $in: serials } },
            { "machine.id": { $in: serials } },
          ],
        })
        .toArray(),
    ]);

    const tickerMap = buildLatestTickerMap(stateTickerData);
    const machineItemsBySerial = groupRecordsBySerial(machineItemRecords);
    const operatorMachineBySerial = groupRecordsBySerial(operatorMachineRecords);
    const operatorMachineHourlyBySerial = groupRecordsBySerial(operatorMachineHourlyRecords);
    const machineItemHourlyBySerial = groupRecordsBySerial(machineItemHourlyRecords);

    const results = await Promise.all(
      aggregates.map(async (aggregate) => {
        const machineSerial = aggregate.machineSerial;
        const machine = machineMap.get(machineSerial);
        const machineName = aggregate.machineName || machine?.name || `Serial ${machineSerial}`;
        const times = stateTimes.get(machineSerial);
        const record = {
          machineSerial,
          machineName,
          runtimeMs: Math.round(aggregate.runtimeMs || 0),
          pausedTimeMs: times?.pausedTime ?? aggregate.pausedTimeMs,
          faultTimeMs: times?.faultTime ?? aggregate.faultTimeMs,
          downTimeMs: Math.max((aggregate.productiveMs || requestEnd - requestStart) - aggregate.runtimeMs,
            (times?.pausedTime ?? aggregate.pausedTimeMs) + (times?.faultTime ?? aggregate.faultTimeMs)),
          workedTimeMs: Math.round(aggregate.workedTimeMs || 0),
          totalCounts: Math.round(aggregate.totalCounts || 0),
          totalMisfeeds: Math.round(aggregate.totalMisfeeds || 0),
          totalTimeCreditMs: Math.round(aggregate.totalTimeCreditMs || 0),
          timeRange: {
            start: aggregate.rangeStart || requestStart,
            end: aggregate.rangeEnd || requestEnd,
          },
        };

        const sessionCounts = await queryMachineCounts(
          machineSerial,
          []
        );
        const sessionHourlyItems = buildHourlyMachineItemRecordsFromCounts(sessionCounts);
        const sessionOperatorEfficiency = await buildSessionOperatorEfficiencyRecords(
          machineSerial,
          resolved.sessionSegments.length ? resolved.sessionSegments : []
        );

        const itemRecords = [
          ...(machineItemsBySerial.get(machineSerial) || []),
        ];
        const shiftHour = DateTime.fromJSDate(requestStart, {
          zone: SYSTEM_TIMEZONE,
        }).hour;
        const shiftItemHourlyRecords =
          resolved.cacheCollectionName === totalsShiftCollectionName
            ? itemRecords.map((record) => ({ ...record, hour: shiftHour }))
            : [];
        const shiftOperatorHourlyRecords =
          resolved.cacheCollectionName === totalsShiftCollectionName
            ? (operatorMachineBySerial.get(machineSerial) || []).map((record) => ({
                ...record,
                hour: shiftHour,
              }))
            : [];
        const hourlyItemRecords = [
          ...(machineItemHourlyBySerial.get(machineSerial) || []),
          ...shiftItemHourlyRecords,
          ...sessionHourlyItems,
        ];
        const operatorHourlyRecords = [
          ...(operatorMachineHourlyBySerial.get(machineSerial) || []),
          ...shiftOperatorHourlyRecords,
          ...sessionOperatorEfficiency,
        ];

        const cacheDateForCharts =
          resolved.cacheSegments[0]?.dateStr ||
          DateTime.fromJSDate(requestStart, { zone: SYSTEM_TIMEZONE }).toISODate();

        return {
          machine: {
            serial: machineSerial,
            name: machineName,
          },
          currentStatus: tickerMap.get(machineSerial)?.status || {
            code: 0,
            name: "Unknown",
          },
          performance: buildPerformanceFromMachineRecord(
            record,
            aggregate.productiveMs || requestEnd - requestStart
          ),
          itemSummary: buildItemSummaryFromRecords(
            itemRecords,
            requestStart,
            requestEnd
          ),
          itemHourlyStack: buildItemHourlyStackFromRecords(
            hourlyItemRecords,
            requestStart,
            null,
            cacheDateForCharts
          ),
          faultData: times?.faultData ?? {
            faultSummaries: [],
            faultCycles: [],
          },
          operatorEfficiency: buildOperatorEfficiencyFromRecords(
            operatorHourlyRecords,
            requestStart,
            null,
            cacheDateForCharts
          ),
          currentOperators: await buildCurrentOperatorsFast(machineSerial),
          timestamp: resolved.now.toJSDate(),
          sessionStart: record.timeRange.start,
          sessionEnd: record.timeRange.end,
        };
      })
    );

    return res.json(results.sort((a, b) => a.machine.serial - b.machine.serial));
  }

  router.get("/status", async (req, res) => {
    res.json({ vendor: "Spindle", status: "ok" });
  });

  router.get("/machine/overview", async (req, res) => {
    try {
      await buildMachineOverview(req, res);
    } catch (error) {
      logger.error("[spindle] Error in /machine/overview route:", error);
      res.status(500).json({ error: "Failed to fetch Spindle machine overview" });
    }
  });

  async function rawRecords(req, res, { collection, entity, event = false, operator = false }) {
    try {
      const operatorId = operator ? parseOperatorId(req.query.operatorid) : null;
      if (Number.isNaN(operatorId)) return badRequest(res, "operatorid must be numeric");
      const serial = parseSerial(req.query.serial);
      if (Number.isNaN(serial)) return badRequest(res, "serial must be numeric");
      const window = await resolveDetailsWindow(req, { maxDays: 7 });
      if (window.error) return res.status(window.error.status).json({ error: window.error.message });
      if (!window.start) return res.json([]);

      const range = { $gte: window.start.toJSDate(), $lt: window.end.toJSDate() };
      const filters = event ? [{ "timestamps.create": range }] : [
        { "timestamps.start": { $lt: window.end.toJSDate() } },
        { $or: [{ "timestamps.end": null }, { "timestamps.end": { $gt: window.start.toJSDate() } }] },
      ];
      if (serial !== null) filters.push(sessionMachineQuery(serial));
      if (operatorId !== null) filters.push(sessionOperatorQuery(operatorId));
      if (window.shiftDoc) filters.push(sessionShiftFilter(window.shiftDoc._id, { includeUntagged: true }));
      if (entity === "fault") filters.push(realFaultSessionQuery());
      const records = db.collection(collection);
      if (event) {
        const cursor = records.find({ $and: filters }).sort({ "timestamps.create": 1, _id: 1 });
        return await streamEvents(cursor, res);
      }
      const sessions = await records.find({ $and: filters }).sort({ "timestamps.start": 1, _id: 1 }).toArray();
      return res.json(entity === "fault" ? sessions.filter(isFaultSession) : sessions);
    } catch (error) {
      logger.error(`[spindle] Error fetching ${entity} records:`, error);
      if (res.headersSent || res.destroyed) return res.destroy();
      return res.status(500).json({ error: `Failed to fetch Spindle ${entity}${event ? "" : " sessions"}` });
    }
  }

  async function streamEvents(cursor, res) {
    const { once } = require("node:events");
    const disconnected = new AbortController();
    const close = () => disconnected.abort();
    res.once("close", close);
    try {
      res.type("json");
      let first = true;
      for await (const record of cursor) {
        if (res.destroyed) return;
        if (!res.write((first ? "[" : ",") + JSON.stringify(record))) {
          await once(res, "drain", { signal: disconnected.signal });
        }
        first = false;
      }
      if (!res.destroyed) res.end(first ? "[]" : "]");
    } finally {
      res.off("close", close);
      await cursor.close();
    }
  }

  router.get("/machine/sessions", (req, res) => rawRecords(req, res, { entity: "machine", collection: config.machineSessionCollectionName }));
  router.get("/operator/sessions", (req, res) => rawRecords(req, res, { entity: "operator", collection: config.operatorSessionCollectionName, operator: true }));
  router.get("/fault/sessions", (req, res) => rawRecords(req, res, { entity: "fault", collection: config.machineSessionCollectionName }));
  router.get("/states", (req, res) => rawRecords(req, res, { entity: "states", collection: config.machineStateCollectionName, event: true }));
  router.get("/counts", (req, res) => rawRecords(req, res, { entity: "counts", collection: config.countCollectionName, event: true, operator: true }));

  router.get("/machine/details", async (req, res) => {
    try {
      await buildMachineDetails(req, res);
    } catch (error) {
      logger.error("[spindle] Error in /machine/details route:", error);
      res.status(500).json({ error: "Failed to fetch Spindle machine details" });
    }
  });

  router.get("/operator/overview", async (req, res) => {
    try {
      await buildOperatorOverview(req, res);
    } catch (error) {
      logger.error("[spindle] Error in /operator/overview route:", error);
      res.status(500).json({ error: "Failed to fetch Spindle operator overview" });
    }
  });

  router.get("/operator/details", async (req, res) => {
    try {
      await buildOperatorDetails(req, res);
    } catch (error) {
      logger.error("[spindle] Error in /operator/details route:", error);
      res.status(500).json({ error: "Failed to fetch Spindle operator details" });
    }
  });

  return router;
}

