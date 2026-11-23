// Archived unused routes from controllers/alpha/miscRoutes.js. Not mounted by the application.
const { sessionMachineQuery, distinctSessionMachineIds } = require('../../utils/sessionIdentity');
const express = require("express");
const { formatHumanName } = require("../../utils/humanNames");

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
  groupStatesByMachine,
  processAllMachinesCycles,
  getAllMachinesFromStates,
  calculateHourlyStateDurations,
  extractFaultCycles,
} = require("../../utils/state");

const {
  getCountRecords,
  getOperatorItemMapFromCounts,
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
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");

const { getBookendedStatesAndTimeRange } = require("../../utils/machineFunctions");

const recordTimestamp = (record) => record?.timestamps?.create;


module.exports = function archivedRoutes(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

router.get("/repopulate-states", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const paddedStart = new Date(start);
      const paddedEnd = new Date(end);
      const targetSerial = parseInt(serial);
  
      const stateRecords = await db.collection("state").find({
        "machine.serial": targetSerial,
        "timestamps.create": { $gte: paddedStart, $lte: paddedEnd },
      }).toArray();
  
      const countRecords = await db.collection("count").find({
        "machine.serial": targetSerial,
        "timestamps.create": { $gte: paddedStart, $lte: paddedEnd },
      }).toArray();
  
      const updatedStates = [];
  
      for (const state of stateRecords) {
        const stateTime = new Date(recordTimestamp(state));
      
        // Find the most recent count at or before the state timestamp
        const previousCounts = countRecords
          .filter((count) => new Date(recordTimestamp(count)) <= stateTime)
          .sort((a, b) => new Date(recordTimestamp(b)) - new Date(recordTimestamp(a)));
      
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
      counts.sort((a, b) => new Date(recordTimestamp(a)) - new Date(recordTimestamp(b)));
  
      const updatedStates = [];
  
      for (const state of states) {
        const stateTime = new Date(recordTimestamp(state));
  
        // Find the most recent count before or at this state timestamp
        const bestMatch = [...counts]
          .reverse()
          .find((count) => new Date(recordTimestamp(count)) <= stateTime);
  
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
      "timestamps.create": { $gte: startDate, $lte: endDate },
      "operator.id": { $exists: true }
    }).sort({ "timestamps.create": 1 }).toArray();

    const operatorSessions = [];
    if (counts.length > 0) {
      let currentOperator = counts[0].operator;
      let currentStart = new Date(recordTimestamp(counts[0]));
      let lastTimestamp = currentStart;

      for (let i = 1; i < counts.length; i++) {
        const count = counts[i];
        const ts = new Date(recordTimestamp(count));
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
        const ts = new Date(recordTimestamp(s));
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
};
