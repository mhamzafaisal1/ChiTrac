const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const {
  TOTALS_SHIFT_COLLECTION,
  getTodayRange,
  resolveCurrentShiftContext,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../utils/machineDashboardCache");
const { getCachedOperatorResults } = require("../utils/dashboardFunctions");
const { getOperatorSessionDataForPartialDays } = require("../utils/reportFunctions");
const { formatDuration, SYSTEM_TIMEZONE } = require("../utils/time");

const WATCH_REFRESH_INTERVAL_MS = 60_000;
const REBUILD_DEBOUNCE_MS = 250;
const DASHBOARD_ENTITY_TYPES = { $in: ["machine", "operator-machine"] };

function ensureCache(server) {
  if (!server.cache) server.cache = {};
  if (!server.cache.today) server.cache.today = {};
  if (!server.cache.currentShift) server.cache.currentShift = {};
  if (!server.cache.dashboard) server.cache.dashboard = {};
  if (!server.cache.dashboard.machines) server.cache.dashboard.machines = {};
  if (!server.cache.dashboard.operators) server.cache.dashboard.operators = {};
  if (!Array.isArray(server.cache.dashboard.machines.shifts)) server.cache.dashboard.machines.shifts = [];
  if (!Array.isArray(server.cache.dashboard.operators.shifts)) server.cache.dashboard.operators.shifts = [];
  if (!server.cache.watchers) server.cache.watchers = {};
}

function serializableShift(shiftDoc) {
  if (!shiftDoc) return null;
  return {
    _id: String(shiftDoc._id),
    id: shiftDoc.id,
    name: shiftDoc.name,
    active: shiftDoc.active,
    activeDays: shiftDoc.activeDays,
    startTime: shiftDoc.startTime,
    endTime: shiftDoc.endTime,
  };
}

function cacheEnvelope({ machinesSummary, operatorsSummary }, meta) {
  return {
    machinesSummary: Array.isArray(machinesSummary) ? machinesSummary : [],
    operatorsSummary: Array.isArray(operatorsSummary) ? operatorsSummary : [],
    updatedAt: new Date(),
    meta,
  };
}

function machineDashboardEnvelope(machinesSummary, meta) {
  return {
    machinesSummary: Array.isArray(machinesSummary) ? machinesSummary : [],
    updatedAt: new Date(),
    meta,
  };
}

function operatorDashboardEnvelope(operatorsSummary, meta) {
  return {
    operatorsSummary: Array.isArray(operatorsSummary) ? operatorsSummary : [],
    updatedAt: new Date(),
    meta,
  };
}

function upsertShift(envelopes, shiftEnvelope) {
  const next = Array.isArray(envelopes) ? [...envelopes] : [];
  const index = next.findIndex((item) => item?.meta?.key === shiftEnvelope?.meta?.key);

  if (index === -1) {
    next.push(shiftEnvelope);
  } else {
    next[index] = shiftEnvelope;
  }

  return next.sort((a, b) => new Date(a?.meta?.start || 0) - new Date(b?.meta?.start || 0));
}

function broadcastCacheUpdate(server, scope) {
  if (typeof server.broadcastWebsocket !== "function") return;

  server.broadcastWebsocket({
    type: "dashboard-cache-update",
    timestamp: new Date().toISOString(),
    scope,
    cache: server.cache?.[scope] || {},
    dashboard: server.cache?.dashboard || {},
  });
}

function broadcastDashboardCacheUpdate(server) {
  if (typeof server.broadcastWebsocket !== "function") return;

  server.broadcastWebsocket({
    type: "dashboard-cache-update",
    timestamp: new Date().toISOString(),
    scope: "dashboard",
    dashboard: server.cache?.dashboard || {},
  });
}

async function safeBuildOperatorSummary(logger, label, builder) {
  try {
    return await builder();
  } catch (error) {
    if (logger) logger.error(`[mongoWatchers] Failed to build ${label} operator summary: ${error.message}`);
    return [];
  }
}

async function buildTodayOperatorSummary(db, range) {
  return getCachedOperatorResults(db, [
    {
      dateStr: range.dateStr,
      start: range.start,
      end: range.end,
    },
  ]);
}

async function buildOperatorTickerMap(db, config) {
  const stateTickerData = await db
    .collection(config.stateTickerCollectionName)
    .find({})
    .project({ timestamp: 1, timestamps: 1, machine: 1, status: 1, operators: 1 })
    .toArray();
  const operatorTickerMap = new Map();

  for (const stateRecord of stateTickerData) {
    const machine = stateRecord.machine || {};
    const status = stateRecord.status || {};
    const timestamp = new Date(
      status.timestamp ||
        stateRecord.timestamp ||
        (stateRecord.timestamps && (stateRecord.timestamps.update || stateRecord.timestamps.active || stateRecord.timestamps.create)) ||
        0
    ).getTime();

    if (!Array.isArray(stateRecord.operators)) continue;

    for (const op of stateRecord.operators) {
      if (op == null || op.id == null) continue;
      const operatorKey = typeof op.id === "string" ? parseInt(op.id, 10) : op.id;
      if (Number.isNaN(operatorKey)) continue;

      const existing = operatorTickerMap.get(operatorKey);
      if (existing && existing.timestamp >= timestamp) continue;

      const serial = machine.serial ?? machine.id ?? machine.serialNumber ?? null;
      const statusCode = status.id ?? status.code ?? null;
      operatorTickerMap.set(operatorKey, {
        machine: serial != null ? { serial, name: machine.name || null } : null,
        status:
          statusCode !== null || status.name !== undefined
            ? { code: statusCode, name: status.name ?? null }
            : null,
        timestamp,
      });
    }
  }

  return operatorTickerMap;
}

function mapShiftOperatorSessionSummary(sessionData, operatorTickerMap) {
  return (sessionData.operators || []).map((bucket) => ({
    operator: {
      id: bucket.operatorId,
      name: { first: bucket.operatorName, surname: "" },
    },
    currentStatus: operatorTickerMap.get(bucket.operatorId)?.status || { code: 0, name: "Unknown" },
    currentMachine: operatorTickerMap.get(bucket.operatorId)?.machine || null,
    metrics: {
      runtime: {
        total: bucket.runtimeMs,
        formatted: formatDuration(bucket.runtimeMs || 0),
      },
      performance: {
        efficiency: { value: 0, percentage: "0.00" },
      },
    },
    countByItem: {},
  }));
}

async function buildCurrentShiftOperatorSummary(db, config, context) {
  const sessionData = await getOperatorSessionDataForPartialDays(
    db,
    [{ start: context.start, end: context.end }],
    undefined,
    { shiftId: String(context.shiftOid) }
  );
  const operatorTickerMap = await buildOperatorTickerMap(db, config);

  return mapShiftOperatorSessionSummary(sessionData, operatorTickerMap);
}

function isValidShift(shift) {
  return (
    shift &&
    shift._id &&
    shift.startTime &&
    shift.endTime &&
    typeof shift.startTime.hour === "number" &&
    typeof shift.startTime.minute === "number" &&
    typeof shift.endTime.hour === "number" &&
    typeof shift.endTime.minute === "number"
  );
}

function toShiftDateTime(day, time) {
  return day.set({
    hour: Number(time.hour),
    minute: Number(time.minute),
    second: 0,
    millisecond: 0,
  });
}

async function resolveTodayShiftContexts(db, config, nowInput = new Date()) {
  const now = DateTime.fromJSDate(new Date(nowInput), { zone: SYSTEM_TIMEZONE });
  if (!now.isValid) return [];

  const shifts = await db
    .collection(config.shiftCollectionName)
    .find({ active: { $ne: false } })
    .toArray();

  const today = now.weekday;
  const day = now.startOf("day");

  return shifts
    .filter(isValidShift)
    .filter((shift) => {
      const activeDays = Array.isArray(shift.activeDays) ? shift.activeDays : [];
      return activeDays.length === 0 || activeDays.includes(today);
    })
    .map((shift) => {
      const start = toShiftDateTime(day, shift.startTime);
      const end = toShiftDateTime(day, shift.endTime);
      if (now < start) return null;

      const isCurrent = now >= start && now < end;
      const effectiveEnd = isCurrent ? now : end;

      return {
        shiftDoc: shift,
        shiftOid: new ObjectId(String(shift._id)),
        dateStr: now.toISODate(),
        start: start.toJSDate(),
        end: effectiveEnd.toJSDate(),
        mode: isCurrent ? "current" : "complete",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function shiftMeta(context, result, sourceOverride) {
  return {
    key: `${context.dateStr}|${String(context.shiftOid)}`,
    date: context.dateStr,
    shiftId: String(context.shiftOid),
    shift: serializableShift(context.shiftDoc),
    mode: context.mode,
    source: sourceOverride || result?.source || "none",
    found: Boolean(result?.found),
    recordCount: result?.recordCount || 0,
    start: context.start,
    end: context.end,
  };
}

async function buildShiftDashboardEnvelopes(server, context) {
  const { db, logger, config } = server;
  const result = await buildMachineSummaryFromShiftCache(db, logger, config, context);
  const operatorsSummary = await safeBuildOperatorSummary(
    logger,
    `shift ${context.shiftOid}`,
    () => buildCurrentShiftOperatorSummary(db, config, context)
  );
  const meta = shiftMeta(context, result);

  return {
    machines: machineDashboardEnvelope(result.data, meta),
    operators: operatorDashboardEnvelope(operatorsSummary, meta),
    result,
  };
}

function debounce(fn, waitMs) {
  let timer = null;
  return function debounced() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn().catch(() => {});
    }, waitMs);
  };
}

async function closeWatcher(watcher, logger, name) {
  if (!watcher) return;
  try {
    await watcher.close();
  } catch (error) {
    if (logger) logger.warn(`[mongoWatchers] Failed to close ${name} watcher: ${error.message}`);
  }
}

async function refreshTodayCache(server) {
  const { db, logger, config } = server;
  const result = await buildMachineSummaryFromDailyCache(db, logger, config);
  const operatorsSummary = await safeBuildOperatorSummary(
    logger,
    "today",
    () => buildTodayOperatorSummary(db, result)
  );
  server.cache.today = cacheEnvelope({
    machinesSummary: result.data,
    operatorsSummary,
  }, {
    key: result.dateStr,
    date: result.dateStr,
    source: result.found ? result.source : "none",
    found: result.found,
    recordCount: result.recordCount,
    start: result.start,
    end: result.end,
  });
  server.cache.dashboard.machines.today = machineDashboardEnvelope(result.data, server.cache.today.meta);
  server.cache.dashboard.operators.today = operatorDashboardEnvelope(operatorsSummary, server.cache.today.meta);
  broadcastCacheUpdate(server, "today");

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.today with ${result.data.length} machine rows and ${operatorsSummary.length} operator rows for ${result.dateStr}`
    );
  }

  return result;
}

async function refreshCurrentShiftCache(server) {
  const { db, logger, config } = server;
  const context = await resolveCurrentShiftContext(db, config);

  if (!context) {
    server.cache.currentShift = cacheEnvelope({
      machinesSummary: [],
      operatorsSummary: [],
    }, {
      key: null,
      source: "none",
      found: false,
      shift: null,
      mode: "none",
      recordCount: 0,
    });
    server.cache.dashboard.machines.shifts = [];
    server.cache.dashboard.operators.shifts = [];
    broadcastCacheUpdate(server, "currentShift");
    if (logger) {
      logger.info("[mongoWatchers] No current or previous shift found for server.cache.currentShift");
    }
    return null;
  }

  let result;
  try {
    result = await buildMachineSummaryFromShiftCache(db, logger, config, context);
  } catch (error) {
    server.cache.currentShift = cacheEnvelope({
      machinesSummary: [],
      operatorsSummary: [],
    }, {
      key: `${context.dateStr}|${String(context.shiftOid)}`,
      date: context.dateStr,
      shiftId: String(context.shiftOid),
      shift: serializableShift(context.shiftDoc),
      mode: context.mode,
      source: "error",
      found: false,
      recordCount: 0,
      start: context.start,
      end: context.end,
      error: error.message,
    });
    broadcastCacheUpdate(server, "currentShift");
    if (logger) {
      logger.error(`[mongoWatchers] Failed to update server.cache.currentShift: ${error.message}`);
    }
    return context;
  }

  const operatorsSummary = await safeBuildOperatorSummary(
    logger,
    "currentShift",
    () => buildCurrentShiftOperatorSummary(db, config, context)
  );
  server.cache.currentShift = cacheEnvelope({
    machinesSummary: result.data,
    operatorsSummary,
  }, {
    key: `${context.dateStr}|${String(context.shiftOid)}`,
    date: context.dateStr,
    shiftId: String(context.shiftOid),
    shift: serializableShift(context.shiftDoc),
    mode: context.mode,
    source: result.source,
    found: result.found,
    recordCount: result.recordCount,
    start: context.start,
    end: context.end,
  });
  const machineShiftEnvelope = machineDashboardEnvelope(result.data, server.cache.currentShift.meta);
  const operatorShiftEnvelope = operatorDashboardEnvelope(operatorsSummary, server.cache.currentShift.meta);
  server.cache.dashboard.machines.shifts = upsertShift(
    server.cache.dashboard.machines.shifts,
    machineShiftEnvelope
  );
  server.cache.dashboard.operators.shifts = upsertShift(
    server.cache.dashboard.operators.shifts,
    operatorShiftEnvelope
  );
  broadcastCacheUpdate(server, "currentShift");

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.currentShift with ${result.data.length} machine rows and ${operatorsSummary.length} operator rows for shift ${context.shiftOid}`
    );
  }

  return context;
}

