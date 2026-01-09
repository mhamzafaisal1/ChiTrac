// routes/analytics/operator-details.js
const express = require("express");
const { DateTime, Interval } = require("luxon");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration, getCountCollectionName, getStateCollectionName } = require("../../utils/time");
const { fetchStatesForOperator, extractFaultCycles, groupStatesByOperatorAndSerial, getCompletedCyclesForOperator } = require("../../utils/state");
const { buildOperatorCyclePie } = require("../../utils/operatorFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const toHours = ms => ms / 3_600_000;

  const overlap = (sStart, sEnd, wStart, wEnd) => {
    if (!sStart) return { ovSec: 0, fullSec: 0, factor: 0 };
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const factor = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor, ovStart: os, ovEnd: oe };
  };

  const hourlyWindows = (start, end) => {
    const s = DateTime.fromJSDate(new Date(start)).startOf("hour");
    const e = DateTime.fromJSDate(new Date(end)).endOf("hour");
    return Interval.fromDateTimes(s, e)
      .splitBy({ hours: 1 })
      .map(iv => ({ start: iv.start.toJSDate(), end: iv.end.toJSDate() }));
  };

  const normalizeStdPPH = (std) => {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n; // PPM → PPH
  };

  // helper: build day buckets in a TZ and sum cycle overlap per day
  function buildDayBuckets(start, end, tz = "America/Chicago") {
    const s = DateTime.fromJSDate(new Date(start), { zone: tz }).startOf("day");
    const e = DateTime.fromJSDate(new Date(end),   { zone: tz }).endOf("day");
    return Interval.fromDateTimes(s, e).splitBy({ days: 1 }).map(iv => {
      const ds = iv.start;
      const de = iv.end;
      return {
        key: ds.toFormat("yyyy-LL-dd"),
        start: ds.toJSDate(),
        end: de.toJSDate()
      };
    });
  }

  // ---- Daily Efficiency (per day) from operator-sessions ----
  async function buildDailyEfficiencyFromOperatorSessions(
    db,
    operatorId,
    operatorName,
    start,
    end,
    serial = null,
    tz = "America/Chicago"
  ) {
    // enforce 7-day window like before
    const endDt = new Date(end);
    let startDt = new Date(start);
    if (endDt - startDt < 7 * 86400000) {
      startDt = new Date(endDt);
      startDt.setDate(endDt.getDate() - 6);
      startDt.setHours(0, 0, 0, 0);
    }

    const osColl = db.collection(config.operatorSessionCollectionName);
    const filter = {
      "operator.id": Number(operatorId),
      "timestamps.start": { $lt: endDt },
      $or: [
        { "timestamps.end": { $gt: startDt } },
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": null }
      ],
      ...(serial ? { "machine.id": Number(serial) } : {})
    };

    const sessions = await osColl.find(filter).project({
      _id: 0,
      timestamps: 1,
      workTime: 1,          // seconds
      runtime: 1,           // seconds (fallback)
      totalTimeCredit: 1    // seconds of earned credit
    }).toArray();

    // TZ-aware day buckets
    const buckets = buildDayBuckets(startDt, endDt, tz);
    const totals = Object.fromEntries(buckets.map(b => [b.key, { workSec: 0, creditSec: 0 }]));

    for (const s of sessions) {
      const ss = new Date(s.timestamps?.start);
      const se = new Date(s.timestamps?.end || endDt);
      const fullSec = Math.max(0, (se - ss) / 1000);
      if (fullSec <= 0) continue;

      const baseWorkSec =
        typeof s.workTime === "number" ? s.workTime :
        typeof s.runtime === "number"  ? s.runtime  : 0;

      const creditSec = typeof s.totalTimeCredit === "number" ? s.totalTimeCredit : 0;

      for (const b of buckets) {
        const os = ss > b.start ? ss : b.start;
        const oe = se < b.end   ? se : b.end;
        const ovSec = Math.max(0, (oe - os) / 1000);
        if (ovSec <= 0) continue;

        const frac = ovSec / fullSec; // allocate session metrics proportionally
        totals[b.key].workSec   += baseWorkSec * frac;
        totals[b.key].creditSec += creditSec   * frac;
      }
    }

    const data = buckets.map(b => {
      const { workSec, creditSec } = totals[b.key];
      const eff = workSec > 0 ? (creditSec / workSec) * 100 : 0;
      return { date: b.key, efficiency: Math.round(eff * 100) / 100 };
    }).filter(r => true); // keep ordering

    return {
      operator: { id: Number(operatorId), name: operatorName },
      timeRange: { start: startDt.toISOString(), end: endDt.toISOString(), totalDays: data.length },
      data
    };
  }

  // -----------------------------------
  // Fault History Builder
  // -----------------------------------
  function buildOptimizedOperatorFaultHistorySingle(operatorId, operatorName, machineSerial, machineName, states, start, end) {
    const { faultCycles, faultSummaries } = extractFaultCycles(states, new Date(start), new Date(end));
  
    const enrichedFaultCycles = faultCycles.map(cycle => ({
      ...cycle,
      machineName,
      machineSerial,
      operatorName,
      operatorId
    }));
  
    const summaryList = faultSummaries.map(summary => {
      const totalSeconds = Math.floor(summary.totalDuration / 1000);
      return {
        ...summary,
        formatted: {
          hours: Math.floor(totalSeconds / 3600),
          minutes: Math.floor((totalSeconds % 3600) / 60),
          seconds: totalSeconds % 60
        }
      };
    });
  
    return {
      faultCycles: enrichedFaultCycles,
      faultSummaries: summaryList
    };
  }

  // -----------------------------------
  // Item Summary (via item-sessions, operator-focused)
  // -----------------------------------
  async function buildItemSummaryFromItemSessions(db, operatorId, start, end, serial = null) {
    const coll = db.collection(config.itemSessionCollectionName);
    const wStart = new Date(start);
    const wEnd = new Date(end);

    // Build query filter
    const filter = {
      "operators.id": Number(operatorId),
      "timestamps.start": { $lt: wEnd },
      $or: [
        { "timestamps.end": { $gt: wStart } },
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": null }
      ]
    };

    // Optionally scope to specific machine
    if (serial) {
      filter["machine.serial"] = Number(serial);
    }

    const sessions = await coll.find(filter)
      .project({
        _id: 0,
        item: 1, items: 1,
        timestamps: 1,
        workTime: 1, runtime: 1, activeStations: 1,
        totalCount: 1, counts: 1,
        operators: 1,
        "machine.serial": 1,               // <-- add
        "machine.name": 1                  // <-- add
      })
      .toArray();

    if (!sessions.length) {
      return {
        sessions: [],
        operatorSummary: {
          totalCount: 0,
          workedTimeMs: 0,
          workedTimeFormatted: formatDuration(0),
          pph: 0,
          proratedStandard: 0,
          efficiency: 0,
          itemSummaries: {}
        }
      };
    }

    const itemAgg = new Map(); // id -> { name, standard, count, workedMs }
    let totalValid = 0;
    let totalWorkedMs = 0;
    // Aggregate sessions by machine + item combination
    const sessionAgg = new Map(); // key: `${machineSerial}_${itemId}` -> { machine, itemId, name, standard, countTotal, workedTimeMs, earliestStart, latestEnd }

    for (const s of sessions) {
      const it = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
      if (!it || it.id == null) continue;

      const { ovSec, fullSec, factor, ovStart, ovEnd } =
        overlap(s.timestamps?.start, s.timestamps?.end, wStart, wEnd);

      if (ovSec === 0 || fullSec === 0) continue;

      const stations = typeof s.activeStations === "number" ? s.activeStations : 0;
      const baseWorkSec = typeof s.workTime === "number"
        ? s.workTime
        : typeof s.runtime === "number" ? s.runtime * Math.max(1, stations) : 0;

      const workedSec = baseWorkSec * factor;
      const workedMs = Math.round(workedSec * 1000);

      // Count attribution logic:
      // If session has end timestamp AND embedded counts, filter counts by operator/item/time
      // Otherwise, prorate by operator's work-time share using totalCount
      let countInWin = 0;
      const hasEndTimestamp = s.timestamps?.end != null;

      if (hasEndTimestamp && Array.isArray(s.counts) && s.counts.length && s.counts.length <= 50000) {
        // Session is closed - can reliably filter embedded counts by timestamp
        countInWin = s.counts.reduce((acc, c) => {
          const ts = new Date(c.timestamps?.create || c.timestamp);
          const sameItem = !c.item?.id || c.item.id === it.id;
          const sameOperator = !c.operator?.id || c.operator.id === Number(operatorId);
          const inWindow = ts >= ovStart && ts <= ovEnd;
          return acc + (sameItem && sameOperator && inWindow ? 1 : 0);
        }, 0);
      } else if (typeof s.totalCount === "number") {
        // Session is open (no end timestamp) OR no embedded counts - prorate by time factor
        countInWin = Math.round(s.totalCount * factor);
      }

      // Create aggregation key: machine serial + item id
      const machineSerial = s.machine?.serial ?? null;
      const aggKey = `${machineSerial}_${it.id}`;

      // Get or create aggregated session record
      let aggRec = sessionAgg.get(aggKey);
      if (!aggRec) {
        aggRec = {
          machine: {
            serial: machineSerial,
            name: s.machine?.name ?? null
          },
          itemId: it.id,
          name: it.name || "Unknown",
          standard: Number(it.standard) || 0,
          countTotal: 0,
          workedTimeMs: 0,
          earliestStart: ovStart,
          latestEnd: ovEnd
        };
        sessionAgg.set(aggKey, aggRec);
      }

      // Aggregate values
      aggRec.countTotal += countInWin;
      aggRec.workedTimeMs += workedMs;
      if (ovStart < aggRec.earliestStart) aggRec.earliestStart = ovStart;
      if (ovEnd > aggRec.latestEnd) aggRec.latestEnd = ovEnd;
      if (!aggRec.standard && Number(it.standard)) aggRec.standard = Number(it.standard);

      const rec = itemAgg.get(it.id) || { name: it.name || "Unknown", standard: Number(it.standard) || 0, count: 0, workedMs: 0 };
      rec.count += countInWin;
      rec.workedMs += workedMs;
      if (!rec.standard && Number(it.standard)) rec.standard = Number(it.standard);
      itemAgg.set(it.id, rec);

      totalValid += countInWin;
      totalWorkedMs += workedMs;
    }

    // Convert aggregated sessions to sessionRows format
    const sessionRows = [];
    for (const aggRec of sessionAgg.values()) {
      const hours = toHours(aggRec.workedTimeMs);
      const stdPPH = normalizeStdPPH(aggRec.standard);
      const pph = hours > 0 ? aggRec.countTotal / hours : 0;
      const eff = stdPPH > 0 ? pph / stdPPH : 0;

      sessionRows.push({
        start: aggRec.earliestStart.toISOString(),
        end: aggRec.latestEnd.toISOString(),
        workedTimeMs: aggRec.workedTimeMs,
        workedTimeFormatted: formatDuration(aggRec.workedTimeMs),
        machine: aggRec.machine,
        items: [{
          itemId: aggRec.itemId,
          name: aggRec.name,
          countTotal: aggRec.countTotal,
          standard: aggRec.standard,
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100
        }]
      });
    }

    const totalHours = toHours(totalWorkedMs);
    const itemSummaries = {};
    let proratedStdPPH = 0;

    for (const [id, r] of itemAgg.entries()) {
      const stdPPH = normalizeStdPPH(r.standard);
      const hours = toHours(r.workedMs);
      const pph = hours > 0 ? r.count / hours : 0;
      const eff = stdPPH > 0 ? pph / stdPPH : 0;
      const weight = totalValid > 0 ? r.count / totalValid : 0;
      proratedStdPPH += weight * stdPPH;

      itemSummaries[id] = {
        name: r.name,
        standard: r.standard,
        countTotal: r.count,
        workedTimeFormatted: formatDuration(r.workedMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(eff * 10000) / 100
      };
    }

    const operatorPPH = totalHours > 0 ? totalValid / totalHours : 0;
    const operatorEff = proratedStdPPH > 0 ? (operatorPPH / proratedStdPPH) : 0;

    return {
      sessions: sessionRows,
      operatorSummary: {
        totalCount: totalValid,
        workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(operatorPPH * 100) / 100,
        proratedStandard: Math.round(proratedStdPPH * 100) / 100,
        efficiency: Math.round(operatorEff * 10000) / 100,
        itemSummaries
      }
    };
  }

  // -------------------------------------------------------
  // Daily Efficiency by Hour (operator-sessions based)
  // -------------------------------------------------------
  async function buildDailyEfficiencyByHour(db, operatorId, start, end, serial = null) {
    const osColl = db.collection(config.operatorSessionCollectionName);
    const hours = hourlyWindows(start, end);
    
    // Single query instead of one per hour - major performance improvement
    const filter = {
      "operator.id": Number(operatorId),
      "timestamps.start": { $lt: new Date(end) },
      $or: [
        { "timestamps.end": { $gt: new Date(start) } },
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": null }
      ],
      ...(serial ? { "machine.serial": Number(serial) } : {})
    };

    const allSessions = await osColl.find(filter)
      .project({
        _id: 0,
        timestamps: 1,
        workTime: 1, runtime: 1,
        totalTimeCredit: 1,
        totalCount: 1, misfeedCount: 1
      })
      .toArray();

    // Process sessions by hour in-memory
    return hours.map(({ start: hStart, end: hEnd }) => {
      // Aggregate metrics for this hour
      let workSec = 0, timeCreditSec = 0, valid = 0, mis = 0;

      for (const s of allSessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, hStart, hEnd);
        if (factor <= 0) continue;

        const baseWorkSec = typeof s.workTime === "number" 
          ? s.workTime 
          : typeof s.runtime === "number" ? s.runtime : 0;
        
        workSec += safe(baseWorkSec) * factor;
        timeCreditSec += safe(s.totalTimeCredit) * factor;
        valid += safe(s.totalCount) * factor;
        mis += safe(s.misfeedCount) * factor;
      }

      const workedMs = Math.round(workSec * 1000);
      const efficiencyPct = workSec > 0 ? (timeCreditSec / workSec) * 100 : 0;
      const throughputPct = (valid + mis) > 0 ? (valid / (valid + mis)) * 100 : 0;

      return {
        hourStart: DateTime.fromJSDate(hStart).toISO(),
        hourEnd: DateTime.fromJSDate(hEnd).toISO(),
        metrics: {
          workedTimeMs: workedMs,
          validCount: Math.round(valid),
          misfeedCount: Math.round(mis),
          efficiencyPct: +(efficiencyPct).toFixed(2),
          throughputPct: +(throughputPct).toFixed(2)
        }
      };
    });
  }

  // Build operator cycle pie chart from cache (operator-machine records)
  async function buildOperatorCyclePieFromCache(db, operatorId, start, end, serial = null) {
    try {
      const wStart = new Date(start);
      const wEnd = new Date(end);
      const windowMs = wEnd - wStart;
      
      // Get all date strings in the range (in America/Chicago timezone)
      const startDt = DateTime.fromJSDate(wStart, { zone: 'America/Chicago' });
      const endDt = DateTime.fromJSDate(wEnd, { zone: 'America/Chicago' });
      const dateStrings = [];
      let currentDay = startDt.startOf('day');
      const endDay = endDt.startOf('day');
      
      while (currentDay <= endDay) {
        dateStrings.push(currentDay.toFormat('yyyy-MM-dd'));
        currentDay = currentDay.plus({ days: 1 });
      }
      
      // Query operator-machine cache records
      const dateObjs = dateStrings.map(str => {
        const dt = DateTime.fromISO(str, { zone: 'America/Chicago' });
        return dt.toUTC().startOf('day').toJSDate();
      });
      
      const cacheQuery = {
        $or: [
          { dateObj: { $in: dateObjs } },
          { date: { $in: dateStrings } }
        ],
        entityType: 'operator-machine',
        operatorId: Number(operatorId)
      };
      
      if (serial) {
        cacheQuery.machineSerial = Number(serial);
      }
      
      const cacheRecords = await db.collection('totals-daily').find(cacheQuery).toArray();
      
      // Sum runtimeMs across all records (operator working time)
      let totalRuntimeMs = 0;
      for (const record of cacheRecords) {
        totalRuntimeMs += safe(record.runtimeMs || record.workedTimeMs || 0);
      }
      
      // Calculate paused time (not running = window - runtime)
      const pausedMs = Math.max(0, windowMs - totalRuntimeMs);
      
      // For operators, faulted time is 0 (they don't track machine faults)
      const faultMs = 0;
      
      // Calculate percentages
      const total = totalRuntimeMs + pausedMs + faultMs || 1; // Avoid division by zero
      const runTimePct = Math.round((totalRuntimeMs / total) * 100);
      const pauseTimePct = Math.round((pausedMs / total) * 100);
      const faultTimePct = Math.round((faultMs / total) * 100);
      
      return [
        {
          name: "Running",
          value: runTimePct
        },
        {
          name: "Paused",
          value: pauseTimePct
        },
        {
          name: "Faulted",
          value: faultTimePct
        }
      ];
    } catch (error) {
      logger.error('Error in buildOperatorCyclePieFromCache:', error);
      // Return empty pie chart on error
      return [
        { name: "Running", value: 0 },
        { name: "Paused", value: 0 },
        { name: "Faulted", value: 0 }
      ];
    }
  }

  // Build daily efficiency from cache (operator-machine daily records)
  async function buildDailyEfficiencyFromCache(db, operatorId, operatorName, start, end, serial = null, tz = "America/Chicago") {
    try {
      // Enforce 7-day window like the original function
      const endDt = new Date(end);
      let startDt = new Date(start);
      if (endDt - startDt < 7 * 86400000) {
        startDt = new Date(endDt);
        startDt.setDate(endDt.getDate() - 6);
        startDt.setHours(0, 0, 0, 0);
      }

      // Build day buckets for the 7-day window
      const buckets = buildDayBuckets(startDt, endDt, tz);
      // Convert bucket keys to "yyyy-MM-dd" format for cache query (cache uses MM, not LL)
      const dateStringsForCache = buckets.map(b => {
        const dt = DateTime.fromISO(b.key, { zone: tz });
        return dt.toFormat('yyyy-MM-dd');
      });
      const dateStrings = buckets.map(b => b.key); // Keep "yyyy-LL-dd" for response

      // Query operator-machine cache records for these dates
      const dateObjs = dateStringsForCache.map(str => {
        const dt = DateTime.fromISO(str, { zone: tz });
        return dt.toUTC().startOf('day').toJSDate();
      });

      const cacheQuery = {
        $or: [
          { dateObj: { $in: dateObjs } },
          { date: { $in: dateStringsForCache } }
        ],
        entityType: 'operator-machine',
        operatorId: Number(operatorId)
      };

      if (serial) {
        cacheQuery.machineSerial = Number(serial);
      }

      const cacheRecords = await db.collection('totals-daily').find(cacheQuery).toArray();

      // Aggregate by date: sum totalTimeCreditMs and workedTimeMs
      const dailyTotals = new Map();
      for (const bucket of buckets) {
        dailyTotals.set(bucket.key, { totalTimeCreditMs: 0, workedTimeMs: 0 });
      }

      // Create a map from cache date format (yyyy-MM-dd) to bucket key (yyyy-LL-dd)
      const cacheDateToBucketKey = new Map();
      buckets.forEach((bucket, idx) => {
        cacheDateToBucketKey.set(dateStringsForCache[idx], bucket.key);
      });

      for (const record of cacheRecords) {
        // Cache stores dates in "yyyy-MM-dd" format
        let recordDate = record.date;
        if (!recordDate && record.dateObj) {
          recordDate = DateTime.fromJSDate(record.dateObj, { zone: tz }).toFormat('yyyy-MM-dd');
        }
        if (!recordDate) continue;

        // Convert cache date to bucket key format
        const bucketKey = cacheDateToBucketKey.get(recordDate);
        if (!bucketKey || !dailyTotals.has(bucketKey)) continue;

        const totals = dailyTotals.get(bucketKey);
        totals.totalTimeCreditMs += safe(record.totalTimeCreditMs || 0);
        totals.workedTimeMs += safe(record.workedTimeMs || record.runtimeMs || 0);
      }

      // Calculate efficiency for each day
      const data = buckets.map(b => {
        const { totalTimeCreditMs, workedTimeMs } = dailyTotals.get(b.key);
        const creditSec = totalTimeCreditMs / 1000;
        const workSec = workedTimeMs / 1000;
        const eff = workSec > 0 ? (creditSec / workSec) * 100 : 0;
        return { date: b.key, efficiency: Math.round(eff * 100) / 100 };
      });

      return {
        operator: { id: Number(operatorId), name: operatorName },
        timeRange: { start: startDt.toISOString(), end: endDt.toISOString(), totalDays: data.length },
        data
      };
    } catch (error) {
      logger.error('Error in buildDailyEfficiencyFromCache:', error);
      // Return empty structure on error
      const endDt = new Date(end);
      let startDt = new Date(start);
      if (endDt - startDt < 7 * 86400000) {
        startDt = new Date(endDt);
        startDt.setDate(endDt.getDate() - 6);
        startDt.setHours(0, 0, 0, 0);
      }
      const buckets = buildDayBuckets(startDt, endDt, tz);
      return {
        operator: { id: Number(operatorId), name: operatorName },
        timeRange: { start: startDt.toISOString(), end: endDt.toISOString(), totalDays: buckets.length },
        data: buckets.map(b => ({ date: b.key, efficiency: 0 }))
      };
    }
  }

  // Build item hourly stacked chart from cache (operator-item hourly records)
  async function buildItemHourlyStackFromCacheForOperator(db, operatorId, start, end, serial = null) {
    try {
      const wStart = new Date(start);
      const wEnd = new Date(end);
      
      // OPTIMIZATION: Use dateObj range query instead of $in with date strings
      // This is much faster with proper indexes and avoids large $in arrays
      const startDt = DateTime.fromJSDate(wStart, { zone: 'America/Chicago' }).startOf('day');
      const endDt = DateTime.fromJSDate(wEnd, { zone: 'America/Chicago' }).endOf('day');
      
      // Build aggregation pipeline for hourly-totals
      // OPTIMIZATION: Use dateObj range query instead of $in with many date strings
      // This is much faster, especially with proper indexes
      const matchStage = {
        entityType: 'operator-item',
        operatorId: Number(operatorId)
      };
      
      // Use dateObj for range query if available (much faster than $in with many dates)
      // Fallback to date string range for backward compatibility
      if (startDt && endDt) {
        const startDateObj = startDt.toJSDate();
        const endDateObj = endDt.toJSDate();
        // Try dateObj first (preferred), fallback to date string
        matchStage.$or = [
          { dateObj: { $gte: startDateObj, $lte: endDateObj } },
          { 
            date: { 
              $gte: startDt.toFormat('yyyy-MM-dd'), 
              $lte: endDt.toFormat('yyyy-MM-dd') 
            },
            dateObj: { $exists: false } // Only use date if dateObj doesn't exist
          }
        ];
      }
      
      if (serial) {
        matchStage.machineSerial = Number(serial);
      }
      
      
      const pipeline = [
        {
          $match: matchStage
        },
        // OPTIMIZATION: Project only needed fields to reduce memory usage
        {
          $project: {
            hour: 1,
            itemName: 1,
            totalCounts: 1
          }
        },
        {
          $group: {
            _id: { hour: "$hour", itemName: "$itemName" },
            count: { $sum: "$totalCounts" }
          }
        },
        // OPTIMIZATION: Sort before final group to ensure consistent ordering
        {
          $sort: { "_id.itemName": 1, "_id.hour": 1 }
        },
        {
          $group: {
            _id: "$_id.itemName",
            hourlyCounts: {
              $push: {
                hour: "$_id.hour",
                count: "$count"
              }
            }
          }
        },
        {
          $sort: { "_id": 1 }
        }
      ];
      
      const collection = db.collection('hourly-totals');
      const results = await collection.aggregate(pipeline, { 
        allowDiskUse: true
      }).toArray();
      
      // Build hourly breakdown map: itemName -> [counts for hours 0-23]
      const hourlyBreakdownMap = {};
      const hourSet = new Set();
      
      for (const result of results) {
        const itemName = result._id || "Unknown";
        hourlyBreakdownMap[itemName] = Array(24).fill(0);
        
        for (const entry of result.hourlyCounts) {
          const hour = entry.hour;
          if (hour >= 0 && hour <= 23) {
            hourSet.add(hour);
            hourlyBreakdownMap[itemName][hour] = entry.count;
          }
        }
      }
      
      // If no data, return empty structure
      if (Object.keys(hourlyBreakdownMap).length === 0) {
        return {
          title: "Operator Counts by item",
          data: {
            hours: Array.from({ length: 24 }, (_, i) => i),
            operators: {}
          }
        };
      }
      
      return {
        title: "Operator Counts by item",
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          operators: hourlyBreakdownMap
        }
      };
    } catch (error) {
      logger.error('Error in buildItemHourlyStackFromCacheForOperator:', error);
      // Return empty structure on error
      return {
        title: "Operator Counts by item",
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          operators: {}
        }
      };
    }
  }

  // Build item summary from cache (operator-item records)
  async function buildItemSummaryFromCache(db, operatorId, start, end, serial = null) {
    const wStart = new Date(start);
    const wEnd = new Date(end);
    
    // Get all date strings in the range (in America/Chicago timezone)
    const startDt = DateTime.fromJSDate(wStart, { zone: 'America/Chicago' });
    const endDt = DateTime.fromJSDate(wEnd, { zone: 'America/Chicago' });
    const dateStrings = [];
    let currentDay = startDt.startOf('day');
    const endDay = endDt.startOf('day');
    
    while (currentDay <= endDay) {
      dateStrings.push(currentDay.toFormat('yyyy-MM-dd'));
      currentDay = currentDay.plus({ days: 1 });
    }
    
    const cacheCollection = db.collection('totals-daily');
    const itemAgg = new Map(); // id -> { name, standard, count, workedMs }
    let totalValid = 0;
    let totalWorkedMs = 0;
    const sessionAgg = new Map(); // key: `${machineSerial}_${itemId}` -> aggregated record
    
    // Query cache for all dates in range
    const dateObjs = dateStrings.map(str => {
      const dt = DateTime.fromISO(str, { zone: 'America/Chicago' });
      return dt.toUTC().startOf('day').toJSDate();
    });
    
    const cacheQuery = {
      $or: [
        { dateObj: { $in: dateObjs } },
        { date: { $in: dateStrings } }
      ],
      entityType: 'operator-item',
      operatorId: Number(operatorId)
    };
    
    if (serial) {
      cacheQuery.machineSerial = Number(serial);
    }
    
    const cacheRecords = await cacheCollection.find(cacheQuery).toArray();
    
    // Aggregate cache records by machine-item combination
    for (const record of cacheRecords) {
      const itemId = record.itemId;
      const machineSerial = record.machineSerial ?? null;
      const aggKey = `${machineSerial}_${itemId}`;
      
      // Get or create aggregated session record
      let aggRec = sessionAgg.get(aggKey);
      if (!aggRec) {
        aggRec = {
          machine: {
            serial: machineSerial,
            name: record.machineName ?? null
          },
          itemId: itemId,
          name: record.itemName || "Unknown",
          standard: Number(record.itemStandard) || 0,
          countTotal: 0,
          workedTimeMs: 0,
          earliestStart: wEnd,
          latestEnd: wStart
        };
        sessionAgg.set(aggKey, aggRec);
      }
      
      // Aggregate values from cache
      // Note: operator-item cache doesn't have workedTimeMs, so we'll use totalTimeCreditMs as proxy
      const countInWin = record.totalCounts || 0;
      const workedMs = record.totalTimeCreditMs || 0; // Using time credit as proxy
      
      aggRec.countTotal += countInWin;
      aggRec.workedTimeMs += workedMs;
      
      // Update date range
      const recordDate = record.date ? new Date(record.date + 'T00:00:00.000Z') : wStart;
      if (recordDate < aggRec.earliestStart) aggRec.earliestStart = recordDate;
      if (recordDate > aggRec.latestEnd) aggRec.latestEnd = recordDate;
      if (!aggRec.standard && Number(record.itemStandard)) aggRec.standard = Number(record.itemStandard);
      
      // Aggregate by item (across machines)
      const rec = itemAgg.get(itemId) || { 
        name: record.itemName || "Unknown", 
        standard: Number(record.itemStandard) || 0, 
        count: 0, 
        workedMs: 0 
      };
      rec.count += countInWin;
      rec.workedMs += workedMs;
      if (!rec.standard && Number(record.itemStandard)) rec.standard = Number(record.itemStandard);
      itemAgg.set(itemId, rec);
      
      totalValid += countInWin;
      totalWorkedMs += workedMs;
    }
    
    // Convert aggregated sessions to sessionRows format
    const sessionRows = [];
    for (const aggRec of sessionAgg.values()) {
      const hours = toHours(aggRec.workedTimeMs);
      const stdPPH = normalizeStdPPH(aggRec.standard);
      const pph = hours > 0 ? aggRec.countTotal / hours : 0;
      const eff = stdPPH > 0 ? pph / stdPPH : 0;
      
      sessionRows.push({
        start: aggRec.earliestStart.toISOString(),
        end: aggRec.latestEnd.toISOString(),
        workedTimeMs: aggRec.workedTimeMs,
        workedTimeFormatted: formatDuration(aggRec.workedTimeMs),
        machine: aggRec.machine,
        items: [{
          itemId: aggRec.itemId,
          name: aggRec.name,
          countTotal: aggRec.countTotal,
          standard: aggRec.standard,
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100
        }]
      });
    }
    
    const totalHours = toHours(totalWorkedMs);
    const itemSummaries = {};
    let proratedStdPPH = 0;
    
    for (const [id, r] of itemAgg.entries()) {
      const stdPPH = normalizeStdPPH(r.standard);
      const hours = toHours(r.workedMs);
      const pph = hours > 0 ? r.count / hours : 0;
      const eff = stdPPH > 0 ? pph / stdPPH : 0;
      const weight = totalValid > 0 ? r.count / totalValid : 0;
      proratedStdPPH += weight * stdPPH;
      
      itemSummaries[id] = {
        name: r.name,
        standard: r.standard,
        countTotal: r.count,
        workedTimeFormatted: formatDuration(r.workedMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(eff * 10000) / 100
      };
    }
    
    const operatorPPH = totalHours > 0 ? totalValid / totalHours : 0;
    const operatorEff = proratedStdPPH > 0 ? (operatorPPH / proratedStdPPH) : 0;
    
    return {
      sessions: sessionRows,
      operatorSummary: {
        totalCount: totalValid,
        workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(operatorPPH * 100) / 100,
        proratedStandard: Math.round(proratedStdPPH * 100) / 100,
        efficiency: Math.round(operatorEff * 10000) / 100,
        itemSummaries
      }
    };
  }

  // --------------------------
  // /operator-details route
  // --------------------------
  router.get("/analytics/operator-details", async (req, res) => {
    try {
      const { start, end, operatorId, serial, tz = "America/Chicago" } = req.query;
      
      // Validate required parameters
      if (!start || !end || !operatorId) {
        return res.status(400).json({ 
          error: "start, end, and operatorId are required" 
        });
      }

      const opId = Number(operatorId);
      if (isNaN(opId)) {
        return res.status(400).json({ 
          error: "operatorId must be a valid number" 
        });
      }

      // Parallelize initial queries
      const [latestResult, machineInfoResult] = await Promise.all([
        db.collection(config.operatorSessionCollectionName)
          .find({ "operator.id": opId })
          .project({ _id: 0, operator: 1 })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray(),
        serial ? db.collection(config.machineSessionCollectionName)
          .find({ "machine.id": Number(serial) })
          .project({ _id: 0, "machine.name": 1 })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray() : Promise.resolve([])
      ]);
      
      // Normalize operator name - handle both object {first, surname} and string formats
      const rawOperatorName = latestResult[0]?.operator?.name || `Operator ${opId}`;
      const operatorName = typeof rawOperatorName === 'object' && rawOperatorName !== null
        ? `${rawOperatorName.first || ''} ${rawOperatorName.surname || ''}`.trim() || `Operator ${opId}`
        : rawOperatorName;

      // Get machine info if serial is provided
      let machineSerial = null;
      let machineName = null;
      if (serial) {
        machineSerial = Number(serial);
        machineName = machineInfoResult[0]?.machine?.name || `Machine ${serial}`;
      }

      // Optimized state fetching - filter by machine in query if serial provided
      const stateFetchPromise = serial
        ? (async () => {
            // Fetch states with machine filter directly in query
            const stateCollection = getStateCollectionName(new Date(start));
            const collectionExists = await db.listCollections({ name: stateCollection }).hasNext();
            const collection = collectionExists ? stateCollection : 'state';
            
            const query = {
              "timestamps.create": {
                $gte: new Date(start),
                $lte: new Date(end)
              },
              'machine.id': serial, // Filter by machine in query
              'operators.id': opId
            };
            
            const states = await db.collection(collection)
              .find(query)
              .sort({ "timestamps.create": 1 })
              .project({
                _id: 0,
                "timestamps.create": 1,
                timestamp: 1,
                'machine.id': 1,
                'machine.serial': 1,
                'machine.name': 1,
                'program.mode': 1,
                'status.code': 1,
                'status.name': 1,
                '_tickerDoc.status': 1,
                operators: 1
              })
              .toArray();
            
            // Normalize states (same as fetchStatesForOperator)
            return states.map(state => {
              if (!state.timestamp && state.timestamps?.create) {
                state.timestamp = state.timestamps.create;
              }
              if (!state.machine?.serial && state.machine?.id) {
                state.machine = state.machine || {};
                state.machine.serial = state.machine.id;
              }
              if (!state.status && state._tickerDoc?.status) {
                state.status = state._tickerDoc.status;
              }
              return state;
            });
          })()
        : fetchStatesForOperator(db, opId, new Date(start), new Date(end));

      // Parallelize all data fetching operations
      const [
        rawStates,
        itemSummary,
        dailyEfficiencyByHour,
        counts,
        dailyEfficiency
      ] = await Promise.all([
        stateFetchPromise,
        buildItemSummaryFromItemSessions(db, opId, start, end, serial),
        buildDailyEfficiencyByHour(db, opId, start, end, serial),
        (async () => {
          const countCollection = getCountCollectionName(start);
          const countQuery = {
            "operator.id": opId,
            "timestamps.create": {
              $gte: new Date(start),
              $lt: new Date(end)
            },
            misfeed: { $ne: true }, // valid counts only
            ...(serial ? { "machine.id": Number(serial) } : {})
          };
          return await db
            .collection(countCollection)
            .find(countQuery)
            .project({
              _id: 0,
              "timestamps.create": 1,
              "item.id": 1,
              "item.name": 1
            })
            .toArray();
        })(),
        buildDailyEfficiencyFromOperatorSessions(
          db, opId, operatorName, start, end, serial, tz
        )
      ]);

      // States are already filtered by machine if serial was provided
      let states = rawStates;

      // Ensure states have proper status codes for cycle extraction
      states = states.map(state => {
        // Ensure status is properly set
        if (!state.status && state._tickerDoc?.status) {
          state.status = state._tickerDoc.status;
        }
        // Ensure status.code exists
        if (!state.status?.code && state._tickerDoc?.status?.code !== undefined) {
          state.status = state.status || {};
          state.status.code = state._tickerDoc.status.code;
        }
        // Fallback: if no status code, default to 0 (paused)
        if (!state.status?.code && state.status?.code !== 0) {
          state.status = state.status || {};
          state.status.code = 0;
        }
        return state;
      });

      // Build hourly breakdown map
      const hourlyBreakdownMap = {};
      for (const c of counts) {
        const hour = new Date(c.timestamps?.create).getHours();
        const itemName = c.item?.name || "Unknown";
        if (!hourlyBreakdownMap[itemName]) {
          hourlyBreakdownMap[itemName] = Array(24).fill(0);
        }
        hourlyBreakdownMap[itemName][hour] += 1;
      }

      const countByItem = {
        title: "Operator Counts by item",
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          operators: hourlyBreakdownMap, // Changed to match operator-info format
        },
      };

      // Build cycle pie chart data
      const cyclePie = buildOperatorCyclePie(states, start, end);

      // Build fault history
      const faultHistory = buildOptimizedOperatorFaultHistorySingle(
        opId,
        operatorName,
        machineSerial,
        machineName,
        states,
        start,
        end
      );

      // Transform itemSummary to match operator-info format
      const transformedItemSummary = itemSummary.sessions.flatMap(session => {
        if (!Array.isArray(session.items) || !session.items.length) return [];
        const mSerial = session.machine?.serial ?? "Unknown";
        const mName   = session.machine?.name   ?? "Unknown";
        return session.items.map(item => ({
          operatorName: operatorName,
          machineSerial: mSerial,                // <-- use session machine
          machineName: mName,                    // <-- use session machine
          itemName: item.name || "Unknown",
          count: item.countTotal || 0,
          misfeed: 0,
          standard: item.standard || 0,
          valid: item.countTotal || 0,
          pph: item.pph || 0,
          efficiency: item.efficiency || 0,
          workedTimeFormatted: session.workedTimeFormatted || formatDuration(0)
        }));
      });

      return res.json({
        itemSummary: transformedItemSummary, // Match operator-info format exactly
        countByItem,                         // hourly item breakdown
        cyclePie,                            // cycle pie chart data
        faultHistory,                        // fault history data
        dailyEfficiency                      // daily efficiency with timeRange
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator details" });
    }
  });

  // --------------------------
  // /operator-details-cached route
  // --------------------------
  router.get("/analytics/operator-details-cached", async (req, res) => {
    try {
      const { start, end, operatorId, serial, tz = "America/Chicago" } = req.query;
      
      // Validate required parameters
      if (!start || !end || !operatorId) {
        return res.status(400).json({ 
          error: "start, end, and operatorId are required" 
        });
      }

      const opId = Number(operatorId);
      if (isNaN(opId)) {
        return res.status(400).json({ 
          error: "operatorId must be a valid number" 
        });
      }

      // Parallelize initial queries
      const [latestResult, machineInfoResult] = await Promise.all([
        db.collection(config.operatorSessionCollectionName)
          .find({ "operator.id": opId })
          .project({ _id: 0, operator: 1 })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray(),
        serial ? db.collection(config.machineSessionCollectionName)
          .find({ "machine.id": Number(serial) })
          .project({ _id: 0, "machine.name": 1 })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray() : Promise.resolve([])
      ]);
      
      // Normalize operator name - handle both object {first, surname} and string formats
      const rawOperatorName = latestResult[0]?.operator?.name || `Operator ${opId}`;
      const operatorName = typeof rawOperatorName === 'object' && rawOperatorName !== null
        ? `${rawOperatorName.first || ''} ${rawOperatorName.surname || ''}`.trim() || `Operator ${opId}`
        : rawOperatorName;

      // Get machine info if serial is provided
      let machineSerial = null;
      let machineName = null;
      if (serial) {
        machineSerial = Number(serial);
        machineName = machineInfoResult[0]?.machine?.name || `Machine ${serial}`;
      }

      // Get item summary, hourly stacked chart, cycle pie, and daily efficiency from cache
      const [itemSummary, countByItem, cyclePie, dailyEfficiency] = await Promise.all([
        buildItemSummaryFromCache(db, opId, start, end, serial),
        buildItemHourlyStackFromCacheForOperator(db, opId, start, end, serial),
        // Promise.resolve(null), // Placeholder for commented-out countByItem
        buildOperatorCyclePieFromCache(db, opId, start, end, serial),
        buildDailyEfficiencyFromCache(db, opId, operatorName, start, end, serial)
      ]);

      // Transform itemSummary to match operator-info format
      const transformedItemSummary = itemSummary.sessions.flatMap(session => {
        if (!Array.isArray(session.items) || !session.items.length) return [];
        const mSerial = session.machine?.serial ?? "Unknown";
        const mName   = session.machine?.name   ?? "Unknown";
        return session.items.map(item => ({
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
          workedTimeFormatted: session.workedTimeFormatted || formatDuration(0)
        }));
      });

      return res.json({
        itemSummary: transformedItemSummary,
        countByItem,                         // hourly item breakdown from cache
        cyclePie,                            // cycle pie chart from cache
        dailyEfficiency,                     // daily efficiency chart from cache
        // TODO: Add other cached responses when implemented
        // faultHistory
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator details from cache" });
    }
  });

  return router;
};
