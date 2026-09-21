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
  
  const { extractAllCyclesFromStates, extractFaultCycles } = require("./state");
  const {
    getMisfeedCounts,
    groupCountsByItem,
    processCountStatistics,
    groupCountsByOperatorAndMachine,
    getValidCounts,
  } = require("./count");


  
async function buildLevelTwoPerformance(
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

  async function buildOperatorEfficiencyAvg(states, counts, start, end, serial) {
    const groupedCounts = groupCountsByOperatorAndMachine(counts);
    const operatorIds = new Set(
      counts.map((c) => c.operator?.id).filter(Boolean)
    );
  
    const { runtime: totalRuntime } = calculateOperatorTimes(states, start, end);
  
    const operatorMetrics = [];
  
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
      operatorMetrics.push(efficiency * 100);
    }
  
    const avgEfficiency =
      operatorMetrics.reduce((sum, val) => sum + val, 0) /
      (operatorMetrics.length || 1);
  
    return avgEfficiency;
  }

  async function fetchGroupedAnalyticsData(db, start, end, groupBy = 'machine', options = {}) {
    const { targetSerials = [], operatorId = null } = options;
  
    // Build state query
    const stateQuery = {
      "timestamps.create": { $gte: start, $lte: end },
      "machine.serial": { $type: "int" }
    };
  
    if (groupBy === 'machine' && targetSerials.length > 0) {
      stateQuery["machine.serial"] = { $in: targetSerials };
    }
  
    // Build count query
    const countQuery = {
      "timestamps.create": { $gte: start, $lte: end },
      "machine.serial": { $type: "int" }
    };
  
    if (groupBy === 'machine' && targetSerials.length > 0) {
      countQuery["machine.serial"] = { $in: targetSerials };
    }
  
    if (groupBy === 'operator' && operatorId !== null) {
      countQuery["operator.id"] = operatorId;
    }
  
    const [states, counts] = await Promise.all([
      db.collection("state")
        .find(stateQuery)
        .project({
          timestamps: 1,
          "machine.serial": 1,
          "machine.name": 1,
          "machine.ipAddress": 1,
          program: 1,
          items: 1,
          operators: 1,
          "status.code": 1,
          "status.name": 1
        })
        .sort({ "timestamps.create": 1 })
        .toArray(),
  
      db.collection("count")
        .find(countQuery)
        .project({
          timestamps: 1,
          "machine.serial": 1,
          "machine.name": 1,
          "operator.id": 1,
          "operator.name": 1,
          "item.id": 1,
          "item.name": 1,
          "item.standard": 1,
          "item.station": 1,
          "item.lane": 1,
          misfeed: 1,
          program: 1
        })
        .sort({ "timestamps.create": 1 })
        .toArray()
    ]);
  
    const grouped = {};
  
    // Map of serial → name for quick access
    const machineNameMap = {};
    for (const state of states) {
      if (state.machine?.serial && state.machine?.name) {
        machineNameMap[state.machine.serial] = state.machine.name;
      }
    }
  
    if (groupBy === 'machine') {
      for (const state of states) {
        const serial = state.machine?.serial;
        if (serial == null) continue;
  
        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: {
              all: [],
              valid: [],
              misfeed: []
            },
            machineNames: machineNameMap
          };
        }
  
        grouped[serial].states.push(state);
      }
  
      for (const count of counts) {
        const serial = count.machine?.serial;
        if (serial == null) continue;
  
        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: {
              all: [],
              valid: [],
              misfeed: []
            },
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
        const serial = count.machine?.serial;
        if (operatorId && serial) {
          if (!operatorMachineMap[operatorId]) {
            operatorMachineMap[operatorId] = new Set();
          }
          operatorMachineMap[operatorId].add(serial);
        }
      }
  
      for (const count of counts) {
        const operatorId = count.operator?.id;
        if (operatorId == null) continue;
  
        if (!grouped[operatorId]) {
          grouped[operatorId] = {
            states: [],
            counts: {
              all: [],
              valid: [],
              misfeed: []
            },
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
  
  

  module.exports = {
    buildLevelTwoPerformance,
    buildOperatorEfficiencyAvg,
    fetchGroupedAnalyticsData
  };
