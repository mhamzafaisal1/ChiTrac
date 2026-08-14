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
const {
  buildTodayDailyAnalyticsCache,
  buildShiftDailyAnalyticsCache,
} = require("../utils/dailyAnalyticsDashboardCache");
const {
  buildLastHourCountSparklineCache,
  appendCompletedMinuteCountSparklineCache,
} = require("../utils/countSparklineCache");
const { SYSTEM_TIMEZONE } = require("../utils/time");
const {
  addDerivedShiftTimeComponents,
  getShiftTimeComponents,
} = require("../utils/shiftTimeComponents");

const CACHE_POLL_INTERVAL_MS = 6_000;
const DASHBOARD_CACHE_POLL_JOB_KEY = "dashboardCachePolling";
const DASHBOARD_HISTORY_REFRESH_JOB_KEY = "dashboardHistoryRefresh";
const DASHBOARD_HISTORY_DAYS = 7;
const LAST_SEVEN_DAYS_CACHE_JOB_KEY = "lastSevenDaysCacheRefresh";
const COUNT_SPARKLINE_JOB_KEY = "countSparklineMinuteRefresh";
const HISTORICAL_DAY_COUNT = 7;

function ensureCache(server) {
  if (!server.cache) server.cache = {};
  if (!server.cache.today) server.cache.today = {};
  if (!server.cache.currentShift) server.cache.currentShift = {};
  if (!server.cache.lastSevenDays) server.cache.lastSevenDays = {};
  if (!server.cache.dashboard) server.cache.dashboard = {};
  if (!server.cache.dashboard.machines) server.cache.dashboard.machines = {};
  if (!server.cache.dashboard.operators) server.cache.dashboard.operators = {};
  if (!server.cache.dashboard.dailyAnalytics) server.cache.dashboard.dailyAnalytics = {};
  if (!server.cache.dashboard.counts) server.cache.dashboard.counts = {};
  if (!Array.isArray(server.cache.dashboard.machines.shifts)) server.cache.dashboard.machines.shifts = [];
  if (!Array.isArray(server.cache.dashboard.operators.shifts)) server.cache.dashboard.operators.shifts = [];
  if (!Array.isArray(server.cache.dashboard.dailyAnalytics.shifts)) server.cache.dashboard.dailyAnalytics.shifts = [];
  if (!server.cache.dashboard.machines.history) server.cache.dashboard.machines.history = {};
  if (!server.cache.dashboard.operators.history) server.cache.dashboard.operators.history = {};
  if (!Array.isArray(server.cache.dashboard.machines.history.days)) server.cache.dashboard.machines.history.days = [];
  if (!Array.isArray(server.cache.dashboard.machines.history.shifts)) server.cache.dashboard.machines.history.shifts = [];
  if (!Array.isArray(server.cache.dashboard.operators.history.days)) server.cache.dashboard.operators.history.days = [];
  if (!Array.isArray(server.cache.dashboard.operators.history.shifts)) server.cache.dashboard.operators.history.shifts = [];
  if (!Array.isArray(server.cache.dashboard.machines.lastSevenDays)) server.cache.dashboard.machines.lastSevenDays = [];
  if (!Array.isArray(server.cache.dashboard.operators.lastSevenDays)) server.cache.dashboard.operators.lastSevenDays = [];
  if (!server.cache.watchers) server.cache.watchers = {};
  if (!server.cache.polling) server.cache.polling = {};
  if (!server.cache.polling.signatures) server.cache.polling.signatures = {};
  if (!server.cache.history) server.cache.history = {};
}

