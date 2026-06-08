const {
  TOTALS_SHIFT_COLLECTION,
  getTodayRange,
  resolveCurrentShiftContext,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../utils/machineDashboardCache");
const {
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
} = require("../utils/operatorDashboardCache");

const WATCH_REFRESH_INTERVAL_MS = 60_000;
const REBUILD_DEBOUNCE_MS = 250;

function ensureCache(server) {
  if (!server.cache) server.cache = {};
  if (!server.cache.today) server.cache.today = {};
  if (!server.cache.currentShift) server.cache.currentShift = {};
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

function cacheEnvelope(data, meta) {
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data
    : { machinesSummary: Array.isArray(data) ? data : [] };

  return {
    machinesSummary: Array.isArray(payload.machinesSummary) ? payload.machinesSummary : [],
    operatorsSummary: Array.isArray(payload.operatorsSummary) ? payload.operatorsSummary : [],
    updatedAt: new Date(),
    meta,
  };
}

function buildDashboardCacheMessage(server, scope) {
  return {
    type: "dashboard-cache",
    timestamp: new Date().toISOString(),
    scope,
    cache: {
      today: server.cache?.today || cacheEnvelope({}, { source: "none" }),
      currentShift: server.cache?.currentShift || cacheEnvelope({}, { source: "none" }),
    },
  };
}

function broadcastDashboardCache(server, scope) {
  if (typeof server.broadcastWebsocket !== "function") return;
  server.broadcastWebsocket(buildDashboardCacheMessage(server, scope));
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
  const [machineResult, operatorResult] = await Promise.all([
    buildMachineSummaryFromDailyCache(db, logger, config),
    buildOperatorSummaryFromDailyCache(db, logger, config),
  ]);
  server.cache.today = cacheEnvelope({
    machinesSummary: machineResult.data,
    operatorsSummary: operatorResult.data,
  }, {
    key: machineResult.dateStr || operatorResult.dateStr,
    date: machineResult.dateStr || operatorResult.dateStr,
    source: {
      machines: machineResult.found ? machineResult.source : "none",
      operators: operatorResult.found ? operatorResult.source : "none",
    },
    found: {
      machines: machineResult.found,
      operators: operatorResult.found,
    },
    recordCount: {
      machines: machineResult.recordCount,
      operators: operatorResult.recordCount,
    },
    start: machineResult.start || operatorResult.start,
    end: machineResult.end || operatorResult.end,
  });

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.today with ${machineResult.data.length} machine rows and ${operatorResult.data.length} operator rows for ${machineResult.dateStr || operatorResult.dateStr}`
    );
  }

  broadcastDashboardCache(server, "today");
  return { machines: machineResult, operators: operatorResult };
}

async function refreshCurrentShiftCache(server) {
  const { db, logger, config } = server;
  const context = await resolveCurrentShiftContext(db, config);

  if (!context) {
    server.cache.currentShift = cacheEnvelope({}, {
      key: null,
      source: "none",
      found: { machines: false, operators: false },
      shift: null,
      mode: "none",
      recordCount: { machines: 0, operators: 0 },
    });
    if (logger) {
      logger.info("[mongoWatchers] No current or previous shift found for server.cache.currentShift");
    }
    broadcastDashboardCache(server, "currentShift");
    return null;
  }

  let machineResult;
  let operatorResult;
  const errors = {};
  try {
    machineResult = await buildMachineSummaryFromShiftCache(db, logger, config, context);
  } catch (error) {
    errors.machines = error.message;
    machineResult = { data: [], source: "error", found: false, recordCount: 0 };
    if (logger) {
      logger.error(`[mongoWatchers] Failed to update server.cache.currentShift machines: ${error.message}`);
    }
  }

  try {
    operatorResult = await buildOperatorSummaryFromShiftCache(db, logger, config, context);
  } catch (error) {
    errors.operators = error.message;
    operatorResult = { data: [], source: "error", found: false, recordCount: 0 };
    if (logger) {
      logger.error(`[mongoWatchers] Failed to update server.cache.currentShift operators: ${error.message}`);
    }
  }

  server.cache.currentShift = cacheEnvelope({
    machinesSummary: machineResult.data,
    operatorsSummary: operatorResult.data,
  }, {
    key: `${context.dateStr}|${String(context.shiftOid)}`,
    date: context.dateStr,
    shiftId: String(context.shiftOid),
    shift: serializableShift(context.shiftDoc),
    mode: context.mode,
    source: {
      machines: machineResult.source,
      operators: operatorResult.source,
    },
    found: {
      machines: machineResult.found,
      operators: operatorResult.found,
    },
    recordCount: {
      machines: machineResult.recordCount,
      operators: operatorResult.recordCount,
    },
    start: context.start,
    end: context.end,
    errors,
  });

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.currentShift with ${machineResult.data.length} machine rows and ${operatorResult.data.length} operator rows for shift ${context.shiftOid}`
    );
  }

  broadcastDashboardCache(server, "currentShift");
  return context;
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
      logger.warn(
        `[mongoWatchers] ${name} watcher disabled: MongoDB change streams require a replica set`
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
    { entityType: { $in: ["machine", "operator-machine"] }, date: range.dateStr },
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
      entityType: { $in: ["machine", "operator-machine"] },
      date: context.dateStr,
      shiftId: String(context.shiftOid),
    },
    rebuild,
    "currentShift"
  );
}

async function refreshWatcherTargets(server) {
  const todayKey = getTodayRange().dateStr;
  if (server.cache.watchers.todayKey !== todayKey) {
    await refreshTodayCache(server);
    await resetTodayWatcher(server);
  }

  const context = await resolveCurrentShiftContext(server.db, server.config);
  const nextShiftKey = context ? `${context.dateStr}|${String(context.shiftOid)}` : null;
  if (server.cache.watchers.currentShiftKey !== nextShiftKey) {
    await refreshCurrentShiftCache(server);
    await resetCurrentShiftWatcher(server);
  }
}

async function startMongoWatchers(server) {
  ensureCache(server);
  const { logger } = server;

  await refreshTodayCache(server);
  await refreshCurrentShiftCache(server);

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
  buildDashboardCacheMessage,
};
