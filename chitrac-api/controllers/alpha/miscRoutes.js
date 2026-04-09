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
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");

const { getBookendedStatesAndTimeRange } = require("../../utils/machineFunctions");

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


// FROM REPORTSESSIONSROUTES.JS

router.get("/analytics/machine-item-sessions-summary", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);

    // ---------- helpers (local to route) ----------
    const topNSlicesPerBar = 10;
    const OTHER_LABEL = "Other";

    // Merge-slices so each bar has at most N slices (Top N-1 + "Other")
    function compressSlicesPerBar(
      perLabelTotals,
      N = topNSlicesPerBar,
      otherLabel = OTHER_LABEL
    ) {
      const entries = Object.entries(perLabelTotals);
      if (entries.length <= N) return perLabelTotals;

      entries.sort((a, b) => b[1] - a[1]);
      const keep = entries.slice(0, N - 1);
      const rest = entries.slice(N - 1);
      const otherSum = rest.reduce((s, [, v]) => s + v, 0);

      const out = {};
      for (const [k, v] of keep) out[k] = v;
      out[otherLabel] = otherSum;
      return out;
    }

    // Convert {serial -> {label -> value}} into XY-style stacked series
    function toStackedSeries(
      byMachine,
      serialToName,
      orderSerials,
      stackId
    ) {
      // union of labels (after compression)
      const labels = new Set();
      for (const s of orderSerials) {
        const m = byMachine.get(s);
        if (!m) continue;
        Object.keys(m).forEach((k) => labels.add(k));
      }
      
      // Sort labels by total descending for stable legend order
      const sortedLabels = [...labels].sort((a, b) => {
        const totalA = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[a] || 0), 0);
        const totalB = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[b] || 0), 0);
        return totalB - totalA;
      });
      
      // make one series per label
      const series = sortedLabels.map((label) => ({
        id: label,
        title: label,
        type: "bar",
        stack: stackId,
        data: orderSerials.map((serial) => ({
          x: serialToName.get(serial) || serial,
          y: (byMachine.get(serial) && byMachine.get(serial)[label]) || 0,
        })),
      }));
      return series;
    }

    // ---------- 1) Sessions & Items (existing logic) ----------
    const match = {
      ...(serial ? { "machine.serial": serial } : {}),
      "timestamps.start": { $lte: exactEnd },
      $or: [
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": { $gte: exactStart } },
      ],
    };

    const sessions = await db
      .collection(config.machineSessionCollectionName)
      .aggregate([
        { $match: match },
        {
          $addFields: {
            ovStart: { $max: ["$timestamps.start", exactStart] },
            ovEnd: {
              $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd],
            },
          },
        },
        {
          $addFields: {
            sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] },
          },
        },
        {
          $project: {
            _id: 0,
            timestamps: 1,
            machine: 1,
            operators: 1,
            countsFiltered: {
              $map: {
                input: {
                  $filter: {
                    input: "$counts",
                    as: "c",
                    cond: {
                      $and: [
                        { $gte: ["$$c.timestamp", exactStart] },
                        { $lte: ["$$c.timestamp", exactEnd] },
                      ],
                    },
                  },
                },
                as: "c",
                in: {
                  timestamp: "$$c.timestamp",
                  item: {
                    id: "$$c.item.id",
                    name: "$$c.item.name",
                    standard: "$$c.item.standard",
                  },
                },
              },
            },
            ovStart: 1,
            ovEnd: 1,
            sliceMs: 1,
          },
        },
      ])
      .toArray();

    if (!sessions.length) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Machine Status Stacked Bar", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked Efficiency% by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Efficiency (%)", series:[{ id:"Efficiency", title:"Efficiency", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        }
      });
    }

    // Group for original results + for building charts
    const grouped = new Map(); // serial -> bucket

    for (const s of sessions) {
      const key = s.machine?.serial;
      if (!key) continue;
      if (!grouped.has(key)) {
        grouped.set(key, {
          machine: { name: s.machine?.name || "Unknown", serial: key },
          sessions: [],
          itemAgg: new Map(),
          totalCount: 0,
          totalWorkedMs: 0,
          totalRuntimeMs: 0,
        });
      }
      const bucket = grouped.get(key);

      if (!s.sliceMs || s.sliceMs <= 0) continue;

      const activeStations = Array.isArray(s.operators)
        ? s.operators.filter((op) => op && op.id !== -1).length
        : 0;

      const workedTimeMs = Math.max(0, s.sliceMs * activeStations);
      const runtimeMs = Math.max(0, s.sliceMs);

      // Check if this is a synthetic "total" session spanning the whole timeRange
      const sessionStart = new Date(s.ovStart);
      const sessionEnd = new Date(s.ovEnd);
      const isSyntheticTotal = (
        Math.abs(sessionStart.getTime() - exactStart.getTime()) < 1000 && // within 1 second of exact start
        Math.abs(sessionEnd.getTime() - exactEnd.getTime()) < 1000 &&     // within 1 second of exact end
        s.sliceMs > (exactEnd.getTime() - exactStart.getTime()) * 0.9     // covers >90% of time range
      );

      // Only add to sessions array if it's not a synthetic total
      if (!isSyntheticTotal) {
        bucket.sessions.push({
          start: new Date(s.ovStart).toISOString(),
          end: new Date(s.ovEnd).toISOString(),
          workedTimeMs,
          workedTimeFormatted: formatDuration(workedTimeMs),
          runtimeMs,
          runtimeFormatted: formatDuration(runtimeMs),
        });
      }

      // Always add to runtime totals for summary math
      bucket.totalRuntimeMs += runtimeMs;

      const counts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
      if (!counts.length) continue;

      const byItem = new Map();
      for (const c of counts) {
        const it = c.item || {};
        const id = it.id;
        if (id == null) continue;
        if (!byItem.has(id)) {
          byItem.set(id, {
            id,
            name: it.name || "Unknown",
            standard: Number(it.standard) || 0,
            count: 0,
          });
        }
        byItem.get(id).count += 1;
      }

      // Apportion worked time across items by count share
      const totalSessionItemCount = [...byItem.values()].reduce((s, it) => s + it.count, 0) || 1;

      for (const [, itm] of byItem) {
        const share = itm.count / totalSessionItemCount;
        const workedShare = workedTimeMs * share;

        const rec =
          bucket.itemAgg.get(itm.id) || {
            name: itm.name,
            standard: itm.standard,
            count: 0,
            workedTimeMs: 0,
          };
        rec.count += itm.count;
        rec.workedTimeMs += workedShare;
        bucket.itemAgg.set(itm.id, rec);

        bucket.totalCount += itm.count;
        bucket.totalWorkedMs += workedShare;   // track worked time consistently
      }
    }

    const results = [];
    const serialToName = new Map();

    for (const [, b] of grouped) {
      // Skip machines with no production data
      if (b.totalCount === 0) {
        continue;
      }

      serialToName.set(b.machine.serial, b.machine.name);

      let proratedStandard = 0;
      const itemSummaries = {};

      for (const [itemId, s] of b.itemAgg.entries()) {
        const hours = s.workedTimeMs / 3600000;
        const pph = hours > 0 ? s.count / hours : 0;
        const eff = s.standard > 0 ? pph / s.standard : 0;
        const weight = b.totalCount > 0 ? s.count / b.totalCount : 0;
        proratedStandard += weight * s.standard;

        itemSummaries[itemId] = {
          name: s.name,
          standard: s.standard,
          countTotal: s.count,
          workedTimeFormatted: formatDuration(s.workedTimeMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100,
        };
      }

      // Recalculate runtime from actual sessions (excluding synthetic totals)
      const actualRuntimeMs = b.sessions.reduce((sum, session) => sum + session.runtimeMs, 0);
      
      // Use worked time for PPH calculation
      const USE_WORKED_TIME = true;
      const hours = USE_WORKED_TIME ? (b.totalWorkedMs / 3600000) : (actualRuntimeMs / 3600000);
      const machinePph = hours > 0 ? b.totalCount / hours : 0;
      const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

      results.push({
        machine: b.machine,
        sessions: b.sessions,
        machineSummary: {
          totalCount: b.totalCount,
          workedTimeMs: b.totalWorkedMs,
          workedTimeFormatted: formatDuration(b.totalWorkedMs),
          runtimeMs: actualRuntimeMs,
          runtimeFormatted: formatDuration(actualRuntimeMs),
          pph: Math.round(machinePph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(machineEff * 10000) / 100,
          itemSummaries,
        },
      });
    }

    // ---------- 2) Status stacked (durations) ----------
    // Calculate actual status durations using machine-session and fault-session collections
    // Similar to the daily dashboard machine status approach
    
    const msColl = db.collection(config.machineSessionCollectionName);
    const fsColl = db.collection(config.faultSessionCollectionName);

    // Get all machines that have sessions in the time window
    const machineSerials = await msColl.distinct("machine.serial", {
      "timestamps.start": { $lt: exactEnd },
      $or: [
        { "timestamps.end": { $gt: exactStart } }, 
        { "timestamps.end": { $exists: false } }, 
        { "timestamps.end": null }
      ],
      ...(serial ? { "machine.serial": serial } : {})
    });

    const statusByMachine = new Map();

    // Helper function to calculate overlap
    const overlap = (sStart, sEnd, wStart, wEnd) => {
      const ss = new Date(sStart);
      const se = new Date(sEnd || wEnd);
      const os = ss > wStart ? ss : wStart;
      const oe = se < wEnd ? se : wEnd;
      const ovSec = Math.max(0, (oe - os) / 1000);
      const fullSec = Math.max(0, (se - ss) / 1000);
      const f = fullSec > 0 ? ovSec / fullSec : 0;
      return { ovSec, fullSec, factor: f };
    };

    const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);

    for (const machineSerial of machineSerials) {
      const [msessions, fsessions] = await Promise.all([
        msColl.find({
          "machine.serial": machineSerial,
          "timestamps.start": { $lt: exactEnd },
          $or: [
            { "timestamps.end": { $gt: exactStart } }, 
            { "timestamps.end": { $exists: false } }, 
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, machine: 1, timestamps: 1, runtime: 1
        }).toArray(),
        fsColl.find({
          "machine.serial": machineSerial,
          "timestamps.start": { $lt: exactEnd },
          $or: [
            { "timestamps.end": { $gt: exactStart } }, 
            { "timestamps.end": { $exists: false } }, 
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, timestamps: 1, faulttime: 1
        }).toArray()
      ]);

      if (!msessions.length) continue;

      // Calculate runtime (Running status)
      let runtimeSec = 0;
      for (const s of msessions) {
        const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, exactStart, exactEnd);
        runtimeSec += safe(s.runtime) * factor; // runtime is stored in seconds
      }

      // Calculate fault time (Faulted status)
      let faultSec = 0;
      for (const fs of fsessions) {
        const sStart = fs.timestamps?.start;
        const sEnd = fs.timestamps?.end || exactEnd;
        const { ovSec, fullSec } = overlap(sStart, sEnd, exactStart, exactEnd);
        if (ovSec === 0) continue;
        const ft = safe(fs.faulttime);
        if (ft > 0 && fullSec > 0) {
          const factor = ovSec / fullSec;
          faultSec += ft * factor;
        } else {
          // open/unfinished or unrecalculated fault-session → use overlap duration
          faultSec += ovSec;
        }
      }

      // Calculate downtime (Paused/Idle status)
      const windowMs = exactEnd - exactStart;
      const runningMs = Math.round(runtimeSec * 1000);
      const faultedMs = Math.round(faultSec * 1000);
      const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));

      // Convert to hours for chart display
      const runningHours = runningMs / 3600000;
      const faultedHours = faultedMs / 3600000;
      const downtimeHours = downtimeMs / 3600000;

      const machineName = msessions[0]?.machine?.name || `Serial ${machineSerial}`;
      serialToName.set(machineSerial, machineName);

      statusByMachine.set(machineSerial, {
        "Running": runningHours,
        "Faulted": faultedHours,
        "Paused": downtimeHours
      });
    }
    // compress per machine
    for (const [s, rec] of statusByMachine) {
      statusByMachine.set(s, compressSlicesPerBar(rec));
    }

    // Ensure we have status data for all machines in results
    for (const result of results) {
      const serial = result.machine.serial;
      if (!statusByMachine.has(serial)) {
        statusByMachine.set(serial, { "No Data": 0 });
      }
    }

    // ---------- 3) Faults stacked (durations by fault type) ----------
    // Based on faultSessionRoutes.js structure - extract fault info from startState
    
    const faultsAggRaw = await db
      .collection(config.faultSessionCollectionName)
      .aggregate([
        {
          $match: {
            ...(serial ? { "machine.serial": serial } : {}),
            "timestamps.start": { $lte: exactEnd },
            $or: [
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": { $gte: exactStart } },
            ],
          },
        },
        {
          $addFields: {
            ovStart: { $max: ["$timestamps.start", exactStart] },
            ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
          },
        },
        { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
        {
          $project: {
            machine: 1,
            sliceMs: 1,
            label: {
              $ifNull: [
                "$startState.status.name",
                { $ifNull: ["$startState.status.code", "Unknown"] },
              ],
            },
          },
        },
        { $match: { sliceMs: { $gt: 0 } } },
        {
          $group: {
            _id: { serial: "$machine.serial", label: "$label" },
            name: { $first: "$machine.name" },
            totalMs: { $sum: "$sliceMs" },
          },
        },
      ])
      .toArray();

    const faultsByMachine = new Map();
    for (const row of faultsAggRaw) {
      const s = row._id.serial;
      const label = String(row._id.label || "Unknown");
      const val = Number(row.totalMs || 0) / 3600000; // Convert ms to hours
      if (!faultsByMachine.has(s)) faultsByMachine.set(s, {});
      faultsByMachine.get(s)[label] = (faultsByMachine.get(s)[label] || 0) + val;
      if (!serialToName.has(s)) serialToName.set(s, row.name || s);
    }
    // Global compression: find top fault types across all machines
    const globalFaultTotals = new Map();
    for (const [, rec] of faultsByMachine) {
      for (const [faultType, hours] of Object.entries(rec)) {
        globalFaultTotals.set(faultType, (globalFaultTotals.get(faultType) || 0) + hours);
      }
    }
    
    // Get top fault types globally
    const sortedGlobalFaults = Array.from(globalFaultTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topNSlicesPerBar - 1)
      .map(([type]) => type);
    
    // Apply global compression to each machine
    for (const [s, rec] of faultsByMachine) {
      const compressed = {};
      let otherSum = 0;
      
      for (const [faultType, hours] of Object.entries(rec)) {
        if (sortedGlobalFaults.includes(faultType)) {
          compressed[faultType] = hours;
        } else {
          otherSum += hours;
        }
      }
      
      if (otherSum > 0) {
        compressed[OTHER_LABEL] = otherSum;
      }
      
      faultsByMachine.set(s, compressed);
    }

    for (const result of results) {
      const serial = result.machine.serial;
      if (!faultsByMachine.has(serial)) {
        faultsByMachine.set(serial, { "No Faults": 0 });
      }
    }

    // ---------- 4) Efficiency ranking order ----------
    const efficiencyRanked = results
      .map(r => ({
        serial: r.machine.serial,
        name: r.machine.name,
        efficiency: Number(r.machineSummary?.efficiency || 0),
      }))
      .sort((a, b) => b.efficiency - a.efficiency);

    // Build comprehensive machine ordering from all data sources
    const unionSerials = new Set(efficiencyRanked.map(r => r.serial));
    for (const m of statusByMachine.keys()) unionSerials.add(m);
    for (const m of faultsByMachine.keys()) unionSerials.add(m);
    const finalOrderSerials = [...unionSerials].filter(s => serialToName.has(s));

    // ---------- 5) Items stacked  ----------
    const itemsByMachine = new Map();
    for (const r of results) {
      const m = {};
      for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
        const label = s.name || String(id);
        const count = Number(s.countTotal || 0);
        m[label] = (m[label] || 0) + count;
      }
      itemsByMachine.set(r.machine.serial, compressSlicesPerBar(m));
    }
    const itemsStacked = toStackedSeries(itemsByMachine, serialToName, finalOrderSerials, "items");
    const statusStacked = toStackedSeries(statusByMachine, serialToName, finalOrderSerials, "status");
    const faultsStacked = toStackedSeries(faultsByMachine, serialToName, finalOrderSerials, "faults");

    // ---------- 6) Final payload ----------
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,                  // original detailed per-machine results (unchanged shape)
      charts: {
        statusStacked: {
          title: "Machine Status Stacked Bar",
          orientation: "vertical",
          xType: "category",
          xLabel: "Machine",
          yLabel: "Duration (hours)",
          series: statusStacked
        },
        efficiencyRanked: {
          title: "Ranked OEE% by Machine", 
          orientation: "horizontal",
          xType: "category",
          xLabel: "Machine",
          yLabel: "OEE (%)",
          series: [
            {
              id: "OEE",
              title: "OEE",
              type: "bar",
              data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
            },
          ]
        },
        itemsStacked: {
          title: "Item Stacked Bar by Machine",
          orientation: "vertical", 
          xType: "category",
          xLabel: "Machine",
          yLabel: "Item Count",
          series: itemsStacked
        },
        faultsStacked: {
          title: "Fault Stacked Bar by Machine",
          orientation: "vertical",
          xType: "category", 
          xLabel: "Machine",
          yLabel: "Fault Duration (hours)",
          series: faultsStacked
        },
        order: finalOrderSerials.map(s => serialToName.get(s) || s), // machine display order (ranked)
      },
    });
  } catch (error) {
    console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate machine item summary" });
  }
});



