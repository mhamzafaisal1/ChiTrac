const express = require("express");
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const {
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData,
} = require("../../utils/itemFunctions");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;

  // ---- /api/alpha/analytics/items-summary-daily-cache ----
  // Hybrid cached/session route for item summary, mirroring itemSessions.js implementation.
  router.get("/analytics/items-summary-daily-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const today = new Date();
      const todayDateStr = today.toISOString().split("T")[0];
      const startDateStr = exactStart.toISOString().split("T")[0];
      const endDateStr = exactEnd.toISOString().split("T")[0];
      const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;

      const startOfDayStart = new Date(exactStart);
      startOfDayStart.setHours(0, 0, 0, 0);

      const endOfDayEnd = new Date(exactEnd);
      endOfDayEnd.setHours(23, 59, 59, 999);

      const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
      const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
      const isSameDay = startDateStr === endDateStr;

      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);

      // Partial non-today → session-based for accurate windowing
      if (isPartialDay && !isToday) {
        const partialDays = [{ start: exactStart, end: exactEnd }];
        const sessionItems = await getItemsSessionDataForPartialDays(partialDays, db);

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

        return res.json(results);
      }

      if (isPartialDay && isToday) {
        // still use totals-daily collection for today
      }

      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;

      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n;
      };

      let itemTotals = [];

      if (useHybrid) {
        const { completeDays, partialDays } = splitTimeRangeForHybridItems(
          exactStart,
          exactEnd
        );

        const today2 = new Date();
        const todayDateStr2 = today2.toISOString().split("T")[0];

        const partialDaysToday = [];
        const partialDaysNotToday = [];

        for (const partialDay of partialDays) {
          const partialDayDateStr = new Date(
            partialDay.start
          ).toISOString().split("T")[0];
          if (partialDayDateStr === todayDateStr2) {
            partialDaysToday.push({
              dateStr: partialDayDateStr,
              start: new Date(partialDayDateStr + "T00:00:00.000Z"),
              end: new Date(partialDayDateStr + "T23:59:59.999Z"),
            });
          } else {
            partialDaysNotToday.push(partialDay);
          }
        }

        const daysForCache = [...completeDays, ...partialDaysToday];

        if (daysForCache.length > 0) {
          itemTotals = await getItemsCachedDataForDays(daysForCache, db);
        }

        if (partialDaysNotToday.length > 0) {
          const sessionData = await getItemsSessionDataForPartialDays(
            partialDaysNotToday,
            db
          );
          itemTotals = combineItemsHybridData(itemTotals, sessionData);
        }
      } else {
        const cacheCollection = db.collection("totals-daily");

        const startDate = exactStart.toISOString().split("T")[0];
        const endDate = exactEnd.toISOString().split("T")[0];

        const itemQuery = {
          entityType: "item",
          $or: [
            { date: { $gte: startDate, $lte: endDate } },
            {
              dateObj: {
                $gte: new Date(startDate + "T00:00:00.000Z"),
                $lte: new Date(endDate + "T23:59:59.999Z"),
              },
            },
          ],
        };

        itemTotals = await cacheCollection.find(itemQuery).toArray();
      }

      if (!itemTotals.length) {
        return res.json([]);
      }

      const resultsMap = new Map();

      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);

        if (!resultsMap.has(itemId)) {
          resultsMap.set(itemId, {
            itemId: itemTotal.itemId,
            itemName: itemTotal.itemName || "Unknown",
            standardRaw: itemTotal.itemStandard ?? 0,
            count: 0,
            workedSec: 0,
          });
        }

        const acc = resultsMap.get(itemId);
        acc.count += itemTotal.totalCounts || 0;
        acc.workedSec += (itemTotal.workedTimeMs || 0) / 1000;
      }

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
      res
        .status(500)
        .json({ error: "Failed to generate items summary from daily cache" });
    }
  });

  return router;
};