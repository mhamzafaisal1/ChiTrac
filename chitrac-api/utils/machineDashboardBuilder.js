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
  // Filter counts to only those within the session time range
  const sessionStart = new Date(start);
  const sessionEnd = new Date(end);

  const countsInSession = validCounts.filter((c) => {
    const countTime = c.timestamp || c.timestamps?.create;
    if (!countTime) return false;
    const ts = new Date(countTime);
    return ts >= sessionStart && ts <= sessionEnd;
  });

  let cycles = extractAllCyclesFromStates(states, start, end).running;

  // Fallback: If no cycles found OR cycles don't overlap with count timestamps
  // This handles cases where state timestamps and count timestamps don't align
  if (countsInSession.length > 0) {
    if (cycles.length === 0) {
      // No cycles at all - use full session range
      cycles = [{
        start: sessionStart,
        end: sessionEnd,
        duration: sessionEnd - sessionStart
      }];
    } else {
      // Check if any counts fall within any cycle
      const countsInCycles = countsInSession.some(c => {
        const countTime = new Date(c.timestamp || c.timestamps?.create);
        return cycles.some(cycle => {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          return countTime >= cycleStart && countTime <= cycleEnd;
        });
      });

      if (!countsInCycles) {
        // Cycles exist but don't capture any counts - use full session range
        cycles = [{
          start: sessionStart,
          end: sessionEnd,
          duration: sessionEnd - sessionStart
        }];
      }
    }
  }
  
  if (!cycles.length || !countsInSession.length) {
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

    const cycleCounts = countsInSession.filter((c) => {
      // Handle both timestamp (string or Date) and timestamps.create
      const countTime = c.timestamp || c.timestamps?.create;
      if (!countTime) return false;
      
      const ts = new Date(countTime);
      // Allow for small timing differences - check if count is within cycle range
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
      // Handle both timestamp (string or Date) and timestamps.create
      const countTime = count.timestamp || count.timestamps?.create;
      if (!countTime) continue;
      
      const ts = new Date(countTime);
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
          // Handle both timestamp (string or Date) and timestamps.create
          const stateTime = s.timestamp || s.timestamps?.create;
          if (!stateTime) return false;
          
          const ts = new Date(stateTime);
          return ts >= interval.start && ts < interval.end;
        });

        const hourCounts = counts.filter((c) => {
          // Handle both timestamp (string or Date) and timestamps.create
          const countTime = c.timestamp || c.timestamps?.create;
          if (!countTime) return false;
          
          const ts = new Date(countTime);
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
          // groupCountsByOperatorAndMachine creates keys using machine.serial from counts
          // But counts might have machine.id instead, so we need to check both
          // Also, the serial parameter might need to match the actual machine serial/id in counts
          let group = groupedCounts[`${operatorId}-${serial}`];
          
          // If not found, try to find by checking all keys that match the operatorId
          if (!group) {
            // Find any group for this operator (in case machine serial/id mismatch)
            const matchingKey = Object.keys(groupedCounts).find(key => {
              const [opId, machSerial] = key.split('-');
              return opId === String(operatorId);
            });
            if (matchingKey) {
              group = groupedCounts[matchingKey];
            }
          }
          
          if (!group) continue;

          const stats = processCountStatistics(group.counts);
          const efficiency = calculateEfficiency(
            totalRuntime,
            stats.total,
            group.validCounts
          );
          
          // Handle operator name - can be string or object with first/surname
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

        // Only return hours that have operator data (filter out empty hours)
        if (Object.keys(operatorMetrics).length === 0) {
          return null;
        }

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

    // Filter out null entries (empty hours)
    return hourlyData.filter(h => h !== null);
  } catch (err) {
    console.error("Error in buildOperatorEfficiency:", err);
    throw err;
  }
}


// utils/currentOperators.js (or inline in the route file)

/**
 * Return current operators on a machine using stateTicker (real-time source of truth).
 * For each current operator, finds their OPEN/ACTIVE operator-session for metrics.
 * Falls back to most recent session if no open session exists.
 */
async function buildCurrentOperators(db, serial) {
  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const serialNum = Number(serial);

  // Step 1: Get current operators from stateTicker (real-time source of truth)
  const tickerColl = db.collection(config.stateTickerCollectionName);
  const ticker = await tickerColl.findOne({
    $or: [
      { "machine.serial": serialNum },
      { "machine.id": serialNum }
    ]
  }, {
    projection: {
      _id: 0,
      operators: 1,
      machine: 1
    }
  });

  if (!ticker) return [];

  // Extract operator IDs from ticker (current operators on machine)
  const operators = Array.isArray(ticker.operators) ? ticker.operators : [];
  const opIds = [...new Set(
    operators
      .map(o => o && o.id)
      .filter(id => typeof id === "number" && id !== -1)
  )];

  if (!opIds.length) return [];

  // Step 2: For each current operator, find their OPEN session first, then fallback to most recent
  const osColl = db.collection(config.operatorSessionCollectionName);
  const machineSerial = ticker.machine?.serial ?? ticker.machine?.id ?? serialNum;
  const machineName = ticker.machine?.name || "Unknown";

  const rows = await Promise.all(opIds.map(async (opId) => {
    // First, try to find OPEN/ACTIVE session (no end timestamp)
    // Combine machine match with open session check using $and
    let s = await osColl.find({
      "operator.id": opId,
      $and: [
        {
          $or: [
            { "machine.serial": serialNum },
            { "machine.id": serialNum }
          ]
        },
        {
          $or: [
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null }
          ]
        }
      ]
    })
      .project({
        _id: 0, operator: 1, machine: 1, timestamps: 1,
        workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
      })
      .sort({ "timestamps.create": -1 })
      .limit(1)
      .toArray();

    // If no open session, fallback to most recent session (closed or open)
    if (!s.length) {
      s = await osColl.find({
        "operator.id": opId,
        $or: [
          { "machine.serial": serialNum },
          { "machine.id": serialNum }
        ]
      })
      .project({
        _id: 0, operator: 1, machine: 1, timestamps: 1,
        workTime: 1, totalTimeCredit: 1, totalCount: 1, misfeedCount: 1
      })
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

    // Handle operator name - can be string or object with first/surname
    // Prefer name from ticker if available, otherwise from session
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
      session: {
        start: doc.timestamps?.start || doc.timestamps?.create || null,
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