router.get("/analytics/operator-item-sessions-summary", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
    const exactStart = new Date(start);
    const exactEnd = new Date(end);

  const topNSlicesPerBar = 10;
  const OTHER_LABEL = "Other";
  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);

  function compressSlicesPerBar(perLabelTotals, N = topNSlicesPerBar, otherLabel = OTHER_LABEL) {
    const entries = Object.entries(perLabelTotals);
    if (entries.length <= N) return perLabelTotals;
    entries.sort((a, b) => b[1] - a[1]);
    const keep = entries.slice(0, N - 1);
    const rest = entries.slice(N - 1);
    const otherSum = rest.reduce((s, [, v]) => s + v, 0);
    const out = {};
    for (const [k, v] of keep) out[k] = v;
    out[otherLabel] = otherSum;
    return out;
  }

  function toStackedSeries(byKey, keyToName, orderKeys, stackId) {
    const labels = new Set();
    for (const k of orderKeys) {
      const m = byKey.get(k);
      if (!m) continue;
      Object.keys(m).forEach((lab) => labels.add(lab));
    }
    const sortedLabels = [...labels].sort((a, b) => {
      const totalA = orderKeys.reduce((sum, k) => sum + (byKey.get(k)?.[a] || 0), 0);
      const totalB = orderKeys.reduce((sum, k) => sum + (byKey.get(k)?.[b] || 0), 0);
      return totalB - totalA;
    });
    return sortedLabels.map((label) => ({
      id: label,
      title: label,
      type: "bar",
      stack: stackId,
      data: orderKeys.map((k) => ({
        x: keyToName.get(k) || String(k),
        y: (byKey.get(k) && byKey.get(k)[label]) || 0,
      })),
    }));
  }

  function formatMs(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return { hours: h, minutes: mm };
  }

    const match = {
      ...(operatorId ? { "operator.id": operatorId } : {}),
      "timestamps.start": { $lte: exactEnd },
      $or: [
        { "timestamps.end": { $exists: false } },
      { "timestamps.end": { $gte: exactStart } },
    ],
    };

  const opSessions = await db
      .collection(config.operatorSessionCollectionName)
      .aggregate([
        { $match: match },
        {
          $addFields: {
            ovStart: { $max: ["$timestamps.start", exactStart] },
          ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
        },
      },
      { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
        {
          $project: {
            _id: 0,
            timestamps: 1,
            operator: 1,
            machine: 1,
            countsFiltered: {
              $map: {
                input: {
                  $filter: {
                    input: "$counts",
                    as: "c",
                    cond: {
                      $and: [
                        { $gte: ["$$c.timestamp", exactStart] },
                      { $lte: ["$$c.timestamp", exactEnd] },
                    ],
                  },
                },
                },
                as: "c",
                in: {
                  timestamp: "$$c.timestamp",
                item: { id: "$$c.item.id", name: "$$c.item.name", standard: "$$c.item.standard" },
              },
            },
            },
            ovStart: 1,
            ovEnd: 1,
          sliceMs: 1,
        },
      },
      ])
      .toArray();

  if (!opSessions.length) {
    return res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results: [],
      charts: {
        statusStacked: { title:"Operator Status Stacked Bar", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Duration (hours)", series: [] },
        efficiencyRanked: { title:"Ranked OEE% by Operator", orientation:"horizontal", xType:"category", xLabel:"Operator", yLabel:"OEE (%)", series:[{ id:"OEE", title:"OEE", type:"bar", data:[] }] },
        itemsStacked: { title:"Item Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Item Count", series: [] },
        faultsStacked: { title:"Fault Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Fault Duration (hours)", series: [] },
        order: []
      }
    });
  }

  const grouped = new Map(); // opId -> bucket
  const opIdToName = new Map();

  // Helper functions
  const validId = id => Number.isInteger(id) && id >= 0;
  const canonicalName = (name, id) => {
    if (!name) return `Operator ${id}`;
    // Handle object format { first, surname }
    if (typeof name === 'object' && name !== null) {
      const fullName = `${name.first || ''} ${name.surname || ''}`.trim();
      return fullName || `Operator ${id}`;
    }
    // Handle string format
    if (typeof name === 'string') {
      return name.trim() || `Operator ${id}`;
    }
    return `Operator ${id}`;
  };

  for (const s of opSessions) {
    const op = s.operator?.id;
    if (!validId(op)) continue;

    const opName = canonicalName(s.operator?.name, op);

    if (!grouped.has(op)) {
      grouped.set(op, {
        operator: { id: op, name: opName },
          totalRunMs: 0,
        totalWorkedMs: 0,
        totalCount: 0,
        itemAgg: new Map(), // itemId -> { name, standard, count, workedTimeMs }
        sessions: [],       // for display, non-synthetic windows
        });
      }
    opIdToName.set(op, opName);
    const bucket = grouped.get(op);

      if (!s.sliceMs || s.sliceMs <= 0) continue;

    // Check if this is a synthetic "total" session spanning the whole timeRange
    const sessionStart = new Date(s.ovStart);
    const sessionEnd = new Date(s.ovEnd);
    const isSyntheticTotal = (
      Math.abs(sessionStart.getTime() - exactStart.getTime()) < 1000 && // within 1 second of exact start
      Math.abs(sessionEnd.getTime() - exactEnd.getTime()) < 1000 &&     // within 1 second of exact end
      s.sliceMs > (exactEnd.getTime() - exactStart.getTime()) * 0.9     // covers >90% of time range
    );

    // Only add to sessions array if it's not a synthetic total
    if (!isSyntheticTotal) {
      bucket.sessions.push({
        start: new Date(s.ovStart).toISOString(),
        end: new Date(s.ovEnd).toISOString(),
        runtimeMs: s.sliceMs,
        runtimeFormatted: formatMs(s.sliceMs),
      });
    }

    // Always add to runtime totals for summary math
    bucket.totalRunMs += s.sliceMs;

    const counts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
    if (!counts.length) continue;

    const byItem = new Map();
      for (const c of counts) {
        const it = c.item || {};
        const id = it.id;
        if (id == null) continue;
      if (!byItem.has(id)) {
        byItem.set(id, { id, name: it.name || "Unknown", standard: Number(it.standard) || 0, count: 0 });
      }
      byItem.get(id).count += 1;
    }

    // Apportion worked time across items by count share
    const totalSessionItemCount = [...byItem.values()].reduce((sum, it) => sum + it.count, 0) || 1;

    for (const [, it] of byItem) {
      const share = it.count / totalSessionItemCount;
      const workedShare = s.sliceMs * share;

      const rec = bucket.itemAgg.get(it.id) || { name: it.name, standard: it.standard, count: 0, workedTimeMs: 0 };
      rec.count += it.count;
      rec.workedTimeMs += workedShare;
      bucket.itemAgg.set(it.id, rec);

      bucket.totalCount += it.count;
      bucket.totalWorkedMs += workedShare;   // track worked time consistently
    }
  }

  // Build results and efficiency
  const results = [];
  for (const [, b] of grouped) {
    // Skip operators with no production data
    if (b.totalCount === 0) {
      continue;
    }

    let proratedStandard = 0;
    const itemSummaries = {};
    for (const [itemId, s] of b.itemAgg.entries()) {
      const hours = s.workedTimeMs / 3600000;
      const pph = hours > 0 ? s.count / hours : 0;
      const eff = s.standard > 0 ? pph / s.standard : 0;
      const weight = b.totalCount > 0 ? s.count / b.totalCount : 0;
      proratedStandard += weight * s.standard;

      itemSummaries[itemId] = {
        name: s.name,
        standard: s.standard,
        countTotal: s.count,
        workedTimeFormatted: formatMs(s.workedTimeMs),
        pph: Math.round(pph * 100) / 100,
        efficiency: Math.round(eff * 10000) / 100,
      };
    }

    // Recalculate runtime from actual sessions (excluding synthetic totals)
    const actualRuntimeMs = b.sessions.reduce((sum, session) => sum + session.runtimeMs, 0);
    
    // Use worked time for PPH calculation
    const USE_WORKED_TIME = true;
    const hours = USE_WORKED_TIME ? (b.totalWorkedMs / 3600000) : (actualRuntimeMs / 3600000);
    const operatorPph = hours > 0 ? b.totalCount / hours : 0;
    const operatorEff = proratedStandard > 0 ? operatorPph / proratedStandard : 0;

    results.push({
      operator: b.operator,
      sessions: b.sessions,
      operatorSummary: {
        totalCount: b.totalCount,
        workedTimeMs: b.totalWorkedMs,
        workedTimeFormatted: formatMs(b.totalWorkedMs),
        runtimeMs: actualRuntimeMs,
        runtimeFormatted: formatMs(actualRuntimeMs),
        pph: Math.round(operatorPph * 100) / 100,
        proratedStandard: Math.round(proratedStandard * 100) / 100,
        efficiency: Math.round(operatorEff * 10000) / 100,
        itemSummaries,
      },
    });
  }

  // ---------- 2) Status stacked (durations) ----------
  // Calculate actual status durations using operator-session and fault-session collections
  // Similar to the daily dashboard machine status approach but for operators
  
  const opColl = db.collection(config.operatorSessionCollectionName);
  const fsColl = db.collection(config.faultSessionCollectionName);

  // Get all operators that have sessions in the time window
  const allOperatorIds = await opColl.distinct("operator.id", {
    "timestamps.start": { $lt: exactEnd },
    $or: [
      { "timestamps.end": { $gt: exactStart } }, 
      { "timestamps.end": { $exists: false } }, 
      { "timestamps.end": null }
    ],
    ...(operatorId ? { "operator.id": operatorId } : {})
  });
  
  // Filter to only valid operator IDs
  const operatorIds = allOperatorIds.filter(validId);

  const statusByOperator = new Map();

  // Helper function to calculate overlap
  const overlap = (sStart, sEnd, wStart, wEnd) => {
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const f = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor: f };
  };

  // Helper function to detect synthetic sessions
  const isSynthetic = (s) => {
    const ss = new Date(s.timestamps?.start);
    const se = new Date(s.timestamps?.end || exactEnd);
    return Math.abs(ss - exactStart) < 1000 &&
           Math.abs(se - exactEnd) < 1000 &&
           (se - ss) > 0.9 * (exactEnd - exactStart);
  };

  for (const opId of operatorIds) {
    const [opSessions, fsessions] = await Promise.all([
      opColl.find({
        "operator.id": opId,
        "timestamps.start": { $lt: exactEnd },
        $or: [
          { "timestamps.end": { $gt: exactStart } }, 
          { "timestamps.end": { $exists: false } }, 
          { "timestamps.end": null }
        ]
      }).project({
        _id: 0, operator: 1, timestamps: 1
      }).toArray(),
      fsColl.find({
        "operator.id": opId,
        "timestamps.start": { $lt: exactEnd },
        $or: [
          { "timestamps.end": { $gt: exactStart } }, 
          { "timestamps.end": { $exists: false } }, 
          { "timestamps.end": null }
        ]
      }).project({
        _id: 0, timestamps: 1, faulttime: 1
      }).toArray()
    ]);

    if (!opSessions.length) continue;

    // Calculate runtime (Running status) - operator session time
    // Exclude synthetic totals from status calculation
    let runtimeSec = 0;
    for (const s of opSessions) {
      if (isSynthetic(s)) continue; // skip synthetic sessions
      const { ovSec } = overlap(s.timestamps?.start, s.timestamps?.end, exactStart, exactEnd);
      runtimeSec += ovSec;
    }
    
    // Optional hard clamp (safety)
    runtimeSec = Math.min(runtimeSec, (exactEnd - exactStart) / 1000);

    // Calculate fault time (Faulted status)
    let faultSec = 0;
    for (const fs of fsessions) {
      const sStart = fs.timestamps?.start;
      const sEnd = fs.timestamps?.end || exactEnd;
      const { ovSec, fullSec } = overlap(sStart, sEnd, exactStart, exactEnd);
      if (ovSec === 0) continue;
      const ft = safe(fs.faulttime);
      if (ft > 0 && fullSec > 0) {
        const factor = ovSec / fullSec;
        faultSec += ft * factor;
      } else {
        // open/unfinished or unrecalculated fault-session → use overlap duration
        faultSec += ovSec;
      }
    }

    // Calculate downtime (Paused/Idle status)
    const windowMs = exactEnd - exactStart;
    const runningMs = Math.round(runtimeSec * 1000);
    const faultedMs = Math.round(faultSec * 1000);
    const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));

    // Convert to hours for chart display
    const runningHours = runningMs / 3600000;
    const faultedHours = faultedMs / 3600000;
    const downtimeHours = downtimeMs / 3600000;

    const operatorName = canonicalName(opSessions[0]?.operator?.name, opId);
    opIdToName.set(opId, operatorName);

    statusByOperator.set(opId, {
      "Running": runningHours,
      "Faulted": faultedHours,
      "Paused": downtimeHours
    });
  }
  // compress per operator
  for (const [s, rec] of statusByOperator) {
    statusByOperator.set(s, compressSlicesPerBar(rec));
  }

  // Ensure we have status data for all operators in results
  for (const result of results) {
    const opId = result.operator.id;
    if (!statusByOperator.has(opId)) {
      statusByOperator.set(opId, { "No Data": 0 });
    }
  }

  // ---------- 3) Faults stacked (durations by fault type) ----------
  // Based on faultSessionRoutes.js structure - extract fault info from startState
  
  const faultsAggRaw = await db
    .collection(config.faultSessionCollectionName)
    .aggregate([
      {
        $match: {
          ...(operatorId ? { "operator.id": operatorId } : {}),
          "timestamps.start": { $lte: exactEnd },
          $or: [
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": { $gte: exactStart } },
          ],
        },
      },
      {
        $addFields: {
          ovStart: { $max: ["$timestamps.start", exactStart] },
          ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
        },
      },
      { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
      {
        $project: {
          operator: 1,
          sliceMs: 1,
          label: {
            $ifNull: [
              "$startState.status.name",
              { $ifNull: ["$startState.status.code", "Unknown"] },
            ],
          },
        },
      },
      { $match: { sliceMs: { $gt: 0 } } },
      {
        $group: {
          _id: { operatorId: "$operator.id", label: "$label" },
          name: { $first: "$operator.name" },
          totalMs: { $sum: "$sliceMs" },
        },
      },
    ])
    .toArray();

  const faultsByOperator = new Map();
  for (const row of faultsAggRaw) {
    const opId = row._id.operatorId;
    if (!validId(opId)) continue; // skip invalid operator IDs
    
    const label = String(row._id.label || "Unknown");
    const val = Number(row.totalMs || 0) / 3600000; // Convert ms to hours
    if (!faultsByOperator.has(opId)) faultsByOperator.set(opId, {});
    faultsByOperator.get(opId)[label] = (faultsByOperator.get(opId)[label] || 0) + val;
    if (!opIdToName.has(opId)) opIdToName.set(opId, canonicalName(row.name, opId));
  }
  // Global compression: find top fault types across all operators
  const globalFaultTotals = new Map();
  for (const [, rec] of faultsByOperator) {
    for (const [faultType, hours] of Object.entries(rec)) {
      globalFaultTotals.set(faultType, (globalFaultTotals.get(faultType) || 0) + hours);
    }
  }
  
  // Get top fault types globally
  const sortedGlobalFaults = Array.from(globalFaultTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topNSlicesPerBar - 1)
    .map(([type]) => type);
  
  // Apply global compression to each operator
  for (const [opId, rec] of faultsByOperator) {
    const compressed = {};
    let otherSum = 0;
    
    for (const [faultType, hours] of Object.entries(rec)) {
      if (sortedGlobalFaults.includes(faultType)) {
        compressed[faultType] = hours;
      } else {
        otherSum += hours;
      }
    }
    
    if (otherSum > 0) {
      compressed[OTHER_LABEL] = otherSum;
    }
    
    faultsByOperator.set(opId, compressed);
  }

  for (const result of results) {
    const opId = result.operator.id;
    if (!faultsByOperator.has(opId)) {
      faultsByOperator.set(opId, { "No Faults": 0 });
    }
  }

  // ---------- 4) Efficiency ranking order ----------
  const efficiencyRanked = results
    .map(r => ({
      operatorId: r.operator.id,
      name: r.operator.name,
      efficiency: Number(r.operatorSummary?.efficiency || 0),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);

  // Build comprehensive operator ordering from all data sources
  const unionOperatorIds = new Set(efficiencyRanked.map(r => r.operatorId));
  for (const m of statusByOperator.keys()) unionOperatorIds.add(m);
  for (const m of faultsByOperator.keys()) unionOperatorIds.add(m);
  const finalOrderOperatorIds = [...unionOperatorIds]
    .filter(validId)
    .filter(id => opIdToName.has(id));

  // ---------- 5) Items stacked  ----------
  const itemsByOperator = new Map();
  for (const r of results) {
    const m = {};
    for (const [id, s] of Object.entries(r.operatorSummary.itemSummaries || {})) {
      const label = s.name || String(id);
      const count = Number(s.countTotal || 0);
      m[label] = (m[label] || 0) + count;
    }
    itemsByOperator.set(r.operator.id, compressSlicesPerBar(m));
  }
  const itemsStacked = toStackedSeries(itemsByOperator, opIdToName, finalOrderOperatorIds, "items");
  const statusStacked = toStackedSeries(statusByOperator, opIdToName, finalOrderOperatorIds, "status");
  const faultsStacked = toStackedSeries(faultsByOperator, opIdToName, finalOrderOperatorIds, "faults");

  // ---------- 6) Final payload ----------
  res.json({
    timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
    results,                  // original detailed per-operator results (unchanged shape)
    charts: {
      statusStacked: {
        title: "Operator Status Stacked Bar",
        orientation: "vertical",
        xType: "category",
        xLabel: "Operator",
        yLabel: "Duration (hours)",
        series: statusStacked
      },
      efficiencyRanked: {
        title: "Ranked OEE% by Operator", 
        orientation: "horizontal",
        xType: "category",
        xLabel: "Operator",
        yLabel: "OEE (%)",
        series: [
          {
            id: "OEE",
            title: "OEE",
            type: "bar",
            data: efficiencyRanked.map(r => ({ x: opIdToName.get(r.operatorId), y: r.efficiency })),
          },
        ]
      },
      itemsStacked: {
        title: "Item Stacked Bar by Operator",
        orientation: "vertical", 
        xType: "category",
        xLabel: "Operator",
        yLabel: "Item Count",
        series: itemsStacked
      },
      faultsStacked: {
        title: "Fault Stacked Bar by Operator",
        orientation: "vertical",
        xType: "category", 
        xLabel: "Operator",
        yLabel: "Fault Duration (hours)",
        series: faultsStacked
      },
      order: finalOrderOperatorIds.map(s => opIdToName.get(s) || s), // operator display order (ranked)
    },
  });
} catch (err) {
  console.log(`Error in ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Failed to generate operator item summary report" });
}
});



// API route for item summary (sessions-based)
router.get("/analytics/item-sessions-summary", async (req, res) => {
try {
  const { start, end } = parseAndValidateQueryParams(req);
  const queryStart = new Date(start);
  const queryEnd = new Date(Math.min(new Date(end).getTime(), Date.now()));
  if (!(queryStart < queryEnd)) {
    return res.status(416).json({ error: "start must be before end" });
  }

  const itemSessColl = db.collection(config.itemSessionCollectionName || "item-session");
  const activeSerials = await db
    .collection(config.machineCollectionName || "machine")
    .distinct("serial", { active: true });

  const resultsMap = new Map();
  const normalizePPH = (std) => {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
  };

  for (const serial of activeSerials) {
    // Clamp to actual running window per machine
    const bookended = await getBookendedStatesAndTimeRange(db, serial, queryStart, queryEnd);
    if (!bookended) continue;
    const { sessionStart, sessionEnd } = bookended;

    // Pull overlapping item-sessions
    const sessions = await itemSessColl
      .find({
        "machine.serial": Number(serial),
        "timestamps.start": { $lt: sessionEnd },
        $or: [
          { "timestamps.end": { $gt: sessionStart } },
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": null },
        ],
      })
      .project({
        _id: 0,
        item: 1,          // { id, name, standard }
        items: 1,         // legacy single-item fallback
        counts: 1,        // optional
        totalCount: 1,    // optional rollup
        workTime: 1,      // seconds
        runtime: 1,       // seconds
        activeStations: 1,
        operators: 1,
        timestamps: 1,
      })
      .toArray();

    if (!sessions.length) continue;

    for (const s of sessions) {
      const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
      if (!itm || itm.id == null) continue;

      const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
      const sessEnd = new Date(s.timestamps?.end || sessionEnd);
      if (!sessStart || Number.isNaN(sessStart)) continue;

      // Overlap with bookended window
      const ovStart = sessStart > sessionStart ? sessStart : sessionStart;
      const ovEnd = sessEnd < sessionEnd ? sessEnd : sessionEnd;
      if (!(ovEnd > ovStart)) continue;

      const sessSec = Math.max(0, (sessEnd - sessStart) / 1000);
      const ovSec = Math.max(0, (ovEnd - ovStart) / 1000);
      if (sessSec === 0 || ovSec === 0) continue;

      // Worked time: prefer workTime, else runtime * stations; prorate by overlap
      const stations = typeof s.activeStations === "number"
        ? s.activeStations
        : (Array.isArray(s.operators) ? s.operators.filter(o => o && o.id !== -1).length : 0);

      const baseWorkSec = typeof s.workTime === "number"
        ? s.workTime
        : typeof s.runtime === "number"
          ? s.runtime * Math.max(1, stations || 0)
          : 0;

      const workedSec = baseWorkSec > 0 ? baseWorkSec * (ovSec / sessSec) : 0;

      // Counts in overlap: use explicit counts if present; else prorate totalCount
      let countInWin = 0;
      if (Array.isArray(s.counts) && s.counts.length) {
        if (s.counts.length > 50000) {
          countInWin = typeof s.totalCount === "number" ? Math.round(s.totalCount * (ovSec / sessSec)) : 0;
        } else {
          countInWin = s.counts.reduce((acc, c) => {
            const t = new Date(c.timestamp);
            const sameItem = !c.item?.id || c.item.id === itm.id;
            return acc + (sameItem && t >= ovStart && t <= ovEnd ? 1 : 0);
          }, 0);
        }
      } else if (typeof s.totalCount === "number") {
        countInWin = Math.round(s.totalCount * (ovSec / sessSec));
      }

      const key = String(itm.id);
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          itemId: itm.id,
          name: itm.name || "Unknown",
          standard: itm.standard ?? 0,
          count: 0,
          workedSec: 0,
        });
      }
      const acc = resultsMap.get(key);
      acc.count += countInWin;
      acc.workedSec += workedSec;
      // keep first non-empty metadata
      if (!acc.name && itm.name) acc.name = itm.name;
      if (!acc.standard && itm.standard != null) acc.standard = itm.standard;
    }
  }

  // Finalize same shape as your previous /item-summary
  const results = Array.from(resultsMap.values()).map((entry) => {
    const workedMs = Math.round(entry.workedSec * 1000);
    const hours = workedMs / 3_600_000;
    const pph = hours > 0 ? entry.count / hours : 0;
    const stdPPH = normalizePPH(entry.standard);
    const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

    return {
      itemName: entry.name,
      workedTimeFormatted: formatDuration(workedMs),
      count: entry.count,
      pph: Math.round(pph * 100) / 100,
      standard: entry.standard,
      efficiency: Math.round(efficiencyPct * 100) / 100, // percent
    };
  });

  res.json(results);
} catch (err) {
  console.log(`Error in ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Failed to generate item summary report" });
}
});

// New route that uses daily totals for optimized performance on timeframes
router.get("/analytics/machine-item-sessions-summary-optimized", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    const activeShifts = await loadActiveShifts(db).catch(() => []);
    const shiftElapsedMs = computeShiftElapsedMs(activeShifts, exactStart, exactEnd);

    // Check if this is a timeframe that can use daily totals optimization
    const isOptimizedTimeframe = req.query.timeframe && 
      ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

    if (!isOptimizedTimeframe) {
      // Fallback to original route for non-optimized timeframes
      return res.status(400).json({
        error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
      });
    }

    console.log(`Using daily totals optimization for timeframe: ${req.query.timeframe}`);

    // Validate dates before processing
    if (!exactStart || !exactEnd) {
      console.log('Invalid date range:', { exactStart, exactEnd });
      return res.status(400).json({ error: 'Invalid date range' });
    }

    // Calculate date range for daily totals query
    const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
    const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
    

    // Query the totals-daily collection for machine records
    const dailyTotalsCollection = db.collection("totals-daily");
    
    // Build query for machine records in date range
    const query = {
      entityType: 'machine',
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // Filter by machine serial if specified
    if (serial) {
      query.machineSerial = parseInt(serial);
    }
    
    // Get daily totals data
    let dailyTotals;
    try {
      dailyTotals = await dailyTotalsCollection.find(query).toArray();
    } catch (dbError) {
      console.log('Database query error:', dbError);
      return res.status(500).json({ 
        error: 'Database query failed',
        message: dbError.message 
      });
    }
    
    if (!dailyTotals || dailyTotals.length === 0) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Machine Status Stacked Bar", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked Efficiency% by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Efficiency (%)", series:[{ id:"Efficiency", title:"Efficiency", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        },
        optimization: {
          used: true,
          timeframe: req.query.timeframe,
          dataSource: 'daily-totals-cache'
        }
      });
    }

    console.log(`Processing ${dailyTotals.length} machine daily total records`);

    try {
      // Aggregate daily totals by machine
      const aggregated = new Map();
    
    dailyTotals.forEach((total, index) => {
      try {
        logger.debug(`Processing record ${index + 1}/${dailyTotals.length}:`, {
          machineSerial: total.machineSerial,
          machineName: total.machineName,
          date: total.date,
          _id: total._id
        });

        // Validate that we have required fields
        if (!total.machineSerial) {
          console.log(`Record ${index + 1} missing machineSerial:`, {
            _id: total._id,
            date: total.date,
            machineName: total.machineName,
            availableFields: Object.keys(total)
          });
          return; // Skip this record
        }

        const key = total.machineSerial;
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            machineSerial: total.machineSerial,
            machineName: total.machineName,
            runtimeMs: 0,
            faultTimeMs: 0,
            workedTimeMs: 0,
            pausedTimeMs: 0,
            totalFaults: 0,
            totalCounts: 0,
            totalMisfeeds: 0,
            totalTimeCreditMs: 0,
            days: [],
            dateRange: { start: total.date, end: total.date }
          });
        }
        
        const machine = aggregated.get(key);
        
        // Sum all metrics with safe defaults
        machine.runtimeMs += (total.runtimeMs || 0);
        machine.faultTimeMs += (total.faultTimeMs || 0);
        machine.workedTimeMs += (total.workedTimeMs || 0);
        machine.pausedTimeMs += (total.pausedTimeMs || 0);
        machine.totalFaults += (total.totalFaults || 0);
        machine.totalCounts += (total.totalCounts || 0);
        machine.totalMisfeeds += (total.totalMisfeeds || 0);
        machine.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
        machine.days.push(total);
        
        // Update date range with safe comparison
        if (total.date && machine.dateRange.start && total.date < machine.dateRange.start) {
          machine.dateRange.start = total.date;
        }
        if (total.date && machine.dateRange.end && total.date > machine.dateRange.end) {
          machine.dateRange.end = total.date;
        }
      } catch (itemError) {
        console.log(`Error processing record ${index + 1}:`, {
          error: itemError.message,
          record: total
        });
        throw itemError;
      }
    });

    // Helper function to format duration (ensure it's available)
    const formatDuration = (ms) => {
      if (!ms || typeof ms !== 'number') return { hours: 0, minutes: 0 };
      const totalMinutes = Math.floor(ms / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return { hours, minutes };
    };

    // Convert to results format and calculate performance metrics
    const results = [];
    const serialToName = new Map();
    const statusByMachine = new Map();
    const faultsByMachine = new Map();

    console.log(`Aggregated ${aggregated.size} machines, processing results...`);

    for (const [key, machine] of aggregated) {
      try {
        logger.debug(`Processing machine ${key}:`, {
          machineSerial: machine.machineSerial,
          machineName: machine.machineName,
          runtimeMs: machine.runtimeMs,
          workedTimeMs: machine.workedTimeMs
        });
      serialToName.set(machine.machineSerial, machine.machineName);

      // Calculate performance metrics
      const totalHours = machine.workedTimeMs / 3600000;
      const windowMs = shiftElapsedMs;
      
      // Basic KPIs
      const pph = totalHours > 0 ? machine.totalCounts / totalHours : 0;
      const availability = windowMs > 0 ? machine.runtimeMs / windowMs : 0;
      const throughput = (machine.totalCounts + machine.totalMisfeeds) > 0 ? 
        machine.totalCounts / (machine.totalCounts + machine.totalMisfeeds) : 0;
      
      // For efficiency, we need item standards - using a simplified approach
      // In a full implementation, you'd need to aggregate item standards from daily totals
      const efficiency = 0; // Placeholder - requires item-level data

      // Validate machine data before adding to results
      if (!machine.machineSerial) {
        console.log(`Skipping machine with undefined serial:`, {
          machineName: machine.machineName,
          machineSerial: machine.machineSerial,
          runtimeMs: machine.runtimeMs
        });
        return; // Skip this machine
      }

      results.push({
        machine: {
          name: machine.machineName,
          serial: machine.machineSerial
        },
        sessions: [], // Empty for optimized version - could be populated with daily summaries
        machineSummary: {
          totalCount: machine.totalCounts,
          workedTimeMs: machine.workedTimeMs,
          workedTimeFormatted: formatDuration(machine.workedTimeMs),
          runtimeMs: machine.runtimeMs,
          runtimeFormatted: formatDuration(machine.runtimeMs),
          pph: Math.round(pph * 100) / 100,
          proratedStandard: 0, // Would need item data
          efficiency: Math.round(efficiency * 10000) / 100,
          itemSummaries: {} // Empty for optimized version
        }
      });

      // Prepare data for charts
      const runningHours = machine.runtimeMs / 3600000;
      const faultedHours = machine.faultTimeMs / 3600000;
      const downtimeHours = machine.pausedTimeMs / 3600000;

      statusByMachine.set(machine.machineSerial, {
        "Running": runningHours,
        "Faulted": faultedHours,
        "Paused": downtimeHours
      });

      // Simplified fault data (grouping all faults together)
      if (machine.totalFaults > 0) {
        faultsByMachine.set(machine.machineSerial, {
          "Faults": faultedHours
        });
      } else {
        faultsByMachine.set(machine.machineSerial, {
          "No Faults": 0
        });
      }
      } catch (machineError) {
        console.log(`Error processing machine ${key}:`, machineError);
        throw machineError;
      }
    }

    // Build efficiency ranking
    const efficiencyRanked = results
      .map(r => ({
        serial: r.machine.serial,
        name: r.machine.name,
        efficiency: Number(r.machineSummary?.efficiency || 0),
      }))
      .sort((a, b) => b.efficiency - a.efficiency);

    // Build chart series - filter out any undefined serials
    const finalOrderSerials = results
      .map(r => r.machine.serial)
      .filter(serial => serial !== undefined && serial !== null);
    
    console.log(`Building charts for ${finalOrderSerials.length} machines (filtered from ${results.length} results)`);
    
    // Status stacked chart
    const statusStacked = finalOrderSerials.map(serial => {
      try {
        const statusData = statusByMachine.get(serial) || {};
        logger.debug(`Building status chart for machine ${serial}:`, statusData);
        
        return {
          id: String(serial), // Safe string conversion
          title: serialToName.get(serial) || String(serial),
          type: "bar",
          stack: "status",
          data: Object.entries(statusData).map(([status, hours]) => ({
            x: status,
            y: Math.round((hours || 0) * 100) / 100
          }))
        };
      } catch (chartError) {
        console.log(`Error building status chart for machine ${serial}:`, chartError);
        throw chartError;
      }
    });

    // Faults stacked chart
    const faultsStacked = finalOrderSerials.map(serial => {
      try {
        const faultData = faultsByMachine.get(serial) || {};
        logger.debug(`Building faults chart for machine ${serial}:`, faultData);
        
        return {
          id: String(serial), // Safe string conversion
          title: serialToName.get(serial) || String(serial),
          type: "bar",
          stack: "faults",
          data: Object.entries(faultData).map(([faultType, hours]) => ({
            x: faultType,
            y: Math.round((hours || 0) * 100) / 100
          }))
        };
      } catch (chartError) {
        console.log(`Error building faults chart for machine ${serial}:`, chartError);
        throw chartError;
      }
    });

    // Efficiency ranked chart
    const efficiencyRankedSeries = [{
      id: "Efficiency",
      title: "Efficiency",
      type: "bar",
      data: efficiencyRanked.map(r => ({
        x: r.name,
        y: r.efficiency
      }))
    }];

    // Final response
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,
      charts: {
        statusStacked: {
          title: "Machine Status Stacked Bar",
          orientation: "vertical",
          xType: "category",
          xLabel: "Machine",
          yLabel: "Duration (hours)",
          series: statusStacked
        },
        efficiencyRanked: {
          title: "Ranked OEE% by Machine",
          orientation: "horizontal",
          xType: "category",
          xLabel: "Machine",
          yLabel: "OEE (%)",
          series: efficiencyRankedSeries
        },
        itemsStacked: {
          title: "Item Stacked Bar by Machine",
          orientation: "vertical",
          xType: "category",
          xLabel: "Machine",
          yLabel: "Item Count",
          series: [] // Empty for optimized version
        },
        faultsStacked: {
          title: "Fault Stacked Bar by Machine",
          orientation: "vertical",
          xType: "category",
          xLabel: "Machine",
          yLabel: "Fault Duration (hours)",
          series: faultsStacked
        },
        order: finalOrderSerials.map(s => serialToName.get(s) || s.toString())
      },
      optimization: {
        used: true,
        timeframe: req.query.timeframe,
        dataSource: 'machine-daily-totals-cache',
        performance: {
          dailyTotalsCount: dailyTotals.length,
          aggregatedMachines: results.length,
          processingTime: '< 100ms estimated'
        },
        limitations: {
          itemSummaries: 'Not available in machine daily totals - would need item-level processing',
          efficiency: 'Requires item standards data not available in daily totals'
        }
      }
    });

    } catch (processingError) {
      console.log(`Error in data processing:`, processingError);
      return res.status(500).json({ 
        error: "Failed to process daily totals data",
        message: processingError.message,
        stack: processingError.stack
      });
    }

  } catch (error) {
    console.log(`Error in optimized machine item summary:`, error);
    
    // Log the error and return a proper error response
    console.log('Error accessing totals-daily collection:', error.message);
    
    res.status(500).json({ 
      error: "Failed to generate optimized machine item summary",
      message: error.message 
    });
  }
});