async function refreshTodayShiftCaches(server) {
  const { logger } = server;
  const contexts = await resolveTodayShiftContexts(server.db, server.config);
  const machineShifts = [];
  const operatorShifts = [];

  for (const context of contexts) {
    try {
      const envelopes = await buildShiftDashboardEnvelopes(server, context);
      machineShifts.push(envelopes.machines);
      operatorShifts.push(envelopes.operators);
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to update dashboard shift cache for ${context.shiftOid}: ${error.message}`);
      }
    }
  }

  server.cache.dashboard.machines.shifts = machineShifts;
  server.cache.dashboard.operators.shifts = operatorShifts;
  broadcastDashboardCacheUpdate(server);

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated dashboard shift caches with ${machineShifts.length} machine shift entries and ${operatorShifts.length} operator shift entries`
    );
  }

  return contexts;
}

function createWatchPipeline(filter) {
  return [
    {
      $match: {
        operationType: { $in: ["insert", "update", "replace"] },
        ...Object.fromEntries(
          Object.entries(filter).map(([key, value]) => [`fullDocument.${key}`, value])
        ),
      },
    },
  ];
}

function watchCollection(server, collectionName, filter, onChange, name) {
  const { db, logger } = server;
  const collection = db.collection(collectionName);
  const pipeline = createWatchPipeline(filter);
  const stream = collection.watch(pipeline, { fullDocument: "updateLookup" });

  stream.on("change", onChange);
  stream.on("error", (error) => {
    const changeStreamUnsupported =
      error.message && error.message.includes("only supported on replica sets");
    if (logger && changeStreamUnsupported) {
      if (server.cache?.watchers) {
        server.cache.watchers.changeStreamsUnsupported = true;
      }
      logger.warn(
        `[mongoWatchers] ${name} watcher disabled: MongoDB change streams require a replica set; falling back to periodic cache refresh`
      );
      return;
    }
    if (logger) logger.error(`[mongoWatchers] ${name} watcher error: ${error.message}`);
  });
  stream.on("close", () => {
    if (logger) logger.info(`[mongoWatchers] ${name} watcher closed`);
  });

  if (logger) {
    logger.info(`[mongoWatchers] Started ${name} watcher on ${collectionName}`, filter);
  }

  return stream;
}

