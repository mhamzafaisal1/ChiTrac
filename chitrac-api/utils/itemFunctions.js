/**
 * Functions for providing data specific to items.
 * Extracted from controllers/alpha/itemSessions.js
 */
const config = require("../modules/config");
const { formatDuration } = require("./time");
const { getBookendedStatesAndTimeRange } = require("./machineFunctions");

/**
 * Split a time range into complete days and partial days for hybrid cache/session queries.
 */
function splitTimeRangeForHybridItems(exactStart, exactEnd) {
  const completeDays = [];
  const partialDays = [];

  const startOfDayStart = new Date(exactStart);
  startOfDayStart.setHours(0, 0, 0, 0);

  const startOfDayEnd = new Date(exactEnd);
  startOfDayEnd.setHours(0, 0, 0, 0);

  const startIsFullDay = exactStart.getTime() === startOfDayStart.getTime();

  const endOfDayEnd = new Date(startOfDayEnd);
  endOfDayEnd.setHours(23, 59, 59, 999);
  const endIsFullDay = exactEnd.getTime() >= endOfDayEnd.getTime();

  if (!startIsFullDay) {
    const endOfStartDay = new Date(startOfDayStart);
    endOfStartDay.setHours(23, 59, 59, 999);
    partialDays.push({
      start: exactStart,
      end: exactEnd < endOfStartDay ? exactEnd : endOfStartDay
    });
    startOfDayStart.setDate(startOfDayStart.getDate() + 1);
  }

  const currentDay = new Date(startOfDayStart);
  while (currentDay < startOfDayEnd) {
    completeDays.push({
      dateStr: currentDay.toISOString().split('T')[0],
      start: new Date(currentDay),
      end: new Date(currentDay.getTime() + 24 * 60 * 60 * 1000 - 1)
    });
    currentDay.setDate(currentDay.getDate() + 1);
  }

  if (!endIsFullDay && startOfDayEnd >= startOfDayStart) {
    const startOfEndDay = new Date(startOfDayEnd);
    startOfEndDay.setHours(0, 0, 0, 0);

    if (startOfEndDay.getTime() !== startOfDayStart.getTime() || startIsFullDay) {
      partialDays.push({
        start: startOfEndDay,
        end: exactEnd
      });
    }
  }

  return { completeDays, partialDays };
}

/**
 * Get cached item data for complete days from totals-daily collection.
 */
async function getItemsCachedDataForDays(completeDays, db) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);

  const itemQuery = {
    entityType: 'item',
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: {
        $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
      }}
    ]
  };

  const itemTotals = await cacheCollection.find(itemQuery).toArray();

  if (itemTotals.length === 0 && dateStrings.length > 0) {
    console.log(`[getItemsCachedDataForDays] No results found. Date strings:`, dateStrings);
    const testQuery = {
      $or: [
        { date: { $in: dateStrings } },
        { dateObj: {
          $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
        }}
      ]
    };
    const testResults = await cacheCollection.find(testQuery).limit(5).toArray();
    console.log(`[getItemsCachedDataForDays] Found ${testResults.length} records in date range (without entityType filter):`,
      testResults.map(r => ({ entityType: r.entityType, itemId: r.itemId, date: r.date })));
  }

  return itemTotals;
}

/**
 * Get item data from sessions for partial day ranges (non-today).
 */
async function getItemsSessionDataForPartialDays(partialDays, db, logger) {
  const items = [];
  const now = new Date();

  logger.info(`[getItemsSessionDataForPartialDays] Processing ${partialDays.length} partial day ranges`);

  const activeSerials = await db
    .collection(config.machineCollectionName || "machine")
    .distinct("id", { active: true });

  logger.info(`[getItemsSessionDataForPartialDays] Found ${activeSerials.length} active machines`);

  for (const partialDay of partialDays) {
    logger.debug(`[getItemsSessionDataForPartialDays] Processing partial day: ${partialDay.start.toISOString()} to ${partialDay.end.toISOString()}`);

    for (const serial of activeSerials) {
      const bookended = await getBookendedStatesAndTimeRange(db, serial, partialDay.start, partialDay.end);
      if (!bookended) continue;
      const { sessionStart, sessionEnd } = bookended;

      logger.debug(`[getItemsSessionDataForPartialDays] Machine ${serial} bookended window: ${sessionStart.toISOString()} to ${sessionEnd.toISOString()}`);

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

        const ovStart = sessStart > sessionStart ? sessStart : sessionStart;
        const ovEnd = sessEnd < sessionEnd ? sessEnd : sessionEnd;
        if (!(ovEnd > ovStart)) continue;

        const sessSec = Math.max(0, (sessEnd - sessStart) / 1000);
        const ovSec = Math.max(0, (ovEnd - ovStart) / 1000);
        if (sessSec === 0 || ovSec === 0) continue;

        const stations = typeof s.activeStations === "number"
          ? s.activeStations
          : (Array.isArray(s.operators) ? s.operators.filter(o => o && o.id !== -1).length : 0);

        const baseWorkSec = typeof s.workTime === "number"
          ? s.workTime
          : typeof s.runtime === "number"
            ? s.runtime * Math.max(1, stations || 0)
            : 0;

        const workedSec = baseWorkSec > 0 ? baseWorkSec * (ovSec / sessSec) : 0;

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
          workedTimeMs: workedSec * 1000,
        });
      }
    }
  }

  logger.info(`[getItemsSessionDataForPartialDays] Collected ${items.length} total item records from sessions`);

  return items;
}

/**
 * Combine cached and session-based item data.
 */
function combineItemsHybridData(cachedItems, sessionItems, logger) {
  const itemMap = new Map();

  if (logger) logger.info(`[combineItemsHybridData] Combining ${cachedItems.length} cached items with ${sessionItems.length} session items`);

  for (const item of cachedItems) {
    const key = String(item.itemId);
    itemMap.set(key, item);
  }

  for (const item of sessionItems) {
    const key = String(item.itemId);
    if (itemMap.has(key)) {
      const existing = itemMap.get(key);
      existing.totalCounts = (existing.totalCounts || 0) + item.totalCounts;
      existing.workedTimeMs = (existing.workedTimeMs || 0) + item.workedTimeMs;

      if (item.itemStandard && item.itemStandard > (existing.itemStandard || 0)) {
        existing.itemStandard = item.itemStandard;
      }
    } else {
      itemMap.set(key, item);
    }
  }

  if (logger) logger.info(`[combineItemsHybridData] Result: ${itemMap.size} unique items`);

  return Array.from(itemMap.values());
}

module.exports = {
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData
};
