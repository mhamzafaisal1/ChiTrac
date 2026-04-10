  const {
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    formatDuration,
    getStateCollectionName,
    getCountCollectionName,
    getHourlyIntervals,
    SYSTEM_TIMEZONE,
  } = require("./time");
  const { DateTime, Interval } = require("luxon");
  const config = require("../modules/config");
  const {
    calculateDowntime,
    calculateAvailability,
    calculateEfficiency,
    calculateOEE,
    calculateThroughput,
    calculateTotalCount,
    calculateOperatorTimes,
    calculateMisfeeds,
  } = require("./analytics");
  const { extractAllCyclesFromStates, extractFaultCycles } = require("./state");
  const {
    getMisfeedCounts,
    groupCountsByItem,
    processCountStatistics,
    groupCountsByOperatorAndMachine,
    getValidCounts,
  } = require("./count");
  const { loadActiveShifts } = require("./shiftElapsed");
  const { getLiveProductiveWindowMs, liveDowntimeMs } = require("./availabilityLive");

  function safe(n) {
    return typeof n === "number" && isFinite(n) ? n : 0;
  }

  function toHours(ms) {
    return ms / 3600000;
  }

  function overlap(sStart, sEnd, wStart, wEnd) {
    if (!sStart) return { ovSec: 0, fullSec: 0, factor: 0, ovStart: wStart, ovEnd: wEnd };
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const factor = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor, ovStart: os, ovEnd: oe };
  }

  function hourlyWindows(start, end) {
    const s = DateTime.fromJSDate(new Date(start)).startOf("hour");
    const e = DateTime.fromJSDate(new Date(end)).endOf("hour");
    return Interval.fromDateTimes(s, e)
      .splitBy({ hours: 1 })
      .map(iv => ({ start: iv.start.toJSDate(), end: iv.end.toJSDate() }));
  }

  function normalizeStdPPH(std) {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  }

  function calcOEE(availability, efficiency, throughput) {
    return availability * efficiency * throughput;
  }

  async function buildCurrentOperators(db, serial) {
    const msColl = db.collection(config.machineSessionCollectionName);
    const latest = await msColl.find({ "machine.serial": Number(serial) })
      .project({ _id: 0, operators: 1, machine: 1, timestamps: 1 })
      .sort({ "timestamps.start": -1 })
      .limit(1)
      .toArray();
    if (!latest.length) return [];
    const opIds = [...new Set(
      (latest[0].operators || []).map(o => o && o.id).filter(id => typeof id === "number" && id !== -1)
    )];
    if (!opIds.length) return [];
    const osColl = db.collection(config.operatorSessionCollectionName);
    const rows = await Promise.all(opIds.map(async (opId) => {
      const s = await osColl.find({
        "operator.id": opId,
        "machine.serial": Number(serial)
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
      const eff = workSec > 0 ? creditSec / workSec : 0;
      const workedMs = Math.round(workSec * 1000);
      return {
        operatorId: doc.operator?.id,
        operatorName: doc.operator?.name || "Unknown",
        machineSerial: doc.machine?.serial,
        machineName: doc.machine?.name || "Unknown",
        session: { start: doc.timestamps?.start || null, end: doc.timestamps?.end || null },
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
        _id: 0, item: 1, items: 1, timestamps: 1,
        workTime: 1, runtime: 1, activeStations: 1, totalCount: 1, counts: 1
      })
      .toArray();
    if (!sessions.length) {
      return {
        sessions: [],
        machineSummary: {
          totalCount: 0, workedTimeMs: 0, workedTimeFormatted: formatDuration(0),
          pph: 0, proratedStandard: 0, efficiency: 0, itemSummaries: {}
        }
      };
    }
    const itemAgg = new Map();
    const sessionRows = [];
    for (const s of sessions) {
      const it = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
      if (!it || it.id == null) continue;
      const { ovSec, fullSec, factor, ovStart, ovEnd } = overlap(s.timestamps?.start, s.timestamps?.end, wStart, wEnd);
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
        workedTimeMs,
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
    }
    let totalValid = 0;
    let totalWorkedMs = 0;
    for (const [, r] of itemAgg) {
      totalValid += r.count;
      totalWorkedMs += r.workedMs;
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
    const machineEff = proratedStdPPH > 0 ? machinePPH / proratedStdPPH : 0;
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

  async function buildPerformanceByHour(db, serial, start, end) {
    const msColl = db.collection(config.machineSessionCollectionName);
    const osColl = db.collection(config.operatorSessionCollectionName);
    const hours = hourlyWindows(start, end);
    return Promise.all(hours.map(async ({ start: hStart, end: hEnd }) => {
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
      const slotSec = (hEnd - hStart) / 1000;
      let runtimeSec = 0, workSec = 0, timeCreditSec = 0, valid = 0, mis = 0;
      for (const s of mSessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, hStart, hEnd);
        runtimeSec += safe(s.runtime) * factor;
        workSec += safe(s.workTime) * factor;
        timeCreditSec += safe(s.totalTimeCredit) * factor;
        valid += safe(s.totalCount) * factor;
        mis += safe(s.misfeedCount) * factor;
      }
      const opMap = new Map();
      for (const s of oSessions) {
        const id = s.operator?.id;
        if (typeof id !== "number" || id === -1) continue;
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, hStart, hEnd);
        if (factor <= 0) continue;
        const rec = opMap.get(id) || { name: s.operator?.name || "Unknown", workSec: 0, creditSec: 0 };
        rec.workSec += safe(s.workTime) * factor;
        rec.creditSec += safe(s.totalTimeCredit) * factor;
        opMap.set(id, rec);
      }
      const operators = Array.from(opMap.entries()).map(([id, r]) => ({
        id,
        name: r.name,
        efficiency: +(r.workSec > 0 ? (r.creditSec / r.workSec) * 100 : 0).toFixed(2)
      }));
      const availability = slotSec > 0 ? runtimeSec / slotSec : 0;
      const efficiency = workSec > 0 ? timeCreditSec / workSec : 0;
      const throughput = (valid + mis) > 0 ? valid / (valid + mis) : 0;
      const oee = calcOEE(availability, efficiency, throughput);
      return {
        hourStart: DateTime.fromJSDate(hStart).toISO(),
        hourEnd: DateTime.fromJSDate(hEnd).toISO(),
        machine: {
          availabilityPct: +(availability * 100).toFixed(2),
          efficiencyPct: +(efficiency * 100).toFixed(2),
          throughputPct: +(throughput * 100).toFixed(2),
          oeePct: +(oee * 100).toFixed(2)
        },
        operators
      };
    }));
  }


async function getActiveMachineSerials(db, start, end) {
    const stateCollection = getStateCollectionName(start);
    const serials = await db.collection(stateCollection).distinct("machine.serial", {
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    });
    return serials;
  }


  function extractAllCyclesFromStatesForDashboard(states, queryStart, queryEnd, mode) {
    const startTime = new Date(queryStart);
    const endTime = new Date(queryEnd);

    const cycles = {
      running: [],
      paused: [],
      fault: []
    };

    let currentRunningStart = null;
    let currentPauseStart = null;
    let currentFaultStart = null;

    for (const state of states) {
      const code = state.status?.code;
      const timestamp = new Date(state.timestamp);

      // Running cycles
      if (!mode || mode === 'running') {
        if (code === 1 && !currentRunningStart) {
          currentRunningStart = timestamp;
        } else if (code !== 1 && currentRunningStart) {
          const clampedStart = currentRunningStart < startTime ? startTime : currentRunningStart;
          const clampedEnd = timestamp > endTime ? endTime : timestamp;
          if (clampedStart < clampedEnd) {
            cycles.running.push({
              start: clampedStart,
              end: clampedEnd,
              duration: clampedEnd - clampedStart
            });
          }
          currentRunningStart = null;
        }
      }

      // Paused cycles
      if (!mode || mode === 'paused') {
        if (code === 0 && !currentPauseStart) {
          currentPauseStart = timestamp;
        } else if (code !== 0 && currentPauseStart) {
          const clampedStart = currentPauseStart < startTime ? startTime : currentPauseStart;
          const clampedEnd = timestamp > endTime ? endTime : timestamp;
          if (clampedStart < clampedEnd) {
            cycles.paused.push({
              start: clampedStart,
              end: clampedEnd,
              duration: clampedEnd - clampedStart
            });
          }
          currentPauseStart = null;
        }
      }

      // Fault cycles
      if (!mode || mode === 'fault') {
        if (code > 1 && !currentFaultStart) {
          currentFaultStart = timestamp;
        } else if (code <= 1 && currentFaultStart) {
          const clampedStart = currentFaultStart < startTime ? startTime : currentFaultStart;
          const clampedEnd = timestamp > endTime ? endTime : timestamp;
          if (clampedStart < clampedEnd) {
            cycles.fault.push({
              start: clampedStart,
              end: clampedEnd,
              duration: clampedEnd - clampedStart
            });
          }
          currentFaultStart = null;
        }
      }
    }

    // Cleanup for open cycles (still active at end)
    if ((!mode || mode === 'running') && currentRunningStart && currentRunningStart < endTime) {
      const clampedStart = currentRunningStart < startTime ? startTime : currentRunningStart;
      cycles.running.push({
        start: clampedStart,
        end: endTime,
        duration: endTime - clampedStart
      });
    }

    if ((!mode || mode === 'paused') && currentPauseStart && currentPauseStart < endTime) {
      const clampedStart = currentPauseStart < startTime ? startTime : currentPauseStart;
      cycles.paused.push({
        start: clampedStart,
        end: endTime,
        duration: endTime - clampedStart
      });
    }

    if ((!mode || mode === 'fault') && currentFaultStart && currentFaultStart < endTime) {
      const clampedStart = currentFaultStart < startTime ? startTime : currentFaultStart;
      cycles.fault.push({
        start: clampedStart,
        end: endTime,
        duration: endTime - clampedStart
      });
    }

    return mode ? cycles[mode] : cycles;
  }

  function formatItemSummaryFromAggregation(items) {
    const result = {};
    for (const item of items) {
      result[item._id] = {
        name: item.name,
        standard: item.standard,
        countTotal: item.count,
        workedTimeFormatted: formatDuration(0), // placeholder
        pph: null,
        efficiency: null
      };
    }
    return result;
  }

  function formatItemHourlyStackFromAggregation(hourlyAgg) {
    const hourSet = new Set();
    const itemMap = {};

    for (const row of hourlyAgg) {
      hourSet.add(row.hour);
      const key = String(row.itemId);
      if (!itemMap[key]) itemMap[key] = {};
      itemMap[key][row.hour] = row.count;
    }

    const hours = Array.from(hourSet).sort((a, b) => a - b);
    const operators = {};

    for (const [itemId, hourCounts] of Object.entries(itemMap)) {
      operators[itemId] = hours.map(h => hourCounts[h] || 0);
    }

    return {
      title: "Item Stacked Count Chart",
      data: {
        hours,
        operators
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Functions extracted from machineSessions.js controller             */
  /* ------------------------------------------------------------------ */

  // Clamp standard to PPH
  function normalizePPH(std) {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  }

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  // Recompute a session's metrics given its counts/misfeeds and timestamps
  function recalcSession(session) {
    const start = new Date(session.timestamps.start);
    const end = new Date(session.timestamps.end || new Date());
    const runtimeMs = Math.max(0, end - start);
    const runtimeSec = runtimeMs / 1000;

    // Active stations = non-dummy operators
    // Handle both old structure (session.operators) and new structure (session.states.start.operators)
    const operators = session.operators || session.states?.start?.operators || [];
    const activeStations = Array.isArray(operators)
      ? operators.filter((op) => op && op.id !== -1).length
      : 0;

    const workTimeSec = runtimeSec * activeStations;

    const counts = Array.isArray(session.counts) ? session.counts : [];
    const misfeeds = Array.isArray(session.misfeeds) ? session.misfeeds : [];

    const totalCount = counts.length;
    const misfeedCount = misfeeds.length;

    // Calculate total time credit (corrected - count per-item and use per-item standards)
    let totalTimeCredit = 0;

    // 1. Count how many of each item were produced in the truncated window
    const perItemCounts = new Map(); // key: item.id
    for (const c of counts) {
      const id = c.item?.id;
      if (id == null) continue;
      perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
    }

    // 2. Calculate time credit for each item based on its actual count and standard
    // Handle both old structure (session.items) and new structure (session.program.items or session.states.start.program.items)
    const items = session.items || session.program?.items || session.states?.start?.program?.items || [];
    for (const [id, cnt] of perItemCounts) {
      // Find the standard for this specific item from session.items
      const item = items.find((it) => it && it.id === id);
      if (item && item.standard) {
        const pph = normalizePPH(item.standard);
        if (pph > 0) {
          totalTimeCredit += cnt / (pph / 3600); // seconds
        }
      }
    }

    totalTimeCredit = Number(totalTimeCredit.toFixed(2));

    session.runtime = runtimeMs / 1000;
    session.workTime = workTimeSec;
    session.totalCount = totalCount;
    session.misfeedCount = misfeedCount;
    session.totalTimeCredit = totalTimeCredit;
    return session;
  }

  // Truncate a session to [start,end] and recalc
  function truncateAndRecalc(original, newStart, newEnd) {
    // Handle both old structure (counts as array) and new structure (counts.valid)
    const countsArray = Array.isArray(original.counts)
      ? original.counts
      : (original.counts?.valid || []);
    const misfeedsArray = Array.isArray(original.misfeeds)
      ? original.misfeeds
      : (original.counts?.misfeed || []);

    // Only clone what we need to modify
    const s = {
      ...original,
      timestamps: { ...original.timestamps },
      counts: [...countsArray],
      misfeeds: [...misfeedsArray],
    };

    // Clamp timestamps
    const start = new Date(s.timestamps.start);
    const end = new Date(s.timestamps.end || new Date());

    const clampedStart = start < newStart ? newStart : start;
    const clampedEnd = end > newEnd ? newEnd : end;

    s.timestamps.start = clampedStart;
    s.timestamps.end = clampedEnd;

    // Filter counts/misfeeds to window
    const inWindow = (d) => {
      const ts = new Date(d.timestamp || d.timestamps?.create);
      return ts >= clampedStart && ts <= clampedEnd;
    };

    s.counts = s.counts.filter(inWindow);
    s.misfeeds = s.misfeeds.filter(inWindow);

    return recalcSession(s);
  }

  // Build the final response row matching the existing shape
  function formatMachinesSummaryRow({
    machine,
    status,
    runtimeMs,
    downtimeMs,
    totalCount,
    misfeedCount,
    workTimeSec,
    totalTimeCredit,
    queryStart,
    queryEnd,
    productiveMs = null,
  }) {
    const wallMs = Math.max(0, queryEnd - queryStart);
    const denomMs = productiveMs != null ? productiveMs : wallMs;
    const availability = denomMs
      ? Math.min(Math.max(runtimeMs / denomMs, 0), 1)
      : 0;
    const throughput =
      totalCount + misfeedCount ? totalCount / (totalCount + misfeedCount) : 0;
    const efficiency = workTimeSec > 0 ? totalTimeCredit / workTimeSec : 0;
    const oee = availability * throughput * efficiency;

    return {
      machine: {
        serial: machine?.serial ?? -1,
        name: machine?.name ?? "Unknown",
      },
      currentStatus: {
        // Status schema uses 'id', but legacy code used 'code' - support both
        code: status?.id ?? status?.code ?? 0,
        name: status?.name ?? "Unknown",
      },
      metrics: {
        runtime: {
          total: runtimeMs,
          formatted: formatDuration(runtimeMs),
        },
        downtime: {
          total: downtimeMs,
          formatted: formatDuration(downtimeMs),
        },
        output: {
          totalCount,
          misfeedCount,
        },
        performance: {
          availability: {
            value: availability,
            percentage: (availability * 100).toFixed(2),
          },
          throughput: {
            value: throughput,
            percentage: (throughput * 100).toFixed(2),
          },
          efficiency: {
            value: efficiency,
            percentage: (efficiency * 100).toFixed(2),
          },
          oee: {
            value: oee,
            percentage: (oee * 100).toFixed(2),
          },
        },
      },
      timeRange: {
        start: queryStart,
        end: queryEnd,
      },
    };
  }

  function groupRecordsBySerial(records) {
    const map = new Map();
    for (const record of records || []) {
      const serial = safeNumber(record.machineSerial, null);
      if (serial === null) continue;
      if (!map.has(serial)) {
        map.set(serial, []);
      }
      map.get(serial).push(record);
    }
    return map;
  }

  function buildLatestTickerMap(stateTickerData) {
    const tickerMap = new Map();
    for (const record of stateTickerData || []) {
      const candidates = [
        record.machine?.serial,
        record.machine?.id,
        record.machine?.serialNumber,
      ];
      const ts =
        new Date(
          record.status?.timestamp ||
            record.timestamp ||
            record.timestamps?.update ||
            record.timestamps?.active ||
            record.timestamps?.create ||
            0
        ).getTime() || 0;

      for (const candidate of candidates) {
        const serial = safeNumber(candidate, null);
        if (serial === null) continue;

        const existing = tickerMap.get(serial);
        if (!existing || ts > existing.timestamp) {
          tickerMap.set(serial, {
            status: {
              // Status schema uses 'id', but legacy code used 'code' - support both
              code: record.status?.id ?? record.status?.code ?? 0,
              name: record.status?.name || "Unknown",
            },
            timestamp: ts,
          });
        }
      }
    }
    return tickerMap;
  }

  function buildPerformanceFromMachineRecord(record, shiftElapsedMsOverride = null) {
    const runtimeMs = safeNumber(record.runtimeMs);
    const pausedMs = safeNumber(record.pausedTimeMs);
    const faultMs = safeNumber(record.faultTimeMs);
    const downtimeWallClockMs = pausedMs + faultMs;
    const workedTimeMs = safeNumber(record.workedTimeMs);
    const timeCreditMs = safeNumber(record.totalTimeCreditMs);
    const totalCounts = safeNumber(record.totalCounts);
    const totalMisfeeds = safeNumber(record.totalMisfeeds);
    const totalOutput = totalCounts + totalMisfeeds;

    const windowMsWallClock =
      record.timeRange?.start && record.timeRange?.end
        ? Math.max(
            0,
            new Date(record.timeRange.end) - new Date(record.timeRange.start)
          )
        : runtimeMs + downtimeWallClockMs;

    const totalQueryMs =
      typeof shiftElapsedMsOverride === "number" ? shiftElapsedMsOverride : windowMsWallClock;

    const downtimeMs = Math.max(totalQueryMs - runtimeMs, 0);
    const availability =
      totalQueryMs > 0 ? Math.min(Math.max(runtimeMs / totalQueryMs, 0), 1) : 0;
    const throughput = totalOutput > 0 ? totalCounts / totalOutput : 0;
    const efficiency =
      workedTimeMs > 0 ? Math.min(Math.max(timeCreditMs / workedTimeMs, 0), 1) : 0;
    const oee = availability * throughput * efficiency;

    return {
      runtime: {
        total: runtimeMs,
        formatted: formatDuration(runtimeMs),
      },
      downtime: {
        total: downtimeMs,
        formatted: formatDuration(downtimeMs),
      },
      output: {
        totalCount: totalCounts,
        misfeedCount: totalMisfeeds,
      },
      performance: {
        availability: {
          value: availability,
          percentage: (availability * 100).toFixed(2) + "%",
        },
        throughput: {
          value: throughput,
          percentage: (throughput * 100).toFixed(2) + "%",
        },
        efficiency: {
          value: efficiency,
          percentage: (efficiency * 100).toFixed(2) + "%",
        },
        oee: {
          value: oee,
          percentage: (oee * 100).toFixed(2) + "%",
        },
      },
    };
  }

  function buildItemSummaryFromRecords(records, sessionStart, sessionEnd) {
    if (!records.length) {
      return {
        sessions: [],
        machineSummary: {
          totalCount: 0,
          workedTimeMs: 0,
          workedTimeFormatted: formatDuration(0),
          pph: 0,
          proratedStandard: 0,
          efficiency: 0,
          itemSummaries: {},
        },
      };
    }

    let totalWorkedMs = 0;
    let totalCounts = 0;
    const sessionItems = [];
    const itemSummaries = {};

    for (const record of records) {
      const counts = safeNumber(record.totalCounts);
      const workedMs =
        safeNumber(record.workedTimeMs) || safeNumber(record.runtimeMs);
      const standard = safeNumber(record.itemStandard);
      const hours = workedMs / 3600000 || 0;
      const pph = hours > 0 ? counts / hours : 0;
      const efficiency = standard > 0 ? pph / standard : 0;
      const itemId = record.itemId ?? record.itemName ?? "unknown";
      const itemKey = String(itemId);
      const itemName = record.itemName || `Item ${itemKey}`;

      totalWorkedMs += workedMs;
      totalCounts += counts;

      sessionItems.push({
        itemId: record.itemId,
        name: itemName,
        countTotal: counts,
        standard,
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      });

      itemSummaries[itemKey] = {
        name: itemName,
        standard,
        countTotal: counts,
        workedTimeFormatted: formatDuration(workedMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      };
    }

    const totalHours = totalWorkedMs / 3600000 || 0;
    const machinePph = totalHours > 0 ? totalCounts / totalHours : 0;
    const proratedStandard = sessionItems.reduce((acc, item) => {
      const weight = totalCounts > 0 ? item.countTotal / totalCounts : 0;
      return acc + weight * (item.standard || 0);
    }, 0);
    const machineEfficiency =
      proratedStandard > 0 ? machinePph / proratedStandard : 0;

    return {
      sessions: [
        {
          start: sessionStart.toISOString(),
          end: sessionEnd.toISOString(),
          workedTimeMs: totalWorkedMs,
          workedTimeFormatted: formatDuration(totalWorkedMs),
          items: sessionItems,
        },
      ],
      machineSummary: {
        totalCount: totalCounts,
        workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(machinePph * 100) / 100,
        proratedStandard: Math.round(proratedStandard * 100) / 100,
        efficiency: Math.round(machineEfficiency * 10000) / 100,
        itemSummaries,
      },
    };
  }

  /**
   * @param {object[]} records - hourly-totals rows
   * @param {Date} sessionStart - anchor date for labels (Chicago wall clock via SYSTEM_TIMEZONE)
   * @param {{ minHour: number, maxHour: number } | null} [hourEnvelope] - if set, only hours in [minHour,maxHour]
   *   appear on the axis (first shift start through last shift end for that day); gaps between shifts stay.
   */
  function buildItemHourlyStackFromRecords(records, sessionStart, hourEnvelope = null) {
    if (!records.length) {
      return {
        title: "No data",
        data: { hours: [], items: {} },
      };
    }

    // Group records by hour and itemName, summing totalCounts
    const hourMap = new Map();
    const itemNames = new Set();

    for (const record of records) {
      // Use the hour field directly from hourly-totals records
      const hour = typeof record.hour === "number" ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
      }
      if (
        hourEnvelope &&
        (hour < hourEnvelope.minHour || hour > hourEnvelope.maxHour)
      ) {
        continue;
      }

      const itemName = record.itemName || `Item ${record.itemId ?? "Unknown"}`;
      const count = safeNumber(record.totalCounts);

      if (!hourMap.has(hour)) {
        hourMap.set(hour, {});
      }
      const entry = hourMap.get(hour);
      entry[itemName] = (entry[itemName] || 0) + count;
      itemNames.add(itemName);
    }

    if (hourMap.size === 0 && !hourEnvelope) {
      return {
        title: "Item Stacked Count Chart",
        data: { hours: [], items: {} },
      };
    }

    let allHours;
    if (hourEnvelope) {
      allHours = [];
      for (let h = hourEnvelope.minHour; h <= hourEnvelope.maxHour; h++) {
        allHours.push(h);
      }
    } else {
      const hoursWithData = Array.from(hourMap.keys()).sort((a, b) => a - b);
      if (hoursWithData.length === 0) {
        return {
          title: "Item Stacked Count Chart",
          data: { hours: [], items: {} },
        };
      }
      const maxHour = Math.max(...hoursWithData);
      allHours = Array.from({ length: maxHour + 1 }, (_, idx) => idx);
    }

    // Initialize items object with arrays filled with zeros
    const items = {};
    for (const name of itemNames) {
      items[name] = Array(allHours.length).fill(0);
    }

    // Fill in the actual counts (index aligns with allHours[i] === hour)
    for (let i = 0; i < allHours.length; i++) {
      const hour = allHours[i];
      const counts = hourMap.get(hour);
      if (!counts) continue;
      for (const [itemName, total] of Object.entries(counts)) {
        if (items[itemName]) items[itemName][i] = total;
      }
    }

    return {
      title: "Item Stacked Count Chart",
      data: {
        hours: allHours,
        items,
      },
    };
  }

  /**
   * @param {{ minHour: number, maxHour: number } | null} [hourEnvelope] - if set, emits one entry per hour
   *   from first shift start through last shift end (gaps between shifts included with empty/zero data).
   */
  function buildOperatorEfficiencyFromRecords(records, sessionStart, hourEnvelope = null) {
    if (!records.length) {
      return [];
    }

    // Group records by hour
    const hourMap = new Map();

    for (const record of records) {
      // Use the hour field directly from hourly-totals records
      const hour = typeof record.hour === "number" ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
      }
      if (
        hourEnvelope &&
        (hour < hourEnvelope.minHour || hour > hourEnvelope.maxHour)
      ) {
        continue;
      }

      const workedMs = safeNumber(record.workedTimeMs) || safeNumber(record.runtimeMs);
      const timeCreditMs = safeNumber(record.totalTimeCreditMs);
      const ratio = workedMs > 0 ? Math.min(Math.max(timeCreditMs / workedMs, 0), 2) : 0;
      const efficiency = Math.round(ratio * 10000) / 100;

      const operatorId = safeNumber(record.operatorId);
      // Format operator name from object (first + surname) or use string if already formatted
      const operatorName = typeof record.operatorName === 'object' && record.operatorName !== null
        ? `${record.operatorName.first || ''} ${record.operatorName.surname || ''}`.trim() || "Unknown"
        : record.operatorName || "Unknown";

      if (!hourMap.has(hour)) {
        hourMap.set(hour, {
          operators: new Map() // Use Map to deduplicate operators per hour
        });
      }

      const hourData = hourMap.get(hour);

      // Use operator ID as key to avoid duplicates (in case same operator has multiple records for same hour)
      const operatorKey = `${operatorId}`;
      if (!hourData.operators.has(operatorKey)) {
        hourData.operators.set(operatorKey, {
          id: operatorId,
          name: operatorName,
          efficiency: efficiency
        });
      } else {
        // If operator already exists in this hour, average the efficiencies
        // This handles cases where an operator might have multiple records for the same hour
        const existing = hourData.operators.get(operatorKey);
        existing.efficiency = Math.round(((existing.efficiency + efficiency) / 2) * 100) / 100;
      }
    }

    if (hourMap.size === 0 && !hourEnvelope) {
      return [];
    }

    let hoursToEmit;
    if (hourEnvelope) {
      hoursToEmit = [];
      for (let h = hourEnvelope.minHour; h <= hourEnvelope.maxHour; h++) {
        hoursToEmit.push(h);
      }
    } else {
      hoursToEmit = Array.from(hourMap.keys()).sort((a, b) => a - b);
    }

    const result = [];

    for (const hour of hoursToEmit) {
      const hourData = hourMap.get(hour);
      const operators = hourData ? Array.from(hourData.operators.values()) : [];

      // Calculate average efficiency for this hour from all operators
      const avgEfficiency =
        operators.length > 0
          ? operators.reduce((sum, op) => sum + op.efficiency, 0) / operators.length
          : 0;

      // Create hour timestamp in Chicago timezone (matching the hour field from records)
      // Convert sessionStart to Chicago timezone, then set the hour in that timezone
      const hourDate = DateTime.fromJSDate(sessionStart, { zone: SYSTEM_TIMEZONE })
        .set({ hour: hour, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();

      result.push({
        hour: hourDate.toISOString(),
        oee: Math.round(avgEfficiency * 100) / 100,
        operators,
      });
    }

    return result;
  }

  // Helper function to query machines summary daily cache
  async function queryMachinesSummaryDailyCache(db, logger, completeDays) {
    if (completeDays.length === 0) return [];

    const cacheCollection = db.collection("totals-daily");

    // Exact UTC midnight dateObjs and date strings (matching cache writer format)
    const dateStrs = completeDays.map((d) => d.dateStr); // ["2025-08-28", "2025-08-29"]
    const dateObjs = dateStrs.map((str) => new Date(str + "T00:00:00.000Z"));

    logger.info(
      `[machineSessions] Querying daily cache with dateStrs:`,
      dateStrs
    );
    logger.info(
      `[machineSessions] Querying daily cache with dateObjs:`,
      dateObjs
    );

    const records = await cacheCollection
      .find({
        entityType: "machine",
        $or: [{ dateObj: { $in: dateObjs } }, { date: { $in: dateStrs } }],
      })
      .toArray();

    logger.info(
      `[machineSessions] Found ${records.length} daily cache records`
    );
    return records;
  }

  // Helper function to query machines summary sessions for partial days
  async function queryMachinesSummarySessions(db, logger, partialDays) {
    if (partialDays.length === 0) return [];

    const results = [];

    for (const partialDay of partialDays) {
      // Get active machines
      const activeSerials = new Set(
        await db
          .collection(config.machineCollectionName)
          .distinct("serial", { active: true })
      );

      logger.info(
        `[machineSessions] Found ${activeSerials.size} active machines:`,
        [...activeSerials]
      );

      // Process each active machine
      for (const serial of activeSerials) {
        // Fetch sessions that overlap the partial day window
        // Use proper overlap logic: session starts before window ends AND session ends after window starts
        const sessions = await db
          .collection(config.machineSessionCollectionName)
          .find({
            "machine.id": serial,
            "timestamps.start": { $lt: partialDay.end },
            $or: [
              { "timestamps.end": { $gt: partialDay.start } },
              { "timestamps.end": { $exists: false } }, // Handle open sessions
            ],
          })
          .sort({ "timestamps.start": 1 })
          .toArray();

        if (!sessions.length) continue;

        // Truncate first session if it starts before partialDay.start
        if (sessions[0]) {
          const first = sessions[0];
          const firstStart = new Date(first.timestamps?.start);
          if (firstStart < partialDay.start) {
            sessions[0] = truncateAndRecalc(
              first,
              partialDay.start,
              first.timestamps?.end
                ? new Date(first.timestamps.end)
                : partialDay.end
            );
          }
        }

        // Truncate last session if it ends after partialDay.end (or is open)
        if (sessions.length > 0) {
          const lastIdx = sessions.length - 1;
          const last = sessions[lastIdx];
          const lastEnd = last.timestamps?.end
            ? new Date(last.timestamps.end)
            : null;

          if (!lastEnd || lastEnd > partialDay.end) {
            const effectiveEnd = lastEnd ? partialDay.end : partialDay.end;
            sessions[lastIdx] = truncateAndRecalc(
              last,
              new Date(sessions[lastIdx].timestamps.start),
              effectiveEnd
            );
          }
        }

        // Aggregate metrics
        let runtimeMs = 0;
        let workTimeSec = 0;
        let totalCount = 0;
        let misfeedCount = 0;
        let totalTimeCredit = 0;

        for (const s of sessions) {
          // Extract from session document structure
          runtimeMs += Math.floor((s.metrics?.timers?.run || s.runtime || 0)) * 1000;
          workTimeSec += Math.floor(s.metrics?.timers?.worked || s.workTime || 0);
          totalCount += s.metrics?.totals?.counts?.valid || s.totalCount || 0;
          misfeedCount += s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;
          totalTimeCredit += s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
        }

        const downtimeMs = Math.max(
          0,
          partialDay.end - partialDay.start - runtimeMs
        );

        results.push({
          machineSerial: serial,
          machineName: sessions[0]?.machine?.name || `Serial ${serial}`,
          runtimeMs,
          downtimeMs,
          totalCount,
          misfeedCount,
          workTimeSec,
          totalTimeCredit,
          timeRange: {
            start: partialDay.start,
            end: partialDay.end,
            type: partialDay.type,
          },
        });
      }
    }

    return results;
  }

  // Helper function to combine machines summary data
  function combineMachinesSummaryData(dailyRecords, sessionData) {
    const combinedMap = new Map();

    // Add daily records
    for (const record of dailyRecords) {
      const machineSerial = record.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          machineName: record.machineName,
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0,
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.runtimeMs += record.runtimeMs || 0;
      machine.downtimeMs += record.pausedTimeMs || 0; // pausedTimeMs from daily cache
      machine.totalCount += record.totalCounts || 0;
      machine.misfeedCount += record.totalMisfeeds || 0;
      machine.workTimeSec += (record.workedTimeMs || 0) / 1000; // Convert to seconds
      machine.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
    }

    // Add session data
    for (const session of sessionData) {
      const machineSerial = session.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          machineName: session.machineName,
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0,
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.runtimeMs += session.runtimeMs || 0;
      machine.downtimeMs += session.downtimeMs || 0;
      machine.totalCount += session.totalCount || 0;
      machine.misfeedCount += session.misfeedCount || 0;
      machine.workTimeSec += session.workTimeSec || 0;
      machine.totalTimeCredit += session.totalTimeCredit || 0;
    }

    return combinedMap;
  }

  // Build hybrid machines summary (daily cache + partial day sessions)
  async function buildHybridMachinesSummary(db, logger, exactStart, exactEnd) {
    const HYBRID_THRESHOLD_HOURS = config.hybridThresholdHours;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

    const startOfFirstDay = DateTime.fromJSDate(exactStart, {
      zone: SYSTEM_TIMEZONE,
    }).startOf("day");
    const endOfLastDay = DateTime.fromJSDate(exactEnd, {
      zone: SYSTEM_TIMEZONE,
    }).endOf("day");

    const completeDays = [];
    const partialDays = [];

    let currentDay = startOfFirstDay;
    while (currentDay < endOfLastDay) {
      const dayStart = currentDay.toJSDate();
      const dayEnd = currentDay.plus({ days: 1 }).startOf("day").toJSDate();

      if (dayStart >= exactStart && dayEnd <= exactEnd) {
        completeDays.push({
          start: dayStart,
          end: dayEnd,
          dateStr: currentDay.toFormat("yyyy-LL-dd"),
        });
      }

      currentDay = currentDay.plus({ days: 1 });
    }

    const nextDayStart = startOfFirstDay.plus({ days: 1 }).toJSDate();
    if (exactStart < nextDayStart) {
      const partialEnd = exactEnd < nextDayStart ? exactEnd : nextDayStart;
      if (partialEnd > exactStart) {
        partialDays.push({
          start: exactStart,
          end: partialEnd,
          type: "start",
        });
      }
    }

    const previousDayEnd = endOfLastDay.minus({ days: 1 }).toJSDate();
    if (exactEnd > previousDayEnd) {
      const partialStart =
        exactStart > previousDayEnd ? exactStart : previousDayEnd;
      if (exactEnd > partialStart) {
        partialDays.push({
          start: partialStart,
          end: exactEnd,
          type: "end",
        });
      }
    }

    if (
      partialDays.length === 2 &&
      partialDays[0].start.getTime() === partialDays[1].start.getTime() &&
      partialDays[0].end.getTime() === partialDays[1].end.getTime()
    ) {
      partialDays.splice(1, 1);
    }

    const dailyRecords = await queryMachinesSummaryDailyCache(db, logger, completeDays);
    logger.info(
      `[machineSessions] Daily cache query returned ${dailyRecords.length} records`
    );

    const sessionData = await queryMachinesSummarySessions(db, logger, partialDays);
    logger.info(
      `[machineSessions] Session query returned ${sessionData.length} records`
    );

    const combinedData = combineMachinesSummaryData(
      dailyRecords,
      sessionData
    );
    logger.info(
      `[machineSessions] Combined data has ${combinedData.size} machines`
    );

    if (!combinedData.size) {
      return {
        results: [],
        metadata: {
          timeRange: {
            start: exactStart,
            end: exactEnd,
            hours: Math.round(timeRangeHours * 100) / 100,
          },
          optimization: {
            used: true,
            approach: "hybrid",
            thresholdHours: HYBRID_THRESHOLD_HOURS,
            timeRangeHours: Math.round(timeRangeHours * 100) / 100,
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length,
            performance: {
              estimatedSpeedup: `${Math.round(
                (timeRangeHours / 24) * 10
              )}x faster for ${Math.round(timeRangeHours / 24)} days`,
            },
          },
        },
      };
    }

    const activeSerials = new Set(
      await db
        .collection(config.machineCollectionName)
        .distinct("serial", { active: true })
    );

    const tickers = await db
      .collection(config.stateTickerCollectionName)
      .find({ "machine.serial": { $in: [...activeSerials] } })
      .project({ _id: 0, timestamp: 1, status: 1, "machine.serial": 1 })
      .toArray();

    const statusMap = new Map();
    tickers.forEach((ticker) => {
      const serial = ticker.machine?.serial;
      if (!serial) {
        return;
      }
      const ts = new Date(ticker.timestamp || 0).getTime();
      const existing = statusMap.get(serial);
      if (!existing || ts > existing.timestamp) {
        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
        statusMap.set(serial, {
          status: {
            code: statusId, // Use 'code' in API response for backward compatibility
            name: ticker.status?.name ?? "Unknown",
          },
          timestamp: ts,
        });
      }
    });

    const results = [];
    for (const [machineSerial, data] of combinedData) {
      const statusEntry = statusMap.get(machineSerial)?.status || {
        code: 0,
        name: "Unknown",
      };

      const result = formatMachinesSummaryRow({
        machine: { serial: machineSerial, name: data.machineName },
        status: statusEntry,
        runtimeMs: data.runtimeMs,
        downtimeMs: data.downtimeMs,
        totalCount: data.totalCount,
        misfeedCount: data.misfeedCount,
        workTimeSec: data.workTimeSec,
        totalTimeCredit: data.totalTimeCredit,
        queryStart: exactStart,
        queryEnd: exactEnd,
      });

      results.push(result);
    }

    const metadata = {
      timeRange: {
        start: exactStart,
        end: exactEnd,
        hours: Math.round(timeRangeHours * 100) / 100,
      },
      optimization: {
        used: true,
        approach: "hybrid",
        thresholdHours: HYBRID_THRESHOLD_HOURS,
        timeRangeHours: Math.round(timeRangeHours * 100) / 100,
        completeDays: completeDays.length,
        partialDays: partialDays.length,
        dailyRecords: dailyRecords.length,
        sessionRecords: sessionData.length,
        performance: {
          estimatedSpeedup: `${Math.round(
            (timeRangeHours / 24) * 10
          )}x faster for ${Math.round(timeRangeHours / 24)} days`,
        },
      },
    };

    return { results, metadata };
  }

  // Helper function to query machine daily cache
  async function queryMachineDailyCache(db, completeDays, serial) {
    if (completeDays.length === 0) return [];

    const cacheCollection = db.collection("totals-daily");

    // Exact UTC midnight dateObjs and date strings (matching cache writer format)
    const dateStrs = completeDays.map((d) => d.dateStr); // ["2025-08-28", "2025-08-29"]
    const dateObjs = dateStrs.map((str) => new Date(str + "T00:00:00.000Z"));

    const query = {
      entityType: "machine",
      $or: [{ dateObj: { $in: dateObjs } }, { date: { $in: dateStrs } }],
    };

    if (serial) {
      query.machineSerial = parseInt(serial);
    }

    const records = await cacheCollection.find(query).toArray();

    return records;
  }

  // Helper function to query machine sessions for partial days
  async function queryMachineSessions(db, partialDays, serial) {
    if (partialDays.length === 0) return [];

    const results = [];

    for (const partialDay of partialDays) {
      // Get grouped analytics data for this partial day
      const groupedData = await fetchGroupedAnalyticsData(
        db,
        partialDay.start,
        partialDay.end,
        "machine",
        { targetSerials: serial ? [serial] : [] }
      );

      // Process each machine's data
      for (const [machineSerialStr, group] of Object.entries(groupedData)) {
        const machineSerial = parseInt(machineSerialStr);
        const { states: rawStates, counts } = group;

        if (!rawStates.length && !counts.valid.length) continue;

        // Apply bookending for this serial
        const bookended = await getBookendedStatesAndTimeRange(
          db,
          machineSerial,
          partialDay.start,
          partialDay.end
        );

        if (!bookended) continue;

        const { states, sessionStart, sessionEnd } = bookended;

        results.push({
          machineSerial,
          states,
          counts,
          sessionStart,
          sessionEnd,
          timeRange: {
            start: partialDay.start,
            end: partialDay.end,
            type: partialDay.type,
          },
        });
      }
    }

    return results;
  }

  // Helper function to combine machine dashboard data
  function combineMachineDashboardData(dailyRecords, sessionData) {
    const combinedMap = new Map();

    // Add daily records (convert to dashboard format)
    for (const record of dailyRecords) {
      const machineSerial = record.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          states: [],
          counts: { valid: [], misfeed: [] },
          sessionStart: null,
          sessionEnd: null,
          dailyData: [],
          sessionData: [],
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.dailyData.push(record);

      // Convert daily record to state-like format for dashboard builders
      const state = {
        machine: {
          serial: record.machineSerial,
          name: record.machineName,
        },
        status: {
          code: 0, // Default status for daily records
          name: "Running",
        },
        timestamps: {
          start:
            record.timeRange?.start || new Date(record.date + "T00:00:00.000Z"),
          end:
            record.timeRange?.end || new Date(record.date + "T23:59:59.999Z"),
        },
        runtime: record.runtimeMs / 1000, // Convert to seconds
        workTime: record.workedTimeMs / 1000, // Convert to seconds
        totalCount: record.totalCounts,
        misfeedCount: record.totalMisfeeds,
        totalTimeCredit: record.totalTimeCreditMs / 1000, // Convert to seconds
      };

      machine.states.push(state);

      // Set session bounds
      if (
        !machine.sessionStart ||
        state.timestamps.start < machine.sessionStart
      ) {
        machine.sessionStart = state.timestamps.start;
      }
      if (!machine.sessionEnd || state.timestamps.end > machine.sessionEnd) {
        machine.sessionEnd = state.timestamps.end;
      }
    }

    // Add session data
    for (const session of sessionData) {
      const machineSerial = session.machineSerial;

      if (!combinedMap.has(machineSerial)) {
        combinedMap.set(machineSerial, {
          machineSerial,
          states: [],
          counts: { valid: [], misfeed: [] },
          sessionStart: null,
          sessionEnd: null,
          dailyData: [],
          sessionData: [],
        });
      }

      const machine = combinedMap.get(machineSerial);
      machine.sessionData.push(session);

      // Add session states and counts
      machine.states.push(...session.states);
      machine.counts.valid.push(...session.counts.valid);
      machine.counts.misfeed.push(...session.counts.misfeed);

      // Update session bounds
      if (
        !machine.sessionStart ||
        session.sessionStart < machine.sessionStart
      ) {
        machine.sessionStart = session.sessionStart;
      }
      if (!machine.sessionEnd || session.sessionEnd > machine.sessionEnd) {
        machine.sessionEnd = session.sessionEnd;
      }
    }

    // Convert to object format expected by dashboard builders
    const result = {};
    for (const [machineSerial, data] of combinedMap) {
      result[machineSerial] = {
        states: data.states,
        counts: data.counts,
        sessionStart: data.sessionStart,
        sessionEnd: data.sessionEnd,
      };
    }

    return result;
  }

  // --- Functions consolidated from machineDashboardBuilder.js ---

  async function buildMachinePerformance(states, validCounts, misfeedCounts, start, end) {
    const runningCycles = extractAllCyclesFromStates(states, start, end).running;
    const runtimeMs = runningCycles.reduce((total, cycle) => total + cycle.duration, 0);
    const totalQueryMs = new Date(end) - new Date(start);
    const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);

    const totalCount = calculateTotalCount(validCounts, misfeedCounts);
    const misfeedCount = calculateMisfeeds(misfeedCounts);

    const availability = calculateAvailability(runtimeMs, downtimeMs, totalQueryMs);
    const throughput = calculateThroughput(validCounts.length, misfeedCount);
    const efficiency = calculateEfficiency(runtimeMs, validCounts.length, validCounts);
    const oee = calculateOEE(availability, efficiency, throughput);

    return {
      runtime: { total: runtimeMs, formatted: formatDuration(runtimeMs) },
      downtime: { total: downtimeMs, formatted: formatDuration(downtimeMs) },
      output: { totalCount, misfeedCount },
      performance: {
        availability: { value: availability, percentage: (availability * 100).toFixed(2) + "%" },
        throughput:   { value: throughput,   percentage: (throughput   * 100).toFixed(2) + "%" },
        efficiency:   { value: efficiency,   percentage: (efficiency   * 100).toFixed(2) + "%" },
        oee:          { value: oee,          percentage: (oee          * 100).toFixed(2) + "%" },
      },
    };
  }

  function buildMachineItemSummary(states, validCounts, start, end) {
    const sessionStart = new Date(start);
    const sessionEnd = new Date(end);

    const countsInSession = validCounts.filter((c) => {
      const countTime = c.timestamp || c.timestamps?.create;
      if (!countTime) return false;
      const ts = new Date(countTime);
      return ts >= sessionStart && ts <= sessionEnd;
    });

    let cycles = extractAllCyclesFromStates(states, start, end).running;

    if (countsInSession.length > 0) {
      if (cycles.length === 0) {
        cycles = [{ start: sessionStart, end: sessionEnd, duration: sessionEnd - sessionStart }];
      } else {
        const countsInCycles = countsInSession.some(c => {
          const countTime = new Date(c.timestamp || c.timestamps?.create);
          return cycles.some(cycle => {
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            return countTime >= cycleStart && countTime <= cycleEnd;
          });
        });
        if (!countsInCycles) {
          cycles = [{ start: sessionStart, end: sessionEnd, duration: sessionEnd - sessionStart }];
        }
      }
    }

    if (!cycles.length || !countsInSession.length) {
      return {
        sessions: [],
        machineSummary: {
          totalCount: 0, workedTimeMs: 0, workedTimeFormatted: formatDuration(0),
          pph: 0, proratedStandard: 0, efficiency: 0, itemSummaries: {},
        },
      };
    }

    const itemSummary = {};
    let totalWorkedMs = 0;
    let totalCount = 0;
    const sessions = [];

    for (const cycle of cycles) {
      const cycleStart = new Date(cycle.start);
      const cycleEnd = new Date(cycle.end);
      const cycleMs = cycleEnd - cycleStart;

      const cycleCounts = countsInSession.filter((c) => {
        const countTime = c.timestamp || c.timestamps?.create;
        if (!countTime) return false;
        const ts = new Date(countTime);
        return ts >= cycleStart && ts <= cycleEnd;
      });

      if (!cycleCounts.length) continue;

      const grouped = groupCountsByItem(cycleCounts);
      const operators = new Set(cycleCounts.map((c) => c.operator?.id).filter(Boolean));
      const workedTimeMs = cycleMs * Math.max(1, operators.size);

      const cycleItems = [];
      for (const [itemId, group] of Object.entries(grouped)) {
        const name = group[0]?.item?.name || "Unknown";
        const standard = group[0]?.item?.standard > 0 ? group[0]?.item?.standard : 666;
        const countTotal = group.length;

        if (!itemSummary[itemId]) {
          itemSummary[itemId] = { name, standard, count: 0, workedTimeMs: 0 };
        }
        itemSummary[itemId].count += countTotal;
        itemSummary[itemId].workedTimeMs += workedTimeMs;
        totalWorkedMs += workedTimeMs;
        totalCount += countTotal;

        const hours = workedTimeMs / 3600000;
        const pph = hours ? countTotal / hours : 0;
        const efficiency = standard ? pph / standard : 0;
        cycleItems.push({
          itemId: parseInt(itemId), name, countTotal, standard,
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(efficiency * 10000) / 100,
        });
      }

      sessions.push({
        start: cycleStart.toISOString(), end: cycleEnd.toISOString(),
        workedTimeMs, workedTimeFormatted: formatDuration(workedTimeMs), items: cycleItems,
      });
    }

    const totalHours = totalWorkedMs / 3600000;
    const machinePph = totalHours > 0 ? totalCount / totalHours : 0;
    const proratedStandard = Object.values(itemSummary).reduce((acc, item) => {
      const weight = totalCount > 0 ? item.count / totalCount : 0;
      return acc + weight * item.standard;
    }, 0);
    const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

    const formattedItemSummaries = {};
    for (const [itemId, item] of Object.entries(itemSummary)) {
      const hours = item.workedTimeMs / 3600000;
      const pph = hours ? item.count / hours : 0;
      const efficiency = item.standard ? pph / item.standard : 0;
      formattedItemSummaries[itemId] = {
        name: item.name, standard: item.standard, countTotal: item.count,
        workedTimeFormatted: formatDuration(item.workedTimeMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      };
    }

    return {
      sessions,
      machineSummary: {
        totalCount, workedTimeMs: totalWorkedMs,
        workedTimeFormatted: formatDuration(totalWorkedMs),
        pph: Math.round(machinePph * 100) / 100,
        proratedStandard: Math.round(proratedStandard * 100) / 100,
        efficiency: Math.round(machineEff * 10000) / 100,
        itemSummaries: formattedItemSummaries,
      },
    };
  }

  function buildItemHourlyStack(validCounts, start, end) {
    try {
      if (!Array.isArray(validCounts)) throw new Error("Counts must be an array");
      if (!validCounts.length) return { title: "No data", data: { hours: [], operators: {} } };

      const startDate = new Date(start);
      const hourMap = new Map();
      const itemNames = new Set();

      for (const count of validCounts) {
        const countTime = count.timestamp || count.timestamps?.create;
        if (!countTime) continue;
        const ts = new Date(countTime);
        const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));
        const itemName = count.item?.name || "Unknown";
        if (!hourMap.has(hourIndex)) hourMap.set(hourIndex, {});
        const hourEntry = hourMap.get(hourIndex);
        hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
        itemNames.add(itemName);
      }

      const maxHour = Math.max(...hourMap.keys());
      const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);
      const operators = {};
      for (const name of itemNames) operators[name] = Array(maxHour + 1).fill(0);
      for (const [hourIndex, itemCounts] of hourMap.entries()) {
        for (const [itemName, count] of Object.entries(itemCounts)) {
          operators[itemName][hourIndex] = count;
        }
      }

      return { title: "Item Stacked Count Chart", data: { hours, operators } };
    } catch (error) {
      console.error("Error in buildItemHourlyStack:", error);
      throw error;
    }
  }

  function buildFaultData(states, start, end) {
    if (!Array.isArray(states) || !states.length) {
      return { faultCycles: [], faultSummaries: [] };
    }

    const { faultCycles, faultSummaries } = extractFaultCycles(states, start, end);

    const formattedSummaries = faultSummaries.map((summary) => {
      const totalSeconds = Math.floor(summary.totalDuration / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return { ...summary, formatted: { hours, minutes, seconds } };
    });

    const sortedFaultCycles = faultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));
    return { faultCycles: sortedFaultCycles, faultSummaries: formattedSummaries };
  }

  async function buildOperatorEfficiency(states, counts, start, end, serial) {
    try {
      const hourlyIntervals = getHourlyIntervals(new Date(start), new Date(end));

      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          const hourStates = states.filter((s) => {
            const stateTime = s.timestamp || s.timestamps?.create;
            if (!stateTime) return false;
            const ts = new Date(stateTime);
            return ts >= interval.start && ts < interval.end;
          });

          const hourCounts = counts.filter((c) => {
            const countTime = c.timestamp || c.timestamps?.create;
            if (!countTime) return false;
            const ts = new Date(countTime);
            return ts >= interval.start && ts < interval.end;
          });

          const groupedCounts = groupCountsByOperatorAndMachine(hourCounts);
          const operatorIds = new Set(hourCounts.map((c) => c.operator?.id).filter(Boolean));

          const { runtime: totalRuntime } = calculateOperatorTimes(hourStates, interval.start, interval.end);

          const operatorMetrics = {};

          for (const operatorId of operatorIds) {
            let group = groupedCounts[`${operatorId}-${serial}`];
            if (!group) {
              const matchingKey = Object.keys(groupedCounts).find(key => {
                const [opId] = key.split('-');
                return opId === String(operatorId);
              });
              if (matchingKey) group = groupedCounts[matchingKey];
            }
            if (!group) continue;

            const stats = processCountStatistics(group.counts);
            const efficiency = calculateEfficiency(totalRuntime, stats.total, group.validCounts);

            let operatorName = "Unknown";
            const opName = group.counts[0]?.operator?.name;
            if (opName) {
              if (typeof opName === 'string') {
                operatorName = opName;
              } else if (opName.first || opName.surname) {
                operatorName = `${opName.first || ''} ${opName.surname || ''}`.trim() || "Unknown";
              }
            }

            operatorMetrics[operatorId] = {
              name: operatorName,
              runTime: totalRuntime,
              validCounts: stats.valid,
              totalCounts: stats.total,
              efficiency: efficiency * 100,
            };
          }

          const avgEfficiency = Object.values(operatorMetrics).reduce((sum, op) => sum + op.efficiency, 0)
            / (Object.keys(operatorMetrics).length || 1);
          const totalValid = Object.values(operatorMetrics).reduce((sum, op) => sum + op.validCounts, 0);
          const totalCounts = Object.values(operatorMetrics).reduce((sum, op) => sum + op.totalCounts, 0);
          const throughput = totalCounts > 0 ? (totalValid / totalCounts) * 100 : 0;
          const availability = (totalRuntime / (interval.end - interval.start)) * 100;
          const oee = calculateOEE(availability / 100, avgEfficiency / 100, throughput / 100) * 100;

          if (Object.keys(operatorMetrics).length === 0) return null;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(oee * 100) / 100,
            operators: Object.entries(operatorMetrics).map(([id, m]) => ({
              id: parseInt(id),
              name: m.name,
              efficiency: Math.round(m.efficiency * 100) / 100,
            })),
          };
        })
      );

      return hourlyData.filter(h => h !== null);
    } catch (err) {
      console.error("Error in buildOperatorEfficiency:", err);
      throw err;
    }
  }

  /**
   * Return current operators on a machine using stateTicker (real-time source of truth).
   * For each current operator, finds their OPEN/ACTIVE operator-session for metrics.
   * Falls back to most recent session if no open session exists.
   */
  async function buildCurrentOperatorsFromTicker(db, serial) {
    const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
    const serialNum = Number(serial);

    const tickerColl = db.collection(config.stateTickerCollectionName);
    const ticker = await tickerColl.findOne({
      $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }]
    }, { projection: { _id: 0, operators: 1, machine: 1 } });

    if (!ticker) return [];

    const operators = Array.isArray(ticker.operators) ? ticker.operators : [];
    const opIds = [...new Set(
      operators.map(o => o && o.id).filter(id => typeof id === "number" && id !== -1)
    )];

    if (!opIds.length) return [];

    const osColl = db.collection(config.operatorSessionCollectionName);
    const machineSerial = ticker.machine?.serial ?? ticker.machine?.id ?? serialNum;
    const machineName = ticker.machine?.name || "Unknown";

    const rows = await Promise.all(opIds.map(async (opId) => {
      let s = await osColl.find({
        "operator.id": opId,
        $and: [
          { $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }] },
          { $or: [{ "timestamps.end": { $exists: false } }, { "timestamps.end": null }] }
        ]
      })
        .project({ _id: 0, operator: 1, machine: 1, timestamps: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1 })
        .sort({ "timestamps.create": -1 })
        .limit(1)
        .toArray();

      if (!s.length) {
        s = await osColl.find({
          "operator.id": opId,
          $or: [{ "machine.serial": serialNum }, { "machine.id": serialNum }]
        })
          .project({ _id: 0, operator: 1, machine: 1, timestamps: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1 })
          .sort({ "timestamps.create": -1 })
          .limit(1)
          .toArray();
      }

      const doc = s[0];
      if (!doc) return null;

      const workSec   = safe(doc.workTime);
      const creditSec = safe(doc.totalTimeCredit);
      const valid     = safe(doc.totalCount);
      const mis       = safe(doc.misfeedCount);
      const eff       = workSec > 0 ? (creditSec / workSec) : 0;
      const workedMs  = Math.round(workSec * 1000);

      let operatorName = "Unknown";
      const tickerOp = operators.find(o => o && o.id === opId);
      if (tickerOp?.name) {
        if (typeof tickerOp.name === 'string') {
          operatorName = tickerOp.name;
        } else if (tickerOp.name.first || tickerOp.name.surname) {
          operatorName = `${tickerOp.name.first || ''} ${tickerOp.name.surname || ''}`.trim() || "Unknown";
        }
      } else if (doc.operator?.name) {
        if (typeof doc.operator.name === 'string') {
          operatorName = doc.operator.name;
        } else if (doc.operator.name.first || doc.operator.name.surname) {
          operatorName = `${doc.operator.name.first || ''} ${doc.operator.name.surname || ''}`.trim() || "Unknown";
        }
      }

      return {
        operatorId: opId,
        operatorName,
        machineSerial,
        machineName,
        session: { start: doc.timestamps?.start || doc.timestamps?.create || null, end: doc.timestamps?.end || null },
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

  // ---------------------------------------------------------------------------
  // getMachinesSummaryRealTime
  // Used as fallback when cached data is missing or on error.
  // Used in:
  //   - chitrac-api/controllers/alpha/machineRoutes.js
  //     GET /analytics/machines-summary-daily-cached (fallback when no cache or on error)
  //   - chitrac-api/controllers/alpha/machineSessions.js
  //     Various analytics routes that fall back to real-time summary (e.g. hybrid routes)
  // ---------------------------------------------------------------------------
  function getMachinesSummaryRealTime(db, logger, config) {
    return async function (req, res) {
      try {
        const { start, end } = parseAndValidateQueryParams(req);
        const queryStart = new Date(start);
        let queryEnd = new Date(end);
        const now = new Date();
        if (queryEnd > now) queryEnd = now;

        logger.info(
          `[machineSessions] Real-time calculation for range: ${queryStart.toISOString()} to ${queryEnd.toISOString()}`
        );

        const activeShifts = await loadActiveShifts(db);
        const productiveMs = getLiveProductiveWindowMs(activeShifts, queryStart, queryEnd);

        const activeSerials = new Set(
          await db
            .collection(config.machineCollectionName)
            .distinct("serial", { active: true })
        );

        logger.info(
          `[machineSessions] Found ${activeSerials.size} active machines: ${[...activeSerials].join(", ")}`
        );

        const tickers = await db
          .collection(config.stateTickerCollectionName)
          .find({ "machine.id": { $in: [...activeSerials] } })
          .project({ _id: 0, "machine.id": 1, "machine.serial": 1, "machine.name": 1, status: 1, timestamp: 1 })
          .toArray();

        logger.info(
          `[machineSessions] Found ${tickers.length} tickers for active machines`
        );

        const latestTickers = new Map();
        tickers.forEach((ticker) => {
          const id = Number(ticker.machine?.id);
          const ts = new Date(ticker.timestamp || 0);
          const existing = latestTickers.get(id);
          if (!existing || ts > new Date(existing.timestamp || 0)) {
            latestTickers.set(id, ticker);
          }
        });

        logger.info(
          `[machineSessions] After deduplication: ${latestTickers.size} unique machines`
        );

        const results = await Promise.all(
          [...latestTickers.values()].map(async (t) => {
            const { machine, status } = t || {};
            const serial = machine?.id || machine?.serial;
            if (!serial) {
              return null;
            }

            const normalizedMachine = {
              serial: serial,
              name: machine?.name || `Serial ${serial}`,
            };

            const sessions = await db
              .collection(config.machineSessionCollectionName)
              .find({
                "machine.id": serial,
                "timestamps.start": { $lt: queryEnd },
                $or: [
                  { "timestamps.end": { $gt: queryStart } },
                  { "timestamps.end": { $exists: false } },
                ],
              })
              .sort({ "timestamps.start": 1 })
              .toArray();

            logger.info(
              `[machineSessions] Machine ${serial}: Found ${sessions.length} sessions in time range`
            );

            if (!sessions.length) {
              return formatMachinesSummaryRow({
                machine: normalizedMachine,
                status,
                runtimeMs: 0,
                downtimeMs: liveDowntimeMs(0, productiveMs),
                totalCount: 0,
                misfeedCount: 0,
                workTimeSec: 0,
                totalTimeCredit: 0,
                queryStart,
                queryEnd,
                productiveMs,
              });
            }

            {
              const first = sessions[0];
              const firstStart = new Date(first.timestamps?.start);
              if (firstStart < queryStart) {
                sessions[0] = truncateAndRecalc(
                  first,
                  queryStart,
                  first.timestamps?.end
                    ? new Date(first.timestamps.end)
                    : queryEnd
                );
              }
            }

            {
              const lastIdx = sessions.length - 1;
              const last = sessions[lastIdx];
              const lastEnd = last.timestamps?.end
                ? new Date(last.timestamps.end)
                : null;

              if (!lastEnd || lastEnd > queryEnd) {
                const effectiveEnd = lastEnd ? queryEnd : queryEnd;
                sessions[lastIdx] = truncateAndRecalc(
                  last,
                  new Date(sessions[lastIdx].timestamps.start),
                  effectiveEnd
                );
              }
            }

            const allCounts = await db
              .collection("count")
              .find({
                "machine.id": serial,
                "timestamps.create": { $gte: queryStart, $lte: queryEnd },
              })
              .toArray();

            const validCounts = allCounts.filter(c => !c.misfeed);
            const misfeedCounts = allCounts.filter(c => c.misfeed);

            logger.info(
              `[machineSessions] Machine ${serial}: Found ${validCounts.length} valid counts, ${misfeedCounts.length} misfeed counts in time window`
            );

            let runtimeMs = 0;
            let workTimeSec = 0;
            let totalTimeCredit = 0;

            for (const s of sessions) {
              const sessionStart = new Date(s.timestamps?.start);
              const sessionEnd = s.timestamps?.end ? new Date(s.timestamps.end) : queryEnd;
              const clampedStart = sessionStart < queryStart ? queryStart : sessionStart;
              const clampedEnd = sessionEnd > queryEnd ? queryEnd : sessionEnd;
              const sessionRuntimeMs = Math.max(0, clampedEnd - clampedStart);

              const operators = s.states?.start?.operators || [];
              const activeStations = operators.filter((op) => op && op.id !== -1).length;
              const sessionWorkTimeSec = (sessionRuntimeMs / 1000) * activeStations;

              runtimeMs += sessionRuntimeMs;
              workTimeSec += sessionWorkTimeSec;
            }

            const items = sessions[0]?.program?.items || sessions[0]?.states?.start?.program?.items || [];
            const perItemCounts = new Map();

            for (const c of validCounts) {
              const id = c.item?.id;
              if (id != null) {
                perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
              }
            }

            for (const [id, cnt] of perItemCounts) {
              const item = items.find((it) => it && it.id === id);
              if (item && item.standard) {
                const pph = normalizePPH(item.standard);
                if (pph > 0) {
                  totalTimeCredit += cnt / (pph / 3600);
                }
              }
            }

            const totalCount = validCounts.length;
            const misfeedCount = misfeedCounts.length;
            const downtimeMs = liveDowntimeMs(runtimeMs, productiveMs);

            return formatMachinesSummaryRow({
              machine: normalizedMachine,
              status,
              runtimeMs,
              downtimeMs,
              totalCount,
              misfeedCount,
              workTimeSec,
              totalTimeCredit,
              queryStart,
              queryEnd,
              productiveMs,
            });
          })
        );

        const finalResults = results.filter(Boolean);
        logger.info(
          `[machineSessions] Returning ${finalResults.length} machine summary results`
        );
        res.json(finalResults);
      } catch (err) {
        logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);

        if (
          err.message.includes("Start and end dates are required") ||
          err.message.includes("start/startTime and end/endTime are required") ||
          err.message.includes("Invalid date format") ||
          err.message.includes("Start date must be before end date") ||
          err.message.includes("Invalid timeframe")
        ) {
          return res.status(400).json({ error: err.message });
        }

        res.status(500).json({ error: "Failed to build machines summary" });
      }
    };
  }

  // ============================================================
  // Function moved from bookendingBuilder.js (formerly utils/bookendingBuilder.js)
  // ============================================================
  // Returns bookended state data and true session start/end times per machine.
  // Fetches states before/after range to extend run sessions, normalizes timestamps and machine fields.
  async function getBookendedStatesAndTimeRange(db, serial, start, end) {
    const serialNum = parseInt(serial);
    let startDate = new Date(start);
    let endDate = new Date(end);
    const now = new Date();

    if (endDate > now) endDate = now;

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const stateCollection = getStateCollectionName(startDate);

    const inRangeStatesQ = db.collection(stateCollection)
      .find({
        $or: [
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            "timestamps.create": { $gte: startISO, $lte: endISO }
          },
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            timestamp: { $gte: startDate, $lte: endDate }
          }
        ]
      })
      .project({
        timestamp: 1,
        "timestamps.create": 1,
        "machine.serial": 1,
        "machine.id": 1,
        "machine.name": 1,
        "program.mode": 1,
        "status.code": 1,
        "status.name": 1
      })
      .sort({ "timestamps.create": 1, timestamp: 1 });

    const beforeStartQ = db.collection(stateCollection)
      .find({
        $or: [
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            "timestamps.create": { $lt: startISO }
          },
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            timestamp: { $lt: startDate }
          }
        ]
      })
      .project({
        timestamp: 1,
        "timestamps.create": 1,
        "machine.serial": 1,
        "machine.id": 1,
        "machine.name": 1,
        "program.mode": 1,
        "status.code": 1,
        "status.name": 1
      })
      .sort({ "timestamps.create": -1, timestamp: -1 })
      .limit(1);

    const afterEndQ = db.collection(stateCollection)
      .find({
        $or: [
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            "timestamps.create": { $gt: endISO }
          },
          {
            $or: [
              { "machine.id": serialNum },
              { "machine.serial": serialNum }
            ],
            timestamp: { $gt: endDate }
          }
        ]
      })
      .project({
        timestamp: 1,
        "timestamps.create": 1,
        "machine.serial": 1,
        "machine.id": 1,
        "machine.name": 1,
        "program.mode": 1,
        "status.code": 1,
        "status.name": 1
      })
      .sort({ "timestamps.create": 1, timestamp: 1 })
      .limit(1);

    const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
      inRangeStatesQ.toArray(),
      beforeStartQ.toArray(),
      afterEndQ.toArray()
    ]);

    const normalizeState = (state) => {
      if (!state.timestamp && state.timestamps?.create) {
        state.timestamp = state.timestamps.create;
      }
      if (!state.machine?.serial && state.machine?.id) {
        state.machine = state.machine || {};
        state.machine.serial = state.machine.id;
      }
      return state;
    };

    const fullStates = [
      ...(beforeStart ? [normalizeState(beforeStart)] : []),
      ...inRangeStates.map(normalizeState),
      ...(afterEnd ? [normalizeState(afterEnd)] : [])
    ].sort((a, b) => {
      const aTime = a.timestamp || a.timestamps?.create;
      const bTime = b.timestamp || b.timestamps?.create;
      return new Date(aTime) - new Date(bTime);
    });

    if (!fullStates.length) return null;

    const { running: runSessions } = extractAllCyclesFromStates(fullStates, startDate, endDate);
    if (!runSessions.length) return null;

    const sessionStart = runSessions[0].start;
    const sessionEnd = runSessions.at(-1).end;

    const filteredStates = fullStates.filter(s => {
      const stateTime = s.timestamp || s.timestamps?.create;
      return new Date(stateTime) >= sessionStart &&
             new Date(stateTime) <= sessionEnd;
    });

    return {
      sessionStart,
      sessionEnd,
      states: filteredStates
    };
  }

  // ============================================================
  // Functions moved from fetchData.js (formerly utils/fetchData.js)
  // ============================================================
  // Core fetch: fetches and groups state + count data by machine or operator for a given time range.
  // Uses timestamps.create, supports machine.serial/machine.id, normalizes documents for downstream use.
  async function fetchGroupedAnalyticsData(db, start, end, groupBy = 'machine', options = {}) {
    const { targetSerials = [], operatorId = null } = options;

    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);

    const countQuery = {
      "timestamps.create": { $gte: startDate, $lte: endDate },
      $or: [
        { "machine.serial": { $type: "int" } },
        { "machine.id": { $type: "int" } }
      ]
    };

    if (groupBy === 'machine' && targetSerials.length > 0) {
      countQuery.$or = [
        { "machine.serial": { $in: targetSerials } },
        { "machine.id": { $in: targetSerials } }
      ];
    }

    if (groupBy === 'operator' && operatorId !== null) {
      countQuery["operator.id"] = operatorId;
    }

    let states = [];
    const countCollection = getCountCollectionName(start);

    let counts = await db.collection(countCollection)
      .find(countQuery)
      .project({
        "timestamps.create": 1,
        "machine.serial": 1,
        "machine.id": 1,
        "operator.id": 1,
        "operator.name": 1,
        "item.id": 1,
        "item.name": 1,
        "item.standard": 1,
        misfeed: 1
      })
      .sort({ "timestamps.create": 1 })
      .toArray();

    counts = counts.map(count => {
      if (!count.timestamp && count.timestamps?.create) {
        count.timestamp = count.timestamps.create;
      }
      if (!count.machine?.serial && count.machine?.id) {
        count.machine = count.machine || {};
        count.machine.serial = count.machine.id;
      }
      return count;
    });

    if (groupBy === 'operator') {
      const machineSerialsUsed = Array.from(
        new Set(counts.map(c => c.machine?.serial).filter(Boolean))
      );
      const stateQuery = {
        $or: [
          {
            timestamp: { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $in: machineSerialsUsed } },
              { "machine.id": { $in: machineSerialsUsed } }
            ]
          },
          {
            "timestamps.create": { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $in: machineSerialsUsed } },
              { "machine.id": { $in: machineSerialsUsed } }
            ]
          }
        ]
      };
      const stateCollection = getStateCollectionName(start);
      states = await db.collection(stateCollection)
        .find(stateQuery)
        .project({
          timestamp: 1,
          "timestamps.create": 1,
          "machine.serial": 1,
          "machine.id": 1,
          "machine.name": 1,
          "program.mode": 1,
          "status.code": 1,
          "status.name": 1,
          "_tickerDoc.status": 1
        })
        .sort({ timestamp: 1, "timestamps.create": 1 })
        .toArray();
    } else {
      const stateQuery = {
        $or: [
          {
            timestamp: { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $type: "int" } },
              { "machine.id": { $type: "int" } }
            ]
          },
          {
            "timestamps.create": { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $type: "int" } },
              { "machine.id": { $type: "int" } }
            ]
          }
        ]
      };
      if (groupBy === 'machine' && targetSerials.length > 0) {
        stateQuery.$or = [
          {
            timestamp: { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $in: targetSerials } },
              { "machine.id": { $in: targetSerials } }
            ]
          },
          {
            "timestamps.create": { $gte: startDate, $lte: endDate },
            $or: [
              { "machine.serial": { $in: targetSerials } },
              { "machine.id": { $in: targetSerials } }
            ]
          }
        ];
      }
      const stateCollection = getStateCollectionName(start);
      states = await db.collection(stateCollection)
        .find(stateQuery)
        .project({
          timestamp: 1,
          "timestamps.create": 1,
          "machine.serial": 1,
          "machine.id": 1,
          "machine.name": 1,
          "program.mode": 1,
          "status.code": 1,
          "status.name": 1,
          "_tickerDoc.status": 1
        })
        .sort({ timestamp: 1, "timestamps.create": 1 })
        .toArray();
    }

    states = states.map(state => {
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

    const grouped = {};
    const machineNameMap = {};
    for (const state of states) {
      if (state.machine?.serial && state.machine?.name) {
        machineNameMap[state.machine.serial] = state.machine.name;
      }
    }

    if (groupBy === 'machine') {
      for (const state of states) {
        const serial = state.machine?.serial;
        if (serial === undefined || serial === null) continue;

        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
        grouped[serial].states.push(state);
      }

      for (const count of counts) {
        const serial = count.machine?.serial;
        if (serial === undefined || serial === null) continue;

        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
        grouped[serial].counts.all.push(count);

        if (count.misfeed === true) {
          grouped[serial].counts.misfeed.push(count);
        } else if (count.operator?.id !== -1) {
          grouped[serial].counts.valid.push(count);
        }
      }
    } else if (groupBy === 'operator') {
      const operatorMachineMap = {};
      for (const count of counts) {
        const operatorId = count.operator?.id;
        const machineSerial = count.machine?.serial;
        if (operatorId && machineSerial) {
          if (!operatorMachineMap[operatorId]) {
            operatorMachineMap[operatorId] = new Set();
          }
          operatorMachineMap[operatorId].add(machineSerial);
        }
      }

      for (const count of counts) {
        const operatorId = count.operator?.id;
        if (operatorId === undefined || operatorId === null) continue;

        if (!grouped[operatorId]) {
          grouped[operatorId] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
        grouped[operatorId].counts.all.push(count);

        if (count.misfeed === true) {
          grouped[operatorId].counts.misfeed.push(count);
        } else if (count.operator?.id !== -1) {
          grouped[operatorId].counts.valid.push(count);
        }
      }

      for (const [operatorId, machineSerials] of Object.entries(operatorMachineMap)) {
        if (grouped[operatorId]) {
          const operatorStates = states.filter(state =>
            state.machine?.serial && machineSerials.has(state.machine.serial)
          );
          grouped[operatorId].states = operatorStates;
        }
      }
    }

    return grouped;
  }

  // Wrapper: fetches grouped analytics for a single machine. Returns empty structure if no data.
  async function fetchGroupedAnalyticsDataForMachine(db, start, end, machineSerial) {
    const grouped = await fetchGroupedAnalyticsData(
      db,
      new Date(start),
      new Date(end),
      'machine',
      { targetSerials: [machineSerial] }
    );

    return grouped[machineSerial] || {
      states: [],
      counts: { all: [], valid: [], misfeed: [] },
      machineNames: {}
    };
  }

  module.exports = {
    // --- existing exports ---
    getActiveMachineSerials,
    extractAllCyclesFromStatesForDashboard,
    formatItemSummaryFromAggregation,
    formatItemHourlyStackFromAggregation,
    buildCurrentOperators,
    buildItemSummaryFromItemSessions,
    buildPerformanceByHour,
    // --- extracted from machineSessions.js ---
    normalizePPH,
    safeNumber,
    recalcSession,
    truncateAndRecalc,
    formatMachinesSummaryRow,
    groupRecordsBySerial,
    buildLatestTickerMap,
    buildPerformanceFromMachineRecord,
    buildItemSummaryFromRecords,
    buildItemHourlyStackFromRecords,
    buildOperatorEfficiencyFromRecords,
    queryMachinesSummaryDailyCache,
    queryMachinesSummarySessions,
    combineMachinesSummaryData,
    buildHybridMachinesSummary,
    queryMachineDailyCache,
    queryMachineSessions,
    combineMachineDashboardData,
    // Consolidated from machineDashboardBuilder.js
    buildMachinePerformance,
    buildMachineItemSummary,
    buildItemHourlyStack,
    buildFaultData,
    buildOperatorEfficiency,
    buildCurrentOperatorsFromTicker,
    getMachinesSummaryRealTime,
    // From bookendingBuilder.js
    getBookendedStatesAndTimeRange,
    // From fetchData.js
    fetchGroupedAnalyticsData,
    fetchGroupedAnalyticsDataForMachine,
  };
