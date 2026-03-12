/*** alpha API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require("express");
const config = require("../../modules/config");
const router = express.Router();
const { DateTime, Duration, Interval } = require("luxon"); //For handling dates and times
const ObjectId = require("mongodb").ObjectId;
const startupDT = DateTime.now();
const bcrypt = require("bcryptjs");
const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  createMongoDateQuery,
  formatDuration,
  getHourlyIntervals,
  getStateCollectionName,
  getCountCollectionName,
} = require("../../utils/time");
const {
  fetchStatesForMachine,
  fetchStatesForOperator,
  groupStatesByMachine,
  groupStatesByOperator,
  extractCyclesFromStates,
  extractPausedCyclesFromStates,
  extractFaultCyclesFromStates,
  processAllMachinesCycles,
  getAllMachinesFromStates,
  calculateHourlyStateDurations,
  groupStatesByOperatorAndSerial,
  extractAllCyclesFromStates,
  getCompletedCyclesForOperator,
  extractFaultCycles,
} = require("../../utils/state");
const {
  getCountRecords,
  getOperatorItemMapFromCounts,
  getValidCounts,
  getMisfeedCounts,
  getValidCountsForOperator,
  getMisfeedCountsForOperator,
  getOperatorNameFromCount,
  extractItemNamesFromCounts,
  getCountsForOperator,
  getCountsForOperatorMachinePairs,
  groupCountsByOperatorAndMachine,
  processCountStatistics,
  getCountsForMachine,
  groupCountsByItem,
} = require("../../utils/count");
const {
  calculateRuntime,
  calculateDowntime,
  calculateTotalCount,
  calculateMisfeeds,
  calculateAvailability,
  calculateThroughput,
  calculateEfficiency,
  calculateOEE,
  calculateOperatorRuntime,
  calculateOperatorPausedTime,
  calculateOperatorFaultTime,
  calculatePiecesPerHour,
  calculateOperatorTimes,
} = require("../../utils/analytics");
const {
  buildMachineOEE,
  buildDailyItemHourlyStack,
  buildTopOperatorEfficiency,
} = require("../../utils/dashboardFunctions");

const { buildSoftrolCycleSummary } = require("../../utils/miscFunctions");
const {
  groupRecordsBySerial,
  buildPerformanceFromMachineRecord,
  buildItemSummaryFromRecords,
  buildCurrentOperatorsFromTicker: buildCurrentOperators,
  getBookendedStatesAndTimeRange,
} = require("../../utils/machineFunctions");

const xml = require("xml2js");

function alphaController(server) {
  return constructor(server);
}

function registerMachineXmlRoutes(app, server) {
  function xmlArrayBuilder(rootLabel, array, excludeHeader, callback) {
    const arrayBuilder = new xml.Builder({
      renderOpts: { pretty: false },
      headless: true,
      rootName: rootLabel,
    });
    let returnString;
    if (excludeHeader) {
      returnString = `<${rootLabel}s>`;
    } else {
      returnString = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${rootLabel}s>`;
    }

    array.forEach((element) => {
      returnString += arrayBuilder.buildObject(element);
    });
    returnString += `</${rootLabel}s>`;
    if (callback) {
      return callback(returnString);
    }
    return returnString;
  }

  app.get("/api/machine/levelone/multilaneDemo/xml", (req, res, next) => {
    res.set("Content-Type", "text/xml");

    const machineJSON = {
      fault: {
        code: 3,
        name: "Stop",
      },
    };

    const lanesJSON = [
      {
        operator: {
          id: null,
          name: "None Entered",
        },
        task: {
          id: 24,
          name: "BarMop",
        },
        pace: {
          standard: 1380,
          current: 0,
        },
        timeOnTask: 0,
        totalCount: 0,
        efficiency: 0,
      },
      {
        operator: {
          id: null,
          name: "None Entered",
        },
        task: {
          id: 24,
          name: "BarMop",
        },
        pace: {
          standard: 1380,
          current: 0,
        },
        timeOnTask: 0,
        totalCount: 0,
        efficiency: 0,
      },
      {
        operator: {
          id: null,
          name: "None Entered",
        },
        task: {
          id: 24,
          name: "BarMop",
        },
        pace: {
          standard: 1380,
          current: 0,
        },
        timeOnTask: 0,
        totalCount: 0,
        efficiency: 0,
      },
      {
        operator: {
          id: null,
          name: "None Entered",
        },
        task: {
          id: 24,
          name: "BarMop",
        },
        pace: {
          standard: 1380,
          current: 0,
        },
        timeOnTask: 0,
        totalCount: 0,
        efficiency: 0,
      },
    ];

    const levelOneBuilder = new xml.Builder({
      renderOpts: { pretty: false },
      rootName: "levelOne",
    });
    let xmlString = levelOneBuilder.buildObject(machineJSON);
    const splitArray = xmlString.split("</levelOne>");
    xmlString = splitArray[0];
    xmlString += xmlArrayBuilder("lane", lanesJSON, true);
    xmlString += "</levelOne>";

    res.send(xmlString);
  });

  app.get("/api/machine/levelone/:serialNumber/xml", (req, res, next) => {
    res.set("Content-Type", "text/xml");

    const jsonPackage = {
      operator: {
        id: null,
        name: "None Entered",
      },
      task: {
        id: 24,
        name: "BarMop",
      },
      pace: {
        standard: 1380,
        current: 0,
      },
      timeOnTask: 0,
      totalCount: 0,
      efficiency: 0,
      fault: {
        code: 3,
        name: "Stop",
      },
    };

    const levelOneBuilder = new xml.Builder({
      renderOpts: { pretty: false },
      rootName: "levelOne",
    });
    const xmlString = levelOneBuilder.buildObject(jsonPackage);

    res.send(xmlString);
  });

  app.get("/api/machine/leveltwo/:serialNumber/xml", (req, res, next) => {
    res.set("Content-Type", "text/xml");

    const jsonPackage = {
      timers: {
        run: 63,
        down: 0,
        total: 63,
      },
      programNumber: 2,
      item: {
        id: 1,
        name: "Incontinent Pad",
      },
      currentStats: {
        pace: 640,
        count: 284,
      },
      totals: {
        in: 2493,
        out: 2384,
        thru: 95.63,
        faults: 3,
        jams: 14,
      },
      availability: 86.55,
      oee: 68.47,
      operatorEfficiency: 68.47,
    };

    const levelTwoBuilder = new xml.Builder({
      renderOpts: { pretty: false },
      rootName: "levelTwo",
    });
    const xmlString = levelTwoBuilder.buildObject(jsonPackage);

    res.send(xmlString);
  });
}

alphaController.registerMachineXmlRoutes = registerMachineXmlRoutes;

module.exports = alphaController;

function constructor(server) {
  const db = server.db;
  const logger = server.logger;
  const passport = server.passport;

  // Import machine-related routes from machine controller (analytics + config)
  const machineRoutes = require("../machine")(server);
  router.use("/analytics", machineRoutes);

  // Import operator-related routes from operator controller (analytics + config)
  const operatorRoutes = require("../operator")(server);
  router.use("/", operatorRoutes);

  // Import daily dashboard-related routes (legacy sessions routes removed)

  // Import misc-related routes
  const miscRoutes = require("./miscRoutes")(server);
  router.use("/", miscRoutes);

  // Import level-two dashboard-related routes
  const levelTwoDashboardRoutes = require("./level-twoRoutes")(server);
  router.use("/analytics", levelTwoDashboardRoutes);

  // Import report routes from reports controller (cached machine/operator/item summaries)
  const reportRoutes = require("../reports")(server);
  router.use("/", reportRoutes);

  // Import item routes from item controller (cached + hybrid analytics)
  const itemRoutes = require("../item")(server);
  router.use("/", itemRoutes);

  // Import fault routes from fault controller
  const faultRoutes = require("../fault")(server);
  router.use("/", faultRoutes);

  // Import dashboard-related routes from dashboard controller
  const dashboardRoutes = require("../dashboard")(server);
  router.use("/", dashboardRoutes);

  router.get("/timestamp", (req, res, next) => {
    res.json(startupDT);
  });

  router.get("/currentTime/get", async (req, res, next) => {
    const currentDT = DateTime.now();
    const formatString = "yyyy-LL-dd-TT.SSS";
    const responseJSON = {
      currentTime: currentDT.toUTC().toFormat(formatString),
      currentLocalTime: currentDT.toFormat(formatString),
      timezone: currentDT.toFormat("z"),
      timezoneOffset: currentDT.toFormat("ZZZ"),
    };
    res.json(responseJSON);
  });

  router.get("/ac360/get", async (req, res, next) => {
    res.json("Hello AC360!");
  });

  router.get("/ac360/lastSession/get", async (req, res, next) => {
    let lastSessionStart, lastSessionEnd;
    let lastSessionStartTS, lastSessionEndTS;
    let diff;
    const statusCollection = db.collection("ac360-status");
    const countCollection = db.collection("ac360-count");
    const stackCollection = db.collection("ac360-stack");

    const lastStatusFind = await statusCollection
      .find({ "machineInfo.serial": 67421 })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();
    const lastStatus = Object.assign({}, lastStatusFind[0]);
    if (lastStatus.status.code == 0) {
      //System_Paused
      //Machine is currently paused, find the start of the session, then find the counts in the session
      let lastRunningStatusFind = await statusCollection
        .find({
          "machineInfo.serial": 67421,
          timestamp: { $lt: new Date(lastStatus.timestamp) },
        })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
      lastSessionStart = lastRunningStatusFind[0];
      lastSessionStartTS = new Date(lastSessionStart.timestamp);
      lastSessionEnd = lastStatus;
      lastSessionEndTS = new Date(lastSessionEnd.timestamp);
    } else if (lastStatus.status.code == 1) {
      lastSessionStart = lastStatus;
      lastSessionStartTS = new Date(lastSessionStart.timestamp);
    }

    let queryObject = {
      "machineInfo.serial": 67421,
    };

    if (lastSessionEndTS) {
      queryObject["timestamp"] = {
        $gte: lastSessionStartTS,
        $lte: lastSessionEndTS,
      };
      diff = Interval.fromDateTimes(
        DateTime.fromISO(lastSessionStartTS.toISOString()),
        DateTime.fromISO(lastSessionEndTS.toISOString())
      );
    } else {
      queryObject["timestamp"] = {
        $gte: lastSessionStartTS,
      };
      diff = Interval.fromDateTimes(
        DateTime.fromISO(lastSessionStartTS.toISOString()),
        DateTime.now()
      );
    }

    const countsFind = await countCollection
      .find(queryObject)
      .sort({ timestamp: 1 })
      .toArray();
    const stacksFind = await stackCollection
      .find(queryObject)
      .sort({ timestamp: 1 })
      .toArray();

    const sessionDuration = Duration.fromMillis(diff.length());
    const sessionDurationString =
      sessionDuration.as("seconds") > 60
        ? sessionDuration.as("minutes") + " minutes"
        : sessionDuration.as("seconds") + " seconds";

    res.json({
      duration: sessionDurationString,
      countTotal: countsFind.length,
      stackTotal: stacksFind.length,
      counts: countsFind,
      stacks: stacksFind,
    });
  });

  router.get("/sample/machineOverview", async (req, res, next) => {
    try {
      const serialParam =
        typeof req.query.serial !== "undefined"
          ? Number.parseInt(req.query.serial, 10)
          : null;

      // Today's date in Chicago (same as machine-dashboard-daily-cached)
      const today = new Date();
      const chicagoTime = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Chicago" })
      );
      const dateStr = chicagoTime.toISOString().split("T")[0];

      const cacheCollection = db.collection("totals-daily");
      const tickerColl = db.collection(config.stateTickerCollectionName);
      const faultSessionColl = db.collection(config.faultSessionCollectionName);

      const machineFilter = {
        entityType: "machine",
        date: dateStr,
      };
      if (Number.isFinite(serialParam)) {
        machineFilter.machineSerial = serialParam;
      }

      const machineTotals = await cacheCollection.find(machineFilter).toArray();

      let serial = Number.isFinite(serialParam) ? serialParam : null;
      let machineRecord = machineTotals.length > 0 ? machineTotals[0] : null;
      if (machineRecord) {
        serial = Number(machineRecord.machineSerial) || serial;
      }

      // If no totals-daily record, resolve machine from stateTicker
      if (!machineRecord) {
        let ticker;
        if (Number.isFinite(serial)) {
          ticker = await tickerColl.findOne({
            $or: [
              { "machine.id": serial },
              { "machine.serial": serial },
            ],
          });
        } else {
          ticker = await tickerColl.findOne({});
        }
        if (!ticker) {
          return res.status(500).json({
            error: "Failed to fetch machine overview data",
          });
        }
        serial = ticker.machine?.id ?? ticker.machine?.serial ?? serial;
      }

      const machineSerialFilter = Number.isFinite(serial) ? serial : null;
      if (machineSerialFilter === null) {
        return res.status(500).json({
          error: "Failed to fetch machine overview data",
        });
      }

      const tickerSerialFilter = [
        machineSerialFilter,
        String(machineSerialFilter),
      ];
      const [tickerDoc, faultSessionDoc, machineItemRecords] = await Promise.all([
        tickerColl.findOne({
          $or: [
            { "machine.serial": { $in: tickerSerialFilter } },
            { "machine.id": { $in: tickerSerialFilter } },
          ],
        }),
        faultSessionColl
          .find({
            $and: [
              {
                $or: [
                  { "machine.serial": machineSerialFilter },
                  { "machine.id": machineSerialFilter },
                ],
              },
              {
                $or: [
                  { "timestamps.end": { $exists: false } },
                  { "timestamps.end": null },
                ],
              },
            ],
          })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray()
          .then((arr) => arr[0])
          .catch(() => null),
        cacheCollection
          .find({
            entityType: "machine-item",
            date: dateStr,
            machineSerial: machineSerialFilter,
          })
          .toArray(),
      ]);

      // If no open fault session, get most recent fault session for this machine
      let faultDoc = faultSessionDoc;
      if (!faultDoc) {
        faultDoc = await faultSessionColl
          .find({
            $or: [
              { "machine.serial": machineSerialFilter },
              { "machine.id": machineSerialFilter },
            ],
          })
          .sort({ "timestamps.start": -1 })
          .limit(1)
          .toArray()
          .then((arr) => arr[0])
          .catch(() => null);
      }

      const ticker = tickerDoc;
      if (!ticker) {
        return res.status(500).json({
          error: "Failed to fetch machine overview data",
        });
      }

      const sessionStart = machineRecord?.timeRange?.start
        ? new Date(machineRecord.timeRange.start)
        : new Date(`${dateStr}T00:00:00.000Z`);
      const sessionEnd = machineRecord?.timeRange?.end
        ? new Date(machineRecord.timeRange.end)
        : chicagoTime;

      const performance = machineRecord
        ? buildPerformanceFromMachineRecord(machineRecord)
        : {
            runtime: { total: 0 },
            output: { totalCount: 0 },
          };

      const machineItems = machineItemRecords || [];
      const itemSummary = buildItemSummaryFromRecords(
        machineItems,
        sessionStart,
        sessionEnd
      );
      const sessionItems = itemSummary.sessions?.[0]?.items || [];
      const items = sessionItems.map((i) => ({
        id: i.itemId,
        count: i.countTotal || 0,
      }));
      if (items.length === 0 && ticker.items) {
        const tickerItems = Array.isArray(ticker.items)
          ? ticker.items
          : (ticker.program?.items && Array.isArray(ticker.program.items))
            ? ticker.program.items
            : [];
        tickerItems.forEach((it) => {
          items.push({
            id: it.id ?? it.number,
            count: 0,
          });
        });
      }

      const currentOperators = await buildCurrentOperators(db, machineSerialFilter);
      const tickerItemsForTasks = ticker.items || ticker.program?.items || [];
      const tasksFromTicker = Array.isArray(tickerItemsForTasks)
        ? tickerItemsForTasks.map((it) => ({
            name: it.name || `Item ${it.id ?? it.number}`,
            standard: Number(it.standard) || 0,
          }))
        : [];
      const timeOnTaskSec = Math.round(performance.runtime.total / 1000);

      const operators = currentOperators.map((op, idx) => {
        const pace =
          tasksFromTicker.length > 0 ? tasksFromTicker[0].standard : 0;
        return {
          id: op.operatorId,
          name: op.operatorName,
          pace,
          timeOnTask: timeOnTaskSec,
          count: op.metrics?.totalCount ?? 0,
          efficiency: Math.min(
            100,
            Math.max(0, op.metrics?.efficiencyPct ?? 0)
          ),
          station:
            Array.isArray(ticker.stations) && ticker.stations[idx] != null
              ? ticker.stations[idx]
              : idx + 1,
          tasks: tasksFromTicker,
        };
      });

      const status = ticker.status || {};
      const statusCode = status.id ?? status.code ?? 0;
      const statusName = status.name || "Unknown";
      const statusColor = status.softrolColor || "Gray";

      let fault = { code: 0, name: "None" };
      if (faultDoc) {
        const startState = faultDoc.states?.start ?? faultDoc.startState;
        const faultStatus = startState?.status;
        if (faultStatus) {
          fault = {
            code: faultStatus.id ?? faultStatus.code ?? 0,
            name: faultStatus.name || "Fault",
          };
        }
      }

      const overview = {
        machineInfo: {
          serial: machineSerialFilter,
          name:
            ticker.machine?.name ||
            machineRecord?.machineName ||
            `Serial ${machineSerialFilter}`,
        },
        fault,
        status: {
          code: statusCode,
          name: statusName,
          color: statusColor,
        },
        timeOnTask: timeOnTaskSec,
        onTime: timeOnTaskSec,
        totalCount: performance.output?.totalCount ?? 0,
        operators,
        items,
      };

      res.json(overview);
    } catch (err) {
      logger && logger.error(err);
      res.status(500).json({
        error: "Failed to fetch machine overview data",
      });
    }
  });

  router.post("/ac360/post", async (req, res, next) => {
    try {
    const currentDateTime = new Date(); //Timestamp of when request was started
    const now = new Date();
    let bodyJSON = Object.assign({}, req.body); //Deepcopy bodyJSON for mutable use
    if (bodyJSON.timestamp) {
      bodyJSON.timestamp = new Date(DateTime.fromISO(bodyJSON.timestamp + "Z")); //Format date as JS Date
      /** TEMPORARY FIX for future timestamps coming from AC360s on boot,  */
      if (bodyJSON.timestamp > currentDateTime) {
        bodyJSON.timestamp = currentDateTime; //Cap timestamp at now
      }
    } else {
      bodyJSON['timestamp'] = currentDateTime; //IF no timestamp on bodyJSON, add as now
    }

    let storeJSON = Object.assign({}, bodyJSON); //Deepcopy bodyJSON as storeJSON for mutable use
    if (req.socket.remoteAddress) { //If we have the IP of the requester from the request, add it to the machineInfo in storeJSON
      const ipStrings = req.socket.remoteAddress.split(":");
      storeJSON.machineInfo["ipAddress"] = "" + ipStrings[ipStrings.length - 1];
      if (storeJSON.machineInfo["ipAddress"] === "1") { //REMOVE BEFORE DEPLOY
        storeJSON.machineInfo["ipAddress"] = "192.168.0.1";
      }
    }
    const machine = Object.assign({}, storeJSON.machineInfo);
    const program = Object.assign({ mode: "ac360" }, storeJSON.programInfo);
    const items = program.items;
    const operators = [
      { id: storeJSON.operatorInfo.code, name: storeJSON.operatorInfo.name, station: 1 },
    ];
    const operator = operators[0];

    let collection = db.collection("ac360");
    if (storeJSON.status) {
      collection = db.collection("ac360-status");
      const stateType = "status";

      const status = Object.assign({}, storeJSON.status);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
          id: machine.serial,
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operators: operators,
        status: status,
      };

      const stateTickerResult = await db
        .collection("stateTicker")
        .replaceOne({ "machine.serial": machine.serial }, state, {
          upsert: true,
        });
      const stateResult = await db.collection("state").insertOne(state);

      const machineSessionArray = await db.collection('machine-session').find({ 'machine.serial': machine.serial, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
      if (machineSessionArray.length) {
        let session = machineSessionArray[0];
        const sessionID = session['_id'];
        if ((stateType) == 'status' && (state.status.code != session.startState.status.code)) {
          //Open session needs to close
          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];

          const update = {
            '$set': {
              'timestamps.end': now,
              'endState': state,
              'program': program,
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'states': state
            }
          }
          const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);

          //Session doesn't exist, start one
          const newSession = {
            timestamps: {
              create: now,
              update: now,
              start: now
            },
            counts: [],
            misfeeds: [],
            states: [state],
            program: program,
            items: items,
            operators: operators,
            startState: state,
            machine: machine
          }
          const insertNewSession = await db.collection('machine-session').insertOne(newSession);
        } else {
          //Open session for this machine exists and is open, append
          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];

          const update = {
            '$set': {
              'program': program,
              'items': items,
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'states': state
            }
          }
          const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);
        }
      } else {
        //Session doesn't exist, start one
        const newSession = {
          timestamps: {
            create: now,
            update: now,
            start: now
          },
          counts: [],
          misfeeds: [],
          states: [state],
          program: program,
          items: items,
          operators: operators,
          startState: state,
          machine: machine
        }
        const insertNewSession = await db.collection('machine-session').insertOne(newSession);
      }



      const operatorSessionArray = await db.collection('operator-session').find({ 'machine.serial': machine.serial, 'operator.id': operator.id, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
      if (operatorSessionArray.length) {
        let session = operatorSessionArray[0];
        const sessionID = session['_id'];
        if ((stateType) == 'status' && (state.status.code != session.startState.status.code)) {
          //Open session needs to close
          const now = new Date();
          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];
          const update = {
            '$set': {
              'timestamps.end': now,
              'endState': state,
              'program': program,
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'states': state
            }
          }
          const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
          //Session doesn't exist, start one
          const newSession = {
            timestamps: {
              create: now,
              update: now,
              start: now
            },
            counts: [],
            misfeeds: [],
            states: [state],
            program: program,
            items: items,
            operator: operator,
            startState: state,
            machine: machine
          }
          const insertNewSession = await db.collection('operator-session').insertOne(newSession);
        } else {
          const now = new Date();
          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];
          //Open session for this operator exists and is open, append
          const update = {
            '$set': {
              'program': program,
              'items': items,
              'program': program,
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'states': state
            }
          }
          const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
        }
      } else {
        //Session doesn't exist, start one
        const newSession = {
          timestamps: {
            create: new Date(),
            update: new Date(),
            start: new Date()
          },
          counts: [],
          misfeeds: [],
          states: [state],
          program: program,
          items: items,
          operator: operator,
          startState: state,
          machine: machine
        }
        const insertNewSession = await db.collection('operator-session').insertOne(newSession);
      }
    } else if (storeJSON.item) {
      collection = db.collection("ac360-count");

      //const operator = Object.assign({}, storeJSON.operatorInfo);

      const item = Object.assign({}, storeJSON.item);

      const formattedCount = {
        timestamp: storeJSON.timestamp,
        machine: {
          id: machine.serial,
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operator: operator,
        item: {
          id: item.id ? item.id : 0,
          //count: item.count,
          name: item.name,
          standard: program.pace * 60,
        },
        station: 1,
        lane: item.sortNumber,
      };

      const formattedMisfeed = {
        timestamp: storeJSON.timestamp,
        machine: {
          id: machine.serial,
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operator: operator,
        misfeed: true,
        station: 1
      }

      const insertFormattedCount = await db
        .collection("count")
        .insertOne(formattedCount);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
          id: machine.serial,
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operators: operators,
        status: {
          code: 1,
          name: "System_Running",
        },
      };

      const result = await db
        .collection("stateTicker")
        .replaceOne({ "machine.serial": machine.serial }, state, {
          upsert: true,
        });

      if (item.count) {
        const machineSessionArray = await db.collection('machine-session').find({ 'machine.serial': machine.serial, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
        if (machineSessionArray.length) {
          let session = machineSessionArray[0];
          const sessionID = session['_id'];
          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length + 1;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];

          const update = {
            '$set': {
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'counts': formattedCount
            }
          }
          const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);
        }


        const operatorSessionArray = await db.collection('operator-session').find({ 'machine.serial': machine.serial, 'operator.id': operator.id, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
        if (operatorSessionArray.length) {
          let session = operatorSessionArray[0];
          const sessionID = session['_id'];

          const standard = program.pace * 60;

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const totalCount = session.counts.length + 1;
          const totalCountByItem = [totalCount];
          const totalTimeCredit = totalCount * (standard / 3600);
          const timeCreditByItem = [totalTimeCredit];
          //Open session for this operator exists and is open, append
          const update = {
            '$set': {
              'runtime': runtime,
              'workTime': workTime,
              'totalCount': totalCount,
              'totalCountByItem': totalCountByItem,
              'totalTimeCredit': totalTimeCredit,
              'timeCreditByItem': timeCreditByItem
            },
            '$push': {
              'counts': formattedCount
            }
          }
          const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
        }
      } else { //Misfeed
        const machineSessionArray = await db.collection('machine-session').find({ 'machine.serial': machine.serial, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
        if (machineSessionArray.length) {
          let session = machineSessionArray[0];
          const sessionID = session['_id'];

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const misfeedCount = session.misfeeds.length + 1;

          const update = {
            '$set': {
              'runtime': runtime,
              'workTime': workTime,
              'misfeedCount': misfeedCount
            },
            '$push': {
              'misfeeds': formattedMisfeed
            }
          }
          const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);
        }


        const operatorSessionArray = await db.collection('operator-session').find({ 'machine.serial': machine.serial, 'operator.id': operator.id, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
        if (operatorSessionArray.length) {
          let session = machineSessionArray[0];
          const sessionID = session['_id'];

          const runtime = now - session.timestamps.start;
          const workTime = runtime;
          const misfeedCount = session.misfeeds.length + 1;
          //Open session for this operator exists and is open, append
          const update = {
            '$set': {
              'runtime': runtime,
              'workTime': workTime,
              'misfeedCount': misfeedCount
            },
            '$push': {
              'misfeeds': formattedMisfeed
            }
          }
          const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
        }
      }

    } else if (storeJSON.stack) {
      collection = db.collection("ac360-stack");
    }
    const result = await collection.insertOne(storeJSON);

    if (req.is("application/json")) {
      res.json({ receivedBody: storeJSON });
    } else if (req.body) {
      res.send(storeJSON);
    } else {
      res.json("No body received");
    }
    } catch (error) {
      logger.error(error);
      res.json("No body received");
    }
  });

  router.get("/levelone/all", async (req, res, next) => {
    const stateCollection = db.collection("state");
    const stateTickerCollection = db.collection("stateTicker");
    const countCollection = db.collection("count");

    //const currentDateTime = DateTime.now().toISO();
    let queryDateTime = DateTime.now().toISO();
    //const nowDateTime = DateTime.now().toISO();
    const startDate = new Date(queryDateTime);

    const activeMachineStates = await stateTickerCollection
      .find({ timestamp: { $lt: new Date(queryDateTime) } })
      .sort({ "machine.name": 1 })
      .toArray();

    async function machineSession(serial) {
      let machineStatesMostRecentFind = await stateCollection
        .find({
          "machine.serial": parseInt(serial),
          "status.code": { $ne: null },
        })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
      let machineStatesMostRecent;
      let machineStatesMostRecentTimestamp;
      if (machineStatesMostRecentFind.length) {
        machineStatesMostRecent = machineStatesMostRecentFind[0];
        machineStatesMostRecentTimestamp = new Date(
          machineStatesMostRecent.timestamp
        );
      }

      let diff;
      if (
        machineStatesMostRecent.status &&
        machineStatesMostRecent.status.code == 1
      ) {
        let machineStatesNextMostRecent;
        do {
          machineStatesMostRecentFind = await stateCollection
            .find({
              "machine.serial": parseInt(serial),
              "status.code": { $ne: null },
              timestamp: { $lt: new Date(machineStatesMostRecentTimestamp) },
            })
            .sort({ timestamp: -1 })
            .limit(1)
            .toArray();
          if (machineStatesMostRecentFind.length) {
            machineStatesNextMostRecent = machineStatesMostRecentFind[0];
            if (machineStatesNextMostRecent.status.code == 1) {
              machineStatesMostRecent = Object.assign(
                {},
                machineStatesNextMostRecent
              );
              machineStatesMostRecentTimestamp = new Date(
                machineStatesNextMostRecent.timestamp
              );
            } else {
              break;
            }
          } else {
            break;
          }
        } while (machineStatesNextMostRecent.status.code == 1);
        diff = Interval.fromDateTimes(
          DateTime.fromISO(machineStatesMostRecentTimestamp.toISOString()),
          DateTime.now()
        );
        const sessionDuration = Duration.fromMillis(diff.length());
        const sessionObject = {
          start: DateTime.fromISO(
            machineStatesMostRecentTimestamp.toISOString()
          ),
          end: DateTime.now(),
          duration: sessionDuration.as("seconds"),
          state: machineStatesMostRecent,
        };
        return sessionObject;
      } else if (machineStatesMostRecent.status) {
        diff = Interval.fromDateTimes(
          DateTime.fromISO(machineStatesMostRecentTimestamp.toISOString()),
          DateTime.now()
        );
        const sessionDuration = Duration.fromMillis(diff.length());
        const sessionObject = {
          start: machineStatesMostRecent.timestamp,
          end: DateTime.now(),
          duration: sessionDuration.as("seconds"),
          state: machineStatesMostRecent,
        };
        return sessionObject;
      } else {
        const sessionObject = {
          start: DateTime.now(),
          end: DateTime.now(),
          duration: 0,
          state: machineStatesMostRecent,
        };
        return sessionObject;
      }
    }

    const machineRunTimesArray = await Promise.all(
      activeMachineStates.map(async (machineState) => {
        if (machineState.status.code == 1) {
          const serial = machineState.machine.serial;
          const session = await machineSession(serial);
          //const machineDuration = arr.reduce((duration, session) => duration + session.duration, 0);
          const machineDuration = session.duration;

          const operators = await Promise.all(
            machineState.operators.map(async (operator) => {
              if (operator.id == 0) {
                operator.id = serial + 900000;
                //result.push({ id: serial + 900000, station: operator.station ? operator.station : 1 })
              }

              const pipeline = [
                {
                  $match: {
                    "machine.serial": serial,
                    "operator.id": operator.id,
                    station: operator.station ? operator.station : 1,
                    timestamp: { $gte: new Date(session.start) },
                  },
                },
                {
                  $group: {
                    _id: "$item.name",
                    count: {
                      $count: {},
                    },
                    standard: {
                      $first: "$item.standard",
                    },
                    operator: { $first: "$operator" },
                    station: { $first: "$station" },
                  },
                },
                {
                  $addFields: {
                    timeCreditDenom: {
                      $divide: ["$standard", 3600],
                    },
                  },
                },
                {
                  $addFields: {
                    timeCredit: {
                      $divide: ["$count", "$timeCreditDenom"],
                    },
                  },
                },
              ];

              const operatorItemTotals = await countCollection
                .aggregate(pipeline)
                .toArray();

              if (operatorItemTotals.length) {
                const runTime = parseInt(machineDuration);
                const operator = operatorItemTotals[0].operator;
                const station = operatorItemTotals[0].station;
                const operatorTotal = operatorItemTotals.reduce(
                  (total, item) => total + item.count,
                  0
                );
                const operatorTotalTimeCredit = operatorItemTotals.reduce(
                  (total, item) => {
                    if (item.standard < 60) {
                      return total + item.timeCredit / 60;
                    } else {
                      return total + item.timeCredit;
                    }
                  },
                  0
                );
                const operatorEfficiency = parseInt(
                  (operatorTotalTimeCredit / runTime) * 100
                );
                const operatorPace = (operatorTotal / (runTime / 60)) * 60;
                const tasks = operatorItemTotals.map((item) => {
                  let standard;
                  if (item.standard < 60) {
                    standard = item.standard * 60;
                  } else {
                    standard = item.standard;
                  }
                  return {
                    name: item["_id"],
                    standard: standard,
                  };
                });
                return {
                  id: operator.id || 0,
                  name: operator.name ? operator.name : operator.id,
                  pace: parseInt(operatorPace),
                  timeOnTask: parseInt(runTime),
                  count: parseInt(operatorTotal) || 0,
                  efficiency: operatorEfficiency,
                  station: station ? station : 1,
                  tasks: tasks,
                };
              }

              return;
            })
          );
          delete machineState.machine.ipAddress;
          if (machineState.status.softrolColor) {
            machineState.status.color = "" + machineState.status.softrolColor;
            delete machineState.status.softrolColor;
          }
          let fault = null;
          if (machineState.status.code >= 2) {
            if (machineState.status.color == null) {
              machineState.status.color = "Red";
            }
            fault = machineState.status;
          } else if (machineState.status.code == 1) {
            if (machineState.status.color == null) {
              machineState.status.color = "Green";
            }
          } else {
            if (machineState.status.color == null) {
              machineState.status.color = "Gray";
            }
          }
          const machineTotalCountFind = await countCollection
            .find({
              "machine.serial": parseInt(serial),
              timestamp: { $gte: new Date(queryDateTime) },
            })
            .toArray();
          let items = [];
          const totalCount = machineTotalCountFind.length;
          const itemTemplate = {
            id: 1,
            count: 0,
          };
          items.push(itemTemplate);
          items.push(itemTemplate);
          items.push(itemTemplate);
          items.push(itemTemplate);
          return {
            status: machineState.status,
            machineInfo: machineState.machine,
            fault: fault,
            timeOnTask: parseInt(machineDuration),
            onTime: parseInt(machineDuration),
            totalCount: parseInt(totalCount),
            items: items,
            operators: operators.filter((element) => element != null),
          };
        } else {
          delete machineState.machine.ipAddress;
          if (machineState.status.softrolColor) {
            machineState.status.color = "" + machineState.status.softrolColor;
            delete machineState.status.softrolColor;
          }
          let fault = null;
          if (machineState.status.code >= 2) {
            if (machineState.status.color == null) {
              machineState.status.color = "Red";
            }
            fault = machineState.status;
          } else if (machineState.status.code == 1) {
            if (machineState.status.color == null) {
              machineState.status.color = "Green";
            }
          } else {
            if (machineState.status.color == null) {
              machineState.status.color = "Gray";
            }
          }
          return {
            status: machineState.status,
            machineInfo: machineState.machine,
            fault: fault,
            timeOnTask: 0,
            onTime: 0,
            totalCount: 0,
            items: [],
            operators: [],
          };
        }
      })
    );
    res.json(machineRunTimesArray);
  });

  router.get("/production/statistics/machines/all", async (req, res, next) => {
    const stateCollection = db.collection("state");
    const stateTickerCollection = db.collection("stateTicker");
    const countCollection = db.collection("count");

    const currentDateTime = DateTime.now().startOf("day").toISO();
    const nowDateTime = DateTime.now().toISO();
    const startDate = new Date(currentDateTime);

    const activeMachineStates = await stateTickerCollection
      .find({ timestamp: { $gte: new Date(currentDateTime) } })
      .sort({ "machine.name": 1 })
      .toArray();

    async function machineSessions(serial) {
      let sessionArray = [];

      const machineStatesHistorySinceStart = await stateCollection
        .find({
          "machine.serial": parseInt(serial),
          status: { $ne: null },
          timestamp: { $gte: new Date(currentDateTime) },
        })
        .sort({ timestamp: -1 })
        .toArray();
      const machineStatesHistoryPreviousOne = await stateCollection
        .find({
          "machine.serial": parseInt(serial),
          status: { $ne: null },
          timestamp: { $lte: new Date(currentDateTime) },
        })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
      const machineStatesHistory = machineStatesHistorySinceStart.concat(
        machineStatesHistoryPreviousOne
      );
      while (machineStatesHistory.length) {
        let lastSessionStart, lastSessionEnd;
        let lastSessionStartTS, lastSessionEndTS;
        let diff;

        do {
          lastSessionStart = machineStatesHistory.pop();

          if (lastSessionStart.status.code == 1) {
            const lastSessionStartTSCheck = new Date(
              lastSessionStart.timestamp
            );
            if (startDate > lastSessionStartTSCheck) {
              lastSessionStartTS = startDate;
            } else {
              lastSessionStartTS = new Date(lastSessionStart.timestamp);
            }
          }
        } while (
          machineStatesHistory.length &&
          lastSessionStart.status.code != 1
        ); //HERE, NEED TO CONTINUE UNITL END FOUND

        if (machineStatesHistory.length) {
          do {
            lastSessionEnd = machineStatesHistory.pop();
          } while (
            machineStatesHistory.length &&
            lastSessionEnd.status.code == 1
          );
          if (!lastSessionEnd || lastSessionEnd.status.code == 1) {
            lastSessionEndTS = new Date();
          } else {
            lastSessionEndTS = new Date(lastSessionEnd.timestamp);
          }
        } else {
          lastSessionEndTS = new Date();
        }

        if (lastSessionStartTS && lastSessionEndTS) {
          diff = Interval.fromDateTimes(
            DateTime.fromISO(lastSessionStartTS.toISOString()),
            DateTime.fromISO(lastSessionEndTS.toISOString())
          );
        } else if (lastSessionStartTS) {
          lastSessionEndTS = new Date();
          diff = Interval.fromDateTimes(
            DateTime.fromISO(lastSessionStartTS.toISOString()),
            DateTime.fromISO(lastSessionEndTS.toISOString())
          );
        }

        if (diff && diff.isValid) {
          const sessionDuration = Duration.fromMillis(diff.length());
          const sessionDurationString =
            sessionDuration.as("seconds") > 60
              ? sessionDuration.as("minutes") + " minutes"
              : sessionDuration.as("seconds") + " seconds";
          let sessionObject = {
            start: DateTime.fromISO(lastSessionStartTS.toISOString()),
            duration: sessionDuration.as("seconds"),
          };
          sessionObject["end"] = DateTime.fromISO(
            lastSessionEndTS.toISOString()
          );
          sessionArray.push(sessionObject);
        }
      }
      return sessionArray;
    }

    const machineRunTimesArray = await Promise.all(
      activeMachineStates.map(async (machineState) => {
        const serial = machineState.machine.serial;
        const arr = await machineSessions(serial);
        const machineDuration = arr.reduce(
          (duration, session) => duration + session.duration,
          0
        );

        const operators = await Promise.all(
          machineState.operators.map(async (operator) => {
            if (operator.id == 0) {
              operator.id = serial + 900000;
              //result.push({ id: serial + 900000, station: operator.station ? operator.station : 1 })
            }

            const pipeline = [
              {
                $match: {
                  "machine.serial": serial,
                  "operator.id": operator.id,
                  station: operator.station ? operator.station : 1,
                  timestamp: { $gte: new Date(currentDateTime) },
                },
              },
              {
                $group: {
                  _id: "$item.name",
                  count: {
                    $count: {},
                  },
                  standard: {
                    $first: "$item.standard",
                  },
                  operator: { $first: "$operator" },
                  station: { $first: "$station" },
                },
              },
              {
                $addFields: {
                  timeCreditDenom: {
                    $divide: ["$standard", 3600],
                  },
                },
              },
              {
                $addFields: {
                  timeCredit: {
                    $divide: ["$count", "$timeCreditDenom"],
                  },
                },
              },
            ];

            const operatorItemTotals = await countCollection
              .aggregate(pipeline)
              .toArray();

            if (operatorItemTotals.length) {
              const runTime = parseInt(machineDuration);
              const operator = operatorItemTotals[0].operator;
              const station = operatorItemTotals[0].station;
              const operatorTotal = operatorItemTotals.reduce(
                (total, item) => total + item.count,
                0
              );
              const operatorTotalTimeCredit = operatorItemTotals.reduce(
                (total, item) => {
                  if (item.standard < 60) {
                    return total + item.timeCredit / 60;
                  } else {
                    return total + item.timeCredit;
                  }
                },
                0
              );
              const operatorEfficiency = parseInt(
                (operatorTotalTimeCredit / runTime) * 100
              );
              const operatorPace = (operatorTotal / (runTime / 60)) * 60;
              const tasks = operatorItemTotals.map((item) => {
                let standard;
                if (item.standard < 60) {
                  standard = item.standard * 60;
                } else {
                  standard = item.standard;
                }
                return {
                  name: item["_id"],
                  standard: standard,
                };
              });
              return {
                id: operator.id || 0,
                name: operator.name ? operator.name : operator.id,
                pace: parseInt(operatorPace),
                timeOnTask: parseInt(runTime),
                count: parseInt(operatorTotal) || 0,
                efficiency: operatorEfficiency,
                station: station ? station : 1,
                tasks: tasks,
              };
            }

            return;
          })
        );
        delete machineState.machine.ipAddress;
        if (machineState.status.softrolColor) {
          machineState.status.color = "" + machineState.status.softrolColor;
          delete machineState.status.softrolColor;
        }
        let fault = null;
        if (machineState.status.code >= 2) {
          if (machineState.status.color == null) {
            machineState.status.color = "Red";
          }
          fault = machineState.status;
        } else if (machineState.status.code == 1) {
          if (machineState.status.color == null) {
            machineState.status.color = "Green";
          }
        } else {
          if (machineState.status.color == null) {
            machineState.status.color = "Gray";
          }
        }
        const machineTotalCountFind = await countCollection
          .find({
            "machine.serial": parseInt(serial),
            timestamp: { $gte: new Date(currentDateTime) },
          })
          .toArray();
        let items = [];
        const totalCount = machineTotalCountFind.length;
        const itemTemplate = {
          id: 1,
          count: 0,
        };
        items.push(itemTemplate);
        items.push(itemTemplate);
        items.push(itemTemplate);
        items.push(itemTemplate);
        return {
          status: machineState.status,
          machineInfo: machineState.machine,
          fault: fault,
          timeOnTask: parseInt(machineDuration),
          onTime: parseInt(machineDuration),
          totalCount: parseInt(totalCount),
          items: items,
          operators: operators.filter((element) => element != null),
        };
      })
    );
    res.json(machineRunTimesArray);
  });

  router.get("/ticker/all", async (req, res, next) => {
    const tickerArray = await getTicker();
    res.json(tickerArray);
  });

  router.get("/ticker/machines/all", async (req, res, next) => {
    const machineListFromTicker = await getMachineListFromTicker();
    res.json(machineListFromTicker);
  });

  router.get("/counts/all", async (req, res, next) => {
    const counts = await getAllOperatorCounts();
    res.json(counts);
  });

  router.get("/machine/operator/lists", async (req, res, next) => {
    const lists = await getMachineOperatorLists();
    res.json(lists);
  });

  router.get("/machine/operator/counts", async (req, res, next) => {
    const machineList = await getMachineOperatorLists();
    let resultArray = [];
    for await (const machine of machineList) {
      const machineOperatorCounts = await getMachineOperatorCounts(machine);
      resultArray.push(machineOperatorCounts);
    }
    res.json(resultArray);
  });

  



  router.get("/historic-data-test", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      // Use latest timestamp from "state-test" instead of "state"
      const [latestState] = await db
        .collection("state-test")
        .find()
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();

      const effectiveEnd =
        new Date(end) > new Date() ? latestState?.timestamp || new Date() : end;

      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        start,
        effectiveEnd
      );

      // ✅ Fetch from "state-test" collection
      const allStates = await fetchStatesForOperator(
        db,
        null,
        paddedStart,
        paddedEnd,
        "state-test" // <-- updated to target "state-test"
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = { ...group, completedCycles };
        }
      }

      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        end
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      const results = [];
      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [operatorId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${operatorId}-${machineSerial}`];
        if (!countGroup) continue;

        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        for (const cycle of group.completedCycles) {
          const summary = buildSoftrolCycleSummary(
            cycle,
            sortedCounts,
            countGroup
          );

          if (summary) {
            results.push({
              operatorId: parseInt(operatorId),
              machineSerial: parseInt(machineSerial),
              ...summary,
            });
          }
        }
      }

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
