const {
    extractAllCyclesFromStates,
    extractFaultCycles,
    fetchStatesForOperator,
    groupStatesByOperator,
    getCompletedCyclesForOperator,
    groupStatesByOperatorAndSerial,
  } = require("./state");
const {
    getStateCollectionName,
    getCountCollectionName,
    formatDuration,
    SYSTEM_TIMEZONE,
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    enforceMinimumTimeRange,
  } = require("./time");
const {
    calculateDowntime,
    calculateAvailability,
    calculateEfficiency,
    calculateOEE,
    calculateThroughput,
    calculateOperatorTimes,
    calculatePiecesPerHour,
    calculateTotalTimeCredits,
    calculateTimeCreditsByItem,
  } = require("./analytics");
const {
    getCountsForOperator,
    getValidCountsForOperator,
    getOperatorNameFromCount,
    processCountStatistics,
    groupCountsByItem,
    extractItemNamesFromCounts,
    groupCountsByOperatorAndMachine,
    getCountsForOperatorMachinePairs,
    groupCountsByOperator,
  } = require("./count");
const { DateTime, Interval } = require("luxon");
const config = require('../modules/config');


// ============================================================
// Existing functions
// ============================================================

async function getActiveOperatorIds(db, start, end) {
    const stateCollection = getStateCollectionName(start);
    return await db.collection(stateCollection).distinct("operators.id", {
      timestamp: { $gte: new Date(start), $lte: new Date(end) },
      "operators.id": { $ne: -1 },
    });
  }

  async function getCountsForSessions(db, operatorId, sessions) {
    const orConditions = sessions.map(s => ({
      timestamp: { $gte: new Date(s.start), $lte: new Date(s.end) }
    }));

    // Use the start time of the first session to determine collection
    const countCollection = getCountCollectionName(sessions[0]?.start || new Date());

    return await db.collection(countCollection)
      .find({
        $or: orConditions,
        "operator.id": operatorId,
      })
      .project({
        _id: 0,
        timestamp: 1,
        machine: 1,
        program: 1,
        operator: 1,
        item: 1,
        station: 1,
        lane: 1,
        misfeed: 1
      })
      .sort({ timestamp: 1 })
      .toArray();
  }


  function buildOperatorCyclePie(groupedEntryOrStates, start, end) {
    const states = Array.isArray(groupedEntryOrStates)
      ? groupedEntryOrStates
      : (groupedEntryOrStates?.states || []);
    const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);

    const runTime = running.reduce((sum, c) => sum + c.duration, 0);
    const pauseTime = paused.reduce((sum, c) => sum + c.duration, 0);
    const faultTime = fault.reduce((sum, c) => sum + c.duration, 0);
    const total = runTime + pauseTime + faultTime || 1;

    return [
      {
        name: "Running",
        value: Math.round((runTime / total) * 100),
      },
      {
        name: "Paused",
        value: Math.round((pauseTime / total) * 100),
      },
      {
        name: "Faulted",
        value: Math.round((faultTime / total) * 100),
      },
    ];
  }

  async function getAllOperatorIds(db) {
    const uniqueIds = await db.collection("count").distinct("operator.id", {
      "operator.id": { $exists: true, $ne: -1 }
    });
    return uniqueIds.filter((id) => typeof id === "number" && !isNaN(id));
  }

  async function buildOperatorPerformance(states, validCounts, misfeedCounts, start, end) {
    const totalCounts = [...validCounts, ...misfeedCounts];
    const stats = processCountStatistics(totalCounts);
    const { runtime, pausedTime, faultTime } = calculateOperatorTimes(states, start, end);
    const piecesPerHour = calculatePiecesPerHour(stats.total, runtime);
    const efficiency = calculateEfficiency(runtime, stats.total, validCounts);
    return {
      runtime: { total: runtime, formatted: formatDuration(runtime) },
      pausedTime: { total: pausedTime, formatted: formatDuration(pausedTime) },
      faultTime: { total: faultTime, formatted: formatDuration(faultTime) },
      output: {
        totalCount: stats.total,
        misfeedCount: stats.misfeeds,
        validCount: stats.valid
      },
      performance: {
        piecesPerHour: { value: piecesPerHour, formatted: Math.round(piecesPerHour).toString() },
        efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) + '%' }
      }
    };
  }

  async function buildOperatorItemSummary(states, counts, start, end, machineNameMap = {}) {
    const validCounts = counts.filter(c => !c.misfeed);
    const misfeedCounts = counts.filter(c => c.misfeed);
    const itemMap = groupCountsByItem(validCounts);
    const runCycles = getCompletedCyclesForOperator(states);
    const totalRunMs = runCycles.reduce((acc, cycle) => acc + (cycle.duration || 0), 0);
    const results = [];
    for (const itemId in itemMap) {
      const group = itemMap[itemId];
      const item = group[0]?.item || {};
      const operator = group[0]?.operator || {};
      const machineSerial = group[0]?.machine?.serial || 'Unknown';
      const machineName = machineNameMap[machineSerial] || 'Unknown';
      const count = group.length;
      const misfeeds = misfeedCounts.filter(m => m.item?.id === parseInt(itemId)).length;
      const hours = totalRunMs / 3600000;
      const pph = hours > 0 ? count / hours : 0;
      const standard = item.standard > 0 ? item.standard : 666;
      const efficiency = standard > 0 ? pph / standard : 0;
      results.push({
        operatorName: operator.name || 'Unknown',
        machineSerial,
        machineName,
        itemName: item.name || 'Unknown',
        workedTimeFormatted: formatDuration(totalRunMs),
        rawRunMs: totalRunMs,
        count,
        misfeed: misfeeds,
        pph: Math.round(pph * 100) / 100,
        standard,
        efficiency: Math.round(efficiency * 10000) / 100
      });
    }
    const consolidated = {};
    for (const row of results) {
      const key = `${row.operatorName}-${row.machineSerial}-${row.itemName}`;
      if (!consolidated[key]) {
        consolidated[key] = { ...row };
      } else {
        const existing = consolidated[key];
        existing.count += row.count;
        existing.misfeed += row.misfeed;
        existing.rawRunMs += row.rawRunMs;
        const totalHours = existing.rawRunMs / 3600000;
        existing.pph = Math.round((existing.count / totalHours) * 100) / 100;
        existing.efficiency = Math.round((existing.pph / existing.standard) * 10000) / 100;
        existing.workedTimeFormatted = formatDuration(existing.rawRunMs);
      }
    }
    return Object.values(consolidated);
  }

  function buildOperatorCountByItem(groupedEntry, start, end) {
    const { states = [], counts = {} } = groupedEntry;
    const completedCycles = getCompletedCyclesForOperator(states);
    const grouped = {};
    const itemsSet = new Set();
    for (const cycle of completedCycles) {
      const ts = new Date(cycle.start);
      const hour = ts.getHours();
      const cycleCounts = counts.all.filter(c => {
        const ts = new Date(c.timestamp);
        return ts >= new Date(cycle.start) && ts <= new Date(cycle.end);
      });
      const itemNames = extractItemNamesFromCounts(cycleCounts);
      const tasks = itemNames.split(',').map(t => t.trim());
      const perItemCount = Math.floor(cycleCounts.length / tasks.length || 1);
      for (const item of tasks) {
        itemsSet.add(item);
        if (!grouped[hour]) grouped[hour] = {};
        if (!grouped[hour][item]) grouped[hour][item] = 0;
        grouped[hour][item] += perItemCount;
      }
    }
    const fullHourRange = Array.from({ length: 24 }, (_, i) => i);
    const allItems = Array.from(itemsSet).sort();
    const operators = {};
    for (const item of allItems) {
      operators[item] = fullHourRange.map(hour => grouped[hour]?.[item] || 0);
    }
    return {
      title: 'Operator Counts by item',
      data: { hours: fullHourRange, operators }
    };
  }

  async function buildOperatorFaultHistory(grouped, start, end) {
    const allFaultCycles = [];
    const faultTypeMap = new Map();
    for (const [operatorId, group] of Object.entries(grouped)) {
      const states = group.states || [];
      const machineName = group.machine?.name || 'Unknown';
      const { faultCycles, faultSummaries } = extractFaultCycles(states, new Date(start), new Date(end));
      const machineFaultCycles = faultCycles.map(cycle => ({
        ...cycle,
        machineName,
        machineSerial: group.machine?.serial || 'Unknown',
        operatorName: group.operator?.name || 'Unknown',
        operatorId
      }));
      allFaultCycles.push(...machineFaultCycles);
      for (const summary of faultSummaries) {
        const key = summary.faultType;
        if (!faultTypeMap.has(key)) {
          faultTypeMap.set(key, { faultType: key, count: 0, totalDuration: 0 });
        }
        const existing = faultTypeMap.get(key);
        existing.count += summary.count;
        existing.totalDuration += summary.totalDuration;
      }
    }
    const faultSummaries = Array.from(faultTypeMap.values()).map(summary => {
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
    allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));
    return { faultCycles: allFaultCycles, faultSummaries };
  }

  async function buildOperatorEfficiencyLine(group, start, end, db) {
    const operatorId = group.operator?.id || group.counts?.valid?.[0]?.operator?.id;
    if (!operatorId) throw new Error("Operator ID missing in group");
    const endDate = new Date(end);
    let startDate = new Date(start);
    if (endDate - startDate < 7 * 86400000) {
      startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    }
    const [states, validCounts] = await Promise.all([
      fetchStatesForOperator(db, operatorId, startDate, endDate),
      getValidCountsForOperator(db, operatorId, startDate, endDate)
    ]);
    const days = [];
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dayStart = new Date(cursor);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCHours(23, 59, 59, 999);
      days.push({ start: new Date(dayStart), end: new Date(dayEnd) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const results = [];
    for (const day of days) {
      const dailyStates = states.filter(s => {
        const ts = new Date(s.timestamp);
        return ts >= day.start && ts <= day.end;
      });
      const dailyCounts = validCounts.filter(c => {
        const ts = new Date(c.timestamp);
        return ts >= day.start && ts <= day.end;
      });
      const runCycles = getCompletedCyclesForOperator(dailyStates);
      const totalRunTimeMs = runCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
      let avgStandard = 666;
      const standards = dailyCounts.map(c => c.item?.standard).filter(s => typeof s === 'number' && s > 0);
      if (standards.length) {
        avgStandard = standards.reduce((a, b) => a + b, 0) / standards.length;
      }
      const hours = totalRunTimeMs / 3600000;
      const pph = hours > 0 ? dailyCounts.length / hours : 0;
      const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;
      results.push({
        date: day.start.toISOString().split("T")[0],
        efficiency: Math.round(efficiency * 100) / 100,
      });
    }
    const operatorName = validCounts[0]?.operator?.name || group.operator?.name || "Unknown";
    return {
      operator: { id: operatorId, name: operatorName },
      timeRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        totalDays: results.length
      },
      data: results
    };
  }

  function buildOptimizedOperatorItemSummary(states, counts, start, end, machineNameMap = {}) {
    const validCounts = counts.filter(c => !c.misfeed);
    const misfeedMap = new Map();
    for (const c of counts) {
      if (c.misfeed && c.item?.id) {
        const id = c.item.id;
        misfeedMap.set(id, (misfeedMap.get(id) || 0) + 1);
      }
    }
    const itemMap = {};
    const runCycles = getCompletedCyclesForOperator(states);
    const totalRunMs = runCycles.reduce((sum, c) => sum + (c.duration || 0), 0);
    for (const count of validCounts) {
      const item = count.item || {};
      const operator = count.operator || {};
      const machineSerial = count.machine?.serial || 'Unknown';
      const machineName = machineNameMap[machineSerial] || 'Unknown';
      const itemId = item.id || -1;
      const itemName = item.name || 'Unknown';
      const standard = item.standard > 0 ? item.standard : 666;
      const operatorName = operator.name || 'Unknown';
      const key = `${operatorName}-${machineSerial}-${itemName}`;
      if (!itemMap[key]) {
        itemMap[key] = {
          operatorName,
          machineSerial,
          machineName,
          itemName,
          count: 0,
          misfeed: misfeedMap.get(itemId) || 0,
          rawRunMs: 0,
          standard
        };
      }
      itemMap[key].count += 1;
      itemMap[key].rawRunMs = totalRunMs;
    }
    const result = [];
    for (const row of Object.values(itemMap)) {
      const hours = row.rawRunMs / 3600000;
      const pph = hours > 0 ? row.count / hours : 0;
      const efficiency = row.standard > 0 ? pph / row.standard : 0;
      result.push({
        ...row,
        workedTimeFormatted: formatDuration(row.rawRunMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100
      });
    }
    return result;
  }

  function buildOptimizedOperatorCountByItem(allCounts, start, end) {
    const itemMap = {};
    const itemNames = new Set();
    for (const count of allCounts) {
      const item = count.item;
      const itemId = item?.id;
      if (!itemId) continue;
      const hour = new Date(count.timestamp).getUTCHours();
      const itemName = item.name || "Unknown";
      itemNames.add(itemName);
      if (!itemMap[itemId]) {
        itemMap[itemId] = {
          id: itemId,
          name: itemName,
          hourlyCounts: Array(24).fill(0),
          total: 0,
        };
      }
      itemMap[itemId].hourlyCounts[hour]++;
      itemMap[itemId].total++;
    }
    const operators = {};
    for (const [itemId, data] of Object.entries(itemMap)) {
      operators[data.name] = data.hourlyCounts;
    }
    return {
      title: 'Operator Counts by item',
      data: {
        hours: Array.from({ length: 24 }, (_, i) => i),
        operators
      }
    };
  }

  function buildOptimizedOperatorCyclePie(states, start, end) {
    const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);
    const runTime = running.reduce((sum, c) => sum + c.duration, 0);
    const pauseTime = paused.reduce((sum, c) => sum + c.duration, 0);
    const faultTime = fault.reduce((sum, c) => sum + c.duration, 0);
    const total = runTime + pauseTime + faultTime || 1;
    return [
      { name: "Running", value: Math.round((runTime / total) * 100) },
      { name: "Paused", value: Math.round((pauseTime / total) * 100) },
      { name: "Faulted", value: Math.round((faultTime / total) * 100) },
    ];
  }

  function buildOptimizedOperatorFaultHistory(groupedByOperator, start, end) {
    const allFaultCycles = [];
    const faultTypeMap = new Map();
    for (const [operatorId, group] of Object.entries(groupedByOperator)) {
      const states = group.states || [];
      const operatorName =
        group.counts?.valid?.[0]?.operator?.name ||
        group.counts?.all?.[0]?.operator?.name ||
        "Unknown";
      const machineSerial =
        group.counts?.valid?.[0]?.machine?.serial ||
        group.counts?.all?.[0]?.machine?.serial ||
        "Unknown";
      const machineName = group.machineNames?.[machineSerial] || "Unknown";
      const { faultCycles, faultSummaries } = extractFaultCycles(states, new Date(start), new Date(end));
      const enrichedFaultCycles = faultCycles.map(cycle => ({
        ...cycle,
        machineName,
        machineSerial,
        operatorName,
        operatorId
      }));
      allFaultCycles.push(...enrichedFaultCycles);
      for (const summary of faultSummaries) {
        const key = summary.faultType;
        if (!faultTypeMap.has(key)) {
          faultTypeMap.set(key, { faultType: key, count: 0, totalDuration: 0 });
        }
        const existing = faultTypeMap.get(key);
        existing.count += summary.count;
        existing.totalDuration += summary.totalDuration;
      }
    }
    const faultSummaries = Array.from(faultTypeMap.values()).map(summary => {
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
    allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));
    return {
      faultCycles: allFaultCycles,
      faultSummaries
    };
  }

  async function fetchOperatorDashboardData(db, start, end) {
    const operatorIds = await db.collection("count").distinct("operator.id", {
      timestamp: { $gte: new Date(start), $lte: new Date(end) },
      "operator.id": { $ne: null }
    });
    const results = await Promise.all(
      operatorIds.map(async (operatorId) => {
        const perfAgg = await db.collection("count").aggregate([
          { $match: {
            "operator.id": operatorId,
            timestamp: { $gte: new Date(start), $lte: new Date(end) }
          }},
          { $group: {
            _id: null,
            totalCount: { $sum: 1 },
            misfeedCount: { $sum: { $cond: [ { $eq: ["$misfeed", true] }, 1, 0 ] } },
            validCount: { $sum: { $cond: [ { $ne: ["$misfeed", true] }, 1, 0 ] } },
            firstOperator: { $first: "$operator" }
          }}
        ]).toArray();
        const perf = perfAgg[0] || {};
        const allStates = await db.collection("state").find({
          timestamp: { $gte: new Date(start), $lte: new Date(end) }
        }).sort({ timestamp: 1 }).toArray();
        const states = allStates.filter(s => s.operator && s.operator.id === operatorId);
        const { runtime, pausedTime, faultTime } = calculateOperatorTimes(states, start, end);
        const piecesPerHour = calculatePiecesPerHour(perf.totalCount || 0, runtime);
        const efficiency = calculateEfficiency(runtime, perf.totalCount || 0, perf.validCount || 0);
        const runCycles = getCompletedCyclesForOperator(states);
        const itemSummariesMerged = {};
        let totalWorkedMs = 0;
        let totalCount = 0;
        for (const cycle of runCycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;
          const items = await db.collection("count").aggregate([
            { $match: {
              "operator.id": operatorId,
              timestamp: { $gte: cycleStart, $lte: cycleEnd }
            }},
            { $group: {
              _id: "$item._id",
              name: { $first: "$item.name" },
              standard: { $first: { $ifNull: ["$item.standard", 666] } },
              count: { $sum: 1 },
              misfeed: { $sum: { $cond: [ { $eq: ["$misfeed", true] }, 1, 0 ] } }
            }},
            { $addFields: { workedTimeMs: cycleMs } }
          ]).toArray();
          for (const item of items) {
            if (!itemSummariesMerged[item._id]) {
              itemSummariesMerged[item._id] = {
                name: item.name,
                standard: item.standard,
                count: 0,
                misfeed: 0,
                workedTimeMs: 0
              };
            }
            itemSummariesMerged[item._id].count += item.count;
            itemSummariesMerged[item._id].misfeed += item.misfeed;
            itemSummariesMerged[item._id].workedTimeMs += item.workedTimeMs;
            totalCount += item.count;
            totalWorkedMs += item.workedTimeMs;
          }
        }
        const itemSummaries = Object.values(itemSummariesMerged).map(item => {
          const hours = item.workedTimeMs / 3600000;
          const pph = hours > 0 ? item.count / hours : 0;
          const efficiency = item.standard > 0 ? pph / item.standard : 0;
          return {
            name: item.name,
            standard: item.standard,
            count: item.count,
            misfeed: item.misfeed,
            workedTimeFormatted: formatDuration(item.workedTimeMs),
            pph: Math.round(pph * 100) / 100,
            efficiency: Math.round(efficiency * 10000) / 100
          };
        });
        const countByItemAgg = await db.collection("count").aggregate([
          { $match: {
            "operator.id": operatorId,
            timestamp: { $gte: new Date(start), $lte: new Date(end) }
          }},
          { $group: {
            _id: "$item._id",
            name: { $first: "$item.name" },
            standard: { $first: { $ifNull: ["$item.standard", 666] } },
            count: { $sum: 1 },
            misfeed: { $sum: { $cond: [ { $eq: ["$misfeed", true] }, 1, 0 ] } }
          }}
        ]).toArray();
        const countByItem = countByItemAgg.map(item => {
          const hours = runtime / 3600000;
          const pph = hours > 0 ? item.count / hours : 0;
          const efficiency = item.standard > 0 ? pph / item.standard : 0;
          return {
            name: item.name,
            standard: item.standard,
            count: item.count,
            misfeed: item.misfeed,
            pph: Math.round(pph * 100) / 100,
            efficiency: Math.round(efficiency * 10000) / 100
          };
        });
        const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);
        const totalCycleMs = [...running, ...paused, ...fault].reduce((sum, c) => sum + c.duration, 0) || 1;
        const cyclePie = [
          { name: 'Running', value: Math.round((running.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100) },
          { name: 'Paused', value: Math.round((paused.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100) },
          { name: 'Faulted', value: Math.round((fault.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100) }
        ];
        const { faultCycles, faultSummaries } = extractFaultCycles(states, start, end);
        const formattedFaultSummaries = (faultSummaries || []).map(summary => {
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
        const sortedFaultCycles = (faultCycles || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
        const dailyCountsAgg = await db.collection("count").aggregate([
          { $match: {
            "operator.id": operatorId,
            timestamp: { $gte: new Date(start), $lte: new Date(end) },
            misfeed: { $ne: true }
          }},
          { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            count: { $sum: 1 }
          }},
          { $sort: { _id: 1 } }
        ]).toArray();
        const dailyEfficiency = await Promise.all(dailyCountsAgg.map(async (day) => {
          const dayStart = new Date(day._id + 'T00:00:00.000Z');
          const dayEnd = new Date(day._id + 'T23:59:59.999Z');
          const dayStates = states.filter(s => new Date(s.timestamp) >= dayStart && new Date(s.timestamp) <= dayEnd);
          const { runtime } = calculateOperatorTimes(dayStates, dayStart, dayEnd);
          const hours = runtime / 3600000;
          const pph = hours > 0 ? day.count / hours : 0;
          let avgStandard = 666;
          if (day.count > 0) {
            const dayCounts = await db.collection("count").find({
              "operator.id": operatorId,
              timestamp: { $gte: dayStart, $lte: dayEnd },
              misfeed: { $ne: true }
            }).toArray();
            const standards = dayCounts.map(c => c.item?.standard).filter(s => typeof s === "number" && s > 0);
            if (standards.length > 0) {
              avgStandard = standards.reduce((sum, s) => sum + s, 0) / standards.length;
            }
          }
          const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;
          return {
            date: day._id,
            efficiency: Math.round(efficiency * 100) / 100
          };
        }));
        return {
          operator: { id: operatorId, name: perf.firstOperator?.name || "Unknown" },
          currentStatus: {
            code: states[states.length - 1]?.status?.code || 0,
            name: states[states.length - 1]?.status?.name || "Unknown"
          },
          performance: {
            runtime: { total: runtime, formatted: formatDuration(runtime) },
            pausedTime: { total: pausedTime, formatted: formatDuration(pausedTime) },
            faultTime: { total: faultTime, formatted: formatDuration(faultTime) },
            output: {
              totalCount: perf.totalCount || 0,
              misfeedCount: perf.misfeedCount || 0,
              validCount: perf.validCount || 0
            },
            performance: {
              piecesPerHour: { value: piecesPerHour, formatted: Math.round(piecesPerHour).toString() },
              efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) + "%" }
            }
          },
          itemSummary: itemSummaries,
          countByItem,
          cyclePie,
          faultHistory: {
            faultCycles: sortedFaultCycles,
            faultSummaries: formattedFaultSummaries
          },
          dailyEfficiency
        };
      })
    );
    return results;
  }

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


// ============================================================
// Helpers extracted from operatorSessions.js
// ============================================================

function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}

function normalizePPH(std) {
  const n = Number(std) || 0;
  return n > 0 && n < 60 ? n * 60 : n;
}

// Recompute metrics exactly like simulator's operator-session rules
function recalcOperatorSession(session, logger) {
  if (!session || !session.timestamps || !session.timestamps.start) {
    if (logger) logger.warn('Invalid session data for recalculation');
    return session;
  }

  const start = new Date(session.timestamps.start);
  const end = new Date(session.timestamps.end || new Date());
  const runtimeMs = Math.max(0, end - start);
  const runtimeSec = runtimeMs / 1000;

  // Operator-level work time == runtimeSec
  const workTimeSec = runtimeSec;

  const counts = Array.isArray(session.counts) ? session.counts : [];
  const misfeeds = Array.isArray(session.misfeeds) ? session.misfeeds : [];
  const totalCount = counts.length;
  const misfeedCount = misfeeds.length;

  // Calculate total time credit (simplified - count per-item and use per-item standards)
  let totalTimeCredit = 0;

  // 1. Count how many of each item were produced in the truncated window
  const perItemCounts = new Map(); // key: item.id
  for (const c of counts) {
    const id = c?.item?.id;
    if (id == null) continue;
    perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
  }

  // 2. Calculate time credit for each item based on its actual count and standard
  for (const [id, cnt] of perItemCounts) {
    // Find the standard for this specific item from session.items
    const item = session.items?.find(it => it && it.id === id);
    if (item && item.standard) {
      const pph = normalizePPH(item.standard);
      if (pph > 0) {
        totalTimeCredit += cnt / (pph / 3600); // seconds
      }
    }
  }

  session.runtime = runtimeMs / 1000;
  session.workTime = workTimeSec;
  session.totalCount = totalCount;
  session.misfeedCount = misfeedCount;
  session.totalTimeCredit = totalTimeCredit;
  return session;
}

// Truncate to [newStart, newEnd] and recompute
function truncateAndRecalcOperator(original, newStart, newEnd, logger) {
  if (!original || !original.timestamps) {
    if (logger) logger.warn('Invalid session for truncation');
    return original;
  }

  // Only clone what we need to modify
  const s = {
    ...original,
    timestamps: { ...original.timestamps },
    counts: [...(original.counts || [])],
    misfeeds: [...(original.misfeeds || [])]
  };

  const start = new Date(s.timestamps.start);
  const end = new Date(s.timestamps.end || new Date());

  const clampedStart = start < newStart ? newStart : start;
  const clampedEnd = end > newEnd ? newEnd : end;

  s.timestamps.start = clampedStart;
  s.timestamps.end = clampedEnd;

  const inWindow = (d) => {
    if (!d || !d.timestamp) return false;
    const ts = new Date(d.timestamp);
    return ts >= clampedStart && ts <= clampedEnd;
  };

  s.counts = s.counts.filter(inWindow);
  s.misfeeds = s.misfeeds.filter(inWindow);

  return recalcOperatorSession(s, logger);
}

/* ---------------- helpers (operator-machine-summary version) ---------------- */

function mergeIntervals(intervals) {
  const arr = intervals
    .map(iv => ({ s: new Date(iv.s).getTime(), e: new Date(iv.e).getTime() }))
    .filter(iv => Number.isFinite(iv.s) && Number.isFinite(iv.e) && iv.s < iv.e)
    .sort((a, b) => a.s - b.s);

  const out = [];
  for (const iv of arr) {
    if (!out.length || iv.s > out[out.length - 1].e) out.push({ ...iv });
    else out[out.length - 1].e = Math.max(out[out.length - 1].e, iv.e);
  }
  return out;
}

function overlapsAny(iv, merged) {
  const s = new Date(iv.s).getTime();
  const e = new Date(iv.e).getTime();
  if (!(s < e)) return false;
  // binary scan or linear; linear is fine for small lists
  for (const m of merged) {
    if (e <= m.s) break;
    if (s < m.e && e > m.s) return true;
  }
  return false;
}

function coalesceItems(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.id ?? '__null__';
    if (!map.has(key)) map.set(key, { id: it.id, name: it.name, standard: it.standard, totalCount: 0, totalTimeCredit: 0 });
    const curr = map.get(key);
    curr.totalCount += it.totalCount || 0;
    curr.totalTimeCredit += it.totalTimeCredit || 0;
  }
  // Remove null-id rows if any slipped in
  return Array.from(map.values()).filter(x => x.id != null);
}

// Helper function to query operators summary daily cache
async function queryOperatorsSummaryDailyCache(db, completeDays) {
  if (completeDays.length === 0) return [];

  const cacheCollection = db.collection('totals-daily');

  // Try multiple date formats to handle timezone variations
  const dateFormats = completeDays.flatMap(day => {
    const dateStr = day.dateStr;
    return [
      new Date(dateStr + 'T00:00:00.000Z'), // UTC midnight
      new Date(dateStr + 'T05:00:00.000Z'), // CST midnight (UTC+5)
      new Date(dateStr + 'T06:00:00.000Z'), // CDT midnight (UTC+6)
      dateStr, // String format
      new Date(dateStr) // Local timezone
    ];
  });

  const records = await cacheCollection.find({
    entityType: 'operator-machine',
    $or: [
      { dateObj: { $in: dateFormats } },
      { date: { $in: completeDays.map(d => d.dateStr) } }
    ]
  }).toArray();

  return records;
}

// Helper function to query operators summary sessions for partial days
async function queryOperatorsSummarySessions(db, logger, partialDays) {
  if (partialDays.length === 0) return [];

  const results = [];

  for (const partialDay of partialDays) {
    const collName = config.operatorSessionCollectionName;
    const coll = db.collection(collName);

    // Find operators that have at least one overlapping operator-session
    // Use proper overlap logic: session starts before window ends AND session ends after window starts
    const operatorIds = await coll.distinct("operator.id", {
      "operator.id": { $ne: -1 },
      "timestamps.start": { $lt: partialDay.end },
      $or: [
        { "timestamps.end": { $gt: partialDay.start } },
        { "timestamps.end": { $exists: false } } // Handle open sessions
      ]
    });

    if (!operatorIds.length) continue;

    logger.info(`[operatorSessions] Found ${operatorIds.length} operators for partial day:`, operatorIds);

    for (const opId of operatorIds) {
      try {
        // Pull all overlapping sessions for this operator
        // Use proper overlap logic: session starts before window ends AND session ends after window starts
        const sessions = await coll.find({
          "operator.id": opId,
          "timestamps.start": { $lt: partialDay.end },
          $or: [
            { "timestamps.end": { $gt: partialDay.start } },
            { "timestamps.end": { $exists: false } } // Handle open sessions
          ]
        })
          .sort({ "timestamps.start": 1 })
          .toArray();

        if (!sessions.length) continue;

        const mostRecent = sessions[sessions.length - 1];
        let currentMachine = {};
        let currentStatus = {};

        if (mostRecent.endState) {
          // Operator not currently running
          currentMachine = {
            serial: null,
            name: null
          };
          // Status schema uses 'id', but legacy code used 'code' - support both
          const statusId = mostRecent.endState?.status?.id ?? mostRecent.endState?.status?.code ?? 0;
          currentStatus = {
            code: statusId, // Use 'code' in API response for backward compatibility
            name: mostRecent.endState?.status?.name ?? "Unknown"
          };
        } else {
          currentMachine = {
            serial: mostRecent?.machine?.serial ?? null,
            name: mostRecent?.machine?.name ?? null
          };
          currentStatus = {
            code: 1,
            name: "Running"
          };
        }

        const operatorName = mostRecent?.operator?.name ?? sessions[0]?.operator?.name ?? "Unknown";

        // Truncate first if it starts before window
        if (sessions[0]) {
          const first = sessions[0];
          const firstStart = new Date(first.timestamps?.start);
          if (firstStart < partialDay.start) {
            sessions[0] = truncateAndRecalcOperator(first, partialDay.start, first.timestamps?.end ? new Date(first.timestamps.end) : partialDay.end, logger);
          }
        }

        // Truncate last if it ends after window (or is open)
        if (sessions.length > 0) {
          const lastIdx = sessions.length - 1;
          const last = sessions[lastIdx];
          const lastEnd = last.timestamps?.end ? new Date(last.timestamps.end) : null;

          if (!lastEnd || lastEnd > partialDay.end) {
            const effectiveEnd = lastEnd ? partialDay.end : partialDay.end;
            sessions[lastIdx] = truncateAndRecalcOperator(
              last,
              new Date(sessions[lastIdx].timestamps.start),
              effectiveEnd,
              logger
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
          runtimeMs += Math.floor(s.runtime) * 1000;
          workTimeSec += Math.floor(s.workTime);
          totalCount += s.totalCount;
          misfeedCount += s.misfeedCount;
          totalTimeCredit += s.totalTimeCredit;
        }

        const downtimeMs = Math.max(0, (partialDay.end - partialDay.start) - runtimeMs);

        results.push({
          operatorId: opId,
          operatorName,
          currentMachine,
          currentStatus,
          runtimeMs,
          downtimeMs,
          totalCount,
          misfeedCount,
          workTimeSec,
          totalTimeCredit,
          timeRange: {
            start: partialDay.start,
            end: partialDay.end,
            type: partialDay.type
          }
        });
      } catch (err) {
        logger.error(`Error processing operator ${opId} for partial day:`, err);
        continue;
      }
    }
  }

  return results;
}

// Helper function to combine operators summary data
function combineOperatorsSummaryData(dailyRecords, sessionData) {
  const combinedMap = new Map();

  // Add daily records (group by operator)
  for (const record of dailyRecords) {
    const operatorId = record.operatorId;

    if (!combinedMap.has(operatorId)) {
      // Format operator name from object (first + surname) or use string if already formatted
      const operatorNameStr = typeof record.operatorName === 'object' && record.operatorName !== null
        ? `${record.operatorName.first || ''} ${record.operatorName.surname || ''}`.trim() || "Unknown"
        : record.operatorName || "Unknown";

      combinedMap.set(operatorId, {
        operatorId,
        operatorName: operatorNameStr,
        currentMachine: {
          serial: record.machineSerial,
          name: record.machineName
        },
        currentStatus: {
          code: 1,
          name: "Running"
        },
        runtimeMs: 0,
        downtimeMs: 0,
        totalCount: 0,
        misfeedCount: 0,
        workTimeSec: 0,
        totalTimeCredit: 0
      });
    }

    const operator = combinedMap.get(operatorId);
    operator.runtimeMs += record.runtimeMs || 0;
    operator.downtimeMs += record.pausedTimeMs || 0; // pausedTimeMs from daily cache
    operator.totalCount += record.totalCounts || 0;
    operator.misfeedCount += record.totalMisfeeds || 0;
    operator.workTimeSec += (record.workedTimeMs || 0) / 1000; // Convert to seconds
    operator.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
  }

  // Add session data
  for (const session of sessionData) {
    const operatorId = session.operatorId;

    if (!combinedMap.has(operatorId)) {
      combinedMap.set(operatorId, {
        operatorId,
        operatorName: session.operatorName,
        currentMachine: session.currentMachine,
        currentStatus: session.currentStatus,
        runtimeMs: 0,
        downtimeMs: 0,
        totalCount: 0,
        misfeedCount: 0,
        workTimeSec: 0,
        totalTimeCredit: 0
      });
    }

    const operator = combinedMap.get(operatorId);
    operator.runtimeMs += session.runtimeMs || 0;
    operator.downtimeMs += session.downtimeMs || 0;
    operator.totalCount += session.totalCount || 0;
    operator.misfeedCount += session.misfeedCount || 0;
    operator.workTimeSec += session.workTimeSec || 0;
    operator.totalTimeCredit += session.totalTimeCredit || 0;

    // Update current machine and status from most recent session
    if (session.currentMachine?.serial) {
      operator.currentMachine = session.currentMachine;
    }
    if (session.currentStatus?.code !== undefined) {
      operator.currentStatus = session.currentStatus;
    }
  }

  // Calculate performance metrics for each operator
  for (const [operatorId, data] of combinedMap) {
    const totalMs = data.runtimeMs + data.downtimeMs;
    const availability = totalMs ? Math.min(Math.max(data.runtimeMs / totalMs, 0), 1) : 0;
    const throughput = (data.totalCount + data.misfeedCount) ? data.totalCount / (data.totalCount + data.misfeedCount) : 0;
    const efficiency = data.workTimeSec > 0 ? data.totalTimeCredit / data.workTimeSec : 0;
    const oee = availability * throughput * efficiency;

    data.availability = availability;
    data.throughput = throughput;
    data.efficiency = efficiency;
    data.oee = oee;
  }

  return combinedMap;
}

async function buildHybridOperatorsSummary(db, logger, exactStart, exactEnd) {
  const HYBRID_THRESHOLD_HOURS = 36; // Configurable threshold
  const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

  const startOfFirstDay = DateTime.fromJSDate(exactStart, { zone: SYSTEM_TIMEZONE }).startOf('day');
  const endOfLastDay = DateTime.fromJSDate(exactEnd, { zone: SYSTEM_TIMEZONE }).endOf('day');

  const completeDays = [];
  const partialDays = [];

  // Add complete days (full 24-hour periods)
  let currentDay = startOfFirstDay;
  while (currentDay < endOfLastDay) {
    const dayStart = currentDay.toJSDate();
    const dayEnd = currentDay.plus({ days: 1 }).startOf('day').toJSDate();

    // Only include if the day is completely within the query range
    if (dayStart >= exactStart && dayEnd <= exactEnd) {
      completeDays.push({
        start: dayStart,
        end: dayEnd,
        dateStr: currentDay.toFormat('yyyy-LL-dd')
      });
    }

    currentDay = currentDay.plus({ days: 1 });
  }

  // Add partial days (beginning and end of range)
  const nextDayStart = startOfFirstDay.plus({ days: 1 }).toJSDate();
  if (exactStart < nextDayStart) {
    const partialEnd = exactEnd < nextDayStart ? exactEnd : nextDayStart;
    if (partialEnd > exactStart) {
      partialDays.push({
        start: exactStart,
        end: partialEnd,
        type: 'start'
      });
    }
  }

  const previousDayEnd = endOfLastDay.minus({ days: 1 }).toJSDate();
  if (exactEnd > previousDayEnd) {
    const partialStart = exactStart > previousDayEnd ? exactStart : previousDayEnd;
    if (exactEnd > partialStart) {
      partialDays.push({
        start: partialStart,
        end: exactEnd,
        type: 'end'
      });
    }
  }

  // Remove duplicate partial days if they overlap
  if (partialDays.length === 2 &&
      partialDays[0].start.getTime() === partialDays[1].start.getTime() &&
      partialDays[0].end.getTime() === partialDays[1].end.getTime()) {
    partialDays.splice(1, 1);
  }

  // Query daily cache for complete days
  const dailyRecords = await queryOperatorsSummaryDailyCache(db, completeDays);
  logger.info(`[operatorSessions] Daily cache query returned ${dailyRecords.length} records`);

  // Query sessions for partial days
  const sessionData = await queryOperatorsSummarySessions(db, logger, partialDays);
  logger.info(`[operatorSessions] Session query returned ${sessionData.length} records`);

  // Combine the data
  const combinedData = combineOperatorsSummaryData(dailyRecords, sessionData);
  logger.info(`[operatorSessions] Combined data has ${combinedData.size} operators`);

  // Get current machine statuses from stateTicker collection
  const stateTickerData = await db.collection('stateTicker')
    .find({})
    .toArray();

  // Build operator ticker map (latest machine/status per operator)
  const operatorTickerMap = new Map();
  for (const stateRecord of stateTickerData) {
    const machine = stateRecord.machine || {};
    const status = stateRecord.status || {};
    const timestamp = new Date(
      status.timestamp ||
      stateRecord.timestamp ||
      (stateRecord.timestamps &&
        (stateRecord.timestamps.update ||
          stateRecord.timestamps.active ||
          stateRecord.timestamps.create)) ||
      0
    ).getTime();

    if (Array.isArray(stateRecord.operators)) {
      for (const op of stateRecord.operators) {
        if (!op || typeof op.id === "undefined" || op.id === null) {
          continue;
        }

        const operatorKey =
          typeof op.id === "string" ? Number.parseInt(op.id, 10) : op.id;

        if (Number.isNaN(operatorKey)) {
          continue;
        }

        const existing = operatorTickerMap.get(operatorKey);
        if (!existing || existing.timestamp < timestamp) {
          const serial =
            machine.serial ?? machine.id ?? machine.serialNumber ?? null;
          // Status schema uses 'id', but legacy code used 'code' - support both
          const statusId = status?.id ?? status?.code ?? null;
          operatorTickerMap.set(operatorKey, {
            machine:
              serial !== null && serial !== undefined
                ? {
                    serial,
                    name: machine.name || null
                  }
                : null,
            status:
              typeof statusId !== "undefined" && statusId !== null ||
              typeof status.name !== "undefined"
                ? {
                    code: statusId, // Use 'code' in API response for backward compatibility
                    name: status.name ?? null
                  }
                : null,
            timestamp
          });
        }
      }
    }
  }

  // Build final results
  const results = [];
  for (const [operatorId, data] of combinedData) {
    // Get current machine and status from ticker map
    const tickerContext = operatorTickerMap.get(operatorId);
    const currentMachine = tickerContext?.machine || data.currentMachine || null;
    const currentStatus = tickerContext?.status || data.currentStatus || { code: 0, name: "Unknown" };

    const result = {
      operator: {
        id: operatorId,
        name: data.operatorName
      },
      currentMachine,
      currentStatus,
      metrics: {
        runtime: {
          total: data.runtimeMs,
          formatted: formatDuration(data.runtimeMs)
        },
        downtime: {
          total: data.downtimeMs,
          formatted: formatDuration(data.downtimeMs)
        },
        output: {
          totalCount: data.totalCount,
          misfeedCount: data.misfeedCount
        },
        performance: {
          availability: {
            value: data.availability,
            percentage: (data.availability * 100).toFixed(2)
          },
          throughput: {
            value: data.throughput,
            percentage: (data.throughput * 100).toFixed(2)
          },
          efficiency: {
            value: data.efficiency,
            percentage: (data.efficiency * 100).toFixed(2)
          },
          oee: {
            value: data.oee,
            percentage: (data.oee * 100).toFixed(2)
          }
        }
      },
      timeRange: {
        start: exactStart,
        end: exactEnd
      }
    };

    results.push(result);
  }

  const metadata = {
    timeRange: {
      start: exactStart,
      end: exactEnd,
      hours: Math.round(timeRangeHours * 100) / 100
    },
    optimization: {
      used: true,
      approach: 'hybrid',
      thresholdHours: HYBRID_THRESHOLD_HOURS,
      timeRangeHours: Math.round(timeRangeHours * 100) / 100,
      completeDays: completeDays.length,
      partialDays: partialDays.length,
      dailyRecords: dailyRecords.length,
      sessionRecords: sessionData.length,
      performance: {
        estimatedSpeedup: `${Math.round((timeRangeHours / 24) * 10)}x faster for ${Math.round(timeRangeHours / 24)} days`
      }
    }
  };

  return { results, metadata };
}


// ============================================================
// Helpers extracted from operatorRoutes.js
// ============================================================

function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

// Optimized preprocessing function with minimal traversals
function preprocessOperatorData(states, validCounts, allCounts, start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Single-pass data extraction and grouping
  const data = {
    runningCycles: [],
    faultCycles: { faultCycles: [], faultSummaries: [] },
    hourlyCountsMap: new Map(),
    hourlyStatesMap: new Map(),
    itemHourMap: new Map(),
    cycleAssignments: new Map(),
    itemCountsMap: {},
    operatorMachineCountsMap: {},
    operatorCountsMap: {},
    itemNames: new Set(),
    totalRuntimeMs: 0,
    totalFaultMs: 0,
    totalCounts: { valid: validCounts.length, misfeed: 0, total: allCounts.length },
    operatorName: validCounts[0]?.operator?.name || allCounts[0]?.operator?.name || "Unknown",
    currentStatus: { code: 0, name: "Unknown" }
  };

  // Extract cycles and calculate totals in single pass
  if (states.length > 0) {
    const allCycles = extractAllCyclesFromStates(states, start, end);
    data.runningCycles = allCycles.running;
    data.faultCycles = extractFaultCycles(states, start, end);

    // Calculate totals
    data.totalRuntimeMs = data.runningCycles.reduce((sum, c) => sum + c.duration, 0);
    data.totalFaultMs = data.faultCycles.faultCycles.reduce((sum, c) => sum + c.duration, 0);
    data.currentStatus = {
      code: states[states.length - 1]?.status?.code || 0,
      name: states[states.length - 1]?.status?.name || "Unknown"
    };
  }

  // Single-pass count processing with optimized data structures
  const countIndex = new Map(); // timestamp -> count for O(1) cycle assignment
  const itemGroups = new Map(); // itemId -> { name, standard, count, items: [] }
  const operatorGroups = new Map(); // operatorId -> { counts: [], validCounts: [] }
  const operatorMachineGroups = new Map(); // "operatorId-machineId" -> { counts: [], validCounts: [] }

  for (const count of allCounts) {
    const ts = new Date(count.timestamp);
    const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));

    // Build hourly maps
    if (!data.hourlyCountsMap.has(hourIndex)) {
      data.hourlyCountsMap.set(hourIndex, []);
      data.itemHourMap.set(hourIndex, {});
    }
    data.hourlyCountsMap.get(hourIndex).push(count);

    const hourEntry = data.itemHourMap.get(hourIndex);
    const itemName = count.item?.name || "Unknown";
    hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
    data.itemNames.add(itemName);

    // Build item groups
    const itemId = count.item?.id || "unknown";
    if (!itemGroups.has(itemId)) {
      itemGroups.set(itemId, {
        name: itemName,
        standard: count.item?.standard || 666,
        count: 0,
        items: []
      });
    }
    const itemGroup = itemGroups.get(itemId);
    itemGroup.count++;
    itemGroup.items.push(count);

    // Build operator groups
    const operatorId = count.operator?.id;
    if (operatorId) {
      if (!operatorGroups.has(operatorId)) {
        operatorGroups.set(operatorId, { counts: [], validCounts: [] });
      }
      const opGroup = operatorGroups.get(operatorId);
      opGroup.counts.push(count);
      if (!count.misfeed) {
        opGroup.validCounts.push(count);
      }

      // Build operator-machine groups
      const machineId = count.machine?.serial;
      if (machineId) {
        const key = `${operatorId}-${machineId}`;
        if (!operatorMachineGroups.has(key)) {
          operatorMachineGroups.set(key, { counts: [], validCounts: [] });
        }
        const opMachineGroup = operatorMachineGroups.get(key);
        opMachineGroup.counts.push(count);
        if (!count.misfeed) {
          opMachineGroup.validCounts.push(count);
        }
      }
    }

    // Index for cycle assignment
    countIndex.set(count.timestamp, count);
  }

  // Single-pass state processing
  for (const state of states) {
    const ts = new Date(state.timestamp);
    const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));

    if (!data.hourlyStatesMap.has(hourIndex)) {
      data.hourlyStatesMap.set(hourIndex, []);
    }
    data.hourlyStatesMap.get(hourIndex).push(state);
  }

  // Optimized cycle assignment using indexed counts
  for (let i = 0; i < data.runningCycles.length; i++) {
    const cycle = data.runningCycles[i];
    const cycleStart = new Date(cycle.start);
    const cycleEnd = new Date(cycle.end);

    const cycleCounts = [];
    for (const [timestamp, count] of countIndex) {
      const ts = new Date(timestamp);
      if (ts >= cycleStart && ts <= cycleEnd) {
        cycleCounts.push(count);
      }
    }
    data.cycleAssignments.set(i, cycleCounts);
  }

  // Convert maps to expected format
  data.itemCountsMap = Object.fromEntries(itemGroups);
  data.operatorCountsMap = Object.fromEntries(operatorGroups);
  data.operatorMachineCountsMap = Object.fromEntries(operatorMachineGroups);
  data.itemNames = Array.from(data.itemNames);

  return data;
}

