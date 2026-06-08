const {
  resolveCurrentShiftContext,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../utils/machineDashboardCache");
const {
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
} = require("../utils/operatorDashboardCache");
const schedule = require("node-schedule");

const CACHE_POLL_INTERVAL_MS = 6_000;
const DASHBOARD_CACHE_POLL_JOB_KEY = "dashboardCachePolling";

function ensureCache(server) {
  if (!server.cache) server.cache = {};
  if (!server.cache.today) server.cache.today = {};
  if (!server.cache.currentShift) server.cache.currentShift = {};
  if (!server.cache.watchers) server.cache.watchers = {};
  if (!server.cache.polling) server.cache.polling = {};
  if (!server.cache.polling.signatures) server.cache.polling.signatures = {};
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

function buildCacheSignature(cache) {
  return JSON.stringify({
    machinesSummary: cache.machinesSummary,
    operatorsSummary: cache.operatorsSummary,
    meta: cache.meta,
  });
}

function shouldBroadcastCacheUpdate(server, key, cache) {
  ensureCache(server);
  const nextSignature = buildCacheSignature(cache);
  const previousSignature = server.cache.polling.signatures[key];
  server.cache.polling.signatures[key] = nextSignature;
  return previousSignature !== undefined && previousSignature !== nextSignature;
}

async function refreshTodayCache(server) {
  const { db, logger, config } = server;
  const [machineResult, operatorResult] = await Promise.all([
    buildMachineSummaryFromDailyCache(db, logger, config),
    buildOperatorSummaryFromDailyCache(db, logger, config),
  ]);
  const nextCache = cacheEnvelope({
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
  server.cache.today = nextCache;

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.today with ${machineResult.data.length} machine rows and ${operatorResult.data.length} operator rows for ${machineResult.dateStr || operatorResult.dateStr}`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "today", nextCache)) {
    broadcastDashboardCache(server, "today");
  }
  return { machines: machineResult, operators: operatorResult };
}

async function refreshCurrentShiftCache(server) {
  const { db, logger, config } = server;
  const context = await resolveCurrentShiftContext(db, config);

  if (!context) {
    const nextCache = cacheEnvelope({}, {
      key: null,
      source: "none",
      found: { machines: false, operators: false },
      shift: null,
      mode: "none",
      recordCount: { machines: 0, operators: 0 },
    });
    server.cache.currentShift = nextCache;
    if (logger) {
      logger.info("[mongoWatchers] No current or previous shift found for server.cache.currentShift");
    }
    if (shouldBroadcastCacheUpdate(server, "currentShift", nextCache)) {
      broadcastDashboardCache(server, "currentShift");
    }
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

  const nextCache = cacheEnvelope({
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
  server.cache.currentShift = nextCache;

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.currentShift with ${machineResult.data.length} machine rows and ${operatorResult.data.length} operator rows for shift ${context.shiftOid}`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "currentShift", nextCache)) {
    broadcastDashboardCache(server, "currentShift");
  }
  return context;
}

async function refreshDashboardCache(server) {
  await refreshTodayCache(server);
  await refreshCurrentShiftCache(server);
}

function scheduleNextCachePoll(server) {
  ensureCache(server);

  if (server.cache.polling.stopped) return null;

  const runAt = new Date(Date.now() + CACHE_POLL_INTERVAL_MS);
  const job = schedule.scheduleJob(runAt, async () => {
    server.cache.polling.job = null;
    if (server.scheduledJobs) server.scheduledJobs[DASHBOARD_CACHE_POLL_JOB_KEY] = null;

    try {
      await refreshDashboardCache(server);
    } catch (error) {
      if (server.logger) {
        server.logger.error(`[mongoWatchers] Dashboard cache polling failed: ${error.message}`);
      }
    } finally {
      scheduleNextCachePoll(server);
    }
  });

  server.cache.polling.job = job;
  if (!server.scheduledJobs) server.scheduledJobs = {};
  server.scheduledJobs[DASHBOARD_CACHE_POLL_JOB_KEY] = job;
  return job;
}

function startCachePolling(server) {
  ensureCache(server);

  if (server.cache.polling.job) {
    return server.cache.polling.job;
  }

  server.cache.polling.stopped = false;
  const job = scheduleNextCachePoll(server);

  if (server.logger) {
    server.logger.info(
      `[mongoWatchers] Started dashboard cache polling every ${CACHE_POLL_INTERVAL_MS}ms`
    );
  }

  return job;
}

function stopCachePolling(server) {
  if (!server?.cache?.polling) return;

  server.cache.polling.stopped = true;
  if (server.cache.polling.job && typeof server.cache.polling.job.cancel === "function") {
    server.cache.polling.job.cancel();
  }
  server.cache.polling.job = null;

  if (server.scheduledJobs) {
    server.scheduledJobs[DASHBOARD_CACHE_POLL_JOB_KEY] = null;
  }
}

async function startMongoWatchers(server) {
  ensureCache(server);

  await refreshTodayCache(server);
  await refreshCurrentShiftCache(server);
  startCachePolling(server);

  return server.cache;
}

async function stopMongoWatchers(server) {
  if (!server?.cache) return;
  stopCachePolling(server);
  server.cache.watchers = {};
}

module.exports = {
  startMongoWatchers,
  stopMongoWatchers,
  refreshTodayCache,
  refreshCurrentShiftCache,
  refreshDashboardCache,
  buildDashboardCacheMessage,
};