// New experimental route that uses daily totals for operator reports
router.get("/analytics/operator-item-sessions-summary-optimized", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
    const activeShifts = await loadActiveShifts(db).catch(() => []);
    const shiftElapsedMs = computeShiftElapsedMs(activeShifts, exactStart, exactEnd);

    // Check if this is a timeframe that can use daily totals optimization
    const isOptimizedTimeframe = req.query.timeframe && 
      ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

    if (!isOptimizedTimeframe) {
      // Fallback to original route for non-optimized timeframes
      return res.status(400).json({
        error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
      });
    }

    console.log(`Using daily totals optimization for operator route, timeframe: ${req.query.timeframe}`);

    // Validate dates before processing
    if (!exactStart || !exactEnd) {
      console.log('Invalid date range:', { exactStart, exactEnd });
      return res.status(400).json({ error: 'Invalid date range' });
    }

    // Calculate date range for daily totals query
    const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
    const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
    

    // Query the totals-daily collection for operator-machine records
    const dailyTotalsCollection = db.collection("totals-daily");
    
    // Build query for operator-machine records in date range
    const query = {
      entityType: 'operator-machine',
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // Filter by operatorId if specified
    if (operatorId) {
      query.operatorId = operatorId;
    }
    
    // Get operator totals data
    let operatorTotals;
    try {
      operatorTotals = await dailyTotalsCollection.find(query).toArray();
    } catch (dbError) {
      console.log('Database query error:', dbError);
      return res.status(500).json({ 
        error: 'Database query failed',
        message: dbError.message 
      });
    }
    
    if (!operatorTotals || operatorTotals.length === 0) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Operator Status Stacked Bar", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked OEE% by Operator", orientation:"horizontal", xType:"category", xLabel:"Operator", yLabel:"OEE (%)", series:[{ id:"OEE", title:"OEE", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        },
        optimization: {
          used: true,
          timeframe: req.query.timeframe,
          dataSource: 'operator-daily-totals-cache'
        }
      });
    }

    // Helper functions (reused from original route)
    const topNSlicesPerBar = 10;
    const OTHER_LABEL = "Other";

    function compressSlicesPerBar(perLabelTotals, N = topNSlicesPerBar, otherLabel = OTHER_LABEL) {
      const entries = Object.entries(perLabelTotals);
      if (entries.length <= N) return perLabelTotals;
      entries.sort((a, b) => b[1] - a[1]);
      const keep = entries.slice(0, N - 1);
      const rest = entries.slice(N - 1);
      const otherSum = rest.reduce((s, [, v]) => s + v, 0);
      const out = {};
      for (const [k, v] of keep) out[k] = v;
      out[otherLabel] = otherSum;
      return out;
    }

    function toStackedSeries(byKey, keyToName, orderKeys, stackId) {
      const labels = new Set();
      for (const k of orderKeys) {
        const m = byKey.get(k);
        if (!m) continue;
        Object.keys(m).forEach((lab) => labels.add(lab));
      }
      const sortedLabels = [...labels].sort((a, b) => {
        const totalA = orderKeys.reduce((sum, k) => sum + (byKey.get(k)?.[a] || 0), 0);
        const totalB = orderKeys.reduce((sum, k) => sum + (byKey.get(k)?.[b] || 0), 0);
        return totalB - totalA;
      });
      return sortedLabels.map((label) => ({
        id: String(label), // Safe string conversion
        title: String(label), // Safe string conversion
        type: "bar",
        stack: stackId,
        data: orderKeys.map((k) => ({
          x: keyToName.get(k) || String(k), // Safe string conversion
          y: (byKey.get(k) && byKey.get(k)[label]) || 0,
        })),
      }));
    }

    function formatMs(ms) {
      const m = Math.max(0, Math.floor(ms / 60000));
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return { hours: h, minutes: mm };
    }

    // Helper functions for validation
    const validId = id => Number.isInteger(id) && id >= 0;
    const canonicalName = (name, id) => {
      if (!name) return `Operator ${id}`;
      // Handle object format { first, surname }
      if (typeof name === 'object' && name !== null) {
        const fullName = `${name.first || ''} ${name.surname || ''}`.trim();
        return fullName || `Operator ${id}`;
      }
      // Handle string format
      if (typeof name === 'string') {
        return name.trim() || `Operator ${id}`;
      }
      return `Operator ${id}`;
    };

    try {
      // Aggregate operator totals by operator ID
      const aggregated = new Map();
    
      console.log(`Processing ${operatorTotals.length} operator daily total records`);
      
      operatorTotals.forEach((total, index) => {
        try {
          logger.debug(`Processing operator record ${index + 1}/${operatorTotals.length}:`, {
            operatorId: total.operatorId,
            operatorName: total.operatorName,
            machineSerial: total.machineSerial,
            date: total.date,
            totalCounts: total.totalCounts,
            workedTimeMs: total.workedTimeMs
          });

          // Validate that we have required fields
          if (!total.operatorId || !validId(total.operatorId)) {
            console.log(`Record ${index + 1} missing or invalid operatorId:`, {
              _id: total._id,
              date: total.date,
              operatorId: total.operatorId,
              availableFields: Object.keys(total)
            });
            return; // Skip this record
          }

          const key = total.operatorId;
          const opName = canonicalName(total.operatorName, total.operatorId);
          
          if (!aggregated.has(key)) {
            aggregated.set(key, {
              operatorId: total.operatorId,
              operatorName: opName,
              runtimeMs: 0,
              workedTimeMs: 0,
              totalCounts: 0,
              totalMisfeeds: 0,
              totalTimeCreditMs: 0,
              machines: new Set(), // Track which machines this operator worked on
              days: [],
              dateRange: { start: total.date, end: total.date }
            });
          }
          
          const operator = aggregated.get(key);
          
          // Sum all metrics with safe defaults
          operator.runtimeMs += (total.runtimeMs || 0);
          operator.workedTimeMs += (total.workedTimeMs || 0);
          operator.totalCounts += (total.totalCounts || 0);
          operator.totalMisfeeds += (total.totalMisfeeds || 0);
          operator.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
          if (total.machineSerial) {
            operator.machines.add(total.machineSerial);
          }
          operator.days.push(total);
          
          // Update date range with safe comparison
          if (total.date && operator.dateRange.start && total.date < operator.dateRange.start) {
            operator.dateRange.start = total.date;
          }
          if (total.date && operator.dateRange.end && total.date > operator.dateRange.end) {
            operator.dateRange.end = total.date;
          }

          // Keep the most recent operator name if available
          if (total.operatorName && total.operatorName !== `Operator ${total.operatorId}`) {
            operator.operatorName = total.operatorName;
          }
        } catch (itemError) {
          console.log(`Error processing operator record ${index + 1}:`, {
            error: itemError.message,
            record: total
          });
          throw itemError;
        }
      });

      // Convert to results format matching the original route
      const results = [];
      const operatorIdToName = new Map();
      const statusByOperator = new Map();
      const faultsByOperator = new Map();

      console.log(`Aggregated ${aggregated.size} operators, processing results...`);

      for (const [key, operator] of aggregated) {
        try {
          logger.debug(`Processing operator ${key}:`, {
            operatorId: operator.operatorId,
            operatorName: operator.operatorName,
            runtimeMs: operator.runtimeMs,
            workedTimeMs: operator.workedTimeMs
          });

          // Validate operator data before adding to results
          if (!operator.operatorId) {
            console.log(`Skipping operator with undefined ID:`, {
              operatorName: operator.operatorName,
              operatorId: operator.operatorId,
              runtimeMs: operator.runtimeMs
            });
            return; // Skip this operator
          }

          operatorIdToName.set(operator.operatorId, operator.operatorName);

          // Calculate performance metrics (same logic as original route)
          const totalHours = operator.workedTimeMs / 3600000;
          const windowMs = shiftElapsedMs;
          
          // Basic KPIs
          const pph = totalHours > 0 ? operator.totalCounts / totalHours : 0;
          const availability = windowMs > 0 ? operator.runtimeMs / windowMs : 0;
          const throughput = (operator.totalCounts + operator.totalMisfeeds) > 0 ? 
            operator.totalCounts / (operator.totalCounts + operator.totalMisfeeds) : 0;
          
          // For efficiency calculation, we need item standards - using a simplified approach
          // Since daily totals don't store item-level data, we'll use a placeholder
          // In a full implementation, you'd need to join with item master data or process item totals
          const proratedStandard = 0; // Placeholder - would need item data
          const efficiency = 0; // Placeholder - requires item-level data

          results.push({
            operator: {
              id: operator.operatorId,
              name: operator.operatorName
            },
            sessions: [], // Empty for optimized version - could be populated with daily summaries
            operatorSummary: {
              totalCount: operator.totalCounts,
              workedTimeMs: operator.workedTimeMs,
              workedTimeFormatted: formatMs(operator.workedTimeMs),
              runtimeMs: operator.runtimeMs,
              runtimeFormatted: formatMs(operator.runtimeMs),
              pph: Math.round(pph * 100) / 100,
              proratedStandard: Math.round(proratedStandard * 100) / 100,
              efficiency: Math.round(efficiency * 10000) / 100,
              itemSummaries: {}, // Empty for optimized version - would need item-level data
              machinesWorked: Array.from(operator.machines).length // Additional metric
            }
          });

          // Prepare data for charts
          const runningHours = operator.runtimeMs / 3600000;
          const pausedHours = Math.max(0, (windowMs - operator.runtimeMs) / 3600000);

          statusByOperator.set(operator.operatorId, {
            "Working": runningHours,
            "Idle": pausedHours
          });

          // Simplified fault data (operators don't have separate fault tracking in daily totals)
          faultsByOperator.set(operator.operatorId, {
            "No Faults": 0 // Operators don't track separate faults in daily totals
          });
        } catch (operatorError) {
          console.log(`Error processing operator ${key}:`, operatorError);
          throw operatorError;
        }
      }

      // Build efficiency ranking
      const efficiencyRanked = results
        .map(r => ({
          operatorId: r.operator.id,
          name: r.operator.name,
          efficiency: Number(r.operatorSummary?.efficiency || 0),
        }))
        .sort((a, b) => b.efficiency - a.efficiency);

      // Build chart series - filter out any undefined operator IDs
      const finalOrderOperators = results
        .map(r => r.operator.id)
        .filter(id => id !== undefined && id !== null);
      
      console.log(`Building charts for ${finalOrderOperators.length} operators (filtered from ${results.length} results)`);
      
      // Status stacked chart
      const statusStacked = toStackedSeries(statusByOperator, operatorIdToName, finalOrderOperators, "status");
      
      // Faults stacked chart
      const faultsStacked = toStackedSeries(faultsByOperator, operatorIdToName, finalOrderOperators, "faults");

      // Efficiency ranked chart
      const efficiencyRankedSeries = [{
        id: "OEE",
        title: "OEE",
        type: "bar",
        data: efficiencyRanked.map(r => ({
          x: operatorIdToName.get(r.operatorId) || r.name,
          y: r.efficiency
        }))
      }];

      // Final response (same format as original route)
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,
        charts: {
          statusStacked: {
            title: "Operator Status Stacked Bar",
            orientation: "vertical",
            xType: "category",
            xLabel: "Operator",
            yLabel: "Duration (hours)",
            series: statusStacked
          },
          efficiencyRanked: {
            title: "Ranked OEE% by Operator",
            orientation: "horizontal",
            xType: "category",
            xLabel: "Operator",
            yLabel: "OEE (%)",
            series: efficiencyRankedSeries
          },
          itemsStacked: {
            title: "Item Stacked Bar by Operator",
            orientation: "vertical",
            xType: "category",
            xLabel: "Operator",
            yLabel: "Item Count",
            series: [] // Empty for optimized version - would need item-level data
          },
          faultsStacked: {
            title: "Fault Stacked Bar by Operator",
            orientation: "vertical",
            xType: "category",
            xLabel: "Operator",
            yLabel: "Fault Duration (hours)",
            series: faultsStacked
          },
          order: finalOrderOperators.map(id => operatorIdToName.get(id) || id.toString())
        },
        optimization: {
          used: true,
          timeframe: req.query.timeframe,
          dataSource: 'operator-daily-totals-cache',
          performance: {
            operatorTotalsCount: operatorTotals.length,
            aggregatedOperators: results.length,
            processingTime: '< 100ms estimated'
          },
          limitations: {
            itemSummaries: 'Not available in operator daily totals - would need item-level processing',
            efficiency: 'Requires item standards data not available in daily totals'
          }
        }
      });

    } catch (processingError) {
      console.log(`Error in operator data processing:`, processingError);
      return res.status(500).json({ 
        error: "Failed to process operator daily totals data",
        message: processingError.message,
        stack: processingError.stack
      });
    }

  } catch (error) {
    console.log(`Error in optimized operator item summary:`, error);
    
    // Log the error and return a proper error response
    console.log('Error accessing totals-daily collection:', error.message);
    
    res.status(500).json({ 
      error: "Failed to generate optimized operator item summary",
      message: error.message 
    });
  }
});

// New experimental route that uses daily totals for item reports
router.get("/analytics/item-sessions-summary-optimized", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);

    // Check if this is a timeframe that can use daily totals optimization
    const isOptimizedTimeframe = req.query.timeframe && 
      ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

    if (!isOptimizedTimeframe) {
      // Fallback to original route for non-optimized timeframes
      return res.status(400).json({
        error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
      });
    }

    console.log(`Using daily totals optimization for item route, timeframe: ${req.query.timeframe}`);

    // Validate dates before processing
    if (!exactStart || !exactEnd) {
      console.log('Invalid date range:', { exactStart, exactEnd });
      return res.status(400).json({ error: 'Invalid date range' });
    }

    // Calculate date range for daily totals query
    const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
    const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
    

    // Query the totals-daily collection for item records
    const dailyTotalsCollection = db.collection("totals-daily");
    
    // Build query for item records in date range
    const query = {
      entityType: 'item',
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };
    
    // Get item daily totals data
    let itemTotals;
    try {
      itemTotals = await dailyTotalsCollection.find(query).toArray();
    } catch (dbError) {
      console.log('Database query error:', dbError);
      return res.status(500).json({ 
        error: 'Database query failed',
        message: dbError.message 
      });
    }
    
    if (!itemTotals || itemTotals.length === 0) {
      return res.json([]);
    }

    // Helper function to normalize PPH standards (same as original route)
    const normalizePPH = (std) => {
      const n = Number(std) || 0;
      return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
    };

    // Helper function to format duration (same as original route)
    const formatDuration = (ms) => {
      if (!ms || typeof ms !== 'number') return { hours: 0, minutes: 0 };
      const totalMinutes = Math.floor(ms / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return { hours, minutes };
    };

    try {
      // Aggregate item totals by item ID
      const aggregated = new Map();
    
      console.log(`Processing ${itemTotals.length} item daily total records`);
      
      itemTotals.forEach((total, index) => {
        try {
          logger.debug(`Processing item record ${index + 1}/${itemTotals.length}:`, {
            itemId: total.itemId,
            itemName: total.itemName,
            date: total.date,
            totalCounts: total.totalCounts,
            workedTimeMs: total.workedTimeMs
          });

          // Validate that we have required fields
          if (!total.itemId) {
            console.log(`Record ${index + 1} missing itemId:`, {
              _id: total._id,
              date: total.date,
              itemName: total.itemName,
              availableFields: Object.keys(total)
            });
            return; // Skip this record
          }

          const key = total.itemId;
          if (!aggregated.has(key)) {
            aggregated.set(key, {
              itemId: total.itemId,
              itemName: total.itemName || `Item ${total.itemId}`,
              totalCounts: 0,
              totalMisfeeds: 0,
              workedTimeMs: 0,
              runtimeMs: 0,
              pausedTimeMs: 0,
              totalTimeCreditMs: 0,
              operatorMachineCombinations: 0,
              days: [],
              dateRange: { start: total.date, end: total.date }
            });
          }
          
          const item = aggregated.get(key);
          
          // Sum all metrics with safe defaults
          item.totalCounts += (total.totalCounts || 0);
          item.totalMisfeeds += (total.totalMisfeeds || 0);
          item.workedTimeMs += (total.workedTimeMs || 0);
          item.runtimeMs += (total.runtimeMs || 0);
          item.pausedTimeMs += (total.pausedTimeMs || 0);
          item.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
          item.operatorMachineCombinations = Math.max(item.operatorMachineCombinations, total.operatorMachineCombinations || 0);
          item.days.push(total);
          
          // Update date range with safe comparison
          if (total.date && item.dateRange.start && total.date < item.dateRange.start) {
            item.dateRange.start = total.date;
          }
          if (total.date && item.dateRange.end && total.date > item.dateRange.end) {
            item.dateRange.end = total.date;
          }

          // Keep the most recent item name if available
          if (total.itemName && total.itemName !== `Item ${total.itemId}`) {
            item.itemName = total.itemName;
          }
        } catch (itemError) {
          console.log(`Error processing item record ${index + 1}:`, {
            error: itemError.message,
            record: total
          });
          throw itemError;
        }
      });

      // Convert to results format matching the original route
      const results = [];

      console.log(`Aggregated ${aggregated.size} items, processing results...`);

      for (const [key, item] of aggregated) {
        try {
          logger.debug(`Processing item ${key}:`, {
            itemId: item.itemId,
            itemName: item.itemName,
            totalCounts: item.totalCounts,
            workedTimeMs: item.workedTimeMs
          });

          // Calculate performance metrics (same logic as original route)
          const workedMs = Math.round(item.workedTimeMs);
          const hours = workedMs / 3_600_000;
          const pph = hours > 0 ? item.totalCounts / hours : 0;
          
          // For efficiency calculation, we need the item standard
          // Since daily totals don't store standards, we'll use a placeholder
          // In a full implementation, you'd need to join with item master data
          const standard = 0; // Placeholder - would need item master data
          const stdPPH = normalizePPH(standard);
          const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

          // Validate item data before adding to results
          if (!item.itemId) {
            console.log(`Skipping item with undefined ID:`, {
              itemName: item.itemName,
              itemId: item.itemId,
              totalCounts: item.totalCounts
            });
            return; // Skip this item
          }

          results.push({
            itemName: item.itemName,
            workedTimeFormatted: formatDuration(workedMs),
            count: item.totalCounts,
            pph: Math.round(pph * 100) / 100,
            standard: standard,
            efficiency: Math.round(efficiencyPct * 100) / 100, // percent
            // Additional metrics available from daily totals
            runtimeMs: item.runtimeMs,
            pausedTimeMs: item.pausedTimeMs,
            totalMisfeeds: item.totalMisfeeds,
            operatorMachineCombinations: item.operatorMachineCombinations,
            daysProcessed: item.days.length
          });
        } catch (itemError) {
          console.log(`Error processing item ${key}:`, itemError);
          throw itemError;
        }
      }

      // Sort results by count descending (most productive items first)
      results.sort((a, b) => b.count - a.count);

      // Final response (same format as original route)
      res.json(results);

    } catch (processingError) {
      console.log(`Error in item data processing:`, processingError);
      return res.status(500).json({ 
        error: "Failed to process item daily totals data",
        message: processingError.message,
        stack: processingError.stack
      });
    }

  } catch (error) {
    console.log(`Error in optimized item summary:`, error);
    
    // Log the error and return a proper error response
    console.log('Error accessing totals-daily collection:', error.message);
    
    res.status(500).json({ 
      error: "Failed to generate optimized item summary",
      message: error.message 
    });
  }
});

