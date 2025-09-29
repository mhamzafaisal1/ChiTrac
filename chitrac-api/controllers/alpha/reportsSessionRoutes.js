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

        // Always add to runtime totals for summary math
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
        
        // Use worked time for PPH calculation
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
      // Calculate actual status durations using machine-session and fault-session collections
      // Similar to the daily dashboard machine status approach
      
      const msColl = db.collection(config.machineSessionCollectionName);
      const fsColl = db.collection(config.faultSessionCollectionName);

      // Get all machines that have sessions in the time window
      const machineSerials = await msColl.distinct("machine.serial", {
        "timestamps.start": { $lt: exactEnd },
        $or: [
          { "timestamps.end": { $gt: exactStart } }, 
          { "timestamps.end": { $exists: false } }, 
          { "timestamps.end": null }
        ],
        ...(serial ? { "machine.serial": serial } : {})
      });

      const statusByMachine = new Map();

      // Helper function to calculate overlap
      const overlap = (sStart, sEnd, wStart, wEnd) => {
        const ss = new Date(sStart);
        const se = new Date(sEnd || wEnd);
        const os = ss > wStart ? ss : wStart;
        const oe = se < wEnd ? se : wEnd;
        const ovSec = Math.max(0, (oe - os) / 1000);
        const fullSec = Math.max(0, (se - ss) / 1000);
        const f = fullSec > 0 ? ovSec / fullSec : 0;
        return { ovSec, fullSec, factor: f };
      };

      const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);

      for (const machineSerial of machineSerials) {
        const [msessions, fsessions] = await Promise.all([
          msColl.find({
            "machine.serial": machineSerial,
            "timestamps.start": { $lt: exactEnd },
            $or: [
              { "timestamps.end": { $gt: exactStart } }, 
              { "timestamps.end": { $exists: false } }, 
              { "timestamps.end": null }
            ]
          }).project({
            _id: 0, machine: 1, timestamps: 1, runtime: 1
          }).toArray(),
          fsColl.find({
            "machine.serial": machineSerial,
            "timestamps.start": { $lt: exactEnd },
            $or: [
              { "timestamps.end": { $gt: exactStart } }, 
              { "timestamps.end": { $exists: false } }, 
              { "timestamps.end": null }
            ]
          }).project({
            _id: 0, timestamps: 1, faulttime: 1
          }).toArray()
        ]);

        if (!msessions.length) continue;

        // Calculate runtime (Running status)
        let runtimeSec = 0;
        for (const s of msessions) {
          const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, exactStart, exactEnd);
          runtimeSec += safe(s.runtime) * factor; // runtime is stored in seconds
        }

        // Calculate fault time (Faulted status)
        let faultSec = 0;
        for (const fs of fsessions) {
          const sStart = fs.timestamps?.start;
          const sEnd = fs.timestamps?.end || exactEnd;
          const { ovSec, fullSec } = overlap(sStart, sEnd, exactStart, exactEnd);
          if (ovSec === 0) continue;
          const ft = safe(fs.faulttime);
          if (ft > 0 && fullSec > 0) {
            const factor = ovSec / fullSec;
            faultSec += ft * factor;
          } else {
            // open/unfinished or unrecalculated fault-session → use overlap duration
            faultSec += ovSec;
          }
        }

        // Calculate downtime (Paused/Idle status)
        const windowMs = exactEnd - exactStart;
        const runningMs = Math.round(runtimeSec * 1000);
        const faultedMs = Math.round(faultSec * 1000);
        const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));

        // Convert to hours for chart display
        const runningHours = runningMs / 3600000;
        const faultedHours = faultedMs / 3600000;
        const downtimeHours = downtimeMs / 3600000;

        const machineName = msessions[0]?.machine?.name || `Serial ${machineSerial}`;
        serialToName.set(machineSerial, machineName);

        statusByMachine.set(machineSerial, {
          "Running": runningHours,
          "Faulted": faultedHours,
          "Paused": downtimeHours
        });
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
      // Based on faultSessionRoutes.js structure - extract fault info from startState
      
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
                  "$startState.status.name",
                  { $ifNull: ["$startState.status.code", "Unknown"] },
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
      // Global compression: find top fault types across all machines
      const globalFaultTotals = new Map();
      for (const [, rec] of faultsByMachine) {
        for (const [faultType, hours] of Object.entries(rec)) {
          globalFaultTotals.set(faultType, (globalFaultTotals.get(faultType) || 0) + hours);
        }
      }
      
      // Get top fault types globally
      const sortedGlobalFaults = Array.from(globalFaultTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topNSlicesPerBar - 1)
        .map(([type]) => type);
      
      // Apply global compression to each machine
      for (const [s, rec] of faultsByMachine) {
        const compressed = {};
        let otherSum = 0;
        
        for (const [faultType, hours] of Object.entries(rec)) {
          if (sortedGlobalFaults.includes(faultType)) {
            compressed[faultType] = hours;
          } else {
            otherSum += hours;
          }
        }
        
        if (otherSum > 0) {
          compressed[OTHER_LABEL] = otherSum;
        }
        
        faultsByMachine.set(s, compressed);
      }

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

      // ---------- 5) Items stacked  ----------
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
          statusStacked: {
            title: "Machine Status Stacked Bar",
            orientation: "vertical",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Duration (hours)",
            series: statusStacked
          },
          efficiencyRanked: {
            title: "Ranked OEE% by Machine", 
            orientation: "horizontal",
            xType: "category",
            xLabel: "Machine",
            yLabel: "OEE (%)",
            series: [
              {
                id: "OEE",
                title: "OEE",
                type: "bar",
                data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
              },
            ]
          },
          itemsStacked: {
            title: "Item Stacked Bar by Machine",
            orientation: "vertical", 
            xType: "category",
            xLabel: "Machine",
            yLabel: "Item Count",
            series: itemsStacked
          },
          faultsStacked: {
            title: "Fault Stacked Bar by Machine",
            orientation: "vertical",
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
  




//   // /analytics/operator-item-summary (sessions-based)
// router.get("/analytics/operator-item-sessions-summary", async (req, res) => {
//     try {
//       const { start, end } = parseAndValidateQueryParams(req);
//       const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
//       const exactStart = new Date(start);
//       const exactEnd = new Date(end);
  
//       // Pull operator-sessions that overlap the window
//       const match = {
//         ...(operatorId ? { "operator.id": operatorId } : {}),
//         "timestamps.start": { $lte: exactEnd },
//         $or: [
//           { "timestamps.end": { $exists: false } },
//           { "timestamps.end": { $gte: exactStart } }
//         ]
//       };
  
//       // Filter counts/misfeeds to exact [start,end] in Mongo; only use padded for session overlap
//       const sessions = await db
//         .collection(config.operatorSessionCollectionName)
//         .aggregate([
//           { $match: match },
//           // Compute overlap window and slice length in Mongo
//           {
//             $addFields: {
//               ovStart: { $max: ["$timestamps.start", exactStart] },
//               ovEnd: {
//                 $min: [
//                   { $ifNull: ["$timestamps.end", exactEnd] },
//                   exactEnd
//                 ]
//               }
//             }
//           },
//           {
//             $addFields: {
//               sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] }
//             }
//           },
//           {
//             $project: {
//               _id: 0,
//               timestamps: 1,
//               operator: 1,
//               machine: 1,
//               // Only what we need out of the arrays
//               countsFiltered: {
//                 $map: {
//                   input: {
//                     $filter: {
//                       input: "$counts",
//                       as: "c",
//                       cond: {
//                         $and: [
//                           { $gte: ["$$c.timestamp", exactStart] },
//                           { $lte: ["$$c.timestamp", exactEnd] }
//                         ]
//                       }
//                     }
//                   },
//                   as: "c",
//                   in: {
//                     timestamp: "$$c.timestamp",
//                     item: {
//                       id: "$$c.item.id",
//                       name: "$$c.item.name",
//                       standard: "$$c.item.standard"
//                     }
//                   }
//                 }
//               },
//               misfeedsFiltered: {
//                 $map: {
//                   input: {
//                     $filter: {
//                       input: "$misfeeds",
//                       as: "m",
//                       cond: {
//                         $and: [
//                           { $gte: ["$$m.timestamp", exactStart] },
//                           { $lte: ["$$m.timestamp", exactEnd] }
//                         ]
//                       }
//                     }
//                   },
//                   as: "m",
//                   in: {
//                     timestamp: "$$m.timestamp",
//                     item: {
//                       id: "$$m.item.id",
//                       name: "$$m.item.name",
//                       standard: "$$m.item.standard"
//                     }
//                   }
//                 }
//               },
//               ovStart: 1,
//               ovEnd: 1,
//               sliceMs: 1
//             }
//           },
//           // Sorting not required for aggregation accuracy
//         ])
//         .toArray();
  
//       if (!sessions.length) return res.json([]);
  
//       // Aggregate by operator-machine pair
//       const pairMap = new Map(); // key = `${opId}-${serial}`
  
//       for (const s of sessions) {
//         const opId = s.operator?.id;
//         const serial = s.machine?.serial;
//         if (typeof opId !== "number" || opId === -1 || !serial) continue;
  
//         const key = `${opId}-${serial}`;
//         if (!pairMap.has(key)) {
//           pairMap.set(key, {
//             operatorName: s.operator?.name || "Unknown",
//             machineName: s.machine?.name || "Unknown",
//             operatorId: opId,
//             machineSerial: serial,
//             totalRunMs: 0,
//             items: new Map(), // itemId -> { name, standard, count, misfeed }
//           });
//         }
//         const bucket = pairMap.get(key);
  
//         // Use precomputed overlap slice
//         if (!s.sliceMs || s.sliceMs <= 0) continue;
  
//         // Operator session represents RUN time for that operator
//         bucket.totalRunMs += Math.max(0, s.sliceMs);
  
//         // Inside-window counts/misfeeds already filtered in Mongo to [start,end]
//         const counts = s.countsFiltered || [];
//         const misfeeds = s.misfeedsFiltered || [];
  
//         // Group counts by item
//         for (const c of counts) {
//           const it = c.item || {};
//           const id = it.id;
//           if (id == null) continue;
//           const rec = bucket.items.get(id) || {
//             name: it.name || "Unknown",
//             standard: Number(it.standard) || 666,
//             count: 0,
//             misfeed: 0
//           };
//           rec.count += 1;
//           bucket.items.set(id, rec);
//         }
  
//         // Group misfeeds by item
//         for (const m of misfeeds) {
//           const it = m.item || {};
//           const id = it.id;
//           if (id == null) continue;
//           const rec = bucket.items.get(id) || {
//             name: it.name || "Unknown",
//             standard: Number(it.standard) || 666,
//             count: 0,
//             misfeed: 0
//           };
//           rec.misfeed += 1;
//           bucket.items.set(id, rec);
//         }
//       }
  
//       // Build per-item rows per operator-machine pair (same shape as current route)
//       const rows = [];
//       for (const [, b] of pairMap) {
//         if (b.items.size === 0) continue; // match current route behavior
  
//         const hours = b.totalRunMs / 3_600_000;
//         const runtimeFormatted = formatDuration(b.totalRunMs);
  
//         for (const [, it] of b.items) {
//           const pph = hours > 0 ? it.count / hours : 0;
//           const standard = it.standard > 0 ? it.standard : 666;
//           const efficiency = standard > 0 ? pph / standard : 0;
  
//           rows.push({
//             operatorName: b.operatorName,
//             machineName: b.machineName,
//             itemName: it.name,
//             runtimeFormatted,
//             count: it.count,
//             misfeed: it.misfeed,
//             pph: Math.round(pph * 100) / 100,
//             standard,
//             efficiency: Math.round(efficiency * 10000) / 100
//           });
//         }
//       }
  
//       res.json(rows);
//     } catch (err) {
//       logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
//       res.status(500).json({ error: "Failed to generate operator item summary report" });
//     }
//   });

// /analytics/operator-item-sessions-summary (dashboard payload)
router.get("/analytics/operator-item-sessions-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
  
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

      const match = {
        ...(operatorId ? { "operator.id": operatorId } : {}),
        "timestamps.start": { $lte: exactEnd },
        $or: [
          { "timestamps.end": { $exists: false } },
        { "timestamps.end": { $gte: exactStart } },
      ],
      };
  
    const opSessions = await db
        .collection(config.operatorSessionCollectionName)
        .aggregate([
          { $match: match },
          {
            $addFields: {
              ovStart: { $max: ["$timestamps.start", exactStart] },
            ovEnd: { $min: [{ $ifNull: ["$timestamps.end", exactEnd] }, exactEnd] },
          },
        },
        { $addFields: { sliceMs: { $max: [0, { $subtract: ["$ovEnd", "$ovStart"] }] } } },
          {
            $project: {
              _id: 0,
              timestamps: 1,
              operator: 1,
              machine: 1,
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
                  item: { id: "$$c.item.id", name: "$$c.item.name", standard: "$$c.item.standard" },
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
  
    if (!opSessions.length) {
      return res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results: [],
        charts: {
          statusStacked: { title:"Operator Status Stacked Bar", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Duration (hours)", series: [] },
          efficiencyRanked: { title:"Ranked OEE% by Operator", orientation:"horizontal", xType:"category", xLabel:"Operator", yLabel:"OEE (%)", series:[{ id:"OEE", title:"OEE", type:"bar", data:[] }] },
          itemsStacked: { title:"Item Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Item Count", series: [] },
          faultsStacked: { title:"Fault Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Fault Duration (hours)", series: [] },
          order: []
        }
      });
    }

    const grouped = new Map(); // opId -> bucket
    const opIdToName = new Map();

    // Helper functions
    const validId = id => Number.isInteger(id) && id >= 0;
    const canonicalName = (name, id) => (name && name.trim()) || `Operator ${id}`;

    for (const s of opSessions) {
      const op = s.operator?.id;
      if (!validId(op)) continue;

      const opName = canonicalName(s.operator?.name, op);

      if (!grouped.has(op)) {
        grouped.set(op, {
          operator: { id: op, name: opName },
            totalRunMs: 0,
          totalWorkedMs: 0,
          totalCount: 0,
          itemAgg: new Map(), // itemId -> { name, standard, count, workedTimeMs }
          sessions: [],       // for display, non-synthetic windows
          });
        }
      opIdToName.set(op, opName);
      const bucket = grouped.get(op);
  
        if (!s.sliceMs || s.sliceMs <= 0) continue;
  
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
          runtimeMs: s.sliceMs,
          runtimeFormatted: formatMs(s.sliceMs),
        });
      }

      // Always add to runtime totals for summary math
      bucket.totalRunMs += s.sliceMs;

      const counts = Array.isArray(s.countsFiltered) ? s.countsFiltered : [];
      if (!counts.length) continue;

      const byItem = new Map();
        for (const c of counts) {
          const it = c.item || {};
          const id = it.id;
          if (id == null) continue;
        if (!byItem.has(id)) {
          byItem.set(id, { id, name: it.name || "Unknown", standard: Number(it.standard) || 0, count: 0 });
        }
        byItem.get(id).count += 1;
      }

      // Apportion worked time across items by count share
      const totalSessionItemCount = [...byItem.values()].reduce((sum, it) => sum + it.count, 0) || 1;

      for (const [, it] of byItem) {
        const share = it.count / totalSessionItemCount;
        const workedShare = s.sliceMs * share;

        const rec = bucket.itemAgg.get(it.id) || { name: it.name, standard: it.standard, count: 0, workedTimeMs: 0 };
        rec.count += it.count;
        rec.workedTimeMs += workedShare;
        bucket.itemAgg.set(it.id, rec);

        bucket.totalCount += it.count;
        bucket.totalWorkedMs += workedShare;   // track worked time consistently
      }
    }

    // Build results and efficiency
    const results = [];
    for (const [, b] of grouped) {
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
          workedTimeFormatted: formatMs(s.workedTimeMs),
          pph: Math.round(pph * 100) / 100,
          efficiency: Math.round(eff * 10000) / 100,
        };
      }

      // Recalculate runtime from actual sessions (excluding synthetic totals)
      const actualRuntimeMs = b.sessions.reduce((sum, session) => sum + session.runtimeMs, 0);
      
      // Use worked time for PPH calculation
      const USE_WORKED_TIME = true;
      const hours = USE_WORKED_TIME ? (b.totalWorkedMs / 3600000) : (actualRuntimeMs / 3600000);
      const operatorPph = hours > 0 ? b.totalCount / hours : 0;
      const operatorEff = proratedStandard > 0 ? operatorPph / proratedStandard : 0;

      results.push({
        operator: b.operator,
        sessions: b.sessions,
        operatorSummary: {
          totalCount: b.totalCount,
          workedTimeMs: b.totalWorkedMs,
          workedTimeFormatted: formatMs(b.totalWorkedMs),
          runtimeMs: actualRuntimeMs,
          runtimeFormatted: formatMs(actualRuntimeMs),
          pph: Math.round(operatorPph * 100) / 100,
          proratedStandard: Math.round(proratedStandard * 100) / 100,
          efficiency: Math.round(operatorEff * 10000) / 100,
          itemSummaries,
        },
      });
    }

    // ---------- 2) Status stacked (durations) ----------
    // Calculate actual status durations using operator-session and fault-session collections
    // Similar to the daily dashboard machine status approach but for operators
    
    const opColl = db.collection(config.operatorSessionCollectionName);
    const fsColl = db.collection(config.faultSessionCollectionName);

    // Get all operators that have sessions in the time window
    const allOperatorIds = await opColl.distinct("operator.id", {
      "timestamps.start": { $lt: exactEnd },
      $or: [
        { "timestamps.end": { $gt: exactStart } }, 
        { "timestamps.end": { $exists: false } }, 
        { "timestamps.end": null }
      ],
      ...(operatorId ? { "operator.id": operatorId } : {})
    });
    
    // Filter to only valid operator IDs
    const operatorIds = allOperatorIds.filter(validId);

    const statusByOperator = new Map();

    // Helper function to calculate overlap
    const overlap = (sStart, sEnd, wStart, wEnd) => {
      const ss = new Date(sStart);
      const se = new Date(sEnd || wEnd);
      const os = ss > wStart ? ss : wStart;
      const oe = se < wEnd ? se : wEnd;
      const ovSec = Math.max(0, (oe - os) / 1000);
      const fullSec = Math.max(0, (se - ss) / 1000);
      const f = fullSec > 0 ? ovSec / fullSec : 0;
      return { ovSec, fullSec, factor: f };
    };

    // Helper function to detect synthetic sessions
    const isSynthetic = (s) => {
      const ss = new Date(s.timestamps?.start);
      const se = new Date(s.timestamps?.end || exactEnd);
      return Math.abs(ss - exactStart) < 1000 &&
             Math.abs(se - exactEnd) < 1000 &&
             (se - ss) > 0.9 * (exactEnd - exactStart);
    };

    for (const opId of operatorIds) {
      const [opSessions, fsessions] = await Promise.all([
        opColl.find({
          "operator.id": opId,
          "timestamps.start": { $lt: exactEnd },
          $or: [
            { "timestamps.end": { $gt: exactStart } }, 
            { "timestamps.end": { $exists: false } }, 
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, operator: 1, timestamps: 1
        }).toArray(),
        fsColl.find({
          "operator.id": opId,
          "timestamps.start": { $lt: exactEnd },
          $or: [
            { "timestamps.end": { $gt: exactStart } }, 
            { "timestamps.end": { $exists: false } }, 
            { "timestamps.end": null }
          ]
        }).project({
          _id: 0, timestamps: 1, faulttime: 1
        }).toArray()
      ]);

      if (!opSessions.length) continue;

      // Calculate runtime (Running status) - operator session time
      // Exclude synthetic totals from status calculation
      let runtimeSec = 0;
      for (const s of opSessions) {
        if (isSynthetic(s)) continue; // skip synthetic sessions
        const { ovSec } = overlap(s.timestamps?.start, s.timestamps?.end, exactStart, exactEnd);
        runtimeSec += ovSec;
      }
      
      // Optional hard clamp (safety)
      runtimeSec = Math.min(runtimeSec, (exactEnd - exactStart) / 1000);

      // Calculate fault time (Faulted status)
      let faultSec = 0;
      for (const fs of fsessions) {
        const sStart = fs.timestamps?.start;
        const sEnd = fs.timestamps?.end || exactEnd;
        const { ovSec, fullSec } = overlap(sStart, sEnd, exactStart, exactEnd);
        if (ovSec === 0) continue;
        const ft = safe(fs.faulttime);
        if (ft > 0 && fullSec > 0) {
          const factor = ovSec / fullSec;
          faultSec += ft * factor;
        } else {
          // open/unfinished or unrecalculated fault-session → use overlap duration
          faultSec += ovSec;
        }
      }

      // Calculate downtime (Paused/Idle status)
      const windowMs = exactEnd - exactStart;
      const runningMs = Math.round(runtimeSec * 1000);
      const faultedMs = Math.round(faultSec * 1000);
      const downtimeMs = Math.max(0, windowMs - (runningMs + faultedMs));

      // Convert to hours for chart display
      const runningHours = runningMs / 3600000;
      const faultedHours = faultedMs / 3600000;
      const downtimeHours = downtimeMs / 3600000;

      const operatorName = canonicalName(opSessions[0]?.operator?.name, opId);
      opIdToName.set(opId, operatorName);

      statusByOperator.set(opId, {
        "Running": runningHours,
        "Faulted": faultedHours,
        "Paused": downtimeHours
      });
    }
    // compress per operator
    for (const [s, rec] of statusByOperator) {
      statusByOperator.set(s, compressSlicesPerBar(rec));
    }

    // Ensure we have status data for all operators in results
    for (const result of results) {
      const opId = result.operator.id;
      if (!statusByOperator.has(opId)) {
        statusByOperator.set(opId, { "No Data": 0 });
      }
    }

    // ---------- 3) Faults stacked (durations by fault type) ----------
    // Based on faultSessionRoutes.js structure - extract fault info from startState
    
    const faultsAggRaw = await db
      .collection(config.faultSessionCollectionName)
      .aggregate([
        {
          $match: {
            ...(operatorId ? { "operator.id": operatorId } : {}),
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
            operator: 1,
            sliceMs: 1,
            label: {
              $ifNull: [
                "$startState.status.name",
                { $ifNull: ["$startState.status.code", "Unknown"] },
              ],
            },
          },
        },
        { $match: { sliceMs: { $gt: 0 } } },
        {
          $group: {
            _id: { operatorId: "$operator.id", label: "$label" },
            name: { $first: "$operator.name" },
            totalMs: { $sum: "$sliceMs" },
          },
        },
      ])
      .toArray();

    const faultsByOperator = new Map();
    for (const row of faultsAggRaw) {
      const opId = row._id.operatorId;
      if (!validId(opId)) continue; // skip invalid operator IDs
      
      const label = String(row._id.label || "Unknown");
      const val = Number(row.totalMs || 0) / 3600000; // Convert ms to hours
      if (!faultsByOperator.has(opId)) faultsByOperator.set(opId, {});
      faultsByOperator.get(opId)[label] = (faultsByOperator.get(opId)[label] || 0) + val;
      if (!opIdToName.has(opId)) opIdToName.set(opId, canonicalName(row.name, opId));
    }
    // Global compression: find top fault types across all operators
    const globalFaultTotals = new Map();
    for (const [, rec] of faultsByOperator) {
      for (const [faultType, hours] of Object.entries(rec)) {
        globalFaultTotals.set(faultType, (globalFaultTotals.get(faultType) || 0) + hours);
      }
    }
    
    // Get top fault types globally
    const sortedGlobalFaults = Array.from(globalFaultTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topNSlicesPerBar - 1)
      .map(([type]) => type);
    
    // Apply global compression to each operator
    for (const [opId, rec] of faultsByOperator) {
      const compressed = {};
      let otherSum = 0;
      
      for (const [faultType, hours] of Object.entries(rec)) {
        if (sortedGlobalFaults.includes(faultType)) {
          compressed[faultType] = hours;
        } else {
          otherSum += hours;
        }
      }
      
      if (otherSum > 0) {
        compressed[OTHER_LABEL] = otherSum;
      }
      
      faultsByOperator.set(opId, compressed);
    }

    for (const result of results) {
      const opId = result.operator.id;
      if (!faultsByOperator.has(opId)) {
        faultsByOperator.set(opId, { "No Faults": 0 });
      }
    }

    // ---------- 4) Efficiency ranking order ----------
    const efficiencyRanked = results
      .map(r => ({
        operatorId: r.operator.id,
        name: r.operator.name,
        efficiency: Number(r.operatorSummary?.efficiency || 0),
      }))
      .sort((a, b) => b.efficiency - a.efficiency);

    // Build comprehensive operator ordering from all data sources
    const unionOperatorIds = new Set(efficiencyRanked.map(r => r.operatorId));
    for (const m of statusByOperator.keys()) unionOperatorIds.add(m);
    for (const m of faultsByOperator.keys()) unionOperatorIds.add(m);
    const finalOrderOperatorIds = [...unionOperatorIds]
      .filter(validId)
      .filter(id => opIdToName.has(id));

    // ---------- 5) Items stacked  ----------
    const itemsByOperator = new Map();
    for (const r of results) {
      const m = {};
      for (const [id, s] of Object.entries(r.operatorSummary.itemSummaries || {})) {
        const label = s.name || String(id);
        const count = Number(s.countTotal || 0);
        m[label] = (m[label] || 0) + count;
      }
      itemsByOperator.set(r.operator.id, compressSlicesPerBar(m));
    }
    const itemsStacked = toStackedSeries(itemsByOperator, opIdToName, finalOrderOperatorIds, "items");
    const statusStacked = toStackedSeries(statusByOperator, opIdToName, finalOrderOperatorIds, "status");
    const faultsStacked = toStackedSeries(faultsByOperator, opIdToName, finalOrderOperatorIds, "faults");

    // ---------- 6) Final payload ----------
    res.json({
      timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
      results,                  // original detailed per-operator results (unchanged shape)
      charts: {
        statusStacked: {
          title: "Operator Status Stacked Bar",
          orientation: "vertical",
          xType: "category",
          xLabel: "Operator",
          yLabel: "Duration (hours)",
          series: statusStacked
        },
        efficiencyRanked: {
          title: "Ranked OEE% by Operator", 
          orientation: "horizontal",
          xType: "category",
          xLabel: "Operator",
          yLabel: "OEE (%)",
          series: [
            {
              id: "OEE",
              title: "OEE",
              type: "bar",
              data: efficiencyRanked.map(r => ({ x: opIdToName.get(r.operatorId), y: r.efficiency })),
            },
          ]
        },
        itemsStacked: {
          title: "Item Stacked Bar by Operator",
          orientation: "vertical", 
          xType: "category",
          xLabel: "Operator",
          yLabel: "Item Count",
          series: itemsStacked
        },
        faultsStacked: {
          title: "Fault Stacked Bar by Operator",
          orientation: "vertical",
          xType: "category", 
          xLabel: "Operator",
          yLabel: "Fault Duration (hours)",
          series: faultsStacked
        },
        order: finalOrderOperatorIds.map(s => opIdToName.get(s) || s), // operator display order (ranked)
      },
    });
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

  // New route that uses daily totals for optimized performance on timeframes
  router.get("/analytics/machine-item-sessions-summary-optimized", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      // Check if this is a timeframe that can use daily totals optimization
      const isOptimizedTimeframe = req.query.timeframe && 
        ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

      if (!isOptimizedTimeframe) {
        // Fallback to original route for non-optimized timeframes
        return res.status(400).json({
          error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
        });
      }

      logger.info(`Using daily totals optimization for timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        logger.error('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      
      logger.info('Querying totals-daily for date range:', { startDate, endDate });

      // Query the totals-daily collection for machine records
      const dailyTotalsCollection = db.collection("totals-daily");
      
      // Build query for machine records in date range
      const query = {
        entityType: 'machine',
        date: {
          $gte: startDate,
          $lte: endDate
        }
      };

      // Filter by machine serial if specified
      if (serial) {
        query.machineSerial = parseInt(serial);
      }
      
      // Get daily totals data
      let dailyTotals;
      try {
        dailyTotals = await dailyTotalsCollection.find(query).toArray();
        logger.info(`Found ${dailyTotals.length} daily total records`);
      } catch (dbError) {
        logger.error('Database query error:', dbError);
        return res.status(500).json({ 
          error: 'Database query failed',
          message: dbError.message 
        });
      }
      
      if (!dailyTotals || dailyTotals.length === 0) {
        return res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results: [],
          charts: {
            statusStacked: { title:"Machine Status Stacked Bar", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Duration (hours)", series: [] },
            efficiencyRanked: { title:"Ranked Efficiency% by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Efficiency (%)", series:[{ id:"Efficiency", title:"Efficiency", type:"bar", data:[] }] },
            itemsStacked: { title:"Item Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Item Count", series: [] },
            faultsStacked: { title:"Fault Stacked Bar by Machine", orientation:"horizontal", xType:"category", xLabel:"Machine", yLabel:"Fault Duration (hours)", series: [] },
            order: []
          },
          optimization: {
            used: true,
            timeframe: req.query.timeframe,
            dataSource: 'daily-totals-cache'
          }
        });
      }

      logger.info(`Processing ${dailyTotals.length} machine daily total records`);

      try {
        // Aggregate daily totals by machine
        const aggregated = new Map();
      
      dailyTotals.forEach((total, index) => {
        try {
          logger.debug(`Processing record ${index + 1}/${dailyTotals.length}:`, {
            machineSerial: total.machineSerial,
            machineName: total.machineName,
            date: total.date,
            _id: total._id
          });

          // Validate that we have required fields
          if (!total.machineSerial) {
            logger.warn(`Record ${index + 1} missing machineSerial:`, {
              _id: total._id,
              date: total.date,
              machineName: total.machineName,
              availableFields: Object.keys(total)
            });
            return; // Skip this record
          }

          const key = total.machineSerial;
          if (!aggregated.has(key)) {
            aggregated.set(key, {
              machineSerial: total.machineSerial,
              machineName: total.machineName,
              runtimeMs: 0,
              faultTimeMs: 0,
              workedTimeMs: 0,
              pausedTimeMs: 0,
              totalFaults: 0,
              totalCounts: 0,
              totalMisfeeds: 0,
              totalTimeCreditMs: 0,
              days: [],
              dateRange: { start: total.date, end: total.date }
            });
          }
          
          const machine = aggregated.get(key);
          
          // Sum all metrics with safe defaults
          machine.runtimeMs += (total.runtimeMs || 0);
          machine.faultTimeMs += (total.faultTimeMs || 0);
          machine.workedTimeMs += (total.workedTimeMs || 0);
          machine.pausedTimeMs += (total.pausedTimeMs || 0);
          machine.totalFaults += (total.totalFaults || 0);
          machine.totalCounts += (total.totalCounts || 0);
          machine.totalMisfeeds += (total.totalMisfeeds || 0);
          machine.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
          machine.days.push(total);
          
          // Update date range with safe comparison
          if (total.date && machine.dateRange.start && total.date < machine.dateRange.start) {
            machine.dateRange.start = total.date;
          }
          if (total.date && machine.dateRange.end && total.date > machine.dateRange.end) {
            machine.dateRange.end = total.date;
          }
        } catch (itemError) {
          logger.error(`Error processing record ${index + 1}:`, {
            error: itemError.message,
            record: total
          });
          throw itemError;
        }
      });

      // Helper function to format duration (ensure it's available)
      const formatDuration = (ms) => {
        if (!ms || typeof ms !== 'number') return { hours: 0, minutes: 0 };
        const totalMinutes = Math.floor(ms / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return { hours, minutes };
      };

      // Convert to results format and calculate performance metrics
      const results = [];
      const serialToName = new Map();
      const statusByMachine = new Map();
      const faultsByMachine = new Map();

      logger.info(`Aggregated ${aggregated.size} machines, processing results...`);

      for (const [key, machine] of aggregated) {
        try {
          logger.debug(`Processing machine ${key}:`, {
            machineSerial: machine.machineSerial,
            machineName: machine.machineName,
            runtimeMs: machine.runtimeMs,
            workedTimeMs: machine.workedTimeMs
          });
        serialToName.set(machine.machineSerial, machine.machineName);

        // Calculate performance metrics
        const totalHours = machine.workedTimeMs / 3600000;
        const windowMs = exactEnd.getTime() - exactStart.getTime();
        
        // Basic KPIs
        const pph = totalHours > 0 ? machine.totalCounts / totalHours : 0;
        const availability = windowMs > 0 ? machine.runtimeMs / windowMs : 0;
        const throughput = (machine.totalCounts + machine.totalMisfeeds) > 0 ? 
          machine.totalCounts / (machine.totalCounts + machine.totalMisfeeds) : 0;
        
        // For efficiency, we need item standards - using a simplified approach
        // In a full implementation, you'd need to aggregate item standards from daily totals
        const efficiency = 0; // Placeholder - requires item-level data

        // Validate machine data before adding to results
        if (!machine.machineSerial) {
          logger.warn(`Skipping machine with undefined serial:`, {
            machineName: machine.machineName,
            machineSerial: machine.machineSerial,
            runtimeMs: machine.runtimeMs
          });
          return; // Skip this machine
        }

        results.push({
          machine: {
            name: machine.machineName,
            serial: machine.machineSerial
          },
          sessions: [], // Empty for optimized version - could be populated with daily summaries
          machineSummary: {
            totalCount: machine.totalCounts,
            workedTimeMs: machine.workedTimeMs,
            workedTimeFormatted: formatDuration(machine.workedTimeMs),
            runtimeMs: machine.runtimeMs,
            runtimeFormatted: formatDuration(machine.runtimeMs),
            pph: Math.round(pph * 100) / 100,
            proratedStandard: 0, // Would need item data
            efficiency: Math.round(efficiency * 10000) / 100,
            itemSummaries: {} // Empty for optimized version
          }
        });

        // Prepare data for charts
        const runningHours = machine.runtimeMs / 3600000;
        const faultedHours = machine.faultTimeMs / 3600000;
        const downtimeHours = machine.pausedTimeMs / 3600000;

        statusByMachine.set(machine.machineSerial, {
          "Running": runningHours,
          "Faulted": faultedHours,
          "Paused": downtimeHours
        });

        // Simplified fault data (grouping all faults together)
        if (machine.totalFaults > 0) {
          faultsByMachine.set(machine.machineSerial, {
            "Faults": faultedHours
          });
        } else {
          faultsByMachine.set(machine.machineSerial, {
            "No Faults": 0
          });
        }
        } catch (machineError) {
          logger.error(`Error processing machine ${key}:`, machineError);
          throw machineError;
        }
      }

      // Build efficiency ranking
      const efficiencyRanked = results
        .map(r => ({
          serial: r.machine.serial,
          name: r.machine.name,
          efficiency: Number(r.machineSummary?.efficiency || 0),
        }))
        .sort((a, b) => b.efficiency - a.efficiency);

      // Build chart series - filter out any undefined serials
      const finalOrderSerials = results
        .map(r => r.machine.serial)
        .filter(serial => serial !== undefined && serial !== null);
      
      logger.info(`Building charts for ${finalOrderSerials.length} machines (filtered from ${results.length} results)`);
      
      // Status stacked chart
      const statusStacked = finalOrderSerials.map(serial => {
        try {
          const statusData = statusByMachine.get(serial) || {};
          logger.debug(`Building status chart for machine ${serial}:`, statusData);
          
          return {
            id: String(serial), // Safe string conversion
            title: serialToName.get(serial) || String(serial),
            type: "bar",
            stack: "status",
            data: Object.entries(statusData).map(([status, hours]) => ({
              x: status,
              y: Math.round((hours || 0) * 100) / 100
            }))
          };
        } catch (chartError) {
          logger.error(`Error building status chart for machine ${serial}:`, chartError);
          throw chartError;
        }
      });

      // Faults stacked chart
      const faultsStacked = finalOrderSerials.map(serial => {
        try {
          const faultData = faultsByMachine.get(serial) || {};
          logger.debug(`Building faults chart for machine ${serial}:`, faultData);
          
          return {
            id: String(serial), // Safe string conversion
            title: serialToName.get(serial) || String(serial),
            type: "bar",
            stack: "faults",
            data: Object.entries(faultData).map(([faultType, hours]) => ({
              x: faultType,
              y: Math.round((hours || 0) * 100) / 100
            }))
          };
        } catch (chartError) {
          logger.error(`Error building faults chart for machine ${serial}:`, chartError);
          throw chartError;
        }
      });

      // Efficiency ranked chart
      const efficiencyRankedSeries = [{
        id: "Efficiency",
        title: "Efficiency",
        type: "bar",
        data: efficiencyRanked.map(r => ({
          x: r.name,
          y: r.efficiency
        }))
      }];

      // Final response
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,
        charts: {
          statusStacked: {
            title: "Machine Status Stacked Bar",
            orientation: "vertical",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Duration (hours)",
            series: statusStacked
          },
          efficiencyRanked: {
            title: "Ranked OEE% by Machine",
            orientation: "horizontal",
            xType: "category",
            xLabel: "Machine",
            yLabel: "OEE (%)",
            series: efficiencyRankedSeries
          },
          itemsStacked: {
            title: "Item Stacked Bar by Machine",
            orientation: "vertical",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Item Count",
            series: [] // Empty for optimized version
          },
          faultsStacked: {
            title: "Fault Stacked Bar by Machine",
            orientation: "vertical",
            xType: "category",
            xLabel: "Machine",
            yLabel: "Fault Duration (hours)",
            series: faultsStacked
          },
          order: finalOrderSerials.map(s => serialToName.get(s) || s.toString())
        },
        optimization: {
          used: true,
          timeframe: req.query.timeframe,
          dataSource: 'machine-daily-totals-cache',
          performance: {
            dailyTotalsCount: dailyTotals.length,
            aggregatedMachines: results.length,
            processingTime: '< 100ms estimated'
          },
          limitations: {
            itemSummaries: 'Not available in machine daily totals - would need item-level processing',
            efficiency: 'Requires item standards data not available in daily totals'
          }
        }
      });

      } catch (processingError) {
        logger.error(`Error in data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      logger.error(`Error in optimized machine item summary:`, error);
      
      // Log the error and return a proper error response
      logger.warn('Error accessing totals-daily collection:', error.message);
      
      res.status(500).json({ 
        error: "Failed to generate optimized machine item summary",
        message: error.message 
      });
    }
  });

  // New experimental route that uses daily totals for operator reports
  router.get("/analytics/operator-item-sessions-summary-optimized", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;

      // Check if this is a timeframe that can use daily totals optimization
      const isOptimizedTimeframe = req.query.timeframe && 
        ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

      if (!isOptimizedTimeframe) {
        // Fallback to original route for non-optimized timeframes
        return res.status(400).json({
          error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
        });
      }

      logger.info(`Using daily totals optimization for operator route, timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        logger.error('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      
      logger.info('Querying totals-daily for operator data:', { startDate, endDate });

      // Query the totals-daily collection for operator-machine records
      const dailyTotalsCollection = db.collection("totals-daily");
      
      // Build query for operator-machine records in date range
      const query = {
        entityType: 'operator-machine',
        date: {
          $gte: startDate,
          $lte: endDate
        }
      };

      // Filter by operatorId if specified
      if (operatorId) {
        query.operatorId = operatorId;
      }
      
      // Get operator totals data
      let operatorTotals;
      try {
        operatorTotals = await dailyTotalsCollection.find(query).toArray();
        logger.info(`Found ${operatorTotals.length} operator daily total records`);
      } catch (dbError) {
        logger.error('Database query error:', dbError);
        return res.status(500).json({ 
          error: 'Database query failed',
          message: dbError.message 
        });
      }
      
      if (!operatorTotals || operatorTotals.length === 0) {
        return res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results: [],
          charts: {
            statusStacked: { title:"Operator Status Stacked Bar", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Duration (hours)", series: [] },
            efficiencyRanked: { title:"Ranked OEE% by Operator", orientation:"horizontal", xType:"category", xLabel:"Operator", yLabel:"OEE (%)", series:[{ id:"OEE", title:"OEE", type:"bar", data:[] }] },
            itemsStacked: { title:"Item Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Item Count", series: [] },
            faultsStacked: { title:"Fault Stacked Bar by Operator", orientation:"vertical", xType:"category", xLabel:"Operator", yLabel:"Fault Duration (hours)", series: [] },
            order: []
          },
          optimization: {
            used: true,
            timeframe: req.query.timeframe,
            dataSource: 'operator-daily-totals-cache'
          }
        });
      }

      // Helper functions (reused from original route)
      const topNSlicesPerBar = 10;
      const OTHER_LABEL = "Other";

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
          id: String(label), // Safe string conversion
          title: String(label), // Safe string conversion
          type: "bar",
          stack: stackId,
          data: orderKeys.map((k) => ({
            x: keyToName.get(k) || String(k), // Safe string conversion
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

      // Helper functions for validation
      const validId = id => Number.isInteger(id) && id >= 0;
      const canonicalName = (name, id) => (name && name.trim()) || `Operator ${id}`;

      try {
        // Aggregate operator totals by operator ID
        const aggregated = new Map();
      
        logger.info(`Processing ${operatorTotals.length} operator daily total records`);
        
        operatorTotals.forEach((total, index) => {
          try {
            logger.debug(`Processing operator record ${index + 1}/${operatorTotals.length}:`, {
              operatorId: total.operatorId,
              operatorName: total.operatorName,
              machineSerial: total.machineSerial,
              date: total.date,
              totalCounts: total.totalCounts,
              workedTimeMs: total.workedTimeMs
            });

            // Validate that we have required fields
            if (!total.operatorId || !validId(total.operatorId)) {
              logger.warn(`Record ${index + 1} missing or invalid operatorId:`, {
                _id: total._id,
                date: total.date,
                operatorId: total.operatorId,
                availableFields: Object.keys(total)
              });
              return; // Skip this record
            }

            const key = total.operatorId;
            const opName = canonicalName(total.operatorName, total.operatorId);
            
            if (!aggregated.has(key)) {
              aggregated.set(key, {
                operatorId: total.operatorId,
                operatorName: opName,
                runtimeMs: 0,
                workedTimeMs: 0,
                totalCounts: 0,
                totalMisfeeds: 0,
                totalTimeCreditMs: 0,
                machines: new Set(), // Track which machines this operator worked on
                days: [],
                dateRange: { start: total.date, end: total.date }
              });
            }
            
            const operator = aggregated.get(key);
            
            // Sum all metrics with safe defaults
            operator.runtimeMs += (total.runtimeMs || 0);
            operator.workedTimeMs += (total.workedTimeMs || 0);
            operator.totalCounts += (total.totalCounts || 0);
            operator.totalMisfeeds += (total.totalMisfeeds || 0);
            operator.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
            if (total.machineSerial) {
              operator.machines.add(total.machineSerial);
            }
            operator.days.push(total);
            
            // Update date range with safe comparison
            if (total.date && operator.dateRange.start && total.date < operator.dateRange.start) {
              operator.dateRange.start = total.date;
            }
            if (total.date && operator.dateRange.end && total.date > operator.dateRange.end) {
              operator.dateRange.end = total.date;
            }

            // Keep the most recent operator name if available
            if (total.operatorName && total.operatorName !== `Operator ${total.operatorId}`) {
              operator.operatorName = total.operatorName;
            }
          } catch (itemError) {
            logger.error(`Error processing operator record ${index + 1}:`, {
              error: itemError.message,
              record: total
            });
            throw itemError;
          }
        });

        // Convert to results format matching the original route
        const results = [];
        const operatorIdToName = new Map();
        const statusByOperator = new Map();
        const faultsByOperator = new Map();

        logger.info(`Aggregated ${aggregated.size} operators, processing results...`);

        for (const [key, operator] of aggregated) {
          try {
            logger.debug(`Processing operator ${key}:`, {
              operatorId: operator.operatorId,
              operatorName: operator.operatorName,
              runtimeMs: operator.runtimeMs,
              workedTimeMs: operator.workedTimeMs
            });

            // Validate operator data before adding to results
            if (!operator.operatorId) {
              logger.warn(`Skipping operator with undefined ID:`, {
                operatorName: operator.operatorName,
                operatorId: operator.operatorId,
                runtimeMs: operator.runtimeMs
              });
              return; // Skip this operator
            }

            operatorIdToName.set(operator.operatorId, operator.operatorName);

            // Calculate performance metrics (same logic as original route)
            const totalHours = operator.workedTimeMs / 3600000;
            const windowMs = exactEnd.getTime() - exactStart.getTime();
            
            // Basic KPIs
            const pph = totalHours > 0 ? operator.totalCounts / totalHours : 0;
            const availability = windowMs > 0 ? operator.runtimeMs / windowMs : 0;
            const throughput = (operator.totalCounts + operator.totalMisfeeds) > 0 ? 
              operator.totalCounts / (operator.totalCounts + operator.totalMisfeeds) : 0;
            
            // For efficiency calculation, we need item standards - using a simplified approach
            // Since daily totals don't store item-level data, we'll use a placeholder
            // In a full implementation, you'd need to join with item master data or process item totals
            const proratedStandard = 0; // Placeholder - would need item data
            const efficiency = 0; // Placeholder - requires item-level data

            results.push({
              operator: {
                id: operator.operatorId,
                name: operator.operatorName
              },
              sessions: [], // Empty for optimized version - could be populated with daily summaries
              operatorSummary: {
                totalCount: operator.totalCounts,
                workedTimeMs: operator.workedTimeMs,
                workedTimeFormatted: formatMs(operator.workedTimeMs),
                runtimeMs: operator.runtimeMs,
                runtimeFormatted: formatMs(operator.runtimeMs),
                pph: Math.round(pph * 100) / 100,
                proratedStandard: Math.round(proratedStandard * 100) / 100,
                efficiency: Math.round(efficiency * 10000) / 100,
                itemSummaries: {}, // Empty for optimized version - would need item-level data
                machinesWorked: Array.from(operator.machines).length // Additional metric
              }
            });

            // Prepare data for charts
            const runningHours = operator.runtimeMs / 3600000;
            const pausedHours = Math.max(0, (windowMs - operator.runtimeMs) / 3600000);

            statusByOperator.set(operator.operatorId, {
              "Working": runningHours,
              "Idle": pausedHours
            });

            // Simplified fault data (operators don't have separate fault tracking in daily totals)
            faultsByOperator.set(operator.operatorId, {
              "No Faults": 0 // Operators don't track separate faults in daily totals
            });
          } catch (operatorError) {
            logger.error(`Error processing operator ${key}:`, operatorError);
            throw operatorError;
          }
        }

        // Build efficiency ranking
        const efficiencyRanked = results
          .map(r => ({
            operatorId: r.operator.id,
            name: r.operator.name,
            efficiency: Number(r.operatorSummary?.efficiency || 0),
          }))
          .sort((a, b) => b.efficiency - a.efficiency);

        // Build chart series - filter out any undefined operator IDs
        const finalOrderOperators = results
          .map(r => r.operator.id)
          .filter(id => id !== undefined && id !== null);
        
        logger.info(`Building charts for ${finalOrderOperators.length} operators (filtered from ${results.length} results)`);
        
        // Status stacked chart
        const statusStacked = toStackedSeries(statusByOperator, operatorIdToName, finalOrderOperators, "status");
        
        // Faults stacked chart
        const faultsStacked = toStackedSeries(faultsByOperator, operatorIdToName, finalOrderOperators, "faults");

        // Efficiency ranked chart
        const efficiencyRankedSeries = [{
          id: "OEE",
          title: "OEE",
          type: "bar",
          data: efficiencyRanked.map(r => ({
            x: operatorIdToName.get(r.operatorId) || r.name,
            y: r.efficiency
          }))
        }];

        // Final response (same format as original route)
        res.json({
          timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
          results,
          charts: {
            statusStacked: {
              title: "Operator Status Stacked Bar",
              orientation: "vertical",
              xType: "category",
              xLabel: "Operator",
              yLabel: "Duration (hours)",
              series: statusStacked
            },
            efficiencyRanked: {
              title: "Ranked OEE% by Operator",
              orientation: "horizontal",
              xType: "category",
              xLabel: "Operator",
              yLabel: "OEE (%)",
              series: efficiencyRankedSeries
            },
            itemsStacked: {
              title: "Item Stacked Bar by Operator",
              orientation: "vertical",
              xType: "category",
              xLabel: "Operator",
              yLabel: "Item Count",
              series: [] // Empty for optimized version - would need item-level data
            },
            faultsStacked: {
              title: "Fault Stacked Bar by Operator",
              orientation: "vertical",
              xType: "category",
              xLabel: "Operator",
              yLabel: "Fault Duration (hours)",
              series: faultsStacked
            },
            order: finalOrderOperators.map(id => operatorIdToName.get(id) || id.toString())
          },
          optimization: {
            used: true,
            timeframe: req.query.timeframe,
            dataSource: 'operator-daily-totals-cache',
            performance: {
              operatorTotalsCount: operatorTotals.length,
              aggregatedOperators: results.length,
              processingTime: '< 100ms estimated'
            },
            limitations: {
              itemSummaries: 'Not available in operator daily totals - would need item-level processing',
              efficiency: 'Requires item standards data not available in daily totals'
            }
          }
        });

      } catch (processingError) {
        logger.error(`Error in operator data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process operator daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      logger.error(`Error in optimized operator item summary:`, error);
      
      // Log the error and return a proper error response
      logger.warn('Error accessing totals-daily collection:', error.message);
      
      res.status(500).json({ 
        error: "Failed to generate optimized operator item summary",
        message: error.message 
      });
    }
  });

  // New experimental route that uses daily totals for item reports
  router.get("/analytics/item-sessions-summary-optimized", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      // Check if this is a timeframe that can use daily totals optimization
      const isOptimizedTimeframe = req.query.timeframe && 
        ['today', 'thisWeek', 'thisMonth', 'thisYear'].includes(req.query.timeframe);

      if (!isOptimizedTimeframe) {
        // Fallback to original route for non-optimized timeframes
        return res.status(400).json({
          error: 'This optimized route only supports timeframes: today, thisWeek, thisMonth, thisYear'
        });
      }

      logger.info(`Using daily totals optimization for item route, timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        logger.error('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      
      logger.info('Querying totals-daily for item data:', { startDate, endDate });

      // Query the totals-daily collection for item records
      const dailyTotalsCollection = db.collection("totals-daily");
      
      // Build query for item records in date range
      const query = {
        entityType: 'item',
        date: {
          $gte: startDate,
          $lte: endDate
        }
      };
      
      // Get item daily totals data
      let itemTotals;
      try {
        itemTotals = await dailyTotalsCollection.find(query).toArray();
        logger.info(`Found ${itemTotals.length} item daily total records`);
      } catch (dbError) {
        logger.error('Database query error:', dbError);
        return res.status(500).json({ 
          error: 'Database query failed',
          message: dbError.message 
        });
      }
      
      if (!itemTotals || itemTotals.length === 0) {
        return res.json([]);
      }

      // Helper function to normalize PPH standards (same as original route)
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
      };

      // Helper function to format duration (same as original route)
      const formatDuration = (ms) => {
        if (!ms || typeof ms !== 'number') return { hours: 0, minutes: 0 };
        const totalMinutes = Math.floor(ms / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return { hours, minutes };
      };

      try {
        // Aggregate item totals by item ID
        const aggregated = new Map();
      
        logger.info(`Processing ${itemTotals.length} item daily total records`);
        
        itemTotals.forEach((total, index) => {
          try {
            logger.debug(`Processing item record ${index + 1}/${itemTotals.length}:`, {
              itemId: total.itemId,
              itemName: total.itemName,
              date: total.date,
              totalCounts: total.totalCounts,
              workedTimeMs: total.workedTimeMs
            });

            // Validate that we have required fields
            if (!total.itemId) {
              logger.warn(`Record ${index + 1} missing itemId:`, {
                _id: total._id,
                date: total.date,
                itemName: total.itemName,
                availableFields: Object.keys(total)
              });
              return; // Skip this record
            }

            const key = total.itemId;
            if (!aggregated.has(key)) {
              aggregated.set(key, {
                itemId: total.itemId,
                itemName: total.itemName || `Item ${total.itemId}`,
                totalCounts: 0,
                totalMisfeeds: 0,
                workedTimeMs: 0,
                runtimeMs: 0,
                pausedTimeMs: 0,
                totalTimeCreditMs: 0,
                operatorMachineCombinations: 0,
                days: [],
                dateRange: { start: total.date, end: total.date }
              });
            }
            
            const item = aggregated.get(key);
            
            // Sum all metrics with safe defaults
            item.totalCounts += (total.totalCounts || 0);
            item.totalMisfeeds += (total.totalMisfeeds || 0);
            item.workedTimeMs += (total.workedTimeMs || 0);
            item.runtimeMs += (total.runtimeMs || 0);
            item.pausedTimeMs += (total.pausedTimeMs || 0);
            item.totalTimeCreditMs += (total.totalTimeCreditMs || 0);
            item.operatorMachineCombinations = Math.max(item.operatorMachineCombinations, total.operatorMachineCombinations || 0);
            item.days.push(total);
            
            // Update date range with safe comparison
            if (total.date && item.dateRange.start && total.date < item.dateRange.start) {
              item.dateRange.start = total.date;
            }
            if (total.date && item.dateRange.end && total.date > item.dateRange.end) {
              item.dateRange.end = total.date;
            }

            // Keep the most recent item name if available
            if (total.itemName && total.itemName !== `Item ${total.itemId}`) {
              item.itemName = total.itemName;
            }
          } catch (itemError) {
            logger.error(`Error processing item record ${index + 1}:`, {
              error: itemError.message,
              record: total
            });
            throw itemError;
          }
        });

        // Convert to results format matching the original route
        const results = [];

        logger.info(`Aggregated ${aggregated.size} items, processing results...`);

        for (const [key, item] of aggregated) {
          try {
            logger.debug(`Processing item ${key}:`, {
              itemId: item.itemId,
              itemName: item.itemName,
              totalCounts: item.totalCounts,
              workedTimeMs: item.workedTimeMs
            });

            // Calculate performance metrics (same logic as original route)
            const workedMs = Math.round(item.workedTimeMs);
            const hours = workedMs / 3_600_000;
            const pph = hours > 0 ? item.totalCounts / hours : 0;
            
            // For efficiency calculation, we need the item standard
            // Since daily totals don't store standards, we'll use a placeholder
            // In a full implementation, you'd need to join with item master data
            const standard = 0; // Placeholder - would need item master data
            const stdPPH = normalizePPH(standard);
            const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

            // Validate item data before adding to results
            if (!item.itemId) {
              logger.warn(`Skipping item with undefined ID:`, {
                itemName: item.itemName,
                itemId: item.itemId,
                totalCounts: item.totalCounts
              });
              return; // Skip this item
            }

            results.push({
              itemName: item.itemName,
              workedTimeFormatted: formatDuration(workedMs),
              count: item.totalCounts,
              pph: Math.round(pph * 100) / 100,
              standard: standard,
              efficiency: Math.round(efficiencyPct * 100) / 100, // percent
              // Additional metrics available from daily totals
              runtimeMs: item.runtimeMs,
              pausedTimeMs: item.pausedTimeMs,
              totalMisfeeds: item.totalMisfeeds,
              operatorMachineCombinations: item.operatorMachineCombinations,
              daysProcessed: item.days.length
            });
          } catch (itemError) {
            logger.error(`Error processing item ${key}:`, itemError);
            throw itemError;
          }
        }

        // Sort results by count descending (most productive items first)
        results.sort((a, b) => b.count - a.count);

        // Final response (same format as original route)
        res.json(results);

      } catch (processingError) {
        logger.error(`Error in item data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process item daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      logger.error(`Error in optimized item summary:`, error);
      
      // Log the error and return a proper error response
      logger.warn('Error accessing totals-daily collection:', error.message);
      
      res.status(500).json({ 
        error: "Failed to generate optimized item summary",
        message: error.message 
      });
    }
  });

  return router;
};




