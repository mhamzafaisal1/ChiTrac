// ✅ Use CommonJS requires
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

const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  formatDuration,
  getHourlyIntervals,
} = require("./time");

// Configuration import for buildCurrentOperators
const config = require('../modules/config');

const { extractAllCyclesFromStates, extractFaultCycles } = require("./state");
const {
  getMisfeedCounts,
  groupCountsByItem,
  processCountStatistics,
  groupCountsByOperatorAndMachine,
  getValidCounts,
} = require("./count");
// async function buildMachinePerformance(db, states, counts, start, end) {
//   const serial = states[0]?.machine?.serial;

//   // ✅ Get filtered counts explicitly
//   const validCounts = await getValidCounts(db, serial, start, end);
//   const misfeedCounts = await getMisfeedCounts(db, serial, start, end);

//   // ✅ Time calculations
//   const runningCycles = extractAllCyclesFromStates(states, start, end).running;
//   const runtimeMs = runningCycles.reduce((total, cycle) => total + cycle.duration, 0);
//   const totalQueryMs = new Date(end) - new Date(start);
//   const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);

//   // ✅ Use valid + misfeeds only, not unfiltered counts
//   const totalCount = calculateTotalCount(validCounts, misfeedCounts);
//   const misfeedCount = calculateMisfeeds(misfeedCounts);

//   // ✅ Use filtered counts for performance calculations
//   const availability = calculateAvailability(runtimeMs, downtimeMs, totalQueryMs);
//   const throughput = calculateThroughput(validCounts.length, misfeedCount);
//   const efficiency = calculateEfficiency(runtimeMs, validCounts.length, validCounts);
//   const oee = calculateOEE(availability, efficiency, throughput);

//   return {
//     runtime: {
//       total: runtimeMs,
//       formatted: formatDuration(runtimeMs),
//     },
//     downtime: {
//       total: downtimeMs,
//       formatted: formatDuration(downtimeMs),
//     },
//     output: {
//       totalCount,
//       misfeedCount,
//     },
//     performance: {
//       availability: {
//         value: availability,
//         percentage: (availability * 100).toFixed(2) + "%",
//       },
//       throughput: {
//         value: throughput,
//         percentage: (throughput * 100).toFixed(2) + "%",
//       },
//       efficiency: {
//         value: efficiency,
//         percentage: (efficiency * 100).toFixed(2) + "%",
//       },
//       oee: {
//         value: oee,
//         percentage: (oee * 100).toFixed(2) + "%",
//       },
//     }
//   };
// }

async function buildMachinePerformance(
  states,
  validCounts,
  misfeedCounts,
  start,
  end
) {
  // ✅ Time calculations from state data
  const runningCycles = extractAllCyclesFromStates(states, start, end).running;
  const runtimeMs = runningCycles.reduce(
    (total, cycle) => total + cycle.duration,
    0
  );
  const totalQueryMs = new Date(end) - new Date(start);
  const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);

  // ✅ Count totals
  const totalCount = calculateTotalCount(validCounts, misfeedCounts);
  const misfeedCount = calculateMisfeeds(misfeedCounts);

  // ✅ Performance metrics
  const availability = calculateAvailability(
    runtimeMs,
    downtimeMs,
    totalQueryMs
  );
  const throughput = calculateThroughput(validCounts.length, misfeedCount);
  const efficiency = calculateEfficiency(
    runtimeMs,
    validCounts.length,
    validCounts
  );
  const oee = calculateOEE(availability, efficiency, throughput);

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

// function buildMachineItemSummary(states, counts, start, end) {
//   try {
//     if (!Array.isArray(states)) {
//       throw new Error('States must be an array');
//     }
//     if (!Array.isArray(counts)) {
//       throw new Error('Counts must be an array');
//     }

//     const cycles = extractAllCyclesFromStates(states, start, end).running;
//     if (!cycles.length || !counts.length) {
//       return {
//         sessions: [],
//         machineSummary: {
//           totalCount: 0,
//           workedTimeMs: 0,
//           workedTimeFormatted: formatDuration(0),
//           pph: 0,
//           proratedStandard: 0,
//           efficiency: 0,
//           itemSummaries: {}
//         }
//       };
//     }

//     const itemSummary = {};
//     let totalWorkedMs = 0;
//     let totalCount = 0;
//     const sessions = [];

//     for (const cycle of cycles) {
//       const cycleStart = new Date(cycle.start);
//       const cycleEnd = new Date(cycle.end);
//       const cycleMs = cycleEnd - cycleStart;

//       const cycleCounts = counts.filter(c => {
//         const ts = new Date(c.timestamp);
//         return ts >= cycleStart && ts <= cycleEnd;
//       });

//       if (!cycleCounts.length) continue;