// MongoDB aggregation-based preprocessing for operator dashboard
async function preprocessOperatorDataAggregated(db, start, end) {
  const matchStage = {
    timestamp: { $gte: new Date(start), $lte: new Date(end) }
  };

  // Aggregate counts by operator
  const countPipeline = [
    { $match: matchStage },
    { $match: { "operator.id": { $exists: true, $ne: null, $ne: -1 } } },
    {
      $group: {
        _id: "$operator.id",
        operatorName: { $first: "$operator.name" },
        counts: { $push: "$$ROOT" },
        totalValid: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ["$operator.id", -1] }, { $ne: ["$misfeed", true] }] },
              1,
              0
            ]
          }
        },
        totalMisfeed: {
          $sum: {
            $cond: [{ $eq: ["$misfeed", true] }, 1, 0]
          }
        },
        itemSummary: {
          $push: {
            itemId: "$item.id",
            itemName: "$item.name",
            itemStandard: "$item.standard",
            machineSerial: "$machine.serial",
            timestamp: "$timestamp",
            misfeed: "$misfeed"
          }
        }
      }
    },
    {
      $project: {
        operatorName: 1,
        counts: {
          $map: {
            input: "$counts",
            as: "count",
            in: {
              timestamp: "$$count.timestamp",
              machine: {
                serial: "$$count.machine.serial"
              },
              operator: {
                id: "$$count.operator.id",
                name: "$$count.operator.name"
              },
              item: {
                id: "$$count.item.id",
                name: "$$count.item.name",
                standard: "$$count.item.standard"
              },
              misfeed: "$$count.misfeed"
            }
          }
        },
        totalValid: 1,
        totalMisfeed: 1,
        itemSummary: 1
      }
    }
  ];

  // For states, we need to get all states and then group by operator in JS
  // since states don't have operator.id field directly
  const states = await db.collection("state")
    .find(matchStage)
    .project({
      timestamp: 1,
      "machine.serial": 1,
      "machine.name": 1,
      "program.mode": 1,
      "status.code": 1,
      "status.name": 1,
      operators: 1
    })
    .sort({ timestamp: 1 })
    .toArray();

  const countResults = await db.collection("count").aggregate(countPipeline).toArray();

  // Group states by operator in JavaScript
  const stateGroups = {};
  for (const state of states) {
    if (state.operators && Array.isArray(state.operators)) {
      for (const operator of state.operators) {
        const operatorId = operator.id;
        if (!stateGroups[operatorId]) {
          stateGroups[operatorId] = {
            states: [],
            latestStatus: { code: 0, name: "Unknown" }
          };
        }

        // Transform state to match expected format
        const transformedState = {
          timestamp: state.timestamp,
          machine: {
            serial: state.machine?.serial,
            name: state.machine?.name
          },
          program: {
            mode: state.program?.mode
          },
          status: {
            code: state.status?.code,
            name: state.status?.name
          },
          operators: state.operators
        };

        stateGroups[operatorId].states.push(transformedState);

        // Update latest status
        if (state.status) {
          stateGroups[operatorId].latestStatus = {
            code: state.status.code || 0,
            name: state.status.name || "Unknown"
          };
        }
      }
    }
  }

  // Merge results by operator id
  const grouped = {};
  for (const result of countResults) {
    const operatorId = result._id;
    grouped[operatorId] = {
      operatorName: result.operatorName,
      counts: result.counts,
      totalValid: result.totalValid,
      totalMisfeed: result.totalMisfeed,
      itemSummary: result.itemSummary,
      states: stateGroups[operatorId]?.states || [],
      latestStatus: stateGroups[operatorId]?.latestStatus || { code: 0, name: "Unknown" }
    };
  }

  // Add operators that only have states but no counts
  for (const [operatorId, stateGroup] of Object.entries(stateGroups)) {
    if (!grouped[operatorId]) {
      grouped[operatorId] = {
        operatorName: "Unknown",
        counts: [],
        totalValid: 0,
        totalMisfeed: 0,
        itemSummary: [],
        states: stateGroup.states,
        latestStatus: stateGroup.latestStatus
      };
    }
  }

  return grouped;
}

