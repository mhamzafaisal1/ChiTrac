const express = require("express");

const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  formatDuration,
} = require("../../utils/time");

const {
  fetchStatesForOperator,
  groupStatesByOperator,
  getCompletedCyclesForOperator,
  groupStatesByOperatorAndSerial,
  fetchStatesForMachine,
  extractAllCyclesFromStates,
} = require("../../utils/state");

const {
  getCountsForOperator,
  getValidCountsForOperator,
  getOperatorNameFromCount,
  processCountStatistics,
  groupCountsByOperatorAndMachine,
  getCountsForOperatorMachinePairs,
  getValidCounts,
} = require("../../utils/count");

const {
  buildSoftrolCycleSummary,
  assignOperatorsToRunningCyclesMulti,
  buildStationAlignedOperators,
} = require("../../utils/miscFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  

  router.get("/historic-data", async (req, res) => {
    try {
      // Use centralized time parser
      const { start, end } = parseAndValidateQueryParams(req);

      // Get latest state timestamp if end date is in the future
      const [latestState] = await db.collection('state')
        .find()
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();

      const effectiveEnd = new Date(end) > new Date() 
        ? (latestState?.timestamp || new Date()) 
        : end;

      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, effectiveEnd);

      // 1. Fetch and group states by operator and machine
      const allStates = await fetchStatesForOperator(
        db,
        null,
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // 2. Process completed cycles for each group
      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = { ...group, completedCycles };
        }
      }

      // 3. Get operator-machine pairs for count lookup
      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      // 4. Fetch and group counts
      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        end
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // 5. Process each group's cycles and counts
      const results = [];
      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [operatorId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${operatorId}-${machineSerial}`];
        if (!countGroup) continue;

        // Sort counts by timestamp for efficient processing
        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Process each cycle
        for (const cycle of group.completedCycles) {
          const summary = buildSoftrolCycleSummary(
            cycle,
            sortedCounts,
            countGroup
          );
          
          if (summary) {
            results.push({
              operatorId: parseInt(operatorId),
              machineSerial: parseInt(machineSerial),
              ...summary
            });
          }
        }
      }

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  // Softrol Route end


  // Repopulate State Collection with operators from count collection

  router.get("/repopulate-states", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const paddedStart = new Date(start);
      const paddedEnd = new Date(end);
      const targetSerial = parseInt(serial);
  
      const stateRecords = await db.collection("state").find({
        "machine.serial": targetSerial,
        timestamp: { $gte: paddedStart, $lte: paddedEnd },
      }).toArray();
  
      const countRecords = await db.collection("count").find({
        "machine.serial": targetSerial,
        timestamp: { $gte: paddedStart, $lte: paddedEnd },
      }).toArray();
  
      const updatedStates = [];
  
      for (const state of stateRecords) {
        const stateTime = new Date(state.timestamp);
      
        // Find the most recent count at or before the state timestamp
        const previousCounts = countRecords
          .filter((count) => new Date(count.timestamp) <= stateTime)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
        // Collect distinct operators from those recent counts (most recent first)
        const seenIds = new Set();
        const operators = [];
      
        for (const count of previousCounts) {
          const id = count.operator?.id ?? -1;
          if (id === -1 || seenIds.has(id)) continue;
      
          operators.push({
            id,
            name: count.operator?.name ?? null,
            station: count.item?.station ?? null
          });
      
          seenIds.add(id);
      
          if (operators.length === 8) break; // max 8 operators
        }
      
        while (operators.length < 8) {
          operators.push({ id: -1, name: null, station: null });
        }
      
        state.operators = operators;
        updatedStates.push(state);
      }
      
  
      res.json({
        serial: targetSerial,
        matchedStates: updatedStates.length,
        updatedStates
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dryer/preview-populated-operators", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      const states = await fetchStatesForMachine(db, serialNum, startDate, endDate);
      const counts = await getValidCounts(db, serialNum, startDate, endDate);
  
      if (!states.length || !counts.length) {
        return res.json({ matchedStates: 0, updatedStates: [] });
      }
  
      // Ensure counts are sorted ascending by timestamp
      counts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
      const updatedStates = [];
  
      for (const state of states) {
        const stateTime = new Date(state.timestamp);
  
        // Find the most recent count before or at this state timestamp
        const bestMatch = [...counts]
          .reverse()
          .find((count) => new Date(count.timestamp) <= stateTime);
  
        const operators = [];
  
        if (bestMatch) {
          operators.push({
            id: bestMatch.operator?.id ?? -1,
            name: bestMatch.operator?.name ?? null,
            station: bestMatch.item?.station ?? null
          });
        }
  
        // Fill up to 8 slots
        while (operators.length < 8) {
          operators.push({ id: -1, name: null, station: null });
        }
  
        updatedStates.push({
          ...state,
          operators
        });
      }
  
      res.json({
        matchedStates: updatedStates.length,
        updatedStates
      });
    } catch (err) {
      logger.error("Error in /dryer/preview-populated-operators:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  

  router.get("/dryer/operator-cycles", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      // Get all valid count records for that machine
      const counts = await db.collection("count").find({
        "machine.serial": serialNum,
        timestamp: { $gte: startDate, $lte: endDate },
        "operator.id": { $exists: true, $ne: -1 }
      }).sort({ timestamp: 1 }).toArray();
  
      if (!counts.length) {
        return res.json({ serial: serialNum, operatorCycles: [] });
      }
  
      const cycles = [];
      let currentOperator = counts[0].operator;
      let currentStart = new Date(counts[0].timestamp);
  
      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const { operator } = count;
  
        if (!operator || operator.id !== currentOperator.id) {
          // End the current cycle
          const currentEnd = new Date(counts[i - 1].timestamp);
          cycles.push({
            operatorId: currentOperator.id,
            name: currentOperator.name || 'Unknown',
            start: currentStart,
            end: currentEnd
          });
  
          // Start a new cycle
          currentOperator = operator;
          currentStart = new Date(count.timestamp);
        }
      }
  
      // Push the final cycle
      const lastTimestamp = new Date(counts.at(-1).timestamp);
      cycles.push({
        operatorId: currentOperator.id,
        name: currentOperator.name || 'Unknown',
        start: currentStart,
        end: lastTimestamp
      });
  
      res.json({
        serial: serialNum,
        operatorCycles: cycles
      });
    } catch (err) {
      logger.error("Error in /dryer/operator-cycles:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  

  router.get("/dryer/operator-cycles-dynamic", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      const counts = await db.collection("count").find({
        "machine.serial": serialNum,
        timestamp: { $gte: startDate, $lte: endDate },
        "operator.id": { $exists: true, $ne: -1 }
      }).sort({ timestamp: 1 }).toArray();
  
      if (counts.length === 0) {
        return res.json({ serial: serialNum, operatorCycles: [] });
      }
  
      const cycles = [];
      let currentOperator = counts[0].operator;
      let currentStart = new Date(counts[0].timestamp);
      let lastTimestamp = new Date(counts[0].timestamp);
  
      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(count.timestamp);
  
        if (count.operator.id !== currentOperator.id) {
          // Close previous session
          cycles.push({
            operatorId: currentOperator.id,
            name: currentOperator.name,
            start: currentStart,
            end: lastTimestamp
          });
  
          // Start new session
          currentOperator = count.operator;
          currentStart = ts;
        }
  
        lastTimestamp = ts;
      }
  
      // Push final session
      cycles.push({
        operatorId: currentOperator.id,
        name: currentOperator.name,
        start: currentStart,
        end: lastTimestamp
      });
  
      res.json({
        serial: serialNum,
        operatorCycles: cycles
      });
    } catch (err) {
      logger.error("Error in /dryer/operator-cycles-dynamic:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dryer/running-cycles", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);
      const serialNum = parseInt(serial);
  
      const states = await fetchStatesForMachine(db, serialNum, startDate, endDate);
      const runningCycles = extractAllCyclesFromStates(states, startDate, endDate, "running");
  
      res.json({
        serial: serialNum,
        total: runningCycles.length,
        cycles: runningCycles
      });
    } catch (err) {
      logger.error("Error in /dryer/running-cycles:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });



router.get("/dryer/running-with-operators", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const startDate = new Date(start);
    const endDate = new Date(end);
    const serialNum = parseInt(serial);

    const states = await fetchStatesForMachine(db, serialNum, startDate, endDate);
    const runningCycles = extractAllCyclesFromStates(states, startDate, endDate, "running");

    const counts = await db.collection("count").find({
      "machine.serial": serialNum,
      timestamp: { $gte: startDate, $lte: endDate },
      "operator.id": { $exists: true }
    }).sort({ timestamp: 1 }).toArray();

    const operatorSessions = [];
    if (counts.length > 0) {
      let currentOperator = counts[0].operator;
      let currentStart = new Date(counts[0].timestamp);
      let lastTimestamp = currentStart;

      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(count.timestamp);
        const id = count.operator?.id;

        if (id !== currentOperator.id) {
          operatorSessions.push({
            operatorId: currentOperator.id,
            name: currentOperator.name,
            start: currentStart,
            end: lastTimestamp
          });
          currentOperator = count.operator;
          currentStart = ts;
        }

        lastTimestamp = ts;
      }

      operatorSessions.push({
        operatorId: currentOperator.id,
        name: currentOperator.name,
        start: currentStart,
        end: lastTimestamp
      });
    }

    const paddingMs = 60 * 1000;

    // Final output array of modified state documents
    const updatedStateDocs = [];

    for (const cycle of runningCycles) {
      const runStart = new Date(cycle.start.getTime() - paddingMs);
      const runEnd = new Date(cycle.end.getTime() + paddingMs);

      const seen = new Set();
      const operators = [];

      for (const session of operatorSessions) {
        const opStart = new Date(session.start);
        const opEnd = new Date(session.end);
        const overlapStart = runStart > opStart ? runStart : opStart;
        const overlapEnd = runEnd < opEnd ? runEnd : opEnd;

        if (overlapEnd > overlapStart && !seen.has(session.operatorId)) {
          operators.push({
            id: session.operatorId,
            name: session.name
          });
          seen.add(session.operatorId);
        }

        if (operators.length >= 8) break;
      }

      while (operators.length < 8) {
        operators.push({ id: -1, name: "Offline" });
      }

      // Fetch all State records that fall within this cycle
      const statesInCycle = states.filter(s => {
        const ts = new Date(s.timestamp);
        return ts >= cycle.start && ts <= cycle.end;
      });

      for (const state of statesInCycle) {
        const cloned = { ...state, operators };
        updatedStateDocs.push(cloned);
      }
    }

    res.json({
      serial: serialNum,
      total: updatedStateDocs.length,
      updatedStates: updatedStateDocs
    });

  } catch (err) {
    logger.error("Error in /dryer/running-with-operators:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.get("/dryer/running-with-operators-test", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const startDate = new Date(start);
    const endDate = new Date(end);
    const serialNum = parseInt(serial);

    // Read from state-test collection
    const states = await fetchStatesForMachine(db, serialNum, startDate, endDate, "state-test");
    const runningCycles = extractAllCyclesFromStates(states, startDate, endDate, "running");

    const counts = await db.collection("count").find({
      "machine.serial": serialNum,
      timestamp: { $gte: startDate, $lte: endDate },
      "operator.id": { $exists: true }
    }).sort({ timestamp: 1 }).toArray();

    const operatorSessions = [];
    if (counts.length > 0) {
      let currentOperator = counts[0].operator;
      let currentStart = new Date(counts[0].timestamp);
      let lastTimestamp = currentStart;

      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(count.timestamp);
        const id = count.operator?.id;

        if (id !== currentOperator.id) {
          operatorSessions.push({
            operatorId: currentOperator.id,
            name: currentOperator.name,
            start: currentStart,
            end: lastTimestamp
          });
          currentOperator = count.operator;
          currentStart = ts;
        }

        lastTimestamp = ts;
      }

      operatorSessions.push({
        operatorId: currentOperator.id,
        name: currentOperator.name,
        start: currentStart,
        end: lastTimestamp
      });
    }

    const paddingMs = 60 * 1000;
    const bulkUpdates = [];

    for (const cycle of runningCycles) {
      const runStart = new Date(cycle.start.getTime() - paddingMs);
      const runEnd = new Date(cycle.end.getTime() + paddingMs);

      const seen = new Set();
      const operators = [];

      for (const session of operatorSessions) {
        const opStart = new Date(session.start);
        const opEnd = new Date(session.end);
        const overlapStart = runStart > opStart ? runStart : opStart;
        const overlapEnd = runEnd < opEnd ? runEnd : opEnd;

        if (overlapEnd > overlapStart && !seen.has(session.operatorId)) {
          operators.push({
            id: session.operatorId,
            name: session.name
          });
          seen.add(session.operatorId);
        }

        if (operators.length >= 8) break;
      }

      while (operators.length < 8) {
        operators.push({ id: -1, name: "Offline" });
      }

      const statesInCycle = states.filter(s => {
        const ts = new Date(s.timestamp);
        return ts >= cycle.start && ts <= cycle.end;
      });

      for (const state of statesInCycle) {
        bulkUpdates.push({
          updateOne: {
            filter: { _id: state._id },
            update: { $set: { operators } }
          }
        });
      }
    }

    if (bulkUpdates.length > 0) {
      const result = await db.collection("state-test").bulkWrite(bulkUpdates);
      res.json({
        message: "Operators updated in state-test collection.",
        matched: result.matchedCount,
        modified: result.modifiedCount
      });
    } else {
      res.json({ message: "No state records matched for update." });
    }

  } catch (err) {
    logger.error("Error in /dryer/running-with-operators:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



return router;

  
  return router;
};