// Hybrid machine report route - combines daily cache for complete days + sessions for partial days
router.get("/analytics/machine-item-sessions-summary-hybrid", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    
    // Configurable threshold for hybrid approach (36 hours)
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    
    // If time range is less than threshold, use original route
    if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
      // Redirect to original route for shorter time ranges
      return res.status(400).json({
        error: `Time range must be greater than ${HYBRID_THRESHOLD_HOURS} hours for hybrid approach`,
        suggestion: 'Use /analytics/machine-item-sessions-summary for shorter time ranges'
      });
    }

    console.log(`Using hybrid approach for time range: ${timeRangeHours.toFixed(1)} hours`);

    // Helper function to split time range into complete days and partial days
    function splitTimeRange(start, end) {
      const completeDays = [];
      const partialDays = [];
      
      // Get timezone-aware start and end of days
      const startOfFirstDay = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf('day');
      const endOfLastDay = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf('day');
      
      // Check if first day is complete
      const firstDayStart = startOfFirstDay.toJSDate();
      const firstDayEnd = startOfFirstDay.endOf('day').toJSDate();
      
      if (start.getTime() <= firstDayStart.getTime() + 1000) { // Within 1 second of day start
        completeDays.push({
          date: startOfFirstDay.toISODate(),
          start: firstDayStart,
          end: firstDayEnd
        });
      } else {
        partialDays.push({
          start: start,
          end: firstDayEnd
        });
      }
      
      // Add all complete days in between
      let currentDay = startOfFirstDay.plus({ days: 1 });
      while (currentDay < endOfLastDay.startOf('day')) {
        completeDays.push({
          date: currentDay.toISODate(),
          start: currentDay.startOf('day').toJSDate(),
          end: currentDay.endOf('day').toJSDate()
        });
        currentDay = currentDay.plus({ days: 1 });
      }
      
      // Check if last day is complete
      const lastDayStart = endOfLastDay.startOf('day').toJSDate();
      const lastDayEnd = endOfLastDay.toJSDate();
      
      if (end.getTime() >= lastDayEnd.getTime() - 1000) { // Within 1 second of day end
        completeDays.push({
          date: endOfLastDay.toISODate(),
          start: lastDayStart,
          end: lastDayEnd
        });
      } else {
        partialDays.push({
          start: lastDayStart,
          end: end
        });
      }
      
      return { completeDays, partialDays };
    }

    // Helper function to query daily cache for complete days
    async function queryDailyCache(completeDays, machineSerial) {
      if (completeDays.length === 0) return [];
      
      const dates = completeDays.map(day => day.date);
      const query = {
        entityType: 'machine',
        date: { $in: dates }
      };
      
      if (machineSerial) {
        query.machineSerial = parseInt(machineSerial);
      }
      
      
      const dailyRecords = await db.collection('totals-daily').find(query).toArray();
      
      return dailyRecords;
    }

    // Helper function to query sessions for partial days
    async function querySessions(partialDays, machineSerial) {
      if (partialDays.length === 0) return [];
      
      
      const allSessions = [];
      
      for (const partialDay of partialDays) {
        const match = {
          ...(machineSerial ? { "machine.serial": parseInt(machineSerial) } : {}),
          "timestamps.start": { $lte: partialDay.end },
          $or: [
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": { $gte: partialDay.start } },
          ],
        };
        
        const sessions = await db
          .collection(config.machineSessionCollectionName)
          .aggregate([
            { $match: match },
            {
              $addFields: {
                ovStart: { $max: ["$timestamps.start", partialDay.start] },
                ovEnd: { $min: [{ $ifNull: ["$timestamps.end", partialDay.end] }, partialDay.end] },
              },
            },
            {
              $addFields: {
                sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] },
              },
            },
            {
              $project: {
                _id: 0,
                timestamps: 1,
                machine: 1,
                operators: 1,
                countsFiltered: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$counts",
                        as: "c",
                        cond: {
                          $and: [
                            { $gte: ["$$c.timestamp", partialDay.start] },
                            { $lte: ["$$c.timestamp", partialDay.end] },
                          ],
                        },
                      },
                    },
                    as: "c",
                    in: {
                      timestamp: "$$c.timestamp",
                      item: {
                        id: "$$c.item.id",
                        name: "$$c.item.name",
                        standard: "$$c.item.standard",
                      },
                    },
                  },
                },
                ovStart: 1,
                ovEnd: 1,
                sliceMs: 1,
              },
            },
          ])
          .toArray();
        
        allSessions.push(...sessions);
      }
      
      return allSessions;
    }

    // Helper function to combine daily cache and session data
    function combineMachineData(dailyRecords, sessionData) {
      const machineMap = new Map();
      
      // Process daily cache records
      for (const record of dailyRecords) {
        const key = record.machineSerial;
        if (!machineMap.has(key)) {
          machineMap.set(key, {
            machine: { 
              name: record.machineName || "Unknown", 
              serial: record.machineSerial 
            },
            sessions: [],
            itemAgg: new Map(),
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            totalFaults: 0,
            totalMisfeeds: 0,
            totalFaultTimeMs: 0,
            totalPausedTimeMs: 0,
            dailyRecords: []
          });
        }
        
        const machine = machineMap.get(key);
        machine.dailyRecords.push(record);
        
        // Add daily totals
        machine.totalCount += record.totalCounts || 0;
        machine.totalWorkedMs += record.workedTimeMs || 0;
        machine.totalRuntimeMs += record.runtimeMs || 0;
        machine.totalFaults += record.totalFaults || 0;
        machine.totalMisfeeds += record.totalMisfeeds || 0;
        machine.totalFaultTimeMs += record.faultTimeMs || 0;
        machine.totalPausedTimeMs += record.pausedTimeMs || 0;
      }
      
      // Process session data for partial days
      for (const session of sessionData) {
        const key = session.machine?.serial;
        if (!key) continue;
        
        if (!machineMap.has(key)) {
          machineMap.set(key, {
            machine: { 
              name: session.machine?.name || "Unknown", 
              serial: key 
            },
            sessions: [],
            itemAgg: new Map(),
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            totalFaults: 0,
            totalMisfeeds: 0,
            totalFaultTimeMs: 0,
            totalPausedTimeMs: 0,
            dailyRecords: []
          });
        }
        
        const machine = machineMap.get(key);
        
        if (!session.sliceMs || session.sliceMs <= 0) continue;
        
        const activeStations = Array.isArray(session.operators)
          ? session.operators.filter((op) => op && op.id !== -1).length
          : 0;
        
        const workedTimeMs = Math.max(0, session.sliceMs * activeStations);
        const runtimeMs = Math.max(0, session.sliceMs);
        
        // Add to sessions array
        machine.sessions.push({
          start: new Date(session.ovStart).toISOString(),
          end: new Date(session.ovEnd).toISOString(),
          workedTimeMs,
          workedTimeFormatted: formatDuration(workedTimeMs),
          runtimeMs,
          runtimeFormatted: formatDuration(runtimeMs),
        });
        
        // Add to totals
        machine.totalWorkedMs += workedTimeMs;
        machine.totalRuntimeMs += runtimeMs;
        
        // Process item counts
        const counts = Array.isArray(session.countsFiltered) ? session.countsFiltered : [];
        if (counts.length > 0) {
          const byItem = new Map();
          for (const c of counts) {
            const it = c.item || {};
            const id = it.id;
            if (id == null) continue;
            if (!byItem.has(id)) {
              byItem.set(id, {
                id,
                name: it.name || "Unknown",
                standard: Number(it.standard) || 0,
                count: 0,
              });
            }
            byItem.get(id).count += 1;
          }
          
          const totalSessionItemCount = [...byItem.values()].reduce((s, it) => s + it.count, 0) || 1;
          
          for (const [, itm] of byItem) {
            const share = itm.count / totalSessionItemCount;
            const workedShare = workedTimeMs * share;
            
            const rec = machine.itemAgg.get(itm.id) || {
              name: itm.name,
              standard: itm.standard,
              count: 0,
              workedTimeMs: 0,
            };
            rec.count += itm.count;
            rec.workedTimeMs += workedShare;
            machine.itemAgg.set(itm.id, rec);
            
            machine.totalCount += itm.count;
          }
        }
      }
      
      return Array.from(machineMap.values());
    }

    // Split time range
    const { completeDays, partialDays } = splitTimeRange(exactStart, exactEnd);
    
    console.log(`Time range split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
    
    // Query both data sources
    const [dailyRecords, sessionData] = await Promise.all([
      queryDailyCache(completeDays, serial),
      querySessions(partialDays, serial)
    ]);
    
    // Combine the data
    const combinedData = combineMachineData(dailyRecords, sessionData);
    
    if (combinedData.length === 0) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Machine Status Stacked Bar", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked Efficiency% by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Efficiency (%)", series:[{ id:"Efficiency", title:"Efficiency", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        },
        optimization: {
          used: true,
          approach: 'hybrid',
          completeDays: completeDays.length,
          partialDays: partialDays.length,
          dailyRecords: dailyRecords.length,
          sessionRecords: sessionData.length
        }
      });
    }
    
    // Process results similar to original route
    const results = [];
    const serialToName = new Map();
    
    for (const machine of combinedData) {
      serialToName.set(machine.machine.serial, machine.machine.name);
      
      let proratedStandard = 0;
      const itemSummaries = {};
      
      for (const [itemId, s] of machine.itemAgg.entries()) {
        const hours = s.workedTimeMs / 3600000;
        const pph = hours > 0 ? s.count / hours : 0;
        const eff = s.standard > 0 ? pph / s.standard : 0;
        const weight = machine.totalCount > 0 ? s.count / machine.totalCount : 0;
        proratedStandard += weight * s.standard;
        
        itemSummaries[itemId] = {
          name: s.name,
          standard: s.standard,
          countTotal: s.count,
          workedTimeFormatted: formatDuration(s.workedTimeMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100,
        };
      }
      
      // Calculate machine-level metrics
      const hours = machine.totalWorkedMs / 3600000;
      const machinePph = hours > 0 ? machine.totalCount / hours : 0;
      const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;
      
      results.push({
        machine: machine.machine,
        sessions: machine.sessions,
        machineSummary: {
          totalCount: machine.totalCount,
          workedTimeMs: machine.totalWorkedMs,
          workedTimeFormatted: formatDuration(machine.totalWorkedMs),
          runtimeMs: machine.totalRuntimeMs,
          runtimeFormatted: formatDuration(machine.totalRuntimeMs),
          pph: Math.round(machinePph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(machineEff * 10000) / 100,
          itemSummaries,
        },
      });
    }
    
    // Generate chart data (simplified for now - could be enhanced)
    const efficiencyRanked = results
      .map(r => ({
        serial: r.machine.serial,
        name: r.machine.name,
        efficiency: Number(r.machineSummary?.efficiency || 0),
      }))
      .sort((a, b) => b.efficiency - a.efficiency);
    
    const finalOrderSerials = results.map(r => r.machine.serial);
    
    // Build status data for charts
    const statusByMachine = new Map();
    for (const machine of combinedData) {
      const runningHours = machine.totalRuntimeMs / 3600000;
      const faultedHours = machine.totalFaultTimeMs / 3600000;
      const downtimeHours = machine.totalPausedTimeMs / 3600000;
      
      statusByMachine.set(machine.machine.serial, {
        "Running": runningHours,
        "Faulted": faultedHours,
        "Paused": downtimeHours
      });
    }
    
    // Build items data for charts
    const itemsByMachine = new Map();
    for (const r of results) {
      const m = {};
      for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
        const label = s.name || String(id);
        const count = Number(s.countTotal || 0);
        m[label] = (m[label] || 0) + count;
      }
      itemsByMachine.set(r.machine.serial, m);
    }
    
    // Build faults data for charts
    const faultsByMachine = new Map();
    for (const machine of combinedData) {
      if (machine.totalFaults > 0) {
        faultsByMachine.set(machine.machine.serial, {
          "Faults": machine.totalFaultTimeMs / 3600000
        });
      } else {
        faultsByMachine.set(machine.machine.serial, {
          "No Faults": 0
        });
      }
    }
    
    // Generate chart series (simplified)
    const statusStacked = finalOrderSerials.map(serial => ({
      id: String(serial),
      title: serialToName.get(serial) || String(serial),
      type: "bar",
      stack: "status",
      data: Object.entries(statusByMachine.get(serial) || {}).map(([status, hours]) => ({
        x: status,
        y: Math.round((hours || 0) * 100) / 100
      }))
    }));
    
    const itemsStacked = finalOrderSerials.map(serial => ({
      id: String(serial),
      title: serialToName.get(serial) || String(serial),
      type: "bar",
      stack: "items",
      data: Object.entries(itemsByMachine.get(serial) || {}).map(([item, count]) => ({
        x: item,
        y: count || 0
      }))
    }));
    
    const faultsStacked = finalOrderSerials.map(serial => ({
      id: String(serial),
      title: serialToName.get(serial) || String(serial),
      type: "bar",
      stack: "faults",
      data: Object.entries(faultsByMachine.get(serial) || {}).map(([faultType, hours]) => ({
        x: faultType,
        y: Math.round((hours || 0) * 100) / 100
      }))
    }));
    
    // Final response
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,
      charts: {
        statusStacked: {
          title: "Machine Status Stacked Bar",
          orientation: "vertical",
          xType: "category",
          xLabel: "Machine",
          yLabel: "Duration (hours)",
          series: statusStacked
        },
        efficiencyRanked: {
          title: "Ranked OEE% by Machine", 
          orientation: "horizontal",
          xType: "category",
          xLabel: "Machine",
          yLabel: "OEE (%)",
          series: [
            {
              id: "OEE",
              title: "OEE",
              type: "bar",
              data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
            },
          ]
        },
        itemsStacked: {
          title: "Item Stacked Bar by Machine",
          orientation: "vertical", 
          xType: "category",
          xLabel: "Machine",
          yLabel: "Item Count",
          series: itemsStacked
        },
        faultsStacked: {
          title: "Fault Stacked Bar by Machine",
          orientation: "vertical",
          xType: "category", 
          xLabel: "Machine",
          yLabel: "Fault Duration (hours)",
          series: faultsStacked
        },
        order: finalOrderSerials.map(s => serialToName.get(s) || s)
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
    });
    
  } catch (error) {
    console.log(`Error in hybrid machine item summary:`, error);
    res.status(500).json({ 
      error: "Failed to generate hybrid machine item summary",
      message: error.message 
    });
  }
});

// Hybrid operator report route - combines daily cache for complete days + sessions for partial days
router.get("/analytics/operator-item-sessions-summary-hybrid", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
    
    // Configurable threshold for hybrid approach (36 hours)
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    
    // If time range is less than threshold, use original route
    if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
      // Redirect to original route for shorter time ranges
      return res.status(400).json({
        error: `Time range must be greater than ${HYBRID_THRESHOLD_HOURS} hours for hybrid approach`,
        suggestion: 'Use /analytics/operator-item-sessions-summary for shorter time ranges'
      });
    }

    console.log(`Using hybrid approach for operator route, time range: ${timeRangeHours.toFixed(1)} hours`);

    // Helper function to split time range into complete days and partial days
    function splitTimeRange(start, end) {
      const completeDays = [];
      const partialDays = [];
      
      // Get timezone-aware start and end of days
      const startOfFirstDay = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf('day');
      const endOfLastDay = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf('day');
      
      // Check if first day is complete
      const firstDayStart = startOfFirstDay.toJSDate();
      const firstDayEnd = startOfFirstDay.endOf('day').toJSDate();
      
      if (start.getTime() <= firstDayStart.getTime() + 1000) { // Within 1 second of day start
        completeDays.push({
          date: startOfFirstDay.toISODate(),
          start: firstDayStart,
          end: firstDayEnd
        });
      } else {
        partialDays.push({
          start: start,
          end: firstDayEnd
        });
      }
      
      // Add all complete days in between
      let currentDay = startOfFirstDay.plus({ days: 1 });
      while (currentDay < endOfLastDay.startOf('day')) {
        completeDays.push({
          date: currentDay.toISODate(),
          start: currentDay.startOf('day').toJSDate(),
          end: currentDay.endOf('day').toJSDate()
        });
        currentDay = currentDay.plus({ days: 1 });
      }
      
      // Check if last day is complete
      const lastDayStart = endOfLastDay.startOf('day').toJSDate();
      const lastDayEnd = endOfLastDay.toJSDate();
      
      if (end.getTime() >= lastDayEnd.getTime() - 1000) { // Within 1 second of day end
        completeDays.push({
          date: endOfLastDay.toISODate(),
          start: lastDayStart,
          end: lastDayEnd
        });
      } else {
        partialDays.push({
          start: lastDayStart,
          end: end
        });
      }
      
      return { completeDays, partialDays };
    }

    // Helper function to query daily cache for complete days
    async function queryDailyCache(completeDays, operatorId) {
      if (completeDays.length === 0) return [];
      
      const dates = completeDays.map(day => day.date);
      const query = {
        entityType: 'operator-machine',
        date: { $in: dates }
      };
      
      if (operatorId) {
        query.operatorId = parseInt(operatorId);
      }
      
      
      const dailyRecords = await db.collection('totals-daily').find(query).toArray();
      
      return dailyRecords;
    }

    // Helper function to query sessions for partial days
    async function querySessions(partialDays, operatorId) {
      if (partialDays.length === 0) return [];
      
      
      const allSessions = [];
      
      for (const partialDay of partialDays) {
        const match = {
          ...(operatorId ? { "operator.id": parseInt(operatorId) } : {}),
          "timestamps.start": { $lte: partialDay.end },
          $or: [
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": { $gte: partialDay.start } },
          ],
        };
        
        const sessions = await db
          .collection(config.operatorSessionCollectionName)
          .aggregate([
            { $match: match },
            {
              $addFields: {
                ovStart: { $max: ["$timestamps.start", partialDay.start] },
                ovEnd: { $min: [{ $ifNull: ["$timestamps.end", partialDay.end] }, partialDay.end] },
              },
            },
            {
              $addFields: {
                sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] },
              },
            },
            {
              $project: {
                _id: 0,
                timestamps: 1,
                operator: 1,
                machine: 1,
                countsFiltered: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$counts",
                        as: "c",
                        cond: {
                          $and: [
                            { $gte: ["$$c.timestamp", partialDay.start] },
                            { $lte: ["$$c.timestamp", partialDay.end] },
                          ],
                        },
                      },
                    },
                    as: "c",
                    in: {
                      timestamp: "$$c.timestamp",
                      item: {
                        id: "$$c.item.id",
                        name: "$$c.item.name",
                        standard: "$$c.item.standard",
                      },
                    },
                  },
                },
                ovStart: 1,
                ovEnd: 1,
                sliceMs: 1,
              },
            },
          ])
          .toArray();
        
        allSessions.push(...sessions);
      }
      
      return allSessions;
    }

    // Helper function to combine daily cache and session data
    function combineOperatorData(dailyRecords, sessionData) {
      const operatorMap = new Map();
      
      // Process daily cache records
      for (const record of dailyRecords) {
        const key = record.operatorId;
        if (!operatorMap.has(key)) {
          operatorMap.set(key, {
            operator: { 
              id: record.operatorId, 
              name: record.operatorName 
            },
            sessions: [],
            itemAgg: new Map(),
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            totalFaults: 0,
            totalMisfeeds: 0,
            totalFaultTimeMs: 0,
            totalPausedTimeMs: 0,
            dailyRecords: []
          });
        }
        
        const operator = operatorMap.get(key);
        operator.dailyRecords.push(record);
        
        // Add daily totals
        operator.totalCount += record.totalCounts || 0;
        operator.totalWorkedMs += record.workedTimeMs || 0;
        operator.totalRuntimeMs += record.runtimeMs || 0;
        operator.totalFaults += record.totalFaults || 0;
        operator.totalMisfeeds += record.totalMisfeeds || 0;
        operator.totalFaultTimeMs += record.faultTimeMs || 0;
        operator.totalPausedTimeMs += record.pausedTimeMs || 0;
      }
      
      // Process session data for partial days
      for (const session of sessionData) {
        const key = session.operator?.id;
        if (!key) continue;
        
        if (!operatorMap.has(key)) {
          operatorMap.set(key, {
            operator: { 
              id: key, 
              name: session.operator?.name || "Unknown" 
            },
            sessions: [],
            itemAgg: new Map(),
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            totalFaults: 0,
            totalMisfeeds: 0,
            totalFaultTimeMs: 0,
            totalPausedTimeMs: 0,
            dailyRecords: []
          });
        }
        
        const operator = operatorMap.get(key);
        
        if (!session.sliceMs || session.sliceMs <= 0) continue;
        
        const workedTimeMs = Math.max(0, session.sliceMs);
        const runtimeMs = Math.max(0, session.sliceMs);
        
        // Add to sessions array
        operator.sessions.push({
          start: new Date(session.ovStart).toISOString(),
          end: new Date(session.ovEnd).toISOString(),
          workedTimeMs,
          workedTimeFormatted: formatDuration(workedTimeMs),
          runtimeMs,
          runtimeFormatted: formatDuration(runtimeMs),
        });
        
        // Add to totals
        operator.totalWorkedMs += workedTimeMs;
        operator.totalRuntimeMs += runtimeMs;
        
        // Process item counts
        const counts = Array.isArray(session.countsFiltered) ? session.countsFiltered : [];
        if (counts.length > 0) {
          const byItem = new Map();
          for (const c of counts) {
            const it = c.item || {};
            const id = it.id;
            if (id == null) continue;
            if (!byItem.has(id)) {
              byItem.set(id, {
                id,
                name: it.name || "Unknown",
                standard: Number(it.standard) || 0,
                count: 0,
              });
            }
            byItem.get(id).count += 1;
          }
          
          const totalSessionItemCount = [...byItem.values()].reduce((s, it) => s + it.count, 0) || 1;
          
          for (const [, itm] of byItem) {
            const share = itm.count / totalSessionItemCount;
            const workedShare = workedTimeMs * share;
            
            const rec = operator.itemAgg.get(itm.id) || {
              name: itm.name,
              standard: itm.standard,
              count: 0,
              workedTimeMs: 0,
            };
            rec.count += itm.count;
            rec.workedTimeMs += workedShare;
            operator.itemAgg.set(itm.id, rec);
            
            operator.totalCount += itm.count;
          }
        }
      }
      
      return Array.from(operatorMap.values());
    }

    // Split time range
    const { completeDays, partialDays } = splitTimeRange(exactStart, exactEnd);
    
    console.log(`Time range split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
    
    // Query both data sources
    const [dailyRecords, sessionData] = await Promise.all([
      queryDailyCache(completeDays, operatorId),
      querySessions(partialDays, operatorId)
    ]);
    
    // Combine the data
    const combinedData = combineOperatorData(dailyRecords, sessionData);
    
    if (combinedData.length === 0) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Operator Status Stacked Bar", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked OEE% by Operator", orientation:"horizontal", xType:"category", xLabel:"Operator", yLabel:"OEE (%)", series:[{ id:"OEE", title:"OEE", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        },
        optimization: {
          used: true,
          approach: 'hybrid',
          completeDays: completeDays.length,
          partialDays: partialDays.length,
          dailyRecords: dailyRecords.length,
          sessionRecords: sessionData.length
        }
      });
    }
    
    // Process results similar to original route
    const results = [];
    const operatorIdToName = new Map();
    
    for (const operator of combinedData) {
      operatorIdToName.set(operator.operator.id, operator.operator.name);
      
      let proratedStandard = 0;
      const itemSummaries = {};
      
      for (const [itemId, s] of operator.itemAgg.entries()) {
        const hours = s.workedTimeMs / 3600000;
        const pph = hours > 0 ? s.count / hours : 0;
        const eff = s.standard > 0 ? pph / s.standard : 0;
        const weight = operator.totalCount > 0 ? s.count / operator.totalCount : 0;
        proratedStandard += weight * s.standard;
        
        itemSummaries[itemId] = {
          name: s.name,
          standard: s.standard,
          countTotal: s.count,
          workedTimeFormatted: formatDuration(s.workedTimeMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100,
        };
      }
      
      // Calculate operator-level metrics
      const hours = operator.totalWorkedMs / 3600000;
      const operatorPph = hours > 0 ? operator.totalCount / hours : 0;
      const operatorEff = proratedStandard > 0 ? operatorPph / proratedStandard : 0;
      
      results.push({
        operator: operator.operator,
        sessions: operator.sessions,
        operatorSummary: {
          totalCount: operator.totalCount,
          workedTimeMs: operator.totalWorkedMs,
          workedTimeFormatted: formatDuration(operator.totalWorkedMs),
          runtimeMs: operator.totalRuntimeMs,
          runtimeFormatted: formatDuration(operator.totalRuntimeMs),
          pph: Math.round(operatorPph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(operatorEff * 10000) / 100,
          itemSummaries,
        },
      });
    }
    
    // Generate chart data (simplified for now - could be enhanced)
    const efficiencyRanked = results
      .map(r => ({
        operatorId: r.operator.id,
        name: r.operator.name,
        efficiency: Number(r.operatorSummary?.efficiency || 0),
      }))
      .sort((a, b) => b.efficiency - a.efficiency);
    
    const finalOrderOperators = results.map(r => r.operator.id);
    
    // Build status data for charts
    const statusByOperator = new Map();
    for (const operator of combinedData) {
      const workingHours = operator.totalRuntimeMs / 3600000;
      const faultedHours = operator.totalFaultTimeMs / 3600000;
      const idleHours = operator.totalPausedTimeMs / 3600000;
      
      statusByOperator.set(operator.operator.id, {
        "Working": workingHours,
        "Faulted": faultedHours,
        "Idle": idleHours
      });
    }
    
    // Build items data for charts
    const itemsByOperator = new Map();
    for (const r of results) {
      const m = {};
      for (const [id, s] of Object.entries(r.operatorSummary.itemSummaries || {})) {
        const label = s.name || String(id);
        const count = Number(s.countTotal || 0);
        m[label] = (m[label] || 0) + count;
      }
      itemsByOperator.set(r.operator.id, m);
    }
    
    // Build faults data for charts
    const faultsByOperator = new Map();
    for (const operator of combinedData) {
      if (operator.totalFaults > 0) {
        faultsByOperator.set(operator.operator.id, {
          "Faults": operator.totalFaultTimeMs / 3600000
        });
      } else {
        faultsByOperator.set(operator.operator.id, {
          "No Faults": 0
        });
      }
    }
    
    // Generate chart series (simplified)
    const statusStacked = finalOrderOperators.map(operatorId => ({
      id: String(operatorId),
      title: operatorIdToName.get(operatorId) || String(operatorId),
      type: "bar",
      stack: "status",
      data: Object.entries(statusByOperator.get(operatorId) || {}).map(([status, hours]) => ({
        x: status,
        y: Math.round((hours || 0) * 100) / 100
      }))
    }));
    
    const itemsStacked = finalOrderOperators.map(operatorId => ({
      id: String(operatorId),
      title: operatorIdToName.get(operatorId) || String(operatorId),
      type: "bar",
      stack: "items",
      data: Object.entries(itemsByOperator.get(operatorId) || {}).map(([item, count]) => ({
        x: item,
        y: count || 0
      }))
    }));
    
    const faultsStacked = finalOrderOperators.map(operatorId => ({
      id: String(operatorId),
      title: operatorIdToName.get(operatorId) || String(operatorId),
      type: "bar",
      stack: "faults",
      data: Object.entries(faultsByOperator.get(operatorId) || {}).map(([faultType, hours]) => ({
        x: faultType,
        y: Math.round((hours || 0) * 100) / 100
      }))
    }));
    
    // Final response
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,
      charts: {
        statusStacked: {
          title: "Operator Status Stacked Bar",
          orientation: "vertical",
          xType: "category",
          xLabel: "Operator",
          yLabel: "Duration (hours)",
          series: statusStacked
        },
        efficiencyRanked: {
          title: "Ranked OEE% by Operator", 
          orientation: "horizontal",
          xType: "category",
          xLabel: "Operator",
          yLabel: "OEE (%)",
          series: [
            {
              id: "OEE",
              title: "OEE",
              type: "bar",
              data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
            },
          ]
        },
        itemsStacked: {
          title: "Item Stacked Bar by Operator",
          orientation: "vertical", 
          xType: "category",
          xLabel: "Operator",
          yLabel: "Item Count",
          series: itemsStacked
        },
        faultsStacked: {
          title: "Fault Stacked Bar by Operator",
          orientation: "vertical",
          xType: "category", 
          xLabel: "Operator",
          yLabel: "Fault Duration (hours)",
          series: faultsStacked
        },
        order: finalOrderOperators.map(id => operatorIdToName.get(id) || id)
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
    });
    
  } catch (error) {
    console.log(`Error in hybrid operator item summary:`, error);
    res.status(500).json({ 
      error: "Failed to generate hybrid operator item summary",
      message: error.message 
    });
  }
});

