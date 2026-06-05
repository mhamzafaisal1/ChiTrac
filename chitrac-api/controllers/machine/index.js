/*** machines API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const { ObjectId } = require("mongodb");
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const config = require("../../modules/config");
const { loadActiveShifts, computeShiftElapsedMs, getShiftDayHourEnvelope } = require("../../utils/shiftElapsed");
const {
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
} = require("../../utils/machineDashboardCache");
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
	router.get('/machine/config/xml', getMachineXML);
	router.get('/machine/config', getMachine);
	router.get("/machine/spf", getSpfMachines);

	/** POST routes */
	router.post('/machine/config', machineValidator, createMachine);

	/** PUT routes */
	router.put('/machine/config/:id', machineValidator, upsertMachine);

	/** DELETE routes */
	router.delete('/machine/config/:id', deleteMachine);

	// Machine analytics routes are defined below in this controller

  const getMachinesSummaryRealTimeHandler = getMachinesSummaryRealTime(db, logger, config);

  // GET /api/machine/analytics/machines-summary-daily-cached
  // Returns daily machine summary from totals-daily cache; falls back to real-time if no cache.
  router.get(
    "/machine/analytics/machines-summary-daily-cached",
    async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);

      if (req.query.shiftId) {
        let shiftOid;
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }

        const shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }

        const result = await buildMachineSummaryFromShiftCache(
          db,
          logger,
          config,
          { shiftOid, shiftDoc, start, end, serial }
        );

        if (result.found) {
          logger.info(
            `[machineSessions] Retrieved ${result.recordCount} shift cached machine records for shift ${shiftOid} on ${result.dateStr}`
          );
        } else {
          logger.warn(
            `[machineSessions] No shift cached machine data found for shift ${shiftOid} on ${result.dateStr}, falling back to sessions`
          );
        }

        return res.json(result.data);
      }

      const result = await buildMachineSummaryFromDailyCache(db, logger, config, {
        start,
        end,
        serial,
      });

      if (!result.found) {
        logger.warn(
          `[machineSessions] No daily cached data found for date: ${result.dateStr}, falling back to real-time calculation`
        );
        return await getMachinesSummaryRealTimeHandler(req, res);
      }

      logger.info(
        `[machineSessions] Retrieved ${result.data.length} daily cached machine records for date: ${result.dateStr}`
      );
      res.json(result.data);
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

  // GET /api/machine/analytics/machine-dashboard-daily-cached
  // Returns machine dashboard from totals-daily and hourly-totals cache.
  // 
  router.get(
    "/machine/analytics/machine-dashboard-daily-cached",
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
