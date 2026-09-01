/**
 * Helper functions extracted from controllers/alpha/reportsSessionRoutes.js
 * for providing data for reports (hybrid cache + session queries).
 *
 * Functions that originally accessed `db` via closure now receive it as
 * the first parameter.  Pure combination/splitting helpers are exported
 * as-is.
 */

const { ObjectId } = require("mongodb");
const { formatHumanName } = require('./humanNames');
const config = require("../modules/config");
const { SYSTEM_TIMEZONE } = require("./time");
const { getBookendedStatesAndTimeRange } = require("./machineFunctions");
const { DateTime } = require("luxon");

// ---------------------------------------------------------------------------
// Internal utility – overlap calculation (same logic used in machineFunctions
// and the original reportsSessionRoutes closure).
// ---------------------------------------------------------------------------
function overlap(sStart, sEnd, wStart, wEnd) {
  if (!sStart) return { ovSec: 0, fullSec: 0, factor: 0, ovStart: wStart, ovEnd: wEnd };
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const factor = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor, ovStart: os, ovEnd: oe };
}

function normalizeSessionSeconds(value, session) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  const start = session?.timestamps?.start ? new Date(session.timestamps.start) : null;
  const end = session?.timestamps?.end ? new Date(session.timestamps.end) : null;
  if (start && end && !Number.isNaN(start) && !Number.isNaN(end) && end > start) {
    const expectedSeconds = (end - start) / 1000;
    if (expectedSeconds > 0 && numeric > expectedSeconds * 10) {
      return numeric / 1000;
    }
  }

  return numeric > 86400 ? numeric / 1000 : numeric;
}

function getSessionStatusCode(session) {
  const code = Number(session?.status?.code ?? session?.type);
  return Number.isFinite(code) ? code : null;
}

function classifySessionTime(session) {
  const code = getSessionStatusCode(session);
  if (code === 0) return "paused";
  if (code === 1) return "run";
  if (code > 1) return "fault";
  return "unknown";
}

function getSessionOverlapMs(session, rangeStart, rangeEnd) {
  const { ovSec } = overlap(session?.timestamps?.start, session?.timestamps?.end, rangeStart, rangeEnd);
  return Math.round(ovSec * 1000);
}

function getSessionCountsArray(session) {
  if (Array.isArray(session?.counts)) return session.counts;
  if (Array.isArray(session?.counts?.valid)) return session.counts.valid;
  if (Array.isArray(session?.counts?.all)) return session.counts.all;
  return [];
}

function getCountTimestamp(count) {
  return count?.timestamp || count?.timestamps?.create || count?.timestamps?.active || count?.timestamps?.update;
}

function isTimestampInRange(value, start, end) {
  const timestamp = value ? new Date(value) : null;
  return timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) && timestamp >= start && timestamp <= end;
}

// ===========================================================================
// Item-daily helpers  (queryItemDailyCache / queryItemSessions / combineItemData)
// ===========================================================================

/**
 * Query the totals-daily collection for item-level daily cache records.
 * @param {import("mongodb").Db} db
 * @param {Array<{dateStr: string}>} completeDays
 */
async function queryItemDailyCache(db, completeDays) {
  if (completeDays.length === 0) return [];

  const cacheCollection = db.collection('totals-daily');

  const dateObjs = completeDays.map(day => new Date(day.dateStr + 'T00:00:00.000Z'));

  const records = await cacheCollection.find({
    entityType: 'item',
    dateObj: { $in: dateObjs }
  }).toArray();

  return records;
}

/**
 * Query item sessions for partial (incomplete) days.
 * @param {import("mongodb").Db} db
 * @param {Array<{start: Date, end: Date}>} partialDays
 */
async function queryItemSessions(db, partialDays) {
  if (partialDays.length === 0) return [];

  const countColl = db.collection('count');
  const osColl = db.collection(config.operatorSessionCollectionName);

  const results = [];

  for (const partialDay of partialDays) {
    // Get count data for this partial day
    const counts = await countColl.find({
      timestamp: { $gte: partialDay.start, $lte: partialDay.end }
    }).toArray();

    // Group by item
    const itemCounts = new Map();
    counts.forEach(count => {
      if (count.item?.id) {
        const itemId = count.item.id;
        if (!itemCounts.has(itemId)) {
          itemCounts.set(itemId, {
            itemId: itemId,
            itemName: count.item.name || `Item ${itemId}`,
            totalCounts: 0,
            totalMisfeeds: 0
          });
        }

        const item = itemCounts.get(itemId);
        if (count.misfeed) {
          item.totalMisfeeds++;
        } else {
          item.totalCounts++;
        }
      }
    });

    // Get time metrics from operator sessions
    for (const [itemId, itemData] of itemCounts) {
      // Find operator sessions that produced this item during this time
      const sessions = await osColl.find({
        "timestamps.start": { $lt: partialDay.end },
        $or: [
          { "timestamps.end": { $gt: partialDay.start } },
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": null }
        ]
      }).toArray();

      let totalWorkTime = 0;
      let totalTimeCredit = 0;

      for (const session of sessions) {
        const { factor } = overlap(session.timestamps?.start, session.timestamps?.end, partialDay.start, partialDay.end);

        // Estimate item proportion based on counts
        const sessionCounts = counts.filter(c =>
          c.operator?.id === session.operator?.id &&
          c.machine?.serial === session.machine?.serial &&
          c.item?.id === itemId &&
          new Date(c.timestamp) >= new Date(session.timestamps?.start || partialDay.start) &&
          new Date(c.timestamp) <= new Date(session.timestamps?.end || partialDay.end)
        ).length;

        const totalSessionCounts = counts.filter(c =>
          c.operator?.id === session.operator?.id &&
          c.machine?.serial === session.machine?.serial &&
          new Date(c.timestamp) >= new Date(session.timestamps?.start || partialDay.start) &&
          new Date(c.timestamp) <= new Date(session.timestamps?.end || partialDay.end)
        ).length;

        const itemProportion = totalSessionCounts > 0 ? sessionCounts / totalSessionCounts : 0;

        if (itemProportion > 0) {
          totalWorkTime += normalizeSessionSeconds(session.workTime, session) * factor * itemProportion;
          totalTimeCredit += (session.totalTimeCredit || 0) * factor * itemProportion;
        }
      }

      itemData.runtimeMs = Math.round(totalWorkTime * 1000);
      itemData.workedTimeMs = Math.round(totalWorkTime * 1000);
      itemData.totalTimeCreditMs = Math.round(totalTimeCredit * 1000);
      itemData.faultTimeMs = 0; // Items don't track separate fault time
      itemData.pausedTimeMs = Math.max(0, (partialDay.end - partialDay.start) - itemData.runtimeMs);

      results.push(itemData);
    }
  }

  return results;
}