function serializableShift(shiftDoc) {
  if (!shiftDoc) return null;
  const components = addDerivedShiftTimeComponents(shiftDoc);
  return {
    _id: String(shiftDoc._id),
    id: shiftDoc.id,
    name: shiftDoc.name,
    active: shiftDoc.active,
    activeDays: shiftDoc.activeDays,
    startTime: components.startTime,
    endTime: components.endTime,
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
      lastSevenDays: server.cache?.lastSevenDays || {},
      countSparkline: server.cache?.countSparkline || {},
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
    days: cache?.days,
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
    projectionWindow: machineResult.projectionWindow,
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
  if (server.cache.countSparkline) {
    server.cache.today.countSparkline = server.cache.countSparkline;
  }

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

async function refreshCountSparklineCache(server, options = {}) {
  const { db, logger, config } = server;
  const existing = server.cache?.countSparkline;
  const nextCache = options.initial || !existing?.allMachines
    ? await buildLastHourCountSparklineCache(db, config, options.now)
    : await appendCompletedMinuteCountSparklineCache(db, config, existing, options.now);

  ensureCache(server);
  server.cache.countSparkline = nextCache;
  server.cache.dashboard.counts.sparkline = nextCache;

  if (server.cache.today) {
    server.cache.today.countSparkline = nextCache;
  }
  if (server.cache.currentShift) {
    server.cache.currentShift.countSparkline = nextCache;
  }

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated count sparkline cache with ${nextCache.allMachines?.length || 0} minute buckets`
    );
  }

  if (options.broadcast !== false) {
    broadcastDashboardCache(server, "countSparkline");
  }

  return nextCache;
}

async function refreshTodayDailyAnalyticsCache(server) {
  const { db, logger, config } = server;
  const nextCache = await buildTodayDailyAnalyticsCache(db, logger, config);
  server.cache.dashboard.dailyAnalytics.today = nextCache;

  if (logger) {
    const chartKeys = Object.keys(nextCache.data || {});
    logger.info(
      `[mongoWatchers] Updated daily analytics today cache with ${chartKeys.length} chart payloads for ${nextCache.meta?.date}`
    );
  }

  if (shouldBroadcastCacheUpdate(server, "dailyAnalyticsToday", { dailyAnalytics: server.cache.dashboard.dailyAnalytics })) {
    broadcastDashboardCache(server, "dailyAnalytics");
  }

  return nextCache;
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
    projectionWindow: machineResult.projectionWindow,
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
  return Boolean(shift && shift._id && getShiftTimeComponents(shift));
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
      const components = getShiftTimeComponents(shift);
      const start = toShiftDateTime(day, components.startTime);
      const end = toShiftDateTime(day, components.endTime);
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
  const dailyAnalyticsShifts = [];

  for (const context of contexts) {
    try {
      const [machineResult, operatorResult, dailyAnalyticsResult] = await Promise.all([
        buildMachineSummaryFromShiftCache(db, logger, config, context),
        buildOperatorSummaryFromShiftCache(db, logger, config, context),
        buildShiftDailyAnalyticsCache(db, logger, config, context),
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
      dailyAnalyticsShifts.push(dailyAnalyticsResult);
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to update dashboard shift cache for ${context.shiftOid}: ${error.message}`);
      }
    }
  }

  server.cache.dashboard.machines.shifts = machineShifts;
  server.cache.dashboard.operators.shifts = operatorShifts;
  server.cache.dashboard.dailyAnalytics.shifts = dailyAnalyticsShifts;

  if (logger) {
    logger.info(
      `[mongoWatchers] Updated dashboard shift caches with ${machineShifts.length} machine shift entries, ${operatorShifts.length} operator shift entries, and ${dailyAnalyticsShifts.length} daily analytics shift entries`
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
  const components = getShiftTimeComponents(shift);
  const start = toShiftDateTime(day, components.startTime);
  let end = toShiftDateTime(day, components.endTime);
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

async function resolveShiftContextsForDay(db, config, dayInput) {
  const day = DateTime.isDateTime(dayInput)
    ? dayInput.setZone(SYSTEM_TIMEZONE).startOf("day")
    : DateTime.fromJSDate(new Date(dayInput), { zone: SYSTEM_TIMEZONE }).startOf("day");

  if (!day.isValid) return [];

  const shifts = await db
    .collection(config.shiftCollectionName)
    .find({ active: { $ne: false } })
    .toArray();
  const weekday = day.weekday;

  return shifts
    .filter(isValidShift)
    .filter((shift) => {
      const activeDays = Array.isArray(shift.activeDays) ? shift.activeDays : [];
      return activeDays.length === 0 || activeDays.includes(weekday);
    })
    .map((shift) => {
      const components = getShiftTimeComponents(shift);
      const start = toShiftDateTime(day, components.startTime);
      const end = toShiftDateTime(day, components.endTime);
      return {
        shiftDoc: shift,
        shiftOid: new ObjectId(String(shift._id)),
        dateStr: day.toISODate(),
        start: start.toJSDate(),
        end: end.toJSDate(),
        mode: "complete",
      };
    })
    .filter((context) => context.end > context.start)
    .sort((a, b) => a.start - b.start);
}

function historicalDayEnvelope(dateStr, allDay, shifts, meta) {
  return {
    date: dateStr,
    allDay,
    shifts,
    updatedAt: new Date(),
    meta,
  };
}

async function buildHistoricalDayCache(server, day) {
  const { db, logger, config } = server;
  const dayStart = day.setZone(SYSTEM_TIMEZONE).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const dateStr = dayStart.toISODate();
  const start = dayStart.toJSDate();
  const end = dayEnd.toJSDate();

  const [machineResult, operatorResult] = await Promise.all([
    buildMachineSummaryFromDailyCache(db, logger, config, { start, end, dateStr }),
    buildOperatorSummaryFromDailyCache(db, logger, config, { start, end, dateStr }),
  ]);
  const allDayMeta = resultMeta(machineResult, operatorResult);
  const allDay = cacheEnvelope({
    machinesSummary: machineResult.data,
    operatorsSummary: operatorResult.data,
  }, allDayMeta);

  const contexts = await resolveShiftContextsForDay(db, config, dayStart);
  const machineShifts = [];
  const operatorShifts = [];

  for (const context of contexts) {
    try {
      const [shiftMachineResult, shiftOperatorResult] = await Promise.all([
        buildMachineSummaryFromShiftCache(db, logger, config, context),
        buildOperatorSummaryFromShiftCache(db, logger, config, context),
      ]);
      const shiftMeta = {
        key: `${context.dateStr}|${String(context.shiftOid)}`,
        date: context.dateStr,
        shiftId: String(context.shiftOid),
        shift: serializableShift(context.shiftDoc),
        mode: context.mode,
        source: {
          machines: shiftMachineResult.source,
          operators: shiftOperatorResult.source,
        },
        found: {
          machines: shiftMachineResult.found,
          operators: shiftOperatorResult.found,
        },
        recordCount: {
          machines: shiftMachineResult.recordCount,
          operators: shiftOperatorResult.recordCount,
        },
        start: context.start,
        end: context.end,
      };

      machineShifts.push(machineDashboardEnvelope(shiftMachineResult.data, shiftMeta));
      operatorShifts.push(operatorDashboardEnvelope(shiftOperatorResult.data, shiftMeta));
    } catch (error) {
      if (logger) {
        logger.error(`[mongoWatchers] Failed to build historical shift cache for ${dateStr} shift ${context.shiftOid}: ${error.message}`);
      }
    }
  }

  const meta = {
    key: dateStr,
    date: dateStr,
    start,
    end,
    source: allDayMeta.source,
    found: allDayMeta.found,
    recordCount: allDayMeta.recordCount,
    shiftCount: contexts.length,
  };

  return {
    date: dateStr,
    machines: historicalDayEnvelope(
      dateStr,
      machineDashboardEnvelope(machineResult.data, allDayMeta),
      machineShifts,
      meta
    ),
    operators: historicalDayEnvelope(
      dateStr,
      operatorDashboardEnvelope(operatorResult.data, allDayMeta),
      operatorShifts,
      meta
    ),
    combined: historicalDayEnvelope(dateStr, allDay, {
      machines: machineShifts,
      operators: operatorShifts,
    }, meta),
  };
}

function getCompletedHistoricalDays(nowInput = new Date()) {
  const today = DateTime.fromJSDate(new Date(nowInput), { zone: SYSTEM_TIMEZONE }).startOf("day");
  const days = [];
  for (let offset = 1; offset <= HISTORICAL_DAY_COUNT; offset += 1) {
    days.push(today.minus({ days: offset }));
  }
  return days;
}

async function refreshLastSevenDaysCache(server, options = {}) {
  ensureCache(server);
  const days = getCompletedHistoricalDays(options.now);
  const dayCaches = [];

  for (const day of days) {
    try {
      dayCaches.push(await buildHistoricalDayCache(server, day));
    } catch (error) {
      if (server.logger) {
        server.logger.error(`[mongoWatchers] Failed to build historical cache for ${day.toISODate()}: ${error.message}`);
      }
    }
  }

  const combinedDays = dayCaches.map((dayCache) => dayCache.combined);
  const machineDays = dayCaches.map((dayCache) => dayCache.machines);
  const operatorDays = dayCaches.map((dayCache) => dayCache.operators);
  const dateKeys = combinedDays.map((dayCache) => dayCache.date);

  server.cache.lastSevenDays = {
    days: combinedDays,
    byDate: Object.fromEntries(combinedDays.map((dayCache) => [dayCache.date, dayCache])),
    updatedAt: new Date(),
    meta: {
      key: "lastSevenDays",
      days: dateKeys,
      dayCount: combinedDays.length,
      requestedDayCount: HISTORICAL_DAY_COUNT,
      completedOnly: true,
    },
  };
  server.cache.dashboard.machines.lastSevenDays = machineDays;
  server.cache.dashboard.operators.lastSevenDays = operatorDays;

  if (server.logger) {
    server.logger.info(
      `[mongoWatchers] Updated last 7 completed days cache with ${combinedDays.length} days: ${dateKeys.join(", ")}`
    );
  }

  if (options.broadcast !== false && shouldBroadcastCacheUpdate(server, "lastSevenDays", server.cache.lastSevenDays)) {
    broadcastDashboardCache(server, "lastSevenDays");
  }

  return server.cache.lastSevenDays;
}

async function refreshDashboardCache(server) {
  await refreshTodayCache(server);
  await refreshTodayDailyAnalyticsCache(server);
  await refreshCurrentShiftCache(server);
  await refreshTodayShiftCaches(server);
}

function scheduleCountSparklineRefresh(server) {
  ensureCache(server);
  if (!server.scheduledJobs) server.scheduledJobs = {};

  const existing = server.scheduledJobs[COUNT_SPARKLINE_JOB_KEY];
  if (existing && typeof existing.cancel === "function") {
    existing.cancel();
  }

  const rule = new schedule.RecurrenceRule();
  rule.tz = SYSTEM_TIMEZONE;
  rule.second = 0;

  const job = schedule.scheduleJob(rule, async () => {
    try {
      await refreshCountSparklineCache(server);
    } catch (error) {
      if (server.logger) {
        server.logger.error(`[mongoWatchers] Count sparkline refresh failed: ${error.message}`);
      }
    }
  });

  server.scheduledJobs[COUNT_SPARKLINE_JOB_KEY] = job;

  if (server.logger) {
    server.logger.info("[mongoWatchers] Scheduled count sparkline refresh at the start of each minute");
  }

  return job;
}

function scheduleLastSevenDaysRefresh(server) {
  ensureCache(server);
  if (!server.scheduledJobs) server.scheduledJobs = {};

  const existing = server.scheduledJobs[LAST_SEVEN_DAYS_CACHE_JOB_KEY];
  if (existing && typeof existing.cancel === "function") {
    existing.cancel();
  }

  const job = schedule.scheduleJob(
    {
      hour: 0,
      minute: 0,
      second: 0,
      tz: SYSTEM_TIMEZONE,
    },
    async () => {
      try {
        await refreshLastSevenDaysCache(server);
      } catch (error) {
        if (server.logger) {
          server.logger.error(`[mongoWatchers] Scheduled last 7 completed days cache refresh failed: ${error.message}`);
        }
      }
    }
  );

  server.scheduledJobs[LAST_SEVEN_DAYS_CACHE_JOB_KEY] = job;

  if (server.logger) {
    server.logger.info("[mongoWatchers] Scheduled last 7 completed days cache refresh for midnight plant time");
  }

  return job;
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

  await refreshCountSparklineCache(server, { initial: true, broadcast: false });
  await refreshLastWeekDashboardCache(server);
  await refreshDashboardCache(server);
  startHistoryRefreshSchedule(server);
  await refreshLastSevenDaysCache(server, { broadcast: false });
  scheduleLastSevenDaysRefresh(server);
  scheduleCountSparklineRefresh(server);
  startCachePolling(server);

  return server.cache;
}

async function stopMongoWatchers(server) {
  if (!server?.cache) return;
  stopCachePolling(server);
  stopHistoryRefreshSchedule(server);
  const historyJob = server.scheduledJobs?.[LAST_SEVEN_DAYS_CACHE_JOB_KEY];
  if (historyJob && typeof historyJob.cancel === "function") {
    historyJob.cancel();
  }
  if (server.scheduledJobs) {
    server.scheduledJobs[LAST_SEVEN_DAYS_CACHE_JOB_KEY] = null;
  }
  const countSparklineJob = server.scheduledJobs?.[COUNT_SPARKLINE_JOB_KEY];
  if (countSparklineJob && typeof countSparklineJob.cancel === "function") {
    countSparklineJob.cancel();
  }
  if (server.scheduledJobs) {
    server.scheduledJobs[COUNT_SPARKLINE_JOB_KEY] = null;
  }
  server.cache.watchers = {};
}

module.exports = {
  startMongoWatchers,
  stopMongoWatchers,
  refreshTodayCache,
  refreshCurrentShiftCache,
  refreshTodayDailyAnalyticsCache,
  refreshCountSparklineCache,
  refreshLastWeekDashboardCache,
  refreshDashboardCache,
  refreshLastSevenDaysCache,
  buildDashboardCacheMessage,
};
