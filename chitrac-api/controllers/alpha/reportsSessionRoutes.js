const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const { getBookendedStatesAndTimeRange } = require("../../utils/bookendingBuilder");

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  // analytics/machine-item-sessions-summary (without chart content)

  // router.get("/analytics/machine-item-sessions-summary", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const exactStart = new Date(start);
  //     const exactEnd = new Date(end);

  //     // Pull machine-sessions that overlap the window.
  //     // If still-open sessions (no timestamps.end), treat end as "now".
  //     const match = {
  //       ...(serial ? { "machine.serial": serial } : {}),
  //       "timestamps.start": { $lte: exactEnd },
  //       $or: [
  //         { "timestamps.end": { $exists: false } },
  //         { "timestamps.end": { $gte: exactStart } },
  //       ],
  //     };

  //     // Use an aggregation so we only carry the counts inside the window.
  //     // Note: we still keep session-level info for computing worked time.
  //     const sessions = await db
  //       .collection(config.machineSessionCollectionName)
  //       .aggregate([
  //         { $match: match },
  //         // Compute overlap window and slice length in Mongo
  //         {
  //           $addFields: {
  //             ovStart: { $max: ["$timestamps.start", exactStart] },
  //             ovEnd: {
  //               $min: [
  //                 { $ifNull: ["$timestamps.end", exactEnd] },
  //                 exactEnd,
  //               ],
  //             },
  //           },
  //         },
  //         {
  //           $addFields: {
  //             sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] },
  //           },
  //         },
  //         {
  //           $project: {
  //             _id: 0,
  //             timestamps: 1,
  //             machine: 1,
  //             operators: 1, // to compute activeStations (exclude dummy -1)
  //             // Keep only fields used and filter arrays to [start,end], then project minimal subfields
  //             countsFiltered: {
  //               $map: {
  //                 input: {
  //                   $filter: {
  //                     input: "$counts",
  //                     as: "c",
  //                     cond: {
  //                       $and: [
  //                         { $gte: ["$$c.timestamp", exactStart] },
  //                         { $lte: ["$$c.timestamp", exactEnd] },
  //                       ],
  //                     },
  //                   },
  //                 },
  //                 as: "c",
  //                 in: {
  //                   timestamp: "$$c.timestamp",
  //                   item: {
  //                     id: "$$c.item.id",
  //                     name: "$$c.item.name",
  //                     standard: "$$c.item.standard",
  //                   },
  //                 },
  //               },
  //             },
  //             ovStart: 1,
  //             ovEnd: 1,
  //             sliceMs: 1,
  //           },
  //         },
  //         // Keep all sessions (even with no counts) since they contribute worked time
  //       ])
  //       .toArray();

  //     if (!sessions.length) return res.json([]);

  //     // Group by machine.serial (preserve old route’s multi-machine behavior)
  //     const grouped = new Map();
  //     for (const s of sessions) {
  //       const key = s.machine?.serial;
  //       if (!key) continue;
  //       if (!grouped.has(key)) {
  //         grouped.set(key, {
  //           machine: {
  //             name: s.machine?.name || "Unknown",
  //             serial: key,
  //           },
  //           sessions: [],
  //           // per-item running aggregates across sessions in the window
  //           itemAgg: new Map(), // itemId -> { name, standard, count, workedTimeMs }
  //           totalCount: 0,
  //           totalWorkedMs: 0,
  //           totalRuntimeMs: 0,
  //         });
  //       }
  //       const bucket = grouped.get(key);

  //       // Use precomputed overlap slice
  //       if (!s.sliceMs || s.sliceMs <= 0) continue;

  //       // Active stations = operators excluding dummy (-1)
  //       const activeStations = Array.isArray(s.operators)
  //         ? s.operators.filter((op) => op && op.id !== -1).length
  //         : 0;

  //       // Worked time for this clipped slice
  //       const workedTimeMs = Math.max(0, s.sliceMs * activeStations);
  //       const runtimeMs = Math.max(0, s.sliceMs);

  //       // Session entry for response 
  //       bucket.sessions.push({
  //         start: new Date(s.ovStart).toISOString(),
  //         end: new Date(s.ovEnd).toISOString(),
  //         workedTimeMs,
  //         workedTimeFormatted: formatDuration(workedTimeMs),
  //         runtimeMs,
  //         runtimeFormatted: formatDuration(runtimeMs),
  //       });

  //       // Counts inside the clipped slice (already filtered by the pipeline)
  //       const counts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
  //       if (!counts.length) {
  //         continue;
  //       }

  //       // Group counts by item id
  //       const byItem = new Map();
  //       for (const c of counts) {
  //         const it = c.item || {};
  //         const id = it.id;
  //         if (id == null) continue;
  //         if (!byItem.has(id)) {
  //           byItem.set(id, {
  //             id,
  //             name: it.name || "Unknown",
  //             standard: Number(it.standard) || 0,
  //             count: 0,
  //           });
  //         }
  //         byItem.get(id).count += 1;
  //       }

  //       for (const [, itm] of byItem) {
  //         const rec = bucket.itemAgg.get(itm.id) || {
  //           name: itm.name,
  //           standard: itm.standard,
  //           count: 0,
  //           workedTimeMs: 0,
  //         };
  //         rec.count += itm.count;
  //         rec.workedTimeMs += workedTimeMs; // full credit to each item that appeared in this slice
  //         bucket.itemAgg.set(itm.id, rec);

  //         bucket.totalCount += itm.count;
  //         bucket.totalWorkedMs += workedTimeMs;
  //         bucket.totalRuntimeMs += runtimeMs;
  //       }
  //     }

  //     // Build final per-machine results (same shape as before)
  //     const results = [];
  //     for (const [, b] of grouped) {
  //       if (!b.sessions.length) {
  //         results.push({
  //           machine: b.machine,
  //           sessions: [],
  //           machineSummary: {
  //             totalCount: 0,
  //             workedTimeMs: 0,
  //             workedTimeFormatted: formatDuration(0),
  //             pph: 0,
  //             proratedStandard: 0,
  //             efficiency: 0,
  //             itemSummaries: {},
  //           },
  //         });
  //         continue;
  //       }

  //       // Per-item summaries + prorated standard
  //       let proratedStandard = 0;
  //       const itemSummaries = {};
  //       for (const [itemId, s] of b.itemAgg.entries()) {
  //         const hours = s.workedTimeMs / 3600000;
  //         const pph = hours > 0 ? s.count / hours : 0;

  //         // Efficiency = PPH / standard
  //         const eff = s.standard > 0 ? pph / s.standard : 0;

  //         // weight for prorated standard
  //         const weight = b.totalCount > 0 ? s.count / b.totalCount : 0;
  //         proratedStandard += weight * s.standard;

  //         itemSummaries[itemId] = {
  //           name: s.name,
  //           standard: s.standard,
  //           countTotal: s.count,
  //           workedTimeFormatted: formatDuration(s.workedTimeMs),
  //           pph: Math.round(pph * 100) / 100,
  //           efficiency: Math.round(eff * 10000) / 100,
  //         };
  //       }

  //       const totalHours = b.totalRuntimeMs / 3600000;
  //       const machinePph = totalHours > 0 ? b.totalCount / totalHours : 0;
  //       const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

  //       results.push({
  //         machine: b.machine,
  //         sessions: b.sessions,
  //         machineSummary: {
  //           totalCount: b.totalCount,
  //           workedTimeMs: b.totalWorkedMs,
  //           workedTimeFormatted: formatDuration(b.totalWorkedMs),
  //           runtimeMs: b.totalRuntimeMs,
  //           runtimeFormatted: formatDuration(b.totalRuntimeMs),
  //           pph: Math.round(machinePph * 100) / 100,
  //           proratedStandard: Math.round(proratedStandard * 100) / 100,
  //           efficiency: Math.round(machineEff * 10000) / 100,
  //           itemSummaries,
  //         },
  //       });
  //     }

  //     res.json(results);
  //   } catch (error) {
  //     logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
  //     res
  //       .status(500)
  //       .json({ error: "Failed to generate machine item summary" });
  //   }
  // });


  // analytics/machine-item-sessions-summary (with chart content)

  router.get("/analytics/machine-item-sessions-summary", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
  
      // ---------- helpers (local to route) ----------
      const topNSlicesPerBar = 10;
      const OTHER_LABEL = "Other";
  
      // Merge-slices so each bar has at most N slices (Top N-1 + "Other")
      function compressSlicesPerBar(
        perLabelTotals,
        N = topNSlicesPerBar,
        otherLabel = OTHER_LABEL
      ) {
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
  
      // Convert {serial -> {label -> value}} into XY-style stacked series
      function toStackedSeries(
        byMachine,
        serialToName,
        orderSerials,
        stackId
      ) {
        // union of labels (after compression)
        const labels = new Set();
        for (const s of orderSerials) {
          const m = byMachine.get(s);
          if (!m) continue;
          Object.keys(m).forEach((k) => labels.add(k));
        }
        
        // Sort labels by total descending for stable legend order
        const sortedLabels = [...labels].sort((a, b) => {
          const totalA = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[a] || 0), 0);
          const totalB = orderSerials.reduce((sum, serial) => sum + (byMachine.get(serial)?.[b] || 0), 0);
          return totalB - totalA;
        });
        
        // make one series per label
        const series = sortedLabels.map((label) => ({
          id: label,
          title: label,
          type: "bar",
          stack: stackId,
          data: orderSerials.map((serial) => ({
            x: serialToName.get(serial) || serial,
            y: (byMachine.get(serial) && byMachine.get(serial)[label]) || 0,
          })),
        }));
        return series;
      }
  
      // ---------- 1) Sessions & Items (existing logic) ----------
      const match = {
        ...(serial ? { "machine.serial": serial } : {}),
        "timestamps.start": { $lte: exactEnd },
        $or: [
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": { $gte: exactStart } },
        ],
      };
  
      const sessions = await db
        .collection(config.machineSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              ovStart: { $max: ["$timestamps.start", exactStart] },
              ovEnd: {
                $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd],
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
              timestamps: 1,
              machine: 1,
              operators: 1,
              countsFiltered: {
                $map: {
                  input: {
                    $filter: {
                      input: "$counts",
                      as: "c",
                      cond: {
                        $and: [
                          { $gte: ["$$c.timestamp", exactStart] },
                          { $lte: ["$$c.timestamp", exactEnd] },
                        ],
                      },
                    },
                  },
                  as: "c",
                  in: {
                    timestamp: "$$c.timestamp",
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
  
      if (!sessions.length) {
        return res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results: [],
          charts: {
            statusStacked: { title:"Machine Status Stacked Bar", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Duration (hours)", series: [] },
            efficiencyRanked: { title:"Ranked Efficiency% by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Efficiency (%)", series:[{ id:"Efficiency", title:"Efficiency", type:"bar", data:[] }] },
            itemsStacked: { title:"Item Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Item Count", series: [] },
            faultsStacked: { title:"Fault Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Fault Duration (hours)", series: [] },
            order: []
          }
        });
      }
  
      // Group for original results + for building charts
      const grouped = new Map(); // serial -> bucket

      for (const s of sessions) {
        const key = s.machine?.serial;
        if (!key) continue;
        if (!grouped.has(key)) {
          grouped.set(key, {
            machine: { name: s.machine?.name || "Unknown", serial: key },
            sessions: [],
            itemAgg: new Map(),
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
          });
        }
        const bucket = grouped.get(key);

        if (!s.sliceMs || s.sliceMs <= 0) continue;

        const activeStations = Array.isArray(s.operators)
          ? s.operators.filter((op) => op && op.id !== -1).length
          : 0;

        const workedTimeMs = Math.max(0, s.sliceMs * activeStations);
        const runtimeMs = Math.max(0, s.sliceMs);

        // Check if this is a synthetic "total" session spanning the whole timeRange
        const sessionStart = new Date(s.ovStart);
        const sessionEnd = new Date(s.ovEnd);
        const isSyntheticTotal = (
          Math.abs(sessionStart.getTime() - exactStart.getTime()) < 1000 && // within 1 second of exact start
          Math.abs(sessionEnd.getTime() - exactEnd.getTime()) < 1000 &&     // within 1 second of exact end
          s.sliceMs > (exactEnd.getTime() - exactStart.getTime()) * 0.9     // covers >90% of time range
        );

        // Only add to sessions array if it's not a synthetic total
        if (!isSyntheticTotal) {
          bucket.sessions.push({
            start: new Date(s.ovStart).toISOString(),
            end: new Date(s.ovEnd).toISOString(),
            workedTimeMs,
            workedTimeFormatted: formatDuration(workedTimeMs),
            runtimeMs,
            runtimeFormatted: formatDuration(runtimeMs),
          });
        }

        // Always add to runtime totals for summary math (including synthetic rows)
        bucket.totalRuntimeMs += runtimeMs;

        const counts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
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
  
        // Apportion worked time across items by count share
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
          bucket.totalWorkedMs += workedShare;   // track worked time consistently
        }
      }
  
      const results = [];
      const serialToName = new Map();
  
      for (const [, b] of grouped) {
        serialToName.set(b.machine.serial, b.machine.name);

        let proratedStandard = 0;
        const itemSummaries = {};

        for (const [itemId, s] of b.itemAgg.entries()) {
          const hours = s.workedTimeMs / 3600000;
          const pph = hours > 0 ? s.count / hours : 0;
          const eff = s.standard > 0 ? pph / s.standard : 0;
          const weight = b.totalCount > 0 ? s.count / b.totalCount : 0;
          proratedStandard += weight * s.standard;

          itemSummaries[itemId] = {
            name: s.name,
            standard: s.standard,
            countTotal: s.count,
            workedTimeFormatted: formatDuration(s.workedTimeMs),
            pph: Math.round(pph * 100) / 100,
            efficiency: Math.round(eff * 10000) / 100,
          };
        }

        // Recalculate runtime from actual sessions (excluding synthetic totals)
        const actualRuntimeMs = b.sessions.reduce((sum, session) => sum + session.runtimeMs, 0);
        
        // Use worked time for PPH calculation (per staffed time)
        const USE_WORKED_TIME = true;
        const hours = USE_WORKED_TIME ? (b.totalWorkedMs / 3600000) : (actualRuntimeMs / 3600000);
        const machinePph = hours > 0 ? b.totalCount / hours : 0;
        const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

        results.push({
          machine: b.machine,
          sessions: b.sessions,
          machineSummary: {
            totalCount: b.totalCount,
            workedTimeMs: b.totalWorkedMs,
            workedTimeFormatted: formatDuration(b.totalWorkedMs),
            runtimeMs: actualRuntimeMs,
            runtimeFormatted: formatDuration(actualRuntimeMs),
            pph: Math.round(machinePph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(machineEff * 10000) / 100,
            itemSummaries,
          },
        });
      }
  
      // ---------- 2) Status stacked (durations) ----------
      // NOTE: expects a document per state change in config.stateTickerCollectionName
      const statusAggRaw = await db
        .collection(config.stateTickerCollectionName)
        .aggregate([
          {
            $match: {
              ...(serial ? { "machine.serial": serial } : {}),
              "timestamps.start": { $lte: exactEnd },
              $or: [
                { "timestamps.end": { $exists: false } },
                { "timestamps.end": { $gte: exactStart } },
              ],
            },
          },
          {
            $addFields: {
              ovStart: { $max: ["$timestamps.start", exactStart] },
              ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
            },
          },
          { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
          {
            $project: {
              machine: 1,
              sliceMs: 1,
              label: {
                $ifNull: [
                  "$status.label",
                  { $ifNull: ["$state.label", { $ifNull: ["$state", "Unknown"] }] },
                ],
              },
            },
          },
          { $match: { sliceMs: { $gt: 0 } } },
          {
            $group: {
              _id: { serial: "$machine.serial", label: "$label" },
              name: { $first: "$machine.name" },
              totalMs: { $sum: "$sliceMs" },
            },
          },
        ])
        .toArray();

      const statusByMachine = new Map();
      for (const row of statusAggRaw) {
        const s = row._id.serial;
        const label = String(row._id.label || "Unknown");
        const val = Number(row.totalMs || 0) / 3600000; // Convert ms to hours
        if (!statusByMachine.has(s)) statusByMachine.set(s, {});
        statusByMachine.get(s)[label] = (statusByMachine.get(s)[label] || 0) + val;
        if (!serialToName.has(s)) serialToName.set(s, row.name || s);
      }
      // compress per machine
      for (const [s, rec] of statusByMachine) {
        statusByMachine.set(s, compressSlicesPerBar(rec));
      }

      // Ensure we have status data for all machines in results
      for (const result of results) {
        const serial = result.machine.serial;
        if (!statusByMachine.has(serial)) {
          statusByMachine.set(serial, { "No Data": 0 });
        }
      }

      // ---------- 3) Faults stacked (durations by fault type) ----------
      // NOTE: expects a doc per fault occurrence in config.faultSessionCollectionName
      const faultsAggRaw = await db
        .collection(config.faultSessionCollectionName)
        .aggregate([
          {
            $match: {
              ...(serial ? { "machine.serial": serial } : {}),
              "timestamps.start": { $lte: exactEnd },
              $or: [
                { "timestamps.end": { $exists: false } },
                { "timestamps.end": { $gte: exactStart } },
              ],
            },
          },
          {
            $addFields: {
              ovStart: { $max: ["$timestamps.start", exactStart] },
              ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
            },
          },
          { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
          {
            $project: {
              machine: 1,
              sliceMs: 1,
              label: {
                $ifNull: [
                  "$fault.type",
                  { $ifNull: ["$fault.label", { $ifNull: ["$code", "Unknown"] }] },
                ],
              },
            },
          },
          { $match: { sliceMs: { $gt: 0 } } },
          {
            $group: {
              _id: { serial: "$machine.serial", label: "$label" },
              name: { $first: "$machine.name" },
              totalMs: { $sum: "$sliceMs" },
            },
          },
        ])
        .toArray();

      const faultsByMachine = new Map();
      for (const row of faultsAggRaw) {
        const s = row._id.serial;
        const label = String(row._id.label || "Unknown");
        const val = Number(row.totalMs || 0) / 3600000; // Convert ms to hours
        if (!faultsByMachine.has(s)) faultsByMachine.set(s, {});
        faultsByMachine.get(s)[label] = (faultsByMachine.get(s)[label] || 0) + val;
        if (!serialToName.has(s)) serialToName.set(s, row.name || s);
      }
      for (const [s, rec] of faultsByMachine) {
        faultsByMachine.set(s, compressSlicesPerBar(rec));
      }

      // Ensure we have fault data for all machines in results
      for (const result of results) {
        const serial = result.machine.serial;
        if (!faultsByMachine.has(serial)) {
          faultsByMachine.set(serial, { "No Faults": 0 });
        }
      }

      // ---------- 4) Efficiency ranking order ----------
      const efficiencyRanked = results
        .map(r => ({
          serial: r.machine.serial,
          name: r.machine.name,
          efficiency: Number(r.machineSummary?.efficiency || 0),
        }))
        .sort((a, b) => b.efficiency - a.efficiency);

      // Build comprehensive machine ordering from all data sources
      const unionSerials = new Set(efficiencyRanked.map(r => r.serial));
      for (const m of statusByMachine.keys()) unionSerials.add(m);
      for (const m of faultsByMachine.keys()) unionSerials.add(m);
      const finalOrderSerials = [...unionSerials].filter(s => serialToName.has(s));

      // ---------- 5) Items stacked (top-9 + Other per machine) ----------
      const itemsByMachine = new Map();
      for (const r of results) {
        const m = {};
        for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
          const label = s.name || String(id);
          const count = Number(s.countTotal || 0);
          m[label] = (m[label] || 0) + count;
        }
        itemsByMachine.set(r.machine.serial, compressSlicesPerBar(m));
      }
      const itemsStacked = toStackedSeries(itemsByMachine, serialToName, finalOrderSerials, "items");
      const statusStacked = toStackedSeries(statusByMachine, serialToName, finalOrderSerials, "status");
      const faultsStacked = toStackedSeries(faultsByMachine, serialToName, finalOrderSerials, "faults");
  
      // ---------- 6) Final payload ----------
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,                  // original detailed per-machine results (unchanged shape)
        charts: {
          // Use these directly with your unified cartesian component
          statusStacked: {
            title: "Machine Status Stacked Bar",
            orientation: "horizontal",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Duration (hours)",
            series: statusStacked
          },
          efficiencyRanked: {
            title: "Ranked Efficiency% by Machine", 
            orientation: "horizontal",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Efficiency (%)",
            series: [
              {
                id: "Efficiency",
                title: "Efficiency",
                type: "bar",
                data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
              },
            ]
          },
          itemsStacked: {
            title: "Item Stacked Bar by Machine",
            orientation: "horizontal", 
            xType: "category",
            xLabel: "Machine",
            yLabel: "Item Count",
            series: itemsStacked
          },
          faultsStacked: {
            title: "Fault Stacked Bar by Machine",
            orientation: "horizontal",
            xType: "category", 
            xLabel: "Machine",
            yLabel: "Fault Duration (hours)",
            series: faultsStacked
          },
          order: finalOrderSerials.map(s => serialToName.get(s) || s), // machine display order (ranked)
        },
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate machine item summary" });
    }
  });
  




  // /analytics/operator-item-summary (sessions-based)
router.get("/analytics/operator-item-sessions-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
  
      // Pull operator-sessions that overlap the window
      const match = {
        ...(operatorId ? { "operator.id": operatorId } : {}),
        "timestamps.start": { $lte: exactEnd },
        $or: [
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": { $gte: exactStart } }
        ]
      };
  
      // Filter counts/misfeeds to exact [start,end] in Mongo; only use padded for session overlap
      const sessions = await db
        .collection(config.operatorSessionCollectionName)
        .aggregate([
          { $match: match },
          // Compute overlap window and slice length in Mongo
          {
            $addFields: {
              ovStart: { $max: ["$timestamps.start", exactStart] },
              ovEnd: {
                $min: [
                  { $ifNull: ["$timestamps.end", exactEnd] },
                  exactEnd
                ]
              }
            }
          },
          {
            $addFields: {
              sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] }
            }
          },
          {
            $project: {
              _id: 0,
              timestamps: 1,
              operator: 1,
              machine: 1,
              // Only what we need out of the arrays
              countsFiltered: {
                $map: {
                  input: {
                    $filter: {
                      input: "$counts",
                      as: "c",
                      cond: {
                        $and: [
                          { $gte: ["$$c.timestamp", exactStart] },
                          { $lte: ["$$c.timestamp", exactEnd] }
                        ]
                      }
                    }
                  },
                  as: "c",
                  in: {
                    timestamp: "$$c.timestamp",
                    item: {
                      id: "$$c.item.id",
                      name: "$$c.item.name",
                      standard: "$$c.item.standard"
                    }
                  }
                }
              },
              misfeedsFiltered: {
                $map: {
                  input: {
                    $filter: {
                      input: "$misfeeds",
                      as: "m",
                      cond: {
                        $and: [
                          { $gte: ["$$m.timestamp", exactStart] },
                          { $lte: ["$$m.timestamp", exactEnd] }
                        ]
                      }
                    }
                  },
                  as: "m",
                  in: {
                    timestamp: "$$m.timestamp",
                    item: {
                      id: "$$m.item.id",
                      name: "$$m.item.name",
                      standard: "$$m.item.standard"
                    }
                  }
                }
              },
              ovStart: 1,
              ovEnd: 1,
              sliceMs: 1
            }
          },
          // Sorting not required for aggregation accuracy
        ])
        .toArray();
  
      if (!sessions.length) return res.json([]);
  
      // Aggregate by operator-machine pair
      const pairMap = new Map(); // key = `${opId}-${serial}`
  
      for (const s of sessions) {
        const opId = s.operator?.id;
        const serial = s.machine?.serial;
        if (typeof opId !== "number" || opId === -1 || !serial) continue;
  
        const key = `${opId}-${serial}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, {
            operatorName: s.operator?.name || "Unknown",
            machineName: s.machine?.name || "Unknown",
            operatorId: opId,
            machineSerial: serial,
            totalRunMs: 0,
            items: new Map(), // itemId -> { name, standard, count, misfeed }
          });
        }
        const bucket = pairMap.get(key);
  
        // Use precomputed overlap slice
        if (!s.sliceMs || s.sliceMs <= 0) continue;
  
        // Operator session represents RUN time for that operator
        bucket.totalRunMs += Math.max(0, s.sliceMs);
  
        // Inside-window counts/misfeeds already filtered in Mongo to [start,end]
        const counts = s.countsFiltered || [];
        const misfeeds = s.misfeedsFiltered || [];
  
        // Group counts by item
        for (const c of counts) {
          const it = c.item || {};
          const id = it.id;
          if (id == null) continue;
          const rec = bucket.items.get(id) || {
            name: it.name || "Unknown",
            standard: Number(it.standard) || 666,
            count: 0,
            misfeed: 0
          };
          rec.count += 1;
          bucket.items.set(id, rec);
        }
  
        // Group misfeeds by item
        for (const m of misfeeds) {
          const it = m.item || {};
          const id = it.id;
          if (id == null) continue;
          const rec = bucket.items.get(id) || {
            name: it.name || "Unknown",
            standard: Number(it.standard) || 666,
            count: 0,
            misfeed: 0
          };
          rec.misfeed += 1;
          bucket.items.set(id, rec);
        }
      }
  
      // Build per-item rows per operator-machine pair (same shape as current route)
      const rows = [];
      for (const [, b] of pairMap) {
        if (b.items.size === 0) continue; // match current route behavior
  
        const hours = b.totalRunMs / 3_600_000;
        const runtimeFormatted = formatDuration(b.totalRunMs);
  
        for (const [, it] of b.items) {
          const pph = hours > 0 ? it.count / hours : 0;
          const standard = it.standard > 0 ? it.standard : 666;
          const efficiency = standard > 0 ? pph / standard : 0;
  
          rows.push({
            operatorName: b.operatorName,
            machineName: b.machineName,
            itemName: it.name,
            runtimeFormatted,
            count: it.count,
            misfeed: it.misfeed,
            pph: Math.round(pph * 100) / 100,
            standard,
            efficiency: Math.round(efficiency * 10000) / 100
          });
        }
      }
  
      res.json(rows);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate operator item summary report" });
    }
  });


  // API route for item summary (sessions-based)
router.get("/analytics/item-sessions-summary", async (req, res) => {
  try {
    const { start, end } = parseAndValidateQueryParams(req);
    const queryStart = new Date(start);
    const queryEnd = new Date(Math.min(new Date(end).getTime(), Date.now()));
    if (!(queryStart < queryEnd)) {
      return res.status(416).json({ error: "start must be before end" });
    }

    const itemSessColl = db.collection(config.itemSessionCollectionName || "item-session");
    const activeSerials = await db
      .collection(config.machineCollectionName || "machine")
      .distinct("serial", { active: true });

    const resultsMap = new Map();
    const normalizePPH = (std) => {
      const n = Number(std) || 0;
      return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
    };

    for (const serial of activeSerials) {
      // Clamp to actual running window per machine
      const bookended = await getBookendedStatesAndTimeRange(db, serial, queryStart, queryEnd);
      if (!bookended) continue;
      const { sessionStart, sessionEnd } = bookended;

      // Pull overlapping item-sessions
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

        const key = String(itm.id);
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            itemId: itm.id,
            name: itm.name || "Unknown",
            standard: itm.standard ?? 0,
            count: 0,
            workedSec: 0,
          });
        }
        const acc = resultsMap.get(key);
        acc.count += countInWin;
        acc.workedSec += workedSec;
        // keep first non-empty metadata
        if (!acc.name && itm.name) acc.name = itm.name;
        if (!acc.standard && itm.standard != null) acc.standard = itm.standard;
      }
    }

    // Finalize same shape as your previous /item-summary
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

    res.json(results);
  } catch (err) {
    logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: "Failed to generate item summary report" });
  }
});

  

  return router;
};