// Optimized build functions using pre-calculated data
function buildOperatorPerformanceOptimized(preprocessedData, start, end) {
  const { totalRuntimeMs, totalCounts } = preprocessedData;
  const totalQueryMs = new Date(end) - new Date(start);
  const downtimeMs = calculateDowntime(totalQueryMs, totalRuntimeMs);

  const totalCount = totalCounts.total;
  const misfeedCount = totalCounts.total - totalCounts.valid;

  const availability = calculateAvailability(totalRuntimeMs, downtimeMs, totalQueryMs);
  const throughput = calculateThroughput(totalCounts.valid, misfeedCount);
  const efficiency = calculateEfficiency(totalRuntimeMs, totalCounts.valid, []);
  const oee = calculateOEE(availability, efficiency, throughput);

  return {
    runtime: {
      total: totalRuntimeMs,
      formatted: formatDuration(totalRuntimeMs),
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

function buildOperatorItemSummaryOptimized(preprocessedData, start, end) {
  const { runningCycles, cycleAssignments, itemCountsMap, totalRuntimeMs, totalCounts } = preprocessedData;

  if (!runningCycles.length) {
    return {
      sessions: [],
      operatorSummary: {
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

  const sessions = [];
  const formattedItemSummaries = {};

  // Build sessions using pre-assigned cycle counts
  for (let i = 0; i < runningCycles.length; i++) {
    const cycle = runningCycles[i];
    const cycleCounts = cycleAssignments.get(i) || [];

    if (!cycleCounts.length) continue;

    const cycleStart = new Date(cycle.start);
    const cycleEnd = new Date(cycle.end);
    const cycleMs = cycleEnd - cycleStart;

    const cycleItems = [];
    for (const [itemId, itemGroup] of Object.entries(itemCountsMap)) {
      const cycleItemCounts = itemGroup.items.filter(c => {
        const ts = new Date(c.timestamp);
        return ts >= cycleStart && ts <= cycleEnd;
      });

      if (cycleItemCounts.length === 0) continue;

      const name = itemGroup.name;
      const standard = itemGroup.standard;
      const countTotal = cycleItemCounts.length;

      const hours = cycleMs / 3600000;
      const pph = hours ? countTotal / hours : 0;
      const efficiency = standard ? pph / standard : 0;

      cycleItems.push({
        itemId: parseInt(itemId),
        name,
        countTotal,
        standard,
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(efficiency * 10000) / 100,
      });
    }

    sessions.push({
      start: cycleStart.toISOString(),
      end: cycleEnd.toISOString(),
      workedTimeMs: cycleMs,
      workedTimeFormatted: formatDuration(cycleMs),
      items: cycleItems,
    });
  }

  // Build item summaries from pre-grouped data
  for (const [itemId, itemGroup] of Object.entries(itemCountsMap)) {
    const hours = totalRuntimeMs / 3600000;
    const pph = hours ? itemGroup.count / hours : 0;
    const efficiency = itemGroup.standard ? pph / itemGroup.standard : 0;

    formattedItemSummaries[itemId] = {
      name: itemGroup.name,
      standard: itemGroup.standard,
      countTotal: itemGroup.count,
      workedTimeFormatted: formatDuration(totalRuntimeMs),
      pph: Math.round(pph * 100) / 100,
      efficiency: Math.round(efficiency * 10000) / 100,
    };
  }

  const totalHours = totalRuntimeMs / 3600000;
  const operatorPph = totalHours > 0 ? totalCounts.total / totalHours : 0;

  const proratedStandard = Object.values(itemCountsMap).reduce((acc, item) => {
    const weight = totalCounts.total > 0 ? item.count / totalCounts.total : 0;
    return acc + weight * item.standard;
  }, 0);

  const operatorEff = proratedStandard > 0 ? operatorPph / proratedStandard : 0;

  return {
    sessions,
    operatorSummary: {
      totalCount: totalCounts.total,
      workedTimeMs: totalRuntimeMs,
      workedTimeFormatted: formatDuration(totalRuntimeMs),
      pph: Math.round(operatorPph * 100) / 100,
      proratedStandard: Math.round(proratedStandard * 100) / 100,
      efficiency: Math.round(operatorEff * 10000) / 100,
      itemSummaries: formattedItemSummaries,
    },
  };
}

function buildOperatorCountByItemOptimized(preprocessedData, start, end) {
  const { itemCountsMap } = preprocessedData;

  if (!itemCountsMap || Object.keys(itemCountsMap).length === 0) {
    return {
      title: "No data",
      data: { items: [], counts: [] }
    };
  }

  const items = [];
  const counts = [];

  for (const [itemId, itemGroup] of Object.entries(itemCountsMap)) {
    items.push(itemGroup.name);
    counts.push(itemGroup.count);
  }

  return {
    title: "Count by Item",
    data: { items, counts }
  };
}

function buildOperatorCyclePieOptimized(preprocessedData, start, end) {
  const { totalRuntimeMs, totalFaultMs } = preprocessedData;
  const totalMs = new Date(end) - new Date(start);
  const otherMs = totalMs - totalRuntimeMs - totalFaultMs;

  return {
    title: "Cycle Distribution",
    data: {
      labels: ["Running", "Fault", "Other"],
      values: [totalRuntimeMs, totalFaultMs, otherMs],
      colors: ["#4CAF50", "#F44336", "#9E9E9E"]
    }
  };
}

function buildOperatorFaultHistoryOptimized(preprocessedData, start, end) {
  const { faultCycles } = preprocessedData;

  if (!faultCycles.faultCycles || !faultCycles.faultCycles.length) {
    return {
      faultCycles: [],
      faultSummaries: [],
    };
  }

  const formattedSummaries = faultCycles.faultSummaries.map((summary) => {
    const totalSeconds = Math.floor(summary.totalDuration / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      ...summary,
      formatted: { hours, minutes, seconds },
    };
  });

  const sortedFaultCycles = faultCycles.faultCycles.sort(
    (a, b) => new Date(a.start) - new Date(b.start)
  );

  return {
    faultCycles: sortedFaultCycles,
    faultSummaries: formattedSummaries,
  };
}


// ============================================================
// Helpers extracted from operatorDetails.js
// ============================================================

// Local utility helpers (re-defined to avoid circular deps with machineFunctions)
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
  return n > 0 && n < 60 ? n * 60 : n; // PPM -> PPH
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
      "machine.serial": 1,
      "machine.name": 1
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
async function buildOperatorCyclePieFromCache(db, logger, operatorId, start, end, serial = null) {
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
async function buildDailyEfficiencyFromCache(db, logger, operatorId, operatorName, start, end, serial = null, tz = "America/Chicago") {
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
async function buildItemHourlyStackFromCacheForOperator(db, logger, operatorId, start, end, serial = null) {
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


// ============================================================
// Module exports
// ============================================================

module.exports = {
    // Existing exports
    getActiveOperatorIds,
    getCountsForSessions,
    buildOperatorCyclePie,
    buildOptimizedOperatorFaultHistorySingle,
    // From operatorDashboardBuilder
    getAllOperatorIds,
    buildOperatorPerformance,
    buildOperatorItemSummary,
    buildOperatorCountByItem,
    buildOperatorFaultHistory,
    buildOperatorEfficiencyLine,
    buildOptimizedOperatorItemSummary,
    buildOptimizedOperatorCountByItem,
    buildOptimizedOperatorCyclePie,
    buildOptimizedOperatorFaultHistory,
    fetchOperatorDashboardData,
    // From operatorSessions.js
    clamp01,
    normalizePPH,
    recalcOperatorSession,
    truncateAndRecalcOperator,
    mergeIntervals,
    overlapsAny,
    coalesceItems,
    queryOperatorsSummaryDailyCache,
    queryOperatorsSummarySessions,
    combineOperatorsSummaryData,
    buildHybridOperatorsSummary,
    // From operatorRoutes.js
    chunkArray,
    preprocessOperatorData,
    preprocessOperatorDataAggregated,
    buildOperatorPerformanceOptimized,
    buildOperatorItemSummaryOptimized,
    buildOperatorCountByItemOptimized,
    buildOperatorCyclePieOptimized,
    buildOperatorFaultHistoryOptimized,
    // From operatorDetails.js
    buildDayBuckets,
    buildDailyEfficiencyFromOperatorSessions,
    buildItemSummaryFromItemSessions,
    buildDailyEfficiencyByHour,
    buildOperatorCyclePieFromCache,
    buildDailyEfficiencyFromCache,
    buildItemHourlyStackFromCacheForOperator,
    buildItemSummaryFromCache,
};