// Hybrid item report route - combines daily cache for complete days + sessions for partial days
router.get("/analytics/item-sessions-summary-hybrid", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const exactStart = new Date(start);
    const exactEnd = new Date(end);
    
    // Configurable threshold for hybrid approach (36 hours)
    const HYBRID_THRESHOLD_HOURS = 24;
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
    
    // If time range is less than threshold, use original route
    if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
      // Redirect to original route for shorter time ranges
      return res.status(400).json({
        error: "Time range too short for hybrid approach",
        message: `Use /analytics/item-sessions-summary for time ranges ≤ ${HYBRID_THRESHOLD_HOURS} hours`,
        currentHours: Math.round(timeRangeHours * 100) / 100,
        thresholdHours: HYBRID_THRESHOLD_HOURS
      });
    }

    // Split time range into complete days and partial days
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
    if (exactStart < startOfFirstDay.plus({ days: 1 }).toJSDate()) {
      partialDays.push({
        start: exactStart,
        end: Math.min(exactEnd, startOfFirstDay.plus({ days: 1 }).toJSDate()),
        type: 'start'
      });
    }
    
    if (exactEnd > endOfLastDay.minus({ days: 1 }).toJSDate()) {
      partialDays.push({
        start: Math.max(exactStart, endOfLastDay.minus({ days: 1 }).toJSDate()),
        end: exactEnd,
        type: 'end'
      });
    }

    // Query daily cache for complete days
    const dailyRecords = await queryItemDailyCache(db, completeDays);
    
    // Query sessions for partial days
    const sessionData = await queryItemSessions(db, partialDays);
    
    // Combine the data
    const combinedData = combineItemData(dailyRecords, sessionData);
    
    // Build response similar to original route
    const resultsMap = new Map();
    
    // Process combined data
    for (const record of combinedData) {
      const key = String(record.itemId);
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: record.itemId,
          name: record.itemName || `Item ${record.itemId}`,
          totalCount: 0,
          totalMisfeed: 0,
          totalRuntime: 0,
          totalWorkTime: 0,
          totalTimeCredit: 0,
          totalFaultTime: 0,
          totalPausedTime: 0,
          efficiency: 0,
          pph: 0
        });
      }
      
      const item = resultsMap.get(key);
      item.totalCount += record.totalCounts || 0;
      item.totalMisfeed += record.totalMisfeeds || 0;
      item.totalRuntime += (record.runtimeMs || 0) / 1000; // Convert to seconds
      item.totalWorkTime += (record.workedTimeMs || 0) / 1000; // Convert to seconds
      item.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
      item.totalFaultTime += (record.faultTimeMs || 0) / 1000; // Convert to seconds
      item.totalPausedTime += (record.pausedTimeMs || 0) / 1000; // Convert to seconds
    }
    
    // Calculate efficiency and PPH
    for (const item of resultsMap.values()) {
      if (item.totalWorkTime > 0) {
        item.efficiency = (item.totalCount / item.totalWorkTime) * 3600; // PPH
        item.pph = item.efficiency;
      }
    }
    
    // Convert to array and sort
    const results = Array.from(resultsMap.values()).sort((a, b) => b.totalCount - a.totalCount);
    
    res.json({
      success: true,
      data: results,
      metadata: {
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
      }
    });

  } catch (error) {
    console.log("Error in item-sessions-summary-hybrid:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Cached version of machine-item-sessions-summary using totals-daily collection
router.get("/analytics/machine-item-sessions-summary-cache", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    
    // ========== FIX #1: Timezone-aware date handling ==========
    const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
    const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
    
    const normalizedStart = startDt.startOf('day');
    const nowLocal = DateTime.now().setZone(SYSTEM_TIMEZONE);
    
    // Detect "today since midnight" → treat as complete day using cache
    const isTodaySinceMidnight =
      normalizedStart.hasSame(nowLocal, 'day') &&
      startDt.equals(normalizedStart) &&
      endDt <= nowLocal;
    
    // Always use UTC timestamps corresponding to local day boundaries
    const exactStart = normalizedStart.toUTC().toJSDate();
    const exactEnd = isTodaySinceMidnight 
      ? nowLocal.toUTC().toJSDate() 
      : endDt.toUTC().toJSDate();
    
    // Calculate query window once for reuse throughout the route
    const queryWindowMs = exactEnd.getTime() - exactStart.getTime();

    // ---------- helpers (local to route) ----------
    const topNSlicesPerBar = 10;
    const OTHER_LABEL = "Other";

    // Merge-slices so each bar has at most N slices (Top N-1 + "Other")
    function compressSlicesPerBar(
      perLabelTotals,
      N = topNSlicesPerBar,
      otherLabel = OTHER_LABEL
    ) {
      const entries = Object.entries(perLabelTotals);
      if (entries.length <= N) return perLabelTotals;

      entries.sort((a, b) => b[1] - a[1]);
      const keep = entries.slice(0, N - 1);
      const rest = entries.slice(N - 1);
      const otherSum = rest.reduce((s, [, v]) => s + v, 0);

      const out = {};
      for (const [k, v] of keep) out[k] = v;
      out[otherLabel] = otherSum;
      return out;
    }

    // Convert {serial -> {label -> value}} into XY-style stacked series
    function toStackedSeries(
      byMachine,
      serialToName,
      orderSerials,
      stackId
    ) {
      // union of labels (after compression)
      const labels = new Set();
      for (const s of orderSerials) {
        const m = byMachine.get(s);
        if (!m) continue;
        Object.keys(m).forEach((k) => labels.add(k));
      }
      
      // Sort labels by total descending for stable legend order
      const sortedLabels = [...labels].sort((a, b) => {
        const totalA = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[a] || 0), 0);
        const totalB = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[b] || 0), 0);
        return totalB - totalA;
      });
      
      // make one series per label
      const series = sortedLabels.map((label) => ({
        id: label,
        title: label,
        type: "bar",
        stack: stackId,
        data: orderSerials.map((serial) => ({
          x: serialToName.get(serial) || serial,
          y: (byMachine.get(serial) && byMachine.get(serial)[label]) || 0,
        })),
      }));
      return series;
    }

    // ========== FIX #3: Simplified hybrid logic with "today since midnight" detection ==========
    let split;
    if (isTodaySinceMidnight) {
      // Special case: today since midnight → treat as complete day
      split = {
        completeDays: [{
          dateStr: normalizedStart.toISODate(),
          start: normalizedStart.toJSDate(),
          end: nowLocal.toJSDate(),
        }],
        partialDays: [],
      };
    } else {
      split = splitTimeRangeForHybridReport(exactStart, exactEnd);

      // FIX: handle "exact full day" or no-day edge case
      const coversExactlyOneDay =
        endDt.diff(startDt, "hours").hours === 24 &&
        startDt.hour === 0 &&
        endDt.hour === 0;

      if ((split.completeDays.length === 0 && split.partialDays.length === 0) || coversExactlyOneDay) {
        split.completeDays = [{
          dateStr: normalizedStart.toISODate(),
          start: normalizedStart.toUTC().toJSDate(),
          end: normalizedStart.plus({ days: 1 }).toUTC().toJSDate(),
        }];
        split.partialDays = [];
      }
    }
    
    const { completeDays, partialDays } = split;
    
    // ========== FIX #9: Performance - Single cache query for both entity types ==========
    let machineCache = [];     // machine entities from cache
    let machineItemCache = [];  // machine-item entities from cache
    
    if (completeDays.length > 0) {
      const dateStrings = completeDays.map(d => d.dateStr);
      const dateObjs = dateStrings.map(str => new Date(str + 'T00:00:00.000Z'));
      const cacheCollection = db.collection('totals-daily');
      
      // Single query for both entity types with both date formats (50% less I/O)
      const cacheQuery = {
        $or: [
          { dateObj: { $in: dateObjs } },
          { date: { $in: dateStrings } }
        ],
        entityType: { $in: ['machine', 'machine-item'] }
      };
      if (serial) cacheQuery.machineSerial = parseInt(serial);
      
      const cacheDocs = await cacheCollection.find(cacheQuery).toArray();
      
      // Split by entity type
      machineCache = cacheDocs.filter(d => d.entityType === 'machine');
      machineItemCache = cacheDocs.filter(d => d.entityType === 'machine-item');
    }
    
    // Get data from sessions for partial days only
    let sessionData = { machines: [], machineItems: [] };
    if (partialDays.length > 0) {
      sessionData = await getSessionDataForPartialDays(db,partialDays, serial);
    }
    
    // Combine cached and session data (disjoint date ranges)
    const combinedData = combineHybridData(machineCache, machineItemCache, sessionData);
    let machineTotals = combinedData.machines;
    let machineItemTotals = combinedData.machineItems;

    if (!machineTotals.length) {
      // Try session data as fallback when cache is missing
      const partialDay = {
        start: exactStart,
        end: exactEnd
      };
      const sessionFallback = await getSessionDataForPartialDays(db,[partialDay], serial);
      
      if (sessionFallback.machines.length > 0) {
        // Re-combine with session data
        const recombined = combineHybridData([], [], sessionFallback);
        machineTotals = recombined.machines;
        machineItemTotals = recombined.machineItems;
      }
      
      // Final check after fallback attempt
      if (!machineTotals.length) {
        return res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results: []
        });
      }
    }

    // ---------- 2) Process machine data ----------
    const results = [];
    const serialToName = new Map();
    
    // ========== Aggregate machine data by (serial, date) to prevent duplication ==========
    const groupedByMachineDay = new Map();
    
    for (const record of machineTotals) {
      const key = `${record.machineSerial}-${record.date}`;
      
      if (!groupedByMachineDay.has(key)) {
        groupedByMachineDay.set(key, {
          machineSerial: record.machineSerial,
          machineName: record.machineName,
          date: record.date,
          runtimeMs: 0,
          workedTimeMs: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          faultTimeMs: 0,
          pausedTimeMs: 0
        });
      }
      
      const dayBucket = groupedByMachineDay.get(key);
      dayBucket.runtimeMs += record.runtimeMs || 0;
      dayBucket.workedTimeMs += record.workedTimeMs || 0;
      dayBucket.totalCounts += record.totalCounts || 0;
      dayBucket.totalMisfeeds += record.totalMisfeeds || 0;
      dayBucket.faultTimeMs += record.faultTimeMs || 0;
      dayBucket.pausedTimeMs += record.pausedTimeMs || 0;
    }
    
    // Cap each machine to 24h per day
    for (const [key, dayBucket] of groupedByMachineDay) {
      if (dayBucket.runtimeMs > 86400000) {
        dayBucket.runtimeMs = 86400000;
      }
      if (dayBucket.workedTimeMs > 86400000) {
        dayBucket.workedTimeMs = 86400000;
      }
    }
    
    // Aggregate across all days for each machine
    const machineDataMap = new Map();
    for (const [key, dayBucket] of groupedByMachineDay) {
      const serial = dayBucket.machineSerial;
      const name = dayBucket.machineName;
      serialToName.set(serial, name);
      
      if (!machineDataMap.has(serial)) {
        machineDataMap.set(serial, {
          machineSerial: serial,
          machineName: name,
          runtimeMs: 0,
          workedTimeMs: 0,
          totalCounts: 0,
          totalMisfeeds: 0,
          faultTimeMs: 0,
          pausedTimeMs: 0,
          daysActive: 0
        });
      }
      
      const bucket = machineDataMap.get(serial);
      bucket.runtimeMs += dayBucket.runtimeMs;
      bucket.workedTimeMs += dayBucket.workedTimeMs;
      bucket.totalCounts += dayBucket.totalCounts;
      bucket.totalMisfeeds += dayBucket.totalMisfeeds;
      bucket.faultTimeMs += dayBucket.faultTimeMs;
      bucket.pausedTimeMs += dayBucket.pausedTimeMs;
      bucket.daysActive += 1;
    }

    // Group machine-item totals by machine serial, then aggregate by (serial, itemId) to sum across dates
    const machineItemMap = new Map(); // serial -> array of item records
    for (const itemTotal of machineItemTotals) {
      const serial = itemTotal.machineSerial;
      if (!machineItemMap.has(serial)) {
        machineItemMap.set(serial, []);
      }
      machineItemMap.get(serial).push(itemTotal);
    }

    // Process each machine
    for (const [serial, machineData] of machineDataMap) {
      const itemTotals = machineItemMap.get(serial) || [];
      
      // ========== FIX: Aggregate machine-items by (serial, itemId) to sum across dates ==========
      // This prevents items from showing more time than the machine total
      const aggregatedItems = new Map(); // itemId -> aggregated item data
      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);
        
        if (!aggregatedItems.has(itemId)) {
          aggregatedItems.set(itemId, {
            itemId: itemTotal.itemId,
            itemName: itemTotal.itemName,
            itemStandard: itemTotal.itemStandard,
            totalCounts: 0,
            workedTimeMs: 0,
          });
        }
        
        const aggregated = aggregatedItems.get(itemId);
        aggregated.totalCounts += itemTotal.totalCounts || 0;
        aggregated.workedTimeMs += itemTotal.workedTimeMs || 0;
      }
      
      // ========== FIX: Cap each item's workedTimeMs appropriately ==========
      // Prevents individual items from showing more time than the machine actually ran
      // This handles cases where item runtimes are inflated due to overlapping sessions
      // For multi-day queries, use the maximum of machine runtime OR expected runtime based on days
      // This handles cases where cache only has partial data (e.g., only one day when querying 4 days)
      const machineRuntimeMs = machineData.runtimeMs;
      const expectedRuntimeMs = machineData.daysActive * 86400000; // Expected: daysActive * 24h
      // Use the larger of: actual machine runtime, expected runtime (but cap at query window)
      const effectiveMachineRuntimeMs = Math.max(machineRuntimeMs, expectedRuntimeMs);
      const maxAllowedRuntimeMs = Math.min(effectiveMachineRuntimeMs, queryWindowMs);
      
      for (const aggregatedItem of aggregatedItems.values()) {
        if (aggregatedItem.workedTimeMs > maxAllowedRuntimeMs) {
          aggregatedItem.workedTimeMs = maxAllowedRuntimeMs;
        }
      }
      
      // Calculate item summaries from aggregated data
      let proratedStandard = 0;
      const itemSummaries = {};

      // First pass: calculate totals from items with non-zero counts (items that will be displayed)
      let itemTotalCounts = 0;
      let itemTotalWorkedMs = 0;

      for (const aggregatedItem of aggregatedItems.values()) {
        // Skip items with zero counts to avoid cluttering the response
        if (aggregatedItem.totalCounts === 0) {
          continue;
        }

        // Sum totals from displayed items only
        itemTotalCounts += aggregatedItem.totalCounts;
        itemTotalWorkedMs += aggregatedItem.workedTimeMs;

        const hours = aggregatedItem.workedTimeMs / 3600000;
        const pph = hours > 0 ? aggregatedItem.totalCounts / hours : 0;
        const eff = aggregatedItem.itemStandard > 0 ? pph / aggregatedItem.itemStandard : 0;
        const weight = machineData.totalCounts > 0 ? aggregatedItem.totalCounts / machineData.totalCounts : 0;
        proratedStandard += weight * aggregatedItem.itemStandard;

        itemSummaries[aggregatedItem.itemId] = {
          name: aggregatedItem.itemName,
          standard: aggregatedItem.itemStandard,
          countTotal: aggregatedItem.totalCounts,
          workedTimeFormatted: formatDuration(aggregatedItem.workedTimeMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100,
        };
      }

      // Add Total entry first (top row) - uses machine's runtimeMs
      const machineRuntimeHours = machineData.runtimeMs / 3600000;
      const machineTotalPph = machineRuntimeHours > 0 ? itemTotalCounts / machineRuntimeHours : 0;
      const machineTotalEfficiency = proratedStandard > 0 ? machineTotalPph / proratedStandard : 0;

      // Create a new object with Total first, then individual items
      const itemSummariesWithTotal = {
        'Total': {
          name: 'Total',
          standard: Math.round(proratedStandard * 100) / 100,
          countTotal: itemTotalCounts,
          workedTimeFormatted: formatDuration(machineData.runtimeMs),
          pph: Math.round(machineTotalPph * 100) / 100,
          efficiency: Math.round(machineTotalEfficiency * 10000) / 100,
        },
        ...itemSummaries
      };

      // Calculate machine-level metrics
      const hours = machineData.workedTimeMs / 3600000;
      const machinePph = hours > 0 ? machineData.totalCounts / hours : 0;
      const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;
      
      // Final validation: cap to query window
      let validatedRuntimeMs = machineData.runtimeMs;
      let validatedWorkedMs = machineData.workedTimeMs;
      
      if (validatedRuntimeMs > queryWindowMs) {
        validatedRuntimeMs = queryWindowMs;
      }
      if (validatedWorkedMs > queryWindowMs) {
        validatedWorkedMs = queryWindowMs;
      }

      results.push({
        machine: {
          name: machineData.machineName,
          serial: machineData.machineSerial
        },
        sessions: [], // Empty array - no individual session details in cached version
        machineSummary: {
          totalCount: machineData.totalCounts,
          workedTimeMs: validatedWorkedMs,
          workedTimeFormatted: formatDuration(validatedWorkedMs),
          runtimeMs: validatedRuntimeMs,
          runtimeFormatted: formatDuration(validatedRuntimeMs),
          pph: Math.round(machinePph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(machineEff * 10000) / 100,
          itemSummaries: itemSummariesWithTotal,
        },
      });
    }

    // ---------- 3) Status stacked (durations) ----------
    // COMMENTED OUT FOR PERFORMANCE
    // const statusByMachine = new Map();
    // for (const machineData of machineTotals) {
    //   const serial = machineData.machineSerial;
    //   const name = machineData.machineName;
    //   
    //   statusByMachine.set(serial, {
    //     "Running": machineData.runtimeMs / 3600000, // Convert to hours
    //     "Faulted": machineData.faultTimeMs / 3600000,
    //     "Paused": machineData.pausedTimeMs / 3600000
    //   });
    // }

    // // Compress per machine
    // for (const [s, rec] of statusByMachine) {
    //   statusByMachine.set(s, compressSlicesPerBar(rec));
    // }

    // // ---------- 4) Faults stacked (durations by fault type) ----------
    // // For cached version, we'll use a simplified fault representation
    // // since fault details aren't stored in machine daily totals
    // const faultsByMachine = new Map();
    // for (const machineData of machineTotals) {
    //   const serial = machineData.machineSerial;
    //   const faultHours = machineData.faultTimeMs / 3600000;
    //   
    //   if (faultHours > 0) {
    //     faultsByMachine.set(serial, {
    //       "Faults": faultHours
    //     });
    //   } else {
    //     faultsByMachine.set(serial, {
    //       "No Faults": 0
    //     });
    //   }
    // }

    // // ---------- 5) Efficiency ranking order ----------
    // const efficiencyRanked = results
    //   .map(r => ({
    //     serial: r.machine.serial,
    //     name: r.machine.name,
    //     efficiency: Number(r.machineSummary?.efficiency || 0),
    //   }))
    //   .sort((a, b) => b.efficiency - a.efficiency);

    // // Build comprehensive machine ordering from all data sources
    // const unionSerials = new Set(efficiencyRanked.map(r => r.serial));
    // for (const m of statusByMachine.keys()) unionSerials.add(m);
    // for (const m of faultsByMachine.keys()) unionSerials.add(m);
    // const finalOrderSerials = [...unionSerials].filter(s => serialToName.has(s));

    // // ---------- 6) Items stacked ----------
    // const itemsByMachine = new Map();
    // for (const r of results) {
    //   const m = {};
    //   for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
    //     const label = s.name || String(id);
    //     const count = Number(s.countTotal || 0);
    //     m[label] = (m[label] || 0) + count;
    //   }
    //   itemsByMachine.set(r.machine.serial, compressSlicesPerBar(m));
    // }

    // const itemsStacked = toStackedSeries(itemsByMachine, serialToName, finalOrderSerials, "items");
    // const statusStacked = toStackedSeries(statusByMachine, serialToName, finalOrderSerials, "status");
    // const faultsStacked = toStackedSeries(faultsByMachine, serialToName, finalOrderSerials, "faults");

    // ---------- 7) Final payload ----------
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,                  // Same structure as original route
      // CHARTS COMMENTED OUT FOR PERFORMANCE
      // charts: {
      //   statusStacked: {
      //     title: "Machine Status Stacked Bar",
      //     orientation: "vertical",
      //     xType: "category",
      //     xLabel: "Machine",
      //     yLabel: "Duration (hours)",
      //     series: statusStacked
      //   },
      //   efficiencyRanked: {
      //     title: "Ranked OEE% by Machine", 
      //     orientation: "horizontal",
      //     xType: "category",
      //     xLabel: "Machine",
      //     yLabel: "OEE (%)",
      //     series: [
      //       {
      //         id: "OEE",
      //         title: "OEE",
      //         type: "bar",
      //         data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
      //       },
      //     ]
      //   },
      //   itemsStacked: {
      //     title: "Item Stacked Bar by Machine",
      //     orientation: "vertical", 
      //     xType: "category",
      //     xLabel: "Machine",
      //     yLabel: "Item Count",
      //     series: itemsStacked
      //   },
      //   faultsStacked: {
      //     title: "Fault Stacked Bar by Machine",
      //     orientation: "vertical",
      //     xType: "category", 
      //     xLabel: "Machine",
      //     yLabel: "Fault Duration (hours)",
      //     series: faultsStacked
      //   },
      //   order: finalOrderSerials.map(s => serialToName.get(s) || s), // machine display order (ranked)
      // },
    });
  } catch (error) {
    console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate cached machine item summary" });
  }
});

// Simplified cached version using only totals-daily collection
router.get("/analytics/machine-item-sessions-summary-cache2", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    
    // Timezone-aware date handling
    const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
    const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
    
    const normalizedStart = startDt.startOf('day');
    const normalizedEnd = endDt.startOf('day');
    
    // Generate date range
    const dateStrings = [];
    let currentDate = normalizedStart;
    while (currentDate <= normalizedEnd) {
      dateStrings.push(currentDate.toISODate());
      currentDate = currentDate.plus({ days: 1 });
    }
    
    const cacheCollection = db.collection('totals-daily');
    
    // Query for machine and machine-item records
    const cacheQuery = {
      $or: [
        { dateObj: { $in: dateStrings.map(str => new Date(str + 'T00:00:00.000Z')) } },
        { date: { $in: dateStrings } }
      ],
      entityType: { $in: ['machine', 'machine-item'] }
    };
    if (serial) cacheQuery.machineSerial = parseInt(serial);
    
    const cacheDocs = await cacheCollection.find(cacheQuery).toArray();
    
    // Split by entity type
    const machineRecords = cacheDocs.filter(d => d.entityType === 'machine');
    const machineItemRecords = cacheDocs.filter(d => d.entityType === 'machine-item');
    
    // Aggregate machines by serial (sum across dates)
    const machineMap = new Map();
    for (const machine of machineRecords) {
      const serial = machine.machineSerial;
      if (machineMap.has(serial)) {
        const existing = machineMap.get(serial);
        existing.runtimeMs += machine.runtimeMs || 0;
        existing.totalCounts += machine.totalCounts || 0;
        existing.workedTimeMs += machine.workedTimeMs || 0;
      } else {
        machineMap.set(serial, {
          machineSerial: serial,
          machineName: machine.machineName,
          runtimeMs: machine.runtimeMs || 0,
          totalCounts: machine.totalCounts || 0,
          workedTimeMs: machine.workedTimeMs || 0,
        });
      }
    }
    
    // Aggregate machine-items by (serial, itemId) - deduplicate by date first, then sum
    const itemDeduplicatedByDate = new Map(); // key: `${serial}-${itemId}-${date}`
    for (const item of machineItemRecords) {
      const dateKey = item.date || item.dateStr || 'unknown';
      const key = `${item.machineSerial}-${item.itemId}-${dateKey}`;
      
      if (itemDeduplicatedByDate.has(key)) {
        // Duplicate for same (serial, itemId, date) - take max
        const existing = itemDeduplicatedByDate.get(key);
        existing.totalCounts = Math.max(existing.totalCounts, item.totalCounts || 0);
        existing.workedTimeMs = Math.max(existing.workedTimeMs, item.workedTimeMs || 0);
        existing.runtimeMs = Math.max(existing.runtimeMs, item.runtimeMs || 0);
      } else {
        itemDeduplicatedByDate.set(key, {
          machineSerial: item.machineSerial,
          itemId: item.itemId,
          itemName: item.itemName,
          itemStandard: item.itemStandard,
          totalCounts: item.totalCounts || 0,
          workedTimeMs: item.workedTimeMs || 0,
          runtimeMs: item.runtimeMs || 0,
        });
      }
    }
    
    // Sum across dates by (serial, itemId)
    const itemMap = new Map(); // key: `${serial}-${itemId}`
    for (const item of itemDeduplicatedByDate.values()) {
      const key = `${item.machineSerial}-${item.itemId}`;
      if (itemMap.has(key)) {
        const existing = itemMap.get(key);
        existing.totalCounts += item.totalCounts;
        existing.workedTimeMs += item.workedTimeMs;
        existing.runtimeMs += item.runtimeMs;
      } else {
        itemMap.set(key, {
          machineSerial: item.machineSerial,
          itemId: item.itemId,
          itemName: item.itemName,
          itemStandard: item.itemStandard,
          totalCounts: item.totalCounts,
          workedTimeMs: item.workedTimeMs,
          runtimeMs: item.runtimeMs,
        });
      }
    }
    
    // Build results in the same format as machine-item-sessions-summary-cache
    const results = [];
    const exactStart = normalizedStart.toUTC().toJSDate();
    const exactEnd = normalizedEnd.plus({ days: 1 }).toUTC().toJSDate();
    
    for (const [serial, machineData] of machineMap) {
      const machineItems = Array.from(itemMap.values()).filter(item => item.machineSerial === serial);
      
      // Calculate machine totals from items
      const machineTotalCounts = machineItems.reduce((sum, item) => sum + item.totalCounts, 0);
      const machineTotalRuntimeMs = machineItems.reduce((sum, item) => sum + item.runtimeMs, 0);
      const machineTotalWorkedMs = machineItems.reduce((sum, item) => sum + item.workedTimeMs, 0);
      
      // Calculate machine PPH and efficiency
      const machineHours = machineTotalWorkedMs / 3600000;
      const machinePph = machineHours > 0 ? machineTotalCounts / machineHours : 0;
      
      // Calculate prorated standard (weighted average)
      let proratedStandard = 0;
      for (const item of machineItems) {
        if (machineTotalCounts > 0 && item.totalCounts > 0) {
          const weight = item.totalCounts / machineTotalCounts;
          proratedStandard += weight * (item.itemStandard || 0);
        }
      }
      const machineEfficiency = proratedStandard > 0 ? machinePph / proratedStandard : 0;
      
      // Build itemSummaries object with Total first, then individual items
      const itemSummaries = {};
      
      // Add Total entry first (top row)
      itemSummaries['Total'] = {
        name: 'Total',
        standard: Math.round(proratedStandard * 100) / 100,
        countTotal: machineTotalCounts,
        workedTimeFormatted: formatDuration(machineTotalWorkedMs),
        pph: Math.round(machinePph * 100) / 100,
        efficiency: Math.round(machineEfficiency * 10000) / 100,
      };
      
      // Add individual item entries
      for (const item of machineItems) {
        if (item.totalCounts === 0) continue; // Skip items with zero counts
        
        const itemHours = item.workedTimeMs / 3600000;
        const itemPph = itemHours > 0 ? item.totalCounts / itemHours : 0;
        const itemEfficiency = (item.itemStandard || 0) > 0 ? itemPph / item.itemStandard : 0;
        
        itemSummaries[item.itemId] = {
          name: item.itemName,
          standard: item.itemStandard || 0,
          countTotal: item.totalCounts,
          workedTimeFormatted: formatDuration(item.workedTimeMs),
          pph: Math.round(itemPph * 100) / 100,
          efficiency: Math.round(itemEfficiency * 10000) / 100,
        };
      }
      
      // Final validation: cap to query window
      const queryWindowMs = exactEnd.getTime() - exactStart.getTime();
      let validatedRuntimeMs = machineTotalRuntimeMs;
      let validatedWorkedMs = machineTotalWorkedMs;
      
      if (validatedRuntimeMs > queryWindowMs) {
        validatedRuntimeMs = queryWindowMs;
      }
      if (validatedWorkedMs > queryWindowMs) {
        validatedWorkedMs = queryWindowMs;
      }
      
      results.push({
        machine: {
          name: machineData.machineName,
          serial: machineData.machineSerial
        },
        sessions: [], // Empty array - no individual session details in cached version
        machineSummary: {
          totalCount: machineTotalCounts,
          workedTimeMs: validatedWorkedMs,
          workedTimeFormatted: formatDuration(validatedWorkedMs),
          runtimeMs: validatedRuntimeMs,
          runtimeFormatted: formatDuration(validatedRuntimeMs),
          pph: Math.round(machinePph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(machineEfficiency * 10000) / 100,
          itemSummaries,
        },
      });
    }
    
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,
    });
  } catch (error) {
    console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to generate simplified cached machine item summary" });
  }
});



// // FROM ITEMSESSIONS.JS

// // ---- /api/alpha/analytics/items-summary-daily-cached ----
// router.get("/analytics/items-summary-daily-cached", async (req, res) => {
//   try {
//     const { start, end, itemId } = parseAndValidateQueryParams(req);
    
//     // Get today's date string in Chicago timezone
//     const today = new Date();
//     const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
//     const dateStr = chicagoTime.toISOString().split('T')[0];
    
//     logger.info(`[itemSessions] Fetching daily cached items summary for date: ${dateStr}, itemId: ${itemId || 'all'}`);
    
//     // Build query filter for totals-daily collection
//     const filter = { 
//       entityType: 'machine-item',
//       date: dateStr
//     };
    
//     // Add item filter if specified
//     if (itemId) {
//       filter.itemId = parseInt(itemId);
//     }
    
//     // Query the totals-daily collection
//     const cacheRecords = await db.collection('totals-daily')
//       .find(filter)
//       .toArray();
    
//     if (cacheRecords.length === 0) {
//       logger.warn(`[itemSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`);
//       // Fallback to real-time calculation (items-summary route)
//       return res.json([]);
//     }
    
//     // Helper function to normalize PPH standards
//     const normalizePPH = (std) => {
//       const n = Number(std) || 0;
//       return n > 0 && n < 60 ? n * 60 : n; // PPM → PPH
//     };
    
//     // Group by item ID and aggregate metrics across machines
//     const itemMap = new Map();
    
//     for (const record of cacheRecords) {
//       const itmId = record.itemId;
      
//       if (!itemMap.has(itmId)) {
//         itemMap.set(itmId, {
//           itemId: record.itemId,
//           itemName: record.itemName,
//           standardRaw: record.itemStandard || 0,
//           count: 0,
//           workedSec: 0
//         });
//       }
      
//       const itemData = itemMap.get(itmId);
      
//       // Aggregate counts and worked time across all machines
//       itemData.count += record.totalCounts;
//       itemData.workedSec += (record.workedTimeMs / 1000);
      
//       // Update standard if not set
//       if (!itemData.standardRaw && record.itemStandard) {
//         itemData.standardRaw = record.itemStandard;
//       }
//     }
    
//     // Transform to expected format
//     const results = Array.from(itemMap.values()).map((entry) => {
//       const workedMs = Math.round(entry.workedSec * 1000);
//       const hours = workedMs / 3_600_000;
//       const pph = hours > 0 ? entry.count / hours : 0;
//       const stdPPH = normalizePPH(entry.standardRaw);
//       const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

//       return {
//         itemId: entry.itemId,
//         itemName: entry.itemName,
//         workedTimeFormatted: formatDuration(workedMs),
//         count: entry.count,
//         pph: Math.round(pph * 100) / 100,
//         standard: entry.standardRaw ?? 0,
//         efficiency: Math.round(efficiencyPct * 100) / 100,
//       };
//     });
    
//     logger.info(`[itemSessions] Retrieved ${results.length} daily cached item records for date: ${dateStr}`);
//     res.json(results);
    
//   } catch (err) {
//     logger.error(`[itemSessions] Error in daily cached items-summary route:`, err);
    
//     // Check if it's a validation error
//     if (err.message && (err.message.includes('Start and end dates are required') ||
//       err.message.includes('Invalid date format') ||
//       err.message.includes('Start date must be before end date'))) {
//       return res.status(400).json({ error: err.message });
//     }
    
//     // Return empty array on error (consistent with real-time route behavior)
//     logger.info(`[itemSessions] Returning empty array due to error`);
//     res.json([]);
//   }
// });

// // /analytics/item-dashboard-summary — sessions-based, using item-sessions and bookending helper
// router.get("/analytics/items-summary", async (req, res) => {
//   try {
//     const { start, end } = parseAndValidateQueryParams(req);