async function resetTodayWatcher(server) {
  const { logger, config } = server;
  const range = getTodayRange();
  await closeWatcher(server.cache.watchers.today, logger, "today");

  const rebuild = debounce(() => refreshTodayCache(server), REBUILD_DEBOUNCE_MS);
  server.cache.watchers.todayKey = range.dateStr;
  server.cache.watchers.today = watchCollection(
    server,
    config.totalsDailyCollectionName,
    { entityType: DASHBOARD_ENTITY_TYPES, date: range.dateStr },
    rebuild,
    "today"
  );
}

async function resetCurrentShiftWatcher(server) {
  const { logger } = server;
  const context = await resolveCurrentShiftContext(server.db, server.config);
  await closeWatcher(server.cache.watchers.currentShift, logger, "currentShift");

  if (!context) {
    server.cache.watchers.currentShift = null;
    server.cache.watchers.currentShiftKey = null;
    return;
  }

  const rebuild = debounce(() => refreshCurrentShiftCache(server), REBUILD_DEBOUNCE_MS);
  const key = `${context.dateStr}|${String(context.shiftOid)}`;
  server.cache.watchers.currentShiftKey = key;
  server.cache.watchers.currentShift = watchCollection(
    server,
    TOTALS_SHIFT_COLLECTION,
    {
      entityType: DASHBOARD_ENTITY_TYPES,
      date: context.dateStr,
      shiftId: String(context.shiftOid),
    },
    rebuild,
    "currentShift"
  );
}

