/**
 * AC360 hourly and daily totals cache: build and upsert from machine-session and operator-session (DB).
 * Mirrors machine-simulator cache logic so hourly-totals and daily-totals collections stay consistent.
 *
 * Daily totals are derived by querying and summing hourly totals (experimental approach to test performance).
 */

const { DateTime } = require('luxon');

const SYSTEM_TIMEZONE = 'America/Chicago';
const HOURLY_TOTALS_COLLECTION = 'hourly-totals';
const DAILY_TOTALS_COLLECTION = 'totals-daily';

function overlap(sStart, sEnd, wStart, wEnd) {
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const f = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor: f };
}

function safe(n) {
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

/**
 * Build one machine hourly total for a given hour (AC360: no fault sessions).
 * Session shape: timestamps.start/end, totalCount, totalTimeCredit, misfeeds[], operators[].
 */
function buildMachineHourlyTotal({ machineSerial, machineName, machineSessions, queryStart, queryEnd }) {
  try {
    let runtimeSec = 0, workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of machineSessions) {
      const { ovSec, factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const totalTimeCredit = s.totalTimeCredit ?? 0;
      const totalCount = s.totalCount ?? (s.counts?.length ?? 0);
      const misfeedCount = s.misfeedCount ?? (s.misfeeds?.length ?? 0);

      const activeStations = Array.isArray(s.operators)
        ? s.operators.filter((op) => op && op.id !== -1).length
        : 0;
      const workTimeFromOverlap = activeStations > 0 ? ovSec * activeStations : ovSec;

      runtimeSec += ovSec;
      workedTimeSec += workTimeFromOverlap;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(runtimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0;
    const pausedTimeMs = Math.max(0, windowMs - runtimeMs);

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, {
      zone: SYSTEM_TIMEZONE,
    })
      .toUTC()
      .toJSDate();

    return {
      _id: `machine-${machineSerial}-${dateHourStr}`,
      entityType: 'machine',
      machineSerial,
      machineName,
      date: dateStr,
      dateHourStr,
      hour,
      dateObj,
      runtimeMs,
      faultTimeMs,
      workedTimeMs,
      pausedTimeMs,
      totalFaults: 0,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0',
    };
  } catch (err) {
    console.error(`Error building AC360 machine hourly total for machine ${machineSerial}:`, err);
    return null;
  }
}

/**
 * Build one operator-machine hourly total for a given hour.
 */
function buildOperatorMachineHourlyTotal({
  operatorId,
  operatorName,
  machineSerial,
  machineName,
  operatorSessions,
  queryStart,
  queryEnd,
}) {
  try {
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { ovSec, factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const totalTimeCredit = s.totalTimeCredit ?? 0;
      const totalCount = s.totalCount ?? (s.counts?.length ?? 0);
      const misfeedCount = s.misfeedCount ?? (s.misfeeds?.length ?? 0);

      workedTimeSec += ovSec;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const runtimeMs = workedTimeMs;
    const faultTimeMs = 0;
    const pausedTimeMs = 0;

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, {
      zone: SYSTEM_TIMEZONE,
    })
      .toUTC()
      .toJSDate();

    return {
      _id: `operator-machine-${operatorId}-${machineSerial}-${dateHourStr}`,
      entityType: 'operator-machine',
      operatorId,
      operatorName,
      machineSerial,
      machineName,
      date: dateStr,
      dateHourStr,
      hour,
      dateObj,
      runtimeMs,
      faultTimeMs,
      workedTimeMs,
      pausedTimeMs,
      totalFaults: 0,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0',
    };
  } catch (err) {
    console.error(
      `Error building AC360 operator hourly total for operator ${operatorId} on machine ${machineSerial}:`,
      err
    );
    return null;
  }
}

/**
 * Upsert hourly total records into the cache collection (idempotent $set).
 */
async function upsertHourlyTotalsToCache(db, hourlyTotals, collectionName = HOURLY_TOTALS_COLLECTION) {
  if (!hourlyTotals || hourlyTotals.length === 0) return { upsertedCount: 0, modifiedCount: 0 };

  const coll = db.collection(collectionName);
  const ops = hourlyTotals.map((total) => ({
    updateOne: {
      filter: { _id: total._id },
      update: { $set: total },
      upsert: true,
    },
  }));

  const result = await coll.bulkWrite(ops, { ordered: false });
  return { upsertedCount: result.upsertedCount, modifiedCount: result.modifiedCount };
}

/**
 * Build daily totals by querying and summing hourly totals from the hourly-totals collection.
 * This is an experimental approach to test performance vs building from sessions directly.
 *
 * @param {Object} db - MongoDB database instance
 * @param {number|string} machineSerial - Machine serial
 * @param {string} machineName - Display name (e.g. "SPF1")
 * @param {string} dateStr - Date string in 'yyyy-MM-dd' format
 */
async function buildDailyTotalsFromHourly(db, machineSerial, machineName, dateStr) {
  try {
    const hourlyTotalsColl = db.collection(HOURLY_TOTALS_COLLECTION);

    // Query all machine hourly totals for today
    const machineHourlyTotals = await hourlyTotalsColl
      .find({
        entityType: 'machine',
        machineSerial: machineSerial,
        date: dateStr,
      })
      .toArray();

    // Query all operator-machine hourly totals for today
    const operatorHourlyTotals = await hourlyTotalsColl
      .find({
        entityType: 'operator-machine',
        machineSerial: machineSerial,
        date: dateStr,
      })
      .toArray();

    const dailyTotals = [];
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    // Sum machine hourly totals into daily total
    if (machineHourlyTotals.length > 0) {
      const machineDailyTotal = {
        _id: `machine-${machineSerial}-${dateStr}`,
        entityType: 'machine',
        machineSerial,
        machineName,
        date: dateStr,
        dateObj,
        runtimeMs: 0,
        faultTimeMs: 0,
        workedTimeMs: 0,
        pausedTimeMs: 0,
        totalFaults: 0,
        totalCounts: 0,
        totalMisfeeds: 0,
        totalTimeCreditMs: 0,
        hourlyBreakdown: [],
        lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
        version: '1.0.0',
      };

      for (const hourly of machineHourlyTotals) {
        machineDailyTotal.runtimeMs += safe(hourly.runtimeMs);
        machineDailyTotal.faultTimeMs += safe(hourly.faultTimeMs);
        machineDailyTotal.workedTimeMs += safe(hourly.workedTimeMs);
        machineDailyTotal.pausedTimeMs += safe(hourly.pausedTimeMs);
        machineDailyTotal.totalFaults += safe(hourly.totalFaults);
        machineDailyTotal.totalCounts += safe(hourly.totalCounts);
        machineDailyTotal.totalMisfeeds += safe(hourly.totalMisfeeds);
        machineDailyTotal.totalTimeCreditMs += safe(hourly.totalTimeCreditMs);
        machineDailyTotal.hourlyBreakdown.push({
          hour: hourly.hour,
          runtimeMs: hourly.runtimeMs,
          totalCounts: hourly.totalCounts,
        });
      }

      // Sort hourly breakdown by hour
      machineDailyTotal.hourlyBreakdown.sort((a, b) => a.hour - b.hour);
      dailyTotals.push(machineDailyTotal);
    }

    // Group operator hourly totals by operatorId and sum into daily totals
    const operatorMap = new Map();
    for (const hourly of operatorHourlyTotals) {
      const opId = hourly.operatorId;
      if (!operatorMap.has(opId)) {
        operatorMap.set(opId, {
          _id: `operator-machine-${opId}-${machineSerial}-${dateStr}`,
          entityType: 'operator-machine',
          operatorId: opId,
          operatorName: hourly.operatorName,
          machineSerial,
          machineName,
          date: dateStr,
          dateObj,
          runtimeMs: 0,
          faultTimeMs: 0,
          workedTimeMs: 0,
          pausedTimeMs: 0,
          totalFaults: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          totalTimeCreditMs: 0,
          hourlyBreakdown: [],
          lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
          version: '1.0.0',
        });
      }

      const opDaily = operatorMap.get(opId);
      opDaily.runtimeMs += safe(hourly.runtimeMs);
      opDaily.faultTimeMs += safe(hourly.faultTimeMs);
      opDaily.workedTimeMs += safe(hourly.workedTimeMs);
      opDaily.pausedTimeMs += safe(hourly.pausedTimeMs);
      opDaily.totalFaults += safe(hourly.totalFaults);
      opDaily.totalCounts += safe(hourly.totalCounts);
      opDaily.totalMisfeeds += safe(hourly.totalMisfeeds);
      opDaily.totalTimeCreditMs += safe(hourly.totalTimeCreditMs);
      opDaily.hourlyBreakdown.push({
        hour: hourly.hour,
        runtimeMs: hourly.runtimeMs,
        totalCounts: hourly.totalCounts,
      });
    }

    for (const opDaily of operatorMap.values()) {
      // Sort hourly breakdown by hour
      opDaily.hourlyBreakdown.sort((a, b) => a.hour - b.hour);
      dailyTotals.push(opDaily);
    }

    return dailyTotals;
  } catch (err) {
    console.error(`Error building AC360 daily totals from hourly for machine ${machineSerial}:`, err);
    return [];
  }
}

/**
 * Upsert daily total records into the cache collection (idempotent $set).
 */
async function upsertDailyTotalsToCache(db, dailyTotals, collectionName = DAILY_TOTALS_COLLECTION) {
  if (!dailyTotals || dailyTotals.length === 0) return { upsertedCount: 0, modifiedCount: 0 };

  const coll = db.collection(collectionName);
  const ops = dailyTotals.map((total) => ({
    updateOne: {
      filter: { _id: total._id },
      update: { $set: total },
      upsert: true,
    },
  }));

  const result = await coll.bulkWrite(ops, { ordered: false });
  return { upsertedCount: result.upsertedCount, modifiedCount: result.modifiedCount };
}

/**
 * Load today's machine and operator sessions from DB, rebuild hourly totals,
 * then query hourly totals and sum into daily totals.
 * Call after any ac360/post update to machine-session or operator-session.
 *
 * @param {Object} db - MongoDB database instance
 * @param {number|string} machineSerial - Machine serial (e.g. machine.serial)
 * @param {string} machineName - Display name (e.g. "SPF1")
 */
async function recalculateAc360HourlyTotals(db, machineSerial, machineName) {
  try {
    const now = new Date();
    const todayStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf('day').toJSDate();
    const endTime = DateTime.fromJSDate(now, { zone: SYSTEM_TIMEZONE });
    let hourStart = DateTime.fromJSDate(todayStart, { zone: SYSTEM_TIMEZONE }).startOf('hour');
    const maxHours = Math.ceil((now - todayStart) / 36e5) + 1;
    let hourCount = 0;

    const machineSessionColl = db.collection('machine-session');
    const operatorSessionColl = db.collection('operator-session');

    const machineSessions = await machineSessionColl
      .find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: todayStart },
      })
      .sort({ 'timestamps.start': 1 })
      .toArray();

    const operatorSessionsRaw = await operatorSessionColl
      .find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: todayStart },
      })
      .sort({ 'timestamps.start': 1 })
      .toArray();

    const operatorSessionsByOperatorId = new Map();
    for (const s of operatorSessionsRaw) {
      const id = s.operator?.id;
      if (id != null && id !== -1) {
        if (!operatorSessionsByOperatorId.has(id)) operatorSessionsByOperatorId.set(id, []);
        operatorSessionsByOperatorId.get(id).push(s);
      }
    }

    const hourlyTotals = [];

    while (hourStart <= endTime && hourCount < maxHours) {
      const hourStartDate = hourStart.toJSDate();
      const hourEndDate = hourStart.plus({ hours: 1 }).toJSDate();
      const hourQueryEnd = hourEndDate > now ? now : hourEndDate;

      const machineTotal = buildMachineHourlyTotal({
        machineSerial,
        machineName,
        machineSessions,
        queryStart: hourStartDate,
        queryEnd: hourQueryEnd,
      });
      if (machineTotal) hourlyTotals.push(machineTotal);

      for (const [operatorId, sessions] of operatorSessionsByOperatorId.entries()) {
        const operatorName = sessions[0]?.operator?.name || `Operator ${operatorId}`;
        const opTotal = buildOperatorMachineHourlyTotal({
          operatorId,
          operatorName,
          machineSerial,
          machineName,
          operatorSessions: sessions,
          queryStart: hourStartDate,
          queryEnd: hourQueryEnd,
        });
        if (opTotal) hourlyTotals.push(opTotal);
      }

      hourStart = hourStart.plus({ hours: 1 });
      hourCount++;
    }

    if (hourlyTotals.length === 0) return { success: true, hourlyRecordsUpdated: 0, dailyRecordsUpdated: 0 };

    // Step 1: Upsert hourly totals
    const hourlyResult = await upsertHourlyTotalsToCache(db, hourlyTotals);

    // Step 2: Build daily totals by querying and summing hourly totals
    const dateStr = DateTime.now().setZone(SYSTEM_TIMEZONE).toFormat('yyyy-MM-dd');
    const dailyTotals = await buildDailyTotalsFromHourly(db, machineSerial, machineName, dateStr);

    // Step 3: Upsert daily totals
    const dailyResult = await upsertDailyTotalsToCache(db, dailyTotals);

    return {
      success: true,
      hourlyRecordsUpdated: hourlyResult.upsertedCount + hourlyResult.modifiedCount,
      dailyRecordsUpdated: dailyResult.upsertedCount + dailyResult.modifiedCount,
    };
  } catch (err) {
    console.error(`Error recalculating AC360 hourly/daily totals for machine ${machineSerial}:`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  overlap,
  safe,
  buildMachineHourlyTotal,
  buildOperatorMachineHourlyTotal,
  upsertHourlyTotalsToCache,
  buildDailyTotalsFromHourly,
  upsertDailyTotalsToCache,
  recalculateAc360HourlyTotals,
};
