const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const config = require('../../modules/config');
const humanNamesSchema = require('../../schemas/human-names');
const timestampsSchema = require('../../schemas/timestampsSchema');
const { formatHumanName } = require('../../utils/humanNames');

const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");
const { getOperatorSessionDataForPartialDays } = require("../../utils/reportFunctions");
const {
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
} = require("../../utils/operatorDashboardCache");
const { resolveCurrentShiftContext } = require("../../utils/machineDashboardCache");
const {
  getOperatorsSummaryRealTime,
  buildItemSummaryFromCache,
  buildItemHourlyStackFromCacheForOperator,
  buildOperatorCyclePieFromCache,
  buildDailyEfficiencyFromCache,
  buildOperatorMachineSummaryFromCache,
  buildOperatorFaultHistoryFromSessions,
  buildOperatorTimelineFromSessions,
  mergeIntervals,
  overlapsAny,
  coalesceItems,
} = require("../../utils/operatorFunctions");

module.exports = function (server) { return constructor(server); };

function constructor(server) {
  const db = server.db;
  const collection = db.collection(config.operatorCollectionName);
  const xmlParser = server.xmlParser;
  const configService = require('../../services/mongo/');
  const logger = server.logger;

  // Ensure unique index once at startup
  collection.createIndex({ code: 1 }, { unique: true }).catch(() => {});

  function normalizeOperatorName(name) {
    try {
      return humanNamesSchema.utils.setName({}, name);
    } catch (error) {
      throw new Error(`Invalid name structure: ${error.message}`);
    }
  }

  function stampOperatorCreate(body) {
    const now = new Date();
    return {
      ...body,
      active: body.active ?? true,
      name: normalizeOperatorName(body.name),
      timestamps: timestampsSchema.utils.stampInit(now)
    };
  }

  function stampOperatorUpdate(existing, updates) {
    const now = new Date();
    let timestamps = existing.timestamps
      ? timestampsSchema.utils.stampUpdate(existing.timestamps, now)
      : timestampsSchema.utils.stampInit(now);

    if (updates.active === true && existing.active !== true) {
      timestamps = timestampsSchema.utils.stampActive(timestamps, now);
      delete timestamps.inactive;
    } else if (updates.active === false && existing.active !== false) {
      timestamps = timestampsSchema.utils.stampInactive(timestamps, now);
    }

    return timestamps;
  }

  // JWT verification middleware
  function verifyJwtMiddleware(req, res, next) {
    // Check if API token check is disabled via environment variable
    if (config.enableApiTokenCheck === false) {
      logger?.debug?.("API token check is disabled - bypassing authentication");
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      let token = null;
      
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      } else if (req.query?.token) {
        token = req.query.token;
      } else if (req.body?.token) {
        token = req.body.token;
      }
      
      if (!token) {
        return res.status(401).json({ valid: false, error: "Missing token" });
      }
      
      const secret = config.jwtSecret;
      if (!secret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }
      
      const decoded = jwt.verify(token, secret);
      req.tokenPayload = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ valid: false, error: "Invalid token" });
    }
  }

  async function getOperatorXML(req, res, next) {
    try {
      res.set('Content-Type', 'text/xml');
      const operators = await configService.getConfiguration(collection, {}, { code: 1, name: 1, _id: 0 });
      const ops = operators.map(operator => ({
        code: operator.code,
        name: formatHumanName(operator.name)
      }));
      res.send(await xmlParser.xmlArrayBuilder('operator', ops, false));
    } catch (e) { next(e); }
  }

  async function getOperator(req, res, next) {
    try { 
      // Check for filterTestOperators query parameter
      const filterTestOperators = req.query.filterTestOperators === 'true';
      
      // Build query object - filter out operators with code > 500000 if requested
      const query = filterTestOperators ? { code: { $lte: 500000 } } : {};
      
      res.json(await configService.getConfiguration(collection, query)); 
    }
    catch (e) { next(e); }
  }

  // Create
  async function createOperator(req, res, next) {
    try {
      const body = { ...req.body };
      if (body._id) delete body._id;           // new doc
      
      if (!body.name) throw new Error('Operator name is required');
      const normalizedBody = stampOperatorCreate(body);
      
      // unique by 'code'
      const out = await configService.upsertConfiguration(collection, normalizedBody, true, 'code');
      res.status(201).json(out);
    } catch (e) { 
      // Handle validation errors
      if (e.message && (e.message.includes('Operator name') || e.message.includes('Invalid name'))) {
        return res.status(400).json({ message: e.message });
      }
      next(e); 
    }
  }

  // Update by id (id-aware, preserves uniqueness on 'code' excluding self)
  async function upsertOperator(req, res, next) {
    try {
      const id = req.params.id || null;
      const updates = { ...req.body };
      if (updates._id) delete updates._id;

      const existing = id ? await collection.findOne({ _id: new ObjectId(id) }) : null;
      if (id && !existing) return res.status(404).json({ message: 'Operator not found' });
      if (updates.name) updates.name = normalizeOperatorName(updates.name);
      updates.timestamps = stampOperatorUpdate(existing || updates, updates);

      // Pass {_id:id,...updates} so configService can do:
      // findOne({ code: updates.code, _id: { $ne: id } }) → 409 if exists
      const out = await configService.upsertConfiguration(
        collection,
        id ? { _id: id, ...updates } : updates,
        true,
        'code'
      );
      res.json(out);
    } catch (e) { 
      // Handle validation errors
      if (e.message && (e.message.includes('Operator name') || e.message.includes('Invalid name'))) {
        return res.status(400).json({ message: e.message });
      }
      next(e); 
    }
  }

  async function deleteOperator(req, res, next) {
    try { res.json(await configService.deleteConfiguration(collection, req.params.id)); }
    catch (e) { next(e); }
  }

  // Get next available operator ID
  async function getNewOperatorId(req, res, next) {
    try {
      // Find the highest code value under 600000
      const result = await collection
        .find({ code: { $lt: 600000 } })
        .sort({ code: -1 })
        .limit(1)
        .toArray();
      
      // If no operators exist, start from 100000, otherwise add 1 to the highest
      const nextId = result.length > 0 ? result[0].code + 1 : 100000;
      
      res.json({ code: nextId });
    } catch (e) { next(e); }
  }

  // Routes
  router.get('/operator/config/xml', getOperatorXML);
  router.get('/operator/config', getOperator);
  router.get('/operator/new-id', getNewOperatorId);

  // Protected routes - require JWT token
  router.post('/operator/config', verifyJwtMiddleware, createOperator);
  router.put('/operator/config/:id', verifyJwtMiddleware, upsertOperator);
  router.delete('/operator/config/:id', verifyJwtMiddleware, deleteOperator);

  // Operator analytics routes are defined below in this controller

  const getOperatorsSummaryRealTimeHandler = getOperatorsSummaryRealTime(db, logger, config);
  const totalsShiftCollectionName = "totals-shift";

  async function resolveShift(req, res) {
    let shiftOid;
    try {
      shiftOid = new ObjectId(String(req.query.shiftId));
    } catch (e) {
      res.status(400).json({ error: "Invalid shiftId" });
      return null;
    }

    const shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
    if (!shiftDoc) {
      res.status(404).json({ error: "Shift not found" });
      return null;
    }

    return { shiftOid, shiftDoc };
  }

  function dateStrForShiftCache(start) {
    const parsed = DateTime.fromJSDate(new Date(start), { zone: SYSTEM_TIMEZONE });
    return parsed.isValid
      ? parsed.toISODate()
      : DateTime.now().setZone(SYSTEM_TIMEZONE).toISODate();
  }

  function normalizeOperatorId(id) {
    if (id === null || typeof id === "undefined" || id === -1) return null;
    const numeric = typeof id === "string" ? Number.parseInt(id, 10) : Number(id);
    return Number.isFinite(numeric) && numeric !== -1 ? numeric : null;
  }

  async function resolveIdleOperatorShift(req) {
    if (req.query.shiftId) {
      const resolvedShift = await resolveShift(req, {
        status: (code) => ({
          json: (payload) => {
            const error = new Error(payload?.error || "Invalid shiftId");
            error.statusCode = code;
            throw error;
          },
        }),
      });
      if (!resolvedShift) return null;

      const start = req.query.start ? new Date(String(req.query.start)) : null;
      const end = req.query.end ? new Date(String(req.query.end)) : null;
      return {
        shiftOid: resolvedShift.shiftOid,
        shiftDoc: resolvedShift.shiftDoc,
        start: start && !Number.isNaN(start.getTime()) ? start : new Date(),
        end: end && !Number.isNaN(end.getTime()) ? end : new Date(),
        mode: "selected",
      };
    }

    return resolveCurrentShiftContext(db, config);
  }

  async function buildIdleOperatorSummary(req) {
    const shiftContext = await resolveIdleOperatorShift(req);
    if (!shiftContext) {
      return {
        idleOperators: 0,
        shiftOperators: 0,
        activeOperators: 0,
        idleOperatorIds: [],
        updatedAt: new Date().toISOString(),
      };
    }

    const start = new Date(shiftContext.start);
    const end = new Date(shiftContext.end);
    const shiftId = shiftContext.shiftOid ? String(shiftContext.shiftOid) : null;
    const sessionFilter = {
      "operator.id": { $exists: true, $ne: -1 },
      "timestamps.start": { $lt: end },
      $or: [
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": null },
        { "timestamps.end": { $gt: start } },
      ],
    };

    const [operatorSessions, stateTickerData] = await Promise.all([
      db
        .collection(config.operatorSessionCollectionName)
        .find(sessionFilter)
        .project({ _id: 0, operator: 1 })
        .toArray(),
      db
        .collection(config.stateTickerCollectionName)
        .find({})
        .project({ _id: 0, operators: 1 })
        .toArray(),
    ]);

    const shiftOperatorIds = new Set();
    for (const session of operatorSessions) {
      const operatorId = normalizeOperatorId(session.operator?.id);
      if (operatorId !== null) shiftOperatorIds.add(operatorId);
    }

    const activeOperatorIds = new Set();
    for (const ticker of stateTickerData) {
      if (!Array.isArray(ticker.operators)) continue;
      for (const operator of ticker.operators) {
        const operatorId = normalizeOperatorId(operator?.id);
        if (operatorId !== null) activeOperatorIds.add(operatorId);
      }
    }

    const idleOperatorIds = [...shiftOperatorIds].filter((operatorId) => !activeOperatorIds.has(operatorId));

    return {
      idleOperators: idleOperatorIds.length,
      shiftOperators: shiftOperatorIds.size,
      activeOperators: activeOperatorIds.size,
      idleOperatorIds,
      shiftId,
      shiftMode: shiftContext.mode,
      start,
      end,
      updatedAt: new Date().toISOString(),
    };
  }

  async function buildOperatorTickerMap() {
    const stateTickerData = await db.collection(config.stateTickerCollectionName).find({}).toArray();
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

    return operatorTickerMap;
  }

  async function buildOperatorSummaryRows(records, activeShifts, requestStart, requestEnd) {
    const operatorTickerMap = await buildOperatorTickerMap();
    const operatorMap = new Map();

    for (const record of records) {
      const opId = record.operatorId;
      if (!opId || opId === -1) continue;

      if (!operatorMap.has(opId)) {
        const operatorNameStr = formatHumanName(record.operatorName);

        operatorMap.set(opId, {
          operator: { id: opId, name: operatorNameStr },
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
          timeRange: record.buildRange || record.timeRange || { start: requestStart, end: requestEnd },
          machines: [],
          efficiencyData: [],
          workedTimeMs: 0,
        });
      }

      const operatorData = operatorMap.get(opId);
      operatorData.machines.push({
        serial: record.machineSerial,
        name: record.machineName,
      });

      const tickerContext = operatorTickerMap.get(opId);
      operatorData.currentMachine = tickerContext?.machine || null;
      operatorData.currentStatus = tickerContext?.status || null;
      operatorData.metrics.runtime.total += record.runtimeMs || 0;
      operatorData.metrics.output.totalCount += record.totalCounts || 0;
      operatorData.metrics.output.misfeedCount += record.totalMisfeeds || 0;

      const workTimeMs = record.workedTimeMs || 0;
      operatorData.workedTimeMs += workTimeMs;
      const efficiency = workTimeMs > 0 ? (record.totalTimeCreditMs || 0) / workTimeMs : 0;
      operatorData.efficiencyData.push({
        efficiency,
        weight: workTimeMs,
      });
    }

    const results = Array.from(operatorMap.values()).map((operatorData) => {
      const { runtime, downtime, output } = operatorData.metrics;
      let rangeStart = new Date(requestStart);
      let rangeEnd = new Date(requestEnd);

      if (operatorData.timeRange?.start && operatorData.timeRange?.end) {
        const startDate = new Date(operatorData.timeRange.start);
        const endDate = new Date(operatorData.timeRange.end);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate > startDate) {
          rangeStart = startDate;
          rangeEnd = endDate;
        }
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
      const workedHours = operatorData.workedTimeMs / 3600000;
      const piecesPerHour = workedHours > 0 ? output.totalCount / workedHours : 0;

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
        piecesPerHour: {
          value: piecesPerHour,
          formatted: Math.round(piecesPerHour).toString(),
        },
        pph: piecesPerHour,
        oee: {
          value: oee,
          percentage: (oee * 100).toFixed(2),
        },
      };
      operatorData.timeRange = { start: rangeStart, end: rangeEnd };

      delete operatorData.machines;
      delete operatorData.efficiencyData;
      delete operatorData.workedTimeMs;
      return operatorData;
    });

    const MIN_RUNTIME_TO_SHOW_MS = 3600000;
    return results.filter((operatorData) => {
      const hasRuntime = operatorData.metrics.runtime.total > 0;
      const hasProduction = operatorData.metrics.output.totalCount > 0;
      const hasCurrentMachine = operatorData.currentMachine !== null;
      const hasSignificantRuntime = operatorData.metrics.runtime.total >= MIN_RUNTIME_TO_SHOW_MS;
      return hasRuntime && hasProduction && (hasCurrentMachine || hasSignificantRuntime);
    });
  }

  async function buildOperatorSummaryFromSessions(start, end, operatorId, shiftOid, shiftDoc) {
    const sessionData = await getOperatorSessionDataForPartialDays(
      db,
      [{ start, end }],
      operatorId || undefined,
      { shiftId: String(shiftOid) }
    );

    const records = (sessionData.operators || []).map((record) => ({
      operatorId: record.operatorId,
      operatorName: record.operatorName,
      machineSerial: null,
      machineName: null,
      runtimeMs: record.runtimeMs || 0,
      workedTimeMs: record.workedTimeMs || 0,
      totalCounts: record.totalCounts || 0,
      totalMisfeeds: record.totalMisfeeds || 0,
      totalTimeCreditMs: record.totalTimeCreditMs || record.workedTimeMs || 0,
      timeRange: { start, end },
    }));

    return buildOperatorSummaryRows(records, [shiftDoc], start, end);
  }

  // GET /api/operator/analytics/operators-summary-daily-cached
  // Returns daily operator summary from totals-daily cache; falls back to real-time if no cache.
  router.get("/operator/analytics/operators-summary-daily-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;

      if (req.query.shiftId) {
        const resolvedShift = await resolveShift(req, res);
        if (!resolvedShift) return;

        const { shiftOid, shiftDoc } = resolvedShift;
        const result = await buildOperatorSummaryFromShiftCache(
          db,
          logger,
          config,
          { shiftOid, shiftDoc, start, end, operatorId }
        );

        if (result.found) {
          logger.info(
            `[operatorSessions] Retrieved ${result.recordCount} shift cached operator records for shift ${shiftOid} on ${result.dateStr}`
          );
        } else {
          logger.warn(
            `[operatorSessions] No shift cached operator data found for shift ${shiftOid} on ${result.dateStr}, falling back to sessions`
          );
          return res.json(
            await buildOperatorSummaryFromSessions(start, end, operatorId, shiftOid, shiftDoc)
          );
        }

        return res.json(result.data);
      }

      const result = await buildOperatorSummaryFromDailyCache(db, logger, config, {
        start,
        end,
        operatorId,
      });

      logger.info(`[operatorSessions] Fetching daily cached operators summary for date: ${result.dateStr}, operatorId: ${operatorId || "all"}`);

      if (!result.found) {
        logger.warn(`[operatorSessions] No daily cached data found for date: ${result.dateStr}, falling back to real-time calculation`);
        return await getOperatorsSummaryRealTimeHandler(req, res);
      }

      logger.info(
        `[operatorSessions] Retrieved ${result.recordCount} daily cached operator records (${result.data.length} after filtering phantoms) for date: ${result.dateStr}`
      );
      res.json(result.data);
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

  router.get("/operator/analytics/idle-operators", async (req, res) => {
    try {
      res.json(await buildIdleOperatorSummary(req));
    } catch (err) {
      logger.error("[operatorSessions] Error in idle-operators route:", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to build idle operator summary" });
    }
  });

  // GET /api/operator/analytics/operator-details-cached
  // Returns operator details built entirely from cache (totals-daily + hourly-totals).
  router.get("/operator/analytics/operator-details-cached", async (req, res) => {
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

      const nameDocPromise = db.collection(config.totalsDailyCollectionName)
        .find({
          entityType: "operator-machine",
          operatorId: opId,
          ...(serial ? { machineSerial: Number(serial) } : {}),
        })
        .project({ _id: 0, operatorName: 1, machineName: 1 })
        .sort({ dateObj: -1 })
        .limit(1)
        .next();

      const [nameDoc, itemSummary, countByItem, cyclePie, dailyEfficiency, operatorTimeline, machineSummary, faultHistory] = await Promise.all([
        nameDocPromise,
        buildItemSummaryFromCache(db, opId, start, end, serial),
        buildItemHourlyStackFromCacheForOperator(db, logger, opId, start, end, serial),
        buildOperatorCyclePieFromCache(db, logger, opId, start, end, serial),
        buildDailyEfficiencyFromCache(db, logger, opId, `Operator ${opId}`, start, end, serial, tzParam),
        buildOperatorTimelineFromSessions(db, config, opId, start, end),
        buildOperatorMachineSummaryFromCache(db, opId, start, end, serial),
        buildOperatorFaultHistoryFromSessions(db, opId, start, end, serial),
      ]);

      const rawName = nameDoc?.operatorName;
      const operatorName = formatHumanName(rawName, `Operator ${opId}`);
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
          misfeed: item.misfeedTotal || 0,
          standard: item.standard || 0,
          valid: Math.max(0, (item.countTotal || 0) - (item.misfeedTotal || 0)),
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
        operatorTimeline,
        machineSummary,
        faultHistory,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator details from cache" });
    }
  });

  // GET /api/operator/analytics/operator-machine-summary
  // Aggregates operator sessions by machine with totals, items, and fault overlap count.
  router.get("/operator/analytics/operator-machine-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = Number(req.query.operatorId);
      if (!operatorId || Number.isNaN(operatorId)) {
        return res.status(400).json({ error: "operatorId required and must be a number" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      const summary = await buildOperatorMachineSummaryFromCache(db, operatorId, startDate, endDate);
      return res.json(summary);

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
        .collection(config.machineSessionCollectionName)
        .aggregate([
          {
            $match: {
              "operators.id": operatorId,
              type: { $nin: [0, 1] },
              "timestamps.start": { $lte: endDate },
              $or: [
                { "timestamps.end": { $exists: false } },
                { "timestamps.end": { $gte: startDate } },
              ],
            },
          },
          {
            $project: {
              serial: { $ifNull: ["$machine.serial", "$machine.id"] },
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
}
