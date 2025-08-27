// routes/analytics/machine-details.js
const express = require("express");
const { DateTime, Interval } = require("luxon");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const { buildFaultData } = require("../../utils/machineDashboardBuilder");
const { fetchGroupedAnalyticsData } = require("../../utils/fetchData");
const { getBookendedStatesAndTimeRange } = require("../../utils/bookendingBuilder");

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

  const calcOEE = (availability, efficiency, throughput) =>
    availability * efficiency * throughput;

  // --------------------------
  // Current Operators (tab)
  // --------------------------
  async function buildCurrentOperators(db, serial) {
    const msColl = db.collection(config.machineSessionCollectionName);

    // most recent machine-session (this gives us current operator IDs)
    const latest = await msColl.find({ "machine.serial": Number(serial) })
      .project({ _id: 0, operators: 1, machine: 1, timestamps: 1 })
      .sort({ "timestamps.start": -1 })
      .limit(1)
      .toArray();

    if (!latest.length) return [];

    const opIds = [...new Set(
      (latest[0].operators || [])
        .map(o => o && o.id)
        .filter(id => typeof id === "number" && id !== -1)
    )];

    if (!opIds.length) return [];

    const osColl = db.collection(config.operatorSessionCollectionName);

    // most-recent operator-session for EACH operator on THIS machine
    const rows = await Promise.all(opIds.map(async (opId) => {
      const s = await osColl.find({
        "operator.id": opId,
        "machine.serial": Number(serial),
      })
        .project({
          _id: 0, operator: 1, machine: 1, timestamps: 1,
          workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
        })
        .sort({ "timestamps.start": -1 })
        .limit(1)
        .toArray();

      const doc = s[0];
      if (!doc) return null;

      const workSec = safe(doc.workTime);
      const creditSec = safe(doc.totalTimeCredit);
      const valid = safe(doc.totalCount);
      const mis = safe(doc.misfeedCount);
      const eff = workSec > 0 ? (creditSec / workSec) : 0;
      const workedMs = Math.round(workSec * 1000);

      return {
        operatorId: doc.operator?.id,
        operatorName: doc.operator?.name || "Unknown",
        machineSerial: doc.machine?.serial,
        machineName: doc.machine?.name || "Unknown",
        session: {
          start: doc.timestamps?.start || null,
          end: doc.timestamps?.end || null
        },
        metrics: {
          workedTimeMs: workedMs,
          workedTimeFormatted: formatDuration(workedMs),
          totalCount: Math.round(valid + mis),
          validCount: Math.round(valid),
          misfeedCount: Math.round(mis),
          efficiencyPct: +(eff * 100).toFixed(2)
        }
      };
    }));

    return rows.filter(Boolean);
  }

  // -----------------------------------
  // Item Summary (via item-sessions)
  // -----------------------------------
  async function buildItemSummaryFromItemSessions(db, serial, start, end) {
    const coll = db.collection(config.itemSessionCollectionName);
    const wStart = new Date(start);
    const wEnd = new Date(end);

    const sessions = await coll.find({
      "machine.serial": Number(serial),
      "timestamps.start": { $lt: wEnd },
      $or: [
        { "timestamps.end": { $gt: wStart } },
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": null }
      ]
    })
      .project({
        _id: 0,
        item: 1, items: 1,
        timestamps: 1,
        workTime: 1, runtime: 1, activeStations: 1,
        totalCount: 1, counts: 1
      })
      .toArray();

    if (!sessions.length) {
      return {
        sessions: [],
        machineSummary: {
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

      let countInWin = 0;
      if (Array.isArray(s.counts) && s.counts.length && s.counts.length <= 50000) {
        countInWin = s.counts.reduce((acc, c) => {
          const ts = new Date(c.timestamp);
          const sameItem = !c.item?.id || c.item.id === it.id;
          return acc + (sameItem && ts >= ovStart && ts <= ovEnd ? 1 : 0);
        }, 0);
      } else if (typeof s.totalCount === "number") {
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

    const machinePPH = totalHours > 0 ? totalValid / totalHours : 0;
    const machineEff = proratedStdPPH > 0 ? (machinePPH / proratedStdPPH) : 0;

    return {
      sessions: sessionRows,
      machineSummary: {
        totalCount: totalValid,
        workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(machinePPH * 100) / 100,
        proratedStandard: Math.round(proratedStdPPH * 100) / 100,
        efficiency: Math.round(machineEff * 10000) / 100,
        itemSummaries
      }
    };
  }

  // -------------------------------------------------------
  // Performance Chart by hour (sessions-based, truncated)
  // -------------------------------------------------------
  async function buildPerformanceByHour(db, serial, start, end) {
    const msColl = db.collection(config.machineSessionCollectionName);
    const osColl = db.collection(config.operatorSessionCollectionName);
    const hours = hourlyWindows(start, end);

    return Promise.all(hours.map(async ({ start: hStart, end: hEnd }) => {
      // Pull overlapping machine sessions and operator sessions (parallel)
      const [mSessions, oSessions] = await Promise.all([
        msColl.find({
          "machine.serial": Number(serial),
          "timestamps.start": { $lt: hEnd },
          $or: [
            { "timestamps.end": { $gt: hStart } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, machine: 1, timestamps: 1,
          runtime: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
        }).toArray(),
        osColl.find({
          "machine.serial": Number(serial),
          "timestamps.start": { $lt: hEnd },
          $or: [
            { "timestamps.end": { $gt: hStart } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, operator: 1, timestamps: 1,
          workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
        }).toArray()
      ]);

      // Machine totals for Availability / OEE
      const slotSec = (hEnd - hStart) / 1000;
      let runtimeSec = 0, workSec = 0, timeCreditSec = 0, valid = 0, mis = 0;

      for (const s of mSessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, hStart, hEnd);
        runtimeSec    += safe(s.runtime)          * factor;
        workSec       += safe(s.workTime)         * factor;
        timeCreditSec += safe(s.totalTimeCredit)  * factor;
        valid         += safe(s.totalCount)       * factor;
        mis           += safe(s.misfeedCount)     * factor;
      }

      // Per-operator efficiency in this hour (from operator-sessions)
      const opMap = new Map(); // id -> { name, workSec, creditSec }
      for (const s of oSessions) {
        const id = s.operator?.id;
        if (typeof id !== "number" || id === -1) continue;
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, hStart, hEnd);
        if (factor <= 0) continue;

        const rec = opMap.get(id) || { name: s.operator?.name || "Unknown", workSec: 0, creditSec: 0 };
        rec.workSec   += safe(s.workTime)        * factor;
        rec.creditSec += safe(s.totalTimeCredit) * factor;
        opMap.set(id, rec);
      }

      const operators = Array.from(opMap.entries()).map(([id, r]) => {
        const eff = r.workSec > 0 ? (r.creditSec / r.workSec) : 0;
        return {
          id,
          name: r.name,
          efficiency: +(eff * 100).toFixed(2)
        };
      });

      const availability = slotSec > 0 ? (runtimeSec / slotSec) : 0;
      const efficiency   = workSec > 0 ? (timeCreditSec / workSec) : 0;
      const throughput   = (valid + mis) > 0 ? (valid / (valid + mis)) : 0;
      const oee          = calcOEE(availability, efficiency, throughput);

      return {
        hourStart: DateTime.fromJSDate(hStart).toISO(),
        hourEnd: DateTime.fromJSDate(hEnd).toISO(),
        machine: {
          availabilityPct: +(availability * 100).toFixed(2),
          efficiencyPct:   +(efficiency   * 100).toFixed(2),
          throughputPct:   +(throughput   * 100).toFixed(2),
          oeePct:          +(oee          * 100).toFixed(2)
        },
        operators
      };
    }));
  }

  // --------------------------
  // /machine-details route
  // --------------------------
  router.get("/analytics/machine-details", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      if (!serial) {
        return res.status(400).json({ error: "serial is required" });
      }

      // Pull machine name from the latest machine-session (cheap + accurate)
      const msColl = db.collection(config.machineSessionCollectionName);
      const latest = await msColl.find({ "machine.serial": Number(serial) })
        .project({ _id: 0, machine: 1 })
        .sort({ "timestamps.start": -1 })
        .limit(1)
        .toArray();
      const machineName = latest[0]?.machine?.name || `Serial ${serial}`;

      const [currentOperators, itemSummary, performanceByHour] = await Promise.all([
        buildCurrentOperators(db, serial),
        buildItemSummaryFromItemSessions(db, serial, start, end),
        buildPerformanceByHour(db, serial, start, end)
      ]);

      // Build faultData using the machine-dashboard approach (states + bookending)
      let faultData = null;
      try {
        const groupedData = await fetchGroupedAnalyticsData(
          db,
          start,
          end,
          "machine",
          { targetSerials: [Number(serial)] }
        );
        const group = groupedData[Number(serial)] || groupedData[String(serial)];
        if (group) {
          const bookended = await getBookendedStatesAndTimeRange(db, Number(serial), start, end);
          if (bookended) {
            const { states, sessionStart, sessionEnd } = bookended;
            faultData = buildFaultData(states, sessionStart, sessionEnd);
          }
        }
      } catch (e) {
        logger.error("machine-details faultData build error:", e);
      }

      return res.json({
        machine: { serial: Number(serial), name: machineName },
        tabs: {
          currentOperators,   // array of most-recent operator-sessions on this machine
          itemSummary,        // sessions-based item summary (same shape you use)
          performanceByHour   // [{hourStart, hourEnd, machine:{...}, operators:[...]}]
        },
        ...(faultData ? { faultData } : {})
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch machine details" });
    }
  });

  return router;
};
