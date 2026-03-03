const { DateTime, Interval } = require("luxon");
const { formatDuration, createPaddedTimeRange, getHourlyIntervals, SYSTEM_TIMEZONE, parseAndValidateQueryParams } = require("./time");
const { calculateEfficiency, calculateOEE, calculateOperatorTimes } = require('./analytics');
const { getValidCounts, getMisfeedCounts, groupCountsByItem, groupCountsByOperatorAndMachine, getCountsForMachine } = require("./count");
const {
  extractAllCyclesFromStates,
  fetchStatesForMachine,
  getAllMachinesFromStates,
  groupStatesByOperator,
  fetchAllStates,
  groupStatesByMachine,
  getAllMachinesFromStatesForOEE,
  fetchStatesForMachineForOEE
} = require("./state");
const {
  buildMachinePerformance,
  buildMachineItemSummary,
  buildItemHourlyStack,
  buildFaultData,
  buildOperatorEfficiency,
  fetchGroupedAnalyticsData,
  getBookendedStatesAndTimeRange,
} = require("./machineFunctions");
const {
  buildOperatorPerformance,
  buildOperatorCountByItem
} = require("./operatorFunctions");
const config = require("../modules/config");

// Used by daily-dashboard (6 charts) route: machines-group-summary-daily-cached
const MACHINE_GROUP_DEPARTMENTS = [
  "Small Piece Folder",
  "Large Piece Ironer",
  "Blanket Blaster",
  "Small Piece Ironer",
];

/** Previous calendar day (YYYY-MM-DD) for "yesterday" in same timezone context. Used by machines-group-summary-daily-cached. */
function previousDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildItemStackRelative(rows, startDate, endDate) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { title: "No data", data: { hours: [], operators: {} } };
  }
  const hourMs = 3600000;
  let maxIdx = -1;
  const series = new Map();

  for (const r of rows) {
    const ts = new Date(r.timestamp);
    if (ts < startDate || ts > endDate) continue;
    const idx = Math.floor((ts - startDate) / hourMs);
    if (idx > maxIdx) maxIdx = idx;
    const key = r.itemName || "Unknown";
    if (!series.has(key)) series.set(key, []);
    const arr = series.get(key);
    arr[idx] = (arr[idx] || 0) + 1;
  }

  const bins = maxIdx + 1;
  if (bins <= 0) return { title: "No data", data: { hours: [], operators: {} } };

  const hours = Array.from({ length: bins }, (_, i) => i);
  const operators = {};
  for (const [name, arr] of series.entries()) {
    const row = Array(bins).fill(0);
    for (let i = 0; i < arr.length; i++) if (typeof arr[i] === "number") row[i] = arr[i];
    operators[name] = row;
  }

  return { title: "Item Stacked Count Chart", data: { hours, operators } };
}

function isoHour(d) {
  return new Date(d).toISOString().slice(0, 13) + ":00:00.000Z";
}

function defaultCalcEfficiency(runtimeMs, validCount) {
  if (!runtimeMs) return 0;
  const cph = validCount * (3600000 / runtimeMs);
  return Math.min(1, cph / 600);
}

function reshapeItemHourly(itemHourlyStackRaw) {
  const hourSet = new Set();
  const perItem = new Map();
  for (const row of itemHourlyStackRaw) {
    const item = row._id.item ?? "Unknown";
    const hourKey = isoHour(row._id.hour);
    hourSet.add(hourKey);
    if (!perItem.has(item)) perItem.set(item, new Map());
    perItem.get(item).set(hourKey, row.count);
  }
  const hours = Array.from(hourSet).sort();
  const operators = {};
  for (const [item, m] of perItem) {
    operators[item] = hours.map(h => m.get(h) ?? 0);
  }
  return {
    title: "Item Counts by Hour (All Machines)",
    data: { hours, operators }
  };
}

function buildTopOperators(operatorRuntime, operatorCounts, calcEfficiencyFn = defaultCalcEfficiency) {
  const countsById = new Map(operatorCounts.map(o => [Number(o.id), o]));
  const rows = [];
  for (const r of operatorRuntime) {
    const id = Number(r.id);
    const c = countsById.get(id) || { validCount: 0, name: r.name };
    const runtime = r.runtime || 0;
    const valid = c.validCount || 0;
    const eff01 = calcEfficiencyFn(runtime, valid);
    rows.push({
      id,
      name: c.name || r.name || "Unknown",
      efficiency: +(eff01 * 100).toFixed(2),
      metrics: {
        runtime: { total: runtime, formatted: formatDuration(runtime) },
        output: { totalCount: valid, validCount: valid, misfeedCount: 0 }
      }
    });
  }
  rows.sort((a, b) => b.efficiency - a.efficiency);
  return rows.slice(0, 10);
}

function buildPlantwideHourly(
  hourlyRuntimeByMachine,
  countsByMachineHour,
  misfeedsByMachineHour = [],
  calcEfficiencyFn = defaultCalcEfficiency
) {
  const key = (serial, hour) => serial + "|" + isoHour(hour);
  const countsIdx = new Map();
  for (const r of countsByMachineHour) {
    countsIdx.set(key(r.serial, r.hour), r.valid || 0);
  }
  const misIdx = new Map();
  for (const r of misfeedsByMachineHour) {
    misIdx.set(key(r.serial, r.hour), r.misfeed || 0);
  }
  const byHour = new Map();
  for (const r of hourlyRuntimeByMachine) {
    const hourKey = isoHour(r.hour);
    if (!byHour.has(hourKey)) byHour.set(hourKey, []);
    byHour.get(hourKey).push(r);
  }
  const out = [];
  for (const [hourKey, rows] of byHour) {
    let totalRuntime = 0;
    let wAvail = 0, wEff = 0, wThru = 0, wOee = 0;
    for (const r of rows) {
      const k = key(r.serial, hourKey);
      const runtime = r.runtimeMs || 0;
      if (!runtime) continue;
      const runMs = r.runMs || 0;
      const valid = countsIdx.get(k) || 0;
      const mis = misIdx.get(k) || 0;
      const hourWindowMs = 3600000;
      const availability = hourWindowMs ? runMs / hourWindowMs : 0;
      const throughput = (valid + mis) > 0 ? valid / (valid + mis) : 0;
      const efficiency = calcEfficiencyFn(runtime, valid);
      const oee = availability * efficiency * throughput;
      totalRuntime += runtime;
      wAvail += availability * runtime;
      wEff += efficiency * runtime;
      wThru += throughput * runtime;
      wOee += oee * runtime;
    }
    if (totalRuntime > 0) {
      out.push({
        hour: new Date(hourKey).getHours(),
        availability: +((wAvail / totalRuntime) * 100).toFixed(2),
        efficiency: +((wEff / totalRuntime) * 100).toFixed(2),
        throughput: +((wThru / totalRuntime) * 100).toFixed(2),
        oee: +((wOee / totalRuntime) * 100).toFixed(2)
      });
    }
  }
  out.sort((a, b) => a.hour - b.hour);
  return out;
}

function shapeMachineOee(machineOeeBase) {
  const list = machineOeeBase.map(m => {
    const total = m.totalRuntime || (m.run + m.pause + m.fault) || 0;
    const oee = total ? (m.run / total) * 100 : 0;
    return { serial: m.serial, name: m.name || "Unknown", oee: +oee.toFixed(2) };
  });
  list.sort((a, b) => b.oee - a.oee);
  return list;
}

function splitTimeRangeForHybrid(exactStart, exactEnd) {
  const completeDays = [];
  const partialDays = [];
  const startOfDayStart = new Date(exactStart);
  startOfDayStart.setHours(0, 0, 0, 0);
  const startOfDayEnd = new Date(exactEnd);
  startOfDayEnd.setHours(0, 0, 0, 0);
  const startIsFullDay = exactStart.getTime() === startOfDayStart.getTime();
  const endOfDayEnd = new Date(startOfDayEnd);
  endOfDayEnd.setHours(23, 59, 59, 999);
  const endIsFullDay = exactEnd.getTime() >= endOfDayEnd.getTime();
  if (!startIsFullDay) {
    const endOfStartDay = new Date(startOfDayStart);
    endOfStartDay.setHours(23, 59, 59, 999);
    partialDays.push({
      start: exactStart,
      end: exactEnd < endOfStartDay ? exactEnd : endOfStartDay
    });
    startOfDayStart.setDate(startOfDayStart.getDate() + 1);
  }
  const currentDay = new Date(startOfDayStart);
  while (currentDay < startOfDayEnd) {
    completeDays.push({
      dateStr: currentDay.toISOString().split("T")[0],
      start: new Date(currentDay),
      end: new Date(currentDay.getTime() + 24 * 60 * 60 * 1000 - 1)
    });
    currentDay.setDate(currentDay.getDate() + 1);
  }
  if (!endIsFullDay && startOfDayEnd >= startOfDayStart) {
    const startOfEndDay = new Date(startOfDayEnd);
    startOfEndDay.setHours(0, 0, 0, 0);
    if (startOfEndDay.getTime() !== startOfDayStart.getTime() || startIsFullDay) {
      partialDays.push({ start: startOfEndDay, end: exactEnd });
    }
  }
  return { completeDays, partialDays };
}

function isToday(dateStr) {
  const today = new Date();
  const todayDateStr = today.toISOString().split("T")[0];
  return dateStr === todayDateStr;
}

