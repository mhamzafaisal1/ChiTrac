const { isFault } = require("../../utils/machineStatus");
const express = require("express");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;


  const {
    buildLevelTwoPerformance,
    buildOperatorEfficiencyAvg,
    fetchGroupedAnalyticsData,
  } = require("../../utils/level-twoBuilder");

  router.get("/leveltwo", async (req, res) => {
    try {
      const serial = parseInt(req.query.serial);
      if (!serial) return res.status(400).json({ error: "Missing serial" });
  
      const { DateTime } = require("luxon");
      
      // Handle date parameter - if provided, use that date; otherwise use current date
      let targetDate;
      if (req.query.date) {
        try {
          targetDate = DateTime.fromISO(req.query.date);
          if (!targetDate.isValid) {
            return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
          }
        } catch (error) {
          return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
        }
      } else {
        targetDate = DateTime.local();
      }
      
      // Set time range: midnight of the target date to current time (or end of target date if it's not today)
      const start = targetDate.startOf("day").toJSDate();
      const end = targetDate.hasSame(DateTime.local(), 'day') 
        ? new Date() // If target date is today, use current time
        : targetDate.endOf("day").toJSDate(); // If target date is in the past, use end of that day
  
      const groupedData = await fetchGroupedAnalyticsData(
        db,
        start,
        end,
        "machine",
        { targetSerials: [serial] }
      );
  
      const group = groupedData?.[serial];
      if (!group) return res.status(404).json({ error: "Machine not found or no data" });
  
      const { states, counts } = group;
  
      // PERFORMANCE METRICS
      const performance = await buildLevelTwoPerformance(
        states,
        counts.valid,
        counts.misfeed,
        start,
        end
      );
  
      const operatorEfficiency = await buildOperatorEfficiencyAvg(
        states,
        counts.valid,
        start,
        end,
        serial
      );
  
      // CURRENT PROGRAM + ITEM (from most recent state)
      const latestState = [...states].reverse().find(s => s.program);
      const programNumber = latestState?.program?.programNumber ?? 0;
      
      // Get current item information from most recent state's program.items
      let itemName = "Unknown";
      let itemId = 0;
      
      if (Array.isArray(latestState?.program?.items)) {
        const itemNames = latestState.program.items.filter(Boolean);
      
        if (itemNames.length === 1) {
          itemName = itemNames[0];
          itemId = 0; // No reliable ID from state
        } else if (itemNames.length > 1) {
          itemName = itemNames.join(" + ");
          itemId = 0; // Still ambiguous → default to 0
        }
      }
      
  
      // BUILD RESPONSE
      const totalSeconds = (new Date(end) - new Date(start)) / 1000;
      const runSeconds = performance.runtime.total / 1000;
      const downSeconds = performance.downtime.total / 1000;
  
      const outputTotal = performance.output.totalCount;
      const misfeeds = performance.output.misfeedCount;
      const inputTotal = outputTotal + misfeeds;
  
      res.json({
        timers: {
          run: Math.round(runSeconds),
          down: Math.round(downSeconds),
          total: Math.round(totalSeconds),
        },
        programNumber,
        item: {
          id: itemId,
          name: itemName,
        },
        totals: {
          input: inputTotal,
          out: outputTotal,
          thru: parseFloat(performance.performance.throughput.percentage.replace('%', '')),
          faults: states.filter(s => isFault(s.status?.code)).length,
          jams: states.filter(s => s.status?.name?.toLowerCase().includes("jam")).length,
        },
        availability: parseFloat(performance.performance.availability.percentage.replace('%', '')),
        oee: parseFloat(performance.performance.oee.percentage.replace('%', '')),
        operatorEfficiency: parseFloat(operatorEfficiency.toFixed(2))
      });
    } catch (err) {
      logger.error("Error in /softrol/leveltwo:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return router;
}