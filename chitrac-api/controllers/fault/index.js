// routes/analytics/fault-history.js
const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams } = require("../../utils/time");
const { formatHumanName } = require("../../utils/humanNames");

const NON_FAULT_CODES = [0, 1, "0", "1", null];

function nonArrayField(path) {
  return {
    $cond: [{ $isArray: path }, null, path],
  };
}

function faultCodeExpression() {
  return {
    $ifNull: [
      nonArrayField("$states.start.status.id"),
      {
        $ifNull: [
          nonArrayField("$states.start.status.code"),
          {
            $ifNull: [
              "$startState.status.code",
              {
                $ifNull: ["$status.code", "$type"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function faultNameExpression() {
  return {
    $ifNull: [
      nonArrayField("$states.start.status.name"),
      {
        $ifNull: [
          "$startState.status.name",
          {
            $ifNull: ["$status.name", "Fault"],
          },
        ],
      },
    ],
  };
}

function buildFaultSessionMatch(startDate, endDate) {
  return {
    $and: [
      { "timestamps.start": { $lte: endDate } },
      {
        $or: [
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": { $gte: startDate } },
        ],
      },
      {
        $or: [
          { type: { $exists: true, $nin: NON_FAULT_CODES } },
          { "status.code": { $exists: true, $nin: NON_FAULT_CODES } },
          { "startState.status.code": { $exists: true, $nin: NON_FAULT_CODES } },
          { "states.start.status.id": { $exists: true, $nin: NON_FAULT_CODES } },
          { "states.start.status.code": { $exists: true, $nin: NON_FAULT_CODES } },
        ],
      },
    ],
  };
}

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

      // Base match: time overlap plus a real fault starting status.
      // Missing type is not enough; Mongo $nin matches missing fields.
      const match = buildFaultSessionMatch(startDate, endDate);

      // Add machine filter - support both machine.serial and machine.id
      if (hasSerial) {
        match.$and.push({
          $or: [
            { "machine.serial": serial },
            { "machine.id": serial }
          ]
        });
      }

      // Add operator filter
      if (hasOperator) {
        match.$and.push({
          $or: [
            { "operators.id": operatorId },
            { "operator.id": operatorId },
          ],
        });
      }

      // Pull overlapping fault-sessions and clip to [start,end]
      const raw = await db
        .collection(config.machineSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              // clip window
              ovStart: { $cond: [{ $gt: ["$timestamps.start", startDate] }, "$timestamps.start", startDate] },
              ovEnd: {
                $let: {
                  vars: {
                    // If timestamps.end is missing, the session was likely orphaned by a crash.
                    // Cap at start + 5 minutes instead of endDate to prevent 10+ hour phantom faults.
                    effectiveEnd: {
                      $ifNull: [
                        "$timestamps.end",
                        { $min: [{ $add: ["$timestamps.start", 5 * 60 * 1000] }, endDate] }
                      ]
                    }
                  },
                  in: {
                    $cond: [
                      { $gt: ["$$effectiveEnd", endDate] },
                      endDate,
                      "$$effectiveEnd"
                    ]
                  }
                }
              },
            },
          },
          { $match: { $expr: { $lt: ["$ovStart", "$ovEnd"] } } },
          // derive code/name from legacy state object, datafeed startState/status, or type.
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
              code: faultCodeExpression(),
              name: faultNameExpression(),
              // stored aggregates if present
              storedFaulttime: "$faulttime",
              storedWorkMissed: "$workTimeMissed",
            },
          },
          { $match: { code: { $nin: NON_FAULT_CODES } } },
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
            operatorName = formatHumanName(op.name, '');
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
                operatorName = formatHumanName(o.name);
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

  /**
   * Fault report: summary across all machines, grouped by fault code.
   * Uses session-machine collection (fault rows filtered by type).
   * Query params: start, end (required).
   */
  router.get("/analytics/fault-report-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const match = buildFaultSessionMatch(startDate, endDate);

      const raw = await db
        .collection(config.machineSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              ovStart: {
                $cond: [
                  { $gt: ["$timestamps.start", startDate] },
                  "$timestamps.start",
                  startDate,
                ],
              },
              ovEnd: {
                $let: {
                  vars: {
                    effectiveEnd: {
                      $ifNull: [
                        "$timestamps.end",
                        {
                          $min: [
                            { $add: ["$timestamps.start", 5 * 60 * 1000] },
                            endDate,
                          ],
                        },
                      ],
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: ["$$effectiveEnd", endDate] },
                      endDate,
                      "$$effectiveEnd",
                    ],
                  },
                },
              },
            },
          },
          { $match: { $expr: { $lt: ["$ovStart", "$ovEnd"] } } },
          {
            $project: {
              _id: 1,
              machine: 1,
              code: faultCodeExpression(),
              name: faultNameExpression(),
              faultTimestamp: "$timestamps.start",
              ovStart: 1,
              ovEnd: 1,
            },
          },
          { $match: { code: { $nin: NON_FAULT_CODES } } },
        ])
        .toArray();

      const summaryMap = new Map();
      for (const r of raw) {
        const code = r.code ?? null;
        const name = r.name ?? "Fault";
        const key = `${code}|${name}`;
        const durSec = Math.max(0, Math.floor((r.ovEnd - r.ovStart) / 1000));
        const prev = summaryMap.get(key) || {
          code,
          name,
          count: 0,
          totalDurationSeconds: 0,
          faults: [],
        };
        prev.count += 1;
        prev.totalDurationSeconds += durSec;
        prev.faults.push({
          id: r._id,
          timestamp: r.faultTimestamp,
          machineSerial: r.machine?.serial ?? r.machine?.id ?? null,
          machineName:
            r.machine?.name ??
            `Machine ${r.machine?.serial ?? r.machine?.id ?? "Unknown"}`,
          durationSeconds: durSec,
          formatted: {
            hours: Math.floor(durSec / 3600),
            minutes: Math.floor((durSec % 3600) / 60),
            seconds: durSec % 60,
          },
        });
        summaryMap.set(key, prev);
      }

      const summaries = Array.from(summaryMap.values()).map((s) => {
        const t = s.totalDurationSeconds;
        s.faults.sort(
          (a, b) =>
            b.durationSeconds - a.durationSeconds ||
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        return {
          code: s.code,
          name: s.name,
          count: s.count,
          totalDurationSeconds: t,
          formatted: {
            hours: Math.floor(t / 3600),
            minutes: Math.floor((t % 3600) / 60),
            seconds: t % 60,
          },
          faults: s.faults,
        };
      }).sort(
        (a, b) =>
          b.totalDurationSeconds - a.totalDurationSeconds ||
          String(a.name).localeCompare(String(b.name))
      );

      return res.json({
        context: { start: startDate, end: endDate },
        summaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault report summary" });
    }
  });

  /**
   * Fault report: detailed by machine then fault code.
   * Uses session-machine collection (fault rows filtered by type).
   * Query params: start, end (required).
   */
  router.get("/analytics/fault-report-detailed", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const match = buildFaultSessionMatch(startDate, endDate);

      const raw = await db
        .collection(config.machineSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              ovStart: {
                $cond: [
                  { $gt: ["$timestamps.start", startDate] },
                  "$timestamps.start",
                  startDate,
                ],
              },
              ovEnd: {
                $let: {
                  vars: {
                    effectiveEnd: {
                      $ifNull: [
                        "$timestamps.end",
                        {
                          $min: [
                            { $add: ["$timestamps.start", 5 * 60 * 1000] },
                            endDate,
                          ],
                        },
                      ],
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: ["$$effectiveEnd", endDate] },
                      endDate,
                      "$$effectiveEnd",
                    ],
                  },
                },
              },
            },
          },
          { $match: { $expr: { $lt: ["$ovStart", "$ovEnd"] } } },
          {
            $project: {
              machine: 1,
              code: faultCodeExpression(),
              name: faultNameExpression(),
              ovStart: 1,
              ovEnd: 1,
            },
          },
          { $match: { code: { $nin: NON_FAULT_CODES } } },
        ])
        .toArray();

      // Normalize machine serial/name
      raw.forEach((r) => {
        if (r.machine && !r.machine.serial && r.machine.id) {
          r.machine.serial = r.machine.id;
        }
      });

      const byMachine = new Map();
      for (const r of raw) {
        const serial = r.machine?.serial ?? r.machine?.id ?? "Unknown";
        const machineName = r.machine?.name ?? `Machine ${serial}`;
        const code = r.code ?? null;
        const name = r.name ?? "Fault";
        const key = `${serial}|${machineName}`;
        if (!byMachine.has(key)) {
          byMachine.set(key, { serial, machineName, byFault: new Map() });
        }
        const machineEntry = byMachine.get(key);
        const faultKey = `${code}|${name}`;
        const durSec = Math.max(0, Math.floor((r.ovEnd - r.ovStart) / 1000));
        const prev = machineEntry.byFault.get(faultKey) || {
          code,
          name,
          count: 0,
          totalDurationSeconds: 0,
        };
        prev.count += 1;
        prev.totalDurationSeconds += durSec;
        machineEntry.byFault.set(faultKey, prev);
      }

      const details = [];
      for (const { serial, machineName, byFault } of byMachine.values()) {
        for (const s of byFault.values()) {
          const t = s.totalDurationSeconds;
          details.push({
            machineSerial: serial,
            machineName,
            code: s.code,
            name: s.name,
            count: s.count,
            totalDurationSeconds: t,
            formatted: {
              hours: Math.floor(t / 3600),
              minutes: Math.floor((t % 3600) / 60),
              seconds: t % 60,
            },
          });
        }
      }

      return res.json({
        context: { start: startDate, end: endDate },
        details,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault report detailed" });
    }
  });

  return router;
};