function combineMachineResults(cachedResults, sessionResults, formatDurationFn) {
  const formatDur = formatDurationFn || formatDuration;
  const machineMap = new Map();
  for (const machine of cachedResults) {
    machineMap.set(machine.machine.serial, { ...machine });
  }
  for (const machine of sessionResults) {
    const serial = machine.machine.serial;
    if (machineMap.has(serial)) {
      const existing = machineMap.get(serial);
      existing.performance.output.totalCount += machine.performance?.output?.totalCount || 0;
      existing.performance.output.validCount += machine.performance?.output?.validCount || 0;
      existing.performance.output.misfeedCount += machine.performance?.output?.misfeedCount || 0;
      existing.performance.runtime.total += machine.performance?.runtime?.total || 0;
      existing.performance.workedTime.total += machine.performance?.workedTime?.total || 0;
      existing.performance.runtime.formatted = formatDur(existing.performance.runtime.total);
      existing.performance.workedTime.formatted = formatDur(existing.performance.workedTime.total);
      if (machine.itemSummary && Array.isArray(machine.itemSummary)) {
        existing.itemSummary = existing.itemSummary || [];
        existing.itemSummary.push(...machine.itemSummary);
      }
      if (machine.currentStatus) existing.currentStatus = machine.currentStatus;
    } else {
      machineMap.set(serial, machine);
    }
  }
  return Array.from(machineMap.values());
}

function combineOperatorResults(cachedResults, sessionResults, formatDurationFn) {
  const formatDur = formatDurationFn || formatDuration;
  const operatorMap = new Map();
  for (const operator of cachedResults) {
    operatorMap.set(operator.operator.id, { ...operator });
  }
  for (const operator of sessionResults) {
    const operatorId = operator.operator.id;
    if (operatorMap.has(operatorId)) {
      const existing = operatorMap.get(operatorId);
      existing.metrics.runtime.total += operator.metrics?.runtime?.total || 0;
      existing.metrics.runtime.formatted = formatDur(existing.metrics.runtime.total);
      if (operator.currentStatus) existing.currentStatus = operator.currentStatus;
      if (operator.countByItem && Array.isArray(operator.countByItem)) {
        existing.countByItem = existing.countByItem || [];
        existing.countByItem.push(...operator.countByItem);
      }
    } else {
      operatorMap.set(operatorId, operator);
    }
  }
  return Array.from(operatorMap.values());
}

function combineItemResults(cachedResults, sessionResults) {
  const itemMap = new Map();
  for (const item of cachedResults) {
    const key = item.itemName || item.itemId;
    itemMap.set(key, { ...item });
  }
  for (const item of sessionResults) {
    const key = item.itemName || item.itemId;
    if (itemMap.has(key)) {
      const existing = itemMap.get(key);
      existing.count += item.count || 0;
      const workedMs = (parseInt(existing.workedTimeFormatted) || 0) + (parseInt(item.workedTimeFormatted) || 0);
      const totalHours = workedMs / 3600000;
      existing.pph = totalHours > 0 ? existing.count / totalHours : 0;
      existing.efficiency = existing.standard > 0 ? (existing.pph / existing.standard) * 100 : 0;
      existing.pph = Math.round(existing.pph * 100) / 100;
      existing.efficiency = Math.round(existing.efficiency * 100) / 100;
    } else {
      itemMap.set(key, item);
    }
  }
  return Array.from(itemMap.values());
}

function _sessionSafe(n) {
  return typeof n === "number" && isFinite(n) ? n : 0;
}
function _sessionOverlap(sStart, sEnd, wStart, wEnd) {
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const factor = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor };
}

async function buildDailyMachineStatusFromSessions(db, dayStart, dayEnd) {
  const msColl = db.collection(config.machineSessionCollectionName);
  const fsColl = db.collection(config.faultSessionCollectionName);
  const serials = await msColl.distinct("machine.serial", {
    "timestamps.start": { $lt: dayEnd },
    $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
  });
  const perMachine = await Promise.all(serials.map(async (serial) => {
    const [msessions, fsessions] = await Promise.all([
      msColl.find({
        "machine.serial": serial,
        "timestamps.start": { $lt: dayEnd },
        $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
      }).project({ _id: 0, machine: 1, timestamps: 1, runtime: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1 }).toArray(),
      fsColl.find({
        "machine.serial": serial,
        "timestamps.start": { $lt: dayEnd },
        $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
      }).project({ _id: 0, timestamps: 1, faulttime: 1 }).toArray()
    ]);
    let runtimeSec = 0;
    for (const s of msessions) {
      const { factor } = _sessionOverlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
      runtimeSec += _sessionSafe(s.runtime) * factor;
    }
    let faultSec = 0;
    for (const fs of fsessions) {
      const sStart = fs.timestamps?.start;
      const sEnd = fs.timestamps?.end || dayEnd;
      const { ovSec, fullSec } = _sessionOverlap(sStart, sEnd, dayStart, dayEnd);
      if (ovSec === 0) continue;
      const ft = _sessionSafe(fs.faulttime);
      if (ft > 0 && fullSec > 0) faultSec += ft * (ovSec / fullSec);
      else faultSec += ovSec;
    }
    const windowMs = dayEnd - dayStart;
    const runningMs = Math.round(runtimeSec * 1000);
    const faultedMs = Math.round(faultSec * 1000);
    const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));
    return { serial, name: msessions[0]?.machine?.name || `Serial ${serial}`, runningMs, pausedMs: downtimeMs, faultedMs };
  }));
  return perMachine;
}

async function buildMachineOEEFromSessions(db, dayStart, dayEnd) {
  const msColl = db.collection(config.machineSessionCollectionName);
  const serialsFromSerial = await msColl.distinct("machine.serial", {
    "timestamps.start": { $lt: dayEnd },
    $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
  });
  const serialsFromId = await msColl.distinct("machine.id", {
    "timestamps.start": { $lt: dayEnd },
    $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
  });
  const serials = [...new Set([...serialsFromSerial, ...serialsFromId])].filter(Boolean);
  if (!serials.length) return [];
  const windowSec = (dayEnd - dayStart) / 1000;
  const rows = await Promise.all(serials.map(async (serial) => {
    const sessions = await msColl.find({
      $and: [
        { $or: [{ "machine.serial": serial }, { "machine.id": serial }] },
        { "timestamps.start": { $lt: dayEnd } },
        { $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }] }
      ]
    }).project({
      _id: 0, machine: 1, timestamps: 1, runtime: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1,
      "metrics.timers.run": 1, "metrics.timers.worked": 1, "metrics.totals.timeCredit": 1, "metrics.totals.counts.valid": 1, "metrics.totals.counts.misfeed": 1
    }).toArray();
    let runtimeSec = 0, workSec = 0, timeCreditSec = 0, totalCount = 0, misfeed = 0;
    for (const s of sessions) {
      const { factor } = _sessionOverlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
      const runtime = s.metrics?.timers?.run || s.runtime || 0;
      const worked = s.metrics?.timers?.worked || s.workTime || 0;
      const timeCredit = s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
      const validCount = s.metrics?.totals?.counts?.valid || s.totalCount || 0;
      const misfeedCount = s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;
      runtimeSec += _sessionSafe(runtime) * factor;
      workSec += _sessionSafe(worked) * factor;
      timeCreditSec += _sessionSafe(timeCredit) * factor;
      totalCount += _sessionSafe(validCount) * factor;
      misfeed += _sessionSafe(misfeedCount) * factor;
    }
    const availability = windowSec > 0 ? runtimeSec / windowSec : 0;
    const efficiency = workSec > 0 ? timeCreditSec / workSec : 0;
    const throughput = (totalCount + misfeed) > 0 ? totalCount / (totalCount + misfeed) : 0;
    const oee = availability * efficiency * throughput;
    return { serial, name: sessions[0]?.machine?.name || `Serial ${serial}`, oee: +(oee * 100).toFixed(2) };
  }));
  rows.sort((a, b) => b.oee - a.oee);
  return rows;
}

async function buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd) {
  const osColl = db.collection(config.operatorSessionCollectionName);
  const operators = await osColl.aggregate([
    { $match: {
      "timestamps.start": { $lt: dayEnd },
      $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }],
      "operator.id": { $exists: true, $ne: -1 }
    }},
    { $group: { _id: "$operator.id", name: { $first: "$operator.name" } } }
  ]).toArray();
  if (!operators.length) return [];
  const rows = await Promise.all(operators.map(async (op) => {
    const sessions = await osColl.find({
      "operator.id": op._id,
      "timestamps.start": { $lt: dayEnd },
      $or: [{ "timestamps.end": { $gt: dayStart } }, { "timestamps.end": { $exists: false } }, { "timestamps.end": null }]
    }).project({
      _id: 0, timestamps: 1, workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1,
      "metrics.timers.worked": 1, "metrics.totals.timeCredit": 1, "metrics.totals.counts.valid": 1, "metrics.totals.counts.misfeed": 1
    }).toArray();
    let workSec = 0, timeCreditSec = 0, totalCount = 0, misfeed = 0;
    for (const s of sessions) {
      const { factor } = _sessionOverlap(s.timestamps?.start, s.timestamps?.end, dayStart, dayEnd);
      const worked = s.metrics?.timers?.worked || s.workTime || 0;
      const timeCredit = s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
      const validCount = s.metrics?.totals?.counts?.valid || s.totalCount || 0;
      const misfeedCount = s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;
      workSec += _sessionSafe(worked) * factor;
      timeCreditSec += _sessionSafe(timeCredit) * factor;
      totalCount += _sessionSafe(validCount) * factor;
      misfeed += _sessionSafe(misfeedCount) * factor;
    }
    const efficiency = workSec > 0 ? timeCreditSec / workSec : 0;
    return {
      id: op._id,
      name: op.name || `#${op._id}`,
      efficiency: +(efficiency * 100).toFixed(2),
      metrics: {
        runtime: { total: Math.round(workSec * 1000), formatted: formatDuration(Math.round(workSec * 1000)) },
        output: {
          totalCount: Math.round(totalCount + misfeed),
          validCount: Math.round(totalCount),
          misfeedCount: Math.round(misfeed)
        }
      }
    };
  }));
  return rows.sort((a, b) => (b.efficiency - a.efficiency) || (a.id - b.id)).slice(0, 10);
}

