const express = require("express");
const config = require("../../modules/config");
const { parseAndValidateQueryParams, formatDuration, SYSTEM_TIMEZONE } = require("../../utils/time");
const { getBookendedStatesAndTimeRange } = require("../../utils/bookendingBuilder");
const { DateTime } = require("luxon");

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
  //     console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
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
        // Skip machines with no production data
        if (b.totalCount === 0) {
          continue;
        }

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
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
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
//       console.log(`Error in ${req.method} ${req.originalUrl}:`, err);
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
    const canonicalName = (name, id) => {
      if (!name) return `Operator ${id}`;
      // Handle object format { first, surname }
      if (typeof name === 'object' && name !== null) {
        const fullName = `${name.first || ''} ${name.surname || ''}`.trim();
        return fullName || `Operator ${id}`;
      }
      // Handle string format
      if (typeof name === 'string') {
        return name.trim() || `Operator ${id}`;
      }
      return `Operator ${id}`;
    };

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
      // Skip operators with no production data
      if (b.totalCount === 0) {
        continue;
      }

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
    console.log(`Error in ${req.method} ${req.originalUrl}:`, err);
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
    console.log(`Error in ${req.method} ${req.originalUrl}:`, err);
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

      console.log(`Using daily totals optimization for timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        console.log('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      

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
      } catch (dbError) {
        console.log('Database query error:', dbError);
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

      console.log(`Processing ${dailyTotals.length} machine daily total records`);

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
            console.log(`Record ${index + 1} missing machineSerial:`, {
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
          console.log(`Error processing record ${index + 1}:`, {
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

      console.log(`Aggregated ${aggregated.size} machines, processing results...`);

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
          console.log(`Skipping machine with undefined serial:`, {
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
          console.log(`Error processing machine ${key}:`, machineError);
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
      
      console.log(`Building charts for ${finalOrderSerials.length} machines (filtered from ${results.length} results)`);
      
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
          console.log(`Error building status chart for machine ${serial}:`, chartError);
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
          console.log(`Error building faults chart for machine ${serial}:`, chartError);
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
        console.log(`Error in data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      console.log(`Error in optimized machine item summary:`, error);
      
      // Log the error and return a proper error response
      console.log('Error accessing totals-daily collection:', error.message);
      
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

      console.log(`Using daily totals optimization for operator route, timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        console.log('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      

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
      } catch (dbError) {
        console.log('Database query error:', dbError);
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
      const canonicalName = (name, id) => {
        if (!name) return `Operator ${id}`;
        // Handle object format { first, surname }
        if (typeof name === 'object' && name !== null) {
          const fullName = `${name.first || ''} ${name.surname || ''}`.trim();
          return fullName || `Operator ${id}`;
        }
        // Handle string format
        if (typeof name === 'string') {
          return name.trim() || `Operator ${id}`;
        }
        return `Operator ${id}`;
      };

      try {
        // Aggregate operator totals by operator ID
        const aggregated = new Map();
      
        console.log(`Processing ${operatorTotals.length} operator daily total records`);
        
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
              console.log(`Record ${index + 1} missing or invalid operatorId:`, {
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
            console.log(`Error processing operator record ${index + 1}:`, {
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

        console.log(`Aggregated ${aggregated.size} operators, processing results...`);

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
              console.log(`Skipping operator with undefined ID:`, {
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
            console.log(`Error processing operator ${key}:`, operatorError);
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
        
        console.log(`Building charts for ${finalOrderOperators.length} operators (filtered from ${results.length} results)`);
        
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
        console.log(`Error in operator data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process operator daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      console.log(`Error in optimized operator item summary:`, error);
      
      // Log the error and return a proper error response
      console.log('Error accessing totals-daily collection:', error.message);
      
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

      console.log(`Using daily totals optimization for item route, timeframe: ${req.query.timeframe}`);

      // Validate dates before processing
      if (!exactStart || !exactEnd) {
        console.log('Invalid date range:', { exactStart, exactEnd });
        return res.status(400).json({ error: 'Invalid date range' });
      }

      // Calculate date range for daily totals query
      const startDate = exactStart.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDate = exactEnd.toISOString().split('T')[0];     // YYYY-MM-DD
      

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
      } catch (dbError) {
        console.log('Database query error:', dbError);
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
      
        console.log(`Processing ${itemTotals.length} item daily total records`);
        
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
              console.log(`Record ${index + 1} missing itemId:`, {
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
            console.log(`Error processing item record ${index + 1}:`, {
              error: itemError.message,
              record: total
            });
            throw itemError;
          }
        });

        // Convert to results format matching the original route
        const results = [];

        console.log(`Aggregated ${aggregated.size} items, processing results...`);

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
              console.log(`Skipping item with undefined ID:`, {
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
            console.log(`Error processing item ${key}:`, itemError);
            throw itemError;
          }
        }

        // Sort results by count descending (most productive items first)
        results.sort((a, b) => b.count - a.count);

        // Final response (same format as original route)
        res.json(results);

      } catch (processingError) {
        console.log(`Error in item data processing:`, processingError);
        return res.status(500).json({ 
          error: "Failed to process item daily totals data",
          message: processingError.message,
          stack: processingError.stack
        });
      }

    } catch (error) {
      console.log(`Error in optimized item summary:`, error);
      
      // Log the error and return a proper error response
      console.log('Error accessing totals-daily collection:', error.message);
      
      res.status(500).json({ 
        error: "Failed to generate optimized item summary",
        message: error.message 
      });
    }
  });

  // Hybrid machine report route - combines daily cache for complete days + sessions for partial days
  router.get("/analytics/machine-item-sessions-summary-hybrid", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      
      // Configurable threshold for hybrid approach (36 hours)
      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // If time range is less than threshold, use original route
      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        // Redirect to original route for shorter time ranges
        return res.status(400).json({
          error: `Time range must be greater than ${HYBRID_THRESHOLD_HOURS} hours for hybrid approach`,
          suggestion: 'Use /analytics/machine-item-sessions-summary for shorter time ranges'
        });
      }

      console.log(`Using hybrid approach for time range: ${timeRangeHours.toFixed(1)} hours`);

      // Helper function to split time range into complete days and partial days
      function splitTimeRange(start, end) {
        const completeDays = [];
        const partialDays = [];
        
        // Get timezone-aware start and end of days
        const startOfFirstDay = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf('day');
        const endOfLastDay = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf('day');
        
        // Check if first day is complete
        const firstDayStart = startOfFirstDay.toJSDate();
        const firstDayEnd = startOfFirstDay.endOf('day').toJSDate();
        
        if (start.getTime() <= firstDayStart.getTime() + 1000) { // Within 1 second of day start
          completeDays.push({
            date: startOfFirstDay.toISODate(),
            start: firstDayStart,
            end: firstDayEnd
          });
        } else {
          partialDays.push({
            start: start,
            end: firstDayEnd
          });
        }
        
        // Add all complete days in between
        let currentDay = startOfFirstDay.plus({ days: 1 });
        while (currentDay < endOfLastDay.startOf('day')) {
          completeDays.push({
            date: currentDay.toISODate(),
            start: currentDay.startOf('day').toJSDate(),
            end: currentDay.endOf('day').toJSDate()
          });
          currentDay = currentDay.plus({ days: 1 });
        }
        
        // Check if last day is complete
        const lastDayStart = endOfLastDay.startOf('day').toJSDate();
        const lastDayEnd = endOfLastDay.toJSDate();
        
        if (end.getTime() >= lastDayEnd.getTime() - 1000) { // Within 1 second of day end
          completeDays.push({
            date: endOfLastDay.toISODate(),
            start: lastDayStart,
            end: lastDayEnd
          });
        } else {
          partialDays.push({
            start: lastDayStart,
            end: end
          });
        }
        
        return { completeDays, partialDays };
      }

      // Helper function to query daily cache for complete days
      async function queryDailyCache(completeDays, machineSerial) {
        if (completeDays.length === 0) return [];
        
        const dates = completeDays.map(day => day.date);
        const query = {
          entityType: 'machine',
          date: { $in: dates }
        };
        
        if (machineSerial) {
          query.machineSerial = parseInt(machineSerial);
        }
        
        
        const dailyRecords = await db.collection('totals-daily').find(query).toArray();
        
        return dailyRecords;
      }

      // Helper function to query sessions for partial days
      async function querySessions(partialDays, machineSerial) {
        if (partialDays.length === 0) return [];
        
        
        const allSessions = [];
        
        for (const partialDay of partialDays) {
          const match = {
            ...(machineSerial ? { "machine.serial": parseInt(machineSerial) } : {}),
            "timestamps.start": { $lte: partialDay.end },
            $or: [
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": { $gte: partialDay.start } },
            ],
          };
          
          const sessions = await db
            .collection(config.machineSessionCollectionName)
            .aggregate([
              { $match: match },
              {
                $addFields: {
                  ovStart: { $max: ["$timestamps.start", partialDay.start] },
                  ovEnd: { $min: [{ $ifNull: ["$timestamps.end", partialDay.end] }, partialDay.end] },
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
                              { $gte: ["$$c.timestamp", partialDay.start] },
                              { $lte: ["$$c.timestamp", partialDay.end] },
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
          
          allSessions.push(...sessions);
        }
        
        return allSessions;
      }

      // Helper function to combine daily cache and session data
      function combineMachineData(dailyRecords, sessionData) {
        const machineMap = new Map();
        
        // Process daily cache records
        for (const record of dailyRecords) {
          const key = record.machineSerial;
          if (!machineMap.has(key)) {
            machineMap.set(key, {
              machine: { 
                name: record.machineName || "Unknown", 
                serial: record.machineSerial 
              },
              sessions: [],
              itemAgg: new Map(),
              totalCount: 0,
              totalWorkedMs: 0,
              totalRuntimeMs: 0,
              totalFaults: 0,
              totalMisfeeds: 0,
              totalFaultTimeMs: 0,
              totalPausedTimeMs: 0,
              dailyRecords: []
            });
          }
          
          const machine = machineMap.get(key);
          machine.dailyRecords.push(record);
          
          // Add daily totals
          machine.totalCount += record.totalCounts || 0;
          machine.totalWorkedMs += record.workedTimeMs || 0;
          machine.totalRuntimeMs += record.runtimeMs || 0;
          machine.totalFaults += record.totalFaults || 0;
          machine.totalMisfeeds += record.totalMisfeeds || 0;
          machine.totalFaultTimeMs += record.faultTimeMs || 0;
          machine.totalPausedTimeMs += record.pausedTimeMs || 0;
        }
        
        // Process session data for partial days
        for (const session of sessionData) {
          const key = session.machine?.serial;
          if (!key) continue;
          
          if (!machineMap.has(key)) {
            machineMap.set(key, {
              machine: { 
                name: session.machine?.name || "Unknown", 
                serial: key 
              },
              sessions: [],
              itemAgg: new Map(),
              totalCount: 0,
              totalWorkedMs: 0,
              totalRuntimeMs: 0,
              totalFaults: 0,
              totalMisfeeds: 0,
              totalFaultTimeMs: 0,
              totalPausedTimeMs: 0,
              dailyRecords: []
            });
          }
          
          const machine = machineMap.get(key);
          
          if (!session.sliceMs || session.sliceMs <= 0) continue;
          
          const activeStations = Array.isArray(session.operators)
            ? session.operators.filter((op) => op && op.id !== -1).length
            : 0;
          
          const workedTimeMs = Math.max(0, session.sliceMs * activeStations);
          const runtimeMs = Math.max(0, session.sliceMs);
          
          // Add to sessions array
          machine.sessions.push({
            start: new Date(session.ovStart).toISOString(),
            end: new Date(session.ovEnd).toISOString(),
            workedTimeMs,
            workedTimeFormatted: formatDuration(workedTimeMs),
            runtimeMs,
            runtimeFormatted: formatDuration(runtimeMs),
          });
          
          // Add to totals
          machine.totalWorkedMs += workedTimeMs;
          machine.totalRuntimeMs += runtimeMs;
          
          // Process item counts
          const counts = Array.isArray(session.countsFiltered) ? session.countsFiltered : [];
          if (counts.length > 0) {
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
              
              const rec = machine.itemAgg.get(itm.id) || {
                name: itm.name,
                standard: itm.standard,
                count: 0,
                workedTimeMs: 0,
              };
              rec.count += itm.count;
              rec.workedTimeMs += workedShare;
              machine.itemAgg.set(itm.id, rec);
              
              machine.totalCount += itm.count;
            }
          }
        }
        
        return Array.from(machineMap.values());
      }

      // Split time range
      const { completeDays, partialDays } = splitTimeRange(exactStart, exactEnd);
      
      console.log(`Time range split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
      
      // Query both data sources
      const [dailyRecords, sessionData] = await Promise.all([
        queryDailyCache(completeDays, serial),
        querySessions(partialDays, serial)
      ]);
      
      // Combine the data
      const combinedData = combineMachineData(dailyRecords, sessionData);
      
      if (combinedData.length === 0) {
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
            approach: 'hybrid',
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length
          }
        });
      }
      
      // Process results similar to original route
      const results = [];
      const serialToName = new Map();
      
      for (const machine of combinedData) {
        serialToName.set(machine.machine.serial, machine.machine.name);
        
        let proratedStandard = 0;
        const itemSummaries = {};
        
        for (const [itemId, s] of machine.itemAgg.entries()) {
          const hours = s.workedTimeMs / 3600000;
          const pph = hours > 0 ? s.count / hours : 0;
          const eff = s.standard > 0 ? pph / s.standard : 0;
          const weight = machine.totalCount > 0 ? s.count / machine.totalCount : 0;
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
        
        // Calculate machine-level metrics
        const hours = machine.totalWorkedMs / 3600000;
        const machinePph = hours > 0 ? machine.totalCount / hours : 0;
        const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;
        
        results.push({
          machine: machine.machine,
          sessions: machine.sessions,
          machineSummary: {
            totalCount: machine.totalCount,
            workedTimeMs: machine.totalWorkedMs,
            workedTimeFormatted: formatDuration(machine.totalWorkedMs),
            runtimeMs: machine.totalRuntimeMs,
            runtimeFormatted: formatDuration(machine.totalRuntimeMs),
            pph: Math.round(machinePph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(machineEff * 10000) / 100,
            itemSummaries,
          },
        });
      }
      
      // Generate chart data (simplified for now - could be enhanced)
      const efficiencyRanked = results
        .map(r => ({
          serial: r.machine.serial,
          name: r.machine.name,
          efficiency: Number(r.machineSummary?.efficiency || 0),
        }))
        .sort((a, b) => b.efficiency - a.efficiency);
      
      const finalOrderSerials = results.map(r => r.machine.serial);
      
      // Build status data for charts
      const statusByMachine = new Map();
      for (const machine of combinedData) {
        const runningHours = machine.totalRuntimeMs / 3600000;
        const faultedHours = machine.totalFaultTimeMs / 3600000;
        const downtimeHours = machine.totalPausedTimeMs / 3600000;
        
        statusByMachine.set(machine.machine.serial, {
          "Running": runningHours,
          "Faulted": faultedHours,
          "Paused": downtimeHours
        });
      }
      
      // Build items data for charts
      const itemsByMachine = new Map();
      for (const r of results) {
        const m = {};
        for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
          const label = s.name || String(id);
          const count = Number(s.countTotal || 0);
          m[label] = (m[label] || 0) + count;
        }
        itemsByMachine.set(r.machine.serial, m);
      }
      
      // Build faults data for charts
      const faultsByMachine = new Map();
      for (const machine of combinedData) {
        if (machine.totalFaults > 0) {
          faultsByMachine.set(machine.machine.serial, {
            "Faults": machine.totalFaultTimeMs / 3600000
          });
        } else {
          faultsByMachine.set(machine.machine.serial, {
            "No Faults": 0
          });
        }
      }
      
      // Generate chart series (simplified)
      const statusStacked = finalOrderSerials.map(serial => ({
        id: String(serial),
        title: serialToName.get(serial) || String(serial),
        type: "bar",
        stack: "status",
        data: Object.entries(statusByMachine.get(serial) || {}).map(([status, hours]) => ({
          x: status,
          y: Math.round((hours || 0) * 100) / 100
        }))
      }));
      
      const itemsStacked = finalOrderSerials.map(serial => ({
        id: String(serial),
        title: serialToName.get(serial) || String(serial),
        type: "bar",
        stack: "items",
        data: Object.entries(itemsByMachine.get(serial) || {}).map(([item, count]) => ({
          x: item,
          y: count || 0
        }))
      }));
      
      const faultsStacked = finalOrderSerials.map(serial => ({
        id: String(serial),
        title: serialToName.get(serial) || String(serial),
        type: "bar",
        stack: "faults",
        data: Object.entries(faultsByMachine.get(serial) || {}).map(([faultType, hours]) => ({
          x: faultType,
          y: Math.round((hours || 0) * 100) / 100
        }))
      }));
      
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
          order: finalOrderSerials.map(s => serialToName.get(s) || s)
        },
        optimization: {
          used: true,
          approach: 'hybrid',
          thresholdHours: HYBRID_THRESHOLD_HOURS,
          timeRangeHours: Math.round(timeRangeHours * 100) / 100,
          completeDays: completeDays.length,
          partialDays: partialDays.length,
          dailyRecords: dailyRecords.length,
          sessionRecords: sessionData.length,
          performance: {
            estimatedSpeedup: `${Math.round((timeRangeHours / 24) * 10)}x faster for ${Math.round(timeRangeHours / 24)} days`
          }
        }
      });
      
    } catch (error) {
      console.log(`Error in hybrid machine item summary:`, error);
      res.status(500).json({ 
        error: "Failed to generate hybrid machine item summary",
        message: error.message 
      });
    }
  });

  // Hybrid operator report route - combines daily cache for complete days + sessions for partial days
  router.get("/analytics/operator-item-sessions-summary-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
      
      // Configurable threshold for hybrid approach (36 hours)
      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // If time range is less than threshold, use original route
      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        // Redirect to original route for shorter time ranges
        return res.status(400).json({
          error: `Time range must be greater than ${HYBRID_THRESHOLD_HOURS} hours for hybrid approach`,
          suggestion: 'Use /analytics/operator-item-sessions-summary for shorter time ranges'
        });
      }

      console.log(`Using hybrid approach for operator route, time range: ${timeRangeHours.toFixed(1)} hours`);

      // Helper function to split time range into complete days and partial days
      function splitTimeRange(start, end) {
        const completeDays = [];
        const partialDays = [];
        
        // Get timezone-aware start and end of days
        const startOfFirstDay = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf('day');
        const endOfLastDay = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf('day');
        
        // Check if first day is complete
        const firstDayStart = startOfFirstDay.toJSDate();
        const firstDayEnd = startOfFirstDay.endOf('day').toJSDate();
        
        if (start.getTime() <= firstDayStart.getTime() + 1000) { // Within 1 second of day start
          completeDays.push({
            date: startOfFirstDay.toISODate(),
            start: firstDayStart,
            end: firstDayEnd
          });
        } else {
          partialDays.push({
            start: start,
            end: firstDayEnd
          });
        }
        
        // Add all complete days in between
        let currentDay = startOfFirstDay.plus({ days: 1 });
        while (currentDay < endOfLastDay.startOf('day')) {
          completeDays.push({
            date: currentDay.toISODate(),
            start: currentDay.startOf('day').toJSDate(),
            end: currentDay.endOf('day').toJSDate()
          });
          currentDay = currentDay.plus({ days: 1 });
        }
        
        // Check if last day is complete
        const lastDayStart = endOfLastDay.startOf('day').toJSDate();
        const lastDayEnd = endOfLastDay.toJSDate();
        
        if (end.getTime() >= lastDayEnd.getTime() - 1000) { // Within 1 second of day end
          completeDays.push({
            date: endOfLastDay.toISODate(),
            start: lastDayStart,
            end: lastDayEnd
          });
        } else {
          partialDays.push({
            start: lastDayStart,
            end: end
          });
        }
        
        return { completeDays, partialDays };
      }

      // Helper function to query daily cache for complete days
      async function queryDailyCache(completeDays, operatorId) {
        if (completeDays.length === 0) return [];
        
        const dates = completeDays.map(day => day.date);
        const query = {
          entityType: 'operator-machine',
          date: { $in: dates }
        };
        
        if (operatorId) {
          query.operatorId = parseInt(operatorId);
        }
        
        
        const dailyRecords = await db.collection('totals-daily').find(query).toArray();
        
        return dailyRecords;
      }

      // Helper function to query sessions for partial days
      async function querySessions(partialDays, operatorId) {
        if (partialDays.length === 0) return [];
        
        
        const allSessions = [];
        
        for (const partialDay of partialDays) {
          const match = {
            ...(operatorId ? { "operator.id": parseInt(operatorId) } : {}),
            "timestamps.start": { $lte: partialDay.end },
            $or: [
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": { $gte: partialDay.start } },
            ],
          };
          
          const sessions = await db
            .collection(config.operatorSessionCollectionName)
            .aggregate([
              { $match: match },
              {
                $addFields: {
                  ovStart: { $max: ["$timestamps.start", partialDay.start] },
                  ovEnd: { $min: [{ $ifNull: ["$timestamps.end", partialDay.end] }, partialDay.end] },
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
                              { $gte: ["$$c.timestamp", partialDay.start] },
                              { $lte: ["$$c.timestamp", partialDay.end] },
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
          
          allSessions.push(...sessions);
        }
        
        return allSessions;
      }

      // Helper function to combine daily cache and session data
      function combineOperatorData(dailyRecords, sessionData) {
        const operatorMap = new Map();
        
        // Process daily cache records
        for (const record of dailyRecords) {
          const key = record.operatorId;
          if (!operatorMap.has(key)) {
            operatorMap.set(key, {
              operator: { 
                id: record.operatorId, 
                name: record.operatorName 
              },
              sessions: [],
              itemAgg: new Map(),
              totalCount: 0,
              totalWorkedMs: 0,
              totalRuntimeMs: 0,
              totalFaults: 0,
              totalMisfeeds: 0,
              totalFaultTimeMs: 0,
              totalPausedTimeMs: 0,
              dailyRecords: []
            });
          }
          
          const operator = operatorMap.get(key);
          operator.dailyRecords.push(record);
          
          // Add daily totals
          operator.totalCount += record.totalCounts || 0;
          operator.totalWorkedMs += record.workedTimeMs || 0;
          operator.totalRuntimeMs += record.runtimeMs || 0;
          operator.totalFaults += record.totalFaults || 0;
          operator.totalMisfeeds += record.totalMisfeeds || 0;
          operator.totalFaultTimeMs += record.faultTimeMs || 0;
          operator.totalPausedTimeMs += record.pausedTimeMs || 0;
        }
        
        // Process session data for partial days
        for (const session of sessionData) {
          const key = session.operator?.id;
          if (!key) continue;
          
          if (!operatorMap.has(key)) {
            operatorMap.set(key, {
              operator: { 
                id: key, 
                name: session.operator?.name || "Unknown" 
              },
              sessions: [],
              itemAgg: new Map(),
              totalCount: 0,
              totalWorkedMs: 0,
              totalRuntimeMs: 0,
              totalFaults: 0,
              totalMisfeeds: 0,
              totalFaultTimeMs: 0,
              totalPausedTimeMs: 0,
              dailyRecords: []
            });
          }
          
          const operator = operatorMap.get(key);
          
          if (!session.sliceMs || session.sliceMs <= 0) continue;
          
          const workedTimeMs = Math.max(0, session.sliceMs);
          const runtimeMs = Math.max(0, session.sliceMs);
          
          // Add to sessions array
          operator.sessions.push({
            start: new Date(session.ovStart).toISOString(),
            end: new Date(session.ovEnd).toISOString(),
            workedTimeMs,
            workedTimeFormatted: formatDuration(workedTimeMs),
            runtimeMs,
            runtimeFormatted: formatDuration(runtimeMs),
          });
          
          // Add to totals
          operator.totalWorkedMs += workedTimeMs;
          operator.totalRuntimeMs += runtimeMs;
          
          // Process item counts
          const counts = Array.isArray(session.countsFiltered) ? session.countsFiltered : [];
          if (counts.length > 0) {
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
              
              const rec = operator.itemAgg.get(itm.id) || {
                name: itm.name,
                standard: itm.standard,
                count: 0,
                workedTimeMs: 0,
              };
              rec.count += itm.count;
              rec.workedTimeMs += workedShare;
              operator.itemAgg.set(itm.id, rec);
              
              operator.totalCount += itm.count;
            }
          }
        }
        
        return Array.from(operatorMap.values());
      }

      // Split time range
      const { completeDays, partialDays } = splitTimeRange(exactStart, exactEnd);
      
      console.log(`Time range split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
      
      // Query both data sources
      const [dailyRecords, sessionData] = await Promise.all([
        queryDailyCache(completeDays, operatorId),
        querySessions(partialDays, operatorId)
      ]);
      
      // Combine the data
      const combinedData = combineOperatorData(dailyRecords, sessionData);
      
      if (combinedData.length === 0) {
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
            approach: 'hybrid',
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length
          }
        });
      }
      
      // Process results similar to original route
      const results = [];
      const operatorIdToName = new Map();
      
      for (const operator of combinedData) {
        operatorIdToName.set(operator.operator.id, operator.operator.name);
        
        let proratedStandard = 0;
        const itemSummaries = {};
        
        for (const [itemId, s] of operator.itemAgg.entries()) {
          const hours = s.workedTimeMs / 3600000;
          const pph = hours > 0 ? s.count / hours : 0;
          const eff = s.standard > 0 ? pph / s.standard : 0;
          const weight = operator.totalCount > 0 ? s.count / operator.totalCount : 0;
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
        
        // Calculate operator-level metrics
        const hours = operator.totalWorkedMs / 3600000;
        const operatorPph = hours > 0 ? operator.totalCount / hours : 0;
        const operatorEff = proratedStandard > 0 ? operatorPph / proratedStandard : 0;
        
        results.push({
          operator: operator.operator,
          sessions: operator.sessions,
          operatorSummary: {
            totalCount: operator.totalCount,
            workedTimeMs: operator.totalWorkedMs,
            workedTimeFormatted: formatDuration(operator.totalWorkedMs),
            runtimeMs: operator.totalRuntimeMs,
            runtimeFormatted: formatDuration(operator.totalRuntimeMs),
            pph: Math.round(operatorPph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(operatorEff * 10000) / 100,
            itemSummaries,
          },
        });
      }
      
      // Generate chart data (simplified for now - could be enhanced)
      const efficiencyRanked = results
        .map(r => ({
          operatorId: r.operator.id,
          name: r.operator.name,
          efficiency: Number(r.operatorSummary?.efficiency || 0),
        }))
        .sort((a, b) => b.efficiency - a.efficiency);
      
      const finalOrderOperators = results.map(r => r.operator.id);
      
      // Build status data for charts
      const statusByOperator = new Map();
      for (const operator of combinedData) {
        const workingHours = operator.totalRuntimeMs / 3600000;
        const faultedHours = operator.totalFaultTimeMs / 3600000;
        const idleHours = operator.totalPausedTimeMs / 3600000;
        
        statusByOperator.set(operator.operator.id, {
          "Working": workingHours,
          "Faulted": faultedHours,
          "Idle": idleHours
        });
      }
      
      // Build items data for charts
      const itemsByOperator = new Map();
      for (const r of results) {
        const m = {};
        for (const [id, s] of Object.entries(r.operatorSummary.itemSummaries || {})) {
          const label = s.name || String(id);
          const count = Number(s.countTotal || 0);
          m[label] = (m[label] || 0) + count;
        }
        itemsByOperator.set(r.operator.id, m);
      }
      
      // Build faults data for charts
      const faultsByOperator = new Map();
      for (const operator of combinedData) {
        if (operator.totalFaults > 0) {
          faultsByOperator.set(operator.operator.id, {
            "Faults": operator.totalFaultTimeMs / 3600000
          });
        } else {
          faultsByOperator.set(operator.operator.id, {
            "No Faults": 0
          });
        }
      }
      
      // Generate chart series (simplified)
      const statusStacked = finalOrderOperators.map(operatorId => ({
        id: String(operatorId),
        title: operatorIdToName.get(operatorId) || String(operatorId),
        type: "bar",
        stack: "status",
        data: Object.entries(statusByOperator.get(operatorId) || {}).map(([status, hours]) => ({
          x: status,
          y: Math.round((hours || 0) * 100) / 100
        }))
      }));
      
      const itemsStacked = finalOrderOperators.map(operatorId => ({
        id: String(operatorId),
        title: operatorIdToName.get(operatorId) || String(operatorId),
        type: "bar",
        stack: "items",
        data: Object.entries(itemsByOperator.get(operatorId) || {}).map(([item, count]) => ({
          x: item,
          y: count || 0
        }))
      }));
      
      const faultsStacked = finalOrderOperators.map(operatorId => ({
        id: String(operatorId),
        title: operatorIdToName.get(operatorId) || String(operatorId),
        type: "bar",
        stack: "faults",
        data: Object.entries(faultsByOperator.get(operatorId) || {}).map(([faultType, hours]) => ({
          x: faultType,
          y: Math.round((hours || 0) * 100) / 100
        }))
      }));
      
      // Final response
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
          order: finalOrderOperators.map(id => operatorIdToName.get(id) || id)
        },
        optimization: {
          used: true,
          approach: 'hybrid',
          thresholdHours: HYBRID_THRESHOLD_HOURS,
          timeRangeHours: Math.round(timeRangeHours * 100) / 100,
          completeDays: completeDays.length,
          partialDays: partialDays.length,
          dailyRecords: dailyRecords.length,
          sessionRecords: sessionData.length,
          performance: {
            estimatedSpeedup: `${Math.round((timeRangeHours / 24) * 10)}x faster for ${Math.round(timeRangeHours / 24)} days`
          }
        }
      });
      
    } catch (error) {
      console.log(`Error in hybrid operator item summary:`, error);
      res.status(500).json({ 
        error: "Failed to generate hybrid operator item summary",
        message: error.message 
      });
    }
  });

  // Hybrid item report route - combines daily cache for complete days + sessions for partial days
  router.get("/analytics/item-sessions-summary-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      
      // Configurable threshold for hybrid approach (36 hours)
      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // If time range is less than threshold, use original route
      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        // Redirect to original route for shorter time ranges
        return res.status(400).json({
          error: "Time range too short for hybrid approach",
          message: `Use /analytics/item-sessions-summary for time ranges ≤ ${HYBRID_THRESHOLD_HOURS} hours`,
          currentHours: Math.round(timeRangeHours * 100) / 100,
          thresholdHours: HYBRID_THRESHOLD_HOURS
        });
      }

      // Split time range into complete days and partial days
      const startOfFirstDay = DateTime.fromJSDate(exactStart, { zone: SYSTEM_TIMEZONE }).startOf('day');
      const endOfLastDay = DateTime.fromJSDate(exactEnd, { zone: SYSTEM_TIMEZONE }).endOf('day');
      
      const completeDays = [];
      const partialDays = [];
      
      // Add complete days (full 24-hour periods)
      let currentDay = startOfFirstDay;
      while (currentDay < endOfLastDay) {
        const dayStart = currentDay.toJSDate();
        const dayEnd = currentDay.plus({ days: 1 }).startOf('day').toJSDate();
        
        // Only include if the day is completely within the query range
        if (dayStart >= exactStart && dayEnd <= exactEnd) {
          completeDays.push({
            start: dayStart,
            end: dayEnd,
            dateStr: currentDay.toFormat('yyyy-LL-dd')
          });
        }
        
        currentDay = currentDay.plus({ days: 1 });
      }
      
      // Add partial days (beginning and end of range)
      if (exactStart < startOfFirstDay.plus({ days: 1 }).toJSDate()) {
        partialDays.push({
          start: exactStart,
          end: Math.min(exactEnd, startOfFirstDay.plus({ days: 1 }).toJSDate()),
          type: 'start'
        });
      }
      
      if (exactEnd > endOfLastDay.minus({ days: 1 }).toJSDate()) {
        partialDays.push({
          start: Math.max(exactStart, endOfLastDay.minus({ days: 1 }).toJSDate()),
          end: exactEnd,
          type: 'end'
        });
      }

      // Query daily cache for complete days
      const dailyRecords = await queryItemDailyCache(completeDays);
      
      // Query sessions for partial days
      const sessionData = await queryItemSessions(partialDays);
      
      // Combine the data
      const combinedData = combineItemData(dailyRecords, sessionData);
      
      // Build response similar to original route
      const resultsMap = new Map();
      
      // Process combined data
      for (const record of combinedData) {
        const key = String(record.itemId);
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: record.itemId,
            name: record.itemName || `Item ${record.itemId}`,
            totalCount: 0,
            totalMisfeed: 0,
            totalRuntime: 0,
            totalWorkTime: 0,
            totalTimeCredit: 0,
            totalFaultTime: 0,
            totalPausedTime: 0,
            efficiency: 0,
            pph: 0
          });
        }
        
        const item = resultsMap.get(key);
        item.totalCount += record.totalCounts || 0;
        item.totalMisfeed += record.totalMisfeeds || 0;
        item.totalRuntime += (record.runtimeMs || 0) / 1000; // Convert to seconds
        item.totalWorkTime += (record.workedTimeMs || 0) / 1000; // Convert to seconds
        item.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
        item.totalFaultTime += (record.faultTimeMs || 0) / 1000; // Convert to seconds
        item.totalPausedTime += (record.pausedTimeMs || 0) / 1000; // Convert to seconds
      }
      
      // Calculate efficiency and PPH
      for (const item of resultsMap.values()) {
        if (item.totalWorkTime > 0) {
          item.efficiency = (item.totalCount / item.totalWorkTime) * 3600; // PPH
          item.pph = item.efficiency;
        }
      }
      
      // Convert to array and sort
      const results = Array.from(resultsMap.values()).sort((a, b) => b.totalCount - a.totalCount);
      
      res.json({
        success: true,
        data: results,
        metadata: {
          timeRange: {
            start: exactStart,
            end: exactEnd,
            hours: Math.round(timeRangeHours * 100) / 100
          },
          optimization: {
            used: true,
            approach: 'hybrid',
            thresholdHours: HYBRID_THRESHOLD_HOURS,
            timeRangeHours: Math.round(timeRangeHours * 100) / 100,
            completeDays: completeDays.length,
            partialDays: partialDays.length,
            dailyRecords: dailyRecords.length,
            sessionRecords: sessionData.length,
            performance: {
              estimatedSpeedup: `${Math.round((timeRangeHours / 24) * 10)}x faster for ${Math.round(timeRangeHours / 24)} days`
            }
          }
        }
      });

    } catch (error) {
      console.log("Error in item-sessions-summary-hybrid:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });

  // Helper function to query item daily cache
  async function queryItemDailyCache(completeDays) {
    if (completeDays.length === 0) return [];
    
    const cacheCollection = database.db.collection('totals-daily');
    
    const dateObjs = completeDays.map(day => new Date(day.dateStr + 'T00:00:00.000Z'));
    
    const records = await cacheCollection.find({
      entityType: 'item',
      dateObj: { $in: dateObjs }
    }).toArray();
    
    return records;
  }

  // Helper function to query item sessions for partial days
  async function queryItemSessions(partialDays) {
    if (partialDays.length === 0) return [];
    
    const countColl = database.db.collection('count');
    const osColl = database.db.collection(config.operatorSessionCollectionName);
    
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
            totalWorkTime += (session.workTime || 0) * factor * itemProportion;
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

  // Helper function to combine item data
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

  // Helper functions for hybrid queries
  function splitTimeRangeForHybrid(start, end) {
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

  async function getCachedDataForDays(completeDays, serial) {
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

  async function getSessionDataForPartialDays(partialDays, serial) {
    const machines = [];
    const machineItems = [];
    
    for (const partialDay of partialDays) {
      // Query machine sessions for this partial day
      const match = {
        ...(serial ? { "machine.serial": serial } : {}),
        "timestamps.start": { $lte: partialDay.end },
        $or: [
          { "timestamps.end": { $exists: false } },
          { "timestamps.end": { $gte: partialDay.start } },
        ],
      };

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
                          { $gte: ["$$c.timestamp", partialDay.start] },
                          { $lte: ["$$c.timestamp", partialDay.end] },
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

      // Process sessions to create machine totals (similar to original route logic)
      const grouped = new Map();
      for (const s of sessions) {
        const key = s.machine?.serial;
        if (!key) continue;
        if (!grouped.has(key)) {
          grouped.set(key, {
            machine: { name: s.machine?.name || "Unknown", serial: key },
            totalCount: 0,
            totalWorkedMs: 0,
            totalRuntimeMs: 0,
            itemAgg: new Map(),
          });
        }
        const bucket = grouped.get(key);

        if (!s.sliceMs || s.sliceMs <= 0) continue;

        const activeStations = Array.isArray(s.operators)
          ? s.operators.filter((op) => op && op.id !== -1).length
          : 0;

        const workedTimeMs = Math.max(0, s.sliceMs * activeStations);
        const runtimeMs = Math.max(0, s.sliceMs);

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
          faultTimeMs: 0, // Simplified for partial days
          pausedTimeMs: 0,
          totalFaults: 0,
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

  function combineHybridData(cachedMachines, cachedMachineItems, sessionData) {
    const machineMap = new Map();
    const machineItemMap = new Map();
    
    // ========== FIX: Sum cached machines by serial instead of overwriting ==========
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
    
    // ========== FIX: Deduplicate by (serial, itemId, date) first, then sum across dates ==========
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

  // Cached version of machine-item-sessions-summary using totals-daily collection
  router.get("/analytics/machine-item-sessions-summary-cache", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      
      // ========== FIX #1: Timezone-aware date handling ==========
      const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
      const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
      
      const normalizedStart = startDt.startOf('day');
      const nowLocal = DateTime.now().setZone(SYSTEM_TIMEZONE);
      
      // Detect "today since midnight" → treat as complete day using cache
      const isTodaySinceMidnight =
        normalizedStart.hasSame(nowLocal, 'day') &&
        startDt.equals(normalizedStart) &&
        endDt <= nowLocal;
      
      // Always use UTC timestamps corresponding to local day boundaries
      const exactStart = normalizedStart.toUTC().toJSDate();
      const exactEnd = isTodaySinceMidnight 
        ? nowLocal.toUTC().toJSDate() 
        : endDt.toUTC().toJSDate();

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

      // ========== FIX #3: Simplified hybrid logic with "today since midnight" detection ==========
      let split;
      if (isTodaySinceMidnight) {
        // Special case: today since midnight → treat as complete day
        split = {
          completeDays: [{
            dateStr: normalizedStart.toISODate(),
            start: normalizedStart.toJSDate(),
            end: nowLocal.toJSDate(),
          }],
          partialDays: [],
        };
      } else {
        split = splitTimeRangeForHybrid(exactStart, exactEnd);

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
        }
      }
      
      const { completeDays, partialDays } = split;
      
      // ========== FIX #9: Performance - Single cache query for both entity types ==========
      let machineCache = [];     // machine entities from cache
      let machineItemCache = [];  // machine-item entities from cache
      
      if (completeDays.length > 0) {
        const dateStrings = completeDays.map(d => d.dateStr);
        const dateObjs = dateStrings.map(str => new Date(str + 'T00:00:00.000Z'));
        const cacheCollection = db.collection('totals-daily');
        
        // Single query for both entity types with both date formats (50% less I/O)
        const cacheQuery = {
          $or: [
            { dateObj: { $in: dateObjs } },
            { date: { $in: dateStrings } }
          ],
          entityType: { $in: ['machine', 'machine-item'] }
        };
        if (serial) cacheQuery.machineSerial = parseInt(serial);
        
        const cacheDocs = await cacheCollection.find(cacheQuery).toArray();
        
        // Split by entity type
        machineCache = cacheDocs.filter(d => d.entityType === 'machine');
        machineItemCache = cacheDocs.filter(d => d.entityType === 'machine-item');
      }
      
      // Get data from sessions for partial days only
      let sessionData = { machines: [], machineItems: [] };
      if (partialDays.length > 0) {
        sessionData = await getSessionDataForPartialDays(partialDays, serial);
      }
      
      // Combine cached and session data (disjoint date ranges)
      const combinedData = combineHybridData(machineCache, machineItemCache, sessionData);
      let machineTotals = combinedData.machines;
      let machineItemTotals = combinedData.machineItems;

      if (!machineTotals.length) {
        // Try session data as fallback when cache is missing
        const partialDay = {
          start: exactStart,
          end: exactEnd
        };
        const sessionFallback = await getSessionDataForPartialDays([partialDay], serial);
        
        if (sessionFallback.machines.length > 0) {
          // Re-combine with session data
          const recombined = combineHybridData([], [], sessionFallback);
          machineTotals = recombined.machines;
          machineItemTotals = recombined.machineItems;
        }
        
        // Final check after fallback attempt
        if (!machineTotals.length) {
          return res.json({
            timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
            results: []
          });
        }
      }

      // ---------- 2) Process machine data ----------
      const results = [];
      const serialToName = new Map();
      
      // ========== Aggregate machine data by (serial, date) to prevent duplication ==========
      const groupedByMachineDay = new Map();
      
      for (const record of machineTotals) {
        const key = `${record.machineSerial}-${record.date}`;
        
        if (!groupedByMachineDay.has(key)) {
          groupedByMachineDay.set(key, {
            machineSerial: record.machineSerial,
            machineName: record.machineName,
            date: record.date,
            runtimeMs: 0,
            workedTimeMs: 0,
            totalCounts: 0,
            totalMisfeeds: 0,
            faultTimeMs: 0,
            pausedTimeMs: 0
          });
        }
        
        const dayBucket = groupedByMachineDay.get(key);
        dayBucket.runtimeMs += record.runtimeMs || 0;
        dayBucket.workedTimeMs += record.workedTimeMs || 0;
        dayBucket.totalCounts += record.totalCounts || 0;
        dayBucket.totalMisfeeds += record.totalMisfeeds || 0;
        dayBucket.faultTimeMs += record.faultTimeMs || 0;
        dayBucket.pausedTimeMs += record.pausedTimeMs || 0;
      }
      
      // Cap each machine to 24h per day
      for (const [key, dayBucket] of groupedByMachineDay) {
        if (dayBucket.runtimeMs > 86400000) {
          dayBucket.runtimeMs = 86400000;
        }
        if (dayBucket.workedTimeMs > 86400000) {
          dayBucket.workedTimeMs = 86400000;
        }
      }
      
      // Aggregate across all days for each machine
      const machineDataMap = new Map();
      for (const [key, dayBucket] of groupedByMachineDay) {
        const serial = dayBucket.machineSerial;
        const name = dayBucket.machineName;
        serialToName.set(serial, name);
        
        if (!machineDataMap.has(serial)) {
          machineDataMap.set(serial, {
            machineSerial: serial,
            machineName: name,
            runtimeMs: 0,
            workedTimeMs: 0,
            totalCounts: 0,
            totalMisfeeds: 0,
            faultTimeMs: 0,
            pausedTimeMs: 0,
            daysActive: 0
          });
        }
        
        const bucket = machineDataMap.get(serial);
        bucket.runtimeMs += dayBucket.runtimeMs;
        bucket.workedTimeMs += dayBucket.workedTimeMs;
        bucket.totalCounts += dayBucket.totalCounts;
        bucket.totalMisfeeds += dayBucket.totalMisfeeds;
        bucket.faultTimeMs += dayBucket.faultTimeMs;
        bucket.pausedTimeMs += dayBucket.pausedTimeMs;
        bucket.daysActive += 1;
      }

      // Group machine-item totals by machine serial, then aggregate by (serial, itemId) to sum across dates
      const machineItemMap = new Map(); // serial -> array of item records
      for (const itemTotal of machineItemTotals) {
        const serial = itemTotal.machineSerial;
        if (!machineItemMap.has(serial)) {
          machineItemMap.set(serial, []);
        }
        machineItemMap.get(serial).push(itemTotal);
      }

      // Process each machine
      for (const [serial, machineData] of machineDataMap) {
        const itemTotals = machineItemMap.get(serial) || [];
        
        // ========== FIX: Aggregate machine-items by (serial, itemId) to sum across dates ==========
        // This prevents items from showing more time than the machine total
        const aggregatedItems = new Map(); // itemId -> aggregated item data
        for (const itemTotal of itemTotals) {
          const itemId = String(itemTotal.itemId);
          
          if (!aggregatedItems.has(itemId)) {
            aggregatedItems.set(itemId, {
              itemId: itemTotal.itemId,
              itemName: itemTotal.itemName,
              itemStandard: itemTotal.itemStandard,
              totalCounts: 0,
              workedTimeMs: 0,
            });
          }
          
          const aggregated = aggregatedItems.get(itemId);
          aggregated.totalCounts += itemTotal.totalCounts || 0;
          aggregated.workedTimeMs += itemTotal.workedTimeMs || 0;
        }
        
        // Calculate item summaries from aggregated data
        let proratedStandard = 0;
        const itemSummaries = {};

        // First pass: calculate totals from items with non-zero counts (items that will be displayed)
        let itemTotalCounts = 0;
        let itemTotalWorkedMs = 0;

        for (const aggregatedItem of aggregatedItems.values()) {
          // Skip items with zero counts to avoid cluttering the response
          if (aggregatedItem.totalCounts === 0) {
            continue;
          }

          // Sum totals from displayed items only
          itemTotalCounts += aggregatedItem.totalCounts;
          itemTotalWorkedMs += aggregatedItem.workedTimeMs;

          const hours = aggregatedItem.workedTimeMs / 3600000;
          const pph = hours > 0 ? aggregatedItem.totalCounts / hours : 0;
          const eff = aggregatedItem.itemStandard > 0 ? pph / aggregatedItem.itemStandard : 0;
          const weight = machineData.totalCounts > 0 ? aggregatedItem.totalCounts / machineData.totalCounts : 0;
          proratedStandard += weight * aggregatedItem.itemStandard;

          itemSummaries[aggregatedItem.itemId] = {
            name: aggregatedItem.itemName,
            standard: aggregatedItem.itemStandard,
            countTotal: aggregatedItem.totalCounts,
            workedTimeFormatted: formatDuration(aggregatedItem.workedTimeMs),
            pph: Math.round(pph * 100) / 100,
            efficiency: Math.round(eff * 10000) / 100,
          };
        }

        // Add Total entry first (top row) - uses machine's runtimeMs
        const machineRuntimeHours = machineData.runtimeMs / 3600000;
        const machineTotalPph = machineRuntimeHours > 0 ? itemTotalCounts / machineRuntimeHours : 0;
        const machineTotalEfficiency = proratedStandard > 0 ? machineTotalPph / proratedStandard : 0;

        // Create a new object with Total first, then individual items
        const itemSummariesWithTotal = {
          'Total': {
            name: 'Total',
            standard: Math.round(proratedStandard * 100) / 100,
            countTotal: itemTotalCounts,
            workedTimeFormatted: formatDuration(machineData.runtimeMs),
            pph: Math.round(machineTotalPph * 100) / 100,
            efficiency: Math.round(machineTotalEfficiency * 10000) / 100,
          },
          ...itemSummaries
        };

        // Calculate machine-level metrics
        const hours = machineData.workedTimeMs / 3600000;
        const machinePph = hours > 0 ? machineData.totalCounts / hours : 0;
        const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;
        
        // Final validation: cap to query window
        const queryWindowMs = exactEnd.getTime() - exactStart.getTime();
        let validatedRuntimeMs = machineData.runtimeMs;
        let validatedWorkedMs = machineData.workedTimeMs;
        
        if (validatedRuntimeMs > queryWindowMs) {
          validatedRuntimeMs = queryWindowMs;
        }
        if (validatedWorkedMs > queryWindowMs) {
          validatedWorkedMs = queryWindowMs;
        }

        results.push({
          machine: {
            name: machineData.machineName,
            serial: machineData.machineSerial
          },
          sessions: [], // Empty array - no individual session details in cached version
          machineSummary: {
            totalCount: machineData.totalCounts,
            workedTimeMs: validatedWorkedMs,
            workedTimeFormatted: formatDuration(validatedWorkedMs),
            runtimeMs: validatedRuntimeMs,
            runtimeFormatted: formatDuration(validatedRuntimeMs),
            pph: Math.round(machinePph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(machineEff * 10000) / 100,
            itemSummaries: itemSummariesWithTotal,
          },
        });
      }

      // ---------- 3) Status stacked (durations) ----------
      // COMMENTED OUT FOR PERFORMANCE
      // const statusByMachine = new Map();
      // for (const machineData of machineTotals) {
      //   const serial = machineData.machineSerial;
      //   const name = machineData.machineName;
      //   
      //   statusByMachine.set(serial, {
      //     "Running": machineData.runtimeMs / 3600000, // Convert to hours
      //     "Faulted": machineData.faultTimeMs / 3600000,
      //     "Paused": machineData.pausedTimeMs / 3600000
      //   });
      // }

      // // Compress per machine
      // for (const [s, rec] of statusByMachine) {
      //   statusByMachine.set(s, compressSlicesPerBar(rec));
      // }

      // // ---------- 4) Faults stacked (durations by fault type) ----------
      // // For cached version, we'll use a simplified fault representation
      // // since fault details aren't stored in machine daily totals
      // const faultsByMachine = new Map();
      // for (const machineData of machineTotals) {
      //   const serial = machineData.machineSerial;
      //   const faultHours = machineData.faultTimeMs / 3600000;
      //   
      //   if (faultHours > 0) {
      //     faultsByMachine.set(serial, {
      //       "Faults": faultHours
      //     });
      //   } else {
      //     faultsByMachine.set(serial, {
      //       "No Faults": 0
      //     });
      //   }
      // }

      // // ---------- 5) Efficiency ranking order ----------
      // const efficiencyRanked = results
      //   .map(r => ({
      //     serial: r.machine.serial,
      //     name: r.machine.name,
      //     efficiency: Number(r.machineSummary?.efficiency || 0),
      //   }))
      //   .sort((a, b) => b.efficiency - a.efficiency);

      // // Build comprehensive machine ordering from all data sources
      // const unionSerials = new Set(efficiencyRanked.map(r => r.serial));
      // for (const m of statusByMachine.keys()) unionSerials.add(m);
      // for (const m of faultsByMachine.keys()) unionSerials.add(m);
      // const finalOrderSerials = [...unionSerials].filter(s => serialToName.has(s));

      // // ---------- 6) Items stacked ----------
      // const itemsByMachine = new Map();
      // for (const r of results) {
      //   const m = {};
      //   for (const [id, s] of Object.entries(r.machineSummary.itemSummaries || {})) {
      //     const label = s.name || String(id);
      //     const count = Number(s.countTotal || 0);
      //     m[label] = (m[label] || 0) + count;
      //   }
      //   itemsByMachine.set(r.machine.serial, compressSlicesPerBar(m));
      // }

      // const itemsStacked = toStackedSeries(itemsByMachine, serialToName, finalOrderSerials, "items");
      // const statusStacked = toStackedSeries(statusByMachine, serialToName, finalOrderSerials, "status");
      // const faultsStacked = toStackedSeries(faultsByMachine, serialToName, finalOrderSerials, "faults");

      // ---------- 7) Final payload ----------
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,                  // Same structure as original route
        // CHARTS COMMENTED OUT FOR PERFORMANCE
        // charts: {
        //   statusStacked: {
        //     title: "Machine Status Stacked Bar",
        //     orientation: "vertical",
        //     xType: "category",
        //     xLabel: "Machine",
        //     yLabel: "Duration (hours)",
        //     series: statusStacked
        //   },
        //   efficiencyRanked: {
        //     title: "Ranked OEE% by Machine", 
        //     orientation: "horizontal",
        //     xType: "category",
        //     xLabel: "Machine",
        //     yLabel: "OEE (%)",
        //     series: [
        //       {
        //         id: "OEE",
        //         title: "OEE",
        //         type: "bar",
        //         data: efficiencyRanked.map(r => ({ x: r.name, y: r.efficiency })),
        //       },
        //     ]
        //   },
        //   itemsStacked: {
        //     title: "Item Stacked Bar by Machine",
        //     orientation: "vertical", 
        //     xType: "category",
        //     xLabel: "Machine",
        //     yLabel: "Item Count",
        //     series: itemsStacked
        //   },
        //   faultsStacked: {
        //     title: "Fault Stacked Bar by Machine",
        //     orientation: "vertical",
        //     xType: "category", 
        //     xLabel: "Machine",
        //     yLabel: "Fault Duration (hours)",
        //     series: faultsStacked
        //   },
        //   order: finalOrderSerials.map(s => serialToName.get(s) || s), // machine display order (ranked)
        // },
      });
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate cached machine item summary" });
    }
  });

  // Simplified cached version using only totals-daily collection
  router.get("/analytics/machine-item-sessions-summary-cache2", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      
      // Timezone-aware date handling
      const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
      const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
      
      const normalizedStart = startDt.startOf('day');
      const normalizedEnd = endDt.startOf('day');
      
      // Generate date range
      const dateStrings = [];
      let currentDate = normalizedStart;
      while (currentDate <= normalizedEnd) {
        dateStrings.push(currentDate.toISODate());
        currentDate = currentDate.plus({ days: 1 });
      }
      
      const cacheCollection = db.collection('totals-daily');
      
      // Query for machine and machine-item records
      const cacheQuery = {
        $or: [
          { dateObj: { $in: dateStrings.map(str => new Date(str + 'T00:00:00.000Z')) } },
          { date: { $in: dateStrings } }
        ],
        entityType: { $in: ['machine', 'machine-item'] }
      };
      if (serial) cacheQuery.machineSerial = parseInt(serial);
      
      const cacheDocs = await cacheCollection.find(cacheQuery).toArray();
      
      // Split by entity type
      const machineRecords = cacheDocs.filter(d => d.entityType === 'machine');
      const machineItemRecords = cacheDocs.filter(d => d.entityType === 'machine-item');
      
      // Aggregate machines by serial (sum across dates)
      const machineMap = new Map();
      for (const machine of machineRecords) {
        const serial = machine.machineSerial;
        if (machineMap.has(serial)) {
          const existing = machineMap.get(serial);
          existing.runtimeMs += machine.runtimeMs || 0;
          existing.totalCounts += machine.totalCounts || 0;
          existing.workedTimeMs += machine.workedTimeMs || 0;
        } else {
          machineMap.set(serial, {
            machineSerial: serial,
            machineName: machine.machineName,
            runtimeMs: machine.runtimeMs || 0,
            totalCounts: machine.totalCounts || 0,
            workedTimeMs: machine.workedTimeMs || 0,
          });
        }
      }
      
      // Aggregate machine-items by (serial, itemId) - deduplicate by date first, then sum
      const itemDeduplicatedByDate = new Map(); // key: `${serial}-${itemId}-${date}`
      for (const item of machineItemRecords) {
        const dateKey = item.date || item.dateStr || 'unknown';
        const key = `${item.machineSerial}-${item.itemId}-${dateKey}`;
        
        if (itemDeduplicatedByDate.has(key)) {
          // Duplicate for same (serial, itemId, date) - take max
          const existing = itemDeduplicatedByDate.get(key);
          existing.totalCounts = Math.max(existing.totalCounts, item.totalCounts || 0);
          existing.workedTimeMs = Math.max(existing.workedTimeMs, item.workedTimeMs || 0);
          existing.runtimeMs = Math.max(existing.runtimeMs, item.runtimeMs || 0);
        } else {
          itemDeduplicatedByDate.set(key, {
            machineSerial: item.machineSerial,
            itemId: item.itemId,
            itemName: item.itemName,
            itemStandard: item.itemStandard,
            totalCounts: item.totalCounts || 0,
            workedTimeMs: item.workedTimeMs || 0,
            runtimeMs: item.runtimeMs || 0,
          });
        }
      }
      
      // Sum across dates by (serial, itemId)
      const itemMap = new Map(); // key: `${serial}-${itemId}`
      for (const item of itemDeduplicatedByDate.values()) {
        const key = `${item.machineSerial}-${item.itemId}`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          existing.totalCounts += item.totalCounts;
          existing.workedTimeMs += item.workedTimeMs;
          existing.runtimeMs += item.runtimeMs;
        } else {
          itemMap.set(key, {
            machineSerial: item.machineSerial,
            itemId: item.itemId,
            itemName: item.itemName,
            itemStandard: item.itemStandard,
            totalCounts: item.totalCounts,
            workedTimeMs: item.workedTimeMs,
            runtimeMs: item.runtimeMs,
          });
        }
      }
      
      // Build results in the same format as machine-item-sessions-summary-cache
      const results = [];
      const exactStart = normalizedStart.toUTC().toJSDate();
      const exactEnd = normalizedEnd.plus({ days: 1 }).toUTC().toJSDate();
      
      for (const [serial, machineData] of machineMap) {
        const machineItems = Array.from(itemMap.values()).filter(item => item.machineSerial === serial);
        
        // Calculate machine totals from items
        const machineTotalCounts = machineItems.reduce((sum, item) => sum + item.totalCounts, 0);
        const machineTotalRuntimeMs = machineItems.reduce((sum, item) => sum + item.runtimeMs, 0);
        const machineTotalWorkedMs = machineItems.reduce((sum, item) => sum + item.workedTimeMs, 0);
        
        // Calculate machine PPH and efficiency
        const machineHours = machineTotalWorkedMs / 3600000;
        const machinePph = machineHours > 0 ? machineTotalCounts / machineHours : 0;
        
        // Calculate prorated standard (weighted average)
        let proratedStandard = 0;
        for (const item of machineItems) {
          if (machineTotalCounts > 0 && item.totalCounts > 0) {
            const weight = item.totalCounts / machineTotalCounts;
            proratedStandard += weight * (item.itemStandard || 0);
          }
        }
        const machineEfficiency = proratedStandard > 0 ? machinePph / proratedStandard : 0;
        
        // Build itemSummaries object with Total first, then individual items
        const itemSummaries = {};
        
        // Add Total entry first (top row)
        itemSummaries['Total'] = {
          name: 'Total',
          standard: Math.round(proratedStandard * 100) / 100,
          countTotal: machineTotalCounts,
          workedTimeFormatted: formatDuration(machineTotalWorkedMs),
          pph: Math.round(machinePph * 100) / 100,
          efficiency: Math.round(machineEfficiency * 10000) / 100,
        };
        
        // Add individual item entries
        for (const item of machineItems) {
          if (item.totalCounts === 0) continue; // Skip items with zero counts
          
          const itemHours = item.workedTimeMs / 3600000;
          const itemPph = itemHours > 0 ? item.totalCounts / itemHours : 0;
          const itemEfficiency = (item.itemStandard || 0) > 0 ? itemPph / item.itemStandard : 0;
          
          itemSummaries[item.itemId] = {
            name: item.itemName,
            standard: item.itemStandard || 0,
            countTotal: item.totalCounts,
            workedTimeFormatted: formatDuration(item.workedTimeMs),
            pph: Math.round(itemPph * 100) / 100,
            efficiency: Math.round(itemEfficiency * 10000) / 100,
          };
        }
        
        // Final validation: cap to query window
        const queryWindowMs = exactEnd.getTime() - exactStart.getTime();
        let validatedRuntimeMs = machineTotalRuntimeMs;
        let validatedWorkedMs = machineTotalWorkedMs;
        
        if (validatedRuntimeMs > queryWindowMs) {
          validatedRuntimeMs = queryWindowMs;
        }
        if (validatedWorkedMs > queryWindowMs) {
          validatedWorkedMs = queryWindowMs;
        }
        
        results.push({
          machine: {
            name: machineData.machineName,
            serial: machineData.machineSerial
          },
          sessions: [], // Empty array - no individual session details in cached version
          machineSummary: {
            totalCount: machineTotalCounts,
            workedTimeMs: validatedWorkedMs,
            workedTimeFormatted: formatDuration(validatedWorkedMs),
            runtimeMs: validatedRuntimeMs,
            runtimeFormatted: formatDuration(validatedRuntimeMs),
            pph: Math.round(machinePph * 100) / 100,
            proratedStandard: Math.round(proratedStandard * 100) / 100,
            efficiency: Math.round(machineEfficiency * 10000) / 100,
            itemSummaries,
          },
        });
      }
      
      res.json({
        timeRange: { start: exactStart.toISOString(), end: exactEnd.toISOString() },
        results,
      });
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate simplified cached machine item summary" });
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
        split = splitTimeRangeForHybrid(exactStart, exactEnd);

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
          sessionData = await getOperatorSessionDataForPartialDays([{ start: exactStart, end: exactEnd }], operatorId);
          console.log(`[OPERATOR-CACHE] Session fallback returned ${sessionData.operators.length} operators`);
        }
      } else {
        // No complete days, use sessions for entire range
        console.log(`[OPERATOR-CACHE] No complete days, using sessions for entire range`);
        sessionData = await getOperatorSessionDataForPartialDays([{ start: exactStart, end: exactEnd }], operatorId);
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

  // Helper functions for operator hybrid queries
  async function getOperatorCachedDataForDays(completeDays, operatorId) {
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

  async function getOperatorSessionDataForPartialDays(partialDays, operatorId) {
    const operators = [];

    // Helper to normalize operator name from either string or {first, surname} format
    const normalizeOperatorName = (name, opId) => {
      if (!name) return `Operator ${opId}`;
      if (typeof name === 'string') return name;
      if (typeof name === 'object' && name.first && name.surname) {
        return `${name.first} ${name.surname}`;
      }
      if (typeof name === 'object' && name.first) {
        return name.first;
      }
      return `Operator ${opId}`;
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

      // Just get the sessions with the fields we need
      const sessions = await db
        .collection(config.operatorSessionCollectionName)
        .find(match)
        .project({
          _id: 0,
          operator: 1,
          machine: 1,
          totalCount: 1,
          runtime: 1,
          workTime: 1,
          counts: 1,
          timestamps: 1
        })
        .toArray();

      console.log(`[SESSION-AGG] Got ${sessions.length} sessions for ${partialDay.start.toISOString()} to ${partialDay.end.toISOString()}`);

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
            itemCounts: new Map()
          });
        }
        
        const bucket = grouped.get(opId);
        
        // Use the pre-calculated values from the session document
        bucket.totalCounts += session.totalCount || 0;
        bucket.runtimeMs += (session.runtime || 0) * 1000; // Convert seconds to ms
        bucket.workedTimeMs += (session.workTime || 0) * 1000; // Convert seconds to ms
        
        // Track item-level counts - group by itemName (not itemId) to combine items with same name but different standards
        if (Array.isArray(session.counts)) {
          // Helper to normalize item name (same as in main processing)
          const normalizeItemName = (name) => {
            if (!name) return 'Unknown';
            const str = String(name);
            const normalized = str.trim().replace(/\s+/g, ' ').toLowerCase();
            return normalized || 'Unknown';
          };
          
          for (const count of session.counts) {
            const itemName = count.item?.name;
            if (!itemName) continue;
            
            // Normalize item name for consistent grouping (case-insensitive, whitespace normalized)
            const normalizedName = normalizeItemName(itemName);
            if (normalizedName === 'Unknown') continue;
            
            const itemCount = count.item?.count ?? 1;
            const itemStandard = count.item?.standard || 0;
            
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
          faultTimeMs: 0,
          pausedTimeMs: 0,
          totalFaults: 0,
          totalMisfeeds: 0,
          totalTimeCreditMs: 0,
          itemTotals: itemTotals
        });
      }
    }
    
    console.log(`[SESSION-AGG] Returning ${operators.length} operators`);
    return { operators };
  }

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


  // Cached version of item-sessions-summary using totals-daily collection
  router.get("/analytics/item-sessions-summary-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      
      // parseAndValidateQueryParams returns JS Date objects, so convert them to Luxon in system timezone
      const startDt = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
      const endDt = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
      
      // Validate parsed dates
      if (!startDt.isValid) {
        console.log(`[ITEM-CACHE] Invalid start date: ${start}, reason: ${startDt.invalidReason}`);
        return res.status(400).json({ error: `Invalid start date: ${startDt.invalidReason}` });
      }
      if (!endDt.isValid) {
        console.log(`[ITEM-CACHE] Invalid end date: ${end}, reason: ${endDt.invalidReason}`);
        return res.status(400).json({ error: `Invalid end date: ${endDt.invalidReason}` });
      }
      
      const exactStart = startDt.toJSDate();
      const exactEnd = endDt.toJSDate();

      // ---------- Hybrid query configuration ----------
      const HYBRID_THRESHOLD_HOURS = 24; // Configurable threshold for hybrid approach
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // Determine if we should use hybrid approach
      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;
      
      if (useHybrid) {
        console.log(`Using hybrid approach for item route, time range: ${timeRangeHours.toFixed(1)} hours (threshold: ${HYBRID_THRESHOLD_HOURS} hours)`);
      }

      // ---------- helpers (local to route) ----------
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n; // PPM→PPH
      };

      // ---------- 1) Time range splitting and data collection ----------
      let itemTotals = [];
      let sessionData = { items: [] };

      if (useHybrid) {
        // Split time range into complete days and partial days
        const { completeDays, partialDays } = splitTimeRangeForHybrid(exactStart, exactEnd);
        
        console.log(`Item hybrid split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
        
        // Get data from daily cache for complete days
        if (completeDays.length > 0) {
          itemTotals = await getItemCachedDataForDays(completeDays);
        }
        
        // Get data from sessions for partial days
        if (partialDays.length > 0) {
          sessionData = await getItemSessionDataForPartialDays(partialDays);
        }
        
        // Combine cached and session data
        itemTotals = combineItemHybridData(itemTotals, sessionData.items);
        
      } else {
        // Use only cached data for shorter time ranges
        const cacheCollection = db.collection('totals-daily');
        
        // Calculate date range for query
        const startDate = exactStart.toISOString().split('T')[0];
        const endDate = exactEnd.toISOString().split('T')[0];

        // Get item daily totals
        const itemQuery = { 
          entityType: 'item',
          dateObj: { 
            $gte: new Date(startDate + 'T00:00:00.000Z'), 
            $lte: new Date(endDate + 'T23:59:59.999Z') 
          }
        };

        itemTotals = await cacheCollection.find(itemQuery).toArray();
        
        // Also get machine-item records to extract standard values
        const machineItemQuery = { 
          entityType: 'machine-item',
          dateObj: { 
            $gte: new Date(startDate + 'T00:00:00.000Z'), 
            $lte: new Date(endDate + 'T23:59:59.999Z') 
          }
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
      }

      if (!itemTotals.length) {
        return res.json([]);
      }

      // ---------- 2) Process item data ----------
      const resultsMap = new Map();

      // Group item totals by item ID
      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);
        
        if (!resultsMap.has(itemId)) {
          resultsMap.set(itemId, {
            itemId: itemTotal.itemId,
            name: itemTotal.itemName || "Unknown",
            standard: itemTotal.itemStandard ?? 0,
            count: 0,
            workedSec: 0,
          });
        }
        
        const acc = resultsMap.get(itemId);
        acc.count += itemTotal.totalCounts;
        acc.workedSec += itemTotal.workedTimeMs / 1000; // Convert to seconds
      }

      // ---------- 3) Finalize results ----------
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
    } catch (error) {
      console.log(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to generate cached item summary" });
    }
  });

  // Helper functions for item hybrid queries
  async function getItemCachedDataForDays(completeDays) {
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

  async function getItemSessionDataForPartialDays(partialDays) {
    const items = [];
    
    // Get active machine serials
    const activeSerials = await db
      .collection(config.machineCollectionName || "machine")
      .distinct("serial", { active: true });
    
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
    
    return { items };
  }

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
        const sessionData = await getItemSessionDataForPartialDays(partialDays);

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
        const { completeDays, partialDays } = splitTimeRangeForHybrid(exactStart, exactEnd);
        
        console.log(`[item-sessions-summary-daily-cache] Hybrid split: ${completeDays.length} complete days, ${partialDays.length} partial day ranges`);
        console.log(`[item-sessions-summary-daily-cache] Complete days:`, completeDays.map(d => d.dateStr));
        console.log(`[item-sessions-summary-daily-cache] Partial days:`, partialDays.map(d => ({ start: d.start.toISOString(), end: d.end.toISOString() })));
        
        // Get data from daily cache for complete days (using simulator's item records)
        if (completeDays.length > 0) {
          itemTotals = await getItemDailyCachedDataForDays(completeDays);
          console.log(`[item-sessions-summary-daily-cache] Retrieved ${itemTotals.length} item records from cache for complete days`);
        }
        
        // Get data from sessions for partial days
        if (partialDays.length > 0) {
          const sessionData = await getItemSessionDataForPartialDays(partialDays);
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

  // Helper functions for item daily hybrid queries
  async function getItemDailyCachedDataForDays(completeDays) {
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

  return router;
};




