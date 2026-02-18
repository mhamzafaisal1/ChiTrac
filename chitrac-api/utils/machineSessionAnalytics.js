// Import dashboard builder functions
const {
  buildMachinePerformance,
  buildMachineItemSummary,
  buildItemHourlyStack,
  buildFaultData,
  buildOperatorEfficiency
} = require('./machineDashboardBuilder');

// Import utility functions
const {
  extractAllCyclesFromStates,
  extractFaultCycles
} = require('./state');

const {
  groupCountsByItem,
  processCountStatistics
} = require('./count');

const {
  calculateDowntime,
  calculateAvailability,
  calculateEfficiency,
  calculateOEE,
  calculateThroughput,
  calculateTotalCount,
  calculateOperatorTimes,
  calculateMisfeeds
} = require('./analytics');

const {
  formatDuration
} = require('./time');

async function buildMachineSessionAnalytics(db, machineSerial, paddedStart, paddedEnd) {
  // Step 1: Prepare all queries without executing them
  const inRangeStatesQ = db.collection("state")
    .find({ 
      "machine.serial": machineSerial, 
      timestamp: { $gte: paddedStart, $lte: paddedEnd } 
    })
    .sort({ timestamp: 1 });

  const beforeStartQ = db.collection("state")
    .find({ 
      "machine.serial": machineSerial, 
      timestamp: { $lt: paddedStart } 
    })
    .sort({ timestamp: -1 })
    .limit(1);

  const afterEndQ = db.collection("state")
    .find({ 
      "machine.serial": machineSerial, 
      timestamp: { $gt: paddedEnd } 
    })
    .sort({ timestamp: 1 })
    .limit(1);

  // Step 2: Fire all 3 queries in parallel
  const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
    inRangeStatesQ.toArray(),
    beforeStartQ.toArray(),
    afterEndQ.toArray()
  ]);

  const completeStates = [
    ...(beforeStart ? [beforeStart] : []),
    ...inRangeStates,
    ...(afterEnd ? [afterEnd] : [])
  ];

  if (!completeStates.length) return null;

  // Step 3: Process sessions in a single pass
  const sessions = [];
  let currentSession = null;

  for (const state of completeStates) {
    if (state.status?.code === 1) { // Running state
      if (!currentSession) {
        currentSession = { start: state, counts: [] };
      }
    } else if (currentSession) { // Non-running state ends session
      currentSession.end = state;
      sessions.push(currentSession);
      currentSession = null;
    }
  }

  // Handle case where machine is still running at end
  if (currentSession) {
    currentSession.end = afterEnd || completeStates.at(-1);
    sessions.push(currentSession);
  }

  // Step 4: Batch fetch all counts for all sessions in a single query
  if (sessions.length > 0) {
    const firstSessionStart = sessions[0].start.timestamp;
    const lastSessionEnd = sessions[sessions.length - 1].end.timestamp;

    const allCounts = await db.collection("count")
      .find({
        "machine.serial": machineSerial,
        timestamp: {
          $gte: firstSessionStart,
          $lte: lastSessionEnd
        }
      })
      .sort({ timestamp: 1 })
      .toArray();

    // Step 5: Distribute counts to sessions efficiently
    let countIndex = 0;
    for (const session of sessions) {
      const sessionStart = session.start.timestamp;
      const sessionEnd = session.end.timestamp;
      
      // Find counts for this session
      while (countIndex < allCounts.length) {
        const count = allCounts[countIndex];
        if (count.timestamp < sessionStart) {
          countIndex++;
          continue;
        }
        if (count.timestamp > sessionEnd) {
          break;
        }
        session.counts.push(count);
        countIndex++;
      }
    }
  }

  // Step 6: Extract all valid and misfeed counts once
  const allValidCounts = sessions.flatMap(s => 
    s.counts.filter(c => !c.misfeed && c.operator?.id !== -1)
  );
  const allMisfeedCounts = sessions.flatMap(s => 
    s.counts.filter(c => c.misfeed)
  );

  // Step 7: Build all metrics in parallel
  const latest = completeStates.at(-1);
  const [
    performance,
    itemSummary,
    itemHourlyStack,
    faultData,
    operatorEfficiency
  ] = await Promise.all([
    buildMachinePerformance(completeStates, allValidCounts, allMisfeedCounts, paddedStart, paddedEnd),
    buildMachineItemSummary(completeStates, allValidCounts, paddedStart, paddedEnd),
    buildItemHourlyStack(allValidCounts, paddedStart, paddedEnd),
    buildFaultData(completeStates, paddedStart, paddedEnd),
    buildOperatorEfficiency(completeStates, allValidCounts, paddedStart, paddedEnd, machineSerial)
  ]);

  return {
    machine: { serial: machineSerial, name: latest.machine?.name || "Unknown" },
    currentStatus: { code: latest.status?.code || 0, name: latest.status?.name || "Unknown" },
    performance,
    itemSummary,
    itemHourlyStack,
    faultData,
    operatorEfficiency,
    sessions: sessions.map(s => ({
      start: s.start.timestamp,
      end: s.end.timestamp,
      counts: s.counts.length
    }))
  };
}