async function computeMachineResults(db, start, end, serial) {
  const targetSerials = serial
    ? [serial]
    : await db.collection("machine").distinct("serial");
  const machineResults = [];
  for (const machineSerial of targetSerials) {
    const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
    if (!bookended) continue;
    const { sessionStart, sessionEnd, states } = bookended;
    const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
    const misfeeds = await getMisfeedCounts(db, machineSerial, sessionStart, sessionEnd);
    const performance = await buildMachinePerformance(states, counts, misfeeds, sessionStart, sessionEnd);
    const itemSummary = buildMachineItemSummary(states, counts, sessionStart, sessionEnd);
    const itemHourlyStack = buildItemHourlyStack(counts, sessionStart, sessionEnd);
    const faultData = buildFaultData(states, sessionStart, sessionEnd);
    const operatorEfficiency = await buildOperatorEfficiency(states, counts, sessionStart, sessionEnd, machineSerial);
    const latestState = states.at(-1);
    const machineName = latestState?.machine?.name || "Unknown";
    const statusCode = latestState?.status?.code || 0;
    const statusName = latestState?.status?.name || "Unknown";
    machineResults.push({
      machine: { serial: machineSerial, name: machineName },
      currentStatus: { code: statusCode, name: statusName },
      performance,
      itemSummary,
      itemHourlyStack,
      faultData,
      operatorEfficiency
    });
  }
  return machineResults;
}

async function computeItemSummaries(db, start, end, serial) {
  const targetSerials = serial ? [serial] : await db.collection("machine").distinct("serial");
  const items = [];
  for (const machineSerial of targetSerials) {
    const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
    if (!bookended) continue;
    const { sessionStart, sessionEnd, states } = bookended;
    const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
    const runCycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;
    const machineSummary = { totalCount: 0, totalWorkedMs: 0, itemSummaries: {} };
    for (const cycle of runCycles) {
      const cycleStart = new Date(cycle.start);
      const cycleEnd = new Date(cycle.end);
      const cycleMs = cycleEnd.getTime() - cycleStart.getTime();
      const cycleCounts = counts.filter(c => {
        const ts = new Date(c.timestamp);
        return ts >= cycleStart && ts <= cycleEnd;
      });
      if (!cycleCounts.length) continue;
      const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
      const workedTimeMs = cycleMs * Math.max(1, operators.size);
      const itemGroups = groupCountsByItem(cycleCounts);
      for (const [itemId, group] of Object.entries(itemGroups)) {
        const countTotal = group.length;
        const first = group[0];
        const standard = first?.item?.standard > 0 ? first.item.standard : 666;
        const name = first?.item?.name || "Unknown";
        if (!machineSummary.itemSummaries[itemId]) {
          machineSummary.itemSummaries[itemId] = { count: 0, standard, workedTimeMs: 0, name };
        }
        machineSummary.itemSummaries[itemId].count += countTotal;
        machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
        machineSummary.totalCount += countTotal;
        machineSummary.totalWorkedMs += workedTimeMs;
      }
    }
    for (const summary of Object.values(machineSummary.itemSummaries)) {
      const workedTimeFormatted = formatDuration(summary.workedTimeMs);
      const totalHours = summary.workedTimeMs / 3600000;
      const pph = totalHours > 0 ? summary.count / totalHours : 0;
      const efficiency = summary.standard > 0 ? pph / summary.standard : 0;
      items.push({
        itemName: summary.name,
        workedTimeFormatted,
        count: summary.count,
        pph: Math.round(pph * 100) / 100,
        standard: summary.standard,
        efficiency: Math.round(efficiency * 10000) / 100
      });
    }
  }
  return items;
}

async function computeOperatorResults(db, start, end) {
  const operatorGroupedData = await fetchGroupedAnalyticsData(db, start, end, "operator");
  const results = await Promise.all(
    Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
      const numericOperatorId = parseInt(operatorId, 10);
      const { states, counts } = group;
      if (!states.length && !counts.all.length) return null;
      const performance = await buildOperatorPerformance(states, counts.valid, counts.misfeed, start, end);
      const countByItem = await buildOperatorCountByItem(group, start, end);
      const operatorName = counts.valid[0]?.operator?.name || counts.all[0]?.operator?.name || "Unknown";
      const latest = states.at(-1) || {};
      return {
        operator: { id: numericOperatorId, name: operatorName },
        currentStatus: { code: latest.status?.code || 0, name: latest.status?.name || "Unknown" },
        metrics: {
          runtime: { total: performance.runtime.total, formatted: performance.runtime.formatted },
          performance: { efficiency: { value: performance.performance.efficiency.value, percentage: performance.performance.efficiency.percentage } }
        },
        countByItem
      };
    })
  );
  return results.filter(Boolean);
}

async function getCachedMachineResults(db, completeDays, serial) {
  const cacheCollection = db.collection("totals-daily");
  const dateStrings = completeDays.map(day => day.dateStr);
  const machineQuery = {
    entityType: "machine",
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { $in: dateStrings.map(d => new Date(d + "T00:00:00.000Z")) } }
    ]
  };
  if (serial) machineQuery.machineSerial = serial;
  const machineTotals = await cacheCollection.find(machineQuery).toArray();
  const machineResults = [];
  const machineMap = new Map();
  for (const record of machineTotals) {
    const s = record.machineSerial;
    if (!machineMap.has(s)) {
      machineMap.set(s, {
        machine: { serial: s, name: record.machineName || "Unknown" },
        currentStatus: { code: 0, name: "Unknown" },
        performance: {
          output: { totalCount: 0, validCount: 0, misfeedCount: 0 },
          runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          workedTime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          oee: { percentage: 0 },
          totalTimeCreditMs: 0,
          pausedTimeMs: 0,
          faultTimeMs: 0,
          windowMs: 0
        },
        itemSummary: [],
        itemHourlyStack: [],
        faultData: { faultSummaries: [], faultCycles: [] },
        operatorEfficiency: []
      });
    }
    const machine = machineMap.get(s);
    machine.performance.output.validCount += record.totalCounts || 0;
    machine.performance.output.totalCount += record.totalCounts || 0;
    machine.performance.output.misfeedCount += record.totalMisfeeds || 0;
    machine.performance.runtime.total += record.runtimeMs || 0;
    machine.performance.workedTime.total += record.workedTimeMs || 0;
    machine.performance.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    machine.performance.pausedTimeMs += record.pausedTimeMs || 0;
    machine.performance.faultTimeMs += record.faultTimeMs || 0;
    if (record.timeRange && record.timeRange.start && record.timeRange.end) {
      machine.performance.windowMs += new Date(record.timeRange.end) - new Date(record.timeRange.start);
    }
  }
  const machineSerials = Array.from(machineMap.keys()).map(n => Number(n));
  const tickers = await db
    .collection(config.stateTickerCollectionName)
    .find({ "machine.id": { $in: machineSerials } })
    .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
    .toArray();
  const latestTickers = new Map();
  tickers.forEach(t => {
    const id = Number(t.machine?.id);
    const ts = new Date(t.timestamp || 0);
    const existing = latestTickers.get(id);
    if (!existing || ts > new Date(existing.timestamp || 0)) latestTickers.set(id, t);
  });
  const statusMap = new Map();
  for (const [id, ticker] of latestTickers) {
    statusMap.set(id, {
      code: ticker.status?.code || 0,
      name: ticker.status?.name || "Unknown",
      color: ticker.status?.softrolColor || "None"
    });
  }
  for (const [s, machine] of machineMap) {
    machine.currentStatus = statusMap.get(Number(s)) || { code: 0, name: "Unknown" };
    const windowMs =
      machine.performance.windowMs ||
      machine.performance.runtime.total + machine.performance.pausedTimeMs + machine.performance.faultTimeMs;
    const availability =
      windowMs > 0 ? Math.min(Math.max(machine.performance.runtime.total / windowMs, 0), 1) : 0;
    const totalOutput = machine.performance.output.totalCount + machine.performance.output.misfeedCount;
    const throughput = totalOutput > 0 ? machine.performance.output.totalCount / totalOutput : 0;
    const workTimeSec = machine.performance.workedTime.total / 1000;
    const totalTimeCreditSec = machine.performance.totalTimeCreditMs / 1000;
    const efficiency = workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
    const oee = availability * throughput * efficiency;
    machine.performance.runtime.formatted = formatDuration(machine.performance.runtime.total);
    machine.performance.workedTime.formatted = formatDuration(machine.performance.workedTime.total);
    machine.performance.oee.percentage = parseFloat((oee * 100).toFixed(2));
    delete machine.performance.totalTimeCreditMs;
    delete machine.performance.pausedTimeMs;
    delete machine.performance.faultTimeMs;
    delete machine.performance.windowMs;
    machineResults.push(machine);
  }
  return machineResults;
}