//       const grouped = groupCountsByItem(cycleCounts);
//       const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
//       const workedTimeMs = cycleMs * Math.max(1, operators.size);

//       const cycleItems = [];
//       for (const [itemId, group] of Object.entries(grouped)) {
//         const name = group[0]?.item?.name || "Unknown";
//         const standard = group[0]?.item?.standard > 0 ? group[0]?.item?.standard : 666;
//         const countTotal = group.length;

//         if (!itemSummary[itemId]) {
//           itemSummary[itemId] = {
//             name,
//             standard,
//             count: 0,
//             workedTimeMs: 0
//           };
//         }

//         itemSummary[itemId].count += countTotal;
//         itemSummary[itemId].workedTimeMs += workedTimeMs;
//         totalWorkedMs += workedTimeMs;
//         totalCount += countTotal;

//         const hours = workedTimeMs / 3600000;
//         const pph = hours ? countTotal / hours : 0;
//         const efficiency = standard ? pph / standard : 0;

//         cycleItems.push({
//           itemId: parseInt(itemId),
//           name,
//           countTotal,
//           standard,
//           pph: Math.round(pph * 100) / 100,
//           efficiency: Math.round(efficiency * 10000) / 100
//         });
//       }

//       sessions.push({
//         start: cycleStart.toISOString(),
//         end: cycleEnd.toISOString(),
//         workedTimeMs,
//         workedTimeFormatted: formatDuration(workedTimeMs),
//         items: cycleItems
//       });
//     }

//     // Calculate machine-level metrics
//     const totalHours = totalWorkedMs / 3600000;
//     const machinePph = totalHours > 0 ? totalCount / totalHours : 0;

//     // Calculate prorated standard based on item counts
//     const proratedStandard = Object.values(itemSummary).reduce((acc, item) => {
//       const weight = totalCount > 0 ? item.count / totalCount : 0;
//       return acc + weight * item.standard;
//     }, 0);

//     const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

//     // Format item summaries
//     const formattedItemSummaries = {};
//     for (const [itemId, item] of Object.entries(itemSummary)) {
//       const hours = item.workedTimeMs / 3600000;
//       const pph = hours ? item.count / hours : 0;
//       const efficiency = item.standard ? pph / item.standard : 0;

//       formattedItemSummaries[itemId] = {
//         name: item.name,
//         standard: item.standard,
//         countTotal: item.count,
//         workedTimeFormatted: formatDuration(item.workedTimeMs),
//         pph: Math.round(pph * 100) / 100,
//         efficiency: Math.round(efficiency * 10000) / 100
//       };
//     }

//     return {
//       sessions,
//       machineSummary: {
//         totalCount,
//         workedTimeMs: totalWorkedMs,
//         workedTimeFormatted: formatDuration(totalWorkedMs),
//         pph: Math.round(machinePph * 100) / 100,
//         proratedStandard: Math.round(proratedStandard * 100) / 100,
//         efficiency: Math.round(machineEff * 10000) / 100,
//         itemSummaries: formattedItemSummaries
//       }
//     };
//   } catch (error) {
//     console.error('Error in buildMachineItemSummary:', error);
//     throw error;
//   }
// }

function buildMachineItemSummary(states, validCounts, start, end) {
  const cycles = extractAllCyclesFromStates(states, start, end).running;
  if (!cycles.length || !validCounts.length) {
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

  const itemSummary = {};
  let totalWorkedMs = 0;
  let totalCount = 0;
  const sessions = [];

  for (const cycle of cycles) {
    const cycleStart = new Date(cycle.start);
    const cycleEnd = new Date(cycle.end);
    const cycleMs = cycleEnd - cycleStart;

    const cycleCounts = validCounts.filter((c) => {
      const ts = new Date(c.timestamp);
      return ts >= cycleStart && ts <= cycleEnd;
    });

    if (!cycleCounts.length) continue;

    const grouped = groupCountsByItem(cycleCounts);
    const operators = new Set(
      cycleCounts.map((c) => c.operator?.id).filter(Boolean)
    );
    const workedTimeMs = cycleMs * Math.max(1, operators.size);

    const cycleItems = [];
    for (const [itemId, group] of Object.entries(grouped)) {
      const name = group[0]?.item?.name || "Unknown";
      const standard =
        group[0]?.item?.standard > 0 ? group[0]?.item?.standard : 666;
      const countTotal = group.length;

      if (!itemSummary[itemId]) {
        itemSummary[itemId] = {
          name,
          standard,
          count: 0,
          workedTimeMs: 0,
        };
      }

      itemSummary[itemId].count += countTotal;
      itemSummary[itemId].workedTimeMs += workedTimeMs;
      totalWorkedMs += workedTimeMs;
      totalCount += countTotal;

      const hours = workedTimeMs / 3600000;
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
      workedTimeMs,
      workedTimeFormatted: formatDuration(workedTimeMs),
      items: cycleItems,
    });
  }

  // Machine summary
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
      name: item.name,
      standard: item.standard,
      countTotal: item.count,
      workedTimeFormatted: formatDuration(item.workedTimeMs),
      pph: Math.round(pph * 100) / 100,
      efficiency: Math.round(efficiency * 10000) / 100,
    };
  }

  return {
    sessions,
    machineSummary: {
      totalCount,
      workedTimeMs: totalWorkedMs,
      workedTimeFormatted: formatDuration(totalWorkedMs),
      pph: Math.round(machinePph * 100) / 100,
      proratedStandard: Math.round(proratedStandard * 100) / 100,
      efficiency: Math.round(machineEff * 10000) / 100,
      itemSummaries: formattedItemSummaries,
    },
  };
}

