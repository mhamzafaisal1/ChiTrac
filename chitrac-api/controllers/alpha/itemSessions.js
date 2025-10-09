const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const { getBookendedStatesAndTimeRange } = require("../../utils/bookendingBuilder");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // ---- /api/alpha/analytics/items-summary-daily-cached ----
  router.get("/analytics/items-summary-daily-cached", async (req, res) => {
    try {
      const { start, end, itemId } = parseAndValidateQueryParams(req);
      
      // Get today's date string in Chicago timezone
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];
      
      logger.info(`[itemSessions] Fetching daily cached items summary for date: ${dateStr}, itemId: ${itemId || 'all'}`);
      
      // Build query filter for totals-daily collection
      const filter = { 
        entityType: 'machine-item',
        date: dateStr
      };
      
      // Add item filter if specified
      if (itemId) {
        filter.itemId = parseInt(itemId);
      }
      
      // Query the totals-daily collection
      const cacheRecords = await db.collection('totals-daily')
        .find(filter)
        .toArray();
      
      if (cacheRecords.length === 0) {
        logger.warn(`[itemSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`);
        // Fallback to real-time calculation (items-summary route)
        return res.json([]);
      }
      
      // Helper function to normalize PPH standards
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM → PPH
      };
      
      // Group by item ID and aggregate metrics across machines
      const itemMap = new Map();
      
      for (const record of cacheRecords) {
        const itmId = record.itemId;
        
        if (!itemMap.has(itmId)) {
          itemMap.set(itmId, {
            itemId: record.itemId,
            itemName: record.itemName,
            standardRaw: record.itemStandard || 0,
            count: 0,
            workedSec: 0
          });
        }
        
        const itemData = itemMap.get(itmId);
        
        // Aggregate counts and worked time across all machines
        itemData.count += record.totalCounts;
        itemData.workedSec += (record.workedTimeMs / 1000);
        
        // Update standard if not set
        if (!itemData.standardRaw && record.itemStandard) {
          itemData.standardRaw = record.itemStandard;
        }
      }
      
      // Transform to expected format
      const results = Array.from(itemMap.values()).map((entry) => {
        const workedMs = Math.round(entry.workedSec * 1000);
        const hours = workedMs / 3_600_000;
        const pph = hours > 0 ? entry.count / hours : 0;
        const stdPPH = normalizePPH(entry.standardRaw);
        const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(workedMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standardRaw ?? 0,
          efficiency: Math.round(efficiencyPct * 100) / 100,
        };
      });
      
      logger.info(`[itemSessions] Retrieved ${results.length} daily cached item records for date: ${dateStr}`);
      res.json(results);
      
    } catch (err) {
      logger.error(`[itemSessions] Error in daily cached items-summary route:`, err);
      
      // Check if it's a validation error
      if (err.message && (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date'))) {
        return res.status(400).json({ error: err.message });
      }
      
      // Return empty array on error (consistent with real-time route behavior)
      logger.info(`[itemSessions] Returning empty array due to error`);
      res.json([]);
    }
  });

  // /analytics/item-dashboard-summary — sessions-based, using item-sessions and bookending helper
  router.get("/analytics/items-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      // 1) Same as old route: iterate active machines only, use bookending helper per serial
      const machineSerials = await db
        .collection(config.machineCollectionName || "machine")
        .distinct("serial", { active: true });
      const resultsMap = new Map();
      const now = new Date();
      const itemSessColl = db.collection(config.itemSessionCollectionName || "item-session");

      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
      };

      for (const serial of machineSerials) {
        const bookended = await getBookendedStatesAndTimeRange(db, serial, start, end);
        if (!bookended) continue;

        const { sessionStart, sessionEnd } = bookended;

        // 2) Pull item-sessions overlapping the bookended window for this machine
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
            item: 1, // { id, name, standard } (preferred)
            items: 1, // single-item legacy fallback
            counts: 1, // [{timestamp,...}] optional
            totalCount: 1, // optional rollup
            workTime: 1, // seconds (preferred)
            runtime: 1, // seconds (fallback)
            activeStations: 1,
            operators: 1,
            timestamps: 1, // nested doc with start/end
          })
          .toArray();

        if (!sessions.length) continue;

        for (const s of sessions) {
          // 3) Resolve single item from session
          const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
          if (!itm || itm.id == null) continue;

          // 4) Truncate to bookended window
          const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
          const sessEnd = new Date(s.timestamps?.end || now);
          if (!sessStart || Number.isNaN(sessStart.getTime())) continue;
          if (!sessEnd || Number.isNaN(sessEnd.getTime())) continue;
          const ovStart = sessStart > sessionStart ? sessStart : sessionStart;
          const ovEnd = sessEnd < sessionEnd ? sessEnd : sessionEnd;
          if (!(ovEnd > ovStart)) continue;

          const sessSec = Math.max(0, (sessEnd - sessStart) / 1000);
          const ovSec = Math.max(0, (ovEnd - ovStart) / 1000);
          if (sessSec === 0 || ovSec === 0) continue;

          // 5) Worked time seconds (prefer workTime; else runtime * stations), prorated to overlap
          const stations =
            typeof s.activeStations === "number"
              ? s.activeStations
              : (Array.isArray(s.operators) ? s.operators.length : 0);
          const baseWorkSec = typeof s.workTime === "number"
            ? s.workTime
            : typeof s.runtime === "number"
              ? s.runtime * Math.max(1, stations)
              : 0;
          const workedSec = baseWorkSec > 0 ? baseWorkSec * (ovSec / sessSec) : 0;

          // 6) Counts within overlap: use counts[] if present; else prorate totalCount
          let countInWin = 0;
          if (Array.isArray(s.counts) && s.counts.length) {
            if (s.counts.length > 50000) {
              // large array: fall back to prorating by overlap fraction
              countInWin = typeof s.totalCount === "number" ? Math.round(s.totalCount * (ovSec / sessSec)) : 0;
            } else {
              countInWin = s.counts.reduce((acc, c) => {
                const t = new Date(c.timestamp);
                // (defensive) ensure item matches if present
                const sameItem = !c.item?.id || c.item.id === itm.id;
                return acc + (sameItem && t >= ovStart && t <= ovEnd ? 1 : 0);
              }, 0);
            }
          } else if (typeof s.totalCount === "number") {
            countInWin = Math.round(s.totalCount * (ovSec / sessSec));
          }

          // 7) Aggregate by itemId
          const key = String(itm.id);
          if (!resultsMap.has(key)) {
            resultsMap.set(key, {
              itemId: itm.id,
              itemName: itm.name || "Unknown",
              standardRaw: itm.standard ?? 0,
              count: 0,
              workedSec: 0,
            });
          }
          const acc = resultsMap.get(key);
          acc.count += countInWin;
          acc.workedSec += workedSec;
          if (!acc.itemName && itm.name) acc.itemName = itm.name;
          if (!acc.standardRaw && itm.standard != null) acc.standardRaw = itm.standard;
        }
      }

      // 8) Finalize metrics (same math as before)
      const results = Array.from(resultsMap.values()).map((entry) => {
        const workedMs = Math.round(entry.workedSec * 1000);
        const hours = workedMs / 3_600_000;
        const pph = hours > 0 ? entry.count / hours : 0;
        const stdPPH = normalizePPH(entry.standardRaw);
        const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(workedMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standardRaw ?? 0,
          efficiency: Math.round(efficiencyPct * 100) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate item dashboard summary" });
    }
  });

  return router;
};
