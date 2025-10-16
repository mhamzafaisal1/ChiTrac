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

  // NEW: Simplified cached version using simulator's item entity records (with itemStandard built-in)
  router.get("/analytics/items-summary-daily-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      logger.info(`[items-summary-daily-cache] Query start: ${exactStart.toISOString()}, end: ${exactEnd.toISOString()}`);

      // ---------- Check if we're querying complete days ----------
      const startOfDayStart = new Date(exactStart);
      startOfDayStart.setHours(0, 0, 0, 0);
      
      const endOfDayEnd = new Date(exactEnd);
      endOfDayEnd.setHours(23, 59, 59, 999);
      
      const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
      const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
      const isSameDay = exactStart.toISOString().split('T')[0] === exactEnd.toISOString().split('T')[0];
      
      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);
      
      logger.info(`[items-summary-daily-cache] Time window analysis:`, {
        isStartOfDay,
        isEndOfDay,
        isSameDay,
        isPartialDay,
        startDate: exactStart.toISOString().split('T')[0],
        endDate: exactEnd.toISOString().split('T')[0],
        startTime: exactStart.toISOString().split('T')[1],
        endTime: exactEnd.toISOString().split('T')[1]
      });

      // If querying a partial day, MUST use session data for accurate time windowing
      if (isPartialDay) {
        logger.warn(`[items-summary-daily-cache] ⚠️ PARTIAL DAY DETECTED - Falling back to session-based query for accurate time windowing`);
        logger.warn(`[items-summary-daily-cache] Reason: Cached item records contain cumulative daily totals, not time-windowed data`);
        logger.warn(`[items-summary-daily-cache] Redirecting to session-based calculation`);
        
        // Fall back to session-based approach using the existing helper function
        const partialDays = [{ start: exactStart, end: exactEnd }];
        const sessionItems = await getItemsSessionDataForPartialDays(partialDays, db, logger);
        
        logger.info(`[items-summary-daily-cache] Retrieved ${sessionItems.length} item records from sessions`);
        
        // Process session data
        const resultsMap = new Map();
        
        for (const item of sessionItems) {
          const itemId = String(item.itemId);
          
          if (!resultsMap.has(itemId)) {
            resultsMap.set(itemId, {
              itemId: item.itemId,
              itemName: item.itemName || "Unknown",
              standardRaw: item.itemStandard ?? 0,
              count: 0,
              workedSec: 0,
            });
          }
          
          const acc = resultsMap.get(itemId);
          acc.count += item.totalCounts || 0;
          acc.workedSec += (item.workedTimeMs || 0) / 1000;
        }
        
        const normalizePPH = (std) => {
          const n = Number(std) || 0;
          return n > 0 && n < 60 ? n * 60 : n;
        };
        
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
        
        logger.info(`[items-summary-daily-cache] Returning ${results.length} items from session-based fallback`);
        return res.json(results);
      }

      // ---------- Hybrid query configuration (for multi-day queries) ----------
      const HYBRID_THRESHOLD_HOURS = 24; // Configurable threshold for hybrid approach
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // Determine if we should use hybrid approach
      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
      
      logger.info(`[items-summary-daily-cache] Strategy: ${useHybrid ? 'HYBRID' : 'CACHE ONLY'}, time range: ${timeRangeHours.toFixed(2)} hours`);

      // ---------- helpers (local to route) ----------
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
      };

      // ---------- 1) Time range splitting and data collection ----------
      let itemTotals = [];

      if (useHybrid) {
        // Split time range into complete days and partial days
        const { completeDays, partialDays } = splitTimeRangeForHybridItems(exactStart, exactEnd);
        
        logger.info(`[items-summary-daily-cache] Hybrid split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
        logger.info(`[items-summary-daily-cache] Complete days:`, completeDays.map(d => d.dateStr));
        logger.info(`[items-summary-daily-cache] Partial days:`, partialDays.map(d => ({ start: d.start.toISOString(), end: d.end.toISOString() })));
        
        // Get data from daily cache for complete days (using simulator's item records)
        if (completeDays.length > 0) {
          itemTotals = await getItemsCachedDataForDays(completeDays, db);
          logger.info(`[items-summary-daily-cache] Retrieved ${itemTotals.length} item records from cache for complete days`);
        }
        
        // Get data from sessions for partial days
        if (partialDays.length > 0) {
          const sessionData = await getItemsSessionDataForPartialDays(partialDays, db, logger);
          logger.info(`[items-summary-daily-cache] Retrieved ${sessionData.length} item records from sessions for partial days`);
          itemTotals = combineItemsHybridData(itemTotals, sessionData);
          logger.info(`[items-summary-daily-cache] Combined to ${itemTotals.length} total item records`);
        }
        
      } else {
        // For same-day queries spanning complete days, use cached data
        const cacheCollection = db.collection('totals-daily');
        
        // Calculate date range for query
        const startDate = exactStart.toISOString().split('T')[0];
        const endDate = exactEnd.toISOString().split('T')[0];

        logger.info(`[items-summary-daily-cache] Querying cache for complete day(s): ${startDate} to ${endDate}`);

        // Get item daily totals from simulator (with itemStandard already included)
        const itemQuery = { 
          entityType: 'item',
          source: 'simulator', // Only get simulator records
          dateObj: { 
            $gte: new Date(startDate + 'T00:00:00.000Z'), 
            $lte: new Date(endDate + 'T23:59:59.999Z') 
          }
        };

        itemTotals = await cacheCollection.find(itemQuery).toArray();
        logger.info(`[items-summary-daily-cache] Retrieved ${itemTotals.length} item records from cache`);
      }

      if (!itemTotals.length) {
        logger.warn(`[items-summary-daily-cache] No item totals found, returning empty array`);
        return res.json([]);
      }

      // ---------- 2) Process item data ----------
      const resultsMap = new Map();

      logger.info(`[items-summary-daily-cache] Processing ${itemTotals.length} item total records`);

      // Group item totals by item ID
      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);
        
        if (!resultsMap.has(itemId)) {
          resultsMap.set(itemId, {
            itemId: itemTotal.itemId,
            itemName: itemTotal.itemName || "Unknown",
            standardRaw: itemTotal.itemStandard ?? 0, // itemStandard is built into simulator's item record
            count: 0,
            workedSec: 0,
          });
        }
        
        const acc = resultsMap.get(itemId);
        acc.count += itemTotal.totalCounts || 0;
        acc.workedSec += (itemTotal.workedTimeMs || 0) / 1000; // Convert to seconds
        
        logger.debug(`[items-summary-daily-cache] Item ${itemId} (${itemTotal.itemName}): +${itemTotal.totalCounts} counts, +${(itemTotal.workedTimeMs/1000).toFixed(0)}s worked time`);
      }

      logger.info(`[items-summary-daily-cache] Aggregated into ${resultsMap.size} unique items`);

      // ---------- 3) Finalize results (same format as original route) ----------
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

      logger.info(`[items-summary-daily-cache] Returning ${results.length} items in final response`);
      logger.info(`[items-summary-daily-cache] Sample: ${results[0]?.itemName} - ${results[0]?.count} counts in ${results[0]?.workedTimeFormatted?.hours}h ${results[0]?.workedTimeFormatted?.minutes}m`);

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate items summary from daily cache" });
    }
  });

  // Helper functions for items summary hybrid queries
  function splitTimeRangeForHybridItems(exactStart, exactEnd) {
    const completeDays = [];
    const partialDays = [];
    
    const startOfDayStart = new Date(exactStart);
    startOfDayStart.setHours(0, 0, 0, 0);
    
    const startOfDayEnd = new Date(exactEnd);
    startOfDayEnd.setHours(0, 0, 0, 0);
    
    // Check if start time is at midnight
    const startIsFullDay = exactStart.getTime() === startOfDayStart.getTime();
    
    // Check if end time is at end of day (23:59:59.999)
    const endOfDayEnd = new Date(startOfDayEnd);
    endOfDayEnd.setHours(23, 59, 59, 999);
    const endIsFullDay = exactEnd.getTime() >= endOfDayEnd.getTime();
    
    // If start is not at midnight, add partial day for start
    if (!startIsFullDay) {
      const endOfStartDay = new Date(startOfDayStart);
      endOfStartDay.setHours(23, 59, 59, 999);
      partialDays.push({
        start: exactStart,
        end: exactEnd < endOfStartDay ? exactEnd : endOfStartDay
      });
      startOfDayStart.setDate(startOfDayStart.getDate() + 1);
    }
    
    // Add complete days
    const currentDay = new Date(startOfDayStart);
    while (currentDay < startOfDayEnd) {
      completeDays.push({
        dateStr: currentDay.toISOString().split('T')[0],
        start: new Date(currentDay),
        end: new Date(currentDay.getTime() + 24 * 60 * 60 * 1000 - 1)
      });
      currentDay.setDate(currentDay.getDate() + 1);
    }
    
    // If end is not at end of day and we're on a different day than start partial, add partial day for end
    if (!endIsFullDay && startOfDayEnd >= startOfDayStart) {
      const startOfEndDay = new Date(startOfDayEnd);
      startOfEndDay.setHours(0, 0, 0, 0);
      
      // Only add if not already covered by start partial day
      if (startOfEndDay.getTime() !== startOfDayStart.getTime() || startIsFullDay) {
        partialDays.push({
          start: startOfEndDay,
          end: exactEnd
        });
      }
    }
    
    return { completeDays, partialDays };
  }

  async function getItemsCachedDataForDays(completeDays, db) {
    const cacheCollection = db.collection('totals-daily');
    const dateStrings = completeDays.map(day => day.dateStr);
    
    logger.info(`[getItemsCachedDataForDays] Querying cache for dates:`, dateStrings);
    
    // Get item daily totals from simulator (itemStandard already included)
    const itemQuery = { 
      entityType: 'item',
      source: 'simulator', // Only get simulator records
      date: { $in: dateStrings }
    };

    const itemTotals = await cacheCollection.find(itemQuery).toArray();
    
    logger.info(`[getItemsCachedDataForDays] Found ${itemTotals.length} item records from cache`);
    if (itemTotals.length > 0) {
      logger.debug(`[getItemsCachedDataForDays] Sample record:`, {
        itemId: itemTotals[0].itemId,
        itemName: itemTotals[0].itemName,
        totalCounts: itemTotals[0].totalCounts,
        workedTimeMs: itemTotals[0].workedTimeMs,
        date: itemTotals[0].date,
        contributingMachines: itemTotals[0].contributingMachines
      });
    }
    
    return itemTotals;
  }

  async function getItemsSessionDataForPartialDays(partialDays, db, logger) {
    const items = [];
    const now = new Date();
    
    logger.info(`[getItemsSessionDataForPartialDays] Processing ${partialDays.length} partial day ranges`);
    
    // Get active machine serials
    const activeSerials = await db
      .collection(config.machineCollectionName || "machine")
      .distinct("serial", { active: true });
    
    logger.info(`[getItemsSessionDataForPartialDays] Found ${activeSerials.length} active machines`);
    
    for (const partialDay of partialDays) {
      logger.debug(`[getItemsSessionDataForPartialDays] Processing partial day: ${partialDay.start.toISOString()} to ${partialDay.end.toISOString()}`);
      
      for (const serial of activeSerials) {
        // Clamp to actual running window per machine
        const bookended = await getBookendedStatesAndTimeRange(db, serial, partialDay.start, partialDay.end);
        if (!bookended) continue;
        const { sessionStart, sessionEnd } = bookended;
        
        logger.debug(`[getItemsSessionDataForPartialDays] Machine ${serial} bookended window: ${sessionStart.toISOString()} to ${sessionEnd.toISOString()}`);

        // Pull overlapping item-sessions
        const sessions = await db
          .collection(config.itemSessionCollectionName || "item-session")
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
            item: 1,
            items: 1,
            counts: 1,
            totalCount: 1,
            workTime: 1,
            runtime: 1,
            activeStations: 1,
            operators: 1,
            timestamps: 1,
          })
          .toArray();

        if (!sessions.length) {
          logger.debug(`[getItemsSessionDataForPartialDays] No sessions found for machine ${serial}`);
          continue;
        }
        
        logger.debug(`[getItemsSessionDataForPartialDays] Machine ${serial}: Found ${sessions.length} item sessions`);

        for (const s of sessions) {
          const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
          if (!itm || itm.id == null) continue;

          const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
          const sessEnd = new Date(s.timestamps?.end || now);
          if (!sessStart || Number.isNaN(sessStart.getTime())) continue;

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

          items.push({
            itemId: itm.id,
            itemName: itm.name || "Unknown",
            itemStandard: itm.standard ?? 0,
            totalCounts: countInWin,
            workedTimeMs: workedSec * 1000, // Convert to milliseconds
          });
        }
      }
    }
    
    logger.info(`[getItemsSessionDataForPartialDays] Collected ${items.length} total item records from sessions`);
    
    return items;
  }

  function combineItemsHybridData(cachedItems, sessionItems) {
    const itemMap = new Map();
    
    logger.info(`[combineItemsHybridData] Combining ${cachedItems.length} cached items with ${sessionItems.length} session items`);
    
    // Add cached data
    for (const item of cachedItems) {
      const key = String(item.itemId);
      itemMap.set(key, item);
    }
    
    // Add/combine session data
    for (const item of sessionItems) {
      const key = String(item.itemId);
      if (itemMap.has(key)) {
        // Combine with existing cached data
        const existing = itemMap.get(key);
        const oldCounts = existing.totalCounts || 0;
        const oldWorkedMs = existing.workedTimeMs || 0;
        
        existing.totalCounts = (existing.totalCounts || 0) + item.totalCounts;
        existing.workedTimeMs = (existing.workedTimeMs || 0) + item.workedTimeMs;
        
        logger.debug(`[combineItemsHybridData] Combined item ${key}: ${oldCounts} + ${item.totalCounts} = ${existing.totalCounts} counts`);
        
        // Use the higher standard value if available
        if (item.itemStandard && item.itemStandard > (existing.itemStandard || 0)) {
          existing.itemStandard = item.itemStandard;
        }
      } else {
        itemMap.set(key, item);
        logger.debug(`[combineItemsHybridData] Added new item ${key}: ${item.totalCounts} counts`);
      }
    }
    
    logger.info(`[combineItemsHybridData] Result: ${itemMap.size} unique items`);
    
    return Array.from(itemMap.values());
  }

  return router;
};
