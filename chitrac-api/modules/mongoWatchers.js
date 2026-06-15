const { ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const schedule = require("node-schedule");
const {
  resolveCurrentShiftContext,
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../utils/machineDashboardCache");
const {
  buildOperatorSummaryFromDailyCache,
  buildOperatorSummaryFromShiftCache,
} = require("../utils/operatorDashboardCache");
const { SYSTEM_TIMEZONE } = require("../utils/time");

const CACHE_POLL_INTERVAL_MS = 6_000;
const DASHBOARD_CACHE_POLL_JOB_KEY = "dashboardCachePolling";
const DASHBOARD_HISTORY_REFRESH_JOB_KEY = "dashboardHistoryRefresh";
const DASHBOARD_HISTORY_DAYS = 7;

function ensureCache(server) {
  if (!server.cache) server.cache = {};
  if (!server.cache.today) server.cache.today = {};
  if (!server.cache.currentShift) server.cache.currentShift = {};
  if (!server.cache.dashboard) server.cache.dashboard = {};
  if (!server.cache.dashboard.machines) server.cache.dashboard.machines = {};
  if (!server.cache.dashboard.operators) server.cache.dashboard.operators = {};
  if (!Array.isArray(server.cache.dashboard.machines.shifts)) server.cache.dashboard.machines.shifts = [];
  if (!Array.isArray(server.cache.dashboard.operators.shifts)) server.cache.dashboard.operators.shifts = [];
  if (!server.cache.dashboard.machines.history) server.cache.dashboard.machines.history = {};
  if (!server.cache.dashboard.operators.history) server.cache.dashboard.operators.history = {};
  if (!Array.isArray(server.cache.dashboard.machines.history.days)) server.cache.dashboard.machines.history.days = [];
  if (!Array.isArray(server.cache.dashboard.machines.history.shifts)) server.cache.dashboard.machines.history.shifts = [];
  if (!Array.isArray(server.cache.dashboard.operators.history.days)) server.cache.dashboard.operators.history.days = [];
  if (!Array.isArray(server.cache.dashboard.operators.history.shifts)) server.cache.dashboard.operators.history.shifts = [];
  if (!server.cache.watchers) server.cache.watchers = {};
  if (!server.cache.polling) server.cache.polling = {};
  if (!server.cache.polling.signatures) server.cache.polling.signatures = {};
  if (!server.cache.history) server.cache.history = {};
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

function buildDashboardCacheMessage(server, scope = "all") {
  return {
    type: "dashboard-cache-update",
    timestamp: new Date().toISOString(),
    scope,
    cache: {
      today: server.cache?.today || cacheEnvelope({}, { source: "none" }),
      currentShift: server.cache?.currentShift || cacheEnvelope({}, { source: "none" }),
      dashboard: server.cache?.dashboard || {},
    },
    dashboard: server.cache?.dashboard || {},
  };
}

function broadcastDashboardCache(server, scope) {
  if (typeof server.broadcastWebsocket !== "function") return;
  server.broadcastWebsocket(buildDashboardCacheMessage(server, scope));
}

function buildCacheSignature(cache) {
  return JSON.stringify({
    machinesSummary: cache?.machinesSummary,
    operatorsSummary: cache?.operatorsSummary,
    dashboard: cache?.dashboard,
    meta: cache?.meta,
  });
}

function shouldBroadcastCacheUpdate(server, key, cache) {
  ensureCache(server);
  const nextSignature = buildCacheSignature(cache);
  const previousSignature = server.cache.polling.signatures[key];
  server.cache.polling.signatures[key] = nextSignature;
  return previousSignature !== undefined && previousSignature !== nextSignature;
}

function resultMeta(machineResult, operatorResult) {
  return {
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
  };
}

async function refreshTodayCache(server) {
  const { db, logger, config } = server;
  const [machineResult, operatorResult] = await Promise.all([
    buildMachineSummaryFromDailyCache(db, logger, config),
    buildOperatorSummaryFromDailyCache(db, logger, config),
  ]);

  const meta = resultMeta(machineResult, operatorResult);
  const nextCache = cacheEnvelope({
    machinesSummary: machineResult.data,
    operatorsSummary: operatorResult.data,
  }, meta);

  server.cache.today = nextCache;
  server.cache.dashboard.machines.today = machineDashboardEnvelope(machineResult.data, meta);
  server.cache.dashboard.operators.today = operatorDashboardEnvelope(operatorResult.data, meta);

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated server.cache.today with ${machineResult.data.length} machine rows and ${operatorResult.data.length} operator rows for ${meta.date}`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "today", nextCache)) {
    broadcastDashboardCache(server, "today");
  }

  return { machines: machineResult, operators: operatorResult };
}

function emptyShiftCache() {
  return cacheEnvelope({}, {
    key: null,
    source: "none",
    found: { machines: false, operators: false },
    shift: null,
    mode: "none",
    recordCount: { machines: 0, operators: 0 },
  });
}

async function refreshCurrentShiftCache(server) {
  const { db, logger, config } = server;
  const context = await resolveCurrentShiftContext(db, config);

  if (!context) {
    const nextCache = emptyShiftCache();
    server.cache.currentShift = nextCache;
    server.cache.dashboard.machines.shifts = [];
    server.cache.dashboard.operators.shifts = [];

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
    if (logger) logger.error(`[mongoWatchers] Failed to update server.cache.currentShift machines: ${error.message}`);
  }

  try {
    operatorResult = await buildOperatorSummaryFromShiftCache(db, logger, config, context);
  } catch (error) {
    errors.operators = error.message;
    operatorResult = { data: [], source: "error", found: false, recordCount: 0 };
    if (logger) logger.error(`[mongoWatchers] Failed to update server.cache.currentShift operators: ${error.message}`);
  }

  const meta = {
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
  };
  const nextCache = cacheEnvelope({
    machinesSummary: machineResult.data,
    operatorsSummary: operatorResult.data,
  }, meta);

  server.cache.currentShift = nextCache;
  server.cache.dashboard.machines.shifts = upsertShift(
    server.cache.dashboard.machines.shifts,
    machineDashboardEnvelope(machineResult.data, meta)
  );
  server.cache.dashboard.operators.shifts = upsertShift(
    server.cache.dashboard.operators.shifts,
    operatorDashboardEnvelope(operatorResult.data, meta)
  );

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

function upsertShift(envelopes, shiftEnvelope) {
  const next = Array.isArray(envelopes) ? [...envelopes] : [];
  const index = next.findIndex((item) => item?.meta?.key === shiftEnvelope?.meta?.key);

  if (index === -1) next.push(shiftEnvelope);
  else next[index] = shiftEnvelope;

  return next.sort((a, b) => new Date(a?.meta?.start || 0) - new Date(b?.meta?.start || 0));
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
      return {
        shiftDoc: shift,
        shiftOid: new ObjectId(String(shift._id)),
        dateStr: now.toISODate(),
        start: start.toJSDate(),
        end: (isCurrent ? now : end).toJSDate(),
        mode: isCurrent ? "current" : "complete",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

async function refreshTodayShiftCaches(server) {
  const { db, logger, config } = server;
  const contexts = await resolveTodayShiftContexts(db, config);
  const machineShifts = [];
  const operatorShifts = [];

  for (const context of contexts) {
    try {
      const [machineResult, operatorResult] = await Promise.all([
        buildMachineSummaryFromShiftCache(db, logger, config, context),
        buildOperatorSummaryFromShiftCache(db, logger, config, context),
      ]);
      const meta = {
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
      };

      machineShifts.push(machineDashboardEnvelope(machineResult.data, meta));
      operatorShifts.push(operatorDashboardEnvelope(operatorResult.data, meta));
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to update dashboard shift cache for ${context.shiftOid}: ${error.message}`);
      }
    }
  }

  server.cache.dashboard.machines.shifts = machineShifts;
  server.cache.dashboard.operators.shifts = operatorShifts;

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated dashboard shift caches with ${machineShifts.length} machine shift entries and ${operatorShifts.length} operator shift entries`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "dashboard", { dashboard: server.cache.dashboard })) {
    broadcastDashboardCache(server, "dashboard");
  }
  return contexts;
}

function getLastFullDayStarts(nowInput = new Date(), days = DASHBOARD_HISTORY_DAYS) {
  const now = DateTime.fromJSDate(new Date(nowInput), { zone: SYSTEM_TIMEZONE });
  if (!now.isValid) return [];

  const todayStart = now.startOf("day");
  return Array.from({ length: days }, (_, index) => (
    todayStart.minus({ days: days - index })
  ));
}

function isShiftActiveOnDay(shift, weekday) {
  const activeDays = Array.isArray(shift.activeDays) ? shift.activeDays : [];
  return activeDays.length === 0 || activeDays.includes(weekday);
}

function resolveShiftContextForDay(shift, day) {
  const start = toShiftDateTime(day, shift.startTime);
  let end = toShiftDateTime(day, shift.endTime);
  if (end <= start) {
    end = end.plus({ days: 1 });
  }

  return {
    shiftDoc: shift,
    shiftOid: new ObjectId(String(shift._id)),
    dateStr: day.toISODate(),
    start: start.toJSDate(),
    end: end.toJSDate(),
    mode: "history",
  };
}

async function resolveHistoryShiftContexts(db, config, dayStarts) {
  const shifts = await db
    .collection(config.shiftCollectionName)
    .find({ active: { $ne: false } })
    .toArray();

  const activeShifts = shifts.filter(isValidShift);
  return dayStarts
    .flatMap((day) => activeShifts
      .filter((shift) => isShiftActiveOnDay(shift, day.weekday))
      .map((shift) => resolveShiftContextForDay(shift, day))
    )
    .sort((a, b) => a.start - b.start);
}

function buildHistoryMeta(dayStarts, dayCount, shiftCount) {
  const now = new Date();
  return {
    mode: "history",
    days: dayCount,
    shifts: shiftCount,
    start: dayStarts[0]?.startOf("day").toJSDate() || null,
    end: dayStarts[dayStarts.length - 1]?.endOf("day").toJSDate() || null,
    refreshedAt: now,
  };
}

async function refreshLastWeekDashboardCache(server) {
  ensureCache(server);
  const { db, logger, config } = server;
  const dayStarts = getLastFullDayStarts(new Date());
  const machineDays = [];
  const operatorDays = [];
  const machineShifts = [];
  const operatorShifts = [];

  for (const day of dayStarts) {
    const dateStr = day.toISODate();
    const start = day.startOf("day").toJSDate();
    const end = day.endOf("day").toJSDate();

    try {
      const [machineResult, operatorResult] = await Promise.all([
        buildMachineSummaryFromDailyCache(db, logger, config, { start, end, dateStr }),
        buildOperatorSummaryFromDailyCache(db, logger, config, { start, end, dateStr }),
      ]);
      const meta = {
        ...resultMeta(machineResult, operatorResult),
        mode: "history",
      };

      machineDays.push(machineDashboardEnvelope(machineResult.data, meta));
      operatorDays.push(operatorDashboardEnvelope(operatorResult.data, meta));
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to update dashboard history day cache for ${dateStr}: ${error.message}`);
      }
    }
  }

  const shiftContexts = await resolveHistoryShiftContexts(db, config, dayStarts);
  for (const context of shiftContexts) {
    try {
      const [machineResult, operatorResult] = await Promise.all([
        buildMachineSummaryFromShiftCache(db, logger, config, context),
        buildOperatorSummaryFromShiftCache(db, logger, config, context),
      ]);
      const meta = {
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
      };

      machineShifts.push(machineDashboardEnvelope(machineResult.data, meta));
      operatorShifts.push(operatorDashboardEnvelope(operatorResult.data, meta));
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to update dashboard history shift cache for ${context.dateStr}|${context.shiftOid}: ${error.message}`);
      }
    }
  }

  const historyMeta = buildHistoryMeta(dayStarts, machineDays.length, machineShifts.length);
  server.cache.dashboard.machines.history = {
    days: machineDays,
    shifts: machineShifts,
    updatedAt: new Date(),
    meta: historyMeta,
  };
  server.cache.dashboard.operators.history = {
    days: operatorDays,
    shifts: operatorShifts,
    updatedAt: new Date(),
    meta: buildHistoryMeta(dayStarts, operatorDays.length, operatorShifts.length),
  };

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated dashboard history cache with ${machineDays.length} machine days, ${operatorDays.length} operator days, ${machineShifts.length} machine shifts, and ${operatorShifts.length} operator shifts`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "dashboardHistory", { dashboard: server.cache.dashboard })) {
    broadcastDashboardCache(server, "dashboardHistory");
  }

  return {
    machineDays,
    operatorDays,
    machineShifts,
    operatorShifts,
  };
}

