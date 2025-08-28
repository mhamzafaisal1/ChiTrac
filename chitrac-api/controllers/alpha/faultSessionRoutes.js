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

      const hasSerial = serialParam != null;
      const hasOperator = operatorParam != null;
      if (!hasSerial && !hasOperator) {
        return res.status(400).json({ error: "Provide serial or operatorId" });
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
        return res.json({
          context: { start: startDate, end: endDate, serial, operatorId },
          faultCycles: [],
          faultSummaries: [],
        });
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

      // Build cycles (one cycle per fault-session)
      const faultCycles = raw
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

      // Summaries by fault code+name
      const summaryMap = new Map();
      for (const c of faultCycles) {
        const key = `${c.code || 0}|${c.name}`;
        const prev = summaryMap.get(key) || {
          code: c.code ?? null,
          name: c.name,
          count: 0,
          totalDurationSeconds: 0,
          totalWorkTimeMissedSeconds: 0,
        };
        prev.count += 1;
        prev.totalDurationSeconds += c.durationSeconds;
        prev.totalWorkTimeMissedSeconds += c.workTimeMissedSeconds;
        summaryMap.set(key, prev);
      }

      const faultSummaries = Array.from(summaryMap.values()).map(s => {
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

      return res.json({
        context: { start: startDate, end: endDate, serial, machineName, operatorId, operatorName },
        faultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  return router;
};
