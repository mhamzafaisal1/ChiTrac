const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time");
const { formatHumanName } = require("../../utils/humanNames");
const { computeShiftElapsedMs } = require("../../utils/shiftElapsed");
const { getShiftTimeComponents } = require("../../utils/shiftTimeComponents");
const {
  buildItemSummaryFromCache,
  buildItemHourlyStackFromCacheForOperator,
  buildOperatorCyclePieFromCache,
  buildDailyEfficiencyFromCache,
} = require("../../utils/operatorFunctions");

// Shared request parsing, overview aggregation, and operator details for Milnor and Spindle.
// Machine aggregation and details windows stay with each vendor to preserve their semantics.
function createVendorAnalytics(server, {
  createAggregate,
  addRecordToAggregate,
  addSessionFallback,
  resolveDetailsTimeframe,
}) {
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

  function parseOperatorId(raw) {
    if (typeof raw === "undefined" || raw === null || raw === "") return null;
    const operatorId = Number.parseInt(String(raw), 10);
    return Number.isFinite(operatorId) && String(operatorId) === String(raw).trim()
      ? operatorId
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

    const components = getShiftTimeComponents(shiftDoc);
    const startHour = components?.startTime?.hour;
    const startMinute = components?.startTime?.minute;
    const endHour = components?.endTime?.hour;
    const endMinute = components?.endTime?.minute;

    if (
      typeof startHour !== "number" ||
      typeof startMinute !== "number" ||
      typeof endHour !== "number" ||
      typeof endMinute !== "number"
    ) {
      throw new Error("Shift is missing timestamps.start or timestamps.end");
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
    if (serial !== null) filter.id = serial;

    const machines = await db
      .collection(config.machineCollectionName)
      .find(filter)
      .project({ _id: 0, id: 1, serial: 1, name: 1 })
      .toArray();

    return new Map(
      machines
        .map((machine) => {
          const machineSerial = Number(machine.id ?? machine.serial);
          return [machineSerial, { ...machine, serial: machineSerial }];
        })
        .filter(([machineSerial]) => Number.isFinite(machineSerial))
    );
  }

  async function loadActiveShifts() {
    return db
      .collection(config.shiftCollectionName)
      .find({ active: true })
      .toArray();
  }

  function formatName(name, fallback = "Unknown") {
    return formatHumanName(name, fallback);
  }

  async function loadActiveOperatorIds(operatorId) {
    const filter = { active: { $ne: false } };
    if (operatorId !== null) {
      filter.$or = [{ id: operatorId }, { code: operatorId }];
    }

    const operators = await db
      .collection(config.operatorCollectionName)
      .find(filter)
      .project({ _id: 0, id: 1, code: 1, name: 1 })
      .toArray();

    return new Map(
      operators
        .map((operator) => [
          Number(operator.id ?? operator.code),
          {
            id: Number(operator.id ?? operator.code),
            name: formatName(operator.name, `Operator ${operator.id ?? operator.code}`),
          },
        ])
        .filter(([id]) => Number.isFinite(id))
    );
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
        timestamps: 1,
      })
      .toArray();

    const statusMap = new Map();
    for (const ticker of tickers) {
      const machineSerial = Number(ticker.machine?.serial ?? ticker.machine?.id);
      if (!Number.isFinite(machineSerial)) continue;

      const timestamp = new Date(ticker.timestamps?.update || ticker.timestamps?.create || 0).getTime();
      const existing = statusMap.get(machineSerial);
      if (existing && existing.timestamp >= timestamp) continue;

      statusMap.set(machineSerial, {
        timestamp,
        status: {
          code: ticker.status?.id ?? ticker.status?.code ?? 0,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.color || ticker.status?.softrolColor || "None",
        },
      });
    }

    return statusMap;
  }

  async function buildOperatorTickerMap(operatorIds = []) {
    const operatorIdSet = new Set(
      operatorIds.filter((operatorId) => Number.isFinite(operatorId))
    );

    const tickers = await db
      .collection(config.stateTickerCollectionName)
      .find({})
      .project({
        _id: 0,
        machine: 1,
        operators: 1,
        status: 1,
        timestamps: 1,
      })
      .toArray();

    const tickerMap = new Map();
    for (const ticker of tickers) {
      const operators = Array.isArray(ticker.operators) ? ticker.operators : [];
      if (!operators.length) continue;

      const status = ticker.status || {};
      const timestamp = new Date(
        ticker.timestamps?.update ||
          ticker.timestamps?.active ||
          ticker.timestamps?.create ||
          0
      ).getTime();

      for (const operator of operators) {
        const operatorId = Number(operator?.id);
        if (!Number.isFinite(operatorId) || operatorId === -1) continue;
        if (operatorIdSet.size && !operatorIdSet.has(operatorId)) continue;

        const existing = tickerMap.get(operatorId);
        if (existing && existing.timestamp >= timestamp) continue;

        const machineSerial = ticker.machine?.serial ?? ticker.machine?.id ?? null;
        tickerMap.set(operatorId, {
          timestamp,
          machine:
            machineSerial !== null && typeof machineSerial !== "undefined"
              ? {
                  serial: machineSerial,
                  name: ticker.machine?.name || null,
                }
              : null,
          status: {
            code: status.id ?? status.code ?? null,
            name: status.name ?? null,
            color: status.color || status.softrolColor || "None",
          },
        });
      }
    }

    return tickerMap;
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

  function createOperatorAggregate(operatorId, operatorName = null) {
    return {
      operatorId: Number(operatorId),
      operatorName: operatorName || `Operator ${operatorId}`,
      currentStatus: null,
      currentMachine: null,
      runtimeMs: 0,
      workedTimeMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
      totalTimeCreditMs: 0,
      productiveMs: 0,
      segmentKeys: new Set(),
      rangeStart: null,
      rangeEnd: null,
      efficiencyData: [],
      hasData: false,
    };
  }

  function addOperatorSegmentProductive(aggregate, segment) {
    if (!aggregate.segmentKeys.has(segment.key)) {
      aggregate.productiveMs += segment.productiveMs;
      aggregate.segmentKeys.add(segment.key);
    }

    if (!aggregate.rangeStart || segment.start < aggregate.rangeStart) {
      aggregate.rangeStart = segment.start;
    }
    if (!aggregate.rangeEnd || segment.end > aggregate.rangeEnd) {
      aggregate.rangeEnd = segment.end;
    }
  }

  function addOperatorRecordToAggregate(aggregateMap, record, segment) {
    const operatorId = Number(record.operatorId);
    if (!Number.isFinite(operatorId) || operatorId === -1) return;

    const operatorName = formatName(record.operatorName, `Operator ${operatorId}`);
    if (!aggregateMap.has(operatorId)) {
      aggregateMap.set(operatorId, createOperatorAggregate(operatorId, operatorName));
    }

    const aggregate = aggregateMap.get(operatorId);
    aggregate.operatorName = operatorName || aggregate.operatorName;
    aggregate.runtimeMs += record.runtimeMs || 0;
    aggregate.workedTimeMs += record.workedTimeMs || 0;
    aggregate.totalCounts += record.totalCounts || record.totalCount || 0;
    aggregate.totalMisfeeds += record.totalMisfeeds || record.misfeedCount || 0;
    aggregate.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    aggregate.hasData = true;

    if (record.machineSerial || record.machineName) {
      aggregate.currentMachine = {
        serial: record.machineSerial ?? null,
        name: record.machineName ?? null,
      };
    }

    const workedTimeMs = record.workedTimeMs || 0;
    if (workedTimeMs > 0) {
      aggregate.efficiencyData.push({
        efficiency: (record.totalTimeCreditMs || 0) / workedTimeMs,
        weight: workedTimeMs,
      });
    }

    addOperatorSegmentProductive(aggregate, segment);
  }

  async function addOperatorSessionFallback(aggregateMap, segment, operatorIds, options = {}) {
    if (!operatorIds.length) return;

    const sessionMatch = {
      $and: [
        { "operator.id": { $in: operatorIds } },
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
      sessionMatch.$and.push({ "shift._id": options.shiftId });
    }
    if (options.machineSerial !== null && typeof options.machineSerial !== "undefined") {
      sessionMatch.$and.push({
        $or: [
          { "machine.serial": Number(options.machineSerial) },
          { "machine.id": Number(options.machineSerial) },
        ],
      });
    }

    const sessions = await db
      .collection(config.operatorSessionCollectionName)
      .find(sessionMatch)
      .project({
        _id: 0,
        operator: 1,
        machine: 1,
        timestamps: 1,
        runtime: 1,
        workTime: 1,
        totalCount: 1,
        misfeedCount: 1,
        totalTimeCredit: 1,
        counts: 1,
        misfeeds: 1,
      })
      .toArray();

    const sessionBuckets = new Map();
    for (const session of sessions) {
      const operatorId = Number(session.operator?.id);
      if (!operatorIds.includes(operatorId) || operatorId === -1) continue;

      const sessionStart = new Date(session.timestamps?.start);
      const rawSessionEnd = session.timestamps?.end
        ? new Date(session.timestamps.end)
        : segment.end;
      const clampedStart = sessionStart > segment.start ? sessionStart : segment.start;
      const clampedEnd = rawSessionEnd < segment.end ? rawSessionEnd : segment.end;
      const runtimeMs = Math.max(0, clampedEnd - clampedStart);
      if (runtimeMs <= 0) continue;

      const fullSessionMs = Math.max(0, rawSessionEnd - sessionStart);
      const overlapFactor = fullSessionMs > 0 ? runtimeMs / fullSessionMs : 1;
      const storedRuntimeSec = Number(session.runtime) || 0;
      const runtimeFromStoredMs =
        storedRuntimeSec > 0 ? storedRuntimeSec * 1000 * overlapFactor : runtimeMs;
      const storedWorkSec = Number(session.workTime) || 0;
      const workedTimeMs =
        storedWorkSec > 0 ? storedWorkSec * 1000 * overlapFactor : runtimeMs;
      const totalTimeCreditMs =
        Number(session.totalTimeCredit || 0) * 1000 * overlapFactor;
      const totalCounts = Number(session.totalCount || 0) * overlapFactor;
      const totalMisfeeds = Number(session.misfeedCount || 0) * overlapFactor;

      const bucket =
        sessionBuckets.get(operatorId) ||
        {
          operatorId,
          operatorName: formatName(session.operator?.name, `Operator ${operatorId}`),
          machineSerial: session.machine?.serial ?? session.machine?.id ?? null,
          machineName: session.machine?.name ?? null,
          runtimeMs: 0,
          workedTimeMs: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          totalTimeCreditMs: 0,
        };

      bucket.runtimeMs += runtimeFromStoredMs;
      bucket.workedTimeMs += workedTimeMs;
      bucket.totalCounts += totalCounts;
      bucket.totalMisfeeds += totalMisfeeds;
      bucket.totalTimeCreditMs += totalTimeCreditMs;
      if (session.machine?.serial || session.machine?.id) {
        bucket.machineSerial = session.machine.serial ?? session.machine.id;
        bucket.machineName = session.machine.name ?? null;
      }

      sessionBuckets.set(operatorId, bucket);
    }

    for (const record of sessionBuckets.values()) {
      record.totalCounts = Math.round(record.totalCounts);
      record.totalMisfeeds = Math.round(record.totalMisfeeds);
      addOperatorRecordToAggregate(aggregateMap, record, segment);
    }
  }

  async function addOperatorCacheSegment(
    aggregateMap,
    segment,
    collectionName,
    baseFilter,
    operatorIds,
    sessionOptions = {}
  ) {
    const filter = {
      ...baseFilter,
      entityType: "operator-machine",
      date: segment.dateStr,
    };

    if (operatorIds.length === 1) {
      filter.operatorId = operatorIds[0];
    } else if (operatorIds.length > 1) {
      filter.operatorId = { $in: operatorIds };
    }

    const records = await db.collection(collectionName).find(filter).toArray();
    const foundOperatorIds = new Set();

    for (const record of records) {
      const operatorId = Number(record.operatorId);
      if (!Number.isFinite(operatorId) || operatorId === -1) continue;
      foundOperatorIds.add(operatorId);
      addOperatorRecordToAggregate(aggregateMap, record, segment);
    }

    const missingOperatorIds = operatorIds.filter(
      (operatorId) => !foundOperatorIds.has(operatorId)
    );
    await addOperatorSessionFallback(
      aggregateMap,
      segment,
      missingOperatorIds,
      sessionOptions
    );
  }

  function toOperatorOverviewRow(aggregate, tickerMap, requestStart, requestEnd) {
    const runtimeMs = Math.round(aggregate.runtimeMs || 0);
    const productiveMs = aggregate.productiveMs || 0;
    const downtimeMs = Math.max(productiveMs - runtimeMs, 0);
    const totalCounts = Math.round(aggregate.totalCounts || 0);
    const totalMisfeeds = Math.round(aggregate.totalMisfeeds || 0);
    const totalOutput = totalCounts + totalMisfeeds;

    const availability = productiveMs > 0 ? runtimeMs / productiveMs : 0;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;

    let totalWeightedEfficiency = 0;
    let totalWeight = 0;
    for (const entry of aggregate.efficiencyData) {
      totalWeightedEfficiency += entry.efficiency * entry.weight;
      totalWeight += entry.weight;
    }
    const efficiency =
      totalWeight > 0
        ? totalWeightedEfficiency / totalWeight
        : aggregate.workedTimeMs > 0
          ? aggregate.totalTimeCreditMs / aggregate.workedTimeMs
          : 0;
    const oee = availability * throughput * efficiency;
    const tickerContext = tickerMap.get(aggregate.operatorId);

    return {
      operator: {
        id: aggregate.operatorId,
        name: aggregate.operatorName,
      },
      currentStatus: tickerContext?.status || aggregate.currentStatus || null,
      currentMachine: tickerContext?.machine || aggregate.currentMachine || null,
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

  async function buildOperatorOverview(req, res) {
    const timeframe = req.query.timeframe || "today";
    if (!["today", "custom", "shift"].includes(timeframe)) {
      return badRequest(res, "Invalid timeframe");
    }

    const operatorId = parseOperatorId(req.query.operatorid);
    if (Number.isNaN(operatorId)) {
      return badRequest(res, "operatorid must be numeric");
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
            key: `operator-daily:${today.dateStr}`,
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
          return badRequest(res, "Start date must be before end date");
        }

        const split = splitCustomRange(startDT, clampedEndDT);
        cacheSegments = split.cacheSegments.map((segment) => ({
          ...segment,
          key: `operator-daily:${segment.dateStr}`,
        }));
        sessionSegments = split.sessionSegments.map((segment, index) => ({
          ...segment,
          key: `operator-session:${index}:${segment.start.getTime()}-${segment.end.getTime()}`,
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
            key: `operator-shift:${shiftDoc._id.toString()}:${shiftWindow.dateStr}`,
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
    const operatorMap = await loadActiveOperatorIds(operatorId);
    const requestedOperatorIds =
      operatorId !== null ? [operatorId] : [...operatorMap.keys()];
    const aggregateMap = new Map();

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
      await addOperatorCacheSegment(
        aggregateMap,
        segment,
        cacheCollectionName,
        cacheBaseFilter,
        requestedOperatorIds,
        sessionOptions
      );
    }

    for (const segment of sessionSegments) {
      await addOperatorSessionFallback(
        aggregateMap,
        segment,
        requestedOperatorIds,
        sessionOptions
      );
    }

    for (const [id, operator] of operatorMap) {
      const aggregate = aggregateMap.get(id);
      if (aggregate) {
        aggregate.operatorName = operator.name || aggregate.operatorName;
      }
    }

    const aggregates = [...aggregateMap.values()].filter((aggregate) => {
      if (operatorId !== null) {
        return aggregate.operatorId === operatorId && aggregate.hasData;
      }

      const hasRuntime = aggregate.runtimeMs > 0;
      const hasProduction = aggregate.totalCounts > 0;
      const hasCurrentMachine = aggregate.currentMachine !== null;
      const hasSignificantRuntime = aggregate.runtimeMs >= 3600000;
      return (
        requestedOperatorIds.includes(aggregate.operatorId) &&
        hasRuntime &&
        hasProduction &&
        (hasCurrentMachine || hasSignificantRuntime)
      );
    });

    if (!aggregates.length) {
      return res.json([]);
    }

    const tickerMap = await buildOperatorTickerMap(
      aggregates.map((aggregate) => aggregate.operatorId)
    );
    const requestStart = allSegments[0]?.start || now.startOf("day").toJSDate();
    const requestEnd = allSegments[allSegments.length - 1]?.end || now.toJSDate();
    const data = aggregates
      .map((aggregate) =>
        toOperatorOverviewRow(aggregate, tickerMap, requestStart, requestEnd)
      )
      .sort((a, b) => a.operator.id - b.operator.id);

    return res.json(data);
  }

  function dateFilterForSegments(segments) {
    const dateStrs = [...new Set(segments.map((segment) => segment.dateStr))];
    return {
      dateStrs,
      dateObjs: dateStrs.map((dateStr) => new Date(`${dateStr}T00:00:00.000Z`)),
    };
  }

  async function queryEntityRecords(collectionName, entityType, segments, baseFilter, extraFilter = {}) {
    if (!segments.length) return [];
    const { dateStrs, dateObjs } = dateFilterForSegments(segments);
    const filter = {
      ...baseFilter,
      ...extraFilter,
      entityType,
    };
    if (collectionName === totalsShiftCollectionName) {
      filter.date = { $in: dateStrs };
    } else {
      filter.$or = [{ date: { $in: dateStrs } }, { dateObj: { $in: dateObjs } }];
    }

    return db.collection(collectionName).find(filter).toArray();
  }

  function buildHourlyMachineItemRecordsFromCounts(counts) {
    const bucketMap = new Map();
    for (const count of counts) {
      const timestamp = count.timestamps?.create;
      if (!timestamp || count.misfeed) continue;
      const dt = DateTime.fromJSDate(new Date(timestamp), { zone: SYSTEM_TIMEZONE });
      if (!dt.isValid) continue;
      const hour = dt.hour;
      const itemName = count.item?.name || "Unknown";
      const key = `${hour}|${itemName}`;
      const existing = bucketMap.get(key) || {
        hour,
        itemName,
        totalCounts: 0,
      };
      existing.totalCounts += 1;
      bucketMap.set(key, existing);
    }
    return [...bucketMap.values()];
  }

  async function queryMachineCounts(serial, segments) {
    const counts = [];
    for (const segment of segments) {
      const rows = await db
        .collection("count")
        .find({
          "machine.id": serial,
          "timestamps.create": { $gte: segment.start, $lte: segment.end },
        })
        .project({
          _id: 0,
          machine: 1,
          item: 1,
          operator: 1,
          misfeed: 1,
          timestamps: 1,
        })
        .toArray();
      counts.push(...rows);
    }
    return counts;
  }

  async function buildSessionOperatorEfficiencyRecords(serial, segments) {
    const bucketMap = new Map();
    for (const segment of segments) {
      const sessions = await db
        .collection(config.operatorSessionCollectionName)
        .find({
          "machine.serial": Number(serial),
          "timestamps.start": { $lt: segment.end },
          $or: [
            { "timestamps.end": { $gt: segment.start } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null },
          ],
        })
        .project({
          _id: 0,
          operator: 1,
          timestamps: 1,
          workTime: 1,
          totalTimeCredit: 1,
        })
        .toArray();

      for (const session of sessions) {
        const operatorId = Number(session.operator?.id);
        if (!Number.isFinite(operatorId) || operatorId === -1) continue;

        const sessionStart = new Date(session.timestamps?.start);
        const sessionEnd = session.timestamps?.end
          ? new Date(session.timestamps.end)
          : segment.end;
        const clampedStart = sessionStart > segment.start ? sessionStart : segment.start;
        const clampedEnd = sessionEnd < segment.end ? sessionEnd : segment.end;
        const overlapMs = Math.max(0, clampedEnd - clampedStart);
        const fullMs = Math.max(0, sessionEnd - sessionStart);
        if (!overlapMs || !fullMs) continue;

        const factor = overlapMs / fullMs;
        const hour = DateTime.fromJSDate(clampedStart, {
          zone: SYSTEM_TIMEZONE,
        }).hour;
        const key = `${hour}|${operatorId}`;
        const existing = bucketMap.get(key) || {
          hour,
          operatorId,
          operatorName: session.operator?.name || `Operator ${operatorId}`,
          workedTimeMs: 0,
          totalTimeCreditMs: 0,
        };
        existing.workedTimeMs += (Number(session.workTime) || 0) * 1000 * factor;
        existing.totalTimeCreditMs +=
          (Number(session.totalTimeCredit) || 0) * 1000 * factor;
        bucketMap.set(key, existing);
      }
    }
    return [...bucketMap.values()];
  }

  async function buildCurrentOperatorsFast(serial) {
    const serialNum = Number(serial);
    const ticker = await db.collection(config.stateTickerCollectionName).findOne(
      {
        $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }],
      },
      { projection: { _id: 0, operators: 1, machine: 1 } }
    );

    const operators = Array.isArray(ticker?.operators) ? ticker.operators : [];
    const opIds = [
      ...new Set(
        operators
          .map((operator) => Number(operator?.id))
          .filter((id) => Number.isFinite(id) && id !== -1)
      ),
    ];
    if (!opIds.length) return [];

    return opIds.map((id) => {
      const tickerOperator = operators.find(
        (operator) => Number(operator?.id) === id
      );
      const operatorName = formatName(tickerOperator?.name, `Operator ${id}`);

      return {
        operatorId: id,
        operatorName,
        machineSerial: ticker?.machine?.serial ?? ticker?.machine?.id ?? serialNum,
        machineName: ticker?.machine?.name || "Unknown",
        session: {
          start: null,
          end: null,
        },
        metrics: {
          workedTimeMs: 0,
          workedTimeFormatted: formatDuration(0),
          totalCount: 0,
          validCount: 0,
          misfeedCount: 0,
          efficiencyPct: 0,
        },
      };
    });
  }

  function buildOperatorItemSummaryRowsFromRecords(records, operatorName) {
    return records.map((record) => {
      const workedMs =
        Number(record.workedTimeMs) ||
        Number(record.totalTimeCreditMs) ||
        Number(record.runtimeMs) ||
        0;
      const count = Number(record.totalCounts || record.totalCount || 0);
      const standard = Number(record.itemStandard || 0);
      const hours = workedMs / 3600000;
      const pph = hours > 0 ? count / hours : 0;
      const efficiency = standard > 0 ? pph / standard : 0;
      return {
        operatorName,
        machineSerial: record.machineSerial ?? "Unknown",
        machineName: record.machineName ?? "Unknown",
        itemName: record.itemName || "Unknown",
        count,
        misfeed: Number(record.totalMisfeeds || record.misfeedCount || 0),
        standard,
        valid: count,
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
        workedTimeFormatted: formatDuration(workedMs),
      };
    });
  }

  async function buildOperatorCountsByItemFromSessions(operatorId, serial, segments) {
    const bucketMap = new Map();
    const itemNames = new Set();
    for (const segment of segments) {
      const filter = {
        "operator.id": operatorId,
        "timestamps.create": { $gte: segment.start, $lte: segment.end },
        misfeed: { $ne: true },
      };
      if (serial !== null) {
        filter.$or = [
          { "machine.serial": Number(serial) },
          { "machine.id": Number(serial) },
        ];
      }
      const counts = await db
        .collection("count")
        .find(filter)
        .project({ _id: 0, item: 1, timestamps: 1 })
        .toArray();

      for (const count of counts) {
        const timestamp = count.timestamps?.create;
        if (!timestamp) continue;
        const hour = DateTime.fromJSDate(new Date(timestamp), {
          zone: SYSTEM_TIMEZONE,
        }).hour;
        const itemName = count.item?.name || "Unknown";
        itemNames.add(itemName);
        const key = `${hour}|${itemName}`;
        bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
      }
    }

    const hours = [...new Set([...bucketMap.keys()].map((key) => Number(key.split("|")[0])))]
      .filter((hour) => Number.isFinite(hour))
      .sort((a, b) => a - b);
    const operators = {};
    for (const itemName of itemNames) {
      operators[itemName] = hours.map(
        (hour) => bucketMap.get(`${hour}|${itemName}`) || 0
      );
    }

    return {
      title: "Operator Counts by item",
      data: {
        hours,
        operators,
      },
    };
  }

  function buildOperatorCountsByItemFromRecords(records, requestStart) {
    const hour = DateTime.fromJSDate(requestStart, {
      zone: SYSTEM_TIMEZONE,
    }).hour;
    const operators = {};
    for (const record of records) {
      const itemName = record.itemName || "Unknown";
      operators[itemName] = [
        (operators[itemName]?.[0] || 0) +
          Number(record.totalCounts || record.totalCount || 0),
      ];
    }

    return {
      title: "Operator Counts by item",
      data: {
        hours: Object.keys(operators).length ? [hour] : [],
        operators,
      },
    };
  }

  async function buildOperatorDetails(req, res) {
    const operatorId = parseOperatorId(req.query.operatorid);
    if (Number.isNaN(operatorId)) {
      return badRequest(res, "operatorid must be numeric");
    }

    const serial = parseSerial(req.query.serial);
    if (Number.isNaN(serial)) {
      return badRequest(res, "serial must be numeric");
    }

    const resolved = await resolveDetailsTimeframe(req, "operator-detail");
    if (resolved.error) {
      return res.status(resolved.error.status).json({ error: resolved.error.message });
    }
    if (!resolved.allSegments.length) return res.json([]);

    const operatorMap = await loadActiveOperatorIds(operatorId);
    const requestedOperatorIds =
      operatorId !== null ? [operatorId] : [...operatorMap.keys()];
    const aggregateMap = new Map();
    const sessionOptions =
      serial !== null
        ? { ...resolved.sessionOptions, machineSerial: serial }
        : resolved.sessionOptions;

    for (const segment of resolved.cacheSegments) {
      const baseFilter =
        serial !== null
          ? { ...resolved.cacheBaseFilter, machineSerial: serial }
          : resolved.cacheBaseFilter;
      if (resolved.cacheCollectionName === totalsShiftCollectionName) {
        const filter = {
          ...baseFilter,
          entityType: "operator-machine",
          date: segment.dateStr,
        };
        if (requestedOperatorIds.length === 1) {
          filter.operatorId = requestedOperatorIds[0];
        } else if (requestedOperatorIds.length > 1) {
          filter.operatorId = { $in: requestedOperatorIds };
        }
        const records = await db
          .collection(resolved.cacheCollectionName)
          .find(filter)
          .toArray();
        for (const record of records) {
          addOperatorRecordToAggregate(aggregateMap, record, segment);
        }
      } else {
        await addOperatorCacheSegment(
          aggregateMap,
          segment,
          resolved.cacheCollectionName,
          baseFilter,
          requestedOperatorIds,
          sessionOptions
        );
      }
    }

    for (const segment of resolved.sessionSegments) {
      await addOperatorSessionFallback(
        aggregateMap,
        segment,
        requestedOperatorIds,
        sessionOptions
      );
    }

    const aggregates = [...aggregateMap.values()].filter((aggregate) => {
      if (operatorId !== null) {
        return aggregate.operatorId === operatorId && aggregate.hasData;
      }
      return requestedOperatorIds.includes(aggregate.operatorId) && aggregate.hasData;
    });

    if (!aggregates.length) return res.json([]);

    const requestStart = resolved.allSegments[0].start;
    const requestEnd = resolved.allSegments[resolved.allSegments.length - 1].end;
    const startIso = requestStart.toISOString();
    const endIso = requestEnd.toISOString();

    const results = await Promise.all(
      aggregates.map(async (aggregate) => {
        const id = aggregate.operatorId;
        const operatorName =
          operatorMap.get(id)?.name || aggregate.operatorName || `Operator ${id}`;
        if (resolved.cacheCollectionName === totalsShiftCollectionName) {
          const shiftItemRecords = await queryEntityRecords(
            resolved.cacheCollectionName,
            "operator-item",
            resolved.cacheSegments,
            resolved.cacheBaseFilter,
            {
              operatorId: id,
              ...(serial !== null ? { machineSerial: serial } : {}),
            }
          );
          const runtimeMs = Math.round(aggregate.runtimeMs || 0);
          const windowMs = Math.max(0, requestEnd - requestStart);
          const pausedMs = Math.max(0, windowMs - runtimeMs);
          const total = runtimeMs + pausedMs || 1;
          const efficiency =
            aggregate.workedTimeMs > 0
              ? (aggregate.totalTimeCreditMs || 0) / aggregate.workedTimeMs
              : 0;

          return {
            operator: {
              id,
              name: operatorName,
            },
            itemSummary: buildOperatorItemSummaryRowsFromRecords(
              shiftItemRecords,
              operatorName
            ),
            countByItem: buildOperatorCountsByItemFromRecords(
              shiftItemRecords,
              requestStart
            ),
            cyclePie: [
              { name: "Running", value: Math.round((runtimeMs / total) * 100) },
              { name: "Paused", value: Math.round((pausedMs / total) * 100) },
              { name: "Faulted", value: 0 },
            ],
            dailyEfficiency: {
              operator: { id, name: operatorName },
              timeRange: {
                start: requestStart.toISOString(),
                end: requestEnd.toISOString(),
                totalDays: 1,
              },
              data: [
                {
                  date: DateTime.fromJSDate(requestStart, {
                    zone: SYSTEM_TIMEZONE,
                  }).toISODate(),
                  efficiency: Math.round(efficiency * 10000) / 100,
                },
              ],
            },
            timeRange: {
              start: requestStart,
              end: requestEnd,
            },
          };
        }

        const itemSummary = await buildItemSummaryFromCache(
          db,
          id,
          startIso,
          endIso,
          serial
        );
        const [countByItem, cyclePie, dailyEfficiency] = await Promise.all([
          buildItemHourlyStackFromCacheForOperator(db, logger, id, startIso, endIso, serial),
          buildOperatorCyclePieFromCache(db, logger, id, startIso, endIso, serial),
          buildDailyEfficiencyFromCache(
            db,
            logger,
            id,
            operatorName,
            startIso,
            endIso,
            serial,
            SYSTEM_TIMEZONE
          ),
        ]);

        if (dailyEfficiency?.operator) {
          dailyEfficiency.operator.name = operatorName;
        }

        const transformedItemSummary = itemSummary.sessions.flatMap((session) => {
          if (!Array.isArray(session.items) || !session.items.length) return [];
          const machineSerial = session.machine?.serial ?? serial ?? "Unknown";
          const machineName = session.machine?.name ?? "Unknown";
          return session.items.map((item) => ({
            operatorName,
            machineSerial,
            machineName,
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

        return {
          operator: {
            id,
            name: operatorName,
          },
          itemSummary: transformedItemSummary,
          countByItem,
          cyclePie,
          dailyEfficiency,
          timeRange: {
            start: requestStart,
            end: requestEnd,
          },
        };
      })
    );

    return res.json(results.sort((a, b) => a.operator.id - b.operator.id));
  }

  return {
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
  };
}

module.exports = { createVendorAnalytics };
