/**
 * Functions for providing data specific to items.
 * Extracted from controllers/alpha/itemSessions.js
 */
const config = require("../modules/config");
const { formatDuration } = require("./time");
const { getBookendedStatesAndTimeRange } = require("./machineFunctions");

function normalizeSessionSeconds(value, session) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  const start = session?.timestamps?.start ? new Date(session.timestamps.start) : null;
  const end = session?.timestamps?.end ? new Date(session.timestamps.end) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
    const expectedSeconds = (end - start) / 1000;
    if (expectedSeconds > 0 && numeric > expectedSeconds * 10) return numeric / 1000;
  }

  return numeric > 86400 ? numeric / 1000 : numeric;
}

function normalizePPH(standard) {
  const n = Number(standard) || 0;
  return n > 0 && n < 60 ? n * 60 : n;
}

function calculateTimeCreditMs(count, standard) {
  const stdPPH = normalizePPH(standard);
  return stdPPH > 0 ? (Number(count) || 0) / stdPPH * 3600000 : 0;
}

function buildItemSummaryRows(itemTotals) {
  const resultsMap = new Map();

  for (const itemTotal of itemTotals) {
    const itemId = String(itemTotal.itemId);
    if (!resultsMap.has(itemId)) {
      resultsMap.set(itemId, {
        itemId: itemTotal.itemId,
        itemName: itemTotal.itemName || "Unknown",
        standardRaw: itemTotal.itemStandard ?? 0,
        count: 0,
        workedMs: 0,
        timeCreditMs: 0,
      });
    }

    const acc = resultsMap.get(itemId);
    const count = itemTotal.totalCounts || 0;
    const standard = itemTotal.itemStandard ?? acc.standardRaw ?? 0;
    const timeCreditMs = itemTotal.totalTimeCreditMs ?? calculateTimeCreditMs(count, standard);

    acc.count += count;
    acc.workedMs += itemTotal.workedTimeMs || 0;
    acc.timeCreditMs += timeCreditMs || 0;
    if (!acc.standardRaw && standard) acc.standardRaw = standard;
  }

  return Array.from(resultsMap.values()).map((entry) => {
    const hours = entry.workedMs / 3600000;
    const pph = hours > 0 ? entry.count / hours : 0;
    const stdPPH = normalizePPH(entry.standardRaw);
    const fallbackEfficiency = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;
    const efficiencyPct = entry.workedMs > 0 && entry.timeCreditMs > 0
      ? (entry.timeCreditMs / entry.workedMs) * 100
      : fallbackEfficiency;

    return {
      itemId: entry.itemId,
      itemName: entry.itemName,
      workedTimeFormatted: formatDuration(Math.round(entry.workedMs)),
      count: entry.count,
      pph: Math.round(pph * 100) / 100,
      standard: entry.standardRaw ?? 0,
      efficiency: Math.round(efficiencyPct * 100) / 100,
    };
  });
}

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

  if (dateStrings.length === 0) return [];

  const itemQuery = {
    entityType: 'item',
    $or: [
      { date: { $in: dateStrings } },
      { dateObj: {
        $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
      }}
    ]
  };

  const [itemTotals, operatorItemTotals] = await Promise.all([
    cacheCollection.find(itemQuery).toArray(),
    cacheCollection.find({
      entityType: 'operator-item',
      $or: [
        { date: { $in: dateStrings } },
        { dateObj: {
          $in: dateStrings.map(d => new Date(d + 'T00:00:00.000Z'))
        }}
      ]
    }).toArray()
  ]);

  const operatorWorkedByItem = new Map();
  for (const operatorItem of operatorItemTotals) {
    const itemId = String(operatorItem.itemId);
    const existing = operatorWorkedByItem.get(itemId) || {
      workedTimeMs: 0,
      totalTimeCreditMs: 0,
      totalCounts: 0,
      itemStandard: 0,
      itemName: operatorItem.itemName || "Unknown",
    };

    existing.workedTimeMs += operatorItem.workedTimeMs || 0;
    existing.totalTimeCreditMs += operatorItem.totalTimeCreditMs || 0;
    existing.totalCounts += operatorItem.totalCounts || 0;
    if (operatorItem.itemStandard && operatorItem.itemStandard > existing.itemStandard) {
      existing.itemStandard = operatorItem.itemStandard;
    }
    if (operatorItem.itemName && existing.itemName === "Unknown") existing.itemName = operatorItem.itemName;
    operatorWorkedByItem.set(itemId, existing);
  }

  if (itemTotals.length > 0) {
    for (const itemTotal of itemTotals) {
      const operatorItem = operatorWorkedByItem.get(String(itemTotal.itemId));
      if (operatorItem?.workedTimeMs > 0) {
        itemTotal.workedTimeMs = operatorItem.workedTimeMs;
      }
      if ((itemTotal.totalTimeCreditMs || 0) <= 0 && operatorItem?.totalTimeCreditMs > 0) {
        itemTotal.totalTimeCreditMs = operatorItem.totalTimeCreditMs;
      }
      if (!itemTotal.itemStandard && operatorItem?.itemStandard) {
        itemTotal.itemStandard = operatorItem.itemStandard;
      }
    }

    return itemTotals;
  }

  if (operatorWorkedByItem.size > 0) {
    return Array.from(operatorWorkedByItem.entries()).map(([itemId, item]) => ({
      itemId,
      itemName: item.itemName,
      itemStandard: item.itemStandard,
      totalCounts: item.totalCounts,
      workedTimeMs: item.workedTimeMs,
      totalTimeCreditMs: item.totalTimeCreditMs,
    }));
  }

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

  return [];
}

