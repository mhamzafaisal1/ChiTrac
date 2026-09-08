/*** machines API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const { ObjectId } = require("mongodb");
const { formatDuration, parseAndValidateQueryParams, SYSTEM_TIMEZONE } = require("../../utils/time");
const { DateTime } = require("luxon");
const config = require("../../modules/config");
const { formatHumanName } = require("../../utils/humanNames");
const {
  loadActiveShifts,
  computeShiftElapsedMs,
  resolveShiftProjectionWindow,
  getShiftDayHourEnvelope,
} = require("../../utils/shiftElapsed");
const { getSessionDataForPartialDays } = require("../../utils/reportFunctions");
const {
  buildMachineSummaryFromDailyCache,
  buildMachineSummaryFromShiftCache,
  getPlantDateStr,
  loadConfiguredMachines,
} = require("../../utils/machineDashboardCache");
const {
  getMachinesSummaryRealTime,
  buildLatestTickerMap,
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildItemHourlyStackFromRecords,
  buildOperatorEfficiencyFromRecords,
  buildCurrentOperatorMetricsFromRecords,
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
          color: ticker.status?.color || ticker.status?.softrolColor || "None",
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

  function machineSerialFromConfig(machine) {
    const serial = Number(machine?.id ?? machine?.serial);
    return Number.isFinite(serial) ? serial : null;
  }

  function configuredMachineTotal(machine, requestStart, requestEnd, timestamp) {
    const serial = machineSerialFromConfig(machine);
    if (serial === null) return null;

    return {
      machineSerial: serial,
      machineName: machine.name || `Serial ${serial}`,
      runtimeMs: 0,
      pausedTimeMs: 0,
      faultTimeMs: 0,
      workedTimeMs: 0,
      totalTimeCreditMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
      timeRange: {
        start: requestStart,
        end: requestEnd,
      },
      lastUpdated: timestamp,
      configOnlyOffline: true,
    };
  }

  function configuredStationCount(machine) {
    const stations = Array.isArray(machine?.stations) ? machine.stations : [];
    const uniqueStations = new Set(
      stations
        .map((station) => Number(station))
        .filter((station) => Number.isFinite(station))
    );
    return Math.max(1, uniqueStations.size || stations.length || 1);
  }

  function buildStationCountBySerial(machines) {
    const stationCounts = new Map();
    for (const machine of machines || []) {
      const serial = machineSerialFromConfig(machine);
      if (serial !== null) {
        stationCounts.set(serial, configuredStationCount(machine));
      }
    }
    return stationCounts;
  }

  function zeroMachineDashboardPerformance() {
    return {
      runtime: {
        total: 0,
        formatted: formatDuration(0),
      },
      downtime: {
        total: 0,
        formatted: formatDuration(0),
      },
      output: {
        totalCount: 0,
        misfeedCount: 0,
      },
      performance: {
        availability: {
          value: 0,
          percentage: "0.00%",
        },
        throughput: {
          value: 0,
          percentage: "0.00%",
        },
        efficiency: {
          value: 0,
          percentage: "0.00%",
        },
        oee: {
          value: 0,
          percentage: "0.00%",
        },
      },
    };
  }

  function buildLatestTickerDocumentMap(stateTickerData) {
    const tickerMap = new Map();
    for (const record of stateTickerData || []) {
      const candidates = [
        record.machine?.serial,
        record.machine?.id,
        record.machine?.serialNumber,
      ];
      const ts =
        new Date(
          record.status?.timestamp ||
            record.timestamp ||
            record.timestamps?.update ||
            record.timestamps?.active ||
            record.timestamps?.create ||
            0
        ).getTime() || 0;

      for (const candidate of candidates) {
        const serial = Number(candidate);
        if (!Number.isFinite(serial)) continue;
        const existing = tickerMap.get(serial);
        if (!existing || ts > existing.timestamp) {
          tickerMap.set(serial, { record, timestamp: ts });
        }
      }
    }
    return tickerMap;
  }

  function currentOperatorSessionKey(serial, operatorId) {
    return `${Number(serial)}:${Number(operatorId)}`;
  }

  async function buildCurrentOperatorSessionMap(stateTickerData, machineSerials, start, end) {
    const serialSet = new Set(machineSerials.map(Number).filter(Number.isFinite));
    const operatorIds = [
      ...new Set(
        (stateTickerData || [])
          .flatMap((ticker) => Array.isArray(ticker.operators) ? ticker.operators : [])
          .map((operator) => Number(operator?.id))
          .filter((operatorId) => Number.isFinite(operatorId) && operatorId !== -1)
      ),
    ];

    if (!serialSet.size || !operatorIds.length) return new Map();

    const windowStart = new Date(start);
    const windowEnd = new Date(end);
    const docs = await db.collection(config.operatorSessionCollectionName)
      .find({
        "operator.id": { $in: operatorIds },
        $or: [
          { "machine.serial": { $in: [...serialSet] } },
          { "machine.id": { $in: [...serialSet] } },
        ],
        "timestamps.start": { $lt: windowEnd },
        $and: [{
          $or: [
            { "timestamps.end": { $gt: windowStart } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null },
          ],
        }],
      }, {
        projection: {
          _id: 0,
          operator: 1,
          machine: 1,
          timestamps: 1,
          workTime: 1,
          totalTimeCredit: 1,
          totalCount: 1,
          misfeedCount: 1,
        },
        sort: { "timestamps.start": 1 },
      })
      .toArray();

    const sessionMap = new Map();
    for (const doc of docs) {
      const serial = Number(doc.machine?.serial ?? doc.machine?.id);
      const operatorId = Number(doc.operator?.id);
      if (!Number.isFinite(serial) || !Number.isFinite(operatorId)) continue;
      const key = currentOperatorSessionKey(serial, operatorId);
      if (!sessionMap.has(key)) sessionMap.set(key, []);
      sessionMap.get(key).push(doc);
    }
    return sessionMap;
  }

  function buildCurrentOperatorsFromPreloadedTicker(tickerRecord, serial, start, end, metricsByOperator, sessionMap) {
    const safe = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
    const operators = Array.isArray(tickerRecord?.operators) ? tickerRecord.operators : [];
    const opIds = [
      ...new Set(
        operators
          .map((operator) => Number(operator?.id))
          .filter((operatorId) => Number.isFinite(operatorId) && operatorId !== -1)
      ),
    ];

    if (!opIds.length) return [];

    const windowStart = new Date(start);
    const windowEnd = new Date(end);
    const machineSerial = tickerRecord?.machine?.serial ?? tickerRecord?.machine?.id ?? Number(serial);
    const machineName = tickerRecord?.machine?.name || "Unknown";

    return opIds.map((opId) => {
      const docs = sessionMap.get(currentOperatorSessionKey(serial, opId)) || [];
      const currentDoc = docs.find((doc) => !doc.timestamps?.end) || null;
      const sessionDoc = currentDoc || docs[docs.length - 1] || null;
      const cachedMetrics = metricsByOperator instanceof Map ? metricsByOperator.get(opId) : null;

      let workedMs = 0;
      let creditMs = 0;
      let valid = 0;
      let mis = 0;

      if (cachedMetrics) {
        workedMs = Math.round(safe(cachedMetrics.workedTimeMs));
        creditMs = safe(cachedMetrics.totalTimeCreditMs);
        valid = safe(cachedMetrics.validCount);
        mis = safe(cachedMetrics.misfeedCount);
      } else {
        let workSec = 0;
        let creditSec = 0;
        for (const doc of docs) {
          const sessionStart = new Date(doc.timestamps?.start || doc.timestamps?.create || windowStart);
          const sessionEnd = doc.timestamps?.end ? new Date(doc.timestamps.end) : windowEnd;
          const overlapStart = sessionStart > windowStart ? sessionStart : windowStart;
          const overlapEnd = sessionEnd < windowEnd ? sessionEnd : windowEnd;
          const overlapMs = Math.max(0, overlapEnd - overlapStart);
          const sessionMs = Math.max(0, sessionEnd - sessionStart);
          const factor = sessionMs > 0 ? overlapMs / sessionMs : 0;
          workSec += safe(doc.workTime) * factor;
          creditSec += safe(doc.totalTimeCredit) * factor;
          valid += safe(doc.totalCount) * factor;
          mis += safe(doc.misfeedCount) * factor;
        }
        workedMs = Math.round(workSec * 1000);
        creditMs = creditSec * 1000;
      }

      const tickerOp = operators.find((operator) => Number(operator?.id) === opId);
      const operatorName = formatHumanName(tickerOp?.name || sessionDoc?.operator?.name, `Operator ${opId}`);
      const eff = workedMs > 0 ? creditMs / workedMs : 0;

      return {
        operatorId: opId,
        operatorName,
        machineSerial,
        machineName,
        session: {
          start: sessionDoc?.timestamps?.start || sessionDoc?.timestamps?.create || null,
          end: sessionDoc?.timestamps?.end || null,
        },
        metrics: {
          workedTimeMs: workedMs,
          workedTimeFormatted: formatDuration(workedMs),
          totalCount: Math.round(valid + mis),
          validCount: Math.round(valid),
          misfeedCount: Math.round(mis),
          efficiencyPct: +(eff * 100).toFixed(2),
        },
      };
    });
  }

  function machineSessionStatusFromSession(session) {
    const status = session.startState?.status || session.status || session.endState?.status || {};
    const codeValue =
      status.id ??
      status.code ??
      session.startState?.id ??
      session.startState?.code ??
      session.endState?.id ??
      session.endState?.code;
    const code = Number(codeValue);
    const name = status.name || session.startState?.name || session.endState?.name || "Faulted";
    return {
      code: Number.isFinite(code) ? code : null,
      name,
    };
  }

  async function buildMachineFaultSessionMap(machineSerials, start, end) {
    const serialSet = new Set(machineSerials.map(Number).filter(Number.isFinite));
    if (!serialSet.size) return new Map();

    const windowStart = new Date(start);
    const windowEnd = new Date(end);
    const docs = await db.collection(config.machineSessionCollectionName)
      .find({
        $or: [
          { "machine.serial": { $in: [...serialSet] } },
          { "machine.id": { $in: [...serialSet] } },
        ],
        "timestamps.start": { $lt: windowEnd },
        $and: [{
          $or: [
            { "timestamps.end": { $gt: windowStart } },
            { "timestamps.end": { $exists: false } },
            { "timestamps.end": null },
          ],
        }],
      }, {
        projection: {
          _id: 1,
          machine: 1,
          timestamps: 1,
          startState: 1,
          endState: 1,
          status: 1,
        },
        sort: { "timestamps.start": 1 },
      })
      .toArray();

    const sessionMap = new Map();
    for (const doc of docs) {
      const serial = Number(doc.machine?.serial ?? doc.machine?.id);
      if (!Number.isFinite(serial)) continue;
      const status = machineSessionStatusFromSession(doc);
      if (!(Number(status.code) > 1)) continue;
      if (!sessionMap.has(serial)) sessionMap.set(serial, []);
      sessionMap.get(serial).push(doc);
    }
    return sessionMap;
  }

  function buildFaultDataFromPreloadedMachineSessions(sessions, start, end) {
    const windowStart = new Date(start);
    const windowEnd = new Date(end);
    const faultCycles = [];
    const summaryMap = new Map();

    for (const session of sessions || []) {
      const status = machineSessionStatusFromSession(session);
      if (!(Number(status.code) > 1)) continue;

      const sessionStart = new Date(session.timestamps?.start || session.timestamps?.create || windowStart);
      const sessionEnd = session.timestamps?.end ? new Date(session.timestamps.end) : windowEnd;
      const overlapStart = sessionStart > windowStart ? sessionStart : windowStart;
      const overlapEnd = sessionEnd < windowEnd ? sessionEnd : windowEnd;
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      if (overlapMs <= 0) continue;

      const durationSeconds = Math.floor(overlapMs / 1000);
      const name = status.name || "Faulted";
      const summaryKey = `${status.code}:${name}`;

      faultCycles.push({
        id: String(session._id),
        start: overlapStart,
        end: overlapEnd,
        durationSeconds,
        code: status.code,
        name,
        machineSerial: session.machine?.serial ?? session.machine?.id ?? null,
        machineName: session.machine?.name || null,
      });

      if (!summaryMap.has(summaryKey)) {
        summaryMap.set(summaryKey, {
          code: status.code,
          name,
          count: 0,
          totalDurationSeconds: 0,
        });
      }

      const summary = summaryMap.get(summaryKey);
      summary.count += 1;
      summary.totalDurationSeconds += durationSeconds;
    }

    const faultSummaries = Array.from(summaryMap.values()).map((summary) => ({
      ...summary,
      formatted: {
        hours: Math.floor(summary.totalDurationSeconds / 3600),
        minutes: Math.floor((summary.totalDurationSeconds % 3600) / 60),
        seconds: summary.totalDurationSeconds % 60,
      },
    })).sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);

    faultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));
    return { faultCycles, faultSummaries };
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

  // GET /api/machine/analytics/shift-projection-window
  // Returns today's shift-aware elapsed/scheduled window for plant-level projections.
  router.get(
    "/machine/analytics/shift-projection-window",
    async (req, res) => {
      try {
        const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
        const day = req.query.date
          ? DateTime.fromISO(String(req.query.date), { zone: SYSTEM_TIMEZONE })
          : now;

        if (!day.isValid) {
          return res.status(400).json({ error: "Invalid date" });
        }

        let projectionShifts;
        if (req.query.shiftId) {
          let shiftOid;
          try {
            shiftOid = new ObjectId(String(req.query.shiftId));
          } catch (error) {
            return res.status(400).json({ error: "Invalid shiftId" });
          }

          const shiftDoc = await db.collection(config.shiftCollectionName).findOne({ _id: shiftOid });
          if (!shiftDoc) {
            return res.status(404).json({ error: "Shift not found" });
          }
          projectionShifts = [shiftDoc];
        } else {
          projectionShifts = await loadActiveShifts(db, {
            collectionName: config.shiftCollectionName,
          }).catch(() => []);
        }

        const window = resolveShiftProjectionWindow(
          projectionShifts,
          day.toJSDate(),
          now.toJSDate(),
          SYSTEM_TIMEZONE
        );

        res.json({
          date: day.toISODate(),
          start: window.start,
          end: window.end,
          now: window.now,
          totalShiftMs: window.totalShiftMs,
          elapsedShiftMs: window.elapsedShiftMs,
          totalShiftHours: window.totalShiftMs / 3600000,
          elapsedShiftHours: window.elapsedShiftMs / 3600000,
          fallback: window.fallback,
        });
      } catch (err) {
        logger.error("[machineSessions] Error in shift-projection-window route:", err);
        res.status(500).json({ error: "Failed to resolve shift projection window" });
      }
    }
  );

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

      const configuredMachines = await loadConfiguredMachines(db, config, machineSerialFilter);
      const stationCountBySerial = buildStationCountBySerial(configuredMachines);
      const machineTotalsSerials = new Set(
        machineTotals
          .map((record) => Number(record.machineSerial))
          .filter(Number.isFinite)
      );
      const configuredOfflineTotals = configuredMachines
        .filter((machine) => {
          const serial = machineSerialFromConfig(machine);
          return serial !== null && !machineTotalsSerials.has(serial);
        })
        .map((machine) => configuredMachineTotal(machine, requestStart, requestEnd, wallClockNow))
        .filter(Boolean);
      machineTotals = machineTotals.concat(configuredOfflineTotals);

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
      const tickerDocumentMap = buildLatestTickerDocumentMap(stateTickerData);
      const currentOperatorSessionMap = await buildCurrentOperatorSessionMap(
        stateTickerData,
        machineSerials,
        requestStart,
        requestEnd
      );
      const machineFaultSessionMap = await buildMachineFaultSessionMap(
        machineSerials,
        requestStart,
        requestEnd
      );
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

          const performance = record.configOnlyOffline
            ? zeroMachineDashboardPerformance()
            : buildPerformanceFromMachineRecord(
                record,
                shiftElapsedMsDash
              );
          const machineItems = machineItemsBySerial.get(serial) || [];
          const itemSummary = buildItemSummaryFromRecords(
            machineItems,
            sessionStart,
            sessionEnd,
            { stationCount: stationCountBySerial.get(serial) || 1 }
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
          const currentOperatorMetrics =
            buildCurrentOperatorMetricsFromRecords(
              operatorMachineHourly,
              operatorEfficiency.flatMap((hour) =>
                (hour.operators || []).map((operator) => operator.id)
              )
            );
          const currentOperators = record.configOnlyOffline
            ? []
            : buildCurrentOperatorsFromPreloadedTicker(
                tickerDocumentMap.get(serial)?.record,
                serial,
                sessionStart,
                sessionEnd,
                currentOperatorMetrics,
                currentOperatorSessionMap
              );
          const faultData = record.configOnlyOffline
            ? { faultCycles: [], faultSummaries: [] }
            : buildFaultDataFromPreloadedMachineSessions(
                machineFaultSessionMap.get(serial) || [],
                sessionStart,
                sessionEnd
              );

          const latestTicker = tickerMap.get(serial);

          return {
            machine: {
              serial,
              name: record.machineName || `Serial ${serial}`,
            },
            currentStatus: record.configOnlyOffline
              ? {
                  code: null,
                  name: "Offline",
                  color: "None",
                }
              : latestTicker?.status || {
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

