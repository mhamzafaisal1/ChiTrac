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

const { extractAllCyclesFromStates, extractFaultCycles, fetchStatesForMachine } = require("./state");

const {
  getMisfeedCounts,
  groupCountsByItem,
  processCountStatistics,
  groupCountsByOperatorAndMachine,
  getValidCounts,
  getCountsForMachine
} = require("./count");



// async function buildLiveOperatorEfficiencySummary(states, counts, start, end, serial) {
//     const relevantCounts = counts.filter(
//       (c) =>
//         c.machine?.serial === serial &&
//         c.operator?.id &&
//         new Date(c.timestamp) >= start &&
//         new Date(c.timestamp) <= end
//     );
  
//     const groupedCounts = groupCountsByOperatorAndMachine(relevantCounts);
//     const operatorIds = new Set(relevantCounts.map((c) => c.operator.id));
//     const operatorSummaries = [];
  
//     const now = new Date();
//     const inputDate = new Date(end);
  
//     const timeWindows = {
//       last6Min: {
//         start: new Date(inputDate.setHours(now.getHours(), now.getMinutes() - 6, now.getSeconds())),
//         end: new Date(inputDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())),
//       },
//       last15Min: {
//         start: new Date(inputDate.setHours(now.getHours(), now.getMinutes() - 15, now.getSeconds())),
//         end: new Date(inputDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())),
//       },
//       lastHour: {
//         start: new Date(inputDate.setHours(now.getHours() - 1, now.getMinutes(), now.getSeconds())),
//         end: new Date(inputDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())),
//       },
//       allDay: { start, end },
//     };
  
//     for (const operatorId of operatorIds) {
//       const key = `${operatorId}-${serial}`;
//       const group = groupedCounts[key];
//       if (!group || !group.validCounts.length) continue;
  
//       const validCounts = group.validCounts;
//       const misfeedCounts = group.misfeedCounts || [];
//       const totalCounts = [...validCounts, ...misfeedCounts];
  
//       const efficiencies = {};
  
//       for (const [windowName, window] of Object.entries(timeWindows)) {
//         const windowValidCounts = validCounts.filter(
//           (c) => new Date(c.timestamp) >= window.start && new Date(c.timestamp) <= window.end
//         );
//         const windowMisfeedCounts = misfeedCounts.filter(
//           (c) => new Date(c.timestamp) >= window.start && new Date(c.timestamp) <= window.end
//         );
//         const windowTotalCounts = [...windowValidCounts, ...windowMisfeedCounts];
  
//         const windowStates = states.filter(
//           (s) =>
//             s.machine?.serial === serial &&
//             new Date(s.timestamp) >= window.start &&
//             new Date(s.timestamp) <= window.end
//         );
  
//         const runningCycles = extractAllCyclesFromStates(windowStates, window.start, window.end).running;
//         const runtimeMs = runningCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
  
//         const efficiency = calculateEfficiency(runtimeMs, windowTotalCounts.length, windowValidCounts);
//         efficiencies[windowName] = Math.round(efficiency * 10000) / 100;
//       }
  
//       // 🔍 Filter and sort states for latest machine state by this operator
//       const relevantStates = states
//         .filter(
//           (s) =>
//             s.machine?.serial === serial &&
//             Array.isArray(s.operators) &&
//             s.operators.some((op) => op?.id === operatorId)
//         )
//         .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
//       const mostRecent = relevantStates[0];
//       const statusCode = mostRecent?.status?.code ?? 0;
//       const statusName = mostRecent?.status?.name ?? "Unknown";
  
//       const allDayValidCounts = validCounts.filter(
//         (c) => new Date(c.timestamp) >= start && new Date(c.timestamp) <= end
//       );
  
//       const itemNamesSet = new Set(allDayValidCounts.map((c) => c.item?.name).filter(Boolean));
//       const itemsRunning = Array.from(itemNamesSet).join(", ");
  
//       const operatorInfo = validCounts[0]?.operator || { id: operatorId, name: "Unknown" };
  
//       operatorSummaries.push({
//         status: statusCode,
//         fault: statusName,
//         operator: operatorInfo.name,
//         operatorId: operatorInfo.id,
//         machine: mostRecent?.machine?.name || "Unknown",
//         timers: { on: 0, ready: 0 },
//         displayTimers: { on: "", run: "" },
//         efficiency: {
//           lastFiveMinutes: {
//             value: efficiencies.last6Min || 0,
//             label: "Current",
//             color: "#008000",
//           },
//           lastFifteenMinutes: {
//             value: efficiencies.last15Min || 0,
//             label: "15 mins",
//             color: "#008000",
//           },
//           lastHour: {
//             value: efficiencies.lastHour || 0,
//             label: "1 hr",
//             color: "#F89406",
//           },
//           today: {
//             value: efficiencies.allDay || 0,
//             label: "Today",
//             color: "#FF0000",
//           },
//         },
//         batch: {
//           item: itemsRunning || "Unknown",
//         },
//       });
//     }
  
//     return operatorSummaries;
//   }
  

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
  
        // Debug: Demo flipper data processed
  
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
  

// Get most recent state for a given machine serial and date
async function getMostRecentStateForMachine(db, serial, dateStr) {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  
    const now = new Date();
    const currentTimeOfDay = now.toISOString().split('T')[1]; // e.g., "14:32:55.000Z"
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
      if (shouldSkip) {
        // console.log("Skipping operator due to station 2:", operator);
        continue;
      }
    
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
    buildLiveOperatorEfficiencySummary,
    getMostRecentStateForMachine,
    buildInitialFlipperOutputs,
    computeEfficiencyForWindow,
    filterByTimeWindow
};