// function buildItemHourlyStack(counts, start, end) {
//   try {
//     if (!Array.isArray(counts)) {
//       throw new Error('Counts must be an array');
//     }

//     if (!counts.length) {
//       return {
//         title: "No data",
//         data: { hours: [], operators: {} }
//       };
//     }

//     const startDate = new Date(start);
//     const endDate = new Date(end);

//     // Normalize counts into hour buckets
//     const hourMap = new Map(); // hourIndex => { itemName => count }
//     const itemNames = new Set();

//     for (const count of counts) {
//       const ts = new Date(count.timestamp);
//       const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000)); // hour offset since start
//       const itemName = count.item?.name || "Unknown";

//       if (!hourMap.has(hourIndex)) {
//         hourMap.set(hourIndex, {});
//       }
//       const hourEntry = hourMap.get(hourIndex);
//       hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
//       itemNames.add(itemName);
//     }

//     // Build structure: hours[], and for each item: count array by hour
//     const maxHour = Math.max(...hourMap.keys());
//     const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);

//     // Initialize operator structure with all items
//     const operators = {};
//     for (const name of itemNames) {
//       operators[name] = Array(maxHour + 1).fill(0);
//     }

//     // Fill operator counts
//     for (const [hourIndex, itemCounts] of hourMap.entries()) {
//       for (const [itemName, count] of Object.entries(itemCounts)) {
//         operators[itemName][hourIndex] = count;
//       }
//     }

//     return {
//       title: "Item Stacked Count Chart",
//       data: {
//         hours,
//         operators
//       }
//     };
//   } catch (error) {
//     console.error('Error in buildItemHourlyStack:', error);
//     throw error;
//   }
// }

function buildItemHourlyStack(validCounts, start, end) {
  try {
    if (!Array.isArray(validCounts)) {
      throw new Error("Counts must be an array");
    }

    if (!validCounts.length) {
      return {
        title: "No data",
        data: { hours: [], operators: {} },
      };
    }

    const startDate = new Date(start);

    const hourMap = new Map(); // hourIndex => { itemName => count }
    const itemNames = new Set();

    for (const count of validCounts) {
      const ts = new Date(count.timestamp);
      const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000));
      const itemName = count.item?.name || "Unknown";

      if (!hourMap.has(hourIndex)) {
        hourMap.set(hourIndex, {});
      }

      const hourEntry = hourMap.get(hourIndex);
      hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
      itemNames.add(itemName);
    }

    const maxHour = Math.max(...hourMap.keys());
    const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);

    const operators = {};
    for (const name of itemNames) {
      operators[name] = Array(maxHour + 1).fill(0);
    }

    for (const [hourIndex, itemCounts] of hourMap.entries()) {
      for (const [itemName, count] of Object.entries(itemCounts)) {
        operators[itemName][hourIndex] = count;
      }
    }

    return {
      title: "Item Stacked Count Chart",
      data: {
        hours,
        operators,
      },
    };
  } catch (error) {
    console.error("Error in buildItemHourlyStack:", error);
    throw error;
  }
}

// function buildFaultData(states, start, end) {
//   try {
//     if (!Array.isArray(states)) {
//       throw new Error('States must be an array');
//     }

//     if (!states.length) {
//       return {
//         faultCycles: [],
//         faultSummaries: []
//       };
//     }

//     // Extract fault cycles using the existing utility
//     const { faultCycles, faultSummaries } = extractFaultCycles(states, start, end);

//     // Format fault summaries with duration breakdowns
//     const formattedSummaries = faultSummaries.map(summary => {
//       const totalSeconds = Math.floor(summary.totalDuration / 1000);
//       const hours = Math.floor(totalSeconds / 3600);
//       const minutes = Math.floor((totalSeconds % 3600) / 60);
//       const seconds = totalSeconds % 60;