// Version 2 of bookended states modularized; using sessions and counts and firing them in parallel using Promise.all (Very slow response time)
// async function buildMachineSessionAnalytics(db, machineSerial, paddedStart, paddedEnd) {
//   // Step 1: Prepare state queries
//   const inRangeStatesQ = db.collection("state")
//     .find({ 
//       "machine.serial": machineSerial, 
//       timestamp: { $gte: paddedStart, $lte: paddedEnd } 
//     })
//     .sort({ timestamp: 1 });

//   const beforeStartQ = db.collection("state")
//     .find({ 
//       "machine.serial": machineSerial, 
//       timestamp: { $lt: paddedStart } 
//     })
//     .sort({ timestamp: -1 })
//     .limit(1);

//   const afterEndQ = db.collection("state")
//     .find({ 
//       "machine.serial": machineSerial, 
//       timestamp: { $gt: paddedEnd } 
//     })
//     .sort({ timestamp: 1 })
//     .limit(1);

//   // Step 2: Fetch all states in parallel
//   const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
//     inRangeStatesQ.toArray(),
//     beforeStartQ.toArray(),
//     afterEndQ.toArray()
//   ]);

//   const completeStates = [
//     ...(beforeStart ? [beforeStart] : []),
//     ...inRangeStates,
//     ...(afterEnd ? [afterEnd] : [])
//   ];

//   if (!completeStates.length) return null;

//   // Step 3: Extract sessions
//   const sessions = [];
//   let currentSession = null;

//   for (const state of completeStates) {
//     if (state.status?.code === 1) {
//       if (!currentSession) {
//         currentSession = { start: state, counts: [] };
//       }
//     } else if (currentSession) {
//       currentSession.end = state;
//       sessions.push(currentSession);
//       currentSession = null;
//     }
//   }

//   if (currentSession) {
//     currentSession.end = afterEnd || completeStates.at(-1);
//     sessions.push(currentSession);
//   }

//   // Step 4: Query each session's counts in parallel
//   const countQueries = sessions.map(session =>
//     db.collection("count")
//       .find({
//         "machine.serial": machineSerial,
//         timestamp: {
//           $gte: session.start.timestamp,
//           $lte: session.end.timestamp
//         }
//       })
//       .sort({ timestamp: 1 })
//       .toArray()
//   );

//   const allSessionCounts = await Promise.all(countQueries);

//   // Step 5: Assign counts to each session
//   sessions.forEach((session, index) => {
//     session.counts = allSessionCounts[index];
//   });

//   // Step 6: Flatten valid and misfeed counts
//   const allValidCounts = sessions.flatMap(s => 
//     s.counts.filter(c => !c.misfeed && c.operator?.id !== -1)
//   );
//   const allMisfeedCounts = sessions.flatMap(s => 
//     s.counts.filter(c => c.misfeed)
//   );

//   const latest = completeStates.at(-1);

//   // Step 7: Build analytics in parallel
//   const [
//     performance,
//     itemSummary,
//     itemHourlyStack,
//     faultData,
//     operatorEfficiency
//   ] = await Promise.all([
//     buildMachinePerformance(completeStates, allValidCounts, allMisfeedCounts, paddedStart, paddedEnd),
//     buildMachineItemSummary(completeStates, allValidCounts, paddedStart, paddedEnd),
//     buildItemHourlyStack(allValidCounts, paddedStart, paddedEnd),
//     buildFaultData(completeStates, paddedStart, paddedEnd),
//     buildOperatorEfficiency(completeStates, allValidCounts, paddedStart, paddedEnd, machineSerial)
//   ]);

//   return {
//     machine: {
//       serial: machineSerial,
//       name: latest.machine?.name || "Unknown"
//     },
//     currentStatus: {
//       code: latest.status?.code || 0,
//       name: latest.status?.name || "Unknown"
//     },
//     performance,
//     itemSummary,
//     itemHourlyStack,
//     faultData,
//     operatorEfficiency,
//     sessions: sessions.map(s => ({
//       start: s.start.timestamp,
//       end: s.end.timestamp,
//       counts: s.counts.length
//     }))
//   };
// }

module.exports = { buildMachineSessionAnalytics };

  