//     // 1) Same as old route: iterate active machines only, use bookending helper per serial
//     const machineSerials = await db
//       .collection(config.machineCollectionName || "machine")
//       .distinct("serial", { active: true });
//     const resultsMap = new Map();
//     const now = new Date();
//     const itemSessColl = db.collection(config.itemSessionCollectionName || "item-session");

//     const normalizePPH = (std) => {
//       const n = Number(std) || 0;
//       return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
//     };

//     for (const serial of machineSerials) {
//       const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
//       if (!bookended) continue;

//       const { sessionStart, sessionEnd } = bookended;

//       // 2) Pull item-sessions overlapping the bookended window for this machine
//       const sessions = await itemSessColl
//         .find({
//           "machine.serial": Number(serial),
//           "timestamps.start": { $lt: sessionEnd },
//           $or: [
//             { "timestamps.end": { $gt: sessionStart } },
//             { "timestamps.end": { $exists: false } },
//             { "timestamps.end": null },
//           ],
//         })
//         .project({
//           _id: 0,
//           item: 1, // { id, name, standard } (preferred)
//           items: 1, // single-item legacy fallback
//           counts: 1, // [{timestamp,...}] optional
//           totalCount: 1, // optional rollup
//           workTime: 1, // seconds (preferred)
//           runtime: 1, // seconds (fallback)
//           activeStations: 1,
//           operators: 1,
//           timestamps: 1, // nested doc with start/end
//         })
//         .toArray();

//       if (!sessions.length) continue;

//       for (const s of sessions) {
//         // 3) Resolve single item from session
//         const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
//         if (!itm || itm.id == null) continue;

//         // 4) Truncate to bookended window
//         const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
//         const sessEnd = new Date(s.timestamps?.end || now);
//         if (!sessStart || Number.isNaN(sessStart.getTime())) continue;
//         if (!sessEnd || Number.isNaN(sessEnd.getTime())) continue;
//         const ovStart = sessStart > sessionStart ? sessStart : sessionStart;
//         const ovEnd = sessEnd < sessionEnd ? sessEnd : sessionEnd;
//         if (!(ovEnd > ovStart)) continue;

//         const sessSec = Math.max(0, (sessEnd - sessStart) / 1000);
//         const ovSec = Math.max(0, (ovEnd - ovStart) / 1000);
//         if (sessSec === 0 || ovSec === 0) continue;

//         // 5) Worked time seconds (prefer workTime; else runtime * stations), prorated to overlap
//         const stations =
//           typeof s.activeStations === "number"
//             ? s.activeStations
//             : (Array.isArray(s.operators) ? s.operators.length : 0);
//         const baseWorkSec = typeof s.workTime === "number"
//           ? s.workTime
//           : typeof s.runtime === "number"
//             ? s.runtime * Math.max(1, stations)
//             : 0;
//         const workedSec = baseWorkSec > 0 ? baseWorkSec * (ovSec / sessSec) : 0;

//         // 6) Counts within overlap: use counts[] if present; else prorate totalCount
//         let countInWin = 0;
//         if (Array.isArray(s.counts) && s.counts.length) {
//           if (s.counts.length > 50000) {
//             // large array: fall back to prorating by overlap fraction
//             countInWin = typeof s.totalCount === "number" ? Math.round(s.totalCount * (ovSec / sessSec)) : 0;
//           } else {
//             countInWin = s.counts.reduce((acc, c) => {
//               const t = new Date(c.timestamp);
//               // (defensive) ensure item matches if present
//               const sameItem = !c.item?.id || c.item.id === itm.id;
//               return acc + (sameItem && t >= ovStart && t <= ovEnd ? 1 : 0);
//             }, 0);
//           }
//         } else if (typeof s.totalCount === "number") {
//           countInWin = Math.round(s.totalCount * (ovSec / sessSec));
//         }

//         // 7) Aggregate by itemId
//         const key = String(itm.id);
//         if (!resultsMap.has(key)) {
//           resultsMap.set(key, {
//             itemId: itm.id,
//             itemName: itm.name || "Unknown",
//             standardRaw: itm.standard ?? 0,
//             count: 0,
//             workedSec: 0,
//           });
//         }
//         const acc = resultsMap.get(key);
//         acc.count += countInWin;
//         acc.workedSec += workedSec;
//         if (!acc.itemName && itm.name) acc.itemName = itm.name;
//         if (!acc.standardRaw && itm.standard != null) acc.standardRaw = itm.standard;
//       }
//     }

//     // 8) Finalize metrics (same math as before)
//     const results = Array.from(resultsMap.values()).map((entry) => {
//       const workedMs = Math.round(entry.workedSec * 1000);
//       const hours = workedMs / 3_600_000;
//       const pph = hours > 0 ? entry.count / hours : 0;
//       const stdPPH = normalizePPH(entry.standardRaw);
//       const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

//       return {
//         itemId: entry.itemId,
//         itemName: entry.itemName,
//         workedTimeFormatted: formatDuration(workedMs),
//         count: entry.count,
//         pph: Math.round(pph * 100) / 100,
//         standard: entry.standardRaw ?? 0,
//         efficiency: Math.round(efficiencyPct * 100) / 100,
//       };
//     });

//     res.json(results);
//   } catch (err) {
//     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//     res.status(500).json({ error: "Failed to generate item dashboard summary" });
//   }
// });


// // FROM EFFICIENCYSCREENSESSIONROUTE.JS

// router.get('/analytics/machine-live-session-summary', async (req, res) => {
//   const routeStartTime = Date.now();
  
//   try {
//     const { serial, date } = req.query;
//     if (!serial || !date) {
//       return res.status(400).json({ error: 'Missing serial or date' });
//     }

//     const serialNum = Number(serial);
//     console.log(`[PERF] [${serialNum}] Route START - machine-live-session-summary`);
//     console.log(`[PERF] [${serialNum}] Fetching ticker...`);
//     const tickerStartTime = Date.now();
    
//     const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
//       .findOne(
//         { 'machine.id': serialNum },
//         {
//           projection: {
//             timestamp: 1,
//             machine: 1,
//             program: 1,
//             status: 1,
//             operators: 1
//           }
//         }
//       );
    
//     console.log(`[PERF] [${serialNum}] Ticker query completed in ${Date.now() - tickerStartTime}ms`);

//     // No ticker: Offline - but still return flipperData structure
//     if (!ticker) {
//       // Fetch machine configuration to get machine name
//       const machineConfig = await db.collection('machines').findOne(
//         { serial: serialNum },
//         { projection: { name: 1 } }
//       );

//       const machineName = machineConfig?.name || `Serial ${serialNum}`;

//       // Return a single offline lane entry for full-height display
//       const offlineLanes = [{
//         status: -1,
//         fault: 'Offline',
//         operator: null,
//         operatorId: null,
//         machine: machineName,
//         timers: { on: 0, ready: 0 },
//         displayTimers: { on: '', run: '' },
//         efficiency: buildZeroEfficiencyPayload(),
//         oee: {},
//         batch: { item: '', code: 0 }
//       }];

//       return res.json({ flipperData: offlineLanes });
//     }

//     // Build list of active operators from ticker (skip dummies; preserve existing station 2 skip for 67801/67802)
//     const onMachineOperators = (Array.isArray(ticker.operators) ? ticker.operators : [])
//       .filter(op => op && op.id !== -1)
//       .filter(op => !([67801, 67802].includes(serialNum) && op.station === 2));
    
//     // Status schema uses 'id', but legacy code used 'code' - support both
//     const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
//     console.log(`[PERF] [${serialNum}] Found ${onMachineOperators.length} operators. Status code: ${statusCode}`);

//     // If machine is NOT running, mirror existing route behavior by returning entries with 0% efficiency
//     // (we still include operator/machine/batch info for the screen to render cleanly)
//     if (statusCode !== 1) {
//       console.log(`[PERF] [${serialNum}] Machine NOT running - processing ${onMachineOperators.length} operators (non-running path)`);
//       const notRunningStartTime = Date.now();
//       const coll = db.collection(config.operatorSessionCollectionName);
//       const machineFilter = { $or: [{ 'machine.serial': serialNum }, { 'machine.id': serialNum }] };

//       const performanceData = await Promise.all(
//         onMachineOperators.map(async (op, idx) => {
//           // Elapsed from session start (machines may not emit ticker when paused/faulted)
//           const session =
//             (await coll.findOne(
//               { 'operator.id': op.id, ...machineFilter, 'timestamps.end': { $exists: false } },
//               { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
//             )) ||
//             (await coll.findOne(
//               { 'operator.id': op.id, ...machineFilter },
//               { sort: { 'timestamps.start': -1 }, projection: { timestamps: 1, items: 1 } }
//             ));
//           const sessionStart = session?.timestamps?.start;
//           const startDate = sessionStart ? (sessionStart instanceof Date ? sessionStart : new Date(sessionStart)) : null;
//           const elapsedInStateSec = startDate
//             ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000))
//             : 0;
//           const elapsedDisplay = formatElapsedDisplay(elapsedInStateSec);

//           const batchItem = (session?.items || [])
//             .map(it => it?.name)
//             .filter(Boolean);
//           const batchItemStr = [...new Set(batchItem)].join(' + ');

//           const operatorName = op.name?.first && op.name?.surname
//             ? `${op.name.first} ${op.name.surname}`
//             : (op.name || 'Unknown');
//           return {
//             status: ticker.status?.code ?? 0,
//             fault: ticker.status?.name ?? 'Unknown',
//             operator: operatorName,
//             operatorId: op.id,
//             machine: ticker.machine?.name || `Serial ${serialNum}`,
//             timers: { on: elapsedInStateSec, ready: 0 },
//             displayTimers: { on: elapsedDisplay, run: elapsedDisplay },
//             efficiency: buildZeroEfficiencyPayload(),
//             // keep the field to match the existing response shape; values not required in the new flow
//             oee: {},
//             batch: { item: batchItemStr, code: 10000001 }
//           };
//         })
//       );

//       console.log(`[PERF] [${serialNum}] Non-running path completed in ${Date.now() - notRunningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
//       // Back-compat: preserve existing top-level shape/key
//       return res.json({ flipperData: performanceData });
//     }

//     // Running: compute performance from operator-sessions over four windows
//     console.log(`[PERF] [${serialNum}] Machine RUNNING - processing ${onMachineOperators.length} operators`);
//     const runningStartTime = Date.now();
    
//     const now = DateTime.now();
//     const frames = {
//       lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//       lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//       lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//       today: { start: now.startOf('day'), label: 'All Day' }
//     };

//     const performanceData = await Promise.all(
//       onMachineOperators.map(async (op, idx) => {
//         const operatorStartTime = Date.now();
//         console.log(`[PERF] [${serialNum}] Starting operator ${op.id} (${idx + 1}/${onMachineOperators.length})`);
        
//         // Run the four timeframe queries in parallel
//         const timeframeQueryStartTime = Date.now();
//         const results = await queryOperatorTimeframes(db, serialNum, op.id, frames, logger);
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} timeframe queries completed in ${Date.now() - timeframeQueryStartTime}ms`);

//         // Debug: Log session counts
//         console.log(`[PERF] [${serialNum}] Operator ${op.id}: sessions - 6min=${results.lastSixMinutes.length}, 15min=${results.lastFifteenMinutes.length}, 1hr=${results.lastHour.length}, today=${results.today.length}`);

//         // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
//         const hasEmpty = Object.values(results).some(arr => arr.length === 0);

//         if (hasEmpty) {
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} has empty timeframes - fetching open session`);
//           const openSessionStartTime = Date.now();
          
//           // Try both machine.serial and machine.id
//           const open = await db.collection(config.operatorSessionCollectionName)
//             .findOne(
//               {
//                 'operator.id': op.id,
//                 $or: [
//                   { 'machine.serial': serialNum },
//                   { 'machine.id': serialNum }
//                 ],
//                 'timestamps.end': { $exists: false }
//               },
//               { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
//             );
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} open session query completed in ${Date.now() - openSessionStartTime}ms`);
          
//           if (open) {
//             for (const k of Object.keys(results)) results[k] = [open];
//           }
//         }

//         // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} starting efficiency calculations for 4 timeframes`);
//         const efficiencyCalcStartTime = Date.now();
//         const efficiencyObj = {};
        
//         for (const [key, arr] of Object.entries(results)) {
//           const windowStartTime = Date.now();
//           const { start, label } = frames[key];
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} processing window: ${key}`);
          
//           // Extract counts from embedded session counts instead of querying count collection
//           const windowStart = new Date(start.toISO());
//           const windowEnd = new Date(now.toISO());
          
//           const countExtractStartTime = Date.now();
//           const counts = extractCountsFromSessions(arr, windowStart, windowEnd, op.id, serialNum);
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - extracted ${counts.length} counts from sessions in ${Date.now() - countExtractStartTime}ms`);
          
//           const sumWindowStartTime = Date.now();
//           const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
//           const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} - sumWindowWithCounts completed in ${Date.now() - sumWindowStartTime}ms (runtime=${runtimeSec}s, timeCredit=${totalTimeCreditSec}s, eff=${Math.round(eff * 100)}%)`);
          
//           efficiencyObj[key] = {
//             value: Math.round(eff * 100),
//             label,
//             color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
//           };
          
//           console.log(`[PERF] [${serialNum}] Operator ${op.id} window ${key} TOTAL time: ${Date.now() - windowStartTime}ms`);
//         }
        
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} efficiency calculations completed in ${Date.now() - efficiencyCalcStartTime}ms`);

//         // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
//         const batchItemStartTime = Date.now();
//         const batchItem = await resolveBatchItemFromSessions(db, serialNum, op.id);
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} batch item resolved in ${Date.now() - batchItemStartTime}ms`);
        
//         const operatorTotalTime = Date.now() - operatorStartTime;
//         console.log(`[PERF] [${serialNum}] Operator ${op.id} COMPLETED - Total time: ${operatorTotalTime}ms`);

//         const operatorName = op.name?.first && op.name?.surname
//           ? `${op.name.first} ${op.name.surname}`
//           : (op.name || 'Unknown');

//         // Status schema uses 'id', but legacy code used 'code' - support both
//         const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
//         return {
//           status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
//           fault: ticker.status?.name ?? 'Unknown',
//           operator: operatorName,
//           operatorId: op.id,
//           machine: ticker.machine?.name || `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: efficiencyObj,
//           // keep the field to match the existing response shape; not required for the new flow
//           oee: {},
//           batch: { item: batchItem, code: 10000001 }
//         };
//       })
//     );

//     console.log(`[PERF] [${serialNum}] Running path completed in ${Date.now() - runningStartTime}ms. Total route time: ${Date.now() - routeStartTime}ms`);
    
//     // Back-compat: preserve existing top-level shape/key
//     return res.json({ flipperData: performanceData });
//   } catch (err) {
//     console.error(`[PERF] [${serialNum || 'unknown'}] ERROR after ${Date.now() - routeStartTime}ms:`, err);
//     logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
//   });

//   router.get('/machines/spf', async (req, res) => {
//     try {
//       const machines = await db.collection('machines')
//         .find({
//           $or: [
//             { name: { $regex: /^SPF/i } },
//             { type: 'SPF' }
//           ],
//           active: { $ne: false }
//         })
//         .project({ serial: 1, name: 1, active: 1 })
//         .sort({ name: 1 })
//         .toArray();
      
//       return res.json(machines);
//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//   });

//   // --- Operator Efficiency API (for cm-operator-efficiency component) ---

//   router.get('/analytics/machine-live-session-summary/operator', async (req, res) => {
//     try {
//       const { serial, station } = req.query;
//       if (!serial || !station) {
//         return res.status(400).json({ error: 'Missing serial or station' });
//       }

//       const serialNum = Number(serial);
//       const stationNum = Number(station);

//       // Get machine ticker to find operator at specified station
//       const ticker = await db.collection(config.stateTickerCollectionName || 'stateTicker')
//         .findOne(
//           { 'machine.id': serialNum },
//           {
//             projection: {
//               timestamp: 1,
//               machine: 1,
//               program: 1,
//               status: 1,
//               operators: 1
//             }
//           }
//         );

//       // No ticker: Machine offline
//       if (!ticker) {
//         return res.json({
//           status: { code: -1, name: 'Offline' },
//           fault: 'Offline',
//           operator: null,
//           machine: `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: buildZeroEfficiencyPayload(),
//           oee: {},
//           batch: { item: '', code: 10000001 }
//         });
//       }

//       // Check for blocked station (67801/67802 station 2 skip)
//       const blockedStation =
//         [67801, 67802].includes(serialNum) && stationNum === 2;

//       const operator = (Array.isArray(ticker.operators) ? ticker.operators : [])
//         .find(op => op && op.station === stationNum);

//       const hasOperator = !!operator && operator.id !== -1 && !blockedStation;

//       // No operator at station (or blocked station)
//       if (!hasOperator) {
//         // Status schema uses 'id', but legacy code used 'code' - support both
//         const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
//         // If not running: zeros like legacy behavior
//         if (statusCode !== 1) {
//           return res.json({
//             status: statusCode, // Use 'code' in API response for backward compatibility
//             fault: ticker.status?.name ?? 'Unknown',
//             operator: null,
//             machine: ticker.machine?.name || `Serial ${serialNum}`,
//             timers: { on: 0, ready: 0 },
//             displayTimers: { on: '', run: '' },
//             efficiency: buildZeroEfficiencyPayload(),
//             oee: {},
//             batch: { item: '', code: 10000001 }
//           });
//         }

//         // Running: compute efficiency from MACHINE sessions for this window set
//         const now = DateTime.now();
//         const frames = {
//           lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//           lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//           lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//           today: { start: now.startOf('day'), label: 'All Day' }
//         };

//         const results = await queryMachineTimeframes(db, serialNum, frames);

//         // Fallback: if any frame empty, reuse most recent open machine session for all
//         if (Object.values(results).some(arr => arr.length === 0)) {
//           const open = await db.collection(config.machineSessionCollectionName || 'machine-session')
//             .findOne(
//               {
//                 $or: [
//                   { 'machine.id': serialNum },
//                   { 'machine.serial': serialNum }
//                 ],
//                 'timestamps.end': { $exists: false }
//               },
//               { sort: { 'timestamps.start': -1 }, projection: projectMachineForPerf() }
//             );
//           if (open) for (const k of Object.keys(results)) results[k] = [open];
//         }

//         const effObj = {};
//         for (const [key, arr] of Object.entries(results)) {
//           const { start, label } = frames[key];
//           const { runtimeSec, timeCreditSec } = sumWindowMachine(arr, start, now);
//           const eff = runtimeSec > 0 ? Math.round((timeCreditSec / runtimeSec) * 100) : 0;
//           effObj[key] = { value: eff, label, color: eff >= 90 ? 'green' : eff >= 70 ? 'orange' : 'yellow' };
//         }

//         // Status schema uses 'id', but legacy code used 'code' - support both
//         const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
//         return res.json({
//           status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
//           fault: ticker.status?.name ?? 'Unknown',
//           operator: null,
//           machine: ticker.machine?.name || `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: effObj,
//           oee: {},
//           batch: { item: '', code: 10000001 }
//         });
//       }

//       // Status schema uses 'id', but legacy code used 'code' - support both
//       const statusCode = ticker.status?.id ?? ticker.status?.code ?? 0;
//       // If machine is NOT running, return zero efficiency but keep operator info
//       if (statusCode !== 1) {
//         const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);
//         const operatorName = operator.name?.first && operator.name?.surname
//           ? `${operator.name.first} ${operator.name.surname}`
//           : (operator.name || 'Unknown');
//         return res.json({
//           status: statusCode, // Use 'code' in API response for backward compatibility
//           fault: ticker.status?.name ?? 'Unknown',
//           operator: operatorName,
//           operatorId: operator.id,
//           machine: ticker.machine?.name || `Serial ${serialNum}`,
//           timers: { on: 0, ready: 0 },
//           displayTimers: { on: '', run: '' },
//           efficiency: buildZeroEfficiencyPayload(),
//           oee: {},
//           batch: { item: batchItem, code: 10000001 }
//         });
//       }

//       // Running: compute performance from operator-sessions over four windows
//       const now = DateTime.now();
//       const frames = {
//         lastSixMinutes: { start: now.minus({ minutes: 6 }), label: 'Last 6 Mins' },
//         lastFifteenMinutes: { start: now.minus({ minutes: 15 }), label: 'Last 15 Mins' },
//         lastHour: { start: now.minus({ hours: 1 }), label: 'Last Hour' },
//         today: { start: now.startOf('day'), label: 'All Day' }
//       };

//       // Run the four timeframe queries in parallel
//       const results = await queryOperatorTimeframes(db, serialNum, operator.id, frames, logger);

//       // If ANY timeframe came back empty, fetch most recent OPEN session and use it for all frames
//       if (Object.values(results).some(arr => arr.length === 0)) {
//         // Try both machine.serial and machine.id
//         const open = await db.collection(config.operatorSessionCollectionName)
//           .findOne(
//             {
//               'operator.id': operator.id,
//               $or: [
//                 { 'machine.serial': serialNum },
//                 { 'machine.id': serialNum }
//               ],
//               'timestamps.end': { $exists: false }
//             },
//             { sort: { 'timestamps.start': -1 }, projection: projectSessionForPerf() }
//           );
//         if (open) {
//           for (const k of Object.keys(results)) results[k] = [open];
//         }
//       }

//       // Compute efficiency% per timeframe from sessions (truncate overlap at frame start)
//       const efficiencyObj = {};
//       for (const [key, arr] of Object.entries(results)) {
//         const { start, label } = frames[key];
//         // Extract counts from embedded session counts instead of querying count collection
//         const windowStart = new Date(start.toISO());
//         const windowEnd = new Date(now.toISO());
//         const counts = extractCountsFromSessions(arr, windowStart, windowEnd, operator.id, serialNum);
        
//         const { runtimeSec, totalTimeCreditSec } = sumWindowWithCounts(arr, counts, start, now);
//         const eff = runtimeSec > 0 ? totalTimeCreditSec / runtimeSec : 0;
//         efficiencyObj[key] = {
//           value: Math.round(eff * 100),
//           label,
//           color: eff >= 0.9 ? 'green' : eff >= 0.7 ? 'orange' : 'yellow'
//         };
//       }

//       // Batch item: concatenate current items if multiple (prefer the most recent session; fallback to union)
//       const batchItem = await resolveBatchItemFromSessions(db, serialNum, operator.id);

//       const operatorName = operator.name?.first && operator.name?.surname
//         ? `${operator.name.first} ${operator.name.surname}`
//         : (operator.name || 'Unknown');

//       // Status schema uses 'id', but legacy code used 'code' - support both
//       const statusCodeForResponse = ticker.status?.id ?? ticker.status?.code ?? 0;
//       return res.json({
//         status: statusCodeForResponse, // Use 'code' in API response for backward compatibility
//         fault: ticker.status?.name ?? 'Unknown',
//         operator: operatorName,
//         operatorId: operator.id,
//         machine: ticker.machine?.name || `Serial ${serialNum}`,
//         timers: { on: 0, ready: 0 },
//         displayTimers: { on: '', run: '' },
//         efficiency: efficiencyObj,
//         oee: {},
//         batch: { item: batchItem, code: 10000001 }
//       });

//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//   });

//   // FROM DAILYDASHBOARDSESSIONROUTESSPLIT.JS

//   // ---- INDIVIDUAL ROUTES ----

//   // Route 1: Machine Status Breakdowns
//   router.get('/analytics/daily/machine-status', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const machineStatus = await buildDailyMachineStatusFromSessions(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         machineStatus
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch machine status data" });
//     }
//   });

//   // Route 3: Item Hourly Production Data
//   router.get('/analytics/daily/item-hourly-production', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const itemHourlyStack = await buildDailyItemHourlyStack(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         itemHourlyStack
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch item hourly production data" });
//     }
//   });

//   // Route 3B: Item Hourly Production Data (Fast - using hourly-totals cache)
//   router.get('/analytics/hourly/item-hourly-production', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const itemHourlyStack = await buildItemHourlyStackFromCache(db, dayStart, dayEnd, logger);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         itemHourlyStack
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch item hourly production data from cache" });
//     }
//   });

//   // Route 4: Top Operator Rankings
//   router.get('/analytics/daily/top-operators', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();
//       const dayEnd = now.toJSDate();

//       const topOperators = await buildTopOperatorEfficiencyFromSessions(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         topOperators
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch top operator data" });
//     }
//   });

//   // Route 4C: Top 10 Faults (plantwide, by fault code)
//   router.get('/analytics/daily/top-faults', async (req, res) => {
//     try {
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const fsColl = db.collection(config.faultSessionCollectionName);
//       const topFaults = await fsColl
//         .aggregate([
//           {
//             $match: {
//               "timestamps.start": { $lt: dayEnd },
//               $or: [
//                 { "timestamps.end": { $gte: dayStart } },
//                 { "timestamps.end": { $exists: false } },
//                 { "timestamps.end": null }
//               ]
//             }
//           },
//           {
//             $project: {
//               code: {
//                 $ifNull: [
//                   "$states.start.status.id",
//                   { $ifNull: ["$states.start.status.code", "$startState.status.code"] }
//                 ]
//               },
//               name: {
//                 $ifNull: [
//                   "$states.start.status.name",
//                   { $ifNull: ["$startState.status.name", "Fault"] }
//                 ]
//               }
//             }
//           },
//           { $match: { code: { $ne: null } } },
//           {
//             $group: {
//               _id: "$code",
//               name: { $first: "$name" },
//               count: { $sum: 1 }
//             }
//           },
//           { $sort: { count: -1 } },
//           { $limit: 10 },
//           {
//             $project: {
//               _id: 0,
//               code: "$_id",
//               name: 1,
//               count: 1
//             }
//           }
//         ])
//         .toArray();

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         topFaults
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch top faults data" });
//     }
//   });