async function getCachedOperatorResults(db, completeDays) {
  const cacheCollection = db.collection("totals-daily");
  const dateStrings = completeDays.map(day => day.dateStr);
  const operatorQuery = {
    entityType: "operator-machine",
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { $in: dateStrings.map(d => new Date(d + "T00:00:00.000Z")) } }
    ]
  };
  const cacheRecords = await cacheCollection.find(operatorQuery).toArray();
  if (!cacheRecords.length) return [];
  const machineSerials = [...new Set(cacheRecords.map(r => r.machineSerial).filter(Boolean))];
  const tickerSerialFilter = [...new Set([...machineSerials, ...machineSerials.map(String)])];
  const tickerQuery =
    tickerSerialFilter.length > 0
      ? {
          $or: [
            { "machine.serial": { $in: tickerSerialFilter } },
            { "machine.id": { $in: tickerSerialFilter } },
            { "machine.serial": { $in: tickerSerialFilter.map(Number).filter(n => !Number.isNaN(n)) } },
            { "machine.id": { $in: tickerSerialFilter.map(Number).filter(n => !Number.isNaN(n)) } }
          ]
        }
      : {};
  const stateTickerData = await db.collection(config.stateTickerCollectionName).find(tickerQuery).toArray();
  const operatorTickerMap = new Map();
  for (const stateRecord of stateTickerData) {
    const machine = stateRecord.machine || {};
    const status = stateRecord.status || {};
    const timestamp = new Date(
      status.timestamp ||
        stateRecord.timestamp ||
        (stateRecord.timestamps && (stateRecord.timestamps.update || stateRecord.timestamps.active || stateRecord.timestamps.create)) ||
        0
    ).getTime();
    if (Array.isArray(stateRecord.operators)) {
      for (const op of stateRecord.operators) {
        if (op == null || op.id == null) continue;
        const operatorKey = typeof op.id === "string" ? parseInt(op.id, 10) : op.id;
        if (Number.isNaN(operatorKey)) continue;
        const existing = operatorTickerMap.get(operatorKey);
        if (!existing || existing.timestamp < timestamp) {
          const serial = machine.serial ?? machine.id ?? machine.serialNumber ?? null;
          operatorTickerMap.set(operatorKey, {
            machine: serial != null ? { serial, name: machine.name || null } : null,
            status:
              status.code !== undefined || status.name !== undefined
                ? { code: status.code ?? null, name: status.name ?? null }
                : null,
            timestamp
          });
        }
      }
    }
  }
  const operatorMap = new Map();
  let totalWindowMs = 0;
  for (const day of completeDays) {
    totalWindowMs += new Date(day.end) - new Date(day.start);
  }
  for (const record of cacheRecords) {
    const opId = record.operatorId;
    if (!operatorMap.has(opId)) {
      operatorMap.set(opId, {
        operator: { id: record.operatorId, name: record.operatorName || "Unknown" },
        currentStatus: null,
        currentMachine: null,
        metrics: {
          runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
          output: { totalCount: 0, misfeedCount: 0 },
          performance: {
            availability: { value: 0, percentage: "0.00" },
            throughput: { value: 0, percentage: "0.00" },
            efficiency: { value: 0, percentage: "0.00" },
            oee: { value: 0, percentage: "0.00" }
          }
        },
        totalWindowMs,
        efficiencyData: []
      });
    }
    const operatorData = operatorMap.get(opId);
    const tickerContext = operatorTickerMap.get(opId);
    operatorData.currentMachine = tickerContext?.machine ?? null;
    operatorData.currentStatus = tickerContext?.status ?? null;
    const downtimeMs = record.pausedTimeMs + record.faultTimeMs;
    operatorData.metrics.runtime.total += record.runtimeMs || 0;
    operatorData.metrics.downtime.total += downtimeMs;
    operatorData.metrics.output.totalCount += record.totalCounts || 0;
    operatorData.metrics.output.misfeedCount += record.totalMisfeeds || 0;
    const workTimeSec = (record.workedTimeMs || 0) / 1000;
    const timeCreditSec = (record.totalTimeCreditMs || 0) / 1000;
    const efficiency = workTimeSec > 0 ? timeCreditSec / workTimeSec : 0;
    operatorData.efficiencyData.push({ efficiency, weight: record.workedTimeMs || 0 });
  }
  return Array.from(operatorMap.values()).map(operatorData => {
    const { runtime, downtime, output } = operatorData.metrics;
    const windowMs = operatorData.totalWindowMs || (runtime.total + downtime.total);
    const availability = windowMs > 0 ? runtime.total / windowMs : 0;
    const throughput =
      output.totalCount + output.misfeedCount > 0
        ? output.totalCount / (output.totalCount + output.misfeedCount)
        : 0;
    let totalWeightedEfficiency = 0,
      totalWeight = 0;
    for (const effData of operatorData.efficiencyData) {
      totalWeightedEfficiency += effData.efficiency * effData.weight;
      totalWeight += effData.weight;
    }
    const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
    const oee = availability * throughput * efficiency;
    operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
    operatorData.metrics.downtime.formatted = formatDuration(downtime.total);
    operatorData.metrics.performance = {
      availability: { value: availability, percentage: parseFloat((availability * 100).toFixed(2)) },
      throughput: { value: throughput, percentage: parseFloat((throughput * 100).toFixed(2)) },
      efficiency: { value: efficiency, percentage: parseFloat((efficiency * 100).toFixed(2)) },
      oee: { value: oee, percentage: parseFloat((oee * 100).toFixed(2)) }
    };
    delete operatorData.efficiencyData;
    delete operatorData.totalWindowMs;
    return operatorData;
  });
}

async function getCachedItemResults(db, completeDays, serial) {
  const cacheCollection = db.collection("totals-daily");
  const dateStrings = completeDays.map(day => day.dateStr);
  const itemQuery = {
    entityType: "item",
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: { $in: dateStrings.map(d => new Date(d + "T00:00:00.000Z")) } }
    ]
  };
  const itemTotals = await cacheCollection.find(itemQuery).toArray();
  const itemMap = new Map();
  for (const record of itemTotals) {
    const itemId = record.itemId;
    if (!itemMap.has(itemId)) {
      itemMap.set(itemId, {
        itemName: record.itemName || "Unknown",
        workedTimeFormatted: formatDuration(record.workedTimeMs || 0),
        count: 0,
        pph: 0,
        standard: record.itemStandard || 0,
        efficiency: 0
      });
    }
    const item = itemMap.get(itemId);
    item.count += record.totalCounts || 0;
    const workedMs = record.workedTimeMs || 0;
    const totalHours = workedMs / 3600000;
    item.pph = totalHours > 0 ? item.count / totalHours : 0;
    item.workedTimeFormatted = formatDuration(workedMs);
    item.efficiency = item.standard > 0 ? (item.pph / item.standard) * 100 : 0;
    item.pph = Math.round(item.pph * 100) / 100;
    item.efficiency = Math.round(item.efficiency * 100) / 100;
  }
  return Array.from(itemMap.values());
}

async function computeMachineResultsForPartialDays(db, partialDays, serial) {
  let allResults = [];
  for (const partialDay of partialDays) {
    const results = await computeMachineResults(db, partialDay.start.toISOString(), partialDay.end.toISOString(), serial);
    allResults = combineMachineResults(allResults, results);
  }
  return allResults;
}

async function computeOperatorResultsForPartialDays(db, partialDays) {
  let allResults = [];
  for (const partialDay of partialDays) {
    const results = await computeOperatorResults(db, partialDay.start.toISOString(), partialDay.end.toISOString());
    allResults = combineOperatorResults(allResults, results);
  }
  return allResults;
}

async function computeItemResultsForPartialDays(db, partialDays, serial) {
  let allResults = [];
  for (const partialDay of partialDays) {
    const results = await computeItemSummaries(db, partialDay.start.toISOString(), partialDay.end.toISOString(), serial);
    allResults = combineItemResults(allResults, results);
  }
  return allResults;
}

// --- Functions consolidated from dailyDashboardBuilder.js ---

async function buildMachineOEE(db, start, end) {
  try {
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
    const totalWindowMs = new Date(paddedEnd) - new Date(paddedStart);

    // Use OEE-specific functions that handle timestamps.create
    const machines = await getAllMachinesFromStatesForOEE(db, paddedStart, paddedEnd);
    const results = [];

    for (const machine of machines) {
      const states = await fetchStatesForMachineForOEE(db, machine.serial, paddedStart, paddedEnd);
      if (!states.length) continue;

      const cycles = extractAllCyclesFromStates(states, start, end);
      const workedTimeMs = cycles.running.reduce((sum, c) => sum + c.duration, 0);
      const totalRuntime = cycles.running.reduce((sum, c) => sum + c.duration, 0) +
                         cycles.paused.reduce((sum, c) => sum + c.duration, 0) +
                         cycles.fault.reduce((sum, c) => sum + c.duration, 0);
      const oee = (workedTimeMs / totalRuntime) * 100;

      results.push({
        serial: machine.serial,
        name: states[0].machine?.name || 'Unknown',
        oee: +oee.toFixed(2)
      });
    }

    // Sort descending
    results.sort((a, b) => b.oee - a.oee);

    return results;
  } catch (error) {
    console.error('Error in buildMachineOEE:', error);
    throw error;
  }
}

