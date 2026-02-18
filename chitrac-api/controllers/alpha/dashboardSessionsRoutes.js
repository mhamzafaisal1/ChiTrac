// routes/analytics/item-stacked-by-hour.js
const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams } = require("../../utils/time");
const { buildItemStackRelative } = require("../../utils/dashboardFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  router.get("/analytics/item-stacked-by-hour", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      let endDate = new Date(end);
      const now = new Date();
      if (endDate > now) endDate = now;

      const operatorParam = req.query.operatorId;
      const serialParam = req.query.serial;

      if (!operatorParam && !serialParam) {
        return res.status(400).json({ error: "Provide serial or operatorId" });
      }

      const operatorId = operatorParam != null ? Number(operatorParam) : null;
      const serial = serialParam != null ? Number(serialParam) : null;

      const hasOp = operatorId != null;
      const hasSerial = serial != null;
      const mode = hasOp && hasSerial ? "both" : hasOp ? "operator" : "machine";

      // If operatorId is present (alone or with serial), use operator-sessions.
      const sessCol = hasOp
        ? db.collection(config.operatorSessionCollectionName)
        : db.collection(config.machineSessionCollectionName);

      const opMatch = hasOp
        ? { $or: [{ "operator.id": operatorId }, { "operator.id": String(operatorId) }] }
        : null;

      const serialMatch = hasSerial
        ? { $or: [{ "machine.serial": serial }, { "machine.serial": String(serial) }] }
        : null;

      // When both are provided, require BOTH at session level.
      const idMatch = hasOp
        ? (hasSerial ? { $and: [opMatch, serialMatch] } : opMatch)
        : serialMatch;

      const rows = await sessCol.aggregate([
        { $match: idMatch },
        {
          $addFields: {
            s: { $toDate: "$timestamps.start" },
            e: { $toDate: { $ifNull: ["$timestamps.end", endDate] } }
          }
        },
        {
          $match: {
            $expr: {
              $and: [
                { $lte: ["$s", endDate] },
                { $gte: ["$e", startDate] }
              ]
            }
          }
        },
        // Filter counts to window and exclude misfeeds.
        // If both filters provided, also restrict counts to that machine serial.
        {
          $project: {
            filteredCounts: {
              $filter: {
                input: { $ifNull: ["$counts", []] },
                as: "c",
                cond: {
                  $and: [
                    { $gte: ["$$c.timestamp", startDate] },
                    { $lte: ["$$c.timestamp", endDate] },
                    { $ne: ["$$c.misfeed", true] },
                    ...(hasOp && hasSerial
                      ? [{
                          $or: [
                            { $eq: ["$$c.machine.serial", serial] },
                            { $eq: ["$$c.machine.serial", String(serial)] }
                          ]
                        }]
                      : [])
                  ]
                }
              }
            }
          }
        },
        { $unwind: { path: "$filteredCounts", preserveNullAndEmptyArrays: false } },
        {
          $project: {
            _id: 0,
            timestamp: "$filteredCounts.timestamp",
            itemName: { $ifNull: ["$filteredCounts.item.name", "Unknown"] }
          }
        }
      ]).toArray();

      const payload = buildItemStackRelative(rows, startDate, endDate);

      return res.json({
        ...payload,
        meta: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          serial: hasSerial ? serial : null,
          operatorId: hasOp ? operatorId : null,
          mode
        }
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: "Failed to build item stacked chart" });
    }
  });

  return router;
};
