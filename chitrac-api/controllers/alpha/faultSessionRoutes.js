// routes/analytics/fault-history.js
const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams } = require("../../utils/time");

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
      // Support both machine.serial and machine.id
      const match = {
        "timestamps.start": { $lte: endDate },
        $or: [{ "timestamps.end": { $exists: false } }, { "timestamps.end": { $gte: startDate } }],
      };

      // Add machine filter - support both machine.serial and machine.id
      if (hasSerial) {
        match.$and = [
          {
            $or: [
              { "machine.serial": serial },
              { "machine.id": serial }
            ]
          }
        ];
      }

      // Add operator filter
      if (hasOperator) {
        match["operators.id"] = operatorId;
      }

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
          message: "No fault sessions found for the specified criteria",
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
      
      // Normalize machine serial/id in results
      raw.forEach(r => {
        if (r.machine && !r.machine.serial && r.machine.id) {
          r.machine.serial = r.machine.id;
        }
      });
      let operatorName = null;
      if (hasOperator) {
        // pick the first matching operator name from any session
        for (const r of raw) {
          const op = (r.operators || []).find(o => o.id === operatorId);
          if (op?.name) {
            // Handle operator name as string or object with first/surname
            if (typeof op.name === 'string') {
              operatorName = op.name;
            } else if (op.name.first || op.name.surname) {
              operatorName = `${op.name.first || ''} ${op.name.surname || ''}`.trim();
            }
            if (operatorName) break;
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
              operators: ops.map(o => {
                // Handle operator name as string or object with first/surname
                let operatorName = "Unknown";
                if (o.name) {
                  if (typeof o.name === 'string') {
                    operatorName = o.name;
                  } else if (o.name.first || o.name.surname) {
                    operatorName = `${o.name.first || ''} ${o.name.surname || ''}`.trim() || "Unknown";
                  }
                }
                return { id: o.id, name: operatorName, station: o.station };
              }),
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

  return router;
};