/**
 * Combine daily-cache item records with session-based item data.
 */
function combineItemData(dailyRecords, sessionData) {
  const combinedMap = new Map();

  // Add daily records
  for (const record of dailyRecords) {
    const key = record.itemId;
    if (!combinedMap.has(key)) {
      combinedMap.set(key, {
        itemId: record.itemId,
        itemName: record.itemName,
        totalCounts: 0,
        totalMisfeeds: 0,
        runtimeMs: 0,
        workedTimeMs: 0,
        totalTimeCreditMs: 0,
        faultTimeMs: 0,
        pausedTimeMs: 0
      });
    }

    const item = combinedMap.get(key);
    item.totalCounts += record.totalCounts || 0;
    item.totalMisfeeds += record.totalMisfeeds || 0;
    item.runtimeMs += record.runtimeMs || 0;
    item.workedTimeMs += record.workedTimeMs || 0;
    item.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    item.faultTimeMs += record.faultTimeMs || 0;
    item.pausedTimeMs += record.pausedTimeMs || 0;
  }

  // Add session data
  for (const record of sessionData) {
    const key = record.itemId;
    if (!combinedMap.has(key)) {
      combinedMap.set(key, {
        itemId: record.itemId,
        itemName: record.itemName,
        totalCounts: 0,
        totalMisfeeds: 0,
        runtimeMs: 0,
        workedTimeMs: 0,
        totalTimeCreditMs: 0,
        faultTimeMs: 0,
        pausedTimeMs: 0
      });
    }

    const item = combinedMap.get(key);
    item.totalCounts += record.totalCounts || 0;
    item.totalMisfeeds += record.totalMisfeeds || 0;
    item.runtimeMs += record.runtimeMs || 0;
    item.workedTimeMs += record.workedTimeMs || 0;
    item.totalTimeCreditMs += record.totalTimeCreditMs || 0;
    item.faultTimeMs += record.faultTimeMs || 0;
    item.pausedTimeMs += record.pausedTimeMs || 0;
  }

  return Array.from(combinedMap.values());
}

// ===========================================================================
// Hybrid time-range splitting  (timezone-aware, Luxon-based)
// ---------------------------------------------------------------------------
// NOTE: dashboardFunctions.js has its own splitTimeRangeForHybrid that uses
// plain Date objects and UTC logic.  This version uses Luxon DateTime with
// SYSTEM_TIMEZONE and is kept separate as splitTimeRangeForHybridReport to
// avoid confusion.
// ===========================================================================

/**
 * Split a time range into complete calendar days (suitable for cache lookup)
 * and partial day ranges (need live session queries).
 * Uses Luxon DateTime with the system timezone for accurate day boundaries.
 *
 * @param {Date} start
 * @param {Date} end
 * @returns {{ completeDays: Array, partialDays: Array }}
 */
