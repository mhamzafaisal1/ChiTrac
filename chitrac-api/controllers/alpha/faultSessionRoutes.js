// routes/analytics/fault-history.js
const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, createPaddedTimeRange } = require("../../utils/time");
const {
  fetchStatesForMachine,
  fetchStatesForOperator,
  extractFaultCycles,
  groupStatesByOperatorAndSerial,
} = require("../../utils/state");

module.exports = function faultHistoryRoute(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  router.get("/analytics/fault-sessions-history", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const serialParam = req.query.serial;
      const operatorParam = req.query.operatorId;
      const includeParam = req.query.include; // New parameter to control response content

      const hasSerial = serialParam != null;
      const hasOperator = operatorParam != null;
      if (!hasSerial && !hasOperator) {
        return res.status(400).json({ error: "Provide serial or operatorId" });
      }

      // Parse include parameter - can be 'cycles', 'summaries', or undefined (defaults to both)
      let includeCycles = true;
      let includeSummaries = true;
      if (includeParam) {
        if (includeParam === 'cycles') {
          includeCycles = true;
          includeSummaries = false;
        } else if (includeParam === 'summaries') {
          includeCycles = false;
          includeSummaries = true;
        } else if (includeParam === 'both') {
          includeCycles = true;
          includeSummaries = true;
        } else {
          return res.status(400).json({ error: "include parameter must be 'cycles', 'summaries', or 'both'" });
        }
      }

      const serial = hasSerial ? Number(serialParam) : null;
      const operatorId = hasOperator ? Number(operatorParam) : null;
      if ((hasSerial && Number.isNaN(serial)) || (hasOperator && Number.isNaN(operatorId))) {
        return res.status(400).json({ error: "serial and operatorId must be numbers when provided" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      // Base match: time overlap
      const match = {
        "timestamps.start": { $lte: endDate },
        $or: [{ "timestamps.end": { $exists: false } }, { "timestamps.end": { $gte: startDate } }],
      };
      if (hasSerial) match["machine.serial"] = serial;
      if (hasOperator) match["operators.id"] = operatorId;

      // Pull overlapping fault-sessions and clip to [start,end]
      const raw = await db
        .collection(config.faultSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              // clip window
              ovStart: { $cond: [{ $gt: ["$timestamps.start", startDate] }, "$timestamps.start", startDate] },
              ovEnd: {
                $cond: [
                  { $gt: [{ $ifNull: ["$timestamps.end", endDate] }, endDate] },
                  endDate,
                  { $ifNull: ["$timestamps.end", endDate] },
                ],
              },
            },
          },
          { $match: { $expr: { $lt: ["$ovStart", "$ovEnd"] } } },
          // derive code/name from startState
          {
            $project: {
              _id: 1,
              machine: 1,
              operators: 1,
              items: 1,
              startState: 1,
              endState: 1,
              activeStations: 1,
              ovStart: 1,
              ovEnd: 1,
              code: "$startState.status.code",
              name: "$startState.status.name",
              // stored aggregates if present
              storedFaulttime: "$faulttime",
              storedWorkMissed: "$workTimeMissed",
            },
          },
        ])
        .toArray();

      if (!raw.length) {
        const response = {
          context: { start: startDate, end: endDate, serial, operatorId },
        };
        
        if (includeCycles) response.faultCycles = [];
        if (includeSummaries) response.faultSummaries = [];
        
        return res.json(response);
      }

      
      let machineName = null;
      if (hasSerial) {
        machineName =
          raw.find(r => r?.machine?.name)?.machine?.name ??
          `Machine ${serial}`;
      }
      let operatorName = null;
      if (hasOperator) {
        // pick the first matching operator name from any session
        for (const r of raw) {
          const op = (r.operators || []).find(o => o.id === operatorId);
          if (op?.name) {
            operatorName = op.name;
            break;
          }
        }
        if (!operatorName) operatorName = `Operator ${operatorId}`;
      }

      // Build cycles (one cycle per fault-session) - only if requested
      let faultCycles = [];
      if (includeCycles) {
        faultCycles = raw
          .map(r => {
            const durSec = Math.max(0, Math.floor((r.ovEnd - r.ovStart) / 1000));
            const fullActiveStations =
              typeof r.activeStations === "number" ? r.activeStations : (r.operators?.length ?? 0);

            const ops = hasOperator
              ? (r.operators || []).filter(o => o.id === operatorId)
              : (r.operators || []);

            const finalActiveStations = hasOperator ? ops.length : fullActiveStations;
            const finalWorkMissed = finalActiveStations * durSec;

            return {
              id: r._id,
              start: r.ovStart,
              end: r.ovEnd,
              durationSeconds: durSec,
              code: r.code ?? null,
              name: r.name ?? "Fault",
              machineSerial: r.machine?.serial ?? null,
              machineName: r.machine?.name ?? machineName ?? null,
              operators: ops.map(o => ({ id: o.id, name: o.name, station: o.station })),
              items: r.items || [],
              activeStations: finalActiveStations,
              workTimeMissedSeconds: finalWorkMissed,
            };
          })
          .sort((a, b) => a.start - b.start);
      }

      // Summaries by fault code+name - only if requested
      let faultSummaries = [];
      if (includeSummaries) {
        const summaryMap = new Map();
        for (const r of raw) {
          const code = r.code ?? null;
          const name = r.name ?? "Fault";
          const key = `${code}|${name}`;
          const durSec = Math.max(0, Math.floor((r.ovEnd - r.ovStart) / 1000));
          const fullActiveStations =
            typeof r.activeStations === "number" ? r.activeStations : (r.operators?.length ?? 0);
          const ops = hasOperator
            ? (r.operators || []).filter(o => o.id === operatorId)
            : (r.operators || []);
          const finalActiveStations = hasOperator ? ops.length : fullActiveStations;
          const finalWorkMissed = finalActiveStations * durSec;
          
          const prev = summaryMap.get(key) || {
            code: code,
            name: name,
            count: 0,
            totalDurationSeconds: 0,
            totalWorkTimeMissedSeconds: 0,
          };
          prev.count += 1;
          prev.totalDurationSeconds += durSec;
          prev.totalWorkTimeMissedSeconds += finalWorkMissed;
          summaryMap.set(key, prev);
        }

        faultSummaries = Array.from(summaryMap.values()).map(s => {
          const t = s.totalDurationSeconds;
          return {
            code: s.code,
            name: s.name,
            count: s.count,
            totalDurationSeconds: t,
            totalWorkTimeMissedSeconds: s.totalWorkTimeMissedSeconds,
            formatted: {
              hours: Math.floor(t / 3600),
              minutes: Math.floor((t % 3600) / 60),
              seconds: t % 60,
            },
          };
        });
      }

      const response = {
        context: { start: startDate, end: endDate, serial, machineName, operatorId, operatorName },
      };
      
      if (includeCycles) response.faultCycles = faultCycles;
      if (includeSummaries) response.faultSummaries = faultSummaries;

      return res.json(response);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  // Reverted route: Uses state collections instead of fault-sessions collection
  router.get("/analytics/fault-history-reverted", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const serialParam = req.query.serial;
      const operatorParam = req.query.operatorId;
      const includeParam = req.query.include; // New parameter to control response content

      const hasSerial = serialParam != null;
      const hasOperator = operatorParam != null;
      if (!hasSerial && !hasOperator) {
        return res.status(400).json({ error: "Provide serial or operatorId" });
      }

      // Parse include parameter - can be 'cycles', 'summaries', or undefined (defaults to both)
      let includeCycles = true;
      let includeSummaries = true;
      if (includeParam) {
        if (includeParam === 'cycles') {
          includeCycles = true;
          includeSummaries = false;
        } else if (includeParam === 'summaries') {
          includeCycles = false;
          includeSummaries = true;
        } else if (includeParam === 'both') {
          includeCycles = true;
          includeSummaries = true;
        } else {
          return res.status(400).json({ error: "include parameter must be 'cycles', 'summaries', or 'both'" });
        }
      }

      const serial = hasSerial ? Number(serialParam) : null;
      const operatorId = hasOperator ? Number(operatorParam) : null;
      if ((hasSerial && Number.isNaN(serial)) || (hasOperator && Number.isNaN(operatorId))) {
        return res.status(400).json({ error: "serial and operatorId must be numbers when provided" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      // Create padded time range for fetching states (to ensure we don't miss cycles at boundaries)
      const { paddedStart, paddedEnd } = createPaddedTimeRange(startDate, endDate);

      let allFaultCycles = [];
      let faultSummaries = [];
      let machineName = null;
      let operatorName = null;

      if (hasSerial) {
        // Fetch states for the machine
        const states = await fetchStatesForMachine(db, serial, paddedStart, paddedEnd);

        if (!states.length) {
          const response = {
            context: { start: startDate, end: endDate, serial, machineName: null },
          };
          
          if (includeCycles) response.faultCycles = [];
          if (includeSummaries) response.faultSummaries = [];
          
          return res.json(response);
        }

        // Extract machine name from first state
        machineName = states.find(s => s?.machine?.name)?.machine?.name ?? `Machine ${serial}`;

        // Extract fault cycles from states
        const { faultCycles: rawCycles, faultSummaries: rawSummaries } = extractFaultCycles(
          states,
          startDate,
          endDate
        );

        // Transform cycles to match current format
        if (includeCycles) {
          allFaultCycles = rawCycles.map(cycle => {
            // Get operators and active stations from the first state in the cycle
            const firstState = cycle.states?.[0];
            const operators = firstState?.operators || [];
            const activeStations = operators.filter(op => op && op.id !== -1).length;
            
            // Calculate duration in seconds
            const durationSeconds = Math.max(0, Math.floor((cycle.end - cycle.start) / 1000));
            const workTimeMissedSeconds = activeStations * durationSeconds;

            // Get items from program if available
            const items = firstState?.program?.items 
              ? Object.values(firstState.program.items).filter(item => item && item.id !== undefined)
              : [];

            return {
              id: null, // No session ID in state-based approach
              start: cycle.start,
              end: cycle.end,
              durationSeconds: durationSeconds,
              code: cycle.faultCode ?? null,
              name: cycle.faultType ?? "Fault",
              machineSerial: firstState?.machine?.serial ?? serial ?? null,
              machineName: firstState?.machine?.name ?? machineName ?? null,
              operators: operators
                .filter(op => op && op.id !== -1)
                .map(op => ({ id: op.id, name: op.name ?? null, station: op.station ?? null })),
              items: items,
              activeStations: activeStations,
              workTimeMissedSeconds: workTimeMissedSeconds,
            };
          }).sort((a, b) => a.start - b.start);
        }

        // Transform summaries to match current format
        if (includeSummaries) {
          const summaryMap = new Map();
          
          for (const cycle of rawCycles) {
            const firstState = cycle.states?.[0];
            const operators = firstState?.operators || [];
            const activeStations = operators.filter(op => op && op.id !== -1).length;
            const durationSeconds = Math.max(0, Math.floor((cycle.end - cycle.start) / 1000));
            const workTimeMissedSeconds = activeStations * durationSeconds;
            
            const key = `${cycle.faultCode ?? null}|${cycle.faultType ?? "Fault"}`;
            const prev = summaryMap.get(key) || {
              code: cycle.faultCode ?? null,
              name: cycle.faultType ?? "Fault",
              count: 0,
              totalDurationSeconds: 0,
              totalWorkTimeMissedSeconds: 0,
            };
            prev.count += 1;
            prev.totalDurationSeconds += durationSeconds;
            prev.totalWorkTimeMissedSeconds += workTimeMissedSeconds;
            summaryMap.set(key, prev);
          }

          faultSummaries = Array.from(summaryMap.values()).map(s => {
            const t = s.totalDurationSeconds;
            return {
              code: s.code,
              name: s.name,
              count: s.count,
              totalDurationSeconds: t,
              totalWorkTimeMissedSeconds: s.totalWorkTimeMissedSeconds,
              formatted: {
                hours: Math.floor(t / 3600),
                minutes: Math.floor((t % 3600) / 60),
                seconds: t % 60,
              },
            };
          });
        }
      } else if (hasOperator) {
        // Fetch states for the operator (across all machines)
        const states = await fetchStatesForOperator(db, operatorId, paddedStart, paddedEnd);

        if (!states.length) {
          const response = {
            context: { start: startDate, end: endDate, operatorId, operatorName: null },
          };
          
          if (includeCycles) response.faultCycles = [];
          if (includeSummaries) response.faultSummaries = [];
          
          return res.json(response);
        }

        // Group states by operator and machine serial
        const groupedStates = groupStatesByOperatorAndSerial(states);
        const summaryMap = new Map();

        // Process each machine's states separately
        for (const [key, group] of Object.entries(groupedStates)) {
          const machineStates = group.states;
          const machineSerial = group.machineSerial;
          
          // Get machine name from first state
          const machineNameForGroup = machineStates[0]?.machine?.name || `Machine ${machineSerial}`;
          
          // Get operator info
          const operatorInfo = group.operator;
          if (!operatorName && operatorInfo?.name) {
            operatorName = operatorInfo.name;
          }

          // Extract fault cycles for this machine
          const { faultCycles: rawCycles, faultSummaries: rawSummaries } = extractFaultCycles(
            machineStates,
            startDate,
            endDate
          );

          // Transform cycles to match current format
          if (includeCycles) {
            const machineFaultCycles = rawCycles.map(cycle => {
              // Get operators from the first state in the cycle - filter to this operator only
              const firstState = cycle.states?.[0];
              const allOperators = firstState?.operators || [];
              const opsForOperator = allOperators.filter(op => op && op.id === operatorId);
              const activeStations = opsForOperator.length;
              
              // Calculate duration in seconds
              const durationSeconds = Math.max(0, Math.floor((cycle.end - cycle.start) / 1000));
              const workTimeMissedSeconds = activeStations * durationSeconds;

              // Get items from program if available
              const items = firstState?.program?.items 
                ? Object.values(firstState.program.items).filter(item => item && item.id !== undefined)
                : [];

              return {
                id: null, // No session ID in state-based approach
                start: cycle.start,
                end: cycle.end,
                durationSeconds: durationSeconds,
                code: cycle.faultCode ?? null,
                name: cycle.faultType ?? "Fault",
                machineSerial: machineSerial ?? null,
                machineName: machineNameForGroup ?? null,
                operators: opsForOperator.map(op => ({ 
                  id: op.id, 
                  name: op.name ?? operatorInfo?.name ?? null, 
                  station: op.station ?? null 
                })),
                items: items,
                activeStations: activeStations,
                workTimeMissedSeconds: workTimeMissedSeconds,
              };
            });

            allFaultCycles.push(...machineFaultCycles);
          }

          // Aggregate summaries across all machines
          if (includeSummaries) {
            for (const cycle of rawCycles) {
              const firstState = cycle.states?.[0];
              const allOperators = firstState?.operators || [];
              const opsForOperator = allOperators.filter(op => op && op.id === operatorId);
              const activeStations = opsForOperator.length;
              const durationSeconds = Math.max(0, Math.floor((cycle.end - cycle.start) / 1000));
              const workTimeMissedSeconds = activeStations * durationSeconds;
              
              const summaryKey = `${cycle.faultCode ?? null}|${cycle.faultType ?? "Fault"}`;
              const prev = summaryMap.get(summaryKey) || {
                code: cycle.faultCode ?? null,
                name: cycle.faultType ?? "Fault",
                count: 0,
                totalDurationSeconds: 0,
                totalWorkTimeMissedSeconds: 0,
              };
              prev.count += 1;
              prev.totalDurationSeconds += durationSeconds;
              prev.totalWorkTimeMissedSeconds += workTimeMissedSeconds;
              summaryMap.set(summaryKey, prev);
            }
          }
        }

        // Sort all cycles by start time
        if (includeCycles) {
          allFaultCycles.sort((a, b) => a.start - b.start);
        }

        // Format summaries
        if (includeSummaries) {
          faultSummaries = Array.from(summaryMap.values()).map(s => {
            const t = s.totalDurationSeconds;
            return {
              code: s.code,
              name: s.name,
              count: s.count,
              totalDurationSeconds: t,
              totalWorkTimeMissedSeconds: s.totalWorkTimeMissedSeconds,
              formatted: {
                hours: Math.floor(t / 3600),
                minutes: Math.floor((t % 3600) / 60),
                seconds: t % 60,
              },
            };
          });
        }

        // Set operator name if not found
        if (!operatorName) {
          operatorName = `Operator ${operatorId}`;
        }
      }

      const response = {
        context: { start: startDate, end: endDate, serial, machineName, operatorId, operatorName },
      };
      
      if (includeCycles) response.faultCycles = allFaultCycles;
      if (includeSummaries) response.faultSummaries = faultSummaries;

      return res.json(response);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  return router;
};
