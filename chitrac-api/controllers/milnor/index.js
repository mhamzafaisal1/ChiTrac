const { createVendorAnalytics } = require("../shared/vendorAnalytics");
const express = require("express");
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

  async function resolveDetailsTimeframe(req, keyPrefix) {
    const timeframe = req.query.timeframe || "today";
    if (!["today", "custom", "shift"].includes(timeframe)) {
      return { error: { status: 400, message: "Invalid timeframe" } };
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
            key: `${keyPrefix}-daily:${today.dateStr}`,
            dateStr: today.dateStr,
            start: today.start.toJSDate(),
            end: today.end.toJSDate(),
          },
        ];
      } else if (timeframe === "custom") {
        const startDT = parseIsoDate(req.query.start, "start");
        const endDT = req.query.end ? parseIsoDate(req.query.end, "end") : now;
        const clampedEndDT = endDT > now ? now : endDT;

        if (startDT >= clampedEndDT) {
          return { error: { status: 400, message: "Start date must be before end date" } };
        }

        const split = splitCustomRange(startDT, clampedEndDT);
        cacheSegments = split.cacheSegments.map((segment) => ({
          ...segment,
          key: `${keyPrefix}-daily:${segment.dateStr}`,
        }));
        sessionSegments = split.sessionSegments.map((segment, index) => ({
          ...segment,
          key: `${keyPrefix}-session:${index}:${segment.start.getTime()}-${segment.end.getTime()}`,
        }));
      } else {
        const shiftIntegerId = parseRequiredInteger(req.query.shift);
        if (Number.isNaN(shiftIntegerId)) {
          return {
            error: {
              status: 400,
              message: "shift is required and must be an integer",
            },
          };
        }

        shiftDoc = await db.collection(config.shiftCollectionName).findOne({
          id: shiftIntegerId,
        });

        if (!shiftDoc) {
          return { error: { status: 404, message: "Shift not found" } };
        }

        const shiftWindow = shiftWindowForToday(shiftDoc, now);
        if (!shiftWindow || shiftWindow.end <= shiftWindow.start) {
          return {
            timeframe,
            shiftDoc,
            cacheSegments: [],
            sessionSegments: [],
            cacheCollectionName,
            cacheBaseFilter,
            sessionOptions,
            activeShifts: [shiftDoc],
            allSegments: [],
            now,
          };
        }

        cacheCollectionName = totalsShiftCollectionName;
        cacheBaseFilter = { shiftId: shiftDoc._id.toString() };
        sessionOptions = { shiftId: shiftDoc._id.toString() };
        cacheSegments = [
          {
            key: `${keyPrefix}-shift:${shiftDoc._id.toString()}:${shiftWindow.dateStr}`,
            dateStr: shiftWindow.dateStr,
            start: shiftWindow.start,
            end: shiftWindow.end,
          },
        ];
      }
    } catch (error) {
      return { error: { status: 400, message: error.message } };
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
        { ...resolved.sessionOptions, skipRawCounts: true }
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
        { ...resolved.sessionOptions, skipRawCounts: true }
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

    const aggregates = [...aggregateMap.values()].filter((aggregate) => {
      if (serial !== null) return aggregate.machineSerial === serial && aggregate.hasData;
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
    const requestStart = resolved.allSegments[0].start;
    const requestEnd = resolved.allSegments[resolved.allSegments.length - 1].end;

    const results = await Promise.all(
      aggregates.map(async (aggregate) => {
        const machineSerial = aggregate.machineSerial;
        const machine = machineMap.get(machineSerial);
        const machineName = aggregate.machineName || machine?.name || `Serial ${machineSerial}`;
        const record = {
          machineSerial,
          machineName,
          runtimeMs: Math.round(aggregate.runtimeMs || 0),
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
          faultData: {
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
    res.json({ vendor: "Milnor", status: "ok" });
  });

  router.get("/machine/overview", async (req, res) => {
    try {
      await buildMachineOverview(req, res);
    } catch (error) {
      logger.error("[milnor] Error in /machine/overview route:", error);
      res.status(500).json({ error: "Failed to fetch Milnor machine overview" });
    }
  });

  router.get("/machine/details", async (req, res) => {
    try {
      await buildMachineDetails(req, res);
    } catch (error) {
      logger.error("[milnor] Error in /machine/details route:", error);
      res.status(500).json({ error: "Failed to fetch Milnor machine details" });
    }
  });

  router.get("/operator/overview", async (req, res) => {
    try {
      await buildOperatorOverview(req, res);
    } catch (error) {
      logger.error("[milnor] Error in /operator/overview route:", error);
      res.status(500).json({ error: "Failed to fetch Milnor operator overview" });
    }
  });

  router.get("/operator/details", async (req, res) => {
    try {
      await buildOperatorDetails(req, res);
    } catch (error) {
      logger.error("[milnor] Error in /operator/details route:", error);
      res.status(500).json({ error: "Failed to fetch Milnor operator details" });
    }
  });

  return router;
}

