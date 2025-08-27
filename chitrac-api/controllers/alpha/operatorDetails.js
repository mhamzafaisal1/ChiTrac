// routes/analytics/operator-details.js
const express = require("express");
const { DateTime, Interval } = require("luxon");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration, getCountCollectionName } = require("../../utils/time");
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
      ...(serial ? { "machine.serial": Number(serial) } : {})
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
    const sessionRows = [];

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

      // Count attribution logic: if counts[] has operator.id, count only those for this operator
      // Otherwise, prorate by operator's work-time share
      let countInWin = 0;
      if (Array.isArray(s.counts) && s.counts.length && s.counts.length <= 50000) {
        countInWin = s.counts.reduce((acc, c) => {
          const ts = new Date(c.timestamp);
          const sameItem = !c.item?.id || c.item.id === it.id;
          const sameOperator = !c.operator?.id || c.operator.id === Number(operatorId);
          return acc + (sameItem && sameOperator && ts >= ovStart && ts <= ovEnd ? 1 : 0);
        }, 0);
      } else if (typeof s.totalCount === "number") {
        // Prorate by operator's overlapped work-time share
        countInWin = Math.round(s.totalCount * factor);
      }

      const hours = toHours(workedMs);
      const std = Number(it.standard) || 0;
      const stdPPH = normalizeStdPPH(std);
      const pph = hours > 0 ? countInWin / hours : 0;
      const eff = stdPPH > 0 ? pph / stdPPH : 0;

      sessionRows.push({
        start: ovStart.toISOString(),
        end: ovEnd.toISOString(),
        workedTimeMs: workedMs,
        workedTimeFormatted: formatDuration(workedMs),
        machine: {                         // <-- add
          serial: s.machine?.serial ?? null,
          name: s.machine?.name ?? null
        },
        items: [{
          itemId: it.id,
          name: it.name || "Unknown",
          countTotal: countInWin,
          standard: std,
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100
        }]
      });

      const rec = itemAgg.get(it.id) || { name: it.name || "Unknown", standard: std, count: 0, workedMs: 0 };
      rec.count += countInWin;
      rec.workedMs += workedMs;
      if (!rec.standard && std) rec.standard = std;
      itemAgg.set(it.id, rec);

      totalValid += countInWin;
      totalWorkedMs += workedMs;
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

    return Promise.all(hours.map(async ({ start: hStart, end: hEnd }) => {
      // Build query filter
      const filter = {
        "operator.id": Number(operatorId),
        "timestamps.start": { $lt: hEnd },
        $or: [
          { "timestamps.end": { $gt: hStart } },
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": null }
        ]
      };

      // Optionally scope to specific machine
      if (serial) {
        filter["machine.serial"] = Number(serial);
      }

      const sessions = await osColl.find(filter)
        .project({
          _id: 0,
          timestamps: 1,
          workTime: 1, runtime: 1,
          totalTimeCredit: 1,
          totalCount: 1, misfeedCount: 1
        })
        .toArray();

      // Aggregate metrics for this hour
      let workSec = 0, timeCreditSec = 0, valid = 0, mis = 0;

      for (const s of sessions) {
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
    }));
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

      // Get operator name from the latest operator-session
      const osColl = db.collection(config.operatorSessionCollectionName);
      const latest = await osColl.find({ "operator.id": opId })
        .project({ _id: 0, operator: 1 })
        .sort({ "timestamps.start": -1 })
        .limit(1)
        .toArray();
      
      const operatorName = latest[0]?.operator?.name || `Operator ${opId}`;

      // Get machine info if serial is provided
      let machineSerial = null;
      let machineName = null;
      if (serial) {
        const msColl = db.collection(config.machineSessionCollectionName);
        const machineInfo = await msColl.find({ "machine.serial": Number(serial) })
          .project({ _id: 0, "machine.name": 1 })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray();
        machineSerial = Number(serial);
        machineName = machineInfo[0]?.machine?.name || `Machine ${serial}`;
      }

      // Fetch states for the operator in the time window
      const states = await fetchStatesForOperator(db, opId, new Date(start), new Date(end));

            // Build the two main tabs
      const [itemSummary, dailyEfficiencyByHour] = await Promise.all([
        buildItemSummaryFromItemSessions(db, opId, start, end, serial),
        buildDailyEfficiencyByHour(db, opId, start, end, serial)
      ]);

      // Build hourly item breakdown using count collection
      const countCollection = getCountCollectionName(start);
      const counts = await db
        .collection(countCollection)
        .find({
          "operator.id": opId,
          timestamp: { $gte: new Date(start), $lt: new Date(end) },
          misfeed: { $ne: true }, // valid counts only
          ...(serial ? { "machine.serial": Number(serial) } : {})
        })
        .project({
          _id: 0,
          timestamp: 1,
          "item.id": 1,
          "item.name": 1
        })
        .toArray();

      // Build hourly breakdown map
      const hourlyBreakdownMap = {};
      for (const c of counts) {
        const hour = new Date(c.timestamp).getHours();
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

      // replace the entire "Build daily efficiency ..." section with:
      const dailyEfficiency = await buildDailyEfficiencyFromOperatorSessions(
        db, opId, operatorName, start, end, serial, tz
      );

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

  return router;
};