async function buildDailyItemHourlyStack(db, start, end) {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date range provided');
    }

    const pipeline = [
      {
        $match: {
          $or: [
            { timestamp: { $gte: startDate, $lte: endDate } },
            { "timestamps.create": { $gte: startDate, $lte: endDate } }
          ],
          misfeed: { $ne: true },
          'operator.id': { $exists: true, $ne: -1 }
        }
      },
      {
        $project: {
          itemName: { $ifNull: ["$item.name", "Unknown"] },
          hour: {
            $hour: {
              date: { $ifNull: ["$timestamp", "$timestamps.create"] },
              timezone: "America/Chicago"
            }  // Use timezone-aware hour extraction, handle both timestamp formats
          }

        }
      },
      {
        $group: {
          _id: { hour: "$hour", itemName: "$itemName" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.itemName": 1, "_id.hour": 1 } // Ensure stable order by item
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
        $sort: { "_id": 1 } // Final sort by item name
      }
    ];

    const results = await db.collection('count').aggregate(pipeline).toArray();

    const hourSet = new Set();
    const items = {};

    for (const result of results) {
      const itemName = result._id;
      items[itemName] = {};

      for (const entry of result.hourlyCounts) {
        hourSet.add(entry.hour);
        items[itemName][entry.hour] = entry.count;
      }
    }

    const hours = Array.from(hourSet).sort((a, b) => a - b);

    const finalizedItems = {};
    const sortedItemNames = Object.keys(items).sort(); // JS-side sorting for extra safety
    for (const itemName of sortedItemNames) {
      const hourCounts = items[itemName];
      finalizedItems[itemName] = hours.map(h => hourCounts[h] || 0);
    }

    if (hours.length === 0) {
      return {
        title: "No data",
        data: { hours: [], items: {} }
      };
    }

    return {
      title: "Item Counts by Hour (All Machines)",
      data: {
        hours,
        items: finalizedItems
      }
    };

  } catch (error) {
    console.error('Error in buildDailyItemHourlyStack:', error);
    throw error;
  }
}

async function buildTopOperatorEfficiency(db, start, end) {
  const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  const [counts, states] = await Promise.all([
    db.collection('count').aggregate([
      {
        $match: {
          timestamp: { $gte: paddedStart, $lte: paddedEnd },
          'operator.id': { $exists: true, $ne: -1 },
          misfeed: { $ne: true }
        }
      },
      {
        $group: {
          _id: '$operator.id',
          name: { $first: '$operator.name' },
          items: {
            $push: {
              item: '$item',
              timestamp: '$timestamp'
            }
          },
          totalCount: { $sum: 1 }
        }
      }
    ]).toArray(),
    fetchAllStates(db, paddedStart, paddedEnd)
  ]);

  if (!counts.length || !states.length) {
    return [];
  }

  const groupedStates = groupStatesByOperator(states);
  const operatorData = [];

  for (const count of counts) {
    const operatorId = parseInt(count._id);
    const name = count.name || 'Unknown';
    const stateGroup = groupedStates[operatorId]?.states || [];

    const validCounts = count.items.map(entry => ({
      item: entry.item,
      timestamp: entry.timestamp,
      misfeed: false
    }));

    const totalCount = validCounts.length;
    const runtime = calculateOperatorTimes(stateGroup, paddedStart, paddedEnd).runtime;
    const efficiency = calculateEfficiency(runtime, totalCount, validCounts);

    operatorData.push({
      id: operatorId,
      name,
      efficiency: +(efficiency * 100).toFixed(2),
      metrics: {
        runtime: {
          total: runtime,
          formatted: formatDuration(runtime)
        },
        output: {
          totalCount,
          validCount: totalCount,
          misfeedCount: 0
        }
      }
    });
  }

  return operatorData
    .sort((a, b) => b.efficiency - a.efficiency)
    .slice(0, 10);
}

// buildPlantwideMetricsByHour with machine-sessions version
async function buildPlantwideMetricsByHour(db, start, end) {

  const msColl = db.collection(config.machineSessionCollectionName);

  const wStart = new Date(start);
  const wEnd = new Date(end);

  // hour slots [start,end) using Luxon with SYSTEM_TIMEZONE
  const startDT = DateTime.fromJSDate(wStart, { zone: SYSTEM_TIMEZONE }).startOf("hour");
  const endDT = DateTime.fromJSDate(wEnd, { zone: SYSTEM_TIMEZONE }).endOf("hour");
  const intervals = Interval
    .fromDateTimes(startDT, endDT)
    .splitBy({ hours: 1 })
    .map(iv => ({
      start: iv.start.toJSDate(),
      end: iv.end.toJSDate(),
      hourDT: iv.start // Keep Luxon DateTime for timezone-aware hour extraction
    }));

  // Get total number of active machines for plantwide availability calculation
  const totalActiveMachines = await db.collection(config.machineCollectionName)
    .countDocuments({ active: true });

  // machines that ran today (overlapped any session) - used for querying data
  // Try both machine.serial and machine.id for backward compatibility
  const serialsFromSerial = await msColl.distinct("machine.serial", {
    "timestamps.start": { $lt: wEnd },
    $or: [
      { "timestamps.end": { $gt: wStart } },
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null }
    ]
  });

  const serialsFromId = await msColl.distinct("machine.id", {
    "timestamps.start": { $lt: wEnd },
    $or: [
      { "timestamps.end": { $gt: wStart } },
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null }
    ]
  });

  // Combine and deduplicate - these are machines with sessions (used for data queries)
  const machineSerials = [...new Set([...serialsFromSerial, ...serialsFromId])].filter(Boolean);

  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const overlapFactor = (sStart, sEnd, wStart, wEnd) => {
    if (!sStart) return { factor: 0 };
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ov = Math.max(0, (oe - os) / 1000);
    const full = Math.max(0, (se - ss) / 1000);
    return { factor: full > 0 ? ov / full : 0 };
  };
  const calcOEE = (a, e, t) => a * e * t;

  const hourlyMetrics = [];

  for (const iv of intervals) {
    const slotSec = (iv.end - iv.start) / 1000;

    // per-machine queries in parallel for this hour
    const machineRows = await Promise.all(machineSerials.map(async (serial) => {
      const sessions = await msColl.find({
        $and: [
          {
            $or: [
              { "machine.serial": serial },
              { "machine.id": serial }
            ]
          },
          { "timestamps.start": { $lt: iv.end } },
          {
            $or: [
              { "timestamps.end": { $gt: iv.start } },
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": null }
            ]
          }
        ]
      })
      .project({
        _id: 0,
        timestamps: 1,
        runtime: 1, workTime: 1, totalTimeCredit: 1,
        totalCount: 1, misfeedCount: 1,
        'metrics.timers.run': 1, 'metrics.timers.worked': 1, 'metrics.totals.timeCredit': 1,
        'metrics.totals.counts.valid': 1, 'metrics.totals.counts.misfeed': 1
      })
      .toArray();

      if (!sessions.length) return null;

      let runtimeSec = 0, workSec = 0, creditSec = 0, valid = 0, mis = 0;

      for (const s of sessions) {
        const { factor } = overlapFactor(s.timestamps?.start, s.timestamps?.end, iv.start, iv.end);
        if (factor <= 0) continue;

        // Try new structure first (metrics), then fall back to old structure
        const runtime = s.metrics?.timers?.run || s.runtime || 0;
        const worked = s.metrics?.timers?.worked || s.workTime || 0;
        const timeCredit = s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
        const validCount = s.metrics?.totals?.counts?.valid || s.totalCount || 0;
        const misfeedCount = s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;

        runtimeSec += safe(runtime)      * factor;
        workSec    += safe(worked)       * factor;
        creditSec  += safe(timeCredit)   * factor;
        valid      += safe(validCount)   * factor;
        mis        += safe(misfeedCount) * factor;
      }

      if (runtimeSec <= 0 && workSec <= 0 && (valid + mis) <= 0) return null;

      const availability = slotSec > 0 ? (runtimeSec / slotSec) : 0;
      const efficiency   = workSec  > 0 ? (creditSec / workSec) : 0;
      const throughput   = (valid + mis) > 0 ? (valid / (valid + mis)) : 0;
      const oee          = calcOEE(availability, efficiency, throughput);

      return { runtimeSec, workSec, creditSec, valid, mis, availability, efficiency, throughput, oee };
    }));

    // aggregate plantwide (runtime-weighted)
    let totalRuntime = 0, totalWorkSec = 0, totalCreditSec = 0, totalValid = 0, totalMis = 0;

    for (const r of machineRows) {
      if (!r) continue;
      totalRuntime  += r.runtimeSec;
      totalWorkSec  += r.workSec;
      totalCreditSec += r.creditSec;
      totalValid    += r.valid;
      totalMis      += r.mis;
    }

    // Extract hour in SYSTEM_TIMEZONE
    const hourInTimezone = iv.hourDT.hour; // Use Luxon DateTime to get hour in correct timezone

    // Calculate plantwide availability: total runtime / (total active machines * hour duration)
    const totalPossibleSec = totalActiveMachines * slotSec;
    const availability = totalPossibleSec > 0 ? (totalRuntime / totalPossibleSec) * 100 : 0;

    // Calculate efficiency from aggregated work time and time credit
    const efficiency = totalWorkSec > 0 ? (totalCreditSec / totalWorkSec) * 100 : 0;

    // Calculate throughput from aggregated counts
    const throughput = (totalValid + totalMis) > 0 ? (totalValid / (totalValid + totalMis)) * 100 : 0;

    // Calculate OEE = Availability * Efficiency * Throughput (all as ratios 0-1)
    const availRatio = availability / 100;
    const effRatio = efficiency / 100;
    const thruRatio = throughput / 100;
    const oee = +( (availRatio * effRatio * thruRatio) * 100 ).toFixed(2);

    // Include all hours in the range, even if metrics are all zero
    hourlyMetrics.push({
      hour: hourInTimezone,
      availability: +(availability.toFixed(2)),
      efficiency: +(efficiency.toFixed(2)),
      throughput: +(throughput.toFixed(2)),
      oee
    });
  }

  return hourlyMetrics;
}

