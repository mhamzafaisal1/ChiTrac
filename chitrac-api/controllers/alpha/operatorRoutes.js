// 📁 operatorRoutes.js
const express = require("express");
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const config = require("../../modules/config");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");
const {
  getOperatorsSummaryRealTime,
  buildItemSummaryFromCache,
  buildItemHourlyStackFromCacheForOperator,
  buildOperatorCyclePieFromCache,
  buildDailyEfficiencyFromCache,
  mergeIntervals,
  overlapsAny,
  coalesceItems,
} = require("../../utils/operatorFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const getOperatorsSummaryRealTimeHandler = getOperatorsSummaryRealTime(db, logger, config);

  // GET /api/alpha/analytics/operators-summary-daily-cached
  // Returns daily operator summary from totals-daily cache; falls back to real-time if no cache.
  router.get("/analytics/operators-summary-daily-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;

      const today = new Date();
      const wallClockNow = new Date(
        today.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
      );
      const dateStr = wallClockNow.toISOString().split("T")[0];

      // Load shifts once per request (used to make availability/downtime shift-aware).
      const activeShifts = await loadActiveShifts(db).catch(() => []);

      logger.info(`[operatorSessions] Fetching daily cached operators summary for date: ${dateStr}, operatorId: ${operatorId || "all"}`);

      const filter = {
        entityType: "operator-machine",
        date: dateStr,
      };

      if (operatorId && !Number.isNaN(operatorId)) {
        filter.operatorId = operatorId;
      }

      const cacheRecords = await db
        .collection("totals-daily")
        .find(filter)
        .toArray();

      if (cacheRecords.length === 0) {
        logger.warn(`[operatorSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`);
        return await getOperatorsSummaryRealTimeHandler(req, res);
      }

      const machineSerials = [
        ...new Set(
          cacheRecords
            .map((r) => r.machineSerial)
            .filter((serial) => serial !== null && serial !== undefined)
        ),
      ];

      const stateTickerData = await db.collection("stateTicker").find({}).toArray();

      const operatorTickerMap = new Map();
      for (const stateRecord of stateTickerData) {
        const machine = stateRecord.machine || {};
        const status = stateRecord.status || {};
        const timestamp = new Date(
          status.timestamp ||
            stateRecord.timestamp ||
            (stateRecord.timestamps &&
              (stateRecord.timestamps.update ||
                stateRecord.timestamps.active ||
                stateRecord.timestamps.create)) ||
            0
        ).getTime();

        if (Array.isArray(stateRecord.operators)) {
          for (const op of stateRecord.operators) {
            if (!op || typeof op.id === "undefined" || op.id === null) continue;

            const operatorKey = typeof op.id === "string" ? Number.parseInt(op.id, 10) : op.id;

            if (Number.isNaN(operatorKey)) continue;

            const existing = operatorTickerMap.get(operatorKey);
            if (!existing || existing.timestamp < timestamp) {
              const serial = machine.serial ?? machine.id ?? machine.serialNumber ?? null;
              const statusId = status?.id ?? status?.code ?? null;
              operatorTickerMap.set(operatorKey, {
                machine:
                  serial !== null && serial !== undefined
                    ? { serial, name: machine.name || null }
                    : null,
                status:
                  typeof statusId !== "undefined" && statusId !== null || typeof status.name !== "undefined"
                    ? { code: statusId, name: status.name ?? null }
                    : null,
                timestamp,
              });
            }
          }
        }
      }

      const operatorMap = new Map();

      for (const record of cacheRecords) {
        const opId = record.operatorId;

        if (!operatorMap.has(opId)) {
          const operatorNameStr =
            typeof record.operatorName === "object" && record.operatorName !== null
              ? `${record.operatorName.first || ""} ${record.operatorName.surname || ""}`.trim() || "Unknown"
              : record.operatorName || "Unknown";

          operatorMap.set(opId, {
            operator: { id: record.operatorId, name: operatorNameStr },
            currentStatus: null,
            currentMachine: null,
            metrics: {
              runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              output: { totalCount: 0, misfeedCount: 0 },
              performance: {
                availability: { value: 0, percentage: "0.00" },
                throughput: { value: 0, percentage: "0.00" },
                efficiency: { value: 0, percentage: "0.00" },
                oee: { value: 0, percentage: "0.00" },
              },
            },
            timeRange: record.buildRange || record.timeRange,
            machines: [],
            efficiencyData: [],
          });
        }

        const operatorData = operatorMap.get(opId);

        operatorData.machines.push({
          serial: record.machineSerial,
          name: record.machineName,
        });

        const tickerContext = operatorTickerMap.get(opId);
        if (tickerContext) {
          operatorData.currentMachine = tickerContext.machine;
          operatorData.currentStatus = tickerContext.status;
        } else {
          operatorData.currentMachine = null;
          operatorData.currentStatus = null;
        }

        operatorData.metrics.runtime.total += record.runtimeMs || 0;
        operatorData.metrics.output.totalCount += record.totalCounts;
        operatorData.metrics.output.misfeedCount += record.totalMisfeeds;

        const workTimeSec = record.workedTimeMs / 1000;
        const timeCreditSec = record.totalTimeCreditMs / 1000;
        const efficiency = workTimeSec > 0 ? timeCreditSec / workTimeSec : 0;

        operatorData.efficiencyData.push({
          efficiency,
          weight: record.workedTimeMs,
        });
      }

      const results = Array.from(operatorMap.values()).map((operatorData) => {
        const { runtime, downtime, output } = operatorData.metrics;

        let rangeStart = null;
        let rangeEnd = null;

        if (operatorData.timeRange && operatorData.timeRange.start && operatorData.timeRange.end) {
          try {
            const startDate = new Date(operatorData.timeRange.start);
            const endDate = new Date(operatorData.timeRange.end);
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate > startDate) {
              rangeStart = startDate;
              rangeEnd = endDate;
            }
          } catch (e) {
            logger.warn(`[operatorSessions] Invalid timeRange for operator ${operatorData.operator.id}:`, e);
          }
        }

        if (!rangeStart || !rangeEnd) {
          // Keep legacy fallback when timeRange is missing/invalid.
          rangeStart = new Date(`${dateStr}T06:00:00.000Z`);
          rangeEnd = chicagoTime;
        }

        const shiftElapsedMs = computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);
        downtime.total = Math.max(shiftElapsedMs - runtime.total, 0);

        const availability = shiftElapsedMs > 0 ? runtime.total / shiftElapsedMs : 0;
        const throughput =
          output.totalCount + output.misfeedCount > 0
            ? output.totalCount / (output.totalCount + output.misfeedCount)
            : 0;

        let totalWeightedEfficiency = 0;
        let totalWeight = 0;

        for (const effData of operatorData.efficiencyData) {
          totalWeightedEfficiency += effData.efficiency * effData.weight;
          totalWeight += effData.weight;
        }

        const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
        const oee = availability * throughput * efficiency;

        operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
        operatorData.metrics.downtime.formatted = formatDuration(downtime.total);

        operatorData.metrics.performance = {
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
        };

        delete operatorData.machines;
        delete operatorData.efficiencyData;

        return operatorData;
      });

      const MIN_RUNTIME_TO_SHOW_MS = 3600000;
      const filteredResults = results.filter((operatorData) => {
        const hasRuntime = operatorData.metrics.runtime.total > 0;
        const hasProduction = operatorData.metrics.output.totalCount > 0;
        const hasCurrentMachine = operatorData.currentMachine !== null;
        const hasSignificantRuntime = operatorData.metrics.runtime.total >= MIN_RUNTIME_TO_SHOW_MS;

        return hasRuntime && hasProduction && (hasCurrentMachine || hasSignificantRuntime);
      });

      logger.info(
        `[operatorSessions] Retrieved ${results.length} daily cached operator records (${filteredResults.length} after filtering phantoms) for date: ${dateStr}`
      );
      res.json(filteredResults);
    } catch (err) {
      logger.error(`[operatorSessions] Error in daily cached operators-summary route:`, err);

      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date") ||
        err.message.includes("Invalid timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }

      logger.info(`[operatorSessions] Falling back to real-time calculation due to error`);
      return await getOperatorsSummaryRealTimeHandler(req, res);
    }
  });

  // GET /api/alpha/analytics/operator-details-cached
  // Returns operator details built entirely from cache (totals-daily + hourly-totals).
  router.get("/analytics/operator-details-cached", async (req, res) => {
    try {
      const { start, end, operatorId, serial, tz } = req.query;

      if (!start || !end || !operatorId) {
        return res.status(400).json({ error: "start, end, and operatorId are required" });
      }

      const opId = Number(operatorId);
      if (isNaN(opId)) {
        return res.status(400).json({ error: "operatorId must be a valid number" });
      }

      const tzParam = tz || SYSTEM_TIMEZONE;

      const nameDocPromise = db.collection("totals-daily")
        .find({
          entityType: "operator-machine",
          operatorId: opId,
          ...(serial ? { machineSerial: Number(serial) } : {}),
        })
        .project({ _id: 0, operatorName: 1, machineName: 1 })
        .sort({ dateObj: -1 })
        .limit(1)
        .next();

      const [nameDoc, itemSummary, countByItem, cyclePie, dailyEfficiency] = await Promise.all([
        nameDocPromise,
        buildItemSummaryFromCache(db, opId, start, end, serial),
        buildItemHourlyStackFromCacheForOperator(db, logger, opId, start, end, serial),
        buildOperatorCyclePieFromCache(db, logger, opId, start, end, serial),
        buildDailyEfficiencyFromCache(db, logger, opId, `Operator ${opId}`, start, end, serial, tzParam),
      ]);

      const rawName = nameDoc?.operatorName;
      const operatorName =
        typeof rawName === "object" && rawName !== null
          ? `${rawName.first || ""} ${rawName.surname || ""}`.trim() || `Operator ${opId}`
          : rawName || `Operator ${opId}`;
      if (dailyEfficiency?.operator) dailyEfficiency.operator.name = operatorName;

      const transformedItemSummary = itemSummary.sessions.flatMap((session) => {
        if (!Array.isArray(session.items) || !session.items.length) return [];
        const mSerial = session.machine?.serial ?? "Unknown";
        const mName = session.machine?.name ?? "Unknown";
        return session.items.map((item) => ({
          operatorName: operatorName,
          machineSerial: mSerial,
          machineName: mName,
          itemName: item.name || "Unknown",
          count: item.countTotal || 0,
          misfeed: 0,
          standard: item.standard || 0,
          valid: item.countTotal || 0,
          pph: item.pph || 0,
          efficiency: item.efficiency || 0,
          workedTimeFormatted: session.workedTimeFormatted || formatDuration(0),
        }));
      });

      return res.json({
        itemSummary: transformedItemSummary,
        countByItem,
        cyclePie,
        dailyEfficiency,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator details from cache" });
    }
  });

  // GET /api/alpha/analytics/operator-machine-summary
  // Aggregates operator sessions by machine with totals, items, and fault overlap count.
  router.get("/analytics/operator-machine-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = Number(req.query.operatorId);
      if (!operatorId || Number.isNaN(operatorId)) {
        return res.status(400).json({ error: "operatorId required and must be a number" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      const matchSessions = {
        "operator.id": operatorId,
        "timestamps.start": { $lte: endDate },
        $or: [{ "timestamps.end": { $exists: false } }, { "timestamps.end": { $gte: startDate } }],
      };

      const sessionsAgg = await db.collection(config.operatorSessionCollectionName).aggregate([
        { $match: matchSessions },
        {
          $project: {
            machine: 1,
            timestamps: 1,
            totalCount: 1,
            misfeedCount: 1,
            totalTimeCredit: 1,
            runtime: 1,
            items: 1,
            item: 1,
            totalCountByItem: 1,
            timeCreditByItem: 1,
          },
        },
        {
          $set: {
            _ovStart: { $max: ["$timestamps.start", startDate] },
            _ovEnd: {
              $min: [{ $ifNull: ["$timestamps.end", endDate] }, endDate],
            },
          },
        },
        { $match: { $expr: { $lt: ["$_ovStart", "$_ovEnd"] } } },
        {
          $addFields: {
            _items: {
              $cond: {
                if: { $isArray: "$items" },
                then: "$items",
                else: {
                  $cond: {
                    if: { $ne: ["$item", null] },
                    then: ["$item"],
                    else: [],
                  },
                },
              },
            },
            _totalCountByItem: {
              $cond: {
                if: { $isArray: "$totalCountByItem" },
                then: "$totalCountByItem",
                else: [],
              },
            },
            _timeCreditByItem: {
              $cond: {
                if: { $isArray: "$timeCreditByItem" },
                then: "$timeCreditByItem",
                else: [],
              },
            },
          },
        },
        {
          $set: {
            _itemsPaired: {
              $map: {
                input: { $range: [0, { $size: "$_items" }] },
                as: "i",
                in: {
                  $let: {
                    vars: {
                      it: { $arrayElemAt: ["$_items", "$$i"] },
                      cnt: { $arrayElemAt: ["$_totalCountByItem", "$$i"] },
                      tci: { $arrayElemAt: ["$_timeCreditByItem", "$$i"] },
                    },
                    in: {
                      id: "$$it.id",
                      name: "$$it.name",
                      standard: "$$it.standard",
                      count: { $ifNull: ["$$cnt", 0] },
                      tci: { $ifNull: ["$$tci", 0] },
                    },
                  },
                },
              },
            },
          },
        },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: { serial: "$machine.serial", name: "$machine.name" },
                  sessions: { $sum: 1 },
                  totalCount: { $sum: { $ifNull: ["$totalCount", 0] } },
                  totalMisfeed: { $sum: { $ifNull: ["$misfeedCount", 0] } },
                  totalTimeCredit: { $sum: { $ifNull: ["$totalTimeCredit", 0] } },
                  runtime: { $sum: { $ifNull: ["$runtime", 0] } },
                  intervals: { $push: { start: "$_ovStart", end: "$_ovEnd" } },
                },
              },
              { $sort: { "_id.serial": 1 } },
            ],
            items: [
              { $unwind: { path: "$_itemsPaired", preserveNullAndEmptyArrays: true } },
              {
                $group: {
                  _id: {
                    serial: "$machine.serial",
                    name: "$machine.name",
                    itemId: "$_itemsPaired.id",
                    itemName: "$_itemsPaired.name",
                    itemStd: "$_itemsPaired.standard",
                  },
                  sessionIds: { $addToSet: "$_id" },
                  itemCount: { $sum: { $ifNull: ["$_itemsPaired.count", 0] } },
                  itemTCI: { $sum: { $ifNull: ["$_itemsPaired.tci", 0] } },
                },
              },
              {
                $group: {
                  _id: { serial: "$_id.serial", name: "$_id.name" },
                  items: {
                    $push: {
                      id: "$_id.itemId",
                      name: "$_id.itemName",
                      standard: "$_id.itemStd",
                      totalCount: "$itemCount",
                      totalTimeCredit: "$itemTCI",
                    },
                  },
                  allSessionIds: { $push: "$sessionIds" },
                },
              },
              {
                $set: {
                  sessions: {
                    $size: {
                      $reduce: {
                        input: "$allSessionIds",
                        initialValue: [],
                        in: { $setUnion: ["$$value", "$$this"] },
                      },
                    },
                  },
                  items: {
                    $filter: {
                      input: "$items",
                      as: "it",
                      cond: { $ne: ["$$it.id", null] },
                    },
                  },
                },
              },
              { $project: { allSessionIds: 0 } },
              { $sort: { "_id.serial": 1 } },
            ],
          },
        },
      ]).toArray();

      const facetResult = (sessionsAgg && sessionsAgg[0]) || { totals: [], items: [] };
      const totalsBySerial = new Map((facetResult.totals || []).map((t) => [t._id.serial, t]));
      const itemsBySerial = new Map((facetResult.items || []).map((i) => [i._id.serial, i]));
      const serials = [...new Set([...totalsBySerial.keys(), ...itemsBySerial.keys()])].sort((a, b) =>
        a == null ? 1 : b == null ? -1 : a - b
      );
      const sessionsAggMerged = serials.map((serial) => {
        const t = totalsBySerial.get(serial);
        const i = itemsBySerial.get(serial);
        if (!t) {
          return {
            _id: { serial, name: (i && i._id) ? i._id.name : `Serial ${serial}` },
            sessions: (i && i.sessions) != null ? i.sessions : 0,
            totals: { totalCount: 0, totalMisfeed: 0, totalTimeCredit: 0, runtime: 0 },
            intervals: [],
            items: (i && i.items) ? i.items : [],
          };
        }
        return {
          _id: { serial: t._id.serial, name: t._id.name },
          sessions: t.sessions,
          totals: {
            totalCount: t.totalCount,
            totalMisfeed: t.totalMisfeed,
            totalTimeCredit: t.totalTimeCredit,
            runtime: t.runtime,
          },
          intervals: t.intervals ?? [],
          items: (i && i.items) ? i.items : [],
        };
      });

      if (!sessionsAggMerged.length) {
        return res.json({ context: { operatorId, start: startDate, end: endDate }, machines: [] });
      }

      const faultsByMachine = await db
        .collection(config.faultSessionCollectionName)
        .aggregate([
          {
            $match: {
              "operators.id": operatorId,
              "timestamps.start": { $lte: endDate },
              $or: [
                { "timestamps.end": { $exists: false } },
                { "timestamps.end": { $gte: startDate } },
              ],
            },
          },
          {
            $project: {
              serial: "$machine.serial",
              s: "$timestamps.start",
              e: { $ifNull: ["$timestamps.end", endDate] },
            },
          },
          {
            $group: {
              _id: "$serial",
              faults: { $push: { s: "$s", e: "$e" } },
            },
          },
        ])
        .toArray();

      const faultMap = new Map(faultsByMachine.map((x) => [x._id, x.faults]));

      const results = sessionsAggMerged.map((m) => {
        const serial = m._id.serial;
        const merged = mergeIntervals(m.intervals.map((iv) => ({ s: iv.start, e: iv.end })));
        const faults = faultMap.get(serial) ?? [];
        let faultsWhileRunning = 0;
        for (const f of faults) {
          if (overlapsAny(f, merged)) faultsWhileRunning += 1;
        }
        return {
          machine: { serial, name: m._id.name },
          sessions: m.sessions,
          faultsWhileRunning,
          totals: m.totals,
          items: coalesceItems(m.items),
        };
      });

      return res.json({
        context: { operatorId, start: startDate, end: endDate },
        machines: results,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Failed to build operator machine summary" });
    }
  });

  return router;
};
