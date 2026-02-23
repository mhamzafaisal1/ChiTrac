const express = require('express');

const { formatDuration } = require("../../utils/time");

const { DateTime } = require("luxon");

module.exports = function (server) {
  const router = express.Router();

  // Get logger and db from server object
  const logger = server.logger;
  const db = server.db;
  const config = require('../../modules/config');

  // Import shared helper functions from operatorFunctions.js
  const {
    clamp01,
    normalizePPH,
    recalcOperatorSession,
    truncateAndRecalcOperator,
    mergeIntervals,
    overlapsAny,
    coalesceItems,
    queryOperatorsSummaryDailyCache,
    queryOperatorsSummarySessions,
    combineOperatorsSummaryData,
    buildHybridOperatorsSummary,
  } = require('../../utils/operatorFunctions');

  // Helper function to parse and validate query parameters
  function parseAndValidateQueryParams(req) {
    const { start, end, timeframe } = req.query;

    // If timeframe is provided, calculate start and end from server time
    if (timeframe) {
      const now = new Date();
      let calculatedStart;
      let calculatedEnd = now;

      switch (timeframe) {
        case 'current':
          calculatedStart = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago
          break;
        case 'lastFifteen':
          calculatedStart = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
          break;
        case 'lastHour':
          calculatedStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
          break;
        case 'today':
          calculatedStart = new Date(now);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisWeek':
          calculatedStart = new Date(now);
          const day = calculatedStart.getDay();
          calculatedStart.setDate(calculatedStart.getDate() - day);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisMonth':
          calculatedStart = new Date(now.getFullYear(), now.getMonth(), 1);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        case 'thisYear':
          calculatedStart = new Date(now.getFullYear(), 0, 1);
          calculatedStart.setHours(0, 0, 0, 0);
          break;
        default:
          throw new Error(`Invalid timeframe: ${timeframe}`);
      }

      return {
        start: calculatedStart,
        end: calculatedEnd,
      };
    }

    // Original logic for start/end parameters
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

  // Debug route for operator hybrid query issues
  router.get("/analytics/debug-operators-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      
      // Check operator sessions
      const operatorCount = await db.collection(config.operatorSessionCollectionName)
        .countDocuments({
          "operator.id": { $ne: -1 },
          "timestamps.start": { $gte: exactStart, $lte: exactEnd }
        });
      
      // Check daily cache
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];
      
      const dailyCacheSample = await db.collection('totals-daily')
        .findOne({ entityType: 'operator-machine' });
      
      // Check unique operators
      const uniqueOperators = await db.collection(config.operatorSessionCollectionName)
        .distinct("operator.id", { "operator.id": { $ne: -1 } });
      
      res.json({
        query: { start: exactStart, end: exactEnd },
        operators: {
          countInRange: operatorCount,
          totalUniqueOperators: uniqueOperators.length,
          operatorIds: uniqueOperators.slice(0, 10) // First 10 for debugging
        },
        dailyCache: {
          sampleRecord: dailyCacheSample,
          todayDateStr: dateStr
        },
        sessions: {
          totalCount: await db.collection(config.operatorSessionCollectionName).countDocuments()
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- /api/alpha/analytics/operators-summary-cached ----
  router.get("/analytics/operators-summary-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      // Get today's date string in Chicago timezone (same as cache service)
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];

      logger.info(`[operatorSessions] Fetching cached operators summary for date: ${dateStr}`);

      // Query totals-daily collection for operator-machine records
      const data = await db.collection('totals-daily')
        .find({
          entityType: 'operator-machine',
          date: dateStr
        })
        .toArray();

      if (data.length === 0) {
        logger.warn(`[operatorSessions] No cached data found for date: ${dateStr}, falling back to real-time calculation`);
        // Fallback to real-time calculation
        return await getOperatorsSummaryRealTime(req, res);
      }

      // Get current machine statuses from stateTicker collection
      const stateTickerData = await db.collection('stateTicker')
        .find({})
        .toArray();

      // Create a map of operator ID to their latest ticker context (machine + status)
      const operatorTickerMap = new Map();
      for (const stateRecord of stateTickerData) {
        const machine = stateRecord.machine || {};
        const status = stateRecord.status || {};
        const timestamp = new Date(status.timestamp || stateRecord.timestamp || 0).getTime();

        if (Array.isArray(stateRecord.operators)) {
          for (const op of stateRecord.operators) {
            if (!op || typeof op.id === "undefined" || op.id === null) {
              continue;
            }

            const operatorKey =
              typeof op.id === "string"
                ? Number.parseInt(op.id, 10)
                : op.id;

            if (Number.isNaN(operatorKey)) {
              continue;
            }

            const existing = operatorTickerMap.get(operatorKey);
            if (!existing || existing.timestamp < timestamp) {
              // Status schema uses 'id', but legacy code used 'code' - support both
              const statusId = status?.id ?? status?.code ?? null;
              operatorTickerMap.set(operatorKey, {
                machine: machine.serial
                  ? {
                      serial: machine.serial,
                      name: machine.name || null,
                    }
                  : null,
                status: typeof statusId !== "undefined" && statusId !== null || typeof status.name !== "undefined"
                  ? {
                      code: statusId, // Use 'code' in API response for backward compatibility
                      name: status.name ?? null,
                    }
                  : null,
                timestamp,
              });
            }
          }
        }
      }

      // Group by operator ID and aggregate metrics across machines
      const operatorMap = new Map();

      for (const record of data) {
        const operatorId = record.operatorId;

        if (!operatorMap.has(operatorId)) {
          operatorMap.set(operatorId, {
            operator: {
              id: operatorId,
              name: record.operatorName || `Operator ${operatorId}`
            },
            currentStatus: { code: 0, name: "Offline" }, // Default status
            currentMachine: null,
            metrics: {
              runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              output: { totalCount: 0, misfeedCount: 0 },
              performance: {
                availability: { value: 0, percentage: "0.00" },
                throughput: { value: 0, percentage: "0.00" },
                efficiency: { value: 0, percentage: "0.00" },
                oee: { value: 0, percentage: "0.00" }
              }
            },
            timeRange: record.timeRange || {
              start: new Date(`${dateStr}T06:00:00.000Z`),
              end: chicagoTime
            },
            machines: [],
            totalTimeCreditMs: 0,
            totalWorkedMs: 0
          });
        }

        const operatorData = operatorMap.get(operatorId);

        // Add machine info
        operatorData.machines.push({
          serial: record.machineSerial,
          name: record.machineName
        });

        // Aggregate metrics (convert ms to total)
        operatorData.metrics.runtime.total += (record.runtimeMs || 0);
        operatorData.metrics.downtime.total += (record.pausedTimeMs || 0);
        operatorData.metrics.output.totalCount += (record.totalCounts || 0);
        operatorData.metrics.output.misfeedCount += (record.totalMisfeeds || 0);
        operatorData.totalTimeCreditMs += (record.totalTimeCreditMs || 0);
        operatorData.totalWorkedMs += (record.workedTimeMs || 0);

        // Update time range to use the latest
        if (record.timeRange?.end) {
          const recordEnd = new Date(record.timeRange.end);
          const currentEnd = new Date(operatorData.timeRange.end);
          if (recordEnd > currentEnd) {
            operatorData.timeRange.end = recordEnd;
          }
        }
      }

      // Calculate aggregated performance metrics for each operator
      const results = Array.from(operatorMap.values()).map(operatorData => {
        const { runtime, downtime, output } = operatorData.metrics;

        // Get current status and machine from stateTicker
        const tickerInfo = operatorTickerMap.get(operatorData.operator.id);
        if (tickerInfo) {
          operatorData.currentMachine = tickerInfo.machine;
          operatorData.currentStatus = tickerInfo.status || { code: 0, name: "Offline" };
        }

        // Calculate aggregated performance metrics
        const totalMs = new Date(operatorData.timeRange.end).getTime() -
                       new Date(operatorData.timeRange.start).getTime();
        const availability = totalMs > 0 ? runtime.total / totalMs : 0;
        const throughput = (output.totalCount + output.misfeedCount) > 0 ?
          output.totalCount / (output.totalCount + output.misfeedCount) : 0;

        // Efficiency = time credit / worked time
        const efficiency = operatorData.totalWorkedMs > 0 ?
          (operatorData.totalTimeCreditMs / operatorData.totalWorkedMs) : 0;

        const oee = availability * throughput * efficiency;

        // Update formatted runtime and downtime
        operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
        operatorData.metrics.downtime.formatted = formatDuration(downtime.total);

        // Update performance metrics
        operatorData.metrics.performance = {
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
        };

        // Remove temporary fields from final output
        delete operatorData.machines;
        delete operatorData.totalTimeCreditMs;
        delete operatorData.totalWorkedMs;

        return operatorData;
      });

      logger.info(`[operatorSessions] Retrieved ${results.length} cached operator records for date: ${dateStr}`);
      res.json(results);

    } catch (err) {
      logger.error(`[operatorSessions] Error in cached operators-summary route:`, err);

      // Check if it's a validation error
      if (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date')) {
        return res.status(400).json({ error: err.message });
      }

      // Fallback to real-time calculation on any error
      logger.info(`[operatorSessions] Falling back to real-time calculation due to error`);
      return await getOperatorsSummaryRealTime(req, res);
    }
  });

  // ---- /api/alpha/analytics/operators-summary-daily-cached ----
  router.get("/analytics/operators-summary-daily-cached", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId ? parseInt(req.query.operatorId) : null;
      
      // Get today's date string in Chicago timezone
      const today = new Date();
      const chicagoTime = new Date(today.toLocaleString("en-US", {timeZone: "America/Chicago"}));
      const dateStr = chicagoTime.toISOString().split('T')[0];
      
      logger.info(`[operatorSessions] Fetching daily cached operators summary for date: ${dateStr}, operatorId: ${operatorId || 'all'}`);
      
      // Build query filter for totals-daily collection
      const filter = { 
        entityType: 'operator-machine',
        date: dateStr
      };
      
      // Add operator filter if specified
      if (operatorId && !Number.isNaN(operatorId)) {
        filter.operatorId = operatorId;
      }
      
      // Query the totals-daily collection
      const cacheRecords = await db.collection('totals-daily')
        .find(filter)
        .toArray();
      
      if (cacheRecords.length === 0) {
        logger.warn(`[operatorSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`);
        // Fallback to real-time calculation
        return await getOperatorsSummaryRealTime(req, res);
      }
      
      // Get unique machine serials from cache records
      const machineSerials = [
        ...new Set(
          cacheRecords
            .map(r => r.machineSerial)
            .filter(serial => serial !== null && serial !== undefined)
        )
      ];
      
      // Get current machine statuses from stateTicker collection
      // Use same approach as operators-summary-cached: get all stateTicker records
      // This avoids complex query issues and is more reliable across environments
      const stateTickerData = await db.collection("stateTicker")
        .find({})
        .toArray();

      // Build a map of latest ticker context per operator
      const operatorTickerMap = new Map();
      for (const stateRecord of stateTickerData) {
        const machine = stateRecord.machine || {};
        const status = stateRecord.status || {};
        const timestamp = new Date(
          status.timestamp ||
            stateRecord.timestamp ||
            (stateRecord.timestamps &&
              (stateRecord.timestamps.update ||
                stateRecord.timestamps.active ||
                stateRecord.timestamps.create)) ||
            0
        ).getTime();

        if (Array.isArray(stateRecord.operators)) {
          for (const op of stateRecord.operators) {
            if (!op || typeof op.id === "undefined" || op.id === null) {
              continue;
            }

            const operatorKey =
              typeof op.id === "string" ? Number.parseInt(op.id, 10) : op.id;

            if (Number.isNaN(operatorKey)) {
              continue;
            }

            const existing = operatorTickerMap.get(operatorKey);
            if (!existing || existing.timestamp < timestamp) {
              const serial =
                machine.serial ?? machine.id ?? machine.serialNumber ?? null;
              // Status schema uses 'id', but legacy code used 'code' - support both
              const statusId = status?.id ?? status?.code ?? null;
              operatorTickerMap.set(operatorKey, {
                machine:
                  serial !== null && serial !== undefined
                    ? {
                        serial,
                        name: machine.name || null
                      }
                    : null,
                status:
                  typeof statusId !== "undefined" && statusId !== null ||
                  typeof status.name !== "undefined"
                    ? {
                        code: statusId, // Use 'code' in API response for backward compatibility
                        name: status.name ?? null
                      }
                    : null,
                timestamp
              });
            }
          }
        }
      }

      // Group by operator ID and aggregate metrics across machines
      const operatorMap = new Map();

      for (const record of cacheRecords) {
        const opId = record.operatorId;
        
        if (!operatorMap.has(opId)) {
          // Format operator name from object (first + surname) or use string if already formatted
          const operatorNameStr = typeof record.operatorName === 'object' && record.operatorName !== null
            ? `${record.operatorName.first || ''} ${record.operatorName.surname || ''}`.trim() || "Unknown"
            : record.operatorName || "Unknown";
          
          operatorMap.set(opId, {
            operator: {
              id: record.operatorId,
              name: operatorNameStr
            },
            currentStatus: null,
            currentMachine: null,
            metrics: {
              runtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              downtime: { total: 0, formatted: { hours: 0, minutes: 0 } },
              output: { totalCount: 0, misfeedCount: 0 },
              performance: {
                availability: { value: 0, percentage: "0.00" },
                throughput: { value: 0, percentage: "0.00" },
                efficiency: { value: 0, percentage: "0.00" },
                oee: { value: 0, percentage: "0.00" }
              }
            },
            timeRange: record.timeRange,
            machines: [],
            efficiencyData: [] // Track efficiency per machine for weighted average
          });
        }
        
        const operatorData = operatorMap.get(opId);
        
        // Track machines seen in cache (for potential debugging)
        operatorData.machines.push({
          serial: record.machineSerial,
          name: record.machineName
        });

        // Update current context from stateTicker (latest wins)
        const tickerContext = operatorTickerMap.get(opId);
        if (tickerContext) {
          operatorData.currentMachine = tickerContext.machine;
          operatorData.currentStatus = tickerContext.status;
        } else {
          operatorData.currentMachine = null;
          operatorData.currentStatus = null;
        }
        
        // Aggregate metrics
        const downtimeMs = (record.pausedTimeMs || 0) + (record.faultTimeMs || 0);
        operatorData.metrics.runtime.total += record.runtimeMs;
        operatorData.metrics.downtime.total += downtimeMs;
        operatorData.metrics.output.totalCount += record.totalCounts;
        operatorData.metrics.output.misfeedCount += record.totalMisfeeds;
        
        // Track efficiency data for weighted average
        const workTimeSec = record.workedTimeMs / 1000;
        const timeCreditSec = record.totalTimeCreditMs / 1000;
        const efficiency = workTimeSec > 0 ? timeCreditSec / workTimeSec : 0;
        
        operatorData.efficiencyData.push({
          efficiency: efficiency,
          weight: record.workedTimeMs // Use worked time as weight
        });
      }
      
      // Calculate aggregated performance metrics for each operator
      const results = Array.from(operatorMap.values()).map(operatorData => {
        const { runtime, downtime, output } = operatorData.metrics;
        
        // Calculate window time from timeRange with fallback
        let windowMs = 0;
        if (operatorData.timeRange && operatorData.timeRange.start && operatorData.timeRange.end) {
          try {
            const startDate = new Date(operatorData.timeRange.start);
            const endDate = new Date(operatorData.timeRange.end);
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate > startDate) {
              windowMs = endDate.getTime() - startDate.getTime();
            }
          } catch (e) {
            logger.warn(`[operatorSessions] Invalid timeRange for operator ${operatorData.operator.id}:`, e);
          }
        }
        
        // Fallback to default time range if windowMs is invalid
        if (windowMs <= 0) {
          const defaultStart = new Date(`${dateStr}T06:00:00.000Z`);
          windowMs = Math.max(0, chicagoTime.getTime() - defaultStart.getTime());
        }
        
        // Calculate aggregated performance metrics
        const availability = windowMs > 0 ? runtime.total / windowMs : 0;
        const throughput = (output.totalCount + output.misfeedCount) > 0 ? 
          output.totalCount / (output.totalCount + output.misfeedCount) : 0;
        
        // Calculate weighted average efficiency
        let totalWeightedEfficiency = 0;
        let totalWeight = 0;
        
        for (const effData of operatorData.efficiencyData) {
          totalWeightedEfficiency += effData.efficiency * effData.weight;
          totalWeight += effData.weight;
        }
        
        const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
        const oee = availability * throughput * efficiency;
        
        // Update formatted times
        operatorData.metrics.runtime.formatted = formatDuration(runtime.total);
        operatorData.metrics.downtime.formatted = formatDuration(downtime.total);
        
        // Update performance metrics
        operatorData.metrics.performance = {
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
        };
        
        // Clean up temporary data
        delete operatorData.machines;
        delete operatorData.efficiencyData;

        return operatorData;
      });

      // ✅ FIX: Filter out "phantom operators" - operators who worked earlier but are no longer assigned
      // Only show operators who meet ALL of these criteria:
      // 1. Have actual runtime (> 0), AND
      // 2. Have actual production (totalCount > 0), AND
      // 3. Either currently assigned to a machine OR worked for at least 1 hour
      const MIN_RUNTIME_TO_SHOW_MS = 3600000; // 1 hour
      const filteredResults = results.filter(operatorData => {
        const hasRuntime = operatorData.metrics.runtime.total > 0;
        const hasProduction = operatorData.metrics.output.totalCount > 0;
        const hasCurrentMachine = operatorData.currentMachine !== null;
        const hasSignificantRuntime = operatorData.metrics.runtime.total >= MIN_RUNTIME_TO_SHOW_MS;

        // Must have actual work (runtime AND production)
        // AND either currently assigned OR significant history
        return hasRuntime && hasProduction && (hasCurrentMachine || hasSignificantRuntime);
      });

      logger.info(`[operatorSessions] Retrieved ${results.length} daily cached operator records (${filteredResults.length} after filtering phantoms) for date: ${dateStr}`);
      res.json(filteredResults);
      
    } catch (err) {
      logger.error(`[operatorSessions] Error in daily cached operators-summary route:`, err);
      
      // Check if it's a validation error
      if (err.message.includes('Start and end dates are required') ||
        err.message.includes('Invalid date format') ||
        err.message.includes('Start date must be before end date')) {
        return res.status(400).json({ error: err.message });
      }
      
      // Fallback to real-time calculation on any error
      logger.info(`[operatorSessions] Falling back to real-time calculation due to error`);
      return await getOperatorsSummaryRealTime(req, res);
    }
  });

  // ---- /api/alpha/analytics/operators-summary (real-time calculation) ----
  router.get("/analytics/operators-summary", async (req, res) => {
    return await getOperatorsSummaryRealTime(req, res);
  });

  // ---- /api/alpha/analytics/operators-summary-hybrid ----
  router.get("/analytics/operators-summary-hybrid", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);
      
      // Configurable threshold for hybrid approach (36 hours)
      const HYBRID_THRESHOLD_HOURS = 36;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);
      
      // If time range is less than threshold, use original route
      if (timeRangeHours <= HYBRID_THRESHOLD_HOURS) {
        return res.status(400).json({
          error: "Time range too short for hybrid approach",
          message: `Use /analytics/operators-summary-cached for time ranges ≤ ${HYBRID_THRESHOLD_HOURS} hours`,
          currentHours: Math.round(timeRangeHours * 100) / 100,
          thresholdHours: HYBRID_THRESHOLD_HOURS
        });
      }

      // Import required modules
      const { SYSTEM_TIMEZONE } = require('../../utils/time');

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
      const dailyRecords = await queryOperatorsSummaryDailyCache(db, completeDays);
      logger.info(`[operatorSessions] Daily cache query returned ${dailyRecords.length} records`);

      // Query sessions for partial days
      const sessionData = await queryOperatorsSummarySessions(db, logger, partialDays);
      logger.info(`[operatorSessions] Session query returned ${sessionData.length} records`);

      // Combine the data
      const combinedData = combineOperatorsSummaryData(dailyRecords, sessionData);
      logger.info(`[operatorSessions] Combined data has ${combinedData.size} operators`);

      // Get current machine statuses from stateTicker collection
      const stateTickerData = await db.collection('stateTicker')
        .find({})
        .toArray();

      // Create a map of machine serial to current status
      const machineStatusMap = new Map();
      for (const stateRecord of stateTickerData) {
        // Status schema uses 'id', but legacy code used 'code' - support both
        const statusId = stateRecord.status?.id ?? stateRecord.status?.code ?? 0;
        machineStatusMap.set(stateRecord.machine.serial, {
          code: statusId, // Use 'code' in API response for backward compatibility
          name: stateRecord.status?.name ?? "Unknown",
          softrolColor: stateRecord.status?.softrolColor,
          timestamp: stateRecord.status?.timestamp
        });
      }
      
      // Build final results
      const results = [];
      for (const [operatorId, data] of combinedData) {
        const result = {
          operator: {
            id: operatorId,
            name: data.operatorName
          },
          currentMachine: data.currentMachine,
          currentStatus: data.currentStatus,
          metrics: {
            runtime: {
              total: data.runtimeMs,
              formatted: formatDuration(data.runtimeMs)
            },
            downtime: {
              total: data.downtimeMs,
              formatted: formatDuration(data.downtimeMs)
            },
            output: {
              totalCount: data.totalCount,
              misfeedCount: data.misfeedCount
            },
            performance: {
              availability: {
                value: data.availability,
                percentage: (data.availability * 100).toFixed(2)
              },
              throughput: {
                value: data.throughput,
                percentage: (data.throughput * 100).toFixed(2)
              },
              efficiency: {
                value: data.efficiency,
                percentage: (data.efficiency * 100).toFixed(2)
              },
              oee: {
                value: data.oee,
                percentage: (data.oee * 100).toFixed(2)
              }
            }
          },
          timeRange: {
            start: exactStart,
            end: exactEnd
          },
          metadata: {
            optimization: {
              used: true,
              approach: 'hybrid',
              thresholdHours: HYBRID_THRESHOLD_HOURS,
              timeRangeHours: Math.round(timeRangeHours * 100) / 100,
              completeDays: completeDays.length,
              partialDays: partialDays.length,
              dailyRecords: dailyRecords.filter(r => r.operatorId === operatorId).length,
              sessionRecords: sessionData.filter(s => s.operatorId === operatorId).length
            }
          }
        };
        
        results.push(result);
      }

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
      logger.error("Error in operators-summary-hybrid:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });

  // New route: /analytics/operator-summary-timeframe
  router.get("/analytics/operator-summary-timeframe", async (req, res) => {
    try {
      const { timeframe } = req.query;

      if (!timeframe) {
        return res
          .status(400)
          .json({ error: "timeframe query parameter is required" });
      }

      const shortTimeframes = new Set(["current", "lastFifteen", "lastHour"]);
      const extendedTimeframes = new Set([
        "today",
        "thisWeek",
        "thisMonth",
        "thisYear",
      ]);

      if (shortTimeframes.has(timeframe)) {
        return await getOperatorsSummaryRealTime(req, res);
      }

      if (!extendedTimeframes.has(timeframe)) {
        return res
          .status(400)
          .json({ error: `Unsupported timeframe: ${timeframe}` });
      }

      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const { results } = await buildHybridOperatorsSummary(
        db,
        logger,
        exactStart,
        exactEnd
      );

      if (!results.length) {
        logger.warn(
          `[operatorSessions] No data for timeframe ${timeframe}, falling back to real-time calculation`
        );
        return await getOperatorsSummaryRealTime(req, res);
      }

      res.json(results);
    } catch (err) {
      logger.error(
        `[operatorSessions] Error in operator-summary-timeframe: `,
        err
      );

      if (
        err.message?.includes("Start and end dates are required") ||
        err.message?.includes("Invalid date format") ||
        err.message?.includes("Start date must be before end date") ||
        err.message?.includes("Invalid timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }

      res
        .status(500)
        .json({ error: "Failed to build operator summary for timeframe" });
    }
  });

  // Helper function for real-time calculation (extracted from original route)
  async function getOperatorsSummaryRealTime(req, res) {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      // Use parsed dates directly, but handle timezone conversion if start/end are provided as ISO strings
      const queryStart = req.query.start && !req.query.timeframe
        ? new Date(DateTime.fromISO(req.query.start).toISO())
        : new Date(start);
      let queryEnd = req.query.end && !req.query.timeframe
        ? new Date(DateTime.fromISO(req.query.end).toISO())
        : new Date(end);
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
              // Status schema uses 'id', but legacy code used 'code' - support both
              const statusId = statusSource?.status?.id ?? statusSource?.status?.code ?? 0;
              currentStatus = {
                code: statusId, // Use 'code' in API response for backward compatibility
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
                sessions[0] = truncateAndRecalcOperator(first, queryStart, first.timestamps?.end ? new Date(first.timestamps.end) : queryEnd, logger);
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
                  effectiveEnd,
                  logger
                );
              }
            }

            // Aggregate
            let runtimeMs = 0;
            let workTimeSec = 0;      // operator-level work time == runtimeSec
            let totalCount = 0;
            let misfeedCount = 0;
            let totalTimeCredit = 0;

            // Fetch counts directly from count collection for this operator within the time window
            const allCounts = await db
              .collection("count")
              .find({
                "operator.id": opId,
                "timestamps.create": { $gte: queryStart, $lte: queryEnd },
              })
              .toArray();

            // Separate valid counts from misfeeds
            const validCounts = allCounts.filter(c => !c.misfeed);
            const misfeedCounts = allCounts.filter(c => c.misfeed);

            totalCount = validCounts.length;
            misfeedCount = misfeedCounts.length;

            // Calculate runtime from sessions (clamped to query window)
            for (const s of sessions) {
              // Calculate runtime for this session (clamped to query window)
              const sessionStart = new Date(s.timestamps?.start);
              const sessionEnd = s.timestamps?.end ? new Date(s.timestamps.end) : queryEnd;
              const clampedStart = sessionStart < queryStart ? queryStart : sessionStart;
              const clampedEnd = sessionEnd > queryEnd ? queryEnd : sessionEnd;
              const sessionRuntimeMs = Math.max(0, clampedEnd - clampedStart);

              runtimeMs += sessionRuntimeMs;
            }

            // For operators, work time == runtime
            workTimeSec = runtimeMs / 1000;

            // Calculate time credit based on filtered counts and item standards
            const perItemCounts = new Map();

            for (const c of validCounts) {
              const id = c.item?.id;
              if (id != null) {
                perItemCounts.set(id, (perItemCounts.get(id) || 0) + 1);
              }
            }

            // Get items from the first session that has them
            let items = [];
            for (const s of sessions) {
              const sessionItems = s.program?.items || s.states?.start?.program?.items || [];
              if (sessionItems.length > 0) {
                items = sessionItems;
                break;
              }
            }

            for (const [id, cnt] of perItemCounts) {
              const item = items.find((it) => it && it.id === id);
              if (item && item.standard) {
                const pph = normalizePPH(item.standard);
                if (pph > 0) {
                  totalTimeCredit += cnt / (pph / 3600); // seconds
                }
              }
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
  }

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
          $project: {
            machine: 1,
            timestamps: 1,
            totalCount: 1,
            misfeedCount: 1,
            totalTimeCredit: 1,
            runtime: 1,
            items: 1,
            item: 1,
            totalCountByItem: 1,
            timeCreditByItem: 1,
          },
        },
        {
          $set: {
            _ovStart: { $max: ['$timestamps.start', startDate] },
            _ovEnd: {
              $min: [
                { $ifNull: ['$timestamps.end', endDate] },
                endDate,
              ],
            },
          },
        },
        { $match: { $expr: { $lt: ['$_ovStart', '$_ovEnd'] } } },
        // Normalize items: handle both items (array) and item (single object) formats
        // Also ensure totalCountByItem and timeCreditByItem are arrays
        {
          $addFields: {
            _items: {
              $cond: {
                if: { $isArray: '$items' },
                then: '$items',
                else: {
                  $cond: {
                    if: { $ne: ['$item', null] },
                    then: ['$item'],
                    else: []
                  }
                }
              }
            },
            _totalCountByItem: {
              $cond: {
                if: { $isArray: '$totalCountByItem' },
                then: '$totalCountByItem',
                else: []
              }
            },
            _timeCreditByItem: {
              $cond: {
                if: { $isArray: '$timeCreditByItem' },
                then: '$timeCreditByItem',
                else: []
              }
            },
          },
        },
        // Pair items with per-item arrays using normalized fields (_items[i] ~ _totalCountByItem[i] ~ _timeCreditByItem[i]).
        // If lengths can differ in production, add debug sampling to detect and consider pairing by item id instead of index.
        {
          $set: {
            _itemsPaired: {
              $map: {
                input: { $range: [0, { $size: '$_items' }] },
                as: 'i',
                in: {
                  $let: {
                    vars: {
                      it: { $arrayElemAt: ['$_items', '$$i'] },
                      cnt: { $arrayElemAt: ['$_totalCountByItem', '$$i'] },
                      tci: { $arrayElemAt: ['$_timeCreditByItem', '$$i'] },
                    },
                    in: {
                      id: '$$it.id',
                      name: '$$it.name',
                      standard: '$$it.standard',
                      count: { $ifNull: ['$$cnt', 0] },
                      tci: { $ifNull: ['$$tci', 0] },
                    },
                  },
                },
              },
            },
          },
        },
        // Two branches: totals (no unwind) and items (unwind early, group by machine+item then machine)
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: { serial: '$machine.serial', name: '$machine.name' },
                  sessions: { $sum: 1 },
                  totalCount: { $sum: { $ifNull: ['$totalCount', 0] } },
                  totalMisfeed: { $sum: { $ifNull: ['$misfeedCount', 0] } },
                  totalTimeCredit: { $sum: { $ifNull: ['$totalTimeCredit', 0] } },
                  runtime: { $sum: { $ifNull: ['$runtime', 0] } },
                  intervals: { $push: { start: '$_ovStart', end: '$_ovEnd' } },
                },
              },
              { $sort: { '_id.serial': 1 } },
            ],
            items: [
              { $unwind: { path: '$_itemsPaired', preserveNullAndEmptyArrays: true } },
              {
                $group: {
                  _id: {
                    serial: '$machine.serial',
                    name: '$machine.name',
                    itemId: '$_itemsPaired.id',
                    itemName: '$_itemsPaired.name',
                    itemStd: '$_itemsPaired.standard',
                  },
                  sessionIds: { $addToSet: '$_id' },
                  itemCount: { $sum: { $ifNull: ['$_itemsPaired.count', 0] } },
                  itemTCI: { $sum: { $ifNull: ['$_itemsPaired.tci', 0] } },
                },
              },
              {
                $group: {
                  _id: { serial: '$_id.serial', name: '$_id.name' },
                  items: {
                    $push: {
                      id: '$_id.itemId',
                      name: '$_id.itemName',
                      standard: '$_id.itemStd',
                      totalCount: '$itemCount',
                      totalTimeCredit: '$itemTCI',
                    },
                  },
                  allSessionIds: { $push: '$sessionIds' },
                },
              },
              {
                $set: {
                  sessions: {
                    $size: {
                      $reduce: {
                        input: '$allSessionIds',
                        initialValue: [],
                        in: { $setUnion: ['$$value', '$$this'] },
                      },
                    },
                  },
                  items: {
                    $filter: {
                      input: '$items',
                      as: 'it',
                      cond: { $ne: ['$$it.id', null] },
                    },
                  },
                },
              },
              { $project: { allSessionIds: 0 } },
              { $sort: { '_id.serial': 1 } },
            ],
          },
        },
      ]).toArray();

      // $facet returns one doc { totals: [...], items: [...] }; merge by machine serial
      const facetResult = (sessionsAgg && sessionsAgg[0]) || { totals: [], items: [] };
      const totalsBySerial = new Map((facetResult.totals || []).map((t) => [t._id.serial, t]));
      const itemsBySerial = new Map((facetResult.items || []).map((i) => [i._id.serial, i]));
      const serials = [...new Set([...totalsBySerial.keys(), ...itemsBySerial.keys()])].sort((a, b) => (a == null ? 1 : b == null ? -1 : a - b));
      const sessionsAggMerged = serials.map((serial) => {
        const t = totalsBySerial.get(serial);
        const i = itemsBySerial.get(serial);
        if (!t) {
          return {
            _id: { serial, name: (i && i._id) ? i._id.name : `Serial ${serial}` },
            sessions: (i && i.sessions) != null ? i.sessions : 0,
            totals: { totalCount: 0, totalMisfeed: 0, totalTimeCredit: 0, runtime: 0 },
            intervals: [],
            items: (i && i.items) ? i.items : [],
          };
        }
        return {
          _id: { serial: t._id.serial, name: t._id.name },
          sessions: t.sessions,
          totals: {
            totalCount: t.totalCount,
            totalMisfeed: t.totalMisfeed,
            totalTimeCredit: t.totalTimeCredit,
            runtime: t.runtime,
          },
          intervals: t.intervals ?? [],
          items: (i && i.items) ? i.items : [],
        };
      });

      if (!sessionsAggMerged.length) {
        return res.json({ context: { operatorId, start: startDate, end: endDate }, machines: [] });
      }

      // Fetch all fault-sessions for this operator in the window once, grouped by machine serial
      const faultsByMachine = await db
        .collection(config.faultSessionCollectionName)
        .aggregate([
          {
            $match: {
              'operators.id': operatorId,
              'timestamps.start': { $lte: endDate },
              $or: [
                { 'timestamps.end': { $exists: false } },
                { 'timestamps.end': { $gte: startDate } },
              ],
            },
          },
          {
            $project: {
              serial: '$machine.serial',
              s: '$timestamps.start',
              e: { $ifNull: ['$timestamps.end', endDate] },
            },
          },
          {
            $group: {
              _id: '$serial',
              faults: { $push: { s: '$s', e: '$e' } },
            },
          },
        ])
        .toArray();

      const faultMap = new Map(faultsByMachine.map((x) => [x._id, x.faults]));

      // Compute overlaps in memory per machine (no extra DB calls)
      const results = sessionsAggMerged.map((m) => {
        const serial = m._id.serial;
        const merged = mergeIntervals(m.intervals.map((iv) => ({ s: iv.start, e: iv.end })));
        const faults = faultMap.get(serial) ?? [];
        let faultsWhileRunning = 0;
        for (const f of faults) {
          if (overlapsAny(f, merged)) faultsWhileRunning += 1;
        }
        return {
          machine: { serial, name: m._id.name },
          sessions: m.sessions,
          faultsWhileRunning,
          totals: m.totals,
          items: coalesceItems(m.items),
        };
      });

      return res.json({
        context: { operatorId, start: startDate, end: endDate },
        machines: results,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      return res.status(500).json({ error: 'Failed to build operator machine summary' });
    }
  });

  return router;
};