// buildPlantwideMetricsByHour from hourly-totals cache
async function buildPlantwideMetricsByHourFromCache(db, start, end) {
  const wStart = new Date(start);
  const wEnd = new Date(end);

  // hour slots [start,end) using Luxon with SYSTEM_TIMEZONE
  const startDT = DateTime.fromJSDate(wStart, { zone: SYSTEM_TIMEZONE }).startOf("hour");
  const endDT = DateTime.fromJSDate(wEnd, { zone: SYSTEM_TIMEZONE }).endOf("hour");
  const intervals = Interval
    .fromDateTimes(startDT, endDT)
    .splitBy({ hours: 1 })
    .map(iv => ({
      start: iv.start.toJSDate(),
      end: iv.end.toJSDate(),
      hourDT: iv.start // Keep Luxon DateTime for timezone-aware hour extraction
    }));

  // Get total number of active machines for plantwide availability calculation
  const totalActiveMachines = await db.collection(config.machineCollectionName)
    .countDocuments({ active: true });

  // Get date strings for the time range
  const dateStrs = [];
  let currentDate = startDT.startOf('day');
  const endDate = endDT.startOf('day');
  while (currentDate <= endDate) {
    dateStrs.push(currentDate.toFormat('yyyy-LL-dd'));
    currentDate = currentDate.plus({ days: 1 });
  }

  // Query all machine hourly records from hourly-totals for the date range
  const machineHourlyRecords = await db.collection('hourly-totals')
    .find({
      entityType: 'machine',
      date: { $in: dateStrs }
    })
    .toArray();

  if (machineHourlyRecords.length === 0) {
    // Return empty metrics for all hours
    return intervals.map(iv => ({
      hour: iv.hourDT.hour,
      availability: 0,
      efficiency: 0,
      throughput: 0,
      oee: 0
    }));
  }

  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);

  // Group records by date-hour combination and aggregate across all machines
  const hourlyDataMap = new Map();

  // Initialize all intervals (date-hour combinations)
  for (const iv of intervals) {
    const dateStr = iv.hourDT.toFormat('yyyy-LL-dd');
    const hour = iv.hourDT.hour;
    const key = `${dateStr}-${hour}`;
    hourlyDataMap.set(key, {
      hour,
      totalRuntimeMs: 0,
      totalWorkedTimeMs: 0,
      totalTimeCreditMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
      machineCount: 0
    });
  }

  // Aggregate metrics by date-hour from hourly records
  for (const record of machineHourlyRecords) {
    const key = `${record.date}-${record.hour}`;
    if (!hourlyDataMap.has(key)) {
      // Skip hours outside the requested range
      continue;
    }

    const hourData = hourlyDataMap.get(key);
    hourData.totalRuntimeMs += safe(record.runtimeMs || 0);
    hourData.totalWorkedTimeMs += safe(record.workedTimeMs || 0);
    hourData.totalTimeCreditMs += safe(record.totalTimeCreditMs || 0);
    hourData.totalCounts += safe(record.totalCounts || 0);
    hourData.totalMisfeeds += safe(record.totalMisfeeds || 0);
    hourData.machineCount += 1;
  }

  // Calculate plantwide metrics for each hour
  const hourlyMetrics = [];
  const hourSlotSec = 3600; // 1 hour in seconds

  for (const iv of intervals) {
    const dateStr = iv.hourDT.toFormat('yyyy-LL-dd');
    const hour = iv.hourDT.hour;
    const key = `${dateStr}-${hour}`;
    const hourData = hourlyDataMap.get(key);

    if (!hourData || hourData.machineCount === 0) {
      // No data for this hour
      hourlyMetrics.push({
        hour,
        availability: 0,
        efficiency: 0,
        throughput: 0,
        oee: 0
      });
      continue;
    }

    // Calculate plantwide availability: total runtime / (total active machines * hour duration)
    const totalPossibleRuntimeMs = totalActiveMachines * hourSlotSec * 1000;
    const availability = totalPossibleRuntimeMs > 0
      ? (hourData.totalRuntimeMs / totalPossibleRuntimeMs) * 100
      : 0;

    // Calculate efficiency: total time credit / total worked time
    const totalWorkedTimeSec = hourData.totalWorkedTimeMs / 1000;
    const totalTimeCreditSec = hourData.totalTimeCreditMs / 1000;
    const efficiency = totalWorkedTimeSec > 0
      ? (totalTimeCreditSec / totalWorkedTimeSec) * 100
      : 0;

    // Calculate throughput: valid counts / total counts
    const totalOutput = hourData.totalCounts + hourData.totalMisfeeds;
    const throughput = totalOutput > 0
      ? (hourData.totalCounts / totalOutput) * 100
      : 0;

    // Calculate OEE = Availability * Efficiency * Throughput (all as ratios 0-1)
    const availRatio = availability / 100;
    const effRatio = efficiency / 100;
    const thruRatio = throughput / 100;
    const oee = +((availRatio * effRatio * thruRatio) * 100).toFixed(2);

    hourlyMetrics.push({
      hour,
      availability: +(availability.toFixed(2)),
      efficiency: +(efficiency.toFixed(2)),
      throughput: +(throughput.toFixed(2)),
      oee
    });
  }

  return hourlyMetrics;
}

async function buildDailyMachineStatus(db, start, end) {
  const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
  const machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
  const results = [];

  for (const machine of machines) {
    const states = await fetchStatesForMachine(db, machine.serial, paddedStart, paddedEnd);
    if (!states.length) continue;

    const cycles = extractAllCyclesFromStates(states, start, end);
    results.push({
      serial: machine.serial,
      name: states[0].machine?.name || "Unknown",
      runningMs: cycles.running.reduce((sum, c) => sum + c.duration, 0),
      pausedMs: cycles.paused.reduce((sum, c) => sum + c.duration, 0),
      faultedMs: cycles.fault.reduce((sum, c) => sum + c.duration, 0)
    });
  }

  return results;
}

async function buildDailyCountTotals(db, _start, end) {
  try {
    const endDate = new Date(end);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 27); // include 28 total days including endDate
    startDate.setHours(0, 0, 0, 0); // set to 12:00 AM

    const pipeline = [
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate },
          misfeed: { $ne: true },
          'operator.id': { $exists: true, $ne: -1 }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" }
          },
          count: { $sum: 1 },
          date: { $first: "$timestamp" }
        }
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day"
            }
          },
          count: 1
        }
      },
      {
        $sort: { date: 1 }
      }
    ];

    const results = await db.collection('count').aggregate(pipeline).toArray();

    return results.map(entry => ({
      date: entry.date.toISOString().split('T')[0],
      count: entry.count
    }));

  } catch (error) {
    console.error('Error in buildDailyCountTotals:', error);
    throw error;
  }
}

// --- Functions extracted from dailyDashboardSessionRoutesSplit.js ---

async function buildMachineOEEFromDailyTotals(db, dayStart, dayEnd, logger) {
  try {
    const dateStr = dayStart.toISOString().split('T')[0];

    const cacheRecords = await db
      .collection("totals-daily")
      .find({
        entityType: "machine",
        date: dateStr,
      })
      .toArray();

    if (cacheRecords.length === 0) {
      if (logger) logger.warn(
        `[dailyDashboard] No daily cached data found for date: ${dateStr}, falling back to session-based calculation`
      );
      return await buildMachineOEEFromSessions(db, dayStart, dayEnd);
    }

    const rows = cacheRecords.map((record) => {
      const timeRange = record.buildRange || record.timeRange;
      let windowMs = 0;
      if (timeRange && timeRange.start && timeRange.end) {
        windowMs = new Date(timeRange.end) - new Date(timeRange.start);
      } else {
        windowMs = dayEnd - dayStart;
      }

      const availability =
        windowMs > 0
          ? Math.min(Math.max(record.runtimeMs / windowMs, 0), 1)
          : 0;
      const totalOutput = record.totalCounts + record.totalMisfeeds;
      const throughput =
        totalOutput > 0 ? record.totalCounts / totalOutput : 0;

      let workTimeMs = record.workedTimeMs || 0;
      if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && record.runtimeMs > 0) {
        workTimeMs = record.runtimeMs;
      }
      const workTimeSec = workTimeMs / 1000;
      const totalTimeCreditSec = (record.totalTimeCreditMs || 0) / 1000;
      const efficiency =
        workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
      const oee = availability * throughput * efficiency;

      return {
        serial: record.machineSerial,
        name: record.machineName || `Serial ${record.machineSerial}`,
        oee: +(oee * 100).toFixed(2),
      };
    });

    rows.sort((a, b) => b.oee - a.oee);

    if (logger) logger.info(
      `[dailyDashboard] Retrieved ${rows.length} machine OEE records from cache for date: ${dateStr}`
    );
    return rows;
  } catch (error) {
    if (logger) logger.error('Error building machine OEE from daily totals:', error);
    return await buildMachineOEEFromSessions(db, dayStart, dayEnd);
  }
}