//       return {
//         ...summary,
//         formatted: {
//           hours,
//           minutes,
//           seconds
//         }
//       };
//     });

//     // Sort fault cycles by start time
//     const sortedFaultCycles = faultCycles.sort((a, b) =>
//       new Date(a.start) - new Date(b.start)
//     );

//     return {
//       faultCycles: sortedFaultCycles,
//       faultSummaries: formattedSummaries
//     };
//   } catch (error) {
//     console.error('Error in buildFaultData:', error);
//     throw error;
//   }
// }

function buildFaultData(states, start, end) {
  if (!Array.isArray(states) || !states.length) {
    return {
      faultCycles: [],
      faultSummaries: [],
    };
  }

  const { faultCycles, faultSummaries } = extractFaultCycles(
    states,
    start,
    end
  );

  const formattedSummaries = faultSummaries.map((summary) => {
    const totalSeconds = Math.floor(summary.totalDuration / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      ...summary,
      formatted: { hours, minutes, seconds },
    };
  });

  const sortedFaultCycles = faultCycles.sort(
    (a, b) => new Date(a.start) - new Date(b.start)
  );

  return {
    faultCycles: sortedFaultCycles,
    faultSummaries: formattedSummaries,
  };
}

async function buildOperatorEfficiency(states, counts, start, end, serial) {
  try {


    const hourlyIntervals = getHourlyIntervals(new Date(start), new Date(end));

    const hourlyData = await Promise.all(
      hourlyIntervals.map(async (interval) => {
        const hourStates = states.filter((s) => {
          const ts = new Date(s.timestamp);
          return ts >= interval.start && ts < interval.end;
        });

        const hourCounts = counts.filter((c) => {
          const ts = new Date(c.timestamp);
          return ts >= interval.start && ts < interval.end;
        });

        const groupedCounts = groupCountsByOperatorAndMachine(hourCounts);
        const operatorIds = new Set(
          hourCounts.map((c) => c.operator?.id).filter(Boolean)
        );

        const { runtime: totalRuntime } = calculateOperatorTimes(
          hourStates,
          interval.start,
          interval.end
        );

        const operatorMetrics = {};

        for (const operatorId of operatorIds) {
          const key = `${operatorId}-${serial}`;
          const group = groupedCounts[key];
          if (!group) continue;

          const stats = processCountStatistics(group.counts);
          const efficiency = calculateEfficiency(
            totalRuntime,
            stats.total,
            group.validCounts
          );
          const name = group.counts[0]?.operator?.name || "Unknown";

          operatorMetrics[operatorId] = {
            name,
            runTime: totalRuntime,
            validCounts: stats.valid,
            totalCounts: stats.total,
            efficiency: efficiency * 100,
          };
        }

        const avgEfficiency =
          Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.efficiency,
            0
          ) / (Object.keys(operatorMetrics).length || 1);
        const totalValid = Object.values(operatorMetrics).reduce(
          (sum, op) => sum + op.validCounts,
          0
        );
        const totalCounts = Object.values(operatorMetrics).reduce(
          (sum, op) => sum + op.totalCounts,
          0
        );
        const throughput =
          totalCounts > 0 ? (totalValid / totalCounts) * 100 : 0;
        const availability =
          (totalRuntime / (interval.end - interval.start)) * 100;
        const oee =
          calculateOEE(
            availability / 100,
            avgEfficiency / 100,
            throughput / 100
          ) * 100;

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

    return hourlyData;
  } catch (err) {
    console.error("Error in buildOperatorEfficiency:", err);
    throw err;
  }
}


// utils/currentOperators.js (or inline in the route file)

/**
 * Return most-recent sessions for operators on the latest machine-session for a serial.
 * “Current” here = operators from the latest machine-session, then each operator’s
 * most recent operator-session on this machine.
 */
async function buildCurrentOperators(db, serial) {
  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const msColl = db.collection(config.machineSessionCollectionName);

  // latest machine-session → operator IDs
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

  // most-recent operator-session for each operator on this machine
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

    const workSec   = safe(doc.workTime);
    const creditSec = safe(doc.totalTimeCredit);
    const valid     = safe(doc.totalCount);
    const mis       = safe(doc.misfeedCount);
    const eff       = workSec > 0 ? (creditSec / workSec) : 0;
    const workedMs  = Math.round(workSec * 1000);

    return {
      operatorId: doc.operator?.id ?? null,
      operatorName: doc.operator?.name || "Unknown",
      machineSerial: doc.machine?.serial ?? Number(serial),
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

module.exports = {
  buildMachinePerformance,
  buildMachineItemSummary,
  buildItemHourlyStack,
  buildFaultData,
  buildOperatorEfficiency,
  buildCurrentOperators,
};