/**
 * Get item data from sessions for partial day ranges (non-today).
 */
async function getItemsSessionDataForPartialDays(partialDays, db, logger) {
  const items = [];
  const now = new Date();

  logger?.info?.(`[getItemsSessionDataForPartialDays] Processing ${partialDays.length} partial day ranges`);

  const activeSerials = await db
    .collection(config.machineCollectionName || "machine")
    .distinct("id", { active: true });

  logger?.info?.(`[getItemsSessionDataForPartialDays] Found ${activeSerials.length} active machines`);

  for (const partialDay of partialDays) {
    logger?.debug?.(`[getItemsSessionDataForPartialDays] Processing partial day: ${partialDay.start.toISOString()} to ${partialDay.end.toISOString()}`);

    for (const serial of activeSerials) {
      const bookended = await getBookendedStatesAndTimeRange(db, serial, partialDay.start, partialDay.end);
      if (!bookended) continue;
      const { sessionStart, sessionEnd } = bookended;

      logger?.debug?.(`[getItemsSessionDataForPartialDays] Machine ${serial} bookended window: ${sessionStart.toISOString()} to ${sessionEnd.toISOString()}`);

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
          totalTimeCredit: 1,
          workTime: 1,
          runtime: 1,
          activeStations: 1,
          operators: 1,
          timestamps: 1,
        })
        .toArray();

      if (!sessions.length) {
        logger?.debug?.(`[getItemsSessionDataForPartialDays] No sessions found for machine ${serial}`);
        continue;
      }

      logger?.debug?.(`[getItemsSessionDataForPartialDays] Machine ${serial}: Found ${sessions.length} item sessions`);

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
          ? normalizeSessionSeconds(s.workTime, s)
          : typeof s.runtime === "number"
            ? normalizeSessionSeconds(s.runtime, s) * Math.max(1, stations || 0)
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
          totalTimeCreditMs: calculateTimeCreditMs(countInWin, itm.standard),
        });
      }
    }
  }

  logger?.info?.(`[getItemsSessionDataForPartialDays] Collected ${items.length} total item records from sessions`);

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
  buildItemSummaryRows,
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData
};
