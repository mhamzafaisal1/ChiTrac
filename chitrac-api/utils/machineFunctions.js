  const {
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    formatDuration,
    getStateCollectionName,
    SYSTEM_TIMEZONE,
  } = require("./time");
  const { DateTime, Interval } = require("luxon");
  const config = require("../modules/config");
  const { fetchGroupedAnalyticsData } = require("./fetchData");
  const {
    getBookendedStatesAndTimeRange,
  } = require("./bookendingBuilder");

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
  }) {
    const totalMs = Math.max(0, queryEnd - queryStart);
    const availability = totalMs
      ? Math.min(Math.max(runtimeMs / totalMs, 0), 1)
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

  function buildPerformanceFromMachineRecord(record) {
    const runtimeMs = safeNumber(record.runtimeMs);
    const pausedMs = safeNumber(record.pausedTimeMs);
    const faultMs = safeNumber(record.faultTimeMs);
    const downtimeMs = pausedMs + faultMs;
    const workedTimeMs = safeNumber(record.workedTimeMs);
    const timeCreditMs = safeNumber(record.totalTimeCreditMs);
    const totalCounts = safeNumber(record.totalCounts);
    const totalMisfeeds = safeNumber(record.totalMisfeeds);
    const totalOutput = totalCounts + totalMisfeeds;

    const windowMs =
      record.timeRange?.start && record.timeRange?.end
        ? Math.max(
            0,
            new Date(record.timeRange.end) - new Date(record.timeRange.start)
          )
        : runtimeMs + downtimeMs;

    const availability =
      windowMs > 0 ? Math.min(Math.max(runtimeMs / windowMs, 0), 1) : 0;
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

  function buildItemHourlyStackFromRecords(records, sessionStart) {
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
      const hour = typeof record.hour === 'number' ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
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

    if (hourMap.size === 0) {
      return {
        title: "Item Stacked Count Chart",
        data: { hours: [], items: {} },
      };
    }

    // Get all hours that have data and find the maximum
    const hoursWithData = Array.from(hourMap.keys()).sort((a, b) => a - b);
    const maxHour = Math.max(...hoursWithData);

    // Create array of all hours from 0 to maxHour (inclusive) to match expected format
    // This ensures hours start from 0 even if data doesn't exist for early hours
    const allHours = Array.from({ length: maxHour + 1 }, (_, idx) => idx);

    // Initialize items object with arrays filled with zeros
    const items = {};
    for (const name of itemNames) {
      items[name] = Array(allHours.length).fill(0);
    }

    // Fill in the actual counts
    for (const [hour, counts] of hourMap.entries()) {
      if (hour >= 0 && hour < allHours.length) {
        for (const [itemName, total] of Object.entries(counts)) {
          items[itemName][hour] = total;
        }
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

  function buildOperatorEfficiencyFromRecords(records, sessionStart) {
    if (!records.length) {
      return [];
    }

    // Group records by hour
    const hourMap = new Map();

    for (const record of records) {
      // Use the hour field directly from hourly-totals records
      const hour = typeof record.hour === 'number' ? record.hour : null;
      if (hour === null || hour < 0 || hour > 23) {
        continue; // Skip invalid hour records
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

    if (hourMap.size === 0) {
      return [];
    }

    // Convert to array format, sorted by hour
    const hours = Array.from(hourMap.keys()).sort((a, b) => a - b);
    const result = [];

    for (const hour of hours) {
      const hourData = hourMap.get(hour);
      const operators = Array.from(hourData.operators.values());

      // Calculate average efficiency for this hour from all operators
      const avgEfficiency = operators.length > 0
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
        operators: operators
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
  };