//   // Route 5: Plant-wide Metrics
//   router.get('/analytics/daily/plantwide-metrics', async (req, res) => {
//     try {
//       // Parse query parameters, with fallback to today if not provided
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         // If query params are invalid or missing, default to today
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const plantwideMetrics = await buildPlantwideMetricsByHour(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         plantwideMetrics
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch plant-wide metrics data" });
//     }
//   }); 

//   // Route 5B: Plant-wide Metrics (Fast - using daily totals cache)
//   router.get('/analytics/daily/plantwide-metrics-cache', async (req, res) => {
//     try {
//       // Parse query parameters, with fallback to today if not provided
//       let dayStart, dayEnd;
//       try {
//         const { start, end } = parseAndValidateQueryParams(req);
//         dayStart = new Date(start);
//         dayEnd = new Date(end);
//       } catch (error) {
//         // If query params are invalid or missing, default to today
//         const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//         dayStart = now.startOf('day').toJSDate();
//         dayEnd = now.toJSDate();
//       }

//       const plantwideMetrics = await buildPlantwideMetricsByHourFromCache(db, dayStart, dayEnd);

//       return res.json({
//         timeRange: { start: dayStart, end: dayEnd, total: formatDuration(dayEnd - dayStart) },
//         plantwideMetrics
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch fast plant-wide metrics data" });
//     }
//   });

//   // Route 6: Daily Count Totals
//   router.get('/analytics/daily/count-totals', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayEnd = now.toJSDate();

//       const dailyCounts = await buildDailyCountTotals(db, null, dayEnd);

//       return res.json({
//         timeRange: { end: dayEnd },
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch daily count totals data" });
//     }
//   });

//   // Diagnostic route to check state collections
//   router.get('/analytics/daily/debug-collections', async (req, res) => {
//     try {
//       const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
//       const dayStart = now.startOf('day').toJSDate();

//       // List all collections
//       const collections = await db.listCollections().toArray();
//       const stateCollections = collections.filter(c => c.name.includes('state'));

//       // Count documents in each state collection for today
//       const counts = {};
//       for (const coll of stateCollections) {
//         const count = await db.collection(coll.name).countDocuments({
//           timestamp: { $gte: dayStart }
//         });
//         counts[coll.name] = count;
//       }

//       // Get a sample document from state-machine-daily if it exists
//       let sampleDoc = null;
//       if (collections.find(c => c.name === 'state-machine-daily')) {
//         sampleDoc = await db.collection('state-machine-daily').findOne({
//           timestamp: { $gte: dayStart }
//         });
//       }

//       return res.json({
//         allStateCollections: stateCollections.map(c => c.name),
//         documentCounts: counts,
//         sampleDocument: sampleDoc,
//         queryDate: dayStart
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch debug info" });
//     }
//   });

//   // Legacy sessions-based daily dashboard helpers/routes removed

//   // FROM DAILYDASHBOARDROUTES.JS

//   router.get('/analytics/daily-dashboard/full', async (req, res) => {
//     try {
//       const { start, end } = parseAndValidateQueryParams(req);
  
//       const [
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       ] = await Promise.all([
//         buildDailyMachineStatus(db, start, end),
//         buildMachineOEE(db, start, end),
//         buildDailyItemHourlyStack(db, start, end),
//         buildTopOperatorEfficiency(db, start, end),
//         buildPlantwideMetricsByHour(db, start, end),
//         buildDailyCountTotals(db, start, end)
//       ]);
  
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch full daily dashboard data" });
//     }
//   });

//   router.get('/analytics/daily-dashboard/full/new', async (req, res) => {
//     try {
//       // Validate database connection
//       if (!db) {
//         return res.status(500).json({ 
//           error: "Database connection not available",
//           details: "Server configuration error"
//         });
//       }

//       const { start, end } = parseAndValidateQueryParams(req);
//       const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
      
//       const TZ = "America/Chicago";
  
//       // Simplified aggregation pipeline for states - using basic operations for compatibility
//       const statesAgg = [
//         {$match: { timestamp: {$gte: paddedStart, $lte: paddedEnd} }},
//         {$set: {
//           code: "$status.code",
//           serial: "$machine.serial",
//           machineName: "$machine.name"
//         }},
//         // Group by machine and status to get status counts
//         {$group: {
//           _id: { 
//             serial: "$serial", 
//             code: "$code",
//             machineName: "$machineName"
//           },
//           count: { $sum: 1 }
//         }},
//         // Calculate status buckets
//         {$set: {
//           bucket: {
//             $switch: {
//               branches: [
//                 { case: { $eq: ["$_id.code", 1] }, then: "running" },
//                 { case: { $eq: ["$_id.code", 0] }, then: "paused" }
//               ],
//               default: "fault"
//             }
//           }
//         }},
//         // Group by machine to get status totals
//         {$group: {
//           _id: "$_id.serial",
//           machineName: { $first: "$_id.machineName" },
//           runningCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "running"] },
//                 "$count",
//                 0
//               ]
//             }
//           },
//           pausedCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "paused"] },
//                 "$count",
//                 0
//               ]
//             }
//           },
//           faultCount: {
//             $sum: {
//               $cond: [
//                 { $eq: ["$bucket", "fault"] },
//                 "$count",
//                 0
//               ]
//             }
//           }
//         }},
//         // Convert counts to milliseconds (simplified approach)
//         {$set: {
//           runningMs: { $multiply: ["$runningCount", 60000] }, // 1 minute per count as proxy
//           pausedMs: { $multiply: ["$pausedCount", 60000] },
//           faultedMs: { $multiply: ["$faultCount", 60000] }
//         }},
//         {$project: {
//           _id: 0,
//           serial: "$_id",
//           name: { $ifNull: ["$machineName", "Unknown"] },
//           runningMs: 1,
//           pausedMs: 1,
//           faultedMs: 1
//         }}
//       ];

//       // Simplified aggregation pipeline for counts
//       const countsAgg = [
//         {$match: {
//           timestamp: {$gte: start, $lte: end},
//           misfeed: { $ne: true },
//           'operator.id': { $exists: true, $ne: -1 }
//         }},
//         {$set: {
//           itemName: { $ifNull: ["$item.name", "Unknown"] },
//           hour: { $hour: { date: "$timestamp", timezone: TZ } },
//           day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
//           serial: "$machine.serial",
//           operatorId: "$operator.id",
//           operatorName: "$operator.name"
//         }},
//         {$facet: {
//           // Item hourly stack
//           itemHourlyStackRaw: [
//             {$group: { 
//               _id: { item: "$itemName", hour: "$hour" }, 
//               count: { $sum: 1 } 
//             }},
//             {$sort: { "_id.item": 1, "_id.hour": 1 }}
//           ],
      
//           // Daily count totals (last 28 days)
//           last28Days: [
//             {$group: { _id: "$day", count: { $sum: 1 } }},
//             {$sort: { "_id": 1 }},
//             {$project: { _id: 0, date: "$_id", count: 1 }}
//           ],
      
//           // Operator counts
//           operatorCounts: [
//             {$group: {
//               _id: "$operatorId",
//               name: { $first: "$operatorName" },
//               validCount: { $sum: 1 }
//             }},
//             {$project: { _id: 0, id: "$_id", name: { $ifNull: ["$name", "Unknown"] }, validCount: 1 }}
//           ],
      
//           // Per-machine, per-hour counts
//           countsByMachineHour: [
//             {$group: {
//               _id: { serial: "$serial", hour: "$hour" },
//               valid: { $sum: 1 }
//             }},
//             {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", valid: 1 }}
//           ],
      
//           // Per-machine, per-hour misfeeds
//           misfeedsByMachineHour: [
//             {$match: { misfeed: true }},
//             {$set: { 
//               hour: { $hour: { date: "$timestamp", timezone: TZ } }, 
//               serial: "$machine.serial" 
//             }},
//             {$group: {
//               _id: { serial: "$serial", hour: "$hour" },
//               misfeed: { $sum: 1 }
//             }},
//             {$project: { _id: 0, serial: "$_id.serial", hour: "$_id.hour", misfeed: 1 }}
//           ]
//         }}
//       ];

//       // Execute aggregation queries with timeout
//       const aggregationOptions = { 
//         allowDiskUse: true,
//         maxTimeMS: 300000 // 5 minute timeout
//       };

//       logger.info(`Executing states aggregation for ${start} to ${end}`);
//       const [stateFacets] = await db.collection('state')
//         .aggregate(statesAgg, aggregationOptions)
//         .toArray();
      
//       logger.info(`Executing counts aggregation for ${start} to ${end}`);
//       const [countFacets] = await db.collection('count')
//         .aggregate(countsAgg, aggregationOptions)
//         .toArray();
  
//       // Validate aggregation results
//       if (!stateFacets || !countFacets) {
//         logger.error('Aggregation returned null results', { stateFacets, countFacets });
//         return res.status(500).json({ 
//           error: "Failed to retrieve data from database",
//           details: "Aggregation returned null results"
//         });
//       }

//       logger.info(`States aggregation returned ${stateFacets.length} results`);
//       logger.info(`Counts aggregation returned ${Object.keys(countFacets).length} facets`);

//       // Transform data to match expected formats
//       logger.info('Transforming machine status data...');
//       const machineStatus = stateFacets || [];
      
//       logger.info('Calculating machine OEE...');
//       const machineOee = (stateFacets || [])
//         .map(m => {
//           const totalRuntime = (m.runningMs || 0) + (m.pausedMs || 0) + (m.faultedMs || 0);
//           return {
//             serial: m.serial,
//             name: m.name,
//             oee: totalRuntime ? +((m.runningMs / totalRuntime) * 100).toFixed(2) : 0
//           };
//         })
//         .sort((a,b) => b.oee - a.oee);
  
//       logger.info('Building item hourly stack...');
//       const itemHourlyStack = reshapeItemHourly(countFacets.itemHourlyStackRaw || []);
  
//       logger.info('Building top operators...');
//       // Create operator runtime data from machine status (simplified approach)
//       const operatorRuntime = (countFacets.operatorCounts || []).map(op => ({
//         id: op.id,
//         name: op.name,
//         runtime: 0 // Simplified - would need actual state data for operators
//       }));
  
//       const topOperators = buildTopOperators(
//         operatorRuntime,
//         countFacets.operatorCounts || []
//       );
  
//       logger.info('Building plantwide metrics...');
//       // Create hourly runtime data for plantwide metrics
//       const hourlyRuntimeByMachine = (stateFacets || []).map(machine => {
//         const totalRuntime = (machine.runningMs || 0) + (machine.pausedMs || 0) + (machine.faultedMs || 0);
//         return {
//           serial: machine.serial,
//           hour: 0, // Default to hour 0 for now - would need actual hour data
//           runtimeMs: totalRuntime,
//           runMs: machine.runningMs || 0
//         };
//       });

//       // Use the proper helper function for plantwide metrics
//       const plantwideMetrics = buildPlantwideHourly(
//         hourlyRuntimeByMachine,
//         countFacets.countsByMachineHour || [],
//         countFacets.misfeedsByMachineHour || []
//       );
  
//       logger.info('Building daily counts...');
//       const dailyCounts = (countFacets.last28Days || []).map(d => ({
//         date: d.date,
//         count: d.count
//       }));

//       logger.info('Sending response...');
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         machineStatus,
//         machineOee,
//         itemHourlyStack,
//         topOperators,
//         plantwideMetrics,
//         dailyCounts
//       });
//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      
//       res.status(500).json({ 
//         error: "Failed to fetch full daily dashboard data",
//         details: process.env.NODE_ENV === 'development' ? err.message : undefined
//       });
//     }
//   });

//   router.get('/analytics/daily-dashboard/daily-counts', async (req, res) => {
//     try {
//       const { start, end } = parseAndValidateQueryParams(req);
//       const dailyCounts = await buildDailyCountTotals(db, start, end);
      
//       return res.json({
//         timeRange: { start, end, total: formatDuration(new Date(end) - new Date(start)) },
//         dailyCounts
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to fetch daily count totals" });
//     }
//   });

//   router.get("/analytics/daily-summary-dashboard", async (req, res) => {
//     try {
//       const queryStartTime = Date.now();
//       const { start, end, serial } = parseAndValidateQueryParams(req);
//       const targetSerials = serial ? [parseInt(serial)] : await db.collection("machine").distinct("serial");
  
//       const machineResults = [];
//       const items = [];
  
//       for (const machineSerial of targetSerials) {
//         const bookended = await getBookendedStatesAndTimeRange(db, machineSerial, start, end);
//         if (!bookended) continue;
  
//         const { sessionStart, sessionEnd, states } = bookended;
//         const counts = await getValidCounts(db, machineSerial, sessionStart, sessionEnd);
//         const misfeeds = await getMisfeedCounts(db, machineSerial, sessionStart, sessionEnd);
  
//         // ========== MACHINE RESULTS ==========
//         const performance = await buildMachinePerformance(states, counts, misfeeds, sessionStart, sessionEnd);
//         const itemSummary = buildMachineItemSummary(states, counts, sessionStart, sessionEnd);
//         const itemHourlyStack = buildItemHourlyStack(counts, sessionStart, sessionEnd);
//         const faultData = buildFaultData(states, sessionStart, sessionEnd);
//         const operatorEfficiency = await buildOperatorEfficiency(states, counts, sessionStart, sessionEnd, machineSerial);
  
//         const latestState = states.at(-1);
//         const machineName = latestState?.machine?.name || "Unknown";
//         const statusCode = latestState?.status?.code || 0;
//         const statusName = latestState?.status?.name || "Unknown";
  
//         machineResults.push({
//           machine: { serial: machineSerial, name: machineName },
//           currentStatus: { code: statusCode, name: statusName },
//           performance,
//           itemSummary,
//           itemHourlyStack,
//           faultData,
//           operatorEfficiency
//         });
  
//         // ========== ITEM SUMMARY ==========
//         const runCycles = extractAllCyclesFromStates(states, sessionStart, sessionEnd).running;
  
//         const machineSummary = {
//           totalCount: 0,
//           totalWorkedMs: 0,
//           itemSummaries: {}
//         };
  
//         for (const cycle of runCycles) {
//           const cycleStart = new Date(cycle.start);
//           const cycleEnd = new Date(cycle.end);
//           const cycleMs = cycleEnd - cycleStart;
  
//           const cycleCounts = counts.filter(c => {
//             const ts = new Date(c.timestamp);
//             return ts >= cycleStart && ts <= cycleEnd;
//           });
//           if (!cycleCounts.length) continue;
  
//           const operators = new Set(cycleCounts.map(c => c.operator?.id).filter(Boolean));
//           const workedTimeMs = cycleMs * Math.max(1, operators.size);
//           const itemGroups = groupCountsByItem(cycleCounts);
  
//           for (const [itemId, group] of Object.entries(itemGroups)) {
//             const countTotal = group.length;
//             const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
//             const name = group[0].item?.name || "Unknown";
  
//             if (!machineSummary.itemSummaries[itemId]) {
//               machineSummary.itemSummaries[itemId] = {
//                 count: 0,
//                 standard,
//                 workedTimeMs: 0,
//                 name
//               };
//             }
  
//             machineSummary.itemSummaries[itemId].count += countTotal;
//             machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
//             machineSummary.totalCount += countTotal;
//             machineSummary.totalWorkedMs += workedTimeMs;
//           }
//         }
  
//         for (const summary of Object.values(machineSummary.itemSummaries)) {
//           const workedTimeFormatted = formatDuration(summary.workedTimeMs);
//           const totalHours = summary.workedTimeMs / 3600000;
//           const pph = totalHours > 0 ? summary.count / totalHours : 0;
//           const efficiency = summary.standard > 0 ? pph / summary.standard : 0;
  
//           items.push({
//             itemName: summary.name,
//             workedTimeFormatted,
//             count: summary.count,
//             pph: Math.round(pph * 100) / 100,
//             standard: summary.standard,
//             efficiency: Math.round(efficiency * 10000) / 100
//           });
//         }
//       }
  
//       // ========== OPERATOR RESULTS ==========
//       const operatorGroupedData = await fetchGroupedAnalyticsData(db, start, end, "operator");
//       const operatorResults = await Promise.all(
//         Object.entries(operatorGroupedData).map(async ([operatorId, group]) => {
//           const numericOperatorId = parseInt(operatorId);
//           const { states, counts } = group;
  
//           if (!states.length && !counts.all.length) return null;
  
//           const performance = await buildOperatorPerformance(states, counts.valid, counts.misfeed, start, end);
//           const countByItem = await buildOperatorCountByItem(group, start, end);
//           const operatorName =
//             counts.valid[0]?.operator?.name ||
//             counts.all[0]?.operator?.name ||
//             "Unknown";
  
//           const latest = states.at(-1) || {};
  
//           return {
//             operator: { id: numericOperatorId, name: operatorName },
//             currentStatus: {
//               code: latest.status?.code || 0,
//               name: latest.status?.name || "Unknown"
//             },
//             metrics: {
//               runtime: {
//                 total: performance.runtime.total,
//                 formatted: performance.runtime.formatted
//               },
//               performance: {
//                 efficiency: {
//                   value: performance.performance.efficiency.value,
//                   percentage: performance.performance.efficiency.percentage
//                 }
//               }
//             },
//             countByItem
//           };
//         })
//       );
  
//       res.json({
//         timeRange: { start, end, total: formatDuration(Date.now() - queryStartTime) },
//         machineResults,
//         operatorResults: operatorResults.filter(Boolean),
//         items
//       });
//     } catch (error) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
//       res.status(500).json({ error: "Failed to generate daily summary dashboard" });
//     }
//   });


/*** Run Session Routes */
router.get("/run-session/state/cycles", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);

    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    // Step 3: Get all state records using state.js utility
    const states = await fetchStatesForMachine(
      db,
      serial,
      paddedStart,
      paddedEnd
    );

    // Step 4: Extract cycles using state.js utility
    const cycles = extractAllCyclesFromStates(states, start, end);
    const runningCycles = cycles.running;

    // Step 5: For each cycle, get count records using count.js utility
    for (const cycle of runningCycles) {
      const countData = await getCountRecords(
        db,
        serial,
        cycle.start,
        cycle.end
      );
      cycle.counts = countData;
    }

    res.json(runningCycles);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: "Failed to fetch session cycles" });
  }
});

router.get("/run-session/state/operator-cycles", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);

    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    // Step 3: Get all state records using state.js utility
    const states = await fetchStatesForMachine(
      db,
      serial,
      paddedStart,
      paddedEnd
    );
    // Step 4: Group states by machine using state.js utility
    const groupedByMachine = groupStatesByMachine(states);

    const allResults = [];

    for (const machineKey of Object.keys(groupedByMachine)) {
      const group = groupedByMachine[machineKey];
      const { serial: machineSerial, mode: machineMode } = group.machine;
      const isAc360 = machineMode === "ac360";

      // Step 5: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(group.states, start, end);
      const runningCycles = cycles.running;

      // Step 6: For each cycle, get count records and process operators
      for (const cycle of runningCycles) {
        const countRecords = await getCountRecords(
          db,
          machineSerial,
          cycle.start,
          cycle.end
        );

        // Step 7: Get operator-item mapping using count.js utility
        const operatorMap = getOperatorItemMapFromCounts(countRecords);

        // Step 8: Format operators data
        cycle.operators = Object.entries(operatorMap).map(([opId, data]) => {
          const items = Object.entries(data.items).map(
            ([itemId, itemArray]) => ({
              id: itemArray[0].id,
              name: itemArray[0].name,
              standard: itemArray[0].standard,
              count: itemArray.length,
            })
          );

          return {
            id: parseInt(opId),
            name: data.name,
            items,
          };
        });
      }

      allResults.push({
        machine: group.machine,
        cycles: runningCycles,
      });
    }

    res.json(allResults);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch operator-based session cycles" });
  }
});



router.get("/analytics/machine-state-totals", async (req, res) => {
  try {
    // Step 1: Parse and validate query parameters
    const { start, end, serial } = parseAndValidateQueryParams(req);
    // Step 2: Create padded time range
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    let results;

    if (serial) {
      // If serial provided, process single machine
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Extract all types of cycles
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      // Calculate total durations
      const runningTime = runningCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const pausedTime = pausedCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const faultedTime = faultCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );

      // Helper function to format duration with hours, minutes, and seconds
      const formatDurationWithSeconds = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return {
          hours,
          minutes,
          seconds,
        };
      };

      // Format response for this machine
      results = [
        {
          machine: {
            name: states[0].machine?.name || "Unknown",
            serial: parseInt(serial),
          },
          timeTotals: {
            running: {
              total: runningTime,
              formatted: formatDurationWithSeconds(runningTime),
              cycles: runningCycles,
            },
            paused: {
              total: pausedTime,
              formatted: formatDurationWithSeconds(pausedTime),
              cycles: pausedCycles,
            },
            faulted: {
              total: faultedTime,
              formatted: formatDurationWithSeconds(faultedTime),
              cycles: faultCycles,
            },
          },
          timeRange: {
            start: start,
            end: end,
            total: formatDurationWithSeconds(new Date(end) - new Date(start)),
          },
        },
      ];
    } else {
      // If no serial provided, process all machines
      results = await processAllMachinesCycles(db, paddedStart, paddedEnd);
    }

    res.json(results);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch machine state time totals" });
  }
});

router.get("/analytics/machine-hourly-states", async (req, res) => {
  try {
    const { start, end, serial } = parseAndValidateQueryParams(req);
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

    let machines;
    if (serial) {
      machines = [{ serial: parseInt(serial) }];
    } else {
      machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
    }

    const startDate = new Date(end);
    const titleDate = startDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });

    const results = [];

    for (const machine of machines) {
      const states = await fetchStatesForMachine(
        db,
        machine.serial,
        paddedStart,
        paddedEnd
      );
      if (!states.length) continue;

      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      const runningHours = calculateHourlyStateDurations(
        runningCycles,
        start,
        end,
        "Running"
      );
      const pausedHours = calculateHourlyStateDurations(
        pausedCycles,
        start,
        end,
        "Paused"
      );
      const faultedHours = calculateHourlyStateDurations(
        faultCycles,
        start,
        end,
        "Faulted"
      );

      results.push({
        title: `Machine Activity - ${titleDate}`,
        data: {
          hours: Array.from({ length: 24 }, (_, i) => i),
          series: {
            Running: runningHours,
            Paused: pausedHours,
            Faulted: faultedHours,
          },
        },
        machine: {
          name: states[0].machine?.name || "Unknown",
          serial: machine.serial,
        },
      });
    }

    res.json(results);
  } catch (error) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
    res
      .status(500)
      .json({ error: "Failed to fetch machine state time totals" });
  }
});



  /*** Analytics Routes: Machine dashboard old route using state and count collections */ 

  router.get("/analytics/machine-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);
      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (serial) {
        // If serial provided, get states for just that machine
        const machineStates = await fetchStatesForMachine(
          db,
          serial,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this machine
        groupedStates = {
          [serial]: {
            machine: {
              serial: serial,
              name: machineStates[0]?.machine?.name || null,
              mode: machineStates[0]?.program?.mode || null,
            },
            states: machineStates,
          },
        };
      } else {
        // If no serial, get all states and group them
        const allStates = await fetchStatesForMachine(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByMachine(allStates);
      }

      const results = [];

      // Process each machine's states
      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const states = group.states;

        // Skip if no states found for this machine
        if (!states.length) continue;

        // Extract all types of cycles
        const cycles = extractAllCyclesFromStates(states, start, end);
        const runningCycles = cycles.running;

        // Get counts for this machine
        const validCounts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        // Get misfeed counts for this machine
        const misfeedCounts = await getMisfeedCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );

        // Calculate metrics for this machine
        const totalQueryMs = new Date(end) - new Date(start);
        const runtimeMs = runningCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );
        const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);
        const totalCount = calculateTotalCount(validCounts, misfeedCounts);
        const misfeedCount = calculateMisfeeds(misfeedCounts);
        const availability = calculateAvailability(
          runtimeMs,
          downtimeMs,
          totalQueryMs
        );
        const throughput = calculateThroughput(totalCount, misfeedCount);
        const efficiency = calculateEfficiency(
          runtimeMs,
          totalCount,
          validCounts
        );
        const oee = calculateOEE(availability, efficiency, throughput);

        // Get current status for this machine
        const currentState = states[states.length - 1] || {};

        // Format response for this machine
        const machineResponse = {
          machine: {
            name: currentState.machine?.name || "Unknown",
            serial: currentState.machine?.serial || parseInt(machineSerial),
          },
          currentStatus: {
            code: currentState.status?.code || 0,
            name: currentState.status?.name || "Unknown",
          },
          metrics: {
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
          },
          timeRange: {
            start: start,
            end: end,
            total: formatDuration(totalQueryMs),
          },
        };

        results.push(machineResponse);
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch machine performance metrics" });
    }
  });