function splitTimeRangeForHybridReport(start, end) {
  const completeDays = [];
  const partialDays = [];

  // Convert to Luxon DateTime for timezone-aware operations
  const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
  const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });

  console.log(`[HYBRID-SPLIT] Input: start=${startDt.toISO()}, end=${endDt.toISO()}`);

  // Get the date range (midnight to midnight boundaries)
  const startOfFirstDay = startDt.startOf('day');
  const startOfLastDay = endDt.startOf('day');

  // Check if start is at midnight (within 1 second tolerance)
  const startIsAtMidnight = Math.abs(startDt.diff(startOfFirstDay, 'seconds').seconds) < 1;
  // Check if end is at midnight (within 1 second tolerance)
  const endIsAtMidnight = Math.abs(endDt.diff(endDt.startOf('day'), 'seconds').seconds) < 1;

  console.log(`[HYBRID-SPLIT] Start is at midnight: ${startIsAtMidnight}, End is at midnight: ${endIsAtMidnight}`);

  // Iterate through each day in the range
  let currentDay = startOfFirstDay;

  while (currentDay <= startOfLastDay) {
    const dayStart = currentDay.startOf('day');
    const dayEnd = currentDay.endOf('day');
    const dateStr = currentDay.toFormat('yyyy-MM-dd');

    // Determine if this day is complete or partial
    const isFirstDay = currentDay.hasSame(startOfFirstDay, 'day');
    const isLastDay = currentDay.hasSame(startOfLastDay, 'day');

    if (isFirstDay && isLastDay) {
      // Query spans only one day
      if (startIsAtMidnight && (endIsAtMidnight || endDt >= dayEnd)) {
        // Complete day: from midnight to midnight (or beyond)
        completeDays.push({
          start: dayStart.toJSDate(),
          end: dayEnd.toJSDate(),
          dateStr: dateStr
        });
        console.log(`[HYBRID-SPLIT] Day ${dateStr}: Complete (single day, midnight to midnight+)`);
      } else {
        // Partial day within this day
        partialDays.push({
          start: start,
          end: end,
          type: 'single'
        });
        console.log(`[HYBRID-SPLIT] Day ${dateStr}: Partial (single day, not midnight to midnight)`);
      }
    } else if (isFirstDay) {
      // First day of multi-day range
      if (startIsAtMidnight) {
        // Starts at midnight - it's a complete day
        completeDays.push({
          start: dayStart.toJSDate(),
          end: dayEnd.toJSDate(),
          dateStr: dateStr
        });
        console.log(`[HYBRID-SPLIT] Day ${dateStr}: Complete (first day, starts at midnight)`);
      } else {
        // Starts mid-day - it's partial
        partialDays.push({
          start: start,
          end: dayEnd.toJSDate(),
          type: 'start'
        });
        console.log(`[HYBRID-SPLIT] Day ${dateStr}: Partial (first day, starts mid-day)`);
      }
    } else if (isLastDay) {
      // Last day of multi-day range
      if (endIsAtMidnight || endDt >= dayEnd) {
        // Ends at or after midnight - the previous day is complete
        // This day itself is not included if it ends exactly at midnight
        if (!endIsAtMidnight) {
          // Ends mid-day
          partialDays.push({
            start: dayStart.toJSDate(),
            end: end,
            type: 'end'
          });
          console.log(`[HYBRID-SPLIT] Day ${dateStr}: Partial (last day, ends mid-day)`);
        } else {
          // Ends exactly at midnight - this day boundary is not included
          console.log(`[HYBRID-SPLIT] Day ${dateStr}: Skipped (ends exactly at midnight of this day)`);
        }
      } else {
        // Shouldn't reach here if logic is correct
        console.log(`[HYBRID-SPLIT] Day ${dateStr}: Unexpected condition in last day logic`);
      }
    } else {
      // Middle day - always complete
      completeDays.push({
        start: dayStart.toJSDate(),
        end: dayEnd.toJSDate(),
        dateStr: dateStr
      });
      console.log(`[HYBRID-SPLIT] Day ${dateStr}: Complete (middle day)`);
    }

    // Move to next day
    currentDay = currentDay.plus({ days: 1 });
  }

  console.log(`[HYBRID-SPLIT] Result: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);

  return { completeDays, partialDays };
}

// ===========================================================================
// Machine hybrid helpers
// ===========================================================================

/**
 * Fetch cached daily totals for machines (and machine-items) for complete days.
 * @param {import("mongodb").Db} db
 * @param {Array<{dateStr: string}>} completeDays
 * @param {string|number|undefined} serial  Optional machine serial filter
 */
async function getCachedDataForDays(db, completeDays, serial) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);

  // Get machine daily totals for complete days
  // Handle both old format (no entityType) and new format (with entityType)
  const machineQuery = {
    date: { $in: dateStrings },
    machineSerial: { $exists: true },
    itemId: { $exists: false } // Machine records don't have itemId
  };

  // Add entityType filter if it exists, otherwise rely on field presence
  machineQuery.$or = [
    { entityType: 'machine' },
    { entityType: { $exists: false } } // Old format without entityType
  ];

  if (serial) {
    machineQuery.machineSerial = serial;
  }

  const machineTotals = await cacheCollection.find(machineQuery).toArray();

  // Get machine-item daily totals for complete days
  // Handle both old format (no entityType) and new format (with entityType)
  const machineItemQuery = {
    date: { $in: dateStrings },
    machineSerial: { $exists: true },
    itemId: { $exists: true } // Machine-item records have both machineSerial and itemId
  };

  // Add entityType filter if it exists, otherwise rely on field presence
  machineItemQuery.$or = [
    { entityType: 'machine-item' },
    { entityType: { $exists: false } } // Old format without entityType
  ];

  if (serial) {
    machineItemQuery.machineSerial = serial;
  }

  const machineItemTotals = await cacheCollection.find(machineItemQuery).toArray();

  return { machines: machineTotals, machineItems: machineItemTotals };
}

/**
 * Query live machine sessions for partial day ranges and aggregate them
 * into machine and machine-item totals.
 * @param {import("mongodb").Db} db
 * @param {Array<{start: Date, end: Date}>} partialDays
 * @param {string|number|undefined} serial  Optional machine serial filter
 * @param {{ shiftId?: string }} [options] When shiftId is set, only sessions with matching persisted shift._id (string or ObjectId in DB)
 */
async function getSessionDataForPartialDays(db, partialDays, serial, options = {}) {
  const machines = [];
  const machineItems = [];
  const shiftIdOpt = options.shiftId != null && options.shiftId !== "" ? String(options.shiftId) : null;

  for (const partialDay of partialDays) {
    // Query machine sessions for this partial day
    const match = {
      "timestamps.start": { $lte: partialDay.end },
      $or: [
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": { $gte: partialDay.start } },
      ],
    };

    if (serial) {
      match.$and = [
        {
          $or: [
            { "machine.serial": serial },
            { "machine.id": serial },
          ],
        },
      ];
    }

    if (shiftIdOpt) {
      if (ObjectId.isValid(shiftIdOpt)) {
        match["shift._id"] = { $in: [shiftIdOpt, new ObjectId(shiftIdOpt)] };
      } else {
        match["shift._id"] = shiftIdOpt;
      }
    }

    const sessions = await db
      .collection(config.machineSessionCollectionName)
      .aggregate([
        { $match: match },
        {
          $addFields: {
            ovStart: { $max: ["$timestamps.start", partialDay.start] },
            ovEnd: {
              $min: [{ $ifNull: ["$timestamps.end", partialDay.end] }, partialDay.end],
            },
          },
        },
        {
          $addFields: {
            sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] },
          },
        },
        {
          $project: {
            _id: 0,
            type: 1,
            status: 1,
            timestamps: 1,
            machine: 1,
            operators: 1,
            countsFiltered: {
              $map: {
                input: {
                  $filter: {
                    input: {
                      $cond: [
                        { $isArray: "$counts" },
                        "$counts",
                        {
                          $cond: [
                            { $isArray: "$counts.valid" },
                            "$counts.valid",
                            {
                              $cond: [
                                { $isArray: "$counts.all" },
                                "$counts.all",
                                [],
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    as: "c",
                    cond: {
                      $let: {
                        vars: {
                          countTs: {
                            $ifNull: [
                              "$$c.timestamp",
                              {
                                $ifNull: [
                                  "$$c.timestamps.create",
                                  "$$c.timestamps.active",
                                ],
                              },
                            ],
                          },
                        },
                        in: {
                          $and: [
                            { $gte: ["$$countTs", partialDay.start] },
                            { $lte: ["$$countTs", partialDay.end] },
                          ],
                        },
                      },
                    },
                  },
                },
                as: "c",
                in: {
                  timestamp: {
                    $ifNull: [
                      "$$c.timestamp",
                      {
                        $ifNull: [
                          "$$c.timestamps.create",
                          "$$c.timestamps.active",
                        ],
                      },
                    ],
                  },
                  item: {
                    id: "$$c.item.id",
                    name: "$$c.item.name",
                    standard: "$$c.item.standard",
                  },
                },
              },
            },
            ovStart: 1,
            ovEnd: 1,
            sliceMs: 1,
          },
        },
      ])
      .toArray();

    // Process sessions to create machine totals (similar to original route logic)
    const grouped = new Map();
    for (const s of sessions) {
      const key = s.machine?.serial ?? s.machine?.id;
      if (!key) continue;
      if (!grouped.has(key)) {
        grouped.set(key, {
          machine: { name: s.machine?.name || "Unknown", serial: key },
          totalCount: 0,
          totalWorkedMs: 0,
          totalRuntimeMs: 0,
          totalFaultMs: 0,
          totalPausedMs: 0,
          totalFaults: 0,
          itemAgg: new Map(),
        });
      }
      const bucket = grouped.get(key);

      if (!s.sliceMs || s.sliceMs <= 0) continue;

      const timeClass = classifySessionTime(s);
      if (timeClass === "paused") {
        bucket.totalPausedMs += s.sliceMs;
      } else if (timeClass === "fault") {
        bucket.totalFaultMs += s.sliceMs;
        bucket.totalFaults += 1;
      }

      const isRunning = timeClass === "run";
      const activeStations = Array.isArray(s.operators)
        ? s.operators.filter((op) => op && op.id !== -1).length
        : s.operator && s.operator.id !== -1
          ? 1
          : 0;

      const workedTimeMs = isRunning ? Math.max(0, s.sliceMs * activeStations) : 0;
      const runtimeMs = isRunning ? Math.max(0, s.sliceMs) : 0;

      bucket.totalRuntimeMs += runtimeMs;
      if (!isRunning) continue;

      const rawCounts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
      const counts = rawCounts
        .map((c) => ({
          timestamp:
            c.timestamp ||
            c.timestamps?.create ||
            c.timestamps?.active ||
            c.timestamps?.update,
          item: c.item,
        }))
        .filter((c) => {
          const timestamp = c.timestamp ? new Date(c.timestamp) : null;
          return (
            c.item &&
            timestamp instanceof Date &&
            !Number.isNaN(timestamp.getTime()) &&
            timestamp >= partialDay.start &&
            timestamp <= partialDay.end
          );
        });
      if (!counts.length) continue;

      const byItem = new Map();
      for (const c of counts) {
        const it = c.item || {};
        const id = it.id;
        if (id == null) continue;
        if (!byItem.has(id)) {
          byItem.set(id, {
            id,
            name: it.name || "Unknown",
            standard: Number(it.standard) || 0,
            count: 0,
          });
        }
        byItem.get(id).count += 1;
      }

      const totalSessionItemCount = [...byItem.values()].reduce((s, it) => s + it.count, 0) || 1;

      for (const [, itm] of byItem) {
        const share = itm.count / totalSessionItemCount;
        const workedShare = workedTimeMs * share;

        const rec =
          bucket.itemAgg.get(itm.id) || {
            name: itm.name,
            standard: itm.standard,
            count: 0,
            workedTimeMs: 0,
          };
        rec.count += itm.count;
        rec.workedTimeMs += workedShare;
        bucket.itemAgg.set(itm.id, rec);

        bucket.totalCount += itm.count;
        bucket.totalWorkedMs += workedShare;
      }
    }

    // Convert grouped data to totals format
    for (const [serial, bucket] of grouped) {
      machines.push({
        machineSerial: serial,
        machineName: bucket.machine.name,
        totalCounts: bucket.totalCount,
        workedTimeMs: bucket.totalWorkedMs,
        runtimeMs: bucket.totalRuntimeMs,
        faultTimeMs: bucket.totalFaultMs,
        pausedTimeMs: bucket.totalPausedMs,
        totalFaults: bucket.totalFaults,
        totalMisfeeds: 0,
        totalTimeCreditMs: 0
      });

      // Convert item aggregations to machine-item totals
      for (const [itemId, itemData] of bucket.itemAgg) {
        machineItems.push({
          itemId: itemId,
          itemName: itemData.name,
          machineSerial: serial,
          machineName: bucket.machine.name,
          totalCounts: itemData.count,
          workedTimeMs: itemData.workedTimeMs,
          itemStandard: itemData.standard
        });
      }
    }
  }

  return { machines, machineItems };
}

/**
 * Combine cached machine/machine-item data with live session data.
 * Handles deduplication of cache records by (serial, itemId, date).
 */
function combineHybridData(cachedMachines, cachedMachineItems, sessionData) {
  const machineMap = new Map();
  const machineItemMap = new Map();

  // ========== Sum cached machines by serial instead of overwriting ==========
  // Multiple cache records for same serial from different dates need to be summed
  for (const machine of cachedMachines) {
    const serial = machine.machineSerial;
    if (machineMap.has(serial)) {
      // Sum with existing cached data
      const existing = machineMap.get(serial);
      existing.totalCounts += machine.totalCounts || 0;
      existing.workedTimeMs += machine.workedTimeMs || 0;
      existing.runtimeMs += machine.runtimeMs || 0;
      existing.faultTimeMs += machine.faultTimeMs || 0;
      existing.pausedTimeMs += machine.pausedTimeMs || 0;
      existing.totalFaults = (existing.totalFaults || 0) + (machine.totalFaults || 0);
      existing.totalMisfeeds = (existing.totalMisfeeds || 0) + (machine.totalMisfeeds || 0);
      existing.totalTimeCreditMs = (existing.totalTimeCreditMs || 0) + (machine.totalTimeCreditMs || 0);
      // Preserve date if not set, or keep the first one
      if (!existing.date && machine.date) {
        existing.date = machine.date;
      }
    } else {
      // First occurrence - create new entry
      machineMap.set(serial, {
        machineSerial: machine.machineSerial,
        machineName: machine.machineName,
        date: machine.date,
        runtimeMs: machine.runtimeMs || 0,
        workedTimeMs: machine.workedTimeMs || 0,
        totalCounts: machine.totalCounts || 0,
        totalMisfeeds: machine.totalMisfeeds || 0,
        faultTimeMs: machine.faultTimeMs || 0,
        pausedTimeMs: machine.pausedTimeMs || 0,
        totalFaults: machine.totalFaults || 0,
        totalTimeCreditMs: machine.totalTimeCreditMs || 0,
      });
    }
  }

  // ========== Deduplicate by (serial, itemId, date) first, then sum across dates ==========
  // Step 1: Deduplicate by (serial, itemId, date) - if exact duplicates, take max; otherwise sum
  const deduplicatedByDate = new Map(); // key: `${serial}-${itemId}-${date}`
  for (const item of cachedMachineItems) {
    const dateKey = item.date || item.dateStr || 'unknown';
    const key = `${item.machineSerial}-${item.itemId}-${dateKey}`;

    if (deduplicatedByDate.has(key)) {
      // Duplicate for same (serial, itemId, date)
      const existing = deduplicatedByDate.get(key);
      const newCounts = item.totalCounts || 0;
      const newTime = item.workedTimeMs || 0;

      // If values are very similar (within 1%), likely a duplicate - take max
      // Otherwise, might be partial updates - sum them
      const countsSimilar = Math.abs(existing.totalCounts - newCounts) / Math.max(existing.totalCounts, newCounts, 1) < 0.01;
      const timeSimilar = Math.abs(existing.workedTimeMs - newTime) / Math.max(existing.workedTimeMs, newTime, 1) < 0.01;

      if (countsSimilar && timeSimilar) {
        // Likely duplicate - take maximum
        existing.totalCounts = Math.max(existing.totalCounts, newCounts);
        existing.workedTimeMs = Math.max(existing.workedTimeMs, newTime);
      } else {
        // Different values - might be partial updates, but to be safe, take max to avoid double-counting
        // (If cache has proper deduplication, this shouldn't happen)
        existing.totalCounts = Math.max(existing.totalCounts, newCounts);
        existing.workedTimeMs = Math.max(existing.workedTimeMs, newTime);
      }
    } else {
      // First occurrence for this (serial, itemId, date)
      deduplicatedByDate.set(key, {
        machineSerial: item.machineSerial,
        itemId: item.itemId,
        itemName: item.itemName,
        itemStandard: item.itemStandard,
        date: dateKey,
        totalCounts: item.totalCounts || 0,
        workedTimeMs: item.workedTimeMs || 0,
      });
    }
  }

  // Step 2: Sum across dates by (serial, itemId)
  for (const item of deduplicatedByDate.values()) {
    const key = `${item.machineSerial}-${item.itemId}`;
    if (machineItemMap.has(key)) {
      // Sum with existing cached data (from different dates)
      const existing = machineItemMap.get(key);
      existing.totalCounts += item.totalCounts;
      existing.workedTimeMs += item.workedTimeMs;
    } else {
      // First occurrence - create new entry
      machineItemMap.set(key, {
        machineSerial: item.machineSerial,
        itemId: item.itemId,
        itemName: item.itemName,
        itemStandard: item.itemStandard,
        totalCounts: item.totalCounts,
        workedTimeMs: item.workedTimeMs,
      });
    }
  }

  // Add/combine session data
  for (const machine of sessionData.machines) {
    if (machineMap.has(machine.machineSerial)) {
      // Combine with existing cached data
      const existing = machineMap.get(machine.machineSerial);
      existing.totalCounts += machine.totalCounts || 0;
      existing.workedTimeMs += machine.workedTimeMs || 0;
      existing.runtimeMs += machine.runtimeMs || 0;
      existing.faultTimeMs += machine.faultTimeMs || 0;
      existing.pausedTimeMs += machine.pausedTimeMs || 0;
      existing.totalFaults = (existing.totalFaults || 0) + (machine.totalFaults || 0);
      existing.totalMisfeeds = (existing.totalMisfeeds || 0) + (machine.totalMisfeeds || 0);
      existing.totalTimeCreditMs = (existing.totalTimeCreditMs || 0) + (machine.totalTimeCreditMs || 0);
    } else {
      machineMap.set(machine.machineSerial, machine);
    }
  }

  for (const item of sessionData.machineItems) {
    const key = `${item.machineSerial}-${item.itemId}`;
    if (machineItemMap.has(key)) {
      // Combine with existing cached data
      const existing = machineItemMap.get(key);
      existing.totalCounts += item.totalCounts || 0;
      existing.workedTimeMs += item.workedTimeMs || 0;
    } else {
      machineItemMap.set(key, item);
    }
  }

  return {
    machines: Array.from(machineMap.values()),
    machineItems: Array.from(machineItemMap.values())
  };
}

// ===========================================================================
// Operator hybrid helpers
// ===========================================================================

/**
 * Fetch cached daily totals for operator-machine records for complete days.
 * @param {import("mongodb").Db} db
 * @param {Array<{dateStr: string}>} completeDays
 * @param {string|number|undefined} operatorId  Optional operator filter
 */
async function getOperatorCachedDataForDays(db, completeDays, operatorId) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);

  console.log(`Operator cache query for date strings:`, dateStrings);

  // Get operator-machine daily totals for complete days
  // Handle both old format (no entityType) and new format (with entityType)
  const operatorQuery = {
    date: { $in: dateStrings },
    operatorId: { $exists: true },
    machineSerial: { $exists: true }
  };

  // Add entityType filter if it exists, otherwise rely on field presence
  operatorQuery.$or = [
    { entityType: 'operator-machine' },
    { entityType: { $exists: false } } // Old format without entityType
  ];

  if (operatorId) {
    operatorQuery.operatorId = operatorId;
  }

  const operatorTotals = await cacheCollection.find(operatorQuery).toArray();

  return operatorTotals;
}

/**
 * Query live operator sessions for partial day ranges and aggregate them.
 * @param {import("mongodb").Db} db
 * @param {Array<{start: Date, end: Date}>} partialDays
 * @param {string|number|undefined} operatorId  Optional operator filter
 * @param {{ shiftId?: string }} [options] When shiftId is set, only operator sessions with matching shift._id
 */
async function getOperatorSessionDataForPartialDays(db, partialDays, operatorId, options = {}) {
  const operators = [];
  const shiftIdOpt = options.shiftId != null && options.shiftId !== "" ? String(options.shiftId) : null;

  // Helper to normalize operator name from either string or {first, surname} format
  const normalizeOperatorName = (name, opId) => {
    return formatHumanName(name, `Operator ${opId}`);
  };

  for (const partialDay of partialDays) {
    // Simple query - just get sessions that overlap the time window
    const match = {
      ...(operatorId ? { "operator.id": operatorId } : {}),
      "timestamps.start": { $lt: partialDay.end },
      $or: [
        { "timestamps.end": { $exists: false } },
        { "timestamps.end": { $gt: partialDay.start } },
      ],
    };

    if (shiftIdOpt) {
      if (ObjectId.isValid(shiftIdOpt)) {
        match["shift._id"] = { $in: [shiftIdOpt, new ObjectId(shiftIdOpt)] };
      } else {
        match["shift._id"] = shiftIdOpt;
      }
    }

    // Just get the sessions with the fields we need
    const sessions = await db
      .collection(config.operatorSessionCollectionName)
      .find(match)
      .project({
        _id: 0,
        type: 1,
        status: 1,
        operator: 1,
        machine: 1,
        totalCount: 1,
        runtime: 1,
        workTime: 1,
        counts: 1,
        timestamps: 1
      })
      .toArray();

    options.logger?.debug?.(
      `[SESSION-AGG] Got ${sessions.length} sessions for ${partialDay.start.toISOString()} to ${partialDay.end.toISOString()}`
    );

    // Group by operator and sum up the totals
    const grouped = new Map();

    for (const session of sessions) {
      const opId = session.operator?.id;
      if (!opId || opId === -1) continue;

      if (!grouped.has(opId)) {
        grouped.set(opId, {
          operatorId: opId,
          operatorName: normalizeOperatorName(session.operator?.name, opId),
          totalCounts: 0,
          runtimeMs: 0,
          workedTimeMs: 0,
          faultTimeMs: 0,
          pausedTimeMs: 0,
          totalFaults: 0,
          itemCounts: new Map()
        });
      }

      const bucket = grouped.get(opId);

      const overlapMs = getSessionOverlapMs(session, partialDay.start, partialDay.end);
      const timeClass = classifySessionTime(session);
      if (timeClass === "run") {
        bucket.runtimeMs += overlapMs;
        bucket.workedTimeMs += overlapMs;
      } else if (timeClass === "paused") {
        bucket.pausedTimeMs += overlapMs;
      } else if (timeClass === "fault") {
        bucket.faultTimeMs += overlapMs;
        bucket.totalFaults += 1;
      }

      // Track item-level counts - group by itemName (not itemId) to combine items with same name but different standards
      if (timeClass === "run") {
        // Helper to normalize item name (same as in main processing)
        const normalizeItemName = (name) => {
          if (!name) return 'Unknown';
          const str = String(name);
          const normalized = str.trim().replace(/\s+/g, ' ').toLowerCase();
          return normalized || 'Unknown';
        };

        for (const count of getSessionCountsArray(session)) {
          if (!isTimestampInRange(getCountTimestamp(count), partialDay.start, partialDay.end)) continue;

          const itemName = count.item?.name;
          if (!itemName) continue;

          // Normalize item name for consistent grouping (case-insensitive, whitespace normalized)
          const normalizedName = normalizeItemName(itemName);
          if (normalizedName === 'Unknown') continue;

          const itemCount = count.item?.count ?? 1;
          const itemStandard = count.item?.standard || 0;
          bucket.totalCounts += itemCount;

          if (!bucket.itemCounts.has(normalizedName)) {
            bucket.itemCounts.set(normalizedName, {
              itemName: itemName, // Keep original casing for display
              count: 0,
              standardWeightedSum: 0, // Sum of (count * standard) for prorated standard
              totalCountsForStandard: 0 // Total counts used for standard calculation
            });
          }
          const itemData = bucket.itemCounts.get(normalizedName);
          itemData.count += itemCount;

          // Accumulate weighted standard: sum(count * standard) for prorated calculation
          if (itemCount > 0 && itemStandard > 0) {
            itemData.standardWeightedSum += itemCount * itemStandard;
            itemData.totalCountsForStandard += itemCount;
          }
        }
      }
    }

    // Convert to output format
    for (const [opId, bucket] of grouped) {
      const itemTotals = [];
      for (const [normalizedName, itemData] of bucket.itemCounts) {
        // Calculate prorated standard: weighted average based on counts
        const proratedItemStandard = itemData.totalCountsForStandard > 0
          ? itemData.standardWeightedSum / itemData.totalCountsForStandard
          : 0;

        itemTotals.push({
          itemId: null, // No longer using itemId as identifier
          itemName: itemData.itemName, // Original casing for display
          itemStandard: Math.round(proratedItemStandard * 100) / 100, // Prorated standard
          totalCounts: itemData.count,
          workedTimeMs: 0
        });
      }

      operators.push({
        operatorId: bucket.operatorId,
        operatorName: bucket.operatorName,
        totalCounts: bucket.totalCounts,
        runtimeMs: bucket.runtimeMs,
        workedTimeMs: bucket.workedTimeMs,
        faultTimeMs: bucket.faultTimeMs,
        pausedTimeMs: bucket.pausedTimeMs,
        totalFaults: bucket.totalFaults,
        totalMisfeeds: 0,
        totalTimeCreditMs: 0,
        itemTotals: itemTotals
      });
    }
  }

  options.logger?.debug?.(`[SESSION-AGG] Returning ${operators.length} operators`);
  return { operators };
}

/**
 * Combine cached operator data with live session operator data.
 */
function combineOperatorHybridData(cachedOperators, sessionOperators) {
  const operatorMap = new Map();

  // Add cached data
  for (const operator of cachedOperators) {
    operatorMap.set(operator.operatorId, operator);
  }

  // Add/combine session data
  for (const operator of sessionOperators) {
    if (operatorMap.has(operator.operatorId)) {
      // Combine with existing cached data
      const existing = operatorMap.get(operator.operatorId);
      existing.totalCounts += operator.totalCounts;
      existing.workedTimeMs += operator.workedTimeMs;
      existing.runtimeMs += operator.runtimeMs;
      existing.faultTimeMs += operator.faultTimeMs;
      existing.pausedTimeMs += operator.pausedTimeMs;
      existing.totalFaults += operator.totalFaults;
      existing.totalMisfeeds += operator.totalMisfeeds;
      existing.totalTimeCreditMs += operator.totalTimeCreditMs;
    } else {
      operatorMap.set(operator.operatorId, operator);
    }
  }

  return Array.from(operatorMap.values());
}

// ===========================================================================
// Item hybrid helpers  (item-sessions-summary-cache route)
// ===========================================================================

/**
 * Fetch cached daily totals for items for complete days.
 * Also enriches item records with standard values from machine-item records.
 * @param {import("mongodb").Db} db
 * @param {Array<{dateStr: string}>} completeDays
 */
async function getItemCachedDataForDays(db, completeDays) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);

  // Get item daily totals for complete days
  const itemQuery = {
    entityType: 'item',
    date: { $in: dateStrings }
  };

  const itemTotals = await cacheCollection.find(itemQuery).toArray();

  // Also get machine-item records to extract standard values
  const machineItemQuery = {
    entityType: 'machine-item',
    date: { $in: dateStrings }
  };

  const machineItemTotals = await cacheCollection.find(machineItemQuery).toArray();

  // Create a map of itemId -> itemStandard from machine-item records
  const itemStandards = new Map();
  for (const machineItem of machineItemTotals) {
    const itemId = String(machineItem.itemId);
    if (machineItem.itemStandard && machineItem.itemStandard > 0) {
      // Use the highest standard value found for this item
      const currentStandard = itemStandards.get(itemId) || 0;
      if (machineItem.itemStandard > currentStandard) {
        itemStandards.set(itemId, machineItem.itemStandard);
      }
    }
  }

  // Add standard values to item totals
  for (const item of itemTotals) {
    const itemId = String(item.itemId);
    item.itemStandard = itemStandards.get(itemId) || 0;
  }

  return itemTotals;
}

/**
 * Query live item sessions for partial day ranges.
 * Iterates over active machines, uses bookending for accurate time windows.
 * @param {import("mongodb").Db} db
 * @param {Array<{start: Date, end: Date}>} partialDays
 */
async function getItemSessionDataForPartialDays(db, partialDays) {
  const items = [];

  // Get active machine serials
  const activeSerials = await db
    .collection(config.machineCollectionName || "machine")
    .distinct("id", { active: true });

  for (const partialDay of partialDays) {
    for (const serial of activeSerials) {
      // Clamp to actual running window per machine
      const bookended = await getBookendedStatesAndTimeRange(db, serial, partialDay.start, partialDay.end);
      if (!bookended) continue;
      const { sessionStart, sessionEnd } = bookended;

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
          item: 1,          // { id, name, standard }
          items: 1,         // legacy single-item fallback
          counts: 1,        // optional
          totalCount: 1,    // optional rollup
          workTime: 1,      // seconds
          runtime: 1,       // seconds
          activeStations: 1,
          operators: 1,
          timestamps: 1,
        })
        .toArray();

      if (!sessions.length) continue;

      for (const s of sessions) {
        const itm = s.item || (Array.isArray(s.items) && s.items.length === 1 ? s.items[0] : null);
        if (!itm || itm.id == null) continue;

        const sessStart = s.timestamps?.start ? new Date(s.timestamps.start) : null;
        const sessEnd = new Date(s.timestamps?.end || sessionEnd);
        if (!sessStart || Number.isNaN(sessStart)) continue;

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
          ? normalizeSessionSeconds(s.workTime, s)
          : typeof s.runtime === "number"
            ? normalizeSessionSeconds(s.runtime, s) * Math.max(1, stations || 0)
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

  return { items };
}

/**
 * Combine cached item data with live session item data.
 */
function combineItemHybridData(cachedItems, sessionItems) {
  const itemMap = new Map();

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
      existing.totalCounts += item.totalCounts;
      existing.workedTimeMs += item.workedTimeMs;
      // Use the higher standard value if available
      if (item.itemStandard && item.itemStandard > (existing.itemStandard || 0)) {
        existing.itemStandard = item.itemStandard;
      }
    } else {
      itemMap.set(key, item);
    }
  }

  return Array.from(itemMap.values());
}

// ===========================================================================
// Item daily hybrid helpers  (item-sessions-summary-daily-cache route)
// ===========================================================================

/**
 * Fetch cached item daily totals from the simulator for complete days.
 * @param {import("mongodb").Db} db
 * @param {Array<{dateStr: string}>} completeDays
 */
async function getItemDailyCachedDataForDays(db, completeDays) {
  const cacheCollection = db.collection('totals-daily');
  const dateStrings = completeDays.map(day => day.dateStr);

  // Get item daily totals from simulator (itemStandard already included)
  const itemQuery = {
    entityType: 'item',
    source: 'simulator', // Only get simulator records
    date: { $in: dateStrings }
  };

  const itemTotals = await cacheCollection.find(itemQuery).toArray();

  return itemTotals;
}

/**
 * Combine cached item daily data with live session item data.
 */
function combineItemDailyHybridData(cachedItems, sessionItems) {
  const itemMap = new Map();

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
      existing.totalCounts = (existing.totalCounts || 0) + item.totalCounts;
      existing.workedTimeMs = (existing.workedTimeMs || 0) + item.workedTimeMs;
      // Use the higher standard value if available
      if (item.itemStandard && item.itemStandard > (existing.itemStandard || 0)) {
        existing.itemStandard = item.itemStandard;
      }
    } else {
      itemMap.set(key, item);
    }
  }

  return Array.from(itemMap.values());
}

// ===========================================================================
// Exports
// ===========================================================================
module.exports = {
  // Item-daily helpers
  queryItemDailyCache,
  queryItemSessions,
  combineItemData,

  // Time-range splitting (Luxon / timezone-aware version for reports)
  splitTimeRangeForHybridReport,

  // Machine hybrid helpers
  getCachedDataForDays,
  getSessionDataForPartialDays,
  combineHybridData,

  // Operator hybrid helpers
  getOperatorCachedDataForDays,
  getOperatorSessionDataForPartialDays,
  combineOperatorHybridData,

  // Item hybrid helpers
  getItemCachedDataForDays,
  getItemSessionDataForPartialDays,
  combineItemHybridData,

  // Item daily hybrid helpers
  getItemDailyCachedDataForDays,
  combineItemDailyHybridData,
};