async function refreshWatcherTargets(server) {
  if (server.cache.watchers.changeStreamsUnsupported) {
    await refreshTodayCache(server);
    await refreshCurrentShiftCache(server);
  }

  const todayKey = getTodayRange().dateStr;
  if (server.cache.watchers.todayKey !== todayKey) {
    await refreshTodayCache(server);
    await refreshTodayShiftCaches(server);
    await resetTodayWatcher(server);
  }

  const context = await resolveCurrentShiftContext(server.db, server.config);
  const nextShiftKey = context ? `${context.dateStr}|${String(context.shiftOid)}` : null;
  if (server.cache.watchers.currentShiftKey !== nextShiftKey) {
    await refreshCurrentShiftCache(server);
    await refreshTodayShiftCaches(server);
    await resetCurrentShiftWatcher(server);
  }
}

async function startMongoWatchers(server) {
  ensureCache(server);
  const { logger } = server;

  await refreshTodayCache(server);
  refreshCurrentShiftCache(server).catch((error) => {
    if (logger) logger.error(`[mongoWatchers] Failed to warm current shift cache: ${error.message}`);
  });
  refreshTodayShiftCaches(server).catch((error) => {
    if (logger) logger.error(`[mongoWatchers] Failed to warm dashboard shift caches: ${error.message}`);
  });

  try {
    await resetTodayWatcher(server);
    await resetCurrentShiftWatcher(server);
  } catch (error) {
    if (logger) {
      logger.warn(
        `[mongoWatchers] MongoDB change streams unavailable; server.cache will not receive live watcher updates: ${error.message}`
      );
    }
    return server.cache;
  }

  server.cache.watchers.refreshInterval = setInterval(() => {
    refreshWatcherTargets(server).catch((error) => {
      if (logger) logger.error(`[mongoWatchers] Failed to refresh watcher targets: ${error.message}`);
    });
  }, WATCH_REFRESH_INTERVAL_MS);

  if (typeof server.cache.watchers.refreshInterval.unref === "function") {
    server.cache.watchers.refreshInterval.unref();
  }

  return server.cache;
}

async function stopMongoWatchers(server) {
  if (!server?.cache?.watchers) return;
  const { logger } = server;
  if (server.cache.watchers.refreshInterval) {
    clearInterval(server.cache.watchers.refreshInterval);
  }
  await Promise.all([
    closeWatcher(server.cache.watchers.today, logger, "today"),
    closeWatcher(server.cache.watchers.currentShift, logger, "currentShift"),
  ]);
  server.cache.watchers = {};
}

module.exports = {
  startMongoWatchers,
  stopMongoWatchers,
  refreshTodayCache,
  refreshCurrentShiftCache,
};
