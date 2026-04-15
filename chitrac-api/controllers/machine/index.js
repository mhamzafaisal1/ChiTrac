/*** machines API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const config = require("../../modules/config");
const { loadActiveShifts, computeShiftElapsedMs, getShiftDayHourEnvelope } = require("../../utils/shiftElapsed");
const {
  getMachinesSummaryRealTime,
  buildLatestTickerMap,
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
  buildCurrentOperatorsFromTicker: buildCurrentOperators,
} = require("../../utils/machineFunctions");

module.exports = function(server) {
	return constructor(server);
}

function constructor(server) {
	const db = server.db;
	const collection = db.collection(config.machineCollectionName);
	const logger = server.logger;
	const xmlParser = server.xmlParser;
	const configService = require('../../services/mongo/');
	const machineValidator = require('../../middleware/machineValidator')(server);

	/*** Service consumption functions */
	async function getMachineXML(req, res, next) {
		try {
			res.set('Content-Type', 'text/xml');
			let machines = await configService.getConfiguration(collection, {}, { '_id': 0, 'active': 0 });
			let xmlString = await xmlParser.xmlArrayBuilder('machine', machines, false);
			res.send(xmlString);
		} catch (error) {
			next(error);
		}
	}

	async function getMachine(req, res, next) {
		try {
			let machines = await configService.getConfiguration(collection);
			res.json(machines);
		} catch (error) {
			next(error);
		}
	}

	async function getSpfMachines(req, res, next) {
		try {
			const machines = await collection
				.find({
					$or: [{ name: { $regex: /^SPF/i } }, { type: "SPF" }],
					active: { $ne: false },
				})
				.project({ serial: 1, name: 1, active: 1 })
				.sort({ name: 1 })
				.toArray();
			res.json(machines);
		} catch (error) {
			next(error);
		}
	}

	// async function createMachine(req, res, next) {
	// 	try {
	// 	  const machine = req.body;
	  
	// 	  // ✅ Remove _id if present (fixes schema validation failure)
	// 	  if (machine._id) {
	// 		delete machine._id;
	// 	  }
	  
	// 	  // Validate required fields
	// 	  if (!machine.name || !machine.serial) {
	// 		return res.status(400).json({ error: 'Name and number are required fields' });
	// 	  }
	  
	// 	  // ✅ Sort & dedupe stations
	// 	  if (Array.isArray(machine.stations)) {
	// 		machine.stations = [...new Set(machine.stations)].sort((a, b) => a - b);
	// 	  }
	  
	// 	  let results = await configService.upsertConfiguration(collection, machine, true, 'serial');
	// 	  res.status(201).json(results);
	// 	} catch (error) {
	// 	  next(error);
	// 	}
	//   }
	  

	async function createMachine(req, res, next) {
  try {
    const machine = { ...req.body }; // clone for safety

    // 🪵 Log the raw incoming payload
    logger.debug('[createMachine] Incoming payload:', {
      body: machine,
      timestamp: new Date().toISOString()
    });

    // ✅ Remove _id if present to prevent schema rejection
    if (machine._id) {
      logger.debug('[createMachine] Removing _id from payload to satisfy schema');
      delete machine._id;
    }

    // ✅ Sort and deduplicate stations if present
    if (Array.isArray(machine.stations)) {
      const original = [...machine.stations];
      machine.stations = [...new Set(machine.stations)].sort((a, b) => a - b);
      logger.debug(`[createMachine] Normalized stations from [${original}] to [${machine.stations}]`);
    }

    // 🪵 Log the final payload before insert
    logger.debug('[createMachine] Final payload to insert:', {
      body: machine,
      timestamp: new Date().toISOString()
    });

    const results = await configService.upsertConfiguration(collection, machine, true, 'serial');

    logger.info('[createMachine] Machine created successfully:', {
      serial: machine.serial,
      name: machine.name,
      timestamp: new Date().toISOString()
    });

    res.status(201).json(results);
  } catch (error) {
    logger.error('[createMachine] Error:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    next(error);
  }
}

	

	async function upsertMachine(req, res, next) {
		try {
			const id = req.params.id;
			let updates = req.body;
	
			logger.debug('[upsertMachine] Processing update:', {
				id: id,
				body: updates,
				timestamp: new Date().toISOString()
			});

			if (updates._id) {
				delete updates._id;
			}
	
			// ✅ Sort & dedupe stations
			if (Array.isArray(updates.stations)) {
				const original = [...updates.stations];
				updates.stations = [...new Set(updates.stations)].sort((a, b) => a - b);
				logger.debug(`[upsertMachine] Normalized stations from [${original}] to [${updates.stations}]`);
			}
	
			let results = await configService.upsertConfiguration(
				collection,
				id ? { _id: id, ...updates } : updates,
				true,
				'serial'
			);

			logger.info('[upsertMachine] Machine updated successfully:', {
				id: id,
				serial: updates.serial,
				name: updates.name,
				timestamp: new Date().toISOString()
			});
	
			res.json(results);
		} catch (error) {
			logger.error('[upsertMachine] Error:', {
				error: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString()
			});
			next(error);
		}
	}
	

	async function deleteMachine(req, res, next) {
		try {
			const id = req.params.id;
			
			logger.debug('[deleteMachine] Processing delete:', {
				id: id,
				timestamp: new Date().toISOString()
			});

			let results = await configService.deleteConfiguration(collection, id);
			
			logger.info('[deleteMachine] Machine deleted successfully:', {
				id: id,
				timestamp: new Date().toISOString()
			});

			res.json(results);
		} catch (error) {
			logger.error('[deleteMachine] Error:', {
				error: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString()
			});
			next(error);
		}
	}

	/*** Machine Config Routes */
	/** GET routes */
	router.get('/machines/config/xml', getMachineXML);
	router.get('/machines/config', getMachine);
	router.get("/machines/spf", getSpfMachines);

	/** POST routes */
	router.post('/machines/config', machineValidator, createMachine);

	/** PUT routes */
	router.put('/machines/config/:id', machineValidator, upsertMachine);

	/** DELETE routes */
	router.delete('/machines/config/:id', deleteMachine);

	// Machine analytics routes are defined below in this controller

  const getMachinesSummaryRealTimeHandler = getMachinesSummaryRealTime(db, logger, config);

  // GET /api/alpha/analytics/machines-summary-daily-cached (legacy)
  // GET /api/machine/analytics/machines-summary-daily-cached (controller route)
  // Returns daily machine summary from totals-daily cache; falls back to real-time if no cache.
  router.get(
    ["/machines-summary-daily-cached", "/analytics/machines-summary-daily-cached"],
    async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      const today = new Date();
      const wallClockNow = new Date(
        today.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
      );
      const dateStr = wallClockNow.toISOString().split("T")[0];

      logger.info(
        `[machineSessions] Fetching daily cached machines summary for date: ${dateStr}, serial: ${
          serial || "all"
        }`
      );

      const filter = {
        entityType: "machine",
        date: dateStr,
      };
      if (serial) {
        filter.machineSerial = parseInt(serial);
      }

      const cacheRecords = await db
        .collection(config.totalsDailyCollectionName)
        .find(filter)
        .toArray();

      if (cacheRecords.length === 0) {
        logger.warn(
          `[machineSessions] No daily cached data found for date: ${dateStr}, falling back to real-time calculation`
        );
        return await getMachinesSummaryRealTimeHandler(req, res);
      }

      const activeShifts = await loadActiveShifts(db).catch(() => []);
      const shiftElapsedCache = new Map();

      const machineSerials = cacheRecords.map((r) => Number(r.machineSerial));

      const tickers = await db
        .collection(config.stateTickerCollectionName)
        .find({ "machine.id": { $in: machineSerials } })
        .project({ _id: 0, "machine.id": 1, status: 1, timestamp: 1 })
        .toArray();

      const latestTickers = new Map();
      tickers.forEach((ticker) => {
        const id = Number(ticker.machine?.id);
        const ts = new Date(ticker.timestamp || 0);
        const existing = latestTickers.get(id);
        if (!existing || ts > new Date(existing.timestamp || 0)) {
          latestTickers.set(id, ticker);
        }
      });

      const statusMap = new Map();
      for (const [id, ticker] of latestTickers) {
        const statusId = ticker.status?.id ?? ticker.status?.code ?? 0;
        statusMap.set(id, {
          code: statusId,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.softrolColor || "None",
        });
      }

      const data = cacheRecords.map((record) => {
        const currentStatus = statusMap.get(Number(record.machineSerial)) || {
          code: 0,
          name: "Unknown",
        };

        const timeRange = record.buildRange || record.timeRange;
        let rangeStart, rangeEnd;

        if (timeRange && timeRange.start && timeRange.end) {
          rangeStart = new Date(timeRange.start);
          rangeEnd = new Date(timeRange.end);
        } else {
          const todayFallback = new Date();
          const wallClockFallback = new Date(
            todayFallback.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
          );
          rangeStart = new Date(wallClockFallback.setHours(0, 0, 0, 0));
          rangeEnd = new Date();
        }

        const shiftKey = `${rangeStart.getTime()}|${rangeEnd.getTime()}`;
        const shiftElapsedMs = shiftElapsedCache.has(shiftKey)
          ? shiftElapsedCache.get(shiftKey)
          : computeShiftElapsedMs(activeShifts, rangeStart, rangeEnd);
        shiftElapsedCache.set(shiftKey, shiftElapsedMs);

        const downtimeMs = Math.max(shiftElapsedMs - (record.runtimeMs || 0), 0);

        const availability =
          shiftElapsedMs > 0
            ? Math.min(Math.max((record.runtimeMs || 0) / shiftElapsedMs, 0), 1)
            : 0;
        const totalOutput = record.totalCounts + record.totalMisfeeds;
        const throughput =
          totalOutput > 0 ? record.totalCounts / totalOutput : 0;

        let workTimeMs = record.workedTimeMs || 0;
        if (workTimeMs === 0 && record.totalTimeCreditMs > 0 && record.runtimeMs > 0) {
          workTimeMs = record.runtimeMs;
          logger.debug(
            `[machineSessions] Machine ${record.machineSerial}: workedTimeMs was 0, using runtimeMs ${workTimeMs}ms as fallback`
          );
        }

        const workTimeSec = workTimeMs / 1000;
        const totalTimeCreditSec = (record.totalTimeCreditMs || 0) / 1000;
        const efficiency =
          workTimeSec > 0 ? totalTimeCreditSec / workTimeSec : 0;
        const oee = availability * throughput * efficiency;

        return {
          machine: {
            serial: record.machineSerial,
            name: record.machineName,
          },
          currentStatus: currentStatus,
          metrics: {
            runtime: {
              total: record.runtimeMs,
              formatted: formatDuration(record.runtimeMs),
            },
            downtime: {
              total: downtimeMs,
              formatted: formatDuration(downtimeMs),
            },
            output: {
              totalCount: record.totalCounts,
              misfeedCount: record.totalMisfeeds,
            },
            performance: {
              availability: {
                value: availability,
                percentage: (availability * 100).toFixed(2),
              },
              throughput: {
                value: throughput,
                percentage: (throughput * 100).toFixed(2),
              },
              efficiency: {
                value: efficiency,
                percentage: (efficiency * 100).toFixed(2),
              },
              oee: {
                value: oee,
                percentage: (oee * 100).toFixed(2),
              },
            },
          },
          timeRange: {
            start: rangeStart,
            end: rangeEnd,
          },
        };
      });

      logger.info(
        `[machineSessions] Retrieved ${data.length} daily cached machine records for date: ${dateStr}`
      );
      res.json(data);
    } catch (err) {
      logger.error(
        `[machineSessions] Error in daily cached machines-summary route:`,
        err
      );

      if (
        err.message.includes("Start and end dates are required") ||
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date format") ||
        err.message.includes("Start date must be before end date") ||
        err.message.includes("Invalid timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }

      logger.info(
        `[machineSessions] Falling back to real-time calculation due to error`
      );
      return await getMachinesSummaryRealTimeHandler(req, res);
    }
    }
  );

  // GET /api/alpha/analytics/machine-dashboard-daily-cached (legacy)
  // GET /api/machine/analytics/machine-dashboard-daily-cached (controller route)
  // Returns machine dashboard from totals-daily and hourly-totals cache.
  // 
  router.get(
    ["/machine-dashboard-daily-cached", "/analytics/machine-dashboard-daily-cached"],
    async (req, res) => {
    try {
      const serialParam =
        typeof req.query.serial !== "undefined"
          ? Number.parseInt(req.query.serial, 10)
          : null;
      const machineSerialFilter = Number.isFinite(serialParam)
        ? serialParam
        : null;

      const today = new Date();
      const wallClockNow = new Date(
        today.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE })
      );
      const dateStr = wallClockNow.toISOString().split("T")[0];

      const cacheCollection = db.collection(config.totalsDailyCollectionName);
      const machineFilter = {
        entityType: "machine",
        date: dateStr,
      };

      if (machineSerialFilter !== null) {
        machineFilter.machineSerial = machineSerialFilter;
      }

      const machineTotals = await cacheCollection.find(machineFilter).toArray();

      if (machineTotals.length === 0) {
        logger.warn(
          `[machineSessions] No machine totals found in totals-daily for ${dateStr}`
        );
        return res.json([]);
      }

      const machineSerials = machineTotals
        .map((record) => Number(record.machineSerial))
        .filter((serial) => Number.isFinite(serial));

      if (!machineSerials.length) {
        logger.warn(
          "[machineSessions] Machine totals missing serial numbers, cannot build response"
        );
        return res.json([]);
      }

      const serialSet = new Set(machineSerials);
      const tickerSerialFilter = [
        ...new Set([
          ...machineSerials,
          ...machineSerials.map((serial) => String(serial)),
        ]),
      ];

      const activeShiftsDashboard = await loadActiveShifts(db).catch(() => []);
      const shiftHourEnvelope = getShiftDayHourEnvelope(
        activeShiftsDashboard,
        wallClockNow
      );
      const shiftElapsedCacheDashboard = new Map();

      const [machineItemRecords, machineItemHourlyRecords, operatorMachineRecords, operatorMachineHourlyRecords, stateTickerData] =
        await Promise.all([
          cacheCollection
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          db
            .collection(config.totalsHourlyCollectionName)
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          cacheCollection
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          db
            .collection(config.totalsHourlyCollectionName)
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
            })
            .toArray(),
          tickerSerialFilter.length
            ? db
                .collection(config.stateTickerCollectionName)
                .find({
                  $or: [
                    { "machine.serial": { $in: tickerSerialFilter } },
                    { "machine.id": { $in: tickerSerialFilter } },
                  ],
                })
                .toArray()
            : [],
        ]);

      const tickerMap = buildLatestTickerMap(stateTickerData);
      const machineItemsBySerial = groupRecordsBySerial(machineItemRecords);
      const machineItemHourlyBySerial = groupRecordsBySerial(machineItemHourlyRecords);
      const operatorMachineHourlyBySerial = groupRecordsBySerial(operatorMachineHourlyRecords);

      const results = await Promise.all(
        machineTotals.map(async (record) => {
          const serial = Number(record.machineSerial);
          if (!Number.isFinite(serial) || !serialSet.has(serial)) {
            return null;
          }

          const sessionStart = record.timeRange?.start
            ? new Date(record.timeRange.start)
            : new Date(`${dateStr}T00:00:00.000Z`);
          const sessionEnd = record.timeRange?.end
            ? new Date(record.timeRange.end)
            : wallClockNow;

          const cacheDateForCharts =
            typeof record.date === "string" && record.date.trim()
              ? record.date.trim()
              : dateStr;

          const dashShiftKey = `${sessionStart.getTime()}|${sessionEnd.getTime()}`;
          const shiftElapsedMsDash = shiftElapsedCacheDashboard.has(dashShiftKey)
            ? shiftElapsedCacheDashboard.get(dashShiftKey)
            : computeShiftElapsedMs(activeShiftsDashboard, sessionStart, sessionEnd);
          shiftElapsedCacheDashboard.set(dashShiftKey, shiftElapsedMsDash);

          const performance = buildPerformanceFromMachineRecord(
            record,
            shiftElapsedMsDash
          );
          const machineItems = machineItemsBySerial.get(serial) || [];
          const itemSummary = buildItemSummaryFromRecords(
            machineItems,
            sessionStart,
            sessionEnd
          );
          const machineItemHourly = machineItemHourlyBySerial.get(serial) || [];
          const itemHourlyStack = buildItemHourlyStackFromRecords(
            machineItemHourly,
            sessionStart,
            shiftHourEnvelope,
            cacheDateForCharts
          );
          const operatorMachineHourly = operatorMachineHourlyBySerial.get(serial) || [];
          const operatorEfficiency = buildOperatorEfficiencyFromRecords(
            operatorMachineHourly,
            sessionStart,
            shiftHourEnvelope,
            cacheDateForCharts
          );
          const currentOperators = await buildCurrentOperators(db, serial);

          const latestTicker = tickerMap.get(serial);

          return {
            machine: {
              serial,
              name: record.machineName || `Serial ${serial}`,
            },
            currentStatus: latestTicker?.status || {
              code: 0,
              name: "Unknown",
            },
            performance,
            itemSummary,
            itemHourlyStack,
            faultData: {
              faultSummaries: [],
              faultCycles: [],
            },
            operatorEfficiency,
            currentOperators,
            timestamp: record.lastUpdated || wallClockNow,
            sessionStart,
            sessionEnd,
          };
        })
      );

      res.json(results.filter(Boolean));
    } catch (err) {
      logger.error(
        `[machineSessions] Error in machine-dashboard-daily-cached route:`,
        err
      );
      res
        .status(500)
        .json({ error: "Failed to fetch machine dashboard daily cache" });
    }
    }
  );


	return router;
}