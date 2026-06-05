const {
  TOTALS_SHIFT_COLLECTION,
  getTodayRange,
  resolveCurrentShiftContext,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../utils/machineDashboardCache");

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
  return {
    machinesSummary: Array.isArray(data) ? data : [],
    updatedAt: new Date(),
    meta,
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
  server.cache.today = cacheEnvelope(result.data, {
    key: result.dateStr,
    date: result.dateStr,
    source: result.found ? result.source : "none",
    found: result.found,
    recordCount: result.recordCount,
    start: result.start,
    end: result.end,
  });

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.today with ${result.data.length} machine rows for ${result.dateStr}`
    );
  }

  return result;
}

async function refreshCurrentShiftCache(server) {
  const { db, logger, config } = server;
  const context = await resolveCurrentShiftContext(db, config);

  if (!context) {
    server.cache.currentShift = cacheEnvelope([], {
      key: null,
      source: "none",
      found: false,
      shift: null,
      mode: "none",
      recordCount: 0,
    });
    if (logger) {
      logger.info("[mongoWatchers] No current or previous shift found for server.cache.currentShift");
    }
    return null;
  }

  let result;
  try {
    result = await buildMachineSummaryFromShiftCache(db, logger, config, context);
  } catch (error) {
    server.cache.currentShift = cacheEnvelope([], {
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
    if (logger) {
      logger.error(`[mongoWatchers] Failed to update server.cache.currentShift: ${error.message}`);
    }
    return context;
  }

  server.cache.currentShift = cacheEnvelope(result.data, {
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

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.currentShift with ${result.data.length} machine rows for shift ${context.shiftOid}`
    );
  }

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
    { entityType: "machine", date: range.dateStr },
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
      entityType: "machine",
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
};
