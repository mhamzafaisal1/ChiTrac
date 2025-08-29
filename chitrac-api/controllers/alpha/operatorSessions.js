const express = require('express');

const { formatDuration } = require("../../utils/time");

const { DateTime } = require("luxon");

module.exports = function (server) {
  const router = express.Router();

  // Get logger and db from server object
  const logger = server.logger;
  const db = server.db;
  const config = require('../../modules/config');

  // Helper function to parse and validate query parameters
  function parseAndValidateQueryParams(req) {
    const { start, end } = req.query;

    if (!start || !end) {
      throw new Error('Start and end dates are required');
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date format');
    }

    if (startDate >= endDate) {
      throw new Error('Start date must be before end date');
    }

    return { start: startDate, end: endDate };
  }

  // ---- /api/alpha/analytics/operators-summary ----
  router.get("/analytics/operators-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const queryStart = new Date(DateTime.fromISO(req.query.start).toISO()); //new Date(start); NEED LUXON FOR TIMEZONE ISSUES
      let queryEnd = new Date(DateTime.fromISO(req.query.end).toISO()); //new Date(end);
      const now = new Date(DateTime.now().toISO());
      if (queryEnd > now) queryEnd = now;
      if (!(queryStart < queryEnd)) {
        return res.status(416).json({ error: "start must be before end" });
      }

      const collName = config.operatorSessionCollectionName;
      const coll = db.collection(collName);

      // Find operators that have at least one overlapping operator-session
      const operatorIds = await coll.distinct("operator.id", {
        "operator.id": { $ne: -1 },
        $or: [
          { "timestamps.start": { $gte: queryStart, $lte: queryEnd } },
          { "timestamps.end": { $gte: queryStart, $lte: queryEnd } }
        ]
      });

      if (!operatorIds.length) return res.json([]);

      const rows = await Promise.all(
        operatorIds.map(async (opId) => {
          try {
            // Pull all overlapping sessions for this operator
            const sessions = await coll.find({
              "operator.id": opId,
              $or: [
                { "timestamps.start": { $gte: queryStart, $lte: queryEnd } },
                { "timestamps.end": { $gte: queryStart, $lte: queryEnd } }
              ]
            })
              .sort({ "timestamps.start": 1 })
              .toArray();

            if (!sessions.length) return null;

            const mostRecent = sessions[sessions.length - 1];
            let currentMachine = {};
            let statusSource = {};
            let currentStatus = {};


            if (mostRecent.endState) {
              //Operator not currently running
              currentMachine = {
                serial: null,
                name: null
              };
              statusSource = mostRecent.endState;
              currentStatus = {
                code: statusSource?.status?.code ?? 0,
                name: statusSource?.status?.name ?? "Unknown"
              };
            } else {
              currentMachine = {
                serial: mostRecent?.machine?.serial ?? null,
                name: mostRecent?.machine?.name ?? null
              };
              statusSource = mostRecent.startState;
              currentStatus = {
                code: 1,
                name: "Running"
              };
            }

            // Most recent session for status + machine
            const operatorName =
              mostRecent?.operator?.name ??
              sessions[0]?.operator?.name ??
              "Unknown";

            // Truncate first if it starts before window
            {
              const first = sessions[0];
              const firstStart = new Date(first.timestamps?.start);
              if (firstStart < queryStart) {
                sessions[0] = truncateAndRecalcOperator(first, queryStart, first.timestamps?.end ? new Date(first.timestamps.end) : queryEnd);
              }
            }

            // Truncate last if it ends after window or is open
            {
              const lastIdx = sessions.length - 1;
              const last = sessions[lastIdx];
              const lastEnd = last.timestamps?.end ? new Date(last.timestamps.end) : null;
              if (!lastEnd || lastEnd > queryEnd) {
                const effectiveEnd = queryEnd;
                // keep its current (possibly truncated) start
                sessions[lastIdx] = truncateAndRecalcOperator(
                  last,
                  new Date(sessions[lastIdx].timestamps.start),
                  effectiveEnd
                );
              }
            }

            // Aggregate
            let runtimeMs = 0;
            let workTimeSec = 0;      // operator-level work time == runtimeSec
            let totalCount = 0;
            let misfeedCount = 0;
            let totalTimeCredit = 0;

            for (const s of sessions) {
              runtimeMs += Math.floor(s.runtime) * 1000;
              workTimeSec += Math.floor(s.workTime);
              totalCount += s.totalCount;
              misfeedCount += s.misfeedCount;
              totalTimeCredit += s.totalTimeCredit;
            }

            const totalMs = Math.max(0, queryEnd - queryStart);
            const downtimeMs = Math.max(0, totalMs - runtimeMs);
            const availability = totalMs ? (runtimeMs / totalMs) : 0;
            const throughput = (totalCount + misfeedCount) ? (totalCount / (totalCount + misfeedCount)) : 0;
            const efficiency = workTimeSec > 0 ? totalTimeCredit / workTimeSec : 0;
            const oee = availability * throughput * efficiency;

            return {
              operator: { id: opId, name: operatorName },
              currentStatus,
              currentMachine,
              metrics: {
                runtime: {
                  total: runtimeMs,
                  formatted: formatDuration(runtimeMs)
                },
                downtime: {
                  total: downtimeMs,
                  formatted: formatDuration(downtimeMs)
                },
                output: {
                  totalCount,
                  misfeedCount
                },
                totalCount,
                misfeedCount,
                performance: {
                  availability: {
                    value: availability,
                    percentage: (availability * 100).toFixed(2)
                  },
                  throughput: {
                    value: throughput,
                    percentage: (throughput * 100).toFixed(2)
                  },
                  efficiency: {
                    value: efficiency,
                    percentage: (efficiency * 100).toFixed(2)
                  },
                  oee: {
                    value: oee,
                    percentage: (oee * 100).toFixed(2)
                  }
                }
              },
              timeRange: { start: queryStart, end: queryEnd }
            };
          } catch (sessionError) {
            logger.error(`Error processing operator ${opId}:`, sessionError);
            return null;
          }
        })
      );

      res.json(rows.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to build operators summary" });
    }
  });

  // ---- /api/alpha/analytics/operator-machine-summary ----
  router.get("/analytics/operator-machine-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = Number(req.query.operatorId);
      if (!operatorId || Number.isNaN(operatorId)) {
        return res.status(400).json({ error: 'operatorId required and must be a number' });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      // 1) Pull operator-sessions that overlap the window
      const matchSessions = {
        'operator.id': operatorId,
        'timestamps.start': { $lte: endDate },
        $or: [{ 'timestamps.end': { $exists: false } }, { 'timestamps.end': { $gte: startDate } }],
      };

      // Aggregate by machine and pre-summed fields.
      // We avoid unwinding large counts[] arrays; use the precomputed fields on operator-session.
      const sessionsAgg = await db.collection(config.operatorSessionCollectionName).aggregate([
        { $match: matchSessions },
        {
          $addFields: {
            _ovStart: { $cond: [{ $gt: ['$timestamps.start', startDate] }, '$timestamps.start', startDate] },
            _ovEnd: {
              $cond: [
                { $gt: [{ $ifNull: ['$timestamps.end', endDate] }, endDate] },
                endDate,
                { $ifNull: ['$timestamps.end', endDate] },
              ],
            },
          },
        },
        { $match: { $expr: { $lt: ['$_ovStart', '$_ovEnd'] } } },
        // Pair items with per-item arrays for later rollups
        {
          $addFields: {
            _itemsPaired: {
              $map: {
                input: { $range: [0, { $size: '$items' }] },
                as: 'i',
                in: {
                  id: { $arrayElemAt: ['$items.id', '$$i'] },
                  name: { $arrayElemAt: ['$items.name', '$$i'] },
                  standard: { $arrayElemAt: ['$items.standard', '$$i'] },
                  count: { $arrayElemAt: ['$totalCountByItem', '$$i'] },
                  tci: { $arrayElemAt: ['$timeCreditByItem', '$$i'] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: { serial: '$machine.serial', name: '$machine.name' },
            sessions: { $sum: 1 },
            // Totals across sessions
            totalCount: { $sum: { $ifNull: ['$totalCount', 0] } },
            totalMisfeed: { $sum: { $ifNull: ['$misfeedCount', 0] } },
            totalTimeCredit: { $sum: { $ifNull: ['$totalTimeCredit', 0] } },
            runtime: { $sum: { $ifNull: ['$runtime', 0] } },
            itemsFlat: { $push: '$_itemsPaired' },
            // Keep raw intervals for fault overlap test
            intervals: { $push: { start: '$_ovStart', end: '$_ovEnd' } },
          },
        },
        // Flatten itemsFlat and aggregate by item id
        { $addFields: { itemsFlat: { $reduce: { input: '$itemsFlat', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } } } } },
        { $unwind: { path: '$itemsFlat', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              serial: '$_id.serial',
              name: '$_id.name',
              itemId: '$itemsFlat.id',
              itemName: '$itemsFlat.name',
              itemStd: '$itemsFlat.standard',
            },
            sessions: { $first: '$sessions' },
            totalCount: { $first: '$totalCount' },
            totalMisfeed: { $first: '$totalMisfeed' },
            totalTimeCredit: { $first: '$totalTimeCredit' },
            runtime: { $first: '$runtime' },
            intervals: { $first: '$intervals' },
            itemCount: { $sum: { $ifNull: ['$itemsFlat.count', 0] } },
            itemTCI: { $sum: { $ifNull: ['$itemsFlat.tci', 0] } },
          },
        },
        {
          $group: {
            _id: { serial: '$_id.serial', name: '$_id.name' },
            sessions: { $first: '$sessions' },
            totals: {
              $first: {
                totalCount: '$totalCount',
                totalMisfeed: '$totalMisfeed',
                totalTimeCredit: '$totalTimeCredit',
                runtime: '$runtime',
              },
            },
            intervals: { $first: '$intervals' },
            items: {
              $push: {
                id: '$_id.itemId',
                name: '$_id.itemName',
                standard: '$_id.itemStd',
                totalCount: '$itemCount',
                totalTimeCredit: '$itemTCI',
              },
            },
          },
        },
        // Remove null item rows that can appear if a session had zero items
        { $addFields: { items: { $filter: { input: '$items', as: 'it', cond: { $ne: ['$$it.id', null] } } } } },
        { $sort: { '_id.serial': 1 } },
      ]).toArray();

      if (!sessionsAgg.length) {
        return res.json({ context: { operatorId, start: startDate, end: endDate }, machines: [] });
      }

      // 2) For each machine, count fault-sessions that overlap ANY operator-session interval for that machine.
      const results = [];
      for (const m of sessionsAgg) {
        const serial = m._id.serial;

        // Fetch candidate fault-sessions for this machine+operator in the window
        const faults = await db.collection(config.faultSessionCollectionName).aggregate([
          {
            $match: {
              'machine.serial': serial,
              'operators.id': operatorId,
              'timestamps.start': { $lte: endDate },
              $or: [{ 'timestamps.end': { $exists: false } }, { 'timestamps.end': { $gte: startDate } }],
            },
          },
          {
            $project: {
              _id: 1,
              s: '$timestamps.start',
              e: { $ifNull: ['$timestamps.end', endDate] },
            },
          },
        ]).toArray();

        // Merge operator-session intervals then count overlaps precisely
        const merged = mergeIntervals(m.intervals.map(iv => ({ s: iv.start, e: iv.end })));
        let faultsWhileRunning = 0;
        for (const f of faults) {
          if (overlapsAny({ s: f.s, e: f.e }, merged)) faultsWhileRunning += 1;
        }

        results.push({
          machine: { serial, name: m._id.name },
          sessions: m.sessions,
          faultsWhileRunning,
          totals: m.totals, // { totalCount, totalMisfeed, totalTimeCredit, runtime } summed over operator-sessions
          items: coalesceItems(m.items), // merge same id rows across sessions already summed
        });
      }

      return res.json({
        context: { operatorId, start: startDate, end: endDate },
        machines: results,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Failed to build operator machine summary' });
    }
  });

  /* ---------------- helpers (operator version) ---------------- */

  function clamp01(x) {
    return Math.min(Math.max(x, 0), 1);
  }

  function normalizePPH(std) {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  }

  // Recompute metrics exactly like simulator's operator-session rules
  function recalcOperatorSession(session) {
    if (!session || !session.timestamps || !session.timestamps.start) {
      logger.warn('Invalid session data for recalculation');
      return session;
    }

    const start = new Date(session.timestamps.start);
    const end = new Date(session.timestamps.end || new Date());
    const runtimeMs = Math.max(0, end - start);
    const runtimeSec = runtimeMs / 1000;

    // Operator-level work time == runtimeSec
    const workTimeSec = runtimeSec;

    const counts = Array.isArray(session.counts) ? session.counts : [];
    const misfeeds = Array.isArray(session.misfeeds) ? session.misfeeds : [];
    const totalCount = counts.length;
    const misfeedCount = misfeeds.length;

    // Calculate total time credit (simplified - count per-item and use per-item standards)
    let totalTimeCredit = 0;

    // 1. Count how many of each item were produced in the truncated window
    const perItemCounts = new Map(); // key: item.id
    for (const c of counts) {
      const id = c?.item?.id;
      if (id == null) continue;
      perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
    }

    // 2. Calculate time credit for each item based on its actual count and standard
    for (const [id, cnt] of perItemCounts) {
      // Find the standard for this specific item from session.items
      const item = session.items?.find(it => it && it.id === id);
      if (item && item.standard) {
        const pph = normalizePPH(item.standard);
        if (pph > 0) {
          totalTimeCredit += cnt / (pph / 3600); // seconds
        }
      }
    }

    session.runtime = runtimeMs / 1000;
    session.workTime = workTimeSec;
    session.totalCount = totalCount;
    session.misfeedCount = misfeedCount;
    session.totalTimeCredit = totalTimeCredit;
    return session;
  }

  // Truncate to [newStart, newEnd] and recompute
  function truncateAndRecalcOperator(original, newStart, newEnd) {
    if (!original || !original.timestamps) {
      logger.warn('Invalid session for truncation');
      return original;
    }

    // Only clone what we need to modify
    const s = {
      ...original,
      timestamps: { ...original.timestamps },
      counts: [...(original.counts || [])],
      misfeeds: [...(original.misfeeds || [])]
    };

    const start = new Date(s.timestamps.start);
    const end = new Date(s.timestamps.end || new Date());

    const clampedStart = start < newStart ? newStart : start;
    const clampedEnd = end > newEnd ? newEnd : end;

    s.timestamps.start = clampedStart;
    s.timestamps.end = clampedEnd;

    const inWindow = (d) => {
      if (!d || !d.timestamp) return false;
      const ts = new Date(d.timestamp);
      return ts >= clampedStart && ts <= clampedEnd;
    };

    s.counts = s.counts.filter(inWindow);
    s.misfeeds = s.misfeeds.filter(inWindow);

    return recalcOperatorSession(s);
  }

  /* ---------------- helpers (operator-machine-summary version) ---------------- */

  function mergeIntervals(intervals) {
    const arr = intervals
      .map(iv => ({ s: new Date(iv.s).getTime(), e: new Date(iv.e).getTime() }))
      .filter(iv => Number.isFinite(iv.s) && Number.isFinite(iv.e) && iv.s < iv.e)
      .sort((a, b) => a.s - b.s);

    const out = [];
    for (const iv of arr) {
      if (!out.length || iv.s > out[out.length - 1].e) out.push({ ...iv });
      else out[out.length - 1].e = Math.max(out[out.length - 1].e, iv.e);
    }
    return out;
  }

  function overlapsAny(iv, merged) {
    const s = new Date(iv.s).getTime();
    const e = new Date(iv.e).getTime();
    if (!(s < e)) return false;
    // binary scan or linear; linear is fine for small lists
    for (const m of merged) {
      if (e <= m.s) break;
      if (s < m.e && e > m.s) return true;
    }
    return false;
  }

  function coalesceItems(items) {
    const map = new Map();
    for (const it of items) {
      const key = it.id ?? '__null__';
      if (!map.has(key)) map.set(key, { id: it.id, name: it.name, standard: it.standard, totalCount: 0, totalTimeCredit: 0 });
      const curr = map.get(key);
      curr.totalCount += it.totalCount || 0;
      curr.totalTimeCredit += it.totalTimeCredit || 0;
    }
    // Remove null-id rows if any slipped in
    return Array.from(map.values()).filter(x => x.id != null);
  }

  return router;
};