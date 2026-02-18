const {
    parseAndValidateQueryParams,
    createPaddedTimeRange,
    formatDuration,
    enforceMinimumTimeRange
  } = require("./time");

  const {
    calculateDowntime,
    calculateAvailability,
    calculateEfficiency,
    calculateOEE,
    calculateThroughput,
    calculateTotalCount,
    calculateOperatorTimes,
    calculatePiecesPerHour,
    calculateTotalTimeCredits,
    calculateTimeCreditsByItem,
  } = require('./analytics');


  const { fetchStatesForOperator, groupStatesByOperator, getCompletedCyclesForOperator, extractAllCyclesFromStates, extractFaultCycles, fetchAllStates, groupStatesByOperatorAndSerial} = require('./state');

  const { getCountsForOperator, getValidCountsForOperator, getOperatorNameFromCount, processCountStatistics, groupCountsByItem, extractItemNamesFromCounts, groupCountsByOperatorAndMachine, getCountsForOperatorMachinePairs, groupCountsByOperator } = require('./count');


async function getAllOperatorIds(db) {
    const uniqueIds = await db.collection("count").distinct("operator.id", {
      "operator.id": { $exists: true, $ne: -1 }
    });
  
    return uniqueIds.filter((id) => typeof id === "number" && !isNaN(id));
  }
  
  