async function buildMachineStatusFromDailyTotals(db, dayStart, dayEnd, logger) {
  try {
    const dateStr = dayStart.toISOString().split('T')[0];
    const dayStartDate = new Date(dayStart);
    const dayEndDate = new Date(dayEnd);
    const windowMs = dayEndDate - dayStartDate;

    const dailyTotals = await db.collection('totals-daily').find({
      entityType: 'machine',
      date: dateStr
    }).sort({ machineSerial: 1 }).toArray();

    if (dailyTotals.length === 0) {
      if (logger) logger.warn('No daily totals found for machine status calculation');
      return [];
    }

    const pausedColl = config.pausedSessionCollectionName
      ? db.collection(config.pausedSessionCollectionName)
      : null;
    const pausedMsByMachine = new Map();

    if (pausedColl) {
      const pausedSessions = await pausedColl.find({
        'timestamps.start': { $lt: dayEndDate },
        $or: [
          { 'timestamps.end': { $gte: dayStartDate } },
          { 'timestamps.end': null },
          { 'timestamps.end': { $exists: false } }
        ]
      }).toArray();

      for (const s of pausedSessions) {
        const machineId = s.machine?.id ?? s.machine?.serial;
        if (machineId == null) continue;
        const sStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
        const sEnd = s.timestamps?.end ? new Date(s.timestamps.end) : dayEndDate;
        if (!sStart) continue;
        const { ovSec } = _sessionOverlap(sStart, sEnd, dayStartDate, dayEndDate);
        const key = String(machineId);
        pausedMsByMachine.set(key, (pausedMsByMachine.get(key) || 0) + Math.round(ovSec * 1000));
      }
    }

    const machineStatus = dailyTotals.map(total => {
      const runningMs = total.runtimeMs || 0;
      const faultedMs = total.faultTimeMs || 0;
      const serialKey = String(total.machineSerial);
      const pausedMs = pausedMsByMachine.get(serialKey) || 0;
      const offlineMs = Math.max(0, windowMs - runningMs - faultedMs - pausedMs);

      return {
        serial: total.machineSerial,
        name: total.machineName || `Serial ${total.machineSerial}`,
        runningMs,
        pausedMs,
        faultedMs,
        offlineMs
      };
    });

    if (logger) logger.info(`Built machine status from daily totals for ${machineStatus.length} machines`);
    return machineStatus;
  } catch (error) {
    if (logger) logger.error('Error building machine status from daily totals:', error);
    throw error;
  }
}

async function buildDailyCountTotalsFromCache(db, dayEnd, logger) {
  try {
    const endDate = new Date(dayEnd);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 27);
    startDate.setHours(0, 0, 0, 0);

    const pipeline = [
      {
        $match: {
          entityType: 'item',
          dateObj: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$date',
          count: { $sum: '$totalCounts' }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1
        }
      },
      {
        $sort: { date: 1 }
      }
    ];

    const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

    if (logger) logger.info(`Built daily count totals from cache for ${results.length} days`);
    return results;

  } catch (error) {
    if (logger) logger.error('Error building daily count totals from cache:', error);
    throw error;
  }
}

async function buildCountTotalsFromDailyTotals(db, dayEnd, logger) {
  try {
    const endDate = new Date(dayEnd);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 27);
    startDate.setHours(0, 0, 0, 0);

    const pipeline = [
      {
        $match: {
          entityType: 'machine',
          dateObj: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$date',
          count: { $sum: '$totalCounts' }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1
        }
      },
      {
        $sort: { date: 1 }
      }
    ];

    const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

    if (logger) logger.info(`Built daily count totals from machine records for ${results.length} days`);
    return results;

  } catch (error) {
    if (logger) logger.error('Error building count totals from daily totals:', error);
    throw error;
  }
}

async function buildTopOperatorEfficiencyFromCache(db, dayStart, dayEnd, logger) {
  try {
    const dateStr = dayStart.toISOString().split('T')[0];

    const latestRecord = await db.collection('totals-daily')
      .findOne(
        {
          entityType: 'operator-machine',
          date: dateStr,
          pollingCycleId: { $exists: true }
        },
        {
          sort: { lastUpdated: -1 },
          projection: { pollingCycleId: 1 }
        }
      );

    const matchStage = {
      entityType: 'operator-machine',
      date: dateStr
    };

    if (latestRecord?.pollingCycleId) {
      matchStage.pollingCycleId = latestRecord.pollingCycleId;
    }

    const pipeline = [
      {
        $match: matchStage
      },
      {
        $group: {
          _id: '$operatorId',
          name: { $first: '$operatorName' },
          totalWorkedTimeMs: { $sum: '$workedTimeMs' },
          totalTimeCreditMs: { $sum: '$totalTimeCreditMs' },
          totalCounts: { $sum: '$totalCounts' },
          totalMisfeeds: { $sum: '$totalMisfeeds' }
        }
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          name: 1,
          totalWorkedTimeMs: 1,
          totalTimeCreditMs: 1,
          totalCounts: 1,
          totalMisfeeds: 1
        }
      }
    ];

    const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

    if (results.length === 0) {
      if (logger) logger.warn('No operator-machine data found in daily cache');
      return [];
    }

    const operatorData = results.map(op => {
      const efficiency = op.totalWorkedTimeMs > 0 ? (op.totalTimeCreditMs / op.totalWorkedTimeMs) : 0;
      const roundedValid = Math.round(op.totalCounts);
      const roundedMisfeed = Math.round(op.totalMisfeeds);

      return {
        id: op.id,
        name: op.name || `#${op.id}`,
        efficiency: +(efficiency * 100).toFixed(2),
        metrics: {
          runtime: {
            total: op.totalWorkedTimeMs,
            formatted: formatDuration(op.totalWorkedTimeMs)
          },
          output: {
            totalCount: roundedValid + roundedMisfeed,
            validCount: roundedValid,
            misfeedCount: roundedMisfeed
          }
        }
      };
    });

    const topOperators = operatorData
      .sort((a, b) => {
        const effDiff = b.efficiency - a.efficiency;
        if (effDiff !== 0) return effDiff;
        return a.id - b.id;
      })
      .slice(0, 10);

    if (logger) logger.info(`Built top operator efficiency from cache for ${topOperators.length} operators`);
    return topOperators;

  } catch (error) {
    if (logger) logger.error('Error building top operator efficiency from cache:', error);
    throw error;
  }
}

