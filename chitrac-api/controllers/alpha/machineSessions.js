const express = require('express');

const { formatDuration } = require("../../utils/time");

module.exports = function (server) {
  const router = express.Router();

  // Get logger and db from server object
  const logger = server.logger;
  const db = server.db;
  const config = require('../../modules/config');

  // Helper function to parse and validate query parameters
  function parseAndValidateQueryParams(req) {
    const { start, end, serial } = req.query;

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

    return { 
      start: startDate, 
      end: endDate, 
      serial: serial ? parseInt(serial) : null 
    };
  }

  // Debug route to check database state
  router.get("/analytics/debug", async (req, res) => {
    try {
      logger.info("[machineSessions] Debug route called");

      // Check collections
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);

      // Check machine collection
      const machineCount = await db.collection(config.machineCollectionName).countDocuments();
      const activeMachineCount = await db.collection(config.machineCollectionName).countDocuments({ active: true });

      // Check stateTicker collection
      const tickerCount = await db.collection(config.stateTickerCollectionName).countDocuments();

      // Check machineSession collection
      const sessionCount = await db.collection(config.machineSessionCollectionName).countDocuments();

      res.json({
        collections: collectionNames,
        machineCollection: {
          name: config.machineCollectionName,
          totalCount: machineCount,
          activeCount: activeMachineCount
        },
        stateTickerCollection: {
          name: config.stateTickerCollectionName,
          totalCount: tickerCount
        },
        machineSessionCollection: {
          name: config.machineSessionCollectionName,
          totalCount: sessionCount
        }
      });
    } catch (err) {
      logger.error("[machineSessions] Debug route error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add this debug query to see actual session dates
  router.get("/analytics/debug-sessions", async (req, res) => {
    try {
      const sessions = await db.collection("machine-session")
        .find({})
        .project({
          "machine.serial": 1,
          "timestamps.start": 1,
          "timestamps.end": 1,
          _id: 0
        })
        .sort({ "timestamps.start": 1 })
        .limit(20)
        .toArray();

      res.json({
        totalSessions: await db.collection("machine-session").countDocuments(),
        sampleSessions: sessions,
        dateRange: {
          earliest: sessions[0]?.timestamps?.start,
          latest: sessions[sessions.length - 1]?.timestamps?.end
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- /api/alpha/analytics/machines-summary-cached ----
  router.get("/analytics/machines-summary-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      
      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];
      
      logger.info(`[machineSessions] Fetching cached machines summary for date: ${dateStr}`);
      
      // Query the machines-summary-cache-today collection directly
      const data = await db.collection('machines-summary-cache-today')
        .find({ 
          date: dateStr,
          _id: { $ne: 'metadata' }
        })
        .toArray();
      
      if (data.length === 0) {
        logger.warn(`[machineSessions] No cached data found for date: ${dateStr}, falling back to real-time calculation`);
        // Fallback to real-time calculation
        return await getMachinesSummaryRealTime(req, res);
      }
      
      logger.info(`[machineSessions] Retrieved ${data.length} cached machine records for date: ${dateStr}`);
      res.json(data);
      
    } catch (err) {
      logger.error(`[machineSessions] Error in cached machines-summary route:`, err);
      
      // Check if it's a validation error
      if (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date')) {
        return res.status(400).json({ error: err.message });
      }
      
      // Fallback to real-time calculation on any error
      logger.info(`[machineSessions] Falling back to real-time calculation due to error`);
      return await getMachinesSummaryRealTime(req, res);
    }
  });

  // ---- /api/alpha/analytics/machines-summary (real-time calculation) ----
  router.get("/analytics/machines-summary", async (req, res) => {
    return await getMachinesSummaryRealTime(req, res);
  });

  // ---- /api/alpha/machine-dashboard-cached ----
  router.get("/analytics/machine-dashboard-cached", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      
      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];
      
      logger.info(`[machineSessions] Fetching cached machine dashboard for date: ${dateStr}, serial: ${serial || 'all'}`);
      
      // Build query filter
      const filter = { 
        date: dateStr,
        _id: { $ne: 'metadata' }
      };
      
      // Add serial filter if specified
      if (serial) {
        filter['machine.serial'] = parseInt(serial);
      }
      
      // Query the machine-dashboard-summary-cache-today collection directly
      const data = await db.collection('machine-dashboard-summary-cache-today')
        .find(filter)
        .toArray();
      
      if (data.length === 0) {
        logger.warn(`[machineSessions] No cached dashboard data found for date: ${dateStr}, falling back to real-time calculation`);
        // Fallback to real-time calculation
        return await getMachineDashboardRealTime(req, res);
      }
      
      logger.info(`[machineSessions] Retrieved ${data.length} cached dashboard records for date: ${dateStr}`);
      res.json(data);
      
    } catch (err) {
      logger.error(`[machineSessions] Error in cached machine-dashboard route:`, err);
      
      // Check if it's a validation error
      if (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date')) {
        return res.status(400).json({ error: err.message });
      }
      
      // Fallback to real-time calculation on any error
      logger.info(`[machineSessions] Falling back to real-time calculation due to error`);
      return await getMachineDashboardRealTime(req, res);
    }
  });

  // Helper function for real-time calculation (extracted from original route)
  async function getMachinesSummaryRealTime(req, res) {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const queryStart = new Date(start);
      let queryEnd = new Date(end);
      const now = new Date();
      if (queryEnd > now) queryEnd = now;

      // Active machines set
      const activeSerials = new Set(
        await db.collection(config.machineCollectionName)
          .distinct("serial", { active: true })
      );

      // Pull tickers for active machines only
      const tickers = await db.collection(config.stateTickerCollectionName)
        .find({ "machine.serial": { $in: [...activeSerials] } })
        .project({ _id: 0 })
        .toArray();

      // Build one promise per machine
      const results = await Promise.all(
        tickers.map(async (t) => {
          const { machine, status } = t || {};
          const serial = machine?.serial;
          if (!serial) {
            return null;
          }

          // Fetch sessions that overlap the window
          // Spec: start in [S,E] OR end in [S,E].
          // Add "spans entire window" guard to avoid misses.
          const sessions = await db.collection(config.machineSessionCollectionName)
            .find({
              "machine.serial": serial,
              $or: [
                { "timestamps.start": { $gte: queryStart, $lte: queryEnd } },
                { "timestamps.end": { $gte: queryStart, $lte: queryEnd } }
              ]
            })
            .sort({ "timestamps.start": 1 })
            .toArray();

          // If nothing in range, still return zeroed row for the machine
          if (!sessions.length) {
            const totalMs = queryEnd - queryStart;
            return formatMachinesSummaryRow({
              machine, status,
              runtimeMs: 0, downtimeMs: totalMs,
              totalCount: 0, misfeedCount: 0,
              workTimeSec: 0, totalTimeCredit: 0,
              queryStart, queryEnd
            });
          }

          // Truncate first session if it starts before queryStart
          {
            const first = sessions[0];
            const firstStart = new Date(first.timestamps?.start);
            if (firstStart < queryStart) {
              sessions[0] = truncateAndRecalc(first, queryStart, first.timestamps?.end ? new Date(first.timestamps.end) : queryEnd);
            }
          }

          // Truncate last session if it ends after queryEnd (or is open)
          {
            const lastIdx = sessions.length - 1;
            const last = sessions[lastIdx];
            const lastEnd = last.timestamps?.end ? new Date(last.timestamps.end) : null;

            if (!lastEnd || lastEnd > queryEnd) {
              const effectiveEnd = lastEnd ? queryEnd : queryEnd; // clamp open or overrun to queryEnd
              sessions[lastIdx] = truncateAndRecalc(
                last,
                new Date(sessions[lastIdx].timestamps.start), // after possible first fix, use its current start
                effectiveEnd
              );
            }
          }

          // Aggregate
          let runtimeMs = 0;
          let workTimeSec = 0;
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

          const downtimeMs = Math.max(0, (queryEnd - queryStart) - runtimeMs);

          const result = formatMachinesSummaryRow({
            machine, status,
            runtimeMs, downtimeMs,
            totalCount, misfeedCount,
            workTimeSec, totalTimeCredit,
            queryStart, queryEnd
          });

          return result;
        })
      );

      const finalResults = results.filter(Boolean);
      res.json(finalResults);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);

      // Check if it's a validation error
      if (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date')) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to build machines summary" });
    }
  }

  // Helper function for real-time machine dashboard calculation (extracted from machineRoutes.js)
  async function getMachineDashboardRealTime(req, res) {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      const targetSerials = serial ? [serial] : [];

      // Import required functions (these should be available from the server context)
      const { fetchGroupedAnalyticsData } = require('../../utils/fetchData');
      const { getBookendedStatesAndTimeRange } = require('../../utils/bookendingBuilder');
      const {
        buildMachinePerformance,
        buildMachineItemSummary,
        buildItemHourlyStack,
        buildFaultData,
        buildOperatorEfficiency,
        buildCurrentOperators
      } = require('../../utils/machineDashboardBuilder');

      const groupedData = await fetchGroupedAnalyticsData(
        db,
        start,
        end,
        "machine",
        { targetSerials }
      );

      const results = await Promise.all(
        Object.entries(groupedData).map(async ([serial, group]) => {
          const machineSerial = parseInt(serial);
          const { states: rawStates, counts } = group;
      
          if (!rawStates.length && !counts.valid.length) return null;
      
          // Apply bookending for this serial
          const bookended = await getBookendedStatesAndTimeRange(
            db,
            machineSerial,
            start,
            end
          );
      
          if (!bookended) return null;
      
          const { states, sessionStart, sessionEnd } = bookended;
      
          const latest = states.at(-1) || {};
          const statusCode = latest.status?.code || 0;
          const statusName = latest.status?.name || "Unknown";
          const machineName = latest.machine?.name || "Unknown";
      
          const [
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
            currentOperators,
          ] = await Promise.all([
            buildMachinePerformance(states, counts.valid, counts.misfeed, sessionStart, sessionEnd),
            buildMachineItemSummary(states, counts.valid, sessionStart, sessionEnd),
            buildItemHourlyStack(counts.valid, sessionStart, sessionEnd),
            buildFaultData(states, sessionStart, sessionEnd),
            buildOperatorEfficiency(states, counts.valid, sessionStart, sessionEnd, machineSerial),
            buildCurrentOperators(db, machineSerial),
          ]);
      
          return {
            machine: {
              serial: machineSerial,
              name: machineName,
            },
            currentStatus: {
              code: statusCode,
              name: statusName,
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData,
            operatorEfficiency,
            currentOperators,
          };
        })
      );
      
      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  }

  /* -------------------- helpers -------------------- */

  // Clamp standard to PPH
  function normalizePPH(std) {
    const n = Number(std) || 0;
    return n > 0 && n < 60 ? n * 60 : n;
  }

  // Recompute a session's metrics given its counts/misfeeds and timestamps
  function recalcSession(session) {
    const start = new Date(session.timestamps.start);
    const end = new Date(session.timestamps.end || new Date());
    const runtimeMs = Math.max(0, end - start);
    const runtimeSec = runtimeMs / 1000;

    // Active stations = non-dummy operators
    const activeStations = Array.isArray(session.operators)
      ? session.operators.filter((op) => op && op.id !== -1).length
      : 0;

    const workTimeSec = runtimeSec * activeStations;

    const counts = Array.isArray(session.counts) ? session.counts : [];
    const misfeeds = Array.isArray(session.misfeeds) ? session.misfeeds : [];

    const totalCount = counts.length;
    const misfeedCount = misfeeds.length;

    // Calculate total time credit (corrected - count per-item and use per-item standards)
    let totalTimeCredit = 0;

    // 1. Count how many of each item were produced in the truncated window
    const perItemCounts = new Map(); // key: item.id
    for (const c of counts) {
      const id = c.item?.id;
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

    totalTimeCredit = Number(totalTimeCredit.toFixed(2));

    session.runtime = runtimeMs / 1000;
    session.workTime = workTimeSec;
    session.totalCount = totalCount;
    session.misfeedCount = misfeedCount;
    session.totalTimeCredit = totalTimeCredit;
    return session;
  }

  // Truncate a session to [start,end] and recalc
  function truncateAndRecalc(original, newStart, newEnd) {
    // Only clone what we need to modify
    const s = {
      ...original,
      timestamps: { ...original.timestamps },
      counts: [...(original.counts || [])],
      misfeeds: [...(original.misfeeds || [])]
    };

    // Clamp timestamps
    const start = new Date(s.timestamps.start);
    const end = new Date(s.timestamps.end || new Date());

    const clampedStart = start < newStart ? newStart : start;
    const clampedEnd = end > newEnd ? newEnd : end;

    s.timestamps.start = clampedStart;
    s.timestamps.end = clampedEnd;

    // Filter counts/misfeeds to window
    const inWindow = (d) => {
      const ts = new Date(d.timestamp);
      return ts >= clampedStart && ts <= clampedEnd;
    };

    s.counts = s.counts.filter(inWindow);
    s.misfeeds = s.misfeeds.filter(inWindow);

    return recalcSession(s);
  }

  // Build the final response row matching your existing shape
  function formatMachinesSummaryRow({
    machine, status,
    runtimeMs, downtimeMs,
    totalCount, misfeedCount,
    workTimeSec, totalTimeCredit,
    queryStart, queryEnd
  }) {
    const totalMs = Math.max(0, queryEnd - queryStart);
    const availability = totalMs ? Math.min(Math.max(runtimeMs / totalMs, 0), 1) : 0;
    const throughput = (totalCount + misfeedCount) ? totalCount / (totalCount + misfeedCount) : 0;
    const efficiency = workTimeSec > 0 ? totalTimeCredit / workTimeSec : 0;
    const oee = availability * throughput * efficiency;

    return {
      machine: {
        serial: machine?.serial ?? -1,
        name: machine?.name ?? "Unknown"
      },
      currentStatus: {
        code: status?.code ?? 0,
        name: status?.name ?? "Unknown"
      },
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
      timeRange: {
        start: queryStart,
        end: queryEnd
      }
    };
  }

  return router;
};