//   function formatDuration(ms) {
//     const totalMinutes = Math.floor(ms / 60000);
//     return {
//       hours: Math.floor(totalMinutes / 60),
//       minutes: totalMinutes % 60
//     };
//   }
  
  // async function buildOperatorPerformance(states, counts, start, end) {
  //   const stats = processCountStatistics(counts);
  //   const { runtime, pausedTime, faultTime } = calculateOperatorTimes(states, start, end);
  //   const piecesPerHour = calculatePiecesPerHour(stats.total, runtime);
  //   const efficiency = calculateEfficiency(runtime, stats.total, counts);
  
  //   return {
  //     runtime: {
  //       total: runtime,
  //       formatted: formatDuration(runtime)
  //     },
  //     pausedTime: {
  //       total: pausedTime,
  //       formatted: formatDuration(pausedTime)
  //     },
  //     faultTime: {
  //       total: faultTime,
  //       formatted: formatDuration(faultTime)
  //     },
  //     output: {
  //       totalCount: stats.total,
  //       misfeedCount: stats.misfeeds,
  //       validCount: stats.valid
  //     },
  //     performance: {
  //       piecesPerHour: {
  //         value: piecesPerHour,
  //         formatted: Math.round(piecesPerHour).toString()
  //       },
  //       efficiency: {
  //         value: efficiency,
  //         percentage: (efficiency * 100).toFixed(2) + '%'
  //       }
  //     }
  //   };
  // }

  async function buildOperatorPerformance(states, validCounts, misfeedCounts, start, end) {
    // ✅ Combine valid and misfeed counts for totals
    const totalCounts = [...validCounts, ...misfeedCounts];
    const stats = processCountStatistics(totalCounts);
  
    // ✅ Time calculations
    const { runtime, pausedTime, faultTime } = calculateOperatorTimes(states, start, end);
  
    // ✅ Calculate PPH and efficiency from filtered validCounts
    const piecesPerHour = calculatePiecesPerHour(stats.total, runtime);
    const efficiency = calculateEfficiency(runtime, stats.total, validCounts);
  
    return {
      runtime: {
        total: runtime,
        formatted: formatDuration(runtime)
      },
      pausedTime: {
        total: pausedTime,
        formatted: formatDuration(pausedTime)
      },
      faultTime: {
        total: faultTime,
        formatted: formatDuration(faultTime)
      },
      output: {
        totalCount: stats.total,
        misfeedCount: stats.misfeeds,
        validCount: stats.valid
      },
      performance: {
        piecesPerHour: {
          value: piecesPerHour,
          formatted: Math.round(piecesPerHour).toString()
        },
        efficiency: {
          value: efficiency,
          percentage: (efficiency * 100).toFixed(2) + '%'
        }
      }
    };
  }
  
  
  // async function buildOperatorItemSummary(states, counts, start, end) {
  //   const validCounts = counts.filter(c => !c.misfeed);
  //   const misfeedCounts = counts.filter(c => c.misfeed);
  //   const itemMap = groupCountsByItem(validCounts);
  //   const runCycles = getCompletedCyclesForOperator(states);
  //   const totalRunMs = runCycles.reduce((acc, cycle) => acc + (cycle.duration || 0), 0);
  
  //   const results = [];
  
  //   for (const itemId in itemMap) {
  //     const group = itemMap[itemId];
  //     const item = group[0]?.item || {};
  //     const count = group.length;
  //     const misfeeds = misfeedCounts.filter(m => m.item?.id === parseInt(itemId)).length;
  //     const hours = totalRunMs / 3600000;
  //     const pph = hours > 0 ? count / hours : 0;
  //     const standard = item.standard > 0 ? item.standard : 666;
  //     const efficiency = standard > 0 ? pph / standard : 0;
  
  //     results.push({
  //       operatorName: group[0]?.operator?.name || 'Unknown',
  //       machineName: group[0]?.machine?.name || 'Unknown',
  //       itemName: item?.name || 'Unknown',
  //       workedTimeFormatted: formatDuration(totalRunMs),
  //       count,
  //       misfeed: misfeeds,
  //       pph: Math.round(pph * 100) / 100,
  //       standard,
  //       efficiency: Math.round(efficiency * 10000) / 100
  //     });
  //   }

  //   // Consolidate duplicate rows
  //   const consolidated = {};
  //   for (const row of results) {
  //     const key = `${row.operatorName}-${row.machineName}-${row.itemName}`;
  //     if (!consolidated[key]) {
  //       consolidated[key] = { ...row };
  //     } else {
  //       const existing = consolidated[key];
  //       existing.count += row.count;
  //       existing.misfeed += row.misfeed;

  //       const existingMs = (existing.workedTimeFormatted.hours * 60 + existing.workedTimeFormatted.minutes) * 60000;
  //       const newMs = (row.workedTimeFormatted.hours * 60 + row.workedTimeFormatted.minutes) * 60000;
  //       const totalMs = existingMs + newMs;

  //       const totalMinutes = Math.floor(totalMs / 60000);
  //       existing.workedTimeFormatted = {
  //         hours: Math.floor(totalMinutes / 60),
  //         minutes: totalMinutes % 60
  //       };

  //       const totalHours = totalMs / 3600000;
  //       existing.pph = Math.round((existing.count / totalHours) * 100) / 100;
  //       existing.efficiency = Math.round((existing.pph / existing.standard) * 10000) / 100;
  //     }
  //   }
  
  //   return Object.values(consolidated);
  // }
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
  
  
  
  // async function buildOperatorCountByItem(states, counts, start, end) {
  //   const completedCycles = getCompletedCyclesForOperator(states);
  //   const grouped = {};
  //   const itemsSet = new Set();
  
  //   for (const cycle of completedCycles) {
  //     const ts = new Date(cycle.start);
  //     const hour = ts.getHours();
  
  //     const cycleCounts = counts.filter(c => new Date(c.timestamp) >= new Date(cycle.start) && new Date(c.timestamp) <= new Date(cycle.end));
  //     const itemNames = extractItemNamesFromCounts(cycleCounts);
  //     const tasks = itemNames.split(',').map(t => t.trim());
  //     const perItemCount = Math.floor(cycleCounts.length / tasks.length);
  
  //     tasks.forEach(item => {
  //       itemsSet.add(item);
  //       if (!grouped[hour]) grouped[hour] = {};
  //       if (!grouped[hour][item]) grouped[hour][item] = 0;
  //       grouped[hour][item] += perItemCount;
  //     });
  //   }
  
  //   const fullHourRange = Array.from({ length: 24 }, (_, i) => i);
  //   const allItems = Array.from(itemsSet).sort();
  //   const operators = {};
  
  //   allItems.forEach(item => {
  //     operators[item] = fullHourRange.map(hour => grouped[hour]?.[item] || 0);
  //   });
  
  //   return {
  //     title: 'Operator Counts by item',
  //     data: {
  //       hours: fullHourRange,
  //       operators
  //     }
  //   };
  // }

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
      data: {
        hours: fullHourRange,
        operators
      }
    };
  }
  
  
  // async function buildOperatorCyclePie(states, start, end) {
  //   const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);
  //   const total = [...running, ...paused, ...fault].reduce((sum, c) => sum + c.duration, 0) || 1;
  
  //   return [
  //     { name: 'Running', value: Math.round((running.reduce((a, b) => a + b.duration, 0) / total) * 100) },
  //     { name: 'Paused', value: Math.round((paused.reduce((a, b) => a + b.duration, 0) / total) * 100) },
  //     { name: 'Faulted', value: Math.round((fault.reduce((a, b) => a + b.duration, 0) / total) * 100) }
  //   ];
  // }
  
  function buildOperatorCyclePie(groupedEntry, start, end) {
    const states = groupedEntry?.states || [];
    const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);
  
    const total = [...running, ...paused, ...fault].reduce((sum, c) => sum + c.duration, 0) || 1;
  
    return [
      {
        name: 'Running',
        value: Math.round((running.reduce((a, b) => a + b.duration, 0) / total) * 100)
      },
      {
        name: 'Paused',
        value: Math.round((paused.reduce((a, b) => a + b.duration, 0) / total) * 100)
      },
      {
        name: 'Faulted',
        value: Math.round((fault.reduce((a, b) => a + b.duration, 0) / total) * 100)
      }
    ];
  }
  
  // async function buildOperatorFaultHistory(states, start, end) {
  //   // Group states by machine to process each machine's fault cycles separately
  //   const groupedStates = groupStatesByOperatorAndSerial(states);
  //   const allFaultCycles = [];
  //   const faultTypeMap = new Map(); // For aggregating fault summaries

  //   // Process each machine's states
  //   for (const [key, group] of Object.entries(groupedStates)) {
  //     const machineStates = group.states;
  //     const machineName = group.machine?.name || "Unknown";

  //     // Extract fault cycles for this machine
  //     const { faultCycles, faultSummaries } = extractFaultCycles(
  //       machineStates,
  //       new Date(start),
  //       new Date(end)
  //     );

  //     // Add machine info to each fault cycle
  //     const machineFaultCycles = faultCycles.map((cycle) => ({
  //       ...cycle,
  //       machineName,
  //       machineSerial: group.machine?.serial,
  //     }));

  //     allFaultCycles.push(...machineFaultCycles);

  //     // Aggregate fault summaries
  //     for (const summary of faultSummaries) {
  //       const key = summary.faultType;
  //       if (!faultTypeMap.has(key)) {
  //         faultTypeMap.set(key, {
  //           faultType: key,
  //           count: 0,
  //           totalDuration: 0,
  //         });
  //       }
  //       const existing = faultTypeMap.get(key);
  //       existing.count += summary.count;
  //       existing.totalDuration += summary.totalDuration;
  //     }
  //   }

  //   // Convert fault summaries to array and format durations
  //   const faultSummaries = Array.from(faultTypeMap.values()).map(
  //     (summary) => {
  //       const totalSeconds = Math.floor(summary.totalDuration / 1000);
  //       const hours = Math.floor(totalSeconds / 3600);
  //       const minutes = Math.floor((totalSeconds % 3600) / 60);
  //       const seconds = totalSeconds % 60;

  //       return {
  //         ...summary,
  //         formatted: {
  //           hours,
  //           minutes,
  //           seconds,
  //         },
  //       };
  //     }
  //   );

  //   // Sort fault cycles by start time
  //   allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));

  //   return {
  //     faultCycles: allFaultCycles,
  //     faultSummaries,
  //   };
  // }

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
  
  
  // async function buildOperatorEfficiencyLine(validCounts, states, start, end) {
  //   const startDate = new Date(start);
  //   const endDate = new Date(end);
  //   const days = [];
  //   let cursor = new Date(startDate);
  
  //   while (cursor <= endDate) {
  //     const dayStart = new Date(cursor);
  //     const dayEnd = new Date(dayStart);
  //     dayEnd.setUTCHours(23, 59, 59, 999);
  //     days.push({ start: new Date(dayStart), end: new Date(dayEnd) });
  //     cursor.setUTCDate(cursor.getUTCDate() + 1);
  //   }
  
  //   const results = [];
  //   for (const day of days) {
  //     const dailyStates = states.filter(s => new Date(s.timestamp) >= day.start && new Date(s.timestamp) <= day.end);
  //     const dailyCounts = validCounts.filter(c => new Date(c.timestamp) >= day.start && new Date(c.timestamp) <= day.end);
  //     const runCycles = getCompletedCyclesForOperator(dailyStates);
  //     const runTime = runCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
  
  //     let avgStandard = 666;
  //     const standards = dailyCounts.map(c => c.item?.standard).filter(s => typeof s === 'number' && s > 0);
  //     if (standards.length > 0) {
  //       avgStandard = standards.reduce((a, b) => a + b, 0) / standards.length;
  //     }
  
  //     const hours = runTime / 3600000;
  //     const pph = hours > 0 ? dailyCounts.length / hours : 0;
  //     const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;
  
  //     results.push({
  //       date: day.start.toISOString().split('T')[0],
  //       efficiency: Math.round(efficiency * 100) / 100
  //     });
  //   }

  //   // Get operator name from the first valid count
  //   const operatorName = validCounts[0]?.operator?.name || 'Unknown';
  //   const operatorId = validCounts[0]?.operator?.id;

  //   return {
  //     operator: {
  //       id: operatorId,
  //       name: operatorName
  //     },
  //     timeRange: {
  //       start,
  //       end,
  //       totalDays: results.length
  //     },
  //     data: results
  //   };
  // }

  // async function buildOperatorEfficiencyLine(group, start, end) {

    
  //   const validCounts = group.counts?.valid || [];
  //   const states = group.states || [];
  
  //   const startDate = new Date(start);
  //   const endDate = new Date(end);
  //   const days = [];
  
  //   let cursor = new Date(startDate);
  //   while (cursor <= endDate) {
  //     const dayStart = new Date(cursor);
  //     const dayEnd = new Date(dayStart);
  //     dayEnd.setUTCHours(23, 59, 59, 999);
  //     days.push({ start: new Date(dayStart), end: new Date(dayEnd) });
  //     cursor.setUTCDate(cursor.getUTCDate() + 1);
  //   }
  
  //   const results = [];
  //   for (const day of days) {
  //     const dailyStates = states.filter(s => new Date(s.timestamp) >= day.start && new Date(s.timestamp) <= day.end);
  //     const dailyCounts = validCounts.filter(c => new Date(c.timestamp) >= day.start && new Date(c.timestamp) <= day.end);
  //     const runCycles = getCompletedCyclesForOperator(dailyStates);
  //     const runTime = runCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
  
  //     let avgStandard = 666;
  //     const standards = dailyCounts.map(c => c.item?.standard).filter(s => typeof s === 'number' && s > 0);
  //     if (standards.length > 0) {
  //       avgStandard = standards.reduce((a, b) => a + b, 0) / standards.length;
  //     }
  
  //     const hours = runTime / 3600000;
  //     const pph = hours > 0 ? dailyCounts.length / hours : 0;
  //     const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;
  
  //     results.push({
  //       date: day.start.toISOString().split('T')[0],
  //       efficiency: Math.round(efficiency * 100) / 100
  //     });
  //   }
  
  //   return {
  //     operator: {
  //       id: validCounts[0]?.operator?.id || group.operator?.id || 'Unknown',
  //       name: validCounts[0]?.operator?.name || group.operator?.name || 'Unknown'
  //     },
  //     timeRange: {
  //       start,
  //       end,
  //       totalDays: results.length
  //     },
  //     data: results
  //   };
  // }
  
  
  // async function buildOperatorEfficiencyLine(group, start, end, db) {
  //   const operatorId = group.operator?.id || group.counts?.valid?.[0]?.operator?.id;
  //   if (!operatorId) {
  //     throw new Error('Operator ID missing in group');
  //   }
  
  //   const endDate = new Date(end);
  //   let startDate = new Date(start);
  //   const rangeMs = endDate - startDate;
  
  //   // ⏪ Expand to 7-day window if shorter
  //   if (rangeMs < 7 * 24 * 60 * 60 * 1000) {
  //     startDate = new Date(endDate);
  //     startDate.setDate(endDate.getDate() - 6);
  //     startDate.setHours(0, 0, 0, 0);
  //   }
  
  //   const days = [];
  //   let cursor = new Date(startDate);
  //   while (cursor <= endDate) {
  //     const startOfDay = new Date(cursor);
  //     const endOfDay = new Date(startOfDay);
  //     endOfDay.setUTCHours(23, 59, 59, 999);
  
  //     days.push({ start: new Date(startOfDay), end: new Date(endOfDay) });
  
  //     cursor.setUTCDate(cursor.getUTCDate() + 1);
  //   }
  
  //   const results = [];
  
  //   for (const day of days) {
  //     const dayStates = await fetchStatesForOperator(db, operatorId, day.start, day.end);
  //     const runCycles = getCompletedCyclesForOperator(dayStates);
  //     const totalRunTimeMs = runCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
  
  //     const validCounts = await getValidCountsForOperator(db, operatorId, day.start, day.end);
  
  //     let avgStandard = 666;
  //     if (validCounts.length > 0) {
  //       const standards = validCounts.map(c => c.item?.standard).filter(s => typeof s === 'number' && s > 0);
  //       if (standards.length > 0) {
  //         avgStandard = standards.reduce((a, b) => a + b, 0) / standards.length;
  //       }
  //     }
  
  //     const hours = totalRunTimeMs / 3600000;
  //     const pph = hours > 0 ? validCounts.length / hours : 0;
  //     const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;
  
  //     results.push({
  //       date: day.start.toISOString().split("T")[0],
  //       efficiency: Math.round(efficiency * 100) / 100,
  //     });
  //   }
  
  //   const operatorName = await getOperatorNameFromCount(db, operatorId);
  
  //   return {
  //     operator: {
  //       id: operatorId,
  //       name: operatorName || "Unknown"
  //     },
  //     timeRange: {
  //       start: startDate.toISOString(),
  //       end: endDate.toISOString(),
  //       totalDays: results.length
  //     },
  //     data: results
  //   };
  // }

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
  
    // ⬇️ 1-time bulk fetch of full-range data
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
  

  //Optimized functions\

  // function buildOptimizedOperatorItemSummary(states, allCounts, start, end, machineNames = {}) {
  //   const itemMap = {};
  //   const sessions = [];
  //   let totalWorkedMs = 0;
  //   let totalCount = 0;

  //   // Get running cycles for time calculations
  //   const { running: runCycles } = extractAllCyclesFromStates(states, start, end);

  //   // Group counts by cycles
  //   for (const cycle of runCycles) {
  //     const cycleStart = new Date(cycle.start);
  //     const cycleEnd = new Date(cycle.end);
  //     const cycleMs = cycleEnd - cycleStart;

  //     const cycleCounts = allCounts.filter(c => {
  //       const ts = new Date(c.timestamp);
  //       return ts >= cycleStart && ts <= cycleEnd;
  //     });

  //     if (!cycleCounts.length) continue;

  //     const grouped = groupCountsByItem(cycleCounts);
  //     const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
  //     const workedTimeMs = cycleMs * Math.max(1, operators.size);

  //     const cycleItems = [];
  //     for (const [itemId, group] of Object.entries(grouped)) {
  //       const item = group[0]?.item || {};
  //       const name = item.name || "Unknown";
  //       const standard = item.standard > 0 ? item.standard : 666;
  //       const countTotal = group.length;

  //       if (!itemMap[itemId]) {
  //         itemMap[itemId] = {
  //           name,
  //           standard,
  //           count: 0,
  //           workedTimeMs: 0
  //         };
  //       }

  //       itemMap[itemId].count += countTotal;
  //       itemMap[itemId].workedTimeMs += workedTimeMs;
  //       totalWorkedMs += workedTimeMs;
  //       totalCount += countTotal;

  //       const hours = workedTimeMs / 3600000;
  //       const pph = hours ? countTotal / hours : 0;
  //       const efficiency = standard ? pph / standard : 0;

  //       cycleItems.push({
  //         itemId: parseInt(itemId),
  //         name,
  //         countTotal,
  //         standard,
  //         pph: Math.round(pph * 100) / 100,
  //         efficiency: Math.round(efficiency * 10000) / 100
  //       });
  //     }

  //     sessions.push({
  //       start: cycleStart.toISOString(),
  //       end: cycleEnd.toISOString(),
  //       workedTimeMs,
  //       workedTimeFormatted: formatDuration(workedTimeMs),
  //       items: cycleItems
  //     });
  //   }

  //   // Calculate machine summary
  //   const totalHours = totalWorkedMs / 3600000;
  //   const machinePph = totalHours > 0 ? totalCount / totalHours : 0;

  //   const proratedStandard = Object.values(itemMap).reduce((acc, item) => {
  //     const weight = totalCount > 0 ? item.count / totalCount : 0;
  //     return acc + weight * item.standard;
  //   }, 0);

  //   const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

  //   const formattedItemSummaries = {};
  //   for (const [itemId, item] of Object.entries(itemMap)) {
  //     const hours = item.workedTimeMs / 3600000;
  //     const pph = hours ? item.count / hours : 0;
  //     const efficiency = item.standard ? pph / item.standard : 0;

  //     formattedItemSummaries[itemId] = {
  //       name: item.name,
  //       standard: item.standard,
  //       countTotal: item.count,
  //       workedTimeFormatted: formatDuration(item.workedTimeMs),
  //       pph: Math.round(pph * 100) / 100,
  //       efficiency: Math.round(efficiency * 10000) / 100
  //     };
  //   }

  //   return {
  //     sessions,
  //     machineSummary: {
  //       totalCount,
  //       workedTimeMs: totalWorkedMs,
  //       workedTimeFormatted: formatDuration(totalWorkedMs),
  //       pph: Math.round(machinePph * 100) / 100,
  //       proratedStandard: Math.round(proratedStandard * 100) / 100,
  //       efficiency: Math.round(machineEff * 10000) / 100,
  //       itemSummaries: formattedItemSummaries
  //     }
  //   };
  // }

  function buildOptimizedOperatorItemSummary(states, counts, start, end, machineNameMap = {}) {
    const validCounts = counts.filter(c => !c.misfeed);
    const misfeedMap = new Map(); // itemId -> misfeed count
  
    for (const c of counts) {
      if (c.misfeed && c.item?.id) {
        const id = c.item.id;
        misfeedMap.set(id, (misfeedMap.get(id) || 0) + 1);
      }
    }
  
    const itemMap = {}; // key: operatorId-machineSerial-itemName
    const runCycles = getCompletedCyclesForOperator(states);
    const totalRunMs = runCycles.reduce((sum, c) => sum + (c.duration || 0), 0);
    const totalHours = totalRunMs / 3600000;
  
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
      itemMap[key].rawRunMs = totalRunMs; // same for all entries
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

  
  // function buildOptimizedOperatorCyclePie(runCycles, faultCycles) {
  //   const runTime = runCycles.reduce((sum, c) => sum + c.duration, 0);
  //   const faultTime = faultCycles.reduce((sum, c) => sum + c.duration, 0);
  //   const total = runTime + faultTime;

  //   if (total === 0) {
  //     return [
  //       { name: 'Running', value: 0 },
  //       { name: 'Paused', value: 0 },
  //       { name: 'Faulted', value: 0 }
  //     ];
  //   }

  //   return [
  //     { name: 'Running', value: Math.round((runTime / total) * 100) },
  //     { name: 'Paused', value: 0 }, // Since we don't have paused cycles in the optimized version
  //     { name: 'Faulted', value: Math.round((faultTime / total) * 100) }
  //   ];
  // }

  function buildOptimizedOperatorCyclePie(states, start, end) {
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
  

  

  // function buildOptimizedOperatorFaultHistory(grouped, start, end) {
  //   const allFaultCycles = [];
  //   const faultTypeMap = new Map();

  //   for (const [operatorId, group] of Object.entries(grouped)) {
  //     const states = group.states || [];
  //     const machineName = group.machine?.name || 'Unknown';

  //     const { faultCycles, faultSummaries } = extractFaultCycles(states, new Date(start), new Date(end));

  //     const machineFaultCycles = faultCycles.map(cycle => ({
  //       ...cycle,
  //       machineName,
  //       machineSerial: group.machine?.serial || 'Unknown',
  //       operatorName: group.operator?.name || 'Unknown',
  //       operatorId
  //     }));

  //     allFaultCycles.push(...machineFaultCycles);

  //     for (const summary of faultSummaries) {
  //       const key = summary.faultType;
  //       if (!faultTypeMap.has(key)) {
  //         faultTypeMap.set(key, {
  //           faultType: key,
  //           count: 0,
  //           totalDuration: 0
  //         });
  //       }
  //       const existing = faultTypeMap.get(key);
  //       existing.count += summary.count;
  //       existing.totalDuration += summary.totalDuration;
  //     }
  //   }

  //   const faultSummaries = Array.from(faultTypeMap.values()).map(summary => {
  //     const totalSeconds = Math.floor(summary.totalDuration / 1000);
  //     return {
  //       ...summary,
  //       formatted: {
  //         hours: Math.floor(totalSeconds / 3600),
  //         minutes: Math.floor((totalSeconds % 3600) / 60),
  //         seconds: totalSeconds % 60
  //       }
  //     };
  //   });

  //   allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));

  //   return {
  //     faultCycles: allFaultCycles,
  //     faultSummaries
  //   };
  // }

  function buildOptimizedOperatorFaultHistory(groupedByOperator, start, end) {
    const allFaultCycles = [];
    const faultTypeMap = new Map();
  
    for (const [operatorId, group] of Object.entries(groupedByOperator)) {
      const states = group.states || [];
  
      // Safe fallback
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
  
  
  /**
 * Fetches dashboard-ready analytics for all operators with data in the given time window.
 * For each operator, computes:
 *   - Performance (total counts, misfeeds, runtime, PPH, efficiency)
 *   - Item Summary (per-item counts, misfeeds, worked time, PPH, efficiency)
 *   - TODO: Count By Item, Cycle Pie, Fault History, Daily Efficiency
 *
 * @param {Db} db - MongoDB database instance
 * @param {string|Date} start - Start of time window (ISO string or Date)
 * @param {string|Date} end - End of time window (ISO string or Date)
 * @returns {Promise<Array>} Array of dashboard-ready objects per operator
 */
async function fetchOperatorDashboardData(db, start, end) {
  // 1. Find all operator IDs with data in the window
  const operatorIds = await db.collection("count").distinct("operator.id", {
    timestamp: { $gte: new Date(start), $lte: new Date(end) },
    "operator.id": { $ne: null }
  });

  // 2. For each operator, aggregate analytics
  const results = await Promise.all(
    operatorIds.map(async (operatorId) => {
      // --- Performance Block ---
      // Aggregate total counts, misfeeds, runtime, PPH, efficiency
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

      // --- FIX: Fetch all states for the time window, not just those with operator.id === operatorId ---
      // We'll filter/group in JS as in the old implementation
      const allStates = await db.collection("state").find({
        timestamp: { $gte: new Date(start), $lte: new Date(end) }
      }).sort({ timestamp: 1 }).toArray();
      // Filter states for this operator (as in old logic)
      const states = allStates.filter(s => s.operator && s.operator.id === operatorId);
      // Debug: log number of states and cycles
      // console.log(`Operator ${operatorId}: states found = ${states.length}`);

      // Calculate runtime, pausedTime, faultTime in JS (using your existing helpers)
      const { runtime, pausedTime, faultTime } = calculateOperatorTimes(states, start, end);
      const piecesPerHour = calculatePiecesPerHour(perf.totalCount || 0, runtime);
      const efficiency = calculateEfficiency(runtime, perf.totalCount || 0, perf.validCount || 0);

      // --- Item Summary Block ---
      // For each run cycle, aggregate per-item stats in Mongo
      const runCycles = getCompletedCyclesForOperator(states);
      // Debug: log number of cycles
      // console.log(`Operator ${operatorId}: cycles found = ${runCycles.length}`);
      const itemSummariesMerged = {};
      let totalWorkedMs = 0;
      let totalCount = 0;
      for (const cycle of runCycles) {
        const cycleStart = new Date(cycle.start);
        const cycleEnd = new Date(cycle.end);
        const cycleMs = cycleEnd - cycleStart;
        // Aggregate per-item for this cycle
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
      // Format item summaries
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

      // --- Count By Item Block ---
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

      // --- Cycle Pie Block ---
      const { running, paused, fault } = extractAllCyclesFromStates(states, start, end);
      const totalCycleMs = [...running, ...paused, ...fault].reduce((sum, c) => sum + c.duration, 0) || 1;
      const cyclePie = [
        {
          name: 'Running',
          value: Math.round((running.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100)
        },
        {
          name: 'Paused',
          value: Math.round((paused.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100)
        },
        {
          name: 'Faulted',
          value: Math.round((fault.reduce((a, b) => a + b.duration, 0) / totalCycleMs) * 100)
        }
      ];

      // --- Fault History Block ---
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

      // --- Daily Efficiency Block ---
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
        operator: {
          id: operatorId,
          name: perf.firstOperator?.name || "Unknown"
        },
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

  module.exports = {
    getAllOperatorIds,
    buildOperatorPerformance,
    buildOperatorItemSummary,
    buildOperatorCountByItem,
    buildOperatorCyclePie,
    buildOperatorFaultHistory,
    buildOperatorEfficiencyLine,
    buildOptimizedOperatorItemSummary,
    buildOptimizedOperatorCountByItem,
    buildOptimizedOperatorCyclePie,
    buildOptimizedOperatorFaultHistory,
    fetchOperatorDashboardData
  };
  