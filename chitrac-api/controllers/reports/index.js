const express = require("express");
const nodemailer = require("nodemailer");
const { ObjectId } = require("mongodb");
const { parseAndValidateQueryParams, formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time");
const { DateTime } = require("luxon");
const {
  splitTimeRangeForHybridReport,
  getSessionDataForPartialDays,
  combineHybridData,
  getOperatorSessionDataForPartialDays,
  getItemSessionDataForPartialDays,
  getItemDailyCachedDataForDays,
  combineItemDailyHybridData,
} = require("../../utils/reportFunctions");

function isValidMachineReportRecipientEmail(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const reportSubscriptionRoutes = require("./reportSubscription")(server);

  router.get("/shifts", async (req, res) => {
    try {
      const shifts = await db
        .collection("shift")
        .find({ active: true })
        .sort({ name: 1 })
        .project({ name: 1, startTime: 1, endTime: 1, activeDays: 1, active: 1 })
        .toArray();
      res.json({
        shifts: shifts.map((s) => ({ ...s, _id: String(s._id) })),
      });
    } catch (err) {
      logger.error("[shifts] list failed", err);
      res.status(500).json({ error: "Failed to list shifts" });
    }
  });

  // Cached version of operator-item-sessions-summary using totals-daily collection
  router.get("/analytics/operator-item-sessions-summary-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
      
      // ========== FIX #1: Timezone-aware date handling ==========
      const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
      const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
      
      const normalizedStart = startDt.startOf('day');
      const normalizedEnd = endDt.startOf('day').plus({ days: 1 });
      const nowLocal = DateTime.now().setZone(SYSTEM_TIMEZONE);
      
      // Detect "today since midnight" → treat as complete day using cache
      const isTodaySinceMidnight =
        normalizedStart.hasSame(nowLocal, 'day') &&
        startDt.equals(normalizedStart) &&
        endDt <= nowLocal;
      
      console.log(`[OPERATOR-CACHE] Query: start=${startDt.toISO()}, end=${endDt.toISO()}, isTodaySinceMidnight=${isTodaySinceMidnight}`);
      
      // Always use UTC timestamps corresponding to local day boundaries
      const exactStart = normalizedStart.toUTC().toJSDate();
      const exactEnd = isTodaySinceMidnight 
        ? nowLocal.toUTC().toJSDate() 
        : endDt.toUTC().toJSDate();
      
      console.log(`[OPERATOR-CACHE] Normalized: ${exactStart.toISOString()} to ${exactEnd.toISOString()}`);

      // ---------- helpers (local to route) ----------
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

      // ========== FIX #3: Simplified hybrid logic with full-day detection ==========
      // Determine complete vs partial days
      let split;
      if (isTodaySinceMidnight) {
        // Special case: today since midnight → treat as complete day
        split = {
          completeDays: [{
            dateStr: normalizedStart.toISODate(),
            start: normalizedStart.toUTC().toJSDate(),
            end: nowLocal.toUTC().toJSDate(),
          }],
          partialDays: [],
        };
        console.log(`[OPERATOR-CACHE] Today-since-midnight: using cache for ${normalizedStart.toISODate()}`);
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
          console.log(`[OPERATOR-CACHE] Forced cache mode for full-day window ${normalizedStart.toISODate()}`);
        }

        console.log(`[OPERATOR-CACHE] Split: ${split.completeDays.length} complete days, ${split.partialDays.length} partial days`);
      }
      
      const { completeDays, partialDays } = split;
      
      // ========== Simplified hybrid logic: use cache for complete days, else sessions ==========
      let operatorMachineCache = [];
      let operatorItemCache = [];
      let sessionData = { operators: [] };
      let useCache = completeDays.length > 0;
      
      if (useCache) {
        const dateStrings = completeDays.map(d => d.dateStr);
        const dateObjs = dateStrings.map(str => new Date(str + 'T00:00:00.000Z'));
        const cacheCollection = db.collection('totals-daily');

        // Single query for both entity types with both date formats
        const cacheQuery = {
          $or: [
            { dateObj: { $in: dateObjs } },
            { date: { $in: dateStrings } }
          ],
          entityType: { $in: ['operator-machine', 'operator-item'] }
        };
        if (operatorId) cacheQuery.operatorId = operatorId;

        const cacheDocs = await cacheCollection.find(cacheQuery).toArray();

        // Split by entity type
        operatorMachineCache = cacheDocs.filter(d => d.entityType === 'operator-machine');
        operatorItemCache = cacheDocs.filter(d => d.entityType === 'operator-item');

        console.log(`[OPERATOR-CACHE] Retrieved ${operatorMachineCache.length} operator-machine + ${operatorItemCache.length} operator-item cache records`);

        // Log sample of what we got to diagnose zero counts
        if (operatorItemCache.length > 0) {
          const nonZeroItems = operatorItemCache.filter(item => item.totalCounts > 0);
          const zeroItems = operatorItemCache.filter(item => item.totalCounts === 0);
          console.log(`[OPERATOR-CACHE] operator-item breakdown: ${nonZeroItems.length} with counts > 0, ${zeroItems.length} with counts = 0`);

          if (nonZeroItems.length > 0) {
            const sample = nonZeroItems[0];
            console.log(`[OPERATOR-CACHE] Sample non-zero item: operator ${sample.operatorId}, item ${sample.itemId} (${sample.itemName}), counts=${sample.totalCounts}`);
          }
        }

        // If cache is empty, fallback to sessions for entire range
        if (operatorMachineCache.length === 0 && operatorItemCache.length === 0) {
          console.log(`[OPERATOR-CACHE] Cache empty, falling back to sessions for entire range`);
          sessionData = await getOperatorSessionDataForPartialDays(db,[{ start: exactStart, end: exactEnd }], operatorId);
          console.log(`[OPERATOR-CACHE] Session fallback returned ${sessionData.operators.length} operators`);
        }
      } else {
        // No complete days, use sessions for entire range
        console.log(`[OPERATOR-CACHE] No complete days, using sessions for entire range`);
        sessionData = await getOperatorSessionDataForPartialDays(db,[{ start: exactStart, end: exactEnd }], operatorId);
        console.log(`[OPERATOR-CACHE] Sessions returned ${sessionData.operators.length} operators`);
      }

      // ========== FIX #4: Aggregate operator-machine data by (operatorId, date) first ==========
      // This prevents machine duplication (operator working 4 machines = 4× runtime)
      const groupedByOperatorDay = new Map();
      
      for (const record of operatorMachineCache) {
        const key = `${record.operatorId}-${record.date}`;
        
        if (!groupedByOperatorDay.has(key)) {
          groupedByOperatorDay.set(key, {
            operatorId: record.operatorId,
            operatorName: record.operatorName,
            date: record.date,
            runtimeMs: 0,
            workedTimeMs: 0,
            totalCounts: 0,
            totalMisfeeds: 0,
            machines: new Set()
          });
        }
        
        const dayBucket = groupedByOperatorDay.get(key);
        dayBucket.runtimeMs += record.runtimeMs || 0;
        dayBucket.workedTimeMs += record.workedTimeMs || 0;
        dayBucket.totalCounts += record.totalCounts || 0;
        dayBucket.totalMisfeeds += record.totalMisfeeds || 0;
        if (record.machineSerial) {
          dayBucket.machines.add(record.machineSerial);
        }
      }
      
      // No capping - use raw values from data
      
      // ========== Aggregate across all days for each operator ==========
      const operatorDataMap = new Map();
      const opIdToName = new Map();
      
      // Process cached operator-machine totals (now per-day capped)
      for (const [key, dayBucket] of groupedByOperatorDay) {
        const opId = dayBucket.operatorId;
        const opName = dayBucket.operatorName;
        opIdToName.set(opId, opName);
        
        if (!operatorDataMap.has(opId)) {
          operatorDataMap.set(opId, {
            operator: { id: opId, name: opName },
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            daysWorked: 0,
            machinesWorked: new Set()
          });
        }
        
        const bucket = operatorDataMap.get(opId);
        bucket.totalCount += dayBucket.totalCounts;
        bucket.totalWorkedMs += dayBucket.workedTimeMs;
        bucket.totalRuntimeMs += dayBucket.runtimeMs;
        bucket.daysWorked += 1;
        dayBucket.machines.forEach(m => bucket.machinesWorked.add(m));
      }
      
      // ========== FIX #8: Ensure operators with only item cache (no machine cache) are included ==========
      for (const opItem of operatorItemCache) {
        const opId = opItem.operatorId;
        const opName = opItem.operatorName || `Operator ${opId}`;
        opIdToName.set(opId, opName);
        
        if (!operatorDataMap.has(opId)) {
          operatorDataMap.set(opId, {
            operator: { id: opId, name: opName },
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            daysWorked: 0,
            machinesWorked: new Set(),
          });
          console.log(`[OPERATOR-CACHE] Operator ${opId} found in item cache but not machine cache`);
        }
      }
      
      // Process session operator totals (for partial days only, NO overlap)
      for (const sessionOp of sessionData.operators) {
        const opId = sessionOp.operatorId;
        const opName = sessionOp.operatorName || `Operator ${opId}`;
        opIdToName.set(opId, opName);
        
        if (!operatorDataMap.has(opId)) {
          operatorDataMap.set(opId, {
            operator: { id: opId, name: opName },
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            daysWorked: 0,
            machinesWorked: new Set()
          });
        }
        
        const bucket = operatorDataMap.get(opId);
        // Add session data (only from partial days, guaranteed disjoint from completeDays)
        bucket.totalCount += sessionOp.totalCounts || 0;
        bucket.totalWorkedMs += sessionOp.workedTimeMs || 0;
        bucket.totalRuntimeMs += sessionOp.runtimeMs || 0;
      }
      
      console.log(`[OPERATOR-CACHE] Aggregated ${operatorDataMap.size} operators`);
      
      // Return empty results if no data found
      if (operatorDataMap.size === 0) {
        console.log(`[OPERATOR-CACHE] No data found — returning empty results`);
        return res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results: []
        });
      }

      // ---------- 2) Process operator data ----------
      const results = [];

      // Process each operator
      for (const [opId, operatorData] of operatorDataMap) {
        let proratedStandard = 0;
        const itemSummaries = {};

        // ========== FIX #2: Use operator-item cache (NOT machine-item) ==========
        // First, try operator-item cache data for complete days
        const opItemsForOperator = operatorItemCache.filter(oi => oi.operatorId === opId);
        
        // Second, try session item data for partial days
        const sessionOperator = sessionData.operators.find(op => op.operatorId === opId);
        const sessionItems = sessionOperator?.itemTotals || [];
        
        console.log(`[OPERATOR-CACHE] Operator ${opId}: ${opItemsForOperator.length} cache items, ${sessionItems.length} session items`);
        
        // ========== Group by itemName to sum up same items (operator + item combination) ==========
        // Group by itemName (not itemId) to combine items with same name but different standards
        // This aggregates across all dates/machines AND different itemIds for the same item name
        const allItemsMap = new Map(); // key: normalized itemName (String, case-insensitive)
        
        // Helper to normalize item name for consistent grouping
        // Handles whitespace, case, and common variations
        const normalizeItemName = (name) => {
          if (!name) return 'Unknown';
          // Convert to string if not already
          const str = String(name);
          // Trim and normalize whitespace (replace multiple spaces with single space)
          const normalized = str.trim().replace(/\s+/g, ' ').toLowerCase();
          return normalized || 'Unknown';
        };
        
        // Add cache items - group by itemName and sum metrics (prorate standard by counts)
        // Multiple cache records for same operator+item (different dates or different itemIds) will be aggregated here
        const seenItemNames = new Set(); // Track for logging duplicates
        console.log(`[OPERATOR-CACHE] Operator ${opId}: Processing ${opItemsForOperator.length} cache items`);
        for (const cacheItem of opItemsForOperator) {
          const normalizedName = normalizeItemName(cacheItem.itemName);
          if (normalizedName === 'Unknown' || !normalizedName) {
            console.log(`[OPERATOR-CACHE] Skipping item with no name for operator ${opId}, itemId: ${cacheItem.itemId}`);
            continue;
          }
          
          // Log all items being processed for debugging
          console.log(`[OPERATOR-CACHE] Operator ${opId}: Cache item - itemId: ${cacheItem.itemId}, originalName: "${cacheItem.itemName}", normalizedName: "${normalizedName}", counts: ${cacheItem.totalCounts}`);
          
          // Log if we see the same normalized name with different original names (potential duplicates)
          if (seenItemNames.has(normalizedName) && cacheItem.itemName) {
            const existingItem = allItemsMap.get(normalizedName);
            if (existingItem && existingItem.itemName !== cacheItem.itemName) {
              console.log(`[OPERATOR-CACHE] Operator ${opId}: Found item name variation - "${existingItem.itemName}" vs "${cacheItem.itemName}" (normalized: "${normalizedName}") - combining`);
            } else {
              console.log(`[OPERATOR-CACHE] Operator ${opId}: Duplicate normalized name "${normalizedName}" (same original name) - aggregating counts`);
            }
          }
          seenItemNames.add(normalizedName);
          
          const counts = Number(cacheItem.totalCounts) || 0;
          const standard = Number(cacheItem.itemStandard) || 0;
          // Cache records use totalTimeCreditMs instead of workedTimeMs
          const workedMs = Number(cacheItem.totalTimeCreditMs) || 0;
          
          if (!allItemsMap.has(normalizedName)) {
            allItemsMap.set(normalizedName, {
              itemName: cacheItem.itemName || 'Unknown', // Keep original casing for display
              totalCounts: 0,
              workedTimeMs: 0,
              standardWeightedSum: 0, // Sum of (count * standard) for prorated standard calculation
              totalCountsForStandard: 0 // Total counts used for standard calculation
            });
          }
          const item = allItemsMap.get(normalizedName);
          
          // Sum up all metrics for same item name (aggregates across dates/machines/itemIds)
          item.totalCounts += counts;
          item.workedTimeMs += workedMs;
          
          // Accumulate weighted standard: sum(count * standard) for prorated calculation
          if (counts > 0 && standard > 0) {
            item.standardWeightedSum += counts * standard;
            item.totalCountsForStandard += counts;
          }
          
          // Keep the original item name (first non-empty one found, or prefer longer/more specific name)
          if (cacheItem.itemName && (
            !item.itemName || 
            item.itemName === 'Unknown' ||
            cacheItem.itemName.length > item.itemName.length // Prefer more specific name
          )) {
            item.itemName = cacheItem.itemName;
          }
        }
        
        // Add session items - group by itemName and sum metrics (prorate standard by counts)
        console.log(`[OPERATOR-CACHE] Operator ${opId}: Processing ${sessionItems.length} session items`);
        for (const sessionItem of sessionItems) {
          const normalizedName = normalizeItemName(sessionItem.itemName);
          if (normalizedName === 'Unknown' || !normalizedName) {
            console.log(`[OPERATOR-CACHE] Skipping session item with no name for operator ${opId}, itemId: ${sessionItem.itemId}`);
            continue;
          }
          
          // Log all items being processed for debugging
          console.log(`[OPERATOR-CACHE] Operator ${opId}: Session item - itemId: ${sessionItem.itemId}, originalName: "${sessionItem.itemName}", normalizedName: "${normalizedName}", counts: ${sessionItem.totalCounts}`);
          
          // Log if we see the same normalized name with different original names (potential duplicates)
          if (seenItemNames.has(normalizedName) && sessionItem.itemName) {
            const existingItem = allItemsMap.get(normalizedName);
            if (existingItem && existingItem.itemName !== sessionItem.itemName) {
              console.log(`[OPERATOR-CACHE] Operator ${opId}: Found session item name variation - "${existingItem.itemName}" vs "${sessionItem.itemName}" (normalized: "${normalizedName}") - combining`);
            } else {
              console.log(`[OPERATOR-CACHE] Operator ${opId}: Duplicate normalized name "${normalizedName}" (same original name) - aggregating counts`);
            }
          }
          seenItemNames.add(normalizedName);
          
          const counts = Number(sessionItem.totalCounts) || 0;
          const standard = Number(sessionItem.itemStandard) || 0;
          
          // For session items, calculate worked time proportionally
          const sessionWorkedMs = operatorData.totalWorkedMs > 0 && operatorData.totalCount > 0
            ? counts / operatorData.totalCount * operatorData.totalWorkedMs
            : 0;
          
          if (!allItemsMap.has(normalizedName)) {
            allItemsMap.set(normalizedName, {
              itemName: sessionItem.itemName || 'Unknown', // Keep original casing for display
              totalCounts: 0,
              workedTimeMs: 0,
              standardWeightedSum: 0,
              totalCountsForStandard: 0
            });
          }
          const item = allItemsMap.get(normalizedName);
          
          // Sum up all metrics for same item name
          item.totalCounts += counts;
          item.workedTimeMs += sessionWorkedMs;
          
          // Accumulate weighted standard: sum(count * standard) for prorated calculation
          if (counts > 0 && standard > 0) {
            item.standardWeightedSum += counts * standard;
            item.totalCountsForStandard += counts;
          }
          
          // Keep the original item name (first non-empty one found, or prefer longer/more specific name)
          if (sessionItem.itemName && (
            !item.itemName || 
            item.itemName === 'Unknown' ||
            sessionItem.itemName.length > item.itemName.length // Prefer more specific name
          )) {
            item.itemName = sessionItem.itemName;
          }
        }
        
        console.log(`[OPERATOR-CACHE] Operator ${opId}: After grouping by name, ${allItemsMap.size} unique items`);
        
        // Log all final unique items
        console.log(`[OPERATOR-CACHE] Operator ${opId}: Final unique items:`);
        for (const [normalizedName, item] of allItemsMap) {
          console.log(`  - "${normalizedName}" -> name: "${item.itemName}", counts: ${item.totalCounts}, standardWeightedSum: ${item.standardWeightedSum}, totalCountsForStandard: ${item.totalCountsForStandard}`);
        }
        
        // Build itemSummaries from combined items (grouped by itemName)
        const itemSummaryKeys = new Set(); // Track keys to detect duplicates
        for (const [normalizedName, item] of allItemsMap) {
          // ✅ Skip items with zero counts to avoid cluttering the response
          if (item.totalCounts === 0) {
            continue;
          }

          // Validate no duplicate keys (shouldn't happen, but check for safety)
          if (itemSummaryKeys.has(normalizedName)) {
            console.log(`[OPERATOR-CACHE] Operator ${opId}: DUPLICATE KEY DETECTED: "${normalizedName}" - this should not happen!`);
            continue; // Skip duplicate to prevent overwriting
          }
          itemSummaryKeys.add(normalizedName);

          // Calculate prorated standard: weighted average based on counts
          // proratedStandard = sum(count * standard) / sum(count)
          const proratedItemStandard = item.totalCountsForStandard > 0
            ? item.standardWeightedSum / item.totalCountsForStandard
            : 0;

          // Fallback: if item has counts but no worked time (totalTimeCreditMs was 0/missing),
          // calculate worked time proportionally based on operator's total worked time
          let itemWorkedMs = item.workedTimeMs;
          if (itemWorkedMs === 0 && item.totalCounts > 0 && operatorData.totalCount > 0 && operatorData.totalWorkedMs > 0) {
            itemWorkedMs = (item.totalCounts / operatorData.totalCount) * operatorData.totalWorkedMs;
            console.log(`[OPERATOR-CACHE] Operator ${opId}: Item "${item.itemName}" had 0 workedTimeMs but ${item.totalCounts} counts, calculated proportionally: ${itemWorkedMs}ms`);
          }

          const hours = itemWorkedMs / 3600000;
          const pph = hours > 0 ? item.totalCounts / hours : 0;
          const eff = proratedItemStandard > 0 ? pph / proratedItemStandard : null;
          const weight = operatorData.totalCount > 0 ? item.totalCounts / operatorData.totalCount : 0;
          proratedStandard += weight * proratedItemStandard;

          // Use itemName as key (normalized) for itemSummaries
          // This ensures items with same name but different itemIds are combined
          itemSummaries[normalizedName] = {
            name: item.itemName, // Original casing for display
            standard: Math.round(proratedItemStandard * 100) / 100, // Round to 2 decimals
            countTotal: item.totalCounts,
            workedTimeFormatted: formatMs(itemWorkedMs),
            pph: Math.round(pph * 100) / 100,
            efficiency: eff ? Math.round(eff * 10000) / 100 : null,
          };
        }
        
        console.log(`[OPERATOR-CACHE] Operator ${opId}: Created ${Object.keys(itemSummaries).length} item summaries`);
        console.log(`[OPERATOR-CACHE] Operator ${opId}: itemSummaries keys:`, Object.keys(itemSummaries).join(', '));
        
        // Calculate operator-level metrics
        const hours = operatorData.totalWorkedMs / 3600000;
        const operatorPph = hours > 0 ? operatorData.totalCount / hours : 0;
        const operatorEff = proratedStandard ? operatorPph / proratedStandard : null;
        
        // Skip operators with no actual production data
        if (operatorData.totalCount === 0) {
          console.log(`[OPERATOR-CACHE] Skipping operator ${opId} - no production counts`);
          continue;
        }

        results.push({
          operator: operatorData.operator,
          sessions: [], // Empty array - no individual session details in cached version
          operatorSummary: {
            totalCount: operatorData.totalCount,
            workedTimeMs: operatorData.totalWorkedMs || 0,
            workedTimeFormatted: formatMs(operatorData.totalWorkedMs || 0),
            runtimeMs: operatorData.totalRuntimeMs || 0,
            runtimeFormatted: formatMs(operatorData.totalRuntimeMs || 0),
            pph: Math.round(operatorPph * 100) / 100,
            proratedStandard: proratedStandard || null,
            efficiency: operatorEff ? Math.round(operatorEff * 10000) / 100 : null,
            itemSummaries,
          },
        });
      }

      // ---------- 3) Status stacked (durations) ----------
      // COMMENTED OUT FOR PERFORMANCE
      // const statusByOperator = new Map();
      // for (const operatorTotal of operatorTotals) {
      //   const opId = operatorTotal.operatorId;
      //   
      //   if (!statusByOperator.has(opId)) {
      //     statusByOperator.set(opId, {
      //       "Running": 0,
      //       "Faulted": 0,
      //       "Paused": 0
      //     });
      //   }
      //   
      //   const status = statusByOperator.get(opId);
      //   status["Running"] += operatorTotal.runtimeMs / 3600000; // Convert to hours
      //   status["Faulted"] += operatorTotal.faultTimeMs / 3600000;
      //   status["Paused"] += operatorTotal.pausedTimeMs / 3600000;
      // }

      // // Compress per operator
      // for (const [opId, rec] of statusByOperator) {
      //   statusByOperator.set(opId, compressSlicesPerBar(rec));
      // }

      // // ---------- 4) Faults stacked (durations by fault type) ----------
      // // For operators, we'll use a simplified fault representation
      // const faultsByOperator = new Map();
      // for (const operatorTotal of operatorTotals) {
      //   const opId = operatorTotal.operatorId;
      //   const faultHours = operatorTotal.faultTimeMs / 3600000;
      //   
      //   if (!faultsByOperator.has(opId)) {
      //     faultsByOperator.set(opId, {});
      //   }
      //   
      //   if (faultHours > 0) {
      //     faultsByOperator.get(opId)["Faults"] = (faultsByOperator.get(opId)["Faults"] || 0) + faultHours;
      //   } else {
      //     faultsByOperator.get(opId)["No Faults"] = 0;
      //   }
      // }

      // // ---------- 5) Efficiency ranking order ----------
      // const efficiencyRanked = results
      //   .map(r => ({
      //     operatorId: r.operator.id,
      //     name: r.operator.name,
      //     efficiency: Number(r.operatorSummary?.efficiency || 0),
      //   }))
      //   .sort((a, b) => b.efficiency - a.efficiency);

      // // Build comprehensive operator ordering from all data sources
      // const unionOperatorIds = new Set(efficiencyRanked.map(r => r.operatorId));
      // for (const m of statusByOperator.keys()) unionOperatorIds.add(m);
      // for (const m of faultsByOperator.keys()) unionOperatorIds.add(m);
      // const finalOrderOperatorIds = [...unionOperatorIds].filter(id => opIdToName.has(id));

      // // ---------- 6) Items stacked ----------
      // const itemsByOperator = new Map();
      // for (const r of results) {
      //   const m = {};
      //   for (const [id, s] of Object.entries(r.operatorSummary.itemSummaries || {})) {
      //     const label = s.name || String(id);
      //     const count = Number(s.countTotal || 0);
      //     m[label] = (m[label] || 0) + count;
      //   }
      //   itemsByOperator.set(r.operator.id, compressSlicesPerBar(m));
      // }

      // const itemsStacked = toStackedSeries(itemsByOperator, opIdToName, finalOrderOperatorIds, "items");
      // const statusStacked = toStackedSeries(statusByOperator, opIdToName, finalOrderOperatorIds, "status");
      // const faultsStacked = toStackedSeries(faultsByOperator, opIdToName, finalOrderOperatorIds, "faults");

      // ---------- 7) Final payload ----------
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,                  // Same structure as original route
        // CHARTS COMMENTED OUT FOR PERFORMANCE
        // charts: {
        //   statusStacked: {
        //     title: "Operator Status Stacked Bar",
        //     orientation: "vertical",
        //     xType: "category",
        //     xLabel: "Operator",
        //     yLabel: "Duration (hours)",
        //     series: statusStacked
        //   },
        //   efficiencyRanked: {
        //     title: "Ranked OEE% by Operator", 
        //     orientation: "horizontal",
        //     xType: "category",
        //     xLabel: "Operator",
        //     yLabel: "OEE (%)",
        //     series: [
        //       {
        //         id: "OEE",
        //         title: "OEE",
        //         type: "bar",
        //         data: efficiencyRanked.map(r => ({ x: opIdToName.get(r.operatorId), y: r.efficiency })),
        //       },
        //     ]
        //   },
        //   itemsStacked: {
        //     title: "Item Stacked Bar by Operator",
        //     orientation: "vertical", 
        //     xType: "category",
        //     xLabel: "Operator",
        //     yLabel: "Item Count",
        //     series: itemsStacked
        //   },
        //   faultsStacked: {
        //     title: "Fault Stacked Bar by Operator",
        //     orientation: "vertical",
        //     xType: "category", 
        //     xLabel: "Operator",
        //     yLabel: "Fault Duration (hours)",
        //     series: faultsStacked
        //   },
        //   order: finalOrderOperatorIds.map(id => opIdToName.get(id) || id), // operator display order (ranked)
        // },
      });
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate cached operator item summary" });
    }
  });

  // NEW: Simplified cached version using simulator's item entity records (with itemStandard built-in)
  router.get("/analytics/item-sessions-summary-daily-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      console.log(`[item-sessions-summary-daily-cache] Query start: ${exactStart.toISOString()}, end: ${exactEnd.toISOString()}`);

      // ---------- Timezone-aware date handling (same as machine report) ----------
      const startDt = DateTime.fromJSDate(exactStart, { zone: SYSTEM_TIMEZONE });
      const endDt = DateTime.fromJSDate(exactEnd, { zone: SYSTEM_TIMEZONE });
      const nowLocal = DateTime.now().setZone(SYSTEM_TIMEZONE);

      const normalizedStart = startDt.startOf('day');
      const normalizedEnd = endDt.startOf('day');
      const todayStart = nowLocal.startOf('day');

      // Check if query includes today
      const queryIncludesToday = normalizedEnd >= todayStart;

      // Check if this is a partial day query for a past date (not today)
      // Use timezone-aware comparisons with Luxon DateTime
      const isStartOfDay = startDt.hour === 0 && startDt.minute === 0 && startDt.second === 0 && startDt.millisecond === 0;
      const endOfDayEnd = endDt.endOf('day');
      const isEndOfDay = endDt >= endOfDayEnd.minus({ seconds: 1 }); // Allow 1 second tolerance
      const isSameDay = normalizedStart.hasSame(normalizedEnd, 'day');
      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);
      const isPartialPastDay = isPartialDay && !queryIncludesToday;

      console.log(`[item-sessions-summary-daily-cache] Time window analysis:`, {
        isStartOfDay,
        isEndOfDay,
        isSameDay,
        isPartialDay,
        queryIncludesToday,
        isPartialPastDay,
        startDate: exactStart.toISOString().split('T')[0],
        endDate: exactEnd.toISOString().split('T')[0],
        todayDate: todayStart.toISODate()
      });

      // If querying a partial day from the PAST (not today), use session data for accurate time windowing
      if (isPartialPastDay) {
        console.log(`[item-sessions-summary-daily-cache] ⚠️ PARTIAL PAST DAY DETECTED - Falling back to session-based query for accurate time windowing`);
        console.log(`[item-sessions-summary-daily-cache] Reason: Querying partial day from the past requires session-level precision`);

        // Fall back to session-based approach
        const partialDays = [{ start: exactStart, end: exactEnd }];
        const sessionData = await getItemSessionDataForPartialDays(db,partialDays);

        console.log(`[item-sessions-summary-daily-cache] Retrieved ${sessionData.items.length} item records from sessions`);

        // Process session data
        const resultsMap = new Map();

        for (const item of sessionData.items) {
          const itemId = String(item.itemId);

          if (!resultsMap.has(itemId)) {
            resultsMap.set(itemId, {
              itemId: item.itemId,
              name: item.itemName || "Unknown",
              standard: item.itemStandard ?? 0,
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
          const stdPPH = normalizePPH(entry.standard);
          const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

          return {
            itemName: entry.name,
            workedTimeFormatted: formatDuration(workedMs),
            count: entry.count,
            pph: Math.round(pph * 100) / 100,
            standard: entry.standard,
            efficiency: Math.round(efficiencyPct * 100) / 100,
          };
        });

        console.log(`[item-sessions-summary-daily-cache] Returning ${results.length} items from session-based fallback`);
        return res.json(results);
      }

      // ---------- Hybrid query configuration (for multi-day queries) ----------
      const HYBRID_THRESHOLD_HOURS = 24; // Configurable threshold for hybrid approach
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // Determine if we should use hybrid approach
      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
      
      console.log(`[item-sessions-summary-daily-cache] Strategy: ${useHybrid ? 'HYBRID' : 'CACHE ONLY'}, time range: ${timeRangeHours.toFixed(2)} hours`);

      // ---------- helpers (local to route) ----------
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
      };

      // ---------- 1) Time range splitting and data collection ----------
      let itemTotals = [];

      if (useHybrid) {
        // Split time range into complete days and partial days
        const { completeDays, partialDays } = splitTimeRangeForHybridReport(exactStart, exactEnd);
        
        console.log(`[item-sessions-summary-daily-cache] Hybrid split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
        console.log(`[item-sessions-summary-daily-cache] Complete days:`, completeDays.map(d => d.dateStr));
        console.log(`[item-sessions-summary-daily-cache] Partial days:`, partialDays.map(d => ({ start: d.start.toISOString(), end: d.end.toISOString() })));
        
        // Get data from daily cache for complete days (using simulator's item records)
        if (completeDays.length > 0) {
          itemTotals = await getItemDailyCachedDataForDays(db,completeDays);
          console.log(`[item-sessions-summary-daily-cache] Retrieved ${itemTotals.length} item records from cache for complete days`);
        }
        
        // Get data from sessions for partial days
        if (partialDays.length > 0) {
          const sessionData = await getItemSessionDataForPartialDays(db,partialDays);
          console.log(`[item-sessions-summary-daily-cache] Retrieved ${sessionData.items.length} item records from sessions for partial days`);
          itemTotals = combineItemDailyHybridData(itemTotals, sessionData.items);
          console.log(`[item-sessions-summary-daily-cache] Combined to ${itemTotals.length} total item records`);
        }
        
      } else {
        // For same-day queries or queries including today, use cached data (same as machine report)
        const cacheCollection = db.collection('totals-daily');

        // Generate date range using normalized dates (same as machine report)
        const dateStrings = [];
        let currentDate = normalizedStart;
        while (currentDate <= normalizedEnd) {
          dateStrings.push(currentDate.toISODate());
          currentDate = currentDate.plus({ days: 1 });
        }

        console.log(`[item-sessions-summary-daily-cache] Querying cache for dates: ${dateStrings.join(', ')}`);

        // Get item daily totals from simulator (using date strings, same as machine report)
        const itemQuery = {
          entityType: 'item',
          source: 'simulator', // Only get simulator records
          $or: [
            { dateObj: { $in: dateStrings.map(str => new Date(str + 'T00:00:00.000Z')) } },
            { date: { $in: dateStrings } }
          ]
        };

        itemTotals = await cacheCollection.find(itemQuery).toArray();
        console.log(`[item-sessions-summary-daily-cache] Retrieved ${itemTotals.length} item records from cache`);
      }

      if (!itemTotals.length) {
        return res.json([]);
      }

      // ---------- 2) Process item data ----------
      const resultsMap = new Map();

      console.log(`[item-sessions-summary-daily-cache] Processing ${itemTotals.length} item total records`);

      // Group item totals by item ID
      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);
        
        if (!resultsMap.has(itemId)) {
          resultsMap.set(itemId, {
            itemId: itemTotal.itemId,
            name: itemTotal.itemName || "Unknown",
            standard: itemTotal.itemStandard ?? 0, // itemStandard is built into simulator's item record
            count: 0,
            workedSec: 0,
          });
        }
        
        const acc = resultsMap.get(itemId);
        acc.count += itemTotal.totalCounts || 0;
        acc.workedSec += (itemTotal.workedTimeMs || 0) / 1000; // Convert to seconds
        
        logger.debug(`[item-sessions-summary-daily-cache] Item ${itemId} (${itemTotal.itemName}): +${itemTotal.totalCounts} counts, +${(itemTotal.workedTimeMs/1000).toFixed(0)}s worked time`);
      }

      console.log(`[item-sessions-summary-daily-cache] Aggregated into ${resultsMap.size} unique items`);

      // ---------- 3) Finalize results (same format as original route) ----------
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

      console.log(`[item-sessions-summary-daily-cache] Returning ${results.length} items in final response`);

      res.json(results);
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate daily cached item summary" });
    }
  });

  // Simple machine report using only cache data
  router.get("/analytics/machine-report-cache", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Generate date range (full days)
      const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf('day');
      const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).startOf('day');

      const shiftIdRaw = req.query.shiftId;
      let machineRecords;
      let machineItemRecords;
      let responseTimeRange;

      if (shiftIdRaw) {
        let shiftDoc;
        let shiftId;
        try {
          shiftId = new ObjectId(String(shiftIdRaw));
          shiftDoc = await db.collection("shift").findOne({ _id: shiftId });
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }

        const partialDay = { start, end };

        const sessionData = await getSessionDataForPartialDays(db, [partialDay], serial, {
          shiftId: String(shiftId),
        });

        machineRecords = sessionData.machines || [];
        machineItemRecords = sessionData.machineItems || [];

        responseTimeRange = {
          start: start.toISOString(),
          end: end.toISOString(),
        };

        if (!machineRecords.length && !machineItemRecords.length) {
          return res.json({
            timeRange: responseTimeRange,
            results: [],
          });
        }
      } else {
        const dateStrings = [];
        let currentDate = startDt;
        while (currentDate <= endDt) {
          dateStrings.push(currentDate.toISODate());
          currentDate = currentDate.plus({ days: 1 });
        }

        const cacheCollection = db.collection('totals-daily');

        // Query cache for machine and machine-item records
        const cacheQuery = {
          $or: [
            { dateObj: { $in: dateStrings.map(str => new Date(str + 'T00:00:00.000Z')) } },
            { date: { $in: dateStrings } }
          ],
          entityType: { $in: ['machine', 'machine-item'] }
        };
        if (serial) cacheQuery.machineSerial = parseInt(serial, 10);

        const cacheDocs = await cacheCollection.find(cacheQuery).toArray();

        if (cacheDocs.length > 0) {
          // Split by entity type when cache data is available
          machineRecords = cacheDocs.filter(d => d.entityType === 'machine');
          machineItemRecords = cacheDocs.filter(d => d.entityType === 'machine-item');
        } else {
          // If cache is missing for the requested range, fall back to live session data
          const partialDay = {
            start,
            end,
          };

          const sessionData = await getSessionDataForPartialDays(db, [partialDay], serial);
          machineRecords = sessionData.machines || [];
          machineItemRecords = sessionData.machineItems || [];

          // If there is still no data, return an empty result set
          if (!machineRecords.length && !machineItemRecords.length) {
            return res.json({
              timeRange: {
                start: start.toISOString(),
                end: end.toISOString(),
              },
              results: [],
            });
          }
        }

        responseTimeRange = {
          start: startDt.toUTC().toJSDate().toISOString(),
          end: endDt.plus({ days: 1 }).toUTC().toJSDate().toISOString(),
        };
      }

      // Aggregate machines by serial across all dates
      const machineMap = new Map();
      for (const record of machineRecords) {
        const serial = record.machineSerial;
        if (machineMap.has(serial)) {
          const existing = machineMap.get(serial);
          existing.runtimeMs += record.runtimeMs || 0;
          existing.workedTimeMs += record.workedTimeMs || 0;
          existing.totalCounts += record.totalCounts || 0;
        } else {
          machineMap.set(serial, {
            machineSerial: serial,
            machineName: record.machineName,
            runtimeMs: record.runtimeMs || 0,
            workedTimeMs: record.workedTimeMs || 0,
            totalCounts: record.totalCounts || 0,
          });
        }
      }

      // Aggregate machine-items: First deduplicate by (serial, itemId, date), then sum across dates 
      const itemByDateMap = new Map(); // key: `${serial}-${itemId}-${date}`
      for (const record of machineItemRecords) {
        const dateKey = record.date || 'unknown';
        const key = `${record.machineSerial}-${record.itemId}-${dateKey}`;

        if (itemByDateMap.has(key)) {
          // Duplicate for same (serial, itemId, date) - take max to avoid double-counting
          const existing = itemByDateMap.get(key);
          existing.totalCounts = Math.max(existing.totalCounts, record.totalCounts || 0);
          existing.workedTimeMs = Math.max(existing.workedTimeMs, record.workedTimeMs || 0);
          existing.runtimeMs = Math.max(existing.runtimeMs, record.runtimeMs || 0);
        } else {
          itemByDateMap.set(key, {
            machineSerial: record.machineSerial,
            itemId: record.itemId,
            itemName: record.itemName,
            itemStandard: record.itemStandard,
            totalCounts: record.totalCounts || 0,
            workedTimeMs: record.workedTimeMs || 0,
            runtimeMs: record.runtimeMs || 0,
          });
        }
      }

      // Sum across dates by (serial, itemId)
      const itemMap = new Map(); // key: `${serial}-${itemId}`
      for (const record of itemByDateMap.values()) {
        const key = `${record.machineSerial}-${record.itemId}`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          existing.totalCounts += record.totalCounts;
          existing.workedTimeMs += record.workedTimeMs;
          existing.runtimeMs += record.runtimeMs;
        } else {
          itemMap.set(key, {
            machineSerial: record.machineSerial,
            itemId: record.itemId,
            itemName: record.itemName,
            itemStandard: record.itemStandard,
            totalCounts: record.totalCounts,
            workedTimeMs: record.workedTimeMs,
            runtimeMs: record.runtimeMs,
          });
        }
      }

      // Build results
      const results = [];

      for (const [serial, machineData] of machineMap) {
        // Get all items for this machine
        const machineItems = Array.from(itemMap.values()).filter(item => item.machineSerial === serial);

        // Skip items with zero counts
        const itemsWithCounts = machineItems.filter(item => item.totalCounts > 0);

        // Calculate total counts across all items first
        let itemTotalCounts = 0;
        for (const item of itemsWithCounts) {
          itemTotalCounts += item.totalCounts;
        }

        // Calculate individual item summaries with proportional runtime allocation
        const itemSummaries = {};
        let proratedStandard = 0;

        for (const item of itemsWithCounts) {
          // ✅ FIX: Allocate machine runtime proportionally based on counts
          // This fixes the issue where multi-lane machines (SPF) show inflated item runtimes
          // Example: If machine ran 10h and item produced 25% of total counts, item gets 2.5h
          const itemRuntimeProportion = itemTotalCounts > 0 ? item.totalCounts / itemTotalCounts : 0;
          const itemAllocatedRuntimeMs = machineData.runtimeMs * itemRuntimeProportion;

          // Calculate item metrics using allocated runtime
          const itemHours = itemAllocatedRuntimeMs / 3600000;
          const itemPph = itemHours > 0 ? item.totalCounts / itemHours : 0;
          const itemEfficiency = (item.itemStandard || 0) > 0 ? (itemPph / item.itemStandard) * 100 : 0;

          itemSummaries[item.itemId] = {
            name: item.itemName,
            standard: item.itemStandard || 0,
            countTotal: item.totalCounts,
            workedTimeFormatted: formatDuration(itemAllocatedRuntimeMs),
            pph: Math.round(itemPph * 100) / 100,
            efficiency: Math.round(itemEfficiency * 100) / 100,
          };

          // Calculate weighted standard for machine total
          proratedStandard += itemRuntimeProportion * (item.itemStandard || 0);
        }

        // Calculate machine Total row using machine's runtimeMs (not workedTimeMs)
        const machineRuntimeHours = machineData.runtimeMs / 3600000;
        const machinePph = machineRuntimeHours > 0 ? itemTotalCounts / machineRuntimeHours : 0;
        const machineEfficiency = proratedStandard > 0 ? (machinePph / proratedStandard) * 100 : 0;

        // Build itemSummaries with Total row first
        const itemSummariesWithTotal = {
          'Total': {
            name: 'Total',
            standard: Math.round(proratedStandard * 100) / 100,
            countTotal: itemTotalCounts,
            workedTimeFormatted: formatDuration(machineData.runtimeMs),
            pph: Math.round(machinePph * 100) / 100,
            efficiency: Math.round(machineEfficiency * 100) / 100,
          },
          ...itemSummaries
        };

        results.push({
          machine: {
            name: machineData.machineName,
            serial: machineData.machineSerial
          },
          machineSummary: {
            totalCount: itemTotalCounts,
            workedTimeMs: machineData.workedTimeMs,
            workedTimeFormatted: formatDuration(machineData.workedTimeMs),
            runtimeMs: machineData.runtimeMs,
            runtimeFormatted: formatDuration(machineData.runtimeMs),
            pph: Math.round(machinePph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(machineEfficiency * 100) / 100,
            itemSummaries: itemSummariesWithTotal,
          },
        });
      }

      res.json({
        timeRange: responseTimeRange,
        results,
      });
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate machine report from cache" });
    }
  });

  /** POST body: { to, pdfBase64, start, end, summaryOnly } — PDF is client-generated to match the download. */
  router.post("/analytics/machine-report-email", async (req, res) => {
    console.log("[machine-report-email] hit POST /analytics/machine-report-email");
    try {
      const { to, pdfBase64, start, end, summaryOnly } = req.body || {};
      console.log("[machine-report-email] body keys:", Object.keys(req.body || {}), {
        to: typeof to === "string" ? to : typeof to,
        pdfBase64Chars: typeof pdfBase64 === "string" ? pdfBase64.length : null,
        start,
        end,
        summaryOnly,
      });

      if (!isValidMachineReportRecipientEmail(to)) {
        console.log("[machine-report-email] bail: invalid recipient email");
        return res.status(400).json({ error: "Invalid email address" });
      }
      if (typeof pdfBase64 !== "string" || pdfBase64.length === 0) {
        console.log("[machine-report-email] bail: missing pdfBase64");
        return res.status(400).json({ error: "Missing PDF payload" });
      }

      let pdfBuffer;
      try {
        pdfBuffer = Buffer.from(pdfBase64, "base64");
      } catch (e) {
        console.log("[machine-report-email] bail: base64 decode threw", e?.message || e);
        return res.status(400).json({ error: "Invalid PDF encoding" });
      }
      if (!pdfBuffer.length || pdfBuffer.length > 25 * 1024 * 1024) {
        console.log("[machine-report-email] bail: bad pdf size", pdfBuffer.length);
        return res.status(400).json({ error: "Invalid or oversized PDF" });
      }
      if (pdfBuffer.slice(0, 5).toString() !== "%PDF-") {
        console.log("[machine-report-email] bail: not a PDF signature");
        return res.status(400).json({ error: "Attachment is not a PDF" });
      }
      console.log("[machine-report-email] pdf ok bytes=", pdfBuffer.length);

      const host = process.env.SMTP_HOST || "smtp.gmail.com";
      const port = parseInt(process.env.SMTP_PORT || "465", 10);
      const secure = process.env.SMTP_SECURE !== "false";
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      if (!user || !pass) {
        console.log("[machine-report-email] bail: SMTP_USER/SMTP_PASS not set");
        logger.warn("[machine-report-email] SMTP_USER or SMTP_PASS is not set");
        return res
          .status(503)
          .json({ error: "Email is not configured on the server" });
      }

      const fromEmail = process.env.SMTP_FROM_EMAIL || user;
      const fromName = process.env.SMTP_FROM_NAME || "ChiTrac Machine Report";

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      const safeStart = String(start ?? "")
        .replace(/[^\w.\-:+TZ]/g, "_")
        .slice(0, 48);
      const safeEnd = String(end ?? "")
        .replace(/[^\w.\-:+TZ]/g, "_")
        .slice(0, 48);
      const filename = `machine_report_${safeStart}_${safeEnd}${
        summaryOnly ? "_summary" : ""
      }.pdf`;
      console.log("[machine-report-email] sending mail", {
        host,
        port,
        secure,
        to: to.trim(),
        filename,
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: to.trim(),
        subject: "ChiTrac Machine Report",
        text: "Attached is the machine report for the selected period.",
        html: "<p>Attached is the machine report for the selected period.</p>",
        attachments: [
          {
            filename,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      console.log("[machine-report-email] sendMail finished ok");
      res.json({ ok: true });
    } catch (err) {
      console.log("[machine-report-email] exception", err?.message || err);
      logger.error("[machine-report-email] send failed", err);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  router.use("/report-subscriptions", reportSubscriptionRoutes);

  return router;
};