// Old route for operator dashboard using state and count collections
  
  router.get("/analytics/operator-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (operatorId) {
        // If operatorId provided, get states for just that operator
        states = await fetchStatesForOperator(
          db,
          operatorId,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this operator
        groupedStates = {
          [operatorId]: {
            operator: {
              id: operatorId,
              name: await getOperatorNameFromCount(db, operatorId),
            },
            states: states,
          },
        };
      } else {
        // If no operatorId, get all states and group them by operator
        const allStates = await fetchStatesForOperator(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByOperator(allStates);

        // Update operator names for all groups
        for (const [opId, group] of Object.entries(groupedStates)) {
          group.operator.name = await getOperatorNameFromCount(db, opId);
        }
      }

      // Step 3: Get all operator IDs for count query
      const operatorIds = Object.keys(groupedStates).map((id) => parseInt(id));

      // Get counts for all operators in a single query
      const allCounts = await db
        .collection("count")
        .find({
          "operator.id": { $in: operatorIds },
          timestamp: { $gte: new Date(start), $lte: new Date(end) },
        })
        .sort({ timestamp: 1 })
        .toArray();

      // Group counts by operator
      const operatorCounts = {};
      for (const count of allCounts) {
        const opId = count.operator?.id;
        if (!opId) continue;

        if (!operatorCounts[opId]) {
          operatorCounts[opId] = {
            counts: [],
            validCounts: [],
            misfeedCounts: [],
          };
        }

        operatorCounts[opId].counts.push(count);
        if (count.misfeed) {
          operatorCounts[opId].misfeedCounts.push(count);
        } else {
          operatorCounts[opId].validCounts.push(count);
        }
      }

      const results = [];

      // Step 4: Process each operator's data in parallel
      const operatorResults = await Promise.all(
        Object.entries(groupedStates).map(async ([operatorId, group]) => {
          const states = group.states;

          // Skip if no states found for this operator
          if (!states.length) return null;

          // Get counts for this operator
          const counts = operatorCounts[parseInt(operatorId)];
          if (!counts) return null;

          // Process count statistics using the new utility function
          const stats = processCountStatistics(counts.counts);

          // Calculate metrics for this operator
          const totalQueryMs = new Date(end) - new Date(start);
          const {
            runtime: runtimeMs,
            pausedTime: pausedTimeMs,
            faultTime: faultTimeMs,
          } = calculateOperatorTimes(states, start, end);

          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            counts.validCounts
          );

          // Get current status for this operator
          const currentState = states[states.length - 1] || {};

          // Format response for this operator
          return {
            operator: {
              id: parseInt(operatorId),
              name: group.operator.name || "Unknown",
            },
            currentStatus: {
              code: currentState.status?.code || 0,
              name: currentState.status?.name || "Unknown",
            },
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              pausedTime: {
                total: pausedTimeMs,
                formatted: formatDuration(pausedTimeMs),
              },
              faultTime: {
                total: faultTimeMs,
                formatted: formatDuration(faultTimeMs),
              },
              output: {
                totalCount: stats.total,
                misfeedCount: stats.misfeeds,
                validCount: stats.valid,
              },
              performance: {
                piecesPerHour: {
                  value: piecesPerHour,
                  formatted: Math.round(piecesPerHour).toString(),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2) + "%",
                },
              },
            },
            timeRange: {
              start: start,
              end: end,
              total: formatDuration(totalQueryMs),
            },
          };
        })
      );

      // Filter out null results and send response
      res.json(operatorResults.filter((result) => result !== null));
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator performance metrics" });
    }
  });



  
  router.get("/analytics/machine/operator-efficiency", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Step 3: Get hourly intervals
      const hourlyIntervals = getHourlyIntervals(paddedStart, paddedEnd);

      // Step 4: Get states and counts for the entire period
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );
      const counts = await getCountsForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 5: Process each hour
      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          // Filter states and counts for this hour
          const hourStates = states.filter((state) => {
            const stateTime = new Date(state.timestamp);
            return stateTime >= interval.start && stateTime <= interval.end;
          });

          const hourCounts = counts.filter((count) => {
            const countTime = new Date(count.timestamp);
            return countTime >= interval.start && countTime <= interval.end;
          });

          // Group counts by operator and machine
          const groupedCounts = groupCountsByOperatorAndMachine(hourCounts);

          // Calculate metrics for each operator
          const operatorMetrics = {};

          // Get unique operator IDs from counts
          const operatorIds = new Set();
          hourCounts.forEach((count) => {
            if (count.operator && count.operator.id) {
              operatorIds.add(count.operator.id);
            }
          });

          // Calculate total runtime for the hour from states
          const { runtime: totalRuntime } = calculateOperatorTimes(
            hourStates,
            interval.start,
            interval.end
          );

          // Process each operator
          for (const operatorId of operatorIds) {
            const countGroup = groupedCounts[`${operatorId}-${serial}`];
            if (!countGroup) continue;

            // Get operator name from first count
            const operatorName =
              countGroup.counts[0]?.operator?.name || "Unknown";

            // Process count statistics
            const stats = processCountStatistics(countGroup.counts);

            // Calculate efficiency
            const efficiency = calculateEfficiency(
              totalRuntime,
              stats.total,
              countGroup.validCounts
            );

            operatorMetrics[operatorId] = {
              name: operatorName,
              runTime: totalRuntime,
              validCounts: stats.valid,
              totalCounts: stats.total,
              efficiency: efficiency * 100, // Convert to percentage
            };
          }

          // Calculate OEE for this hour
          const hourDuration = interval.end - interval.start;
          const availability = (totalRuntime / hourDuration) * 100;

          const avgEfficiency =
            Object.values(operatorMetrics).length > 0
              ? Object.values(operatorMetrics).reduce(
                (sum, op) => sum + op.efficiency,
                0
              ) / Object.keys(operatorMetrics).length
              : 0;

          const totalValidCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.validCounts,
            0
          );
          const totalCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.totalCounts,
            0
          );
          const throughput =
            totalCounts > 0 ? (totalValidCounts / totalCounts) * 100 : 0;

          const oee =
            calculateOEE(
              availability / 100,
              avgEfficiency / 100,
              throughput / 100
            ) * 100;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(oee * 100) / 100,
            operators: Object.entries(operatorMetrics).map(([id, metrics]) => ({
              id: parseInt(id),
              name: metrics.name,
              efficiency: Math.round(metrics.efficiency * 100) / 100,
            })),
          };
        })
      );

      // Step 6: Format response
      const response = {
        machine: {
          serial: parseInt(serial),
          name: states[0]?.machine?.name || "Unknown",
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        hourlyData,
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to calculate operator efficiency" });
    }
  });

  // New route using buildTopOperatorEfficiencyFromSessions function
  router.get("/analytics/machine/operator-efficiency-fromSessions", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Step 2: Create time range
      const dayStart = new Date(start);
      const dayEnd = new Date(end);

      // Step 3: Get machine information from states collection
      const statesColl = db.collection(config.stateCollectionName);
      const machineInfo = await statesColl.findOne({
        "machine.serial": parseInt(serial)
      });

      if (!machineInfo) {
        return res.status(404).json({ error: "Machine not found" });
      }

      // Step 4: Get hourly intervals
      const hourlyIntervals = getHourlyIntervals(dayStart, dayEnd);

      // Step 5: Process each hour using operator sessions
      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          // Get operator efficiency data for this hour using the session-based function
          const operatorData = await dailyDashboardSessionRoutesSplit.buildTopOperatorEfficiencyFromSessions(db, interval.start, interval.end);

          // Get operator sessions for this specific machine and hour
          const osColl = db.collection(config.operatorSessionCollectionName);
          const machineOperatorSessions = await osColl.find({
            "machine.serial": parseInt(serial),
            "timestamps.start": { $lt: interval.end },
            $or: [
              { "timestamps.end": { $gt: interval.start } },
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": null }
            ],
            "operator.id": { $exists: true, $ne: -1 }
          }).toArray();

          // Group by operator and calculate efficiency for this machine
          const operatorMap = new Map();

          for (const session of machineOperatorSessions) {
            const opId = session.operator.id;
            const opName = session.operator.name || `#${opId}`;

            if (!operatorMap.has(opId)) {
              operatorMap.set(opId, {
                id: opId,
                name: opName,
                workTime: 0,
                timeCredit: 0,
                totalCount: 0,
                misfeedCount: 0
              });
            }

            const op = operatorMap.get(opId);
            const { factor } = calculateOverlapFactor(session.timestamps?.start, session.timestamps?.end, interval.start, interval.end);

            op.workTime += (session.workTime || 0) * factor;
            op.timeCredit += (session.totalTimeCredit || 0) * factor;
            op.totalCount += (session.totalCount || 0) * factor;
            op.misfeedCount += (session.misfeedCount || 0) * factor;
          }

          // Calculate efficiency for each operator
          const operators = Array.from(operatorMap.values()).map(op => {
            const efficiency = op.workTime > 0 ? (op.timeCredit / op.workTime) : 0;
            return {
              id: op.id,
              name: op.name,
              efficiency: Math.round(efficiency * 10000) / 100 // Round to 2 decimal places
            };
          });

          // Calculate average OEE for this hour
          const avgEfficiency = operators.length > 0
            ? operators.reduce((sum, op) => sum + op.efficiency, 0) / operators.length
            : 0;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(avgEfficiency * 100) / 100,
            operators: operators
          };
        })
      );

      // Step 6: Format response to match original route structure
      const response = {
        machine: {
          serial: parseInt(serial),
          name: machineInfo.machine?.name || "Unknown",
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        hourlyData,
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to calculate operator efficiency from sessions" });
    }
  });

  function calculateOverlapFactor(sStart, sEnd, wStart, wEnd) {
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ovSec = Math.max(0, (oe - os) / 1000);
    const fullSec = Math.max(0, (se - ss) / 1000);
    const f = fullSec > 0 ? ovSec / fullSec : 0;
    return { ovSec, fullSec, factor: f };
  }

  router.get("/analytics/operator-countbyitem", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      // Validate start
      if (!start)
        return res
          .status(400)
          .json({ error: "Start time parameter is required" });
      const startDate = new Date(start);
      if (isNaN(startDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid start time format. Use ISO string" });
      }

      // Validate operatorId
      if (!operatorId || isNaN(parseInt(operatorId))) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      // Validate end
      let endDate;
      if (end) {
        endDate = new Date(end);
        if (isNaN(endDate.getTime())) {
          return res
            .status(400)
            .json({ error: "Invalid end time format. Use ISO string" });
        }
      }

      const [latestState] = await Promise.all([
        db
          .collection("state")
          .find()
          .sort({ timestamp: -1 })
          .limit(1)
          .toArray(),
      ]);

      const finalEnd = endDate
        ? endDate.toISOString()
        : latestState?.timestamp || new Date().toISOString();
      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        new Date(finalEnd)
      );

      // Fetch states for specific operator
      const allStates = await fetchStatesForOperator(
        db,
        parseInt(operatorId),
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = {
            ...group,
            completedCycles,
          };
        }
      }

      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        finalEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      const results = [];

      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [opId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${opId}-${machineSerial}`];
        if (!countGroup) continue;

        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
        let countIndex = 0;

        for (const cycle of group.completedCycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleCounts = [];

          while (countIndex < sortedCounts.length) {
            const currentCount = sortedCounts[countIndex];
            const countTimestamp = new Date(currentCount.timestamp);

            if (countTimestamp < cycleStart) {
              countIndex++;
              continue;
            }
            if (countTimestamp > cycleEnd) break;

            cycleCounts.push(currentCount);
            countIndex++;
          }

          if (!cycleCounts.length) continue;

          const stats = processCountStatistics(cycleCounts);
          const { runtime: runtimeMs } = calculateOperatorTimes(
            cycle.states,
            cycleStart,
            cycleEnd
          );
          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            countGroup.validCounts
          );
          const itemNames = extractItemNamesFromCounts(cycleCounts);

          results.push({
            operatorId: parseInt(opId),
            machineSerial: parseInt(machineSerial),
            startTimestamp: cycleStart.toISOString(),
            endTimestamp: cycleEnd.toISOString(),
            totalCount: stats.valid,
            task: itemNames,
            standard: Math.round(piecesPerHour * efficiency),
          });
        }
      }

      // === Post-process results into hourly stacked bar chart format ===
      const hourItemMap = {};
      const itemsSet = new Set();

      // Distribute counts evenly per task per hour
      for (const entry of results) {
        const ts = new Date(entry.startTimestamp);
        const hour = ts.getHours();

        const tasks =
          typeof entry.task === "string"
            ? entry.task.split(",").map((t) => t.trim())
            : [];
        const perItemCount = Math.floor(entry.totalCount / tasks.length);

        tasks.forEach((item) => {
          itemsSet.add(item);
          if (!hourItemMap[hour]) hourItemMap[hour] = {};
          if (!hourItemMap[hour][item]) hourItemMap[hour][item] = 0;
          hourItemMap[hour][item] += perItemCount;
        });
      }

      // Build full list of hour integers between start and end
      const fullHourRange = [];
      const temp = new Date(startDate);
      temp.setMinutes(0, 0, 0);
      const endHourDate = new Date(endDate);
      endHourDate.setMinutes(0, 0, 0);

      while (temp <= endHourDate) {
        fullHourRange.push(temp.getHours());
        temp.setHours(temp.getHours() + 1);
      }

      // Format hours to '1am', '12pm', etc.
      function formatHour(hour) {
        if (hour === 0) return "12am";
        if (hour === 12) return "12pm";
        if (hour < 12) return `${hour}am`;
        return `${hour - 12}pm`;
      }

      const formattedHours = fullHourRange.map(formatHour);

      // Ensure operator/item counts match the full hour list
      const allItems = Array.from(itemsSet).sort();
      const operators = {};
      for (const item of allItems) {
        operators[item] = fullHourRange.map(
          (hour) => hourItemMap[hour]?.[item] || 0
        );
      }

      // Final response
      const response = {
        title: "Operator Counts by item",
        data: {
          hours: fullHourRange,
          operators,
        },
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to process data for operator" });
    }
  });





  // Old fault history route using state collection

  
  router.get("/analytics/fault-history", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Fetch states for the specified machine
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummary: [] });
      }

      // Extract fault cycles
      const { faultCycles, faultSummaries } = extractFaultCycles(
        states,
        start,
        end
      );

      res.json({
        faultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  router.get("/analytics/operator-fault-history", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      if (!start || !end || !operatorId) {
        return res
          .status(400)
          .json({ error: "Start time, end time, and operatorId are required" });
      }

      // Convert string dates to Date objects
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Please use ISO date strings" });
      }

      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        endDate
      );
      const parsedOperatorId = parseInt(operatorId);

      if (isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Invalid operatorId" });
      }

      // Get all machine states where this operator was present
      const states = await fetchStatesForOperator(
        db,
        parsedOperatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummaries: [] });
      }

      // Group states by machine to process each machine's fault cycles separately
      const groupedStates = groupStatesByOperatorAndSerial(states);
      const allFaultCycles = [];
      const faultTypeMap = new Map(); // For aggregating fault summaries

      // Process each machine's states
      for (const [key, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";

        // Extract fault cycles for this machine
        const { faultCycles, faultSummaries } = extractFaultCycles(
          machineStates,
          startDate,
          endDate
        );

        // Add machine info to each fault cycle
        const machineFaultCycles = faultCycles.map((cycle) => ({
          ...cycle,
          machineName,
          machineSerial: group.machine?.serial,
        }));

        allFaultCycles.push(...machineFaultCycles);

        // Aggregate fault summaries
        for (const summary of faultSummaries) {
          const key = summary.faultType;
          if (!faultTypeMap.has(key)) {
            faultTypeMap.set(key, {
              faultType: key,
              count: 0,
              totalDuration: 0,
            });
          }
          const existing = faultTypeMap.get(key);
          existing.count += summary.count;
          existing.totalDuration += summary.totalDuration;
        }
      }

      // Convert fault summaries to array and format durations
      const faultSummaries = Array.from(faultTypeMap.values()).map(
        (summary) => {
          const totalSeconds = Math.floor(summary.totalDuration / 1000);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          return {
            ...summary,
            formatted: {
              hours,
              minutes,
              seconds,
            },
          };
        }
      );

      // Sort fault cycles by start time
      allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));

      res.json({
        faultCycles: allFaultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator fault history" });
    }
  });




  //Old routes that use state and count collections

  

  router.get("/analytics/machine-item-summary", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        serial || null,
        paddedStart,
        paddedEnd
      );
      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByMachine(allStates);

      const results = await Promise.all(
        Object.entries(groupedStates).map(async ([machineSerial, group]) => {
          const machineName = group.machine?.name || "Unknown";
          const machineStates = group.states;

          const cycles = extractAllCyclesFromStates(
            machineStates,
            start,
            end
          ).running;

          if (!cycles.length) {
            return {
              machine: {
                name: machineName,
                serial: parseInt(machineSerial),
              },
              sessions: [],
              machineSummary: {
                totalCount: 0,
                workedTimeMs: 0,
                workedTimeFormatted: "0m",
                pph: 0,
                proratedStandard: 0,
                efficiency: 0,
                itemSummaries: {},
              },
            };
          }

          const allCounts = await getValidCounts(
            db,
            parseInt(machineSerial),
            start,
            end
          );

          let totalCount = 0;
          let totalWorkedMs = 0;
          const itemSummaries = {};
          const sessions = [];

          for (const cycle of cycles) {
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            const cycleMs = cycleEnd - cycleStart;

            const cycleCounts = allCounts.filter((c) => {
              const ts = new Date(c.timestamp);
              return ts >= cycleStart && ts <= cycleEnd;
            });

            if (!cycleCounts.length) continue;

            const uniqueOperatorIds = new Set(
              cycleCounts.map((c) => c.operator?.id).filter(Boolean)
            );
            const workedTimeMs = cycleMs * Math.max(1, uniqueOperatorIds.size);

            const groupedCounts = groupCountsByItem(cycleCounts);

            for (const [itemId, records] of Object.entries(groupedCounts)) {
              const count = records.length;
              const standard = records[0].item?.standard || 666;
              const name = records[0].item?.name || "Unknown";

              if (!itemSummaries[itemId]) {
                itemSummaries[itemId] = {
                  name,
                  standard,
                  count: 0,
                  workedTimeMs: 0,
                };
              }

              itemSummaries[itemId].count += count;
              itemSummaries[itemId].workedTimeMs += workedTimeMs;
              totalCount += count;
              totalWorkedMs += workedTimeMs;
            }

            sessions.push({
              start: cycleStart.toISOString(),
              end: cycleEnd.toISOString(),
              workedTimeMs,
              workedTimeFormatted: formatDuration(workedTimeMs),
            });
          }

          // Final aggregation (1-pass)
          let proratedStandard = 0;
          const itemSummariesFormatted = {};

          for (const [itemId, summary] of Object.entries(itemSummaries)) {
            const hours = summary.workedTimeMs / 3600000;
            const pph = hours > 0 ? summary.count / hours : 0;
            const efficiency =
              summary.standard > 0 ? pph / summary.standard : 0;

            const weight = totalCount > 0 ? summary.count / totalCount : 0;
            proratedStandard += weight * summary.standard;

            itemSummariesFormatted[itemId] = {
              name: summary.name,
              standard: summary.standard,
              countTotal: summary.count,
              workedTimeFormatted: formatDuration(summary.workedTimeMs),
              pph: Math.round(pph * 100) / 100,
              efficiency: Math.round(efficiency * 10000) / 100,
            };
          }

          const totalHours = totalWorkedMs / 3600000;
          const machinePph = totalHours > 0 ? totalCount / totalHours : 0;
          const machineEff =
            proratedStandard > 0 ? machinePph / proratedStandard : 0;

          return {
            machine: {
              name: machineName,
              serial: parseInt(machineSerial),
            },
            sessions,
            machineSummary: {
              totalCount,
              workedTimeMs: totalWorkedMs,
              workedTimeFormatted: formatDuration(totalWorkedMs),
              pph: Math.round(machinePph * 100) / 100,
              proratedStandard: Math.round(proratedStandard * 100) / 100,
              efficiency: Math.round(machineEff * 10000) / 100,
              itemSummaries: itemSummariesFormatted,
            },
          };
        })
      );

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to generate machine item summary" });
    }
  });

  router.get("/analytics/operator-item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId
        ? parseInt(req.query.operatorId)
        : null;
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      // Fetch states filtered by operatorId if present
      const allStates = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // Filter operator-machine pairs by operatorId if present
      const allOperatorMachinePairs = Object.keys(groupedStates)
        .map((key) => {
          const [opId, machineSerial] = key.split("-").map(Number);
          return { operatorId: opId, machineSerial };
        })
        .filter((pair) => !operatorId || pair.operatorId === operatorId);

      if (!allOperatorMachinePairs.length) return res.json([]);

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        allOperatorMachinePairs,
        paddedStart,
        paddedEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // Process each operator-machine pair in parallel
      const results = await Promise.all(
        Object.entries(groupedCounts).map(async ([key, countGroup]) => {
          const { operator, machine, validCounts, misfeedCounts } = countGroup;

          // Skip if operatorId is provided and doesn't match
          if (operatorId && operator?.id !== operatorId) return null;

          const states = groupedStates[key]?.states || [];
          if (!states.length) return null;

          const runCycles = getCompletedCyclesForOperator(states);
          if (!runCycles.length) return null;

          const totalRunMs = runCycles.reduce(
            (acc, cycle) => acc + (cycle.duration || 0),
            0
          );

          const itemMap = groupCountsByItem(validCounts);
          if (!Object.keys(itemMap).length) return null;

          // Pre-calculate misfeed counts by item for efficiency
          const misfeedByItem = {};
          for (const misfeed of misfeedCounts) {
            const itemId = misfeed.item?.id;
            if (itemId) {
              misfeedByItem[itemId] = (misfeedByItem[itemId] || 0) + 1;
            }
          }

          const hours = totalRunMs / 3600000;
          const workedTimeFormatted = formatDuration(totalRunMs);

          // Process all items for this operator-machine pair
          const itemResults = [];
          for (const [itemId, group] of Object.entries(itemMap)) {
            const item = group[0]?.item || {};
            const count = group.length;
            const misfeeds = misfeedByItem[parseInt(itemId)] || 0;
            const pph = hours > 0 ? count / hours : 0;
            const standard = item.standard > 0 ? item.standard : 666;
            const efficiency = standard > 0 ? pph / standard : 0;

            itemResults.push({
              operatorName: operator?.name || "Unknown",
              machineName: machine?.name || "Unknown",
              itemName: item?.name || "Unknown",
              workedTimeFormatted,
              count,
              misfeed: misfeeds,
              pph: Math.round(pph * 100) / 100,
              standard,
              efficiency: Math.round(efficiency * 10000) / 100,
            });
          }

          return itemResults;
        })
      );

      // Flatten results and consolidate duplicates in a single pass
      const consolidated = {};
      const flatResults = results.filter(Boolean).flat();

      for (const row of flatResults) {
        const key = `${row.operatorName}-${row.machineName}-${row.itemName}`;

        if (!consolidated[key]) {
          consolidated[key] = { ...row };
        } else {
          const existing = consolidated[key];
          existing.count += row.count;
          existing.misfeed += row.misfeed;

          // Convert formatted time back to milliseconds for calculation
          const existingMs =
            (existing.workedTimeFormatted.hours * 60 +
              existing.workedTimeFormatted.minutes) *
            60000;
          const newMs =
            (row.workedTimeFormatted.hours * 60 +
              row.workedTimeFormatted.minutes) *
            60000;
          const totalMs = existingMs + newMs;

          // Recalculate metrics
          const totalHours = totalMs / 3600000;
          const totalPph = totalHours > 0 ? existing.count / totalHours : 0;
          const totalEfficiency =
            existing.standard > 0 ? totalPph / existing.standard : 0;

          existing.workedTimeFormatted = formatDuration(totalMs);
          existing.pph = Math.round(totalPph * 100) / 100;
          existing.efficiency = Math.round(totalEfficiency * 10000) / 100;
        }
      }

      res.json(Object.values(consolidated));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate operator item summary report" });
    }
  });

  router.get("/analytics/item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        null,
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByMachine(allStates);

      const resultsMap = new Map();

      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";
        const cycles = extractAllCyclesFromStates(
          machineStates,
          start,
          end
        ).running;

        const counts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        if (!counts.length || !cycles.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(c.timestamp);
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: parseInt(itemId),
                name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency = entry.standard > 0 ? pph / entry.standard : 0;

        return {
          itemName: entry.name,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 10000) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate item summary report" });
    }
  });

  router.get("/analytics/machine-item-hourly-item-stack", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      const counts = await getValidCounts(db, parseInt(serial), start, end);
      if (!counts.length)
        return res.json({
          title: "No data",
          data: { hours: [], operators: {} },
        });

      // Normalize counts into hour buckets
      const hourMap = new Map(); // hourIndex => { itemName => count }

      for (const count of counts) {
        const ts = new Date(count.timestamp);
        const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000)); // hour offset since start
        const itemName = count.item?.name || "Unknown";

        if (!hourMap.has(hourIndex)) hourMap.set(hourIndex, {});
        const hourEntry = hourMap.get(hourIndex);
        hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
      }

      // Build structure: hours[], and for each item: count array by hour
      const maxHour = Math.max(...hourMap.keys());
      const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);
      const itemNames = new Set();

      // Collect all item names
      for (const hourEntry of hourMap.values()) {
        Object.keys(hourEntry).forEach((name) => itemNames.add(name));
      }

      // Initialize operator structure
      const operators = {};
      for (const name of itemNames) {
        operators[name] = Array(maxHour + 1).fill(0);
      }

      // Fill operator counts
      for (const [hourIndex, itemCounts] of hourMap.entries()) {
        for (const [itemName, count] of Object.entries(itemCounts)) {
          operators[itemName][hourIndex] = count;
        }
      }

      res.json({
        title: `Item Stacked Count Chart for Machine ${serial}`,
        data: {
          hours,
          operators,
        },
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to build item/hour stacked data" });
    }
  });

  router.get("/analytics/operator-cycle-pie", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!operatorId) {
        return res.status(400).json({ error: "Operator ID is required" });
      }

      // Step 3: Get all state records using state.js utility
      const states = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 4: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      // Calculate total durations
      const runningTime = runningCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const pausedTime = pausedCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const faultedTime = faultCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );

      const totalTime = runningTime + pausedTime + faultedTime;

      // Format response
      const response = [
        {
          name: "Running",
          value: Math.round((runningTime / totalTime) * 100),
        },
        {
          name: "Paused",
          value: Math.round((pausedTime / totalTime) * 100),
        },
        {
          name: "Faulted",
          value: Math.round((faultedTime / totalTime) * 100),
        },
      ];

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator cycle pie data" });
    }
  });
  router.get("/analytics/operator/daily-efficiency", async (req, res) => {
    try {
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
      const parsedOperatorId = parseInt(operatorId);

      if (!parsedOperatorId || isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);
      const days = [];
      let cursor = new Date(startDate);

      while (cursor <= endDate) {
        const startOfDay = new Date(cursor);
        const endOfDay = new Date(startOfDay);
        endOfDay.setUTCHours(23, 59, 59, 999);

        days.push({ start: new Date(startOfDay), end: new Date(endOfDay) });

        cursor.setUTCDate(cursor.getUTCDate() + 1); // Move to next day
      }

      const results = [];

      for (const day of days) {
        // 1. Get states for this day
        const dayStates = await fetchStatesForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );
        const runCycles = getCompletedCyclesForOperator(dayStates);
        const totalRunTimeMs = runCycles.reduce(
          (sum, cycle) => sum + cycle.duration,
          0
        );

        // 2. Get valid counts
        const validCounts = await getValidCountsForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );

        // 3. Estimate average standard from item data
        let avgStandard = 666; // default fallback
        if (validCounts.length > 0) {
          const standards = validCounts
            .map((c) => c.item?.standard)
            .filter((s) => typeof s === "number" && s > 0);

          if (standards.length > 0) {
            avgStandard =
              standards.reduce((sum, s) => sum + s, 0) / standards.length;
          }
        }

        // 4. Calculate PPH
        const hours = totalRunTimeMs / 3600000;
        const pph = hours > 0 ? validCounts.length / hours : 0;

        // 5. Calculate efficiency
        const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;

        results.push({
          date: day.start.toISOString().split("T")[0],
          efficiency: Math.round(efficiency * 100) / 100,
        });
      }

      const operatorName = await getOperatorNameFromCount(db, parsedOperatorId);

      res.json({
        operator: {
          id: parsedOperatorId,
          name: operatorName || "Unknown",
        },
        timeRange: {
          start,
          end,
          totalDays: results.length,
        },
        data: results,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to compute daily efficiency" });
    }
  });

  router.get("/analytics/item-dashboard-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      const machineSerials = await db.collection("machine").distinct("serial");

      const resultsMap = new Map();

      for (const serial of machineSerials) {
        const bookended = await getBookendedStatesAndTimeRange(
          db,
          serial,
          start,
          end
        );
        if (!bookended) continue;

        const { sessionStart, sessionEnd, states } = bookended;
        const cycles = extractAllCyclesFromStates(
          states,
          sessionStart,
          sessionEnd
        ).running;
        if (!cycles.length) continue;

        const counts = await getValidCounts(
          db,
          serial,
          sessionStart,
          sessionEnd
        );
        if (!counts.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(c.timestamp);
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const itemIdNum = parseInt(itemId);
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: itemIdNum,
                itemName: name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency =
          entry.standard > 0 ? (pph / entry.standard) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 100) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate item dashboard summary" });
    }
  });

return router;

};
