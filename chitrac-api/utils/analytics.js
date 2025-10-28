const { extractCyclesFromStates, extractPausedCyclesFromStates, extractFaultCyclesFromStates, extractAllCyclesFromStates } = require("./state");

async function calculateRuntime(states, startTime, endTime) {
  // Use the same cycle extraction logic as run-session/state/cycles
  const cycles = extractCyclesFromStates(states, startTime, endTime);

  // Sum up the duration of all cycles
  return cycles.reduce((total, cycle) => {
    const cycleStart = new Date(cycle.start);
    const cycleEnd = new Date(cycle.end);
    const cycleDuration = cycleEnd - cycleStart;
    return total + cycleDuration;
  }, 0);
}

function calculateDowntime(totalQueryMs, runtimeMs) {
  return Math.max(totalQueryMs - runtimeMs, 0);
}

function calculateTotalCount(validCounts, misfeedCounts) {
  const totalCounts = validCounts.length + misfeedCounts.length;
  return totalCounts;
}

function calculateMisfeeds(misfeedCounts) {
  return misfeedCounts.length;
}

function calculateAvailability(runtimeMs, downtimeMs, totalQueryMs) {
  if (!totalQueryMs) return 0;
  const availability = runtimeMs / totalQueryMs;
  return Math.min(Math.max(availability, 0), 1);
}

function calculateThroughput(totalCount, misfeedCount) {
  const totalOutput = totalCount + misfeedCount;
  if (!totalOutput) return 0;
  const throughput = totalCount / totalOutput;
  return Math.min(Math.max(throughput, 0), 1);
}

/***  Time Credit Calculation Start */
// function calculateTimeCreditsByItem(countRecords) {
//   if (!Array.isArray(countRecords)) return [];

//   const itemMap = {};

//   for (const record of countRecords) {
//     const item = record.item;
//     const key = `${item.id}-${item.name}`;

//     if (!itemMap[key]) {
//       itemMap[key] = {
//         id: item.id,
//         name: item.name,
//         standard: item.standard,
//         count: 0
//       };
//     }

//     itemMap[key].count += 1;
//   }

//   return Object.values(itemMap).map(item => {
//     const standardPerHour = item.standard < 60 ? item.standard * 60 : item.standard;
//     const timeCredit = standardPerHour > 0 ? item.count / (standardPerHour / 3600) : 0;
//     return {
//       ...item,
//       timeCredit: parseFloat(timeCredit.toFixed(2))
//     };
//   });
// }

function calculateTimeCreditsByItem(countRecords) {
  if (!Array.isArray(countRecords)) return [];

  const itemMap = {};

  for (const record of countRecords) {
    const item = record.item || {};
    const key = `${item.id}-${item.name}`;

    if (!itemMap[key]) {
      itemMap[key] = {
        id: item.id,
        name: item.name,
        standard: Number(item.standard) || 0,
        count: 0
      };
    }

    itemMap[key].count += 1;
  }

  return Object.values(itemMap).map(item => {
    let standardPerHour = item.standard;

    // Only apply the per-minute → per-hour conversion if it’s clearly in minutes
    if (item.standard > 0 && item.standard < 60) {
      // Note: This conversion is applied silently in production
      // Debug logging can be enabled if needed for troubleshooting
      standardPerHour = item.standard * 60;
    }

    const timeCredit =
      standardPerHour > 0
        ? item.count / (standardPerHour / 3600)
        : 0;

    return {
      ...item,
      timeCredit: parseFloat(timeCredit.toFixed(2)),
      standardPerHour // include for debugging
    };
  });
}


function calculateTotalTimeCredit(countRecords) {
  if (!Array.isArray(countRecords)) return 0;

  const itemCredits = calculateTimeCreditsByItem(countRecords);
  return itemCredits.reduce((sum, item) => sum + item.timeCredit, 0);
}

/***  Time Credit Calculation End */

/***  Efficiency Calculation Start */
function calculateEfficiency(runtimeMs, totalCount, counts) {
  if (!runtimeMs || !totalCount) return 0;
  const runtimeSeconds = runtimeMs / 1000;
  const totalTimeCredit = calculateTotalTimeCredit(counts);
  const efficiency = totalTimeCredit / runtimeSeconds;
  return Math.max(efficiency, 0); // Allow >100%
}

/***  Efficiency Calculation End */
function calculateOEE(availability, efficiency, throughput) {
  return availability * efficiency * throughput;
}

/**
 * Calculates all time metrics for an operator based on machine states
 * @param {Array} states - Array of state records where the operator was active
 * @param {Date} startTime - Start time of the query period
 * @param {Date} endTime - End time of the query period
 * @returns {Object} Object containing runtime, paused time, and fault time in milliseconds
 */
function calculateOperatorTimes(states, startTime, endTime) {
  const cycles = extractAllCyclesFromStates(states, startTime, endTime);
  
  return {
    runtime: cycles.running.reduce((total, cycle) => total + cycle.duration, 0),
    pausedTime: cycles.paused.reduce((total, cycle) => total + cycle.duration, 0),
    faultTime: cycles.fault.reduce((total, cycle) => total + cycle.duration, 0)
  };
}

/**
 * Calculates the pieces per hour rate for an operator
 * @param {number} totalCount - Total number of pieces produced
 * @param {number} runtimeMs - Total runtime in milliseconds
 * @returns {number} Pieces per hour rate
 */
function calculatePiecesPerHour(totalCount, runtimeMs) {
  if (!runtimeMs) return 0;
  
  // Convert runtime from milliseconds to hours
  const runtimeHours = runtimeMs / (1000 * 60 * 60);
  
  // Calculate pieces per hour
  const piecesPerHour = totalCount / runtimeHours;
  
  return Math.max(0, piecesPerHour);
}

function calculateStandardFromCounts(counts) {
  if (!Array.isArray(counts) || counts.length === 0) return 0;

  const frequencyMap = {};
  for (const count of counts) {
    const std = count?.item?.standard;
    if (typeof std === 'number' && std > 0) {
      frequencyMap[std] = (frequencyMap[std] || 0) + 1;
    }
  }

  // Pick most frequent valid standard
  const [mostCommon] = Object.entries(frequencyMap).sort((a, b) => b[1] - a[1]);
  return mostCommon ? parseFloat(mostCommon[0]) : 0;
}




module.exports = {
  calculateRuntime,
  calculateDowntime,
  calculateTotalCount,
  calculateMisfeeds,
  calculateAvailability,
  calculateThroughput,
  calculateEfficiency,
  calculateOEE,
  calculateOperatorTimes,
  calculatePiecesPerHour,
  calculateStandardFromCounts
};
