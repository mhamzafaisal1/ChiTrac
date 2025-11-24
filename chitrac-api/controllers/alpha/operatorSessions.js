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
      
      // Query the operator-cache-today collection directly
      const data = await db.collection('operator-cache-today')
        .find({ 
          date: dateStr,
          _id: { $ne: 'metadata' }
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
      
      // Create a map of operator ID to their latest ticker context
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
              operatorTickerMap.set(operatorKey, {
                machine: machine.serial
                  ? {
                      serial: machine.serial,
                      name: machine.name || null,
                    }
                  : null,
                status: typeof status.code !== "undefined" || typeof status.name !== "undefined"
                  ? {
                      code: status.code ?? null,
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
        const operatorId = record.operator.id;
        
        if (!operatorMap.has(operatorId)) {
          operatorMap.set(operatorId, {
            operator: record.operator,
            currentStatus: { code: 1, name: "Running" }, // Default status
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
            machines: []
          });
        }
        
        const operatorData = operatorMap.get(operatorId);
        
        // Add machine info
        operatorData.machines.push({
          serial: record.machine.serial,
          name: record.machine.name
        });
        
        // Set current machine to the most recent one (last in the list)
        operatorData.currentMachine = {
          serial: record.machine.serial,
          name: record.machine.name
        };
        
        // Get current status from stateTicker for this machine
        const currentMachineStatus = machineStatusMap.get(record.machine.serial);
        if (currentMachineStatus) {
          operatorData.currentStatus = {
            code: currentMachineStatus.code,
            name: currentMachineStatus.name
          };
        }
        
        // Aggregate metrics
        operatorData.metrics.runtime.total += record.metrics.runtime.total;
        operatorData.metrics.downtime.total += record.metrics.downtime.total;
        operatorData.metrics.output.totalCount += record.metrics.output.totalCount;
        operatorData.metrics.output.misfeedCount += record.metrics.output.misfeedCount;
      }
      
      // Calculate aggregated performance metrics for each operator
      const results = Array.from(operatorMap.values()).map(operatorData => {
        const { runtime, downtime, output } = operatorData.metrics;
        
        // Calculate aggregated performance metrics
        const totalMs = operatorData.timeRange.end - operatorData.timeRange.start;
        const availability = totalMs > 0 ? runtime.total / totalMs : 0;
        const throughput = (output.totalCount + output.misfeedCount) > 0 ? 
          output.totalCount / (output.totalCount + output.misfeedCount) : 0;
        
        // For efficiency, we'll use a weighted average based on runtime
        let totalWeightedEfficiency = 0;
        let totalWeight = 0;
        
        for (const record of data) {
          if (record.operator.id === operatorData.operator.id) {
            const weight = record.metrics.runtime.total;
            totalWeightedEfficiency += record.metrics.performance.efficiency.value * weight;
            totalWeight += weight;
          }
        }
        
        const efficiency = totalWeight > 0 ? totalWeightedEfficiency / totalWeight : 0;
        const oee = availability * throughput * efficiency;
        
        // Update formatted runtime
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
        
        // Remove machines array from final output
        delete operatorData.machines;
        
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
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
      
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
      if (operatorId) {
        filter.operatorId = parseInt(operatorId);
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
      const tickerSerialFilter = [
        ...new Set([
          ...machineSerials,
          ...machineSerials.map(serial => serial.toString())
        ])
      ];
      
      // Get current machine statuses from stateTicker collection
      // Build stateTicker query - support serial stored in different fields/types
      const tickerQuery =
        tickerSerialFilter.length > 0
          ? {
              $or: [
                { "machine.serial": { $in: tickerSerialFilter } },
                { "machine.id": { $in: tickerSerialFilter } },
                {
                  "machine.serial": {
                    $in: tickerSerialFilter
                      .map(Number)
                      .filter(n => !Number.isNaN(n))
                  }
                },
                {
                  "machine.id": {
                    $in: tickerSerialFilter
                      .map(Number)
                      .filter(n => !Number.isNaN(n))
                  }
                }
              ]
            }
          : {};

      // Get current machine statuses from stateTicker collection
      const stateTickerData = await db.collection("stateTicker")
        .find(tickerQuery)
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
              operatorTickerMap.set(operatorKey, {
                machine:
                  serial !== null && serial !== undefined
                    ? {
                        serial,
                        name: machine.name || null
                      }
                    : null,
                status:
                  typeof status.code !== "undefined" ||
                  typeof status.name !== "undefined"
                    ? {
                        code: status.code ?? null,
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
          operatorMap.set(opId, {
            operator: {
              id: record.operatorId,
              name: record.operatorName
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
        const downtimeMs = record.pausedTimeMs + record.faultTimeMs;
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
        
        // Calculate window time from timeRange
        const windowMs = new Date(operatorData.timeRange.end) - new Date(operatorData.timeRange.start);
        
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
      const dailyRecords = await queryOperatorsSummaryDailyCache(completeDays);
      logger.info(`[operatorSessions] Daily cache query returned ${dailyRecords.length} records`);
      
      // Query sessions for partial days
      const sessionData = await queryOperatorsSummarySessions(partialDays);
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
        machineStatusMap.set(stateRecord.machine.serial, {
          code: stateRecord.status.code,
          name: stateRecord.status.name,
          softrolColor: stateRecord.status.softrolColor,
          timestamp: stateRecord.status.timestamp
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

  // Helper function to build hybrid operators summary
  async function buildHybridOperatorsSummary(exactStart, exactEnd) {
    const { SYSTEM_TIMEZONE } = require('../../utils/time');
    const HYBRID_THRESHOLD_HOURS = 36; // Configurable threshold
    const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

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
    const nextDayStart = startOfFirstDay.plus({ days: 1 }).toJSDate();
    if (exactStart < nextDayStart) {
      const partialEnd = exactEnd < nextDayStart ? exactEnd : nextDayStart;
      if (partialEnd > exactStart) {
        partialDays.push({
          start: exactStart,
          end: partialEnd,
          type: 'start'
        });
      }
    }
    
    const previousDayEnd = endOfLastDay.minus({ days: 1 }).toJSDate();
    if (exactEnd > previousDayEnd) {
      const partialStart = exactStart > previousDayEnd ? exactStart : previousDayEnd;
      if (exactEnd > partialStart) {
        partialDays.push({
          start: partialStart,
          end: exactEnd,
          type: 'end'
        });
      }
    }

    // Remove duplicate partial days if they overlap
    if (partialDays.length === 2 &&
        partialDays[0].start.getTime() === partialDays[1].start.getTime() &&
        partialDays[0].end.getTime() === partialDays[1].end.getTime()) {
      partialDays.splice(1, 1);
    }

    // Query daily cache for complete days
    const dailyRecords = await queryOperatorsSummaryDailyCache(completeDays);
    logger.info(`[operatorSessions] Daily cache query returned ${dailyRecords.length} records`);
    
    // Query sessions for partial days
    const sessionData = await queryOperatorsSummarySessions(partialDays);
    logger.info(`[operatorSessions] Session query returned ${sessionData.length} records`);
    
    // Combine the data
    const combinedData = combineOperatorsSummaryData(dailyRecords, sessionData);
    logger.info(`[operatorSessions] Combined data has ${combinedData.size} operators`);
    
    // Get current machine statuses from stateTicker collection
    const stateTickerData = await db.collection('stateTicker')
      .find({})
      .toArray();
    
    // Build operator ticker map (latest machine/status per operator)
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
            operatorTickerMap.set(operatorKey, {
              machine:
                serial !== null && serial !== undefined
                  ? {
                      serial,
                      name: machine.name || null
                    }
                  : null,
              status:
                typeof status.code !== "undefined" ||
                typeof status.name !== "undefined"
                  ? {
                      code: status.code ?? null,
                      name: status.name ?? null
                    }
                  : null,
              timestamp
            });
          }
        }
      }
    }
    
    // Build final results
    const results = [];
    for (const [operatorId, data] of combinedData) {
      // Get current machine and status from ticker map
      const tickerContext = operatorTickerMap.get(operatorId);
      const currentMachine = tickerContext?.machine || data.currentMachine || null;
      const currentStatus = tickerContext?.status || data.currentStatus || { code: 0, name: "Unknown" };
      
      const result = {
        operator: {
          id: operatorId,
          name: data.operatorName
        },
        currentMachine,
        currentStatus,
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
        }
      };
      
      results.push(result);
    }

    const metadata = {
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
    };

    return { results, metadata };
  }

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

  // Helper function to query operators summary daily cache
  async function queryOperatorsSummaryDailyCache(completeDays) {
    if (completeDays.length === 0) return [];
    
    const cacheCollection = db.collection('totals-daily');
    
    // Try multiple date formats to handle timezone variations
    const dateFormats = completeDays.flatMap(day => {
      const dateStr = day.dateStr;
      return [
        new Date(dateStr + 'T00:00:00.000Z'), // UTC midnight
        new Date(dateStr + 'T05:00:00.000Z'), // CST midnight (UTC+5)
        new Date(dateStr + 'T06:00:00.000Z'), // CDT midnight (UTC+6)
        dateStr, // String format
        new Date(dateStr) // Local timezone
      ];
    });
    
    const records = await cacheCollection.find({
      entityType: 'operator-machine',
      $or: [
        { dateObj: { $in: dateFormats } },
        { date: { $in: completeDays.map(d => d.dateStr) } }
      ]
    }).toArray();
    
    return records;
  }

  // Helper function to query operators summary sessions for partial days
  async function queryOperatorsSummarySessions(partialDays) {
    if (partialDays.length === 0) return [];
    
    const results = [];
    
    for (const partialDay of partialDays) {
      const collName = config.operatorSessionCollectionName;
      const coll = db.collection(collName);

      // Find operators that have at least one overlapping operator-session
      // Use proper overlap logic: session starts before window ends AND session ends after window starts
      const operatorIds = await coll.distinct("operator.id", {
        "operator.id": { $ne: -1 },
        "timestamps.start": { $lt: partialDay.end },
        $or: [
          { "timestamps.end": { $gt: partialDay.start } },
          { "timestamps.end": { $exists: false } } // Handle open sessions
        ]
      });

      if (!operatorIds.length) continue;

      logger.info(`[operatorSessions] Found ${operatorIds.length} operators for partial day:`, operatorIds);

      for (const opId of operatorIds) {
        try {
          // Pull all overlapping sessions for this operator
          // Use proper overlap logic: session starts before window ends AND session ends after window starts
          const sessions = await coll.find({
            "operator.id": opId,
            "timestamps.start": { $lt: partialDay.end },
            $or: [
              { "timestamps.end": { $gt: partialDay.start } },
              { "timestamps.end": { $exists: false } } // Handle open sessions
            ]
          })
            .sort({ "timestamps.start": 1 })
            .toArray();

          if (!sessions.length) continue;

          const mostRecent = sessions[sessions.length - 1];
          let currentMachine = {};
          let currentStatus = {};

          if (mostRecent.endState) {
            // Operator not currently running
            currentMachine = {
              serial: null,
              name: null
            };
            currentStatus = {
              code: mostRecent.endState?.status?.code ?? 0,
              name: mostRecent.endState?.status?.name ?? "Unknown"
            };
          } else {
            currentMachine = {
              serial: mostRecent?.machine?.serial ?? null,
              name: mostRecent?.machine?.name ?? null
            };
            currentStatus = {
              code: 1,
              name: "Running"
            };
          }

          const operatorName = mostRecent?.operator?.name ?? sessions[0]?.operator?.name ?? "Unknown";

          // Truncate first if it starts before window
          if (sessions[0]) {
            const first = sessions[0];
            const firstStart = new Date(first.timestamps?.start);
            if (firstStart < partialDay.start) {
              sessions[0] = truncateAndRecalcOperator(first, partialDay.start, first.timestamps?.end ? new Date(first.timestamps.end) : partialDay.end);
            }
          }

          // Truncate last if it ends after window (or is open)
          if (sessions.length > 0) {
            const lastIdx = sessions.length - 1;
            const last = sessions[lastIdx];
            const lastEnd = last.timestamps?.end ? new Date(last.timestamps.end) : null;

            if (!lastEnd || lastEnd > partialDay.end) {
              const effectiveEnd = lastEnd ? partialDay.end : partialDay.end;
              sessions[lastIdx] = truncateAndRecalcOperator(
                last,
                new Date(sessions[lastIdx].timestamps.start),
                effectiveEnd
              );
            }
          }

          // Aggregate metrics
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

          const downtimeMs = Math.max(0, (partialDay.end - partialDay.start) - runtimeMs);

          results.push({
            operatorId: opId,
            operatorName,
            currentMachine,
            currentStatus,
            runtimeMs,
            downtimeMs,
            totalCount,
            misfeedCount,
            workTimeSec,
            totalTimeCredit,
            timeRange: {
              start: partialDay.start,
              end: partialDay.end,
              type: partialDay.type
            }
          });
        } catch (err) {
          logger.error(`Error processing operator ${opId} for partial day:`, err);
          continue;
        }
      }
    }
    
    return results;
  }

  // Helper function to combine operators summary data
  function combineOperatorsSummaryData(dailyRecords, sessionData) {
    const combinedMap = new Map();
    
    // Add daily records (group by operator)
    for (const record of dailyRecords) {
      const operatorId = record.operatorId;
      
      if (!combinedMap.has(operatorId)) {
        combinedMap.set(operatorId, {
          operatorId,
          operatorName: record.operatorName,
          currentMachine: {
            serial: record.machineSerial,
            name: record.machineName
          },
          currentStatus: {
            code: 1,
            name: "Running"
          },
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0
        });
      }
      
      const operator = combinedMap.get(operatorId);
      operator.runtimeMs += record.runtimeMs || 0;
      operator.downtimeMs += record.pausedTimeMs || 0; // pausedTimeMs from daily cache
      operator.totalCount += record.totalCounts || 0;
      operator.misfeedCount += record.totalMisfeeds || 0;
      operator.workTimeSec += (record.workedTimeMs || 0) / 1000; // Convert to seconds
      operator.totalTimeCredit += (record.totalTimeCreditMs || 0) / 1000; // Convert to seconds
    }
    
    // Add session data
    for (const session of sessionData) {
      const operatorId = session.operatorId;
      
      if (!combinedMap.has(operatorId)) {
        combinedMap.set(operatorId, {
          operatorId,
          operatorName: session.operatorName,
          currentMachine: session.currentMachine,
          currentStatus: session.currentStatus,
          runtimeMs: 0,
          downtimeMs: 0,
          totalCount: 0,
          misfeedCount: 0,
          workTimeSec: 0,
          totalTimeCredit: 0
        });
      }
      
      const operator = combinedMap.get(operatorId);
      operator.runtimeMs += session.runtimeMs || 0;
      operator.downtimeMs += session.downtimeMs || 0;
      operator.totalCount += session.totalCount || 0;
      operator.misfeedCount += session.misfeedCount || 0;
      operator.workTimeSec += session.workTimeSec || 0;
      operator.totalTimeCredit += session.totalTimeCredit || 0;
      
      // Update current machine and status from most recent session
      if (session.currentMachine?.serial) {
        operator.currentMachine = session.currentMachine;
      }
      if (session.currentStatus?.code !== undefined) {
        operator.currentStatus = session.currentStatus;
      }
    }
    
    // Calculate performance metrics for each operator
    for (const [operatorId, data] of combinedMap) {
      const totalMs = data.runtimeMs + data.downtimeMs;
      const availability = totalMs ? Math.min(Math.max(data.runtimeMs / totalMs, 0), 1) : 0;
      const throughput = (data.totalCount + data.misfeedCount) ? data.totalCount / (data.totalCount + data.misfeedCount) : 0;
      const efficiency = data.workTimeSec > 0 ? data.totalTimeCredit / data.workTimeSec : 0;
      const oee = availability * throughput * efficiency;
      
      data.availability = availability;
      data.throughput = throughput;
      data.efficiency = efficiency;
      data.oee = oee;
    }
    
    return combinedMap;
  }

  return router;
};