async function refreshDashboardCache(server) {
  await refreshTodayCache(server);
  await refreshCurrentShiftCache(server);
  await refreshTodayShiftCaches(server);
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

function startHistoryRefreshSchedule(server) {
  ensureCache(server);

  if (server.cache.history.job) {
    return server.cache.history.job;
  }

  const rule = new schedule.RecurrenceRule();
  rule.tz = SYSTEM_TIMEZONE;
  rule.hour = 0;
  rule.minute = 0;
  rule.second = 0;

  const job = schedule.scheduleJob(rule, async () => {
    try {
      await refreshLastWeekDashboardCache(server);
    } catch (error) {
      if (server.logger) {
        server.logger.error(`[mongoWatchers] Dashboard history refresh failed: ${error.message}`);
      }
    }
  });

  server.cache.history.job = job;
  if (!server.scheduledJobs) server.scheduledJobs = {};
  server.scheduledJobs[DASHBOARD_HISTORY_REFRESH_JOB_KEY] = job;

  if (server.logger) {
    server.logger.info(`[mongoWatchers] Scheduled dashboard history refresh at midnight ${SYSTEM_TIMEZONE}`);
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

function stopHistoryRefreshSchedule(server) {
  if (!server?.cache?.history) return;

  if (server.cache.history.job && typeof server.cache.history.job.cancel === "function") {
    server.cache.history.job.cancel();
  }
  server.cache.history.job = null;

  if (server.scheduledJobs) {
    server.scheduledJobs[DASHBOARD_HISTORY_REFRESH_JOB_KEY] = null;
  }
}

async function startMongoWatchers(server) {
  ensureCache(server);

  await refreshLastWeekDashboardCache(server);
  await refreshDashboardCache(server);
  startHistoryRefreshSchedule(server);
  startCachePolling(server);

  return server.cache;
}

async function stopMongoWatchers(server) {
  if (!server?.cache) return;
  stopCachePolling(server);
  stopHistoryRefreshSchedule(server);
  server.cache.watchers = {};
}

module.exports = {
  startMongoWatchers,
  stopMongoWatchers,
  refreshTodayCache,
  refreshCurrentShiftCache,
  refreshLastWeekDashboardCache,
  refreshDashboardCache,
  buildDashboardCacheMessage,
};
