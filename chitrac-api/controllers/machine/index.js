/*** machines API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const { ObjectId } = require("mongodb");
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { loadActiveShifts, computeShiftElapsedMs, getShiftDayHourEnvelope } = require("../../utils/shiftElapsed");
const { getSessionDataForPartialDays } = require("../../utils/reportFunctions");
const {
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
  getPlantDateStr,
} = require("../../utils/machineDashboardCache");
const {
  getMachinesSummaryRealTime,
  buildLatestTickerMap,
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
  buildFaultData,
  getBookendedStatesAndTimeRange,
  buildCurrentOperatorsFromTicker: buildCurrentOperators,
} = require("../../utils/machineFunctions");
const ipAddressSchema = require("../../schemas/ipAddress");

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

  async function buildMachineSummaryFromSessions(start, end, serial, shiftOid) {
    const sessionData = await getSessionDataForPartialDays(
      db,
      [{ start, end }],
      serial,
      { shiftId: String(shiftOid) }
    );
    const records = sessionData.machines || [];
    const serials = [...new Set(records.map(record => Number(record.machineSerial)))]
      .filter(Number.isFinite);
    const tickers = serials.length
      ? await db.collection(config.stateTickerCollectionName)
          .find({
            $or: [
              { "machine.id": { $in: serials } },
              { "machine.serial": { $in: serials } },
            ],
          })
          .sort({ timestamp: -1 })
          .toArray()
      : [];
    const statusBySerial = new Map();
    tickers.forEach(ticker => {
      const tickerSerial = Number(ticker.machine?.id ?? ticker.machine?.serial);
      if (!statusBySerial.has(tickerSerial)) {
        statusBySerial.set(tickerSerial, {
          code: ticker.status?.id ?? ticker.status?.code ?? 0,
          name: ticker.status?.name || "Unknown",
          color: ticker.status?.softrolColor || "None",
        });
      }
    });

    return records.map(record => {
      const machineSerial = Number(record.machineSerial);
      const runtimeMs = Number(record.runtimeMs) || 0;
      const workedMs = Number(record.workedTimeMs) || 0;
      const availability = 1;
      const throughput = 1;
      const efficiency = runtimeMs > 0 ? Math.min(workedMs / (runtimeMs * 4), 1) : 0;
      const oee = availability * throughput * efficiency;

      return {
        machine: {
          serial: machineSerial,
          name: record.machineName || `Serial ${machineSerial}`,
        },
        currentStatus: statusBySerial.get(machineSerial) || {
          code: 0,
          name: "Unknown",
          color: "None",
        },
        metrics: {
          runtime: { total: runtimeMs, formatted: formatDuration(runtimeMs) },
          downtime: { total: 0, formatted: formatDuration(0) },
          output: {
            totalCount: Number(record.totalCounts) || 0,
            misfeedCount: Number(record.totalMisfeeds) || 0,
          },
          performance: {
            availability: { value: availability, percentage: "100.00" },
            throughput: { value: throughput, percentage: "100.00" },
            efficiency: { value: efficiency, percentage: (efficiency * 100).toFixed(2) },
            oee: { value: oee, percentage: (oee * 100).toFixed(2) },
          },
        },
        timeRange: { start, end },
      };
    });
  }

	function escapeRegex(value) {
		return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function machineId(machine) {
		return Number(machine.id ?? machine.serial);
	}

	function ipAddressString(value) {
		if (!value) return '';
		if (typeof value === 'string') return value.trim();
		return ipAddressSchema.utils.getIPAddressString(value);
	}

	function ipAddressFilter(ipAddress) {
		return {
			'ipAddress.firstOctet': ipAddress.firstOctet,
			'ipAddress.secondOctet': ipAddress.secondOctet,
			'ipAddress.thirdOctet': ipAddress.thirdOctet,
			'ipAddress.fourthOctet': ipAddress.fourthOctet
		};
	}

	function normalizeAddressArray(values) {
		return [...new Set(values.map(Number))]
			.filter(Number.isInteger)
			.sort((a, b) => a - b);
	}

	async function getMachineUniquenessErrors(machine, excludedId = null) {
		const id = machineId(machine);
		const name = String(machine.name || '').trim();
		const ipAddress = machine.ipAddress || {};
		const ipAddressText = ipAddressString(ipAddress);
		const query = {
			$or: [
				{ id },
				{ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
				ipAddressFilter(ipAddress)
			]
		};

		if (excludedId) {
			query._id = { $ne: new ObjectId(excludedId) };
		}

		const matches = await collection
			.find(query)
			.project({ id: 1, serial: 1, name: 1, ipAddress: 1 })
			.toArray();
		const fieldErrors = {};

		if (matches.some(existing => machineId(existing) === id)) {
			fieldErrors.id = 'Machine id is already in use.';
		}
		if (matches.some(existing => String(existing.name || '').trim().toLowerCase() === name.toLowerCase())) {
			fieldErrors.name = 'Name is already in use.';
		}
		if (matches.some(existing => ipAddressString(existing.ipAddress) === ipAddressText)) {
			fieldErrors.ipAddress = 'IP address is already in use.';
		}

		return fieldErrors;
	}

	function sendMachineUniquenessError(res, fieldErrors) {
		return res.status(409).json({
			error: 'A machine with one or more of these values already exists.',
			fieldErrors
		});
	}

	/*** Service consumption functions */
  function resolveDashboardDetailRange(req) {
    const hasStart = typeof req.query.start !== "undefined" || typeof req.query.startTime !== "undefined";
    const hasEnd = typeof req.query.end !== "undefined" || typeof req.query.endTime !== "undefined";

    if (hasStart || hasEnd || req.query.timeframe) {
      const parsed = parseAndValidateQueryParams(req);
      return {
        start: parsed.start,
        end: parsed.end,
        serial: parsed.serial,
        dateStr: getPlantDateStr(parsed.start),
        hasExplicitRange: true,
      };
    }

    const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
    return {
      start: now.startOf("day").toJSDate(),
      end: now.toJSDate(),
      serial:
        typeof req.query.serial !== "undefined" || typeof req.query.machineSerial !== "undefined"
          ? Number.parseInt(req.query.serial || req.query.machineSerial, 10)
          : null,
      dateStr: now.toISODate(),
      hasExplicitRange: false,
    };
  }

  function hourEnvelopeForRange(start, end) {
    const startDt = DateTime.fromJSDate(new Date(start), { zone: SYSTEM_TIMEZONE });
    const endDt = DateTime.fromJSDate(new Date(end), { zone: SYSTEM_TIMEZONE });
    if (!startDt.isValid || !endDt.isValid || endDt <= startDt) return null;

    const effectiveEnd = endDt.minus({ milliseconds: 1 });
    if (startDt.toISODate() !== effectiveEnd.toISODate()) return null;

    return {
      minHour: startDt.hour,
      maxHour: Math.max(startDt.hour, effectiveEnd.hour),
    };
  }

  function intersectHourEnvelopes(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    const minHour = Math.max(a.minHour, b.minHour);
    const maxHour = Math.min(a.maxHour, b.maxHour);
    return maxHour >= minHour ? { minHour, maxHour } : null;
  }

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
				.project({ id: 1, serial: 1, name: 1, active: 1 })
				.sort({ name: 1 })
				.toArray();
			res.json(machines.map(machine => ({
				...machine,
				serial: machineId(machine)
			})));
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
    machine.name = String(machine.name).trim();

    const fieldErrors = await getMachineUniquenessErrors(machine);
    if (Object.keys(fieldErrors).length) {
      return sendMachineUniquenessError(res, fieldErrors);
    }

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
    if (Array.isArray(machine.lanes)) {
      const original = [...machine.lanes];
      machine.lanes = normalizeAddressArray(machine.lanes);
      logger.debug(`[createMachine] Normalized lanes from [${original}] to [${machine.lanes}]`);
    }

    if (Array.isArray(machine.stations)) {
      const original = [...machine.stations];
      machine.stations = normalizeAddressArray(machine.stations);
      logger.debug(`[createMachine] Normalized stations from [${original}] to [${machine.stations}]`);
    }

    // 🪵 Log the final payload before insert
    logger.debug('[createMachine] Final payload to insert:', {
      body: machine,
      timestamp: new Date().toISOString()
    });

    const results = await configService.upsertConfiguration(collection, machine, true, 'id');

    logger.info('[createMachine] Machine created successfully:', {
      id: machine.id,
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
			let updates = { ...req.body };
			updates.name = String(updates.name).trim();

			const fieldErrors = await getMachineUniquenessErrors(updates, id);
			if (Object.keys(fieldErrors).length) {
				return sendMachineUniquenessError(res, fieldErrors);
			}
	
			logger.debug('[upsertMachine] Processing update:', {
				id: id,
				body: updates,
				timestamp: new Date().toISOString()
			});

			if (updates._id) {
				delete updates._id;
			}
	
			// ✅ Sort & dedupe stations
			if (Array.isArray(updates.lanes)) {
				const original = [...updates.lanes];
				updates.lanes = normalizeAddressArray(updates.lanes);
				logger.debug(`[upsertMachine] Normalized lanes from [${original}] to [${updates.lanes}]`);
			}

			if (Array.isArray(updates.stations)) {
				const original = [...updates.stations];
				updates.stations = normalizeAddressArray(updates.stations);
				logger.debug(`[upsertMachine] Normalized stations from [${original}] to [${updates.stations}]`);
			}
	
			let results = await configService.upsertConfiguration(
				collection,
				id ? { _id: id, ...updates } : updates,
				true,
				'id'
			);

			logger.info('[upsertMachine] Machine updated successfully:', {
				id: id,
				machineId: updates.id,
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
          return res.json(
            await buildMachineSummaryFromSessions(start, end, serial, shiftOid)
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
      const {
        start: requestStart,
        end: requestEnd,
        serial,
        dateStr,
        hasExplicitRange,
      } = resolveDashboardDetailRange(req);
      const machineSerialFilter = Number.isFinite(serial) ? serial : null;

      let shiftDoc = null;
      let shiftOid = null;
      if (req.query.shiftId) {
        try {
          shiftOid = new ObjectId(String(req.query.shiftId));
        } catch (e) {
          return res.status(400).json({ error: "Invalid shiftId" });
        }
        shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
        if (!shiftDoc) {
          return res.status(404).json({ error: "Shift not found" });
        }
      }

      const wallClockNow = DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate();

      const cacheCollection = db.collection(config.totalsDailyCollectionName);
      const machineCollection = shiftOid
        ? db.collection("totals-shift")
        : cacheCollection;
      const machineFilter = {
        entityType: "machine",
        date: dateStr,
      };
      if (shiftOid) {
        machineFilter.shiftId = String(shiftOid);
      }

      if (machineSerialFilter !== null) {
        machineFilter.machineSerial = machineSerialFilter;
      }

      let machineTotalsSource = shiftOid ? "totals-shift" : "totals-daily";
      let machineTotals = await machineCollection.find(machineFilter).toArray();
      if (machineTotals.length === 0 && shiftOid) {
        logger.warn(
          `[machineSessions] No shift machine totals found in totals-shift for ${dateStr} shift ${shiftOid}; falling back to daily machine totals`
        );
        const dailyMachineFilter = {
          entityType: "machine",
          date: dateStr,
        };
        if (machineSerialFilter !== null) {
          dailyMachineFilter.machineSerial = machineSerialFilter;
        }
        machineTotalsSource = "totals-daily";
        machineTotals = await cacheCollection.find(dailyMachineFilter).toArray();
      }

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
        shiftDoc ? [shiftDoc] : activeShiftsDashboard,
        requestStart
      );
      const requestHourEnvelope = hasExplicitRange
        ? hourEnvelopeForRange(requestStart, requestEnd)
        : null;
      const chartHourEnvelope = intersectHourEnvelopes(
        shiftHourEnvelope,
        requestHourEnvelope
      );
      const chartHoursAreEmpty =
        Boolean(requestHourEnvelope && shiftHourEnvelope && !chartHourEnvelope);
      const chartHourFilter = chartHoursAreEmpty
        ? { hour: { $gte: 1, $lte: 0 } }
        : chartHourEnvelope
          ? { hour: { $gte: chartHourEnvelope.minHour, $lte: chartHourEnvelope.maxHour } }
          : {};
      const shiftElapsedCacheDashboard = new Map();
      const detailTotalsCollection = machineTotalsSource === "totals-shift"
        ? db.collection("totals-shift")
        : cacheCollection;
      const detailTotalsBaseFilter = machineTotalsSource === "totals-shift"
        ? { shiftId: String(shiftOid) }
        : {};

      const [machineItemRecords, machineItemHourlyRecords, operatorMachineRecords, operatorMachineHourlyRecords, stateTickerData] =
        await Promise.all([
          detailTotalsCollection
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...detailTotalsBaseFilter,
            })
            .toArray(),
          db
            .collection(config.totalsHourlyCollectionName)
            .find({
              entityType: "machine-item",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...chartHourFilter,
            })
            .toArray(),
          detailTotalsCollection
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...detailTotalsBaseFilter,
            })
            .toArray(),
          db
            .collection(config.totalsHourlyCollectionName)
            .find({
              entityType: "operator-machine",
              date: dateStr,
              machineSerial: { $in: machineSerials },
              ...chartHourFilter,
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

          const sessionStart = hasExplicitRange
            ? new Date(requestStart)
            : record.timeRange?.start
              ? new Date(record.timeRange.start)
              : new Date(`${dateStr}T00:00:00.000Z`);
          const sessionEnd = hasExplicitRange
            ? new Date(requestEnd)
            : record.timeRange?.end
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
            chartHourEnvelope,
            cacheDateForCharts
          );
          const operatorMachineHourly = operatorMachineHourlyBySerial.get(serial) || [];
          const operatorEfficiency = buildOperatorEfficiencyFromRecords(
            operatorMachineHourly,
            sessionStart,
            chartHourEnvelope,
            cacheDateForCharts
          );
          const currentOperators = await buildCurrentOperators(db, serial);
          const faultStateWindow = await getBookendedStatesAndTimeRange(
            db,
            serial,
            sessionStart,
            sessionEnd
          );
          const faultData = buildFaultData(
            faultStateWindow?.states || [],
            sessionStart,
            sessionEnd
          );

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
            faultData,
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
      if (
        err.message.includes("start/startTime and end/endTime are required") ||
        err.message.includes("Invalid date string format") ||
        err.message.includes("Start time must be before end time") ||
        err.message.includes("Unsupported timeframe")
      ) {
        return res.status(400).json({ error: err.message });
      }
      res
        .status(500)
        .json({ error: "Failed to fetch machine dashboard daily cache" });
    }
    }
  );


	return router;
}