async function buildItemHourlyStackFromCache(db, dayStart, dayEnd, logger) {
  try {
    const startDate = new Date(dayStart);
    const endDate = new Date(dayEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date range provided');
    }

    const dateStr = startDate.toISOString().split('T')[0];

    const pipeline = [
      {
        $match: {
          entityType: 'item',
          date: dateStr
        }
      },
      {
        $group: {
          _id: { hour: "$hour", itemName: "$itemName" },
          count: { $sum: "$totalCounts" }
        }
      },
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

    const results = await db.collection('hourly-totals').aggregate(pipeline).toArray();

    const hourSet = new Set();
    const items = {};

    for (const result of results) {
      const itemName = result._id;
      items[itemName] = {};

      for (const entry of result.hourlyCounts) {
        hourSet.add(entry.hour);
        items[itemName][entry.hour] = entry.count;
      }
    }

    const hours = Array.from(hourSet).sort((a, b) => a - b);

    const finalizedItems = {};
    const sortedItemNames = Object.keys(items).sort();
    for (const itemName of sortedItemNames) {
      const hourCounts = items[itemName];
      finalizedItems[itemName] = hours.map(h => hourCounts[h] || 0);
    }

    if (hours.length === 0) {
      return {
        title: "No data",
        data: { hours: [], items: {} }
      };
    }

    if (logger) logger.info(`Built item hourly stack from cache for ${hours.length} hours and ${sortedItemNames.length} items`);

    return {
      title: "Item Counts by Hour (All Machines)",
      data: {
        hours,
        items: finalizedItems
      }
    };

  } catch (error) {
    if (logger) logger.error('Error in buildItemHourlyStackFromCache:', error);
    throw error;
  }
}

async function buildItemTotalsFromCache(db, dayStart, dayEnd, logger) {
  try {
    const startDate = new Date(dayStart);
    const endDate = new Date(dayEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date range provided');
    }

    const dateStrings = [];
    const curr = new Date(startDate);
    curr.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    while (curr <= end) {
      dateStrings.push(curr.toISOString().split('T')[0]);
      curr.setDate(curr.getDate() + 1);
    }

    if (dateStrings.length === 0) {
      return { title: 'Item Totals by Type', items: [] };
    }

    const pipeline = [
      {
        $match: {
          entityType: 'item',
          date: { $in: dateStrings }
        }
      },
      {
        $group: {
          _id: '$itemName',
          totalCount: { $sum: '$totalCounts' }
        }
      },
      { $match: { totalCount: { $gt: 0 } } },
      { $sort: { _id: 1 } }
    ];

    const results = await db.collection('hourly-totals').aggregate(pipeline).toArray();

    const items = results.map(r => ({
      itemName: r._id,
      totalCount: r.totalCount
    }));

    if (logger) logger.info(`Built item totals from cache for range: ${dateStrings.length} day(s), ${items.length} items with count > 0`);

    return {
      title: 'Item Totals by Type',
      items
    };
  } catch (error) {
    if (logger) logger.error('Error in buildItemTotalsFromCache:', error);
    throw error;
  }
}

// --- Functions moved from demoFlipperBuilder.js (formerly utils/demoFlipperBuilder.js) ---
// Used for live operator efficiency summary and flipper-style outputs (per-operator efficiency for 6m, 15m, 1h, today).

async function buildLiveOperatorEfficiencySummary(states, counts, start, end, serial) {
  const relevantCounts = counts.filter(
    (c) =>
      c.machine?.serial === serial &&
      c.operator?.id &&
      new Date(c.timestamp) >= start &&
      new Date(c.timestamp) <= end
  );

  const groupedCounts = groupCountsByOperatorAndMachine(relevantCounts);
  const operatorIds = new Set(relevantCounts.map((c) => c.operator.id));
  const operatorSummaries = [];

  const now = new Date();
  const inputDate = new Date(end);

  const buildWindow = (minutesAgo) => {
    const start = new Date(
      inputDate.getFullYear(),
      inputDate.getMonth(),
      inputDate.getDate(),
      now.getHours(),
      now.getMinutes() - minutesAgo,
      now.getSeconds()
    );
    const end = new Date(
      inputDate.getFullYear(),
      inputDate.getMonth(),
      inputDate.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds()
    );
    return { start, end };
  };

  const timeWindows = {
    last6Min: buildWindow(6),
    last15Min: buildWindow(15),
    lastHour: buildWindow(60),
    allDay: { start, end }
  };

  for (const operatorId of operatorIds) {
    const key = `${operatorId}-${serial}`;
    const group = groupedCounts[key];
    if (!group || !group.validCounts.length) continue;

    const validCounts = group.validCounts;
    const misfeedCounts = group.misfeedCounts || [];
    const totalCounts = [...validCounts, ...misfeedCounts];
    const efficiencies = {};

    for (const [windowName, window] of Object.entries(timeWindows)) {
      const windowValidCounts = validCounts.filter(
        (c) => new Date(c.timestamp) >= window.start && new Date(c.timestamp) <= window.end
      );
      const windowMisfeedCounts = misfeedCounts.filter(
        (c) => new Date(c.timestamp) >= window.start && new Date(c.timestamp) <= window.end
      );
      const windowTotalCounts = [...windowValidCounts, ...windowMisfeedCounts];

      const windowStates = states.filter(
        (s) =>
          s.machine?.serial === serial &&
          new Date(s.timestamp) >= window.start &&
          new Date(s.timestamp) <= window.end
      );

      const runningCycles = extractAllCyclesFromStates(windowStates, window.start, window.end).running;
      const runtimeMs = runningCycles.reduce((sum, cycle) => sum + cycle.duration, 0);

      const efficiency = calculateEfficiency(runtimeMs, windowTotalCounts.length, windowValidCounts);

      efficiencies[windowName] = Math.round(efficiency * 10000) / 100;
    }

    const relevantStates = states
      .filter(
        (s) =>
          s.machine?.serial === serial &&
          Array.isArray(s.operators) &&
          s.operators.some((op) => op?.id === operatorId)
      )
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const mostRecent = relevantStates[0];
    const statusCode = mostRecent?.status?.code ?? 0;
    const statusName = mostRecent?.status?.name ?? "Unknown";

    const allDayValidCounts = validCounts.filter(
      (c) => new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
    );

    const itemNamesSet = new Set(allDayValidCounts.map((c) => c.item?.name).filter(Boolean));
    const itemsRunning = Array.from(itemNamesSet).join(", ");

    const operatorInfo = validCounts[0]?.operator || { id: operatorId, name: "Unknown" };

    operatorSummaries.push({
      status: statusCode,
      fault: statusName,
      operator: operatorInfo.name,
      operatorId: operatorInfo.id,
      machine: mostRecent?.machine?.name || "Unknown",
      timers: { on: 0, ready: 0 },
      displayTimers: { on: "", run: "" },
      efficiency: {
        lastFiveMinutes: {
          value: efficiencies.last6Min || efficiencies.last15Min || 0,
          label: "Current",
          color: "#008000"
        },
        lastFifteenMinutes: {
          value: efficiencies.last15Min || 0,
          label: "15 mins",
          color: "#008000"
        },
        lastHour: {
          value: efficiencies.lastHour || 0,
          label: "1 hr",
          color: "#F89406"
        },
        today: {
          value: efficiencies.allDay || 0,
          label: "Today",
          color: "#FF0000"
        }
      },
      batch: {
        item: itemsRunning || "Unknown"
      }
    });
  }

  return operatorSummaries;
}

async function getMostRecentStateForMachine(db, serial, dateStr) {
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);

  const now = new Date();
  const currentTimeOfDay = now.toISOString().split('T')[1];
  const endOfDay = new Date(`${dateStr}T${currentTimeOfDay}`);

  const query = {
    timestamp: { $gte: startOfDay, $lte: endOfDay },
    "machine.serial": parseInt(serial)
  };

  const state = await db.collection("stateTicker")
    .find(query)
    .sort({ timestamp: -1 })
    .limit(1)
    .project({
      timestamp: 1,
      'machine.serial': 1,
      'machine.name': 1,
      'program': 1,
      'status.code': 1,
      'status.name': 1,
      'status.softrolColor': 1,
      'operators': 1,
      'program': 1,
      'items': 1
    })
    .toArray();

  return state[0] || null;
}

function buildInitialFlipperOutputs(recentState) {
  if (!recentState || !Array.isArray(recentState.operators)) return [];

  const machineName = recentState.machine?.name || `Serial ${recentState.machine?.serial}`;
  const statusCode = recentState.status?.code ?? 0;
  const faultName = recentState.status?.name ?? "Unknown";
  const serial = recentState.machine?.serial;

  const outputs = [];
  for (const operator of recentState.operators) {
    if (operator.id === -1) continue;

    const shouldSkip = (serial === 67801 || serial === 67802) && operator.station === 2;
    if (shouldSkip) continue;

    outputs.push({
      status: statusCode,
      fault: faultName,
      operatorId: operator.id,
      machine: machineName
    });
  }

  return outputs;
}

async function computeEfficiencyForWindow(db, serial, operatorId, windowStart, windowEnd) {
  const allCounts = await getCountsForMachine(db, parseInt(serial), windowStart, windowEnd, operatorId);
  const grouped = groupCountsByOperatorAndMachine(allCounts);
  const key = `${operatorId}-${serial}`;

  const valid = grouped[key]?.validCounts || [];

  const machineStates = await fetchStatesForMachine(db, parseInt(serial), windowStart, windowEnd);
  const operatorStates = machineStates.filter((s) =>
    s.operators?.some((op) => Number(op.id) === Number(operatorId))
  );

  const runningCycles = extractAllCyclesFromStates(operatorStates, windowStart, windowEnd).running;
  const runtimeMs = runningCycles.reduce((sum, c) => sum + c.duration, 0);

  const efficiencyValue = calculateEfficiency(runtimeMs, valid.length, valid);

  return {
    value: Math.round(efficiencyValue * 100),
    color:
      efficiencyValue >= 0.9 ? "#008000" :
      efficiencyValue >= 0.7 ? "#F89406" : "#FF0000"
  };
}

function filterByTimeWindow(dataArray, start, end) {
  return dataArray.filter((entry) => {
    const ts = new Date(entry.timestamp);
    return ts >= start && ts <= end;
  });
}

module.exports = {
  buildItemStackRelative,
  isoHour,
  defaultCalcEfficiency,
  reshapeItemHourly,
  buildTopOperators,
  buildPlantwideHourly,
  shapeMachineOee,
  splitTimeRangeForHybrid,
  isToday,
  combineMachineResults,
  combineOperatorResults,
  combineItemResults,
  buildMachineOEE,
  buildDailyItemHourlyStack,
  buildTopOperatorEfficiency,
  buildDailyMachineStatus,
  buildPlantwideMetricsByHour,
  buildPlantwideMetricsByHourFromCache,
  buildDailyCountTotals,
  computeMachineResults,
  computeItemSummaries,
  computeOperatorResults,
  getCachedMachineResults,
  getCachedOperatorResults,
  getCachedItemResults,
  computeMachineResultsForPartialDays,
  computeOperatorResultsForPartialDays,
  computeItemResultsForPartialDays,
  buildDailyMachineStatusFromSessions,
  buildMachineOEEFromSessions,
  buildTopOperatorEfficiencyFromSessions,
  buildMachineOEEFromDailyTotals,
  buildMachineStatusFromDailyTotals,
  buildDailyCountTotalsFromCache,
  buildCountTotalsFromDailyTotals,
  buildTopOperatorEfficiencyFromCache,
  buildItemHourlyStackFromCache,
  buildItemTotalsFromCache,
  parseAndValidateQueryParams,
  previousDateStr,
  MACHINE_GROUP_DEPARTMENTS,
  // From demoFlipperBuilder.js
  buildLiveOperatorEfficiencySummary,
  getMostRecentStateForMachine,
  buildInitialFlipperOutputs,
  computeEfficiencyForWindow,
  filterByTimeWindow,
};
