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
} = require("../../utils/dailyDashboardBuilder");

const { buildSoftrolCycleSummary } = require("../../utils/miscFunctions");
const {
  getBookendedStatesAndTimeRange,
} = require("../../utils/bookendingBuilder");

module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const db = server.db;
  const logger = server.logger;
  const passport = server.passport;

  // Import machine-related routes
  const machineRoutes = require("./machineRoutes")(server);
  router.use("/analytics", machineRoutes);

  // Import operator-related routes
  const operatorRoutes = require("./operatorRoutes")(server);
  router.use("/", operatorRoutes);

  // Import daily dashboard-related routes
  const dailyDashboardRoutes = require("./dailyDashboardRoutes")(server);
  router.use("/", dailyDashboardRoutes);

  // Import daily sessions dashboard-related routes
  const dailyDashboardSessionRoutes = require("./dailyDashboardSessionRoutes")(server);
  router.use("/", dailyDashboardSessionRoutes);

  // Import misc-related routes
  const miscRoutes = require("./miscRoutes")(server);
  router.use("/", miscRoutes);

  // Import level-two dashboard-related routes
  const levelTwoDashboardRoutes = require("./level-twoRoutes")(server);
  router.use("/analytics", levelTwoDashboardRoutes);

  // Import machine sessions routes
  const machineSessionsRoutes = require("./machineSessions")(server);
  router.use("/", machineSessionsRoutes);

  // Import operator sessions routes
  const operatorSessionsRoutes = require("./operatorSessions")(server);
  router.use("/", operatorSessionsRoutes);

  // Import efficiency screen (sessions-powered) routes
  const efficiencyScreenSessionRoutes = require("./efficiencyScreenSessionRoute")(server);
  router.use("/", efficiencyScreenSessionRoutes);

  // Import reports (sessions-powered) routes
  const reportsSessionRoutes = require("./reportsSessionRoutes")(server);
  router.use("/", reportsSessionRoutes);

  // Import item sessions (sessions-powered) routes
  const itemSessionsRoutes = require("./itemSessions")(server);
  router.use("/", itemSessionsRoutes);

  // Import machine-details routes
  const machineDetailsRoutes = require("./machineDetails..js")(server);
  router.use("/", machineDetailsRoutes);

  //Import dashboard-related routes
  const dashboardRoutes = require("./dashboardRoutes")(server);
  router.use("/", dashboardRoutes);

  router.get("/timestamp", (req, res, next) => {
    res.json(startupDT);
  });

  router.get("/currentTime/get", async (req, res, next) => {
    const currentDT = DateTime.now();
    const formatString = "yyyy-LL-dd-TT.SSS";
    //res.json(DateTime.now().toISO());
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

  router.post("/ac360/post", async (req, res, next) => {
    const currentDateTime = new Date();
    let bodyJSON = Object.assign({}, req.body);
    if (bodyJSON.timestamp) {
      bodyJSON.timestamp = new Date(DateTime.fromISO(bodyJSON.timestamp + "Z"));
      /** TEMPORARY FIX for future timestamps coming from AC360s on boot,  */
      if (bodyJSON.timestamp > currentDateTime) {
        bodyJSON.timestamp = currentDateTime;
      }
    }

    let storeJSON = Object.assign({}, bodyJSON);
    if (req.socket.remoteAddress) {
      const ipStrings = req.socket.remoteAddress.split(":");
      storeJSON.machineInfo["ipAddress"] = "" + ipStrings[ipStrings.length - 1];
    }
    const machine = Object.assign({}, storeJSON.machineInfo);
    const program = Object.assign({ mode: "ac360" }, storeJSON.programInfo);
    const operators = [
      { id: storeJSON.operatorInfo.code, name: storeJSON.operatorInfo.name },
    ];

    let collection = db.collection("ac360");
    if (storeJSON.status) {
      collection = db.collection("ac360-status");

      const status = Object.assign({}, storeJSON.status);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
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
    } else if (storeJSON.item) {
      collection = db.collection("ac360-count");

      const operator = Object.assign({}, storeJSON.operatorInfo);
      const item = Object.assign({}, storeJSON.item);

      const formattedCount = {
        timestamp: storeJSON.timestamp,
        machine: {
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operator: {
          id: operator.code,
          name: operator.name,
        },
        item: {
          id: item.id ? item.id : 0,
          //count: item.count,
          name: item.name,
          standard: program.pace,
        },
        station: 1,
        lane: item.sortNumber,
      };

      const insertFormattedCount = await db
        .collection("count")
        .insertOne(formattedCount);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
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

  /*** Run Session Start */
  //Machine specific count data for cycles within a timestamp range, needs timestamp range and serial number (WORKS !!)
  //Is it still required ?
  router.get("/run-session/state/cycles", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      // Step 3: Get all state records using state.js utility
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      // Step 4: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;

      // Step 5: For each cycle, get count records using count.js utility
      for (const cycle of runningCycles) {
        const countData = await getCountRecords(
          db,
          serial,
          cycle.start,
          cycle.end
        );
        cycle.counts = countData;
      }

      res.json(runningCycles);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to fetch session cycles" });
    }
  });

  /*** Run Session End */

  /***  Operator Cycle Start */
  //Machine Specific Operator Cycles (WORKS !!)
  //Is it still required ?
  router.get("/run-session/state/operator-cycles", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      // Step 3: Get all state records using state.js utility
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );
      // Step 4: Group states by machine using state.js utility
      const groupedByMachine = groupStatesByMachine(states);

      const allResults = [];

      for (const machineKey of Object.keys(groupedByMachine)) {
        const group = groupedByMachine[machineKey];
        const { serial: machineSerial, mode: machineMode } = group.machine;
        const isAc360 = machineMode === "ac360";

        // Step 5: Extract cycles using state.js utility
        const cycles = extractAllCyclesFromStates(group.states, start, end);
        const runningCycles = cycles.running;

        // Step 6: For each cycle, get count records and process operators
        for (const cycle of runningCycles) {
          const countRecords = await getCountRecords(
            db,
            machineSerial,
            cycle.start,
            cycle.end
          );

          // Step 7: Get operator-item mapping using count.js utility
          const operatorMap = getOperatorItemMapFromCounts(countRecords);

          // Step 8: Format operators data
          cycle.operators = Object.entries(operatorMap).map(([opId, data]) => {
            const items = Object.entries(data.items).map(
              ([itemId, itemArray]) => ({
                id: itemArray[0].id,
                name: itemArray[0].name,
                standard: itemArray[0].standard,
                count: itemArray.length,
              })
            );

            return {
              id: parseInt(opId),
              name: data.name,
              items,
            };
          });
        }

        allResults.push({
          machine: group.machine,
          cycles: runningCycles,
        });
      }

      res.json(allResults);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator-based session cycles" });
    }
  });

  /***  Operator Cycle End */

  /***  Analytics Routes Start */

  // Analytics Route sorted by Machine - for the Machine Analytics dashboard (WORKS !!)
  router.get("/analytics/machine-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);
      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (serial) {
        // If serial provided, get states for just that machine
        const machineStates = await fetchStatesForMachine(
          db,
          serial,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this machine
        groupedStates = {
          [serial]: {
            machine: {
              serial: serial,
              name: machineStates[0]?.machine?.name || null,
              mode: machineStates[0]?.program?.mode || null,
            },
            states: machineStates,
          },
        };
      } else {
        // If no serial, get all states and group them
        const allStates = await fetchStatesForMachine(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByMachine(allStates);
      }

      const results = [];

      // Process each machine's states
      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const states = group.states;

        // Skip if no states found for this machine
        if (!states.length) continue;

        // Extract all types of cycles
        const cycles = extractAllCyclesFromStates(states, start, end);
        const runningCycles = cycles.running;

        // Get counts for this machine
        const validCounts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        // Get misfeed counts for this machine
        const misfeedCounts = await getMisfeedCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );

        // Calculate metrics for this machine
        const totalQueryMs = new Date(end) - new Date(start);
        const runtimeMs = runningCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );
        const downtimeMs = calculateDowntime(totalQueryMs, runtimeMs);
        const totalCount = calculateTotalCount(validCounts, misfeedCounts);
        const misfeedCount = calculateMisfeeds(misfeedCounts);
        const availability = calculateAvailability(
          runtimeMs,
          downtimeMs,
          totalQueryMs
        );
        const throughput = calculateThroughput(totalCount, misfeedCount);
        const efficiency = calculateEfficiency(
          runtimeMs,
          totalCount,
          validCounts
        );
        const oee = calculateOEE(availability, efficiency, throughput);

        // Get current status for this machine
        const currentState = states[states.length - 1] || {};

        // Format response for this machine
        const machineResponse = {
          machine: {
            name: currentState.machine?.name || "Unknown",
            serial: currentState.machine?.serial || parseInt(machineSerial),
          },
          currentStatus: {
            code: currentState.status?.code || 0,
            name: currentState.status?.name || "Unknown",
          },
          metrics: {
            runtime: {
              total: runtimeMs,
              formatted: formatDuration(runtimeMs),
            },
            downtime: {
              total: downtimeMs,
              formatted: formatDuration(downtimeMs),
            },
            output: {
              totalCount,
              misfeedCount,
            },
            performance: {
              availability: {
                value: availability,
                percentage: (availability * 100).toFixed(2) + "%",
              },
              throughput: {
                value: throughput,
                percentage: (throughput * 100).toFixed(2) + "%",
              },
              efficiency: {
                value: efficiency,
                percentage: (efficiency * 100).toFixed(2) + "%",
              },
              oee: {
                value: oee,
                percentage: (oee * 100).toFixed(2) + "%",
              },
            },
          },
          timeRange: {
            start: start,
            end: end,
            total: formatDuration(totalQueryMs),
          },
        };

        results.push(machineResponse);
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch machine performance metrics" });
    }
  });

  // Analytics Route sorted by Machine - For the multiple bar chart in  non array format(WORKS !!)
  //Is it still required ?
  router.get("/analytics/machine-state-totals", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);
      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let results;

      if (serial) {
        // If serial provided, process single machine
        const states = await fetchStatesForMachine(
          db,
          serial,
          paddedStart,
          paddedEnd
        );

        if (!states.length) {
          return res.json([]);
        }

        // Extract all types of cycles
        const cycles = extractAllCyclesFromStates(states, start, end);
        const runningCycles = cycles.running;
        const pausedCycles = cycles.paused;
        const faultCycles = cycles.fault;

        // Calculate total durations
        const runningTime = runningCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );
        const pausedTime = pausedCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );
        const faultedTime = faultCycles.reduce(
          (total, cycle) => total + cycle.duration,
          0
        );

        // Helper function to format duration with hours, minutes, and seconds
        const formatDurationWithSeconds = (ms) => {
          const totalSeconds = Math.floor(ms / 1000);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          return {
            hours,
            minutes,
            seconds,
          };
        };

        // Format response for this machine
        results = [
          {
            machine: {
              name: states[0].machine?.name || "Unknown",
              serial: parseInt(serial),
            },
            timeTotals: {
              running: {
                total: runningTime,
                formatted: formatDurationWithSeconds(runningTime),
                cycles: runningCycles,
              },
              paused: {
                total: pausedTime,
                formatted: formatDurationWithSeconds(pausedTime),
                cycles: pausedCycles,
              },
              faulted: {
                total: faultedTime,
                formatted: formatDurationWithSeconds(faultedTime),
                cycles: faultCycles,
              },
            },
            timeRange: {
              start: start,
              end: end,
              total: formatDurationWithSeconds(new Date(end) - new Date(start)),
            },
          },
        ];
      } else {
        // If no serial provided, process all machines
        results = await processAllMachinesCycles(db, paddedStart, paddedEnd);
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch machine state time totals" });
    }
  });

  // Analytics Route sorted by Machine - For the multiple bar chart (WORKS !!)

  router.get("/analytics/machine-hourly-states", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let machines;
      if (serial) {
        machines = [{ serial: parseInt(serial) }];
      } else {
        machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
      }

      const startDate = new Date(end);
      const titleDate = startDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      });

      const results = [];

      for (const machine of machines) {
        const states = await fetchStatesForMachine(
          db,
          machine.serial,
          paddedStart,
          paddedEnd
        );
        if (!states.length) continue;

        const cycles = extractAllCyclesFromStates(states, start, end);
        const runningCycles = cycles.running;
        const pausedCycles = cycles.paused;
        const faultCycles = cycles.fault;

        const runningHours = calculateHourlyStateDurations(
          runningCycles,
          start,
          end,
          "Running"
        );
        const pausedHours = calculateHourlyStateDurations(
          pausedCycles,
          start,
          end,
          "Paused"
        );
        const faultedHours = calculateHourlyStateDurations(
          faultCycles,
          start,
          end,
          "Faulted"
        );

        results.push({
          title: `Machine Activity - ${titleDate}`,
          data: {
            hours: Array.from({ length: 24 }, (_, i) => i),
            series: {
              Running: runningHours,
              Paused: pausedHours,
              Faulted: faultedHours,
            },
          },
          machine: {
            name: states[0].machine?.name || "Unknown",
            serial: machine.serial,
          },
        });
      }

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch machine state time totals" });
    }
  });

  // Analytics Route sorted by Operator (WORKS !!)
  router.get("/analytics/operator-performance", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (operatorId) {
        // If operatorId provided, get states for just that operator
        states = await fetchStatesForOperator(
          db,
          operatorId,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this operator
        groupedStates = {
          [operatorId]: {
            operator: {
              id: operatorId,
              name: await getOperatorNameFromCount(db, operatorId),
            },
            states: states,
          },
        };
      } else {
        // If no operatorId, get all states and group them by operator
        const allStates = await fetchStatesForOperator(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByOperator(allStates);

        // Update operator names for all groups
        for (const [opId, group] of Object.entries(groupedStates)) {
          group.operator.name = await getOperatorNameFromCount(db, opId);
        }
      }

      // Step 3: Get all operator IDs for count query
      const operatorIds = Object.keys(groupedStates).map((id) => parseInt(id));

      // Get counts for all operators in a single query
      const allCounts = await db
        .collection("count")
        .find({
          "operator.id": { $in: operatorIds },
          timestamp: { $gte: new Date(start), $lte: new Date(end) },
        })
        .sort({ timestamp: 1 })
        .toArray();

      // Group counts by operator
      const operatorCounts = {};
      for (const count of allCounts) {
        const opId = count.operator?.id;
        if (!opId) continue;

        if (!operatorCounts[opId]) {
          operatorCounts[opId] = {
            counts: [],
            validCounts: [],
            misfeedCounts: [],
          };
        }

        operatorCounts[opId].counts.push(count);
        if (count.misfeed) {
          operatorCounts[opId].misfeedCounts.push(count);
        } else {
          operatorCounts[opId].validCounts.push(count);
        }
      }

      const results = [];

      // Step 4: Process each operator's data in parallel
      const operatorResults = await Promise.all(
        Object.entries(groupedStates).map(async ([operatorId, group]) => {
          const states = group.states;

          // Skip if no states found for this operator
          if (!states.length) return null;

          // Get counts for this operator
          const counts = operatorCounts[parseInt(operatorId)];
          if (!counts) return null;

          // Process count statistics using the new utility function
          const stats = processCountStatistics(counts.counts);

          // Calculate metrics for this operator
          const totalQueryMs = new Date(end) - new Date(start);
          const {
            runtime: runtimeMs,
            pausedTime: pausedTimeMs,
            faultTime: faultTimeMs,
          } = calculateOperatorTimes(states, start, end);

          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            counts.validCounts
          );

          // Get current status for this operator
          const currentState = states[states.length - 1] || {};

          // Format response for this operator
          return {
            operator: {
              id: parseInt(operatorId),
              name: group.operator.name || "Unknown",
            },
            currentStatus: {
              code: currentState.status?.code || 0,
              name: currentState.status?.name || "Unknown",
            },
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              pausedTime: {
                total: pausedTimeMs,
                formatted: formatDuration(pausedTimeMs),
              },
              faultTime: {
                total: faultTimeMs,
                formatted: formatDuration(faultTimeMs),
              },
              output: {
                totalCount: stats.total,
                misfeedCount: stats.misfeeds,
                validCount: stats.valid,
              },
              performance: {
                piecesPerHour: {
                  value: piecesPerHour,
                  formatted: Math.round(piecesPerHour).toString(),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2) + "%",
                },
              },
            },
            timeRange: {
              start: start,
              end: end,
              total: formatDuration(totalQueryMs),
            },
          };
        })
      );

      // Filter out null results and send response
      res.json(operatorResults.filter((result) => result !== null));
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator performance metrics" });
    }
  });

  /***  Analytics Route End */

  // // Softrol Route start (WORKS !!)

  // router.get("/softrol/get-softrol-data", async (req, res) => {
  //   try {
  //     // Step 1: Validate start parameter
  //     const start = req.query.start;
  //     if (!start) {
  //       return res
  //         .status(400)
  //         .json({ error: "Start time parameter is required" });
  //     }

  //     // Validate start is a valid ISO date string
  //     const startDate = new Date(start);
  //     if (isNaN(startDate.getTime())) {
  //       return res.status(400).json({
  //         error: "Invalid start time format. Please use ISO date string",
  //       });
  //     }

  //     // Step 2: Handle end parameter
  //     let endDate;
  //     if (req.query.end) {
  //       // If end parameter is provided, validate it
  //       endDate = new Date(req.query.end);
  //       if (isNaN(endDate.getTime())) {
  //         return res.status(400).json({
  //           error: "Invalid end time format. Please use ISO date string",
  //         });
  //       }
  //     }

  //     // Step 3: Get latest state and create time range in parallel
  //     const [latestState] = await Promise.all([
  //       db
  //         .collection("state")
  //         .find()
  //         .sort({ timestamp: -1 })
  //         .limit(1)
  //         .toArray(),
  //       // Add any other independent operations here
  //     ]);

  //     // Use provided end date or default to latest state/current time
  //     const end = endDate
  //       ? endDate.toISOString()
  //       : latestState?.timestamp || new Date().toISOString();
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(
  //       startDate,
  //       new Date(end)
  //     );

  //     // Step 4: Fetch states and process cycles in parallel
  //     const [allStates] = await Promise.all([
  //       fetchStatesForOperator(db, null, paddedStart, paddedEnd),
  //       // Add any other independent operations here
  //     ]);

  //     const groupedStates = groupStatesByOperatorAndSerial(allStates);

  //     // Process completed cycles for each operator-machine group
  //     const completedCyclesByGroup = {};
  //     for (const [key, group] of Object.entries(groupedStates)) {
  //       const completedCycles = getCompletedCyclesForOperator(group.states);
  //       if (completedCycles.length > 0) {
  //         completedCyclesByGroup[key] = {
  //           ...group,
  //           completedCycles,
  //         };
  //       }
  //     }

  //     // Get all operator IDs and machine serials
  //     const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
  //       (key) => {
  //         const [operatorId, machineSerial] = key.split("-");
  //         return {
  //           operatorId: parseInt(operatorId),
  //           machineSerial: parseInt(machineSerial),
  //         };
  //       }
  //     );

  //     // Step 5: Get counts and process results in parallel
  //     const [allCounts] = await Promise.all([
  //       getCountsForOperatorMachinePairs(db, operatorMachinePairs, start, end),
  //       // Add any other independent operations here
  //     ]);

  //     // Group the counts by operator and machine for easier processing
  //     const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

  //     // Step 6: Process each group and its completed cycles individually
  //     const results = [];

  //     for (const [key, group] of Object.entries(completedCyclesByGroup)) {
  //       const [operatorId, machineSerial] = key.split("-");
  //       const countGroup = groupedCounts[`${operatorId}-${machineSerial}`];
  //       if (!countGroup) continue;

  //       // Pre-sort counts by timestamp ASCENDING (important)
  //       const sortedCounts = countGroup.counts.sort(
  //         (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  //       );

  //       let countIndex = 0; // pointer for counts

  //       for (const cycle of group.completedCycles) {
  //         const cycleStart = new Date(cycle.start);
  //         const cycleEnd = new Date(cycle.end);

  //         const cycleCounts = [];

  //         // Move countIndex forward while counts are within cycle window
  //         while (countIndex < sortedCounts.length) {
  //           const currentCount = sortedCounts[countIndex];
  //           const countTimestamp = new Date(currentCount.timestamp);

  //           if (countTimestamp < cycleStart) {
  //             countIndex++;
  //             continue;
  //           }
  //           if (countTimestamp > cycleEnd) {
  //             break; // current count is after this cycle
  //           }

  //           // count is inside this cycle
  //           cycleCounts.push(currentCount);
  //           countIndex++;
  //         }

  //         if (!cycleCounts.length) continue; // no counts in this cycle, skip

  //         // Process stats for this cycle
  //         const stats = processCountStatistics(cycleCounts);
  //         const { runtime: runtimeMs } = calculateOperatorTimes(
  //           cycle.states,
  //           cycleStart,
  //           cycleEnd
  //         );
  //         const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
  //         const efficiency = calculateEfficiency(
  //           runtimeMs,
  //           stats.total,
  //           countGroup.validCounts
  //         );
  //         const itemNames = extractItemNamesFromCounts(cycleCounts);

  //         results.push({
  //           operatorId: parseInt(operatorId),
  //           machineSerial: parseInt(machineSerial),
  //           startTimestamp: cycleStart.toISOString(),
  //           endTimestamp: cycleEnd.toISOString(),
  //           totalCount: stats.total,
  //           task: itemNames,
  //           standard: Math.round(piecesPerHour * efficiency),
  //         });
  //       }
  //     }

  //     res.json(results);
  //   } catch (error) {
  //     logger.error("Error in softrol data processing:", error);
  //     res.status(500).json({ error: "Failed to process softrol data" });
  //   }
  // });
  // // Softrol Route end

  // API Route for line chart data for OEE% and individual operator efficiency% by hour start

  router.get("/analytics/machine/operator-efficiency", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, serial } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Step 3: Get hourly intervals
      const hourlyIntervals = getHourlyIntervals(paddedStart, paddedEnd);

      // Step 4: Get states and counts for the entire period
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );
      const counts = await getCountsForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 5: Process each hour
      const hourlyData = await Promise.all(
        hourlyIntervals.map(async (interval) => {
          // Filter states and counts for this hour
          const hourStates = states.filter((state) => {
            const stateTime = new Date(state.timestamp);
            return stateTime >= interval.start && stateTime <= interval.end;
          });

          const hourCounts = counts.filter((count) => {
            const countTime = new Date(count.timestamp);
            return countTime >= interval.start && countTime <= interval.end;
          });

          // Group counts by operator and machine
          const groupedCounts = groupCountsByOperatorAndMachine(hourCounts);

          // Calculate metrics for each operator
          const operatorMetrics = {};

          // Get unique operator IDs from counts
          const operatorIds = new Set();
          hourCounts.forEach((count) => {
            if (count.operator && count.operator.id) {
              operatorIds.add(count.operator.id);
            }
          });

          // Calculate total runtime for the hour from states
          const { runtime: totalRuntime } = calculateOperatorTimes(
            hourStates,
            interval.start,
            interval.end
          );

          // Process each operator
          for (const operatorId of operatorIds) {
            const countGroup = groupedCounts[`${operatorId}-${serial}`];
            if (!countGroup) continue;

            // Get operator name from first count
            const operatorName =
              countGroup.counts[0]?.operator?.name || "Unknown";

            // Process count statistics
            const stats = processCountStatistics(countGroup.counts);

            // Calculate efficiency
            const efficiency = calculateEfficiency(
              totalRuntime,
              stats.total,
              countGroup.validCounts
            );

            operatorMetrics[operatorId] = {
              name: operatorName,
              runTime: totalRuntime,
              validCounts: stats.valid,
              totalCounts: stats.total,
              efficiency: efficiency * 100, // Convert to percentage
            };
          }

          // Calculate OEE for this hour
          const hourDuration = interval.end - interval.start;
          const availability = (totalRuntime / hourDuration) * 100;

          const avgEfficiency =
            Object.values(operatorMetrics).length > 0
              ? Object.values(operatorMetrics).reduce(
                  (sum, op) => sum + op.efficiency,
                  0
                ) / Object.keys(operatorMetrics).length
              : 0;

          const totalValidCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.validCounts,
            0
          );
          const totalCounts = Object.values(operatorMetrics).reduce(
            (sum, op) => sum + op.totalCounts,
            0
          );
          const throughput =
            totalCounts > 0 ? (totalValidCounts / totalCounts) * 100 : 0;

          const oee =
            calculateOEE(
              availability / 100,
              avgEfficiency / 100,
              throughput / 100
            ) * 100;

          return {
            hour: interval.start.toISOString(),
            oee: Math.round(oee * 100) / 100,
            operators: Object.entries(operatorMetrics).map(([id, metrics]) => ({
              id: parseInt(id),
              name: metrics.name,
              efficiency: Math.round(metrics.efficiency * 100) / 100,
            })),
          };
        })
      );

      // Step 6: Format response
      const response = {
        machine: {
          serial: parseInt(serial),
          name: states[0]?.machine?.name || "Unknown",
        },
        timeRange: {
          start: start,
          end: end,
          total: formatDuration(new Date(end) - new Date(start)),
        },
        hourlyData,
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to calculate operator efficiency" });
    }
  });

  // API Route for line chart data for OEE% and individual operator efficiency% by hour end

  //API Route for operator count by item start
  router.get("/analytics/operator-countbyitem", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      // Validate start
      if (!start)
        return res
          .status(400)
          .json({ error: "Start time parameter is required" });
      const startDate = new Date(start);
      if (isNaN(startDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid start time format. Use ISO string" });
      }

      // Validate operatorId
      if (!operatorId || isNaN(parseInt(operatorId))) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      // Validate end
      let endDate;
      if (end) {
        endDate = new Date(end);
        if (isNaN(endDate.getTime())) {
          return res
            .status(400)
            .json({ error: "Invalid end time format. Use ISO string" });
        }
      }

      const [latestState] = await Promise.all([
        db
          .collection("state")
          .find()
          .sort({ timestamp: -1 })
          .limit(1)
          .toArray(),
      ]);

      const finalEnd = endDate
        ? endDate.toISOString()
        : latestState?.timestamp || new Date().toISOString();
      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        new Date(finalEnd)
      );

      // Fetch states for specific operator
      const allStates = await fetchStatesForOperator(
        db,
        parseInt(operatorId),
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = {
            ...group,
            completedCycles,
          };
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
        finalEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      const results = [];

      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [opId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${opId}-${machineSerial}`];
        if (!countGroup) continue;

        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
        let countIndex = 0;

        for (const cycle of group.completedCycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleCounts = [];

          while (countIndex < sortedCounts.length) {
            const currentCount = sortedCounts[countIndex];
            const countTimestamp = new Date(currentCount.timestamp);

            if (countTimestamp < cycleStart) {
              countIndex++;
              continue;
            }
            if (countTimestamp > cycleEnd) break;

            cycleCounts.push(currentCount);
            countIndex++;
          }

          if (!cycleCounts.length) continue;

          const stats = processCountStatistics(cycleCounts);
          const { runtime: runtimeMs } = calculateOperatorTimes(
            cycle.states,
            cycleStart,
            cycleEnd
          );
          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            countGroup.validCounts
          );
          const itemNames = extractItemNamesFromCounts(cycleCounts);

          results.push({
            operatorId: parseInt(opId),
            machineSerial: parseInt(machineSerial),
            startTimestamp: cycleStart.toISOString(),
            endTimestamp: cycleEnd.toISOString(),
            totalCount: stats.valid,
            task: itemNames,
            standard: Math.round(piecesPerHour * efficiency),
          });
        }
      }

      // === Post-process results into hourly stacked bar chart format ===
      const hourItemMap = {};
      const itemsSet = new Set();

      // Distribute counts evenly per task per hour
      for (const entry of results) {
        const ts = new Date(entry.startTimestamp);
        const hour = ts.getHours();

        const tasks =
          typeof entry.task === "string"
            ? entry.task.split(",").map((t) => t.trim())
            : [];
        const perItemCount = Math.floor(entry.totalCount / tasks.length);

        tasks.forEach((item) => {
          itemsSet.add(item);
          if (!hourItemMap[hour]) hourItemMap[hour] = {};
          if (!hourItemMap[hour][item]) hourItemMap[hour][item] = 0;
          hourItemMap[hour][item] += perItemCount;
        });
      }

      // Build full list of hour integers between start and end
      const fullHourRange = [];
      const temp = new Date(startDate);
      temp.setMinutes(0, 0, 0);
      const endHourDate = new Date(endDate);
      endHourDate.setMinutes(0, 0, 0);

      while (temp <= endHourDate) {
        fullHourRange.push(temp.getHours());
        temp.setHours(temp.getHours() + 1);
      }

      // Format hours to '1am', '12pm', etc.
      function formatHour(hour) {
        if (hour === 0) return "12am";
        if (hour === 12) return "12pm";
        if (hour < 12) return `${hour}am`;
        return `${hour - 12}pm`;
      }

      const formattedHours = fullHourRange.map(formatHour);

      // Ensure operator/item counts match the full hour list
      const allItems = Array.from(itemsSet).sort();
      const operators = {};
      for (const item of allItems) {
        operators[item] = fullHourRange.map(
          (hour) => hourItemMap[hour]?.[item] || 0
        );
      }

      // Final response
      const response = {
        title: "Operator Counts by item",
        data: {
          hours: fullHourRange,
          operators,
        },
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to process data for operator" });
    }
  });
  //API Route for operator count by item end

  // API route for machine fault history start
  router.get("/analytics/fault-history", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      // Fetch states for the specified machine
      const states = await fetchStatesForMachine(
        db,
        serial,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummary: [] });
      }

      // Extract fault cycles
      const { faultCycles, faultSummaries } = extractFaultCycles(
        states,
        start,
        end
      );

      res.json({
        faultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch fault history" });
    }
  });

  // API route for machine fault history end

  //API route for operator fault history start

  router.get("/analytics/operator-fault-history", async (req, res) => {
    try {
      const { start, end, operatorId } = req.query;

      if (!start || !end || !operatorId) {
        return res
          .status(400)
          .json({ error: "Start time, end time, and operatorId are required" });
      }

      // Convert string dates to Date objects
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Please use ISO date strings" });
      }

      const { paddedStart, paddedEnd } = createPaddedTimeRange(
        startDate,
        endDate
      );
      const parsedOperatorId = parseInt(operatorId);

      if (isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Invalid operatorId" });
      }

      // Get all machine states where this operator was present
      const states = await fetchStatesForOperator(
        db,
        parsedOperatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json({ faultCycles: [], faultSummaries: [] });
      }

      // Group states by machine to process each machine's fault cycles separately
      const groupedStates = groupStatesByOperatorAndSerial(states);
      const allFaultCycles = [];
      const faultTypeMap = new Map(); // For aggregating fault summaries

      // Process each machine's states
      for (const [key, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";

        // Extract fault cycles for this machine
        const { faultCycles, faultSummaries } = extractFaultCycles(
          machineStates,
          startDate,
          endDate
        );

        // Add machine info to each fault cycle
        const machineFaultCycles = faultCycles.map((cycle) => ({
          ...cycle,
          machineName,
          machineSerial: group.machine?.serial,
        }));

        allFaultCycles.push(...machineFaultCycles);

        // Aggregate fault summaries
        for (const summary of faultSummaries) {
          const key = summary.faultType;
          if (!faultTypeMap.has(key)) {
            faultTypeMap.set(key, {
              faultType: key,
              count: 0,
              totalDuration: 0,
            });
          }
          const existing = faultTypeMap.get(key);
          existing.count += summary.count;
          existing.totalDuration += summary.totalDuration;
        }
      }

      // Convert fault summaries to array and format durations
      const faultSummaries = Array.from(faultTypeMap.values()).map(
        (summary) => {
          const totalSeconds = Math.floor(summary.totalDuration / 1000);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          return {
            ...summary,
            formatted: {
              hours,
              minutes,
              seconds,
            },
          };
        }
      );

      // Sort fault cycles by start time
      allFaultCycles.sort((a, b) => new Date(a.start) - new Date(b.start));

      res.json({
        faultCycles: allFaultCycles,
        faultSummaries,
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to fetch operator fault history" });
    }
  });

  //API route for operator fault history end

  //API route for machine item summary start
  //Orignal route for machine item summary with all the items (not aggregated)
  // router.get("/analytics/machine-item-summary", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const allStates = await fetchStatesForMachine(db, serial || null, paddedStart, paddedEnd);
  //     if (!allStates.length) return res.json([]);

  //     const groupedStates = groupStatesByMachine(allStates);
  //     const results = [];

  //     for (const [machineSerial, group] of Object.entries(groupedStates)) {
  //       const machineName = group.machine?.name || "Unknown";
  //       const machineStates = group.states;
  //       const cycles = extractAllCyclesFromStates(machineStates, start, end).running;

  //       const allCounts = await getValidCounts(db, parseInt(machineSerial), start, end);

  //       const machineSummary = {
  //         totalCount: 0,
  //         totalWorkedMs: 0,
  //         itemSummaries: {},
  //       };

  //       const sessions = [];

  //       for (const cycle of cycles) {
  //         const cycleStart = new Date(cycle.start);
  //         const cycleEnd = new Date(cycle.end);
  //         const cycleMs = cycleEnd - cycleStart;

  //         const cycleCounts = allCounts.filter((c) => {
  //           const ts = new Date(c.timestamp);
  //           return ts >= cycleStart && ts <= cycleEnd;
  //         });

  //         if (!cycleCounts.length) continue;

  //         const operators = new Set(cycleCounts.map((c) => c.operator?.id).filter(Boolean));
  //         const workedTimeMs = cycleMs * Math.max(1, operators.size);

  //         const grouped = groupCountsByItem(cycleCounts);

  //         const items = Object.entries(grouped).map(([itemId, group]) => {
  //           const countTotal = group.length;
  //           const standard = group[0].item?.standard > 0 ? group[0].item.standard : 666;
  //           const name = group[0].item?.name || "Unknown";

  //           const pph = countTotal / (workedTimeMs / 3600000);
  //           const efficiency = pph / standard;

  //           // Add to machine summary
  //           if (!machineSummary.itemSummaries[itemId]) {
  //             machineSummary.itemSummaries[itemId] = {
  //               count: 0,
  //               standard,
  //             };
  //           }
  //           machineSummary.itemSummaries[itemId].count += countTotal;
  //           machineSummary.totalCount += countTotal;
  //           machineSummary.totalWorkedMs += workedTimeMs;

  //           return {
  //             itemId: parseInt(itemId),
  //             name,
  //             countTotal,
  //             standard,
  //             pph: Math.round(pph * 100) / 100,
  //             efficiency: Math.round(efficiency * 10000) / 100,
  //           };
  //         });

  //         sessions.push({
  //           start: cycleStart.toISOString(),
  //           end: cycleEnd.toISOString(),
  //           workedTimeMs,
  //           workedTimeFormatted: formatDuration(workedTimeMs),
  //           items,
  //         });
  //       }

  //       const totalHours = machineSummary.totalWorkedMs / 3600000;
  //       const machinePph = totalHours > 0 ? machineSummary.totalCount / totalHours : 0;

  //       const proratedStandard = Object.values(machineSummary.itemSummaries).reduce((acc, item) => {
  //         const weight = machineSummary.totalCount > 0 ? item.count / machineSummary.totalCount : 0;
  //         return acc + weight * item.standard;
  //       }, 0);

  //       const machineEff = proratedStandard > 0 ? machinePph / proratedStandard : 0;

  //       results.push({
  //         machine: {
  //           name: machineName,
  //           serial: parseInt(machineSerial),
  //         },
  //         sessions,
  //         machineSummary: {
  //           totalCount: machineSummary.totalCount,
  //           workedTimeMs: machineSummary.totalWorkedMs,
  //           workedTimeFormatted: formatDuration(machineSummary.totalWorkedMs),
  //           pph: Math.round(machinePph * 100) / 100,
  //           proratedStandard: Math.round(proratedStandard * 100) / 100,
  //           efficiency: Math.round(machineEff * 10000) / 100,
  //         },
  //       });
  //     }

  //     res.json(results);
  //   } catch (error) {
  //     logger.error("Error in /analytics/machine-item-summary:", error);
  //     res.status(500).json({ error: "Failed to generate machine item summary" });
  //   }
  // });

  // router.get("/analytics/machine-item-summary", async (req, res) => {
  //   try {
  //     const { start, end, serial } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const allStates = await fetchStatesForMachine(
  //       db,
  //       serial || null,
  //       paddedStart,
  //       paddedEnd
  //     );
  //     if (!allStates.length) return res.json([]);

  //     const groupedStates = groupStatesByMachine(allStates);
  //     const results = [];

  //     for (const [machineSerial, group] of Object.entries(groupedStates)) {
  //       const machineName = group.machine?.name || "Unknown";
  //       const machineStates = group.states;
  //       const cycles = extractAllCyclesFromStates(
  //         machineStates,
  //         start,
  //         end
  //       ).running;

  //       const allCounts = await getValidCounts(
  //         db,
  //         parseInt(machineSerial),
  //         start,
  //         end
  //       );

  //       const machineSummary = {
  //         totalCount: 0,
  //         totalWorkedMs: 0,
  //         itemSummaries: {},
  //       };

  //       const sessions = [];

  //       for (const cycle of cycles) {
  //         const cycleStart = new Date(cycle.start);
  //         const cycleEnd = new Date(cycle.end);
  //         const cycleMs = cycleEnd - cycleStart;

  //         const cycleCounts = allCounts.filter((c) => {
  //           const ts = new Date(c.timestamp);
  //           return ts >= cycleStart && ts <= cycleEnd;
  //         });

  //         if (!cycleCounts.length) continue;

  //         const operators = new Set(
  //           cycleCounts.map((c) => c.operator?.id).filter(Boolean)
  //         );
  //         const workedTimeMs = cycleMs * Math.max(1, operators.size);

  //         const grouped = groupCountsByItem(cycleCounts);

  //         for (const [itemId, group] of Object.entries(grouped)) {
  //           const countTotal = group.length;
  //           const standard =
  //             group[0].item?.standard > 0 ? group[0].item.standard : 666;
  //           const name = group[0].item?.name || "Unknown";

  //           if (!machineSummary.itemSummaries[itemId]) {
  //             machineSummary.itemSummaries[itemId] = {
  //               count: 0,
  //               standard,
  //               workedTimeMs: 0,
  //               name,
  //             };
  //           }

  //           machineSummary.itemSummaries[itemId].count += countTotal;
  //           machineSummary.itemSummaries[itemId].workedTimeMs += workedTimeMs;
  //           machineSummary.totalCount += countTotal;
  //           machineSummary.totalWorkedMs += workedTimeMs;
  //         }

  //         sessions.push({
  //           start: cycleStart.toISOString(),
  //           end: cycleEnd.toISOString(),
  //           workedTimeMs,
  //           workedTimeFormatted: formatDuration(workedTimeMs),
  //         });
  //       }

  //       // Add per-item formatted metrics
  //       Object.entries(machineSummary.itemSummaries).forEach(
  //         ([itemId, summary]) => {
  //           const workedTimeFormatted = formatDuration(summary.workedTimeMs);
  //           const totalHours = summary.workedTimeMs / 3600000;
  //           const pph = totalHours > 0 ? summary.count / totalHours : 0;
  //           const efficiency =
  //             summary.standard > 0 ? pph / summary.standard : 0;

  //           machineSummary.itemSummaries[itemId] = {
  //             name: summary.name,
  //             standard: summary.standard,
  //             countTotal: summary.count,
  //             workedTimeFormatted,
  //             pph: Math.round(pph * 100) / 100,
  //             efficiency: Math.round(efficiency * 10000) / 100,
  //           };
  //         }
  //       );

  //       const totalHours = machineSummary.totalWorkedMs / 3600000;
  //       const machinePph =
  //         totalHours > 0 ? machineSummary.totalCount / totalHours : 0;

  //       const proratedStandard = Object.values(
  //         machineSummary.itemSummaries
  //       ).reduce((acc, item) => {
  //         const weight =
  //           machineSummary.totalCount > 0
  //             ? item.countTotal / machineSummary.totalCount
  //             : 0;
  //         return acc + weight * item.standard;
  //       }, 0);

  //       const machineEff =
  //         proratedStandard > 0 ? machinePph / proratedStandard : 0;

  //       results.push({
  //         machine: {
  //           name: machineName,
  //           serial: parseInt(machineSerial),
  //         },
  //         sessions,
  //         machineSummary: {
  //           totalCount: machineSummary.totalCount,
  //           workedTimeMs: machineSummary.totalWorkedMs,
  //           workedTimeFormatted: formatDuration(machineSummary.totalWorkedMs),
  //           pph: Math.round(machinePph * 100) / 100,
  //           proratedStandard: Math.round(proratedStandard * 100) / 100,
  //           efficiency: Math.round(machineEff * 10000) / 100,
  //           itemSummaries: machineSummary.itemSummaries,
  //         },
  //       });
  //     }

  //     res.json(results);
  //   } catch (error) {
  //     logger.error("Error in /analytics/machine-item-summary:", error);
  //     res
  //       .status(500)
  //       .json({ error: "Failed to generate machine item summary" });
  //   }
  // });

  //updated efficient route for machine item summary
  router.get("/analytics/machine-item-summary", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        serial || null,
        paddedStart,
        paddedEnd
      );
      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByMachine(allStates);

      const results = await Promise.all(
        Object.entries(groupedStates).map(async ([machineSerial, group]) => {
          const machineName = group.machine?.name || "Unknown";
          const machineStates = group.states;

          const cycles = extractAllCyclesFromStates(
            machineStates,
            start,
            end
          ).running;

          if (!cycles.length) {
            return {
              machine: {
                name: machineName,
                serial: parseInt(machineSerial),
              },
              sessions: [],
              machineSummary: {
                totalCount: 0,
                workedTimeMs: 0,
                workedTimeFormatted: "0m",
                pph: 0,
                proratedStandard: 0,
                efficiency: 0,
                itemSummaries: {},
              },
            };
          }

          const allCounts = await getValidCounts(
            db,
            parseInt(machineSerial),
            start,
            end
          );

          let totalCount = 0;
          let totalWorkedMs = 0;
          const itemSummaries = {};
          const sessions = [];

          for (const cycle of cycles) {
            const cycleStart = new Date(cycle.start);
            const cycleEnd = new Date(cycle.end);
            const cycleMs = cycleEnd - cycleStart;

            const cycleCounts = allCounts.filter((c) => {
              const ts = new Date(c.timestamp);
              return ts >= cycleStart && ts <= cycleEnd;
            });

            if (!cycleCounts.length) continue;

            const uniqueOperatorIds = new Set(
              cycleCounts.map((c) => c.operator?.id).filter(Boolean)
            );
            const workedTimeMs = cycleMs * Math.max(1, uniqueOperatorIds.size);

            const groupedCounts = groupCountsByItem(cycleCounts);

            for (const [itemId, records] of Object.entries(groupedCounts)) {
              const count = records.length;
              const standard = records[0].item?.standard || 666;
              const name = records[0].item?.name || "Unknown";

              if (!itemSummaries[itemId]) {
                itemSummaries[itemId] = {
                  name,
                  standard,
                  count: 0,
                  workedTimeMs: 0,
                };
              }

              itemSummaries[itemId].count += count;
              itemSummaries[itemId].workedTimeMs += workedTimeMs;
              totalCount += count;
              totalWorkedMs += workedTimeMs;
            }

            sessions.push({
              start: cycleStart.toISOString(),
              end: cycleEnd.toISOString(),
              workedTimeMs,
              workedTimeFormatted: formatDuration(workedTimeMs),
            });
          }

          // Final aggregation (1-pass)
          let proratedStandard = 0;
          const itemSummariesFormatted = {};

          for (const [itemId, summary] of Object.entries(itemSummaries)) {
            const hours = summary.workedTimeMs / 3600000;
            const pph = hours > 0 ? summary.count / hours : 0;
            const efficiency =
              summary.standard > 0 ? pph / summary.standard : 0;

            const weight = totalCount > 0 ? summary.count / totalCount : 0;
            proratedStandard += weight * summary.standard;

            itemSummariesFormatted[itemId] = {
              name: summary.name,
              standard: summary.standard,
              countTotal: summary.count,
              workedTimeFormatted: formatDuration(summary.workedTimeMs),
              pph: Math.round(pph * 100) / 100,
              efficiency: Math.round(efficiency * 10000) / 100,
            };
          }

          const totalHours = totalWorkedMs / 3600000;
          const machinePph = totalHours > 0 ? totalCount / totalHours : 0;
          const machineEff =
            proratedStandard > 0 ? machinePph / proratedStandard : 0;

          return {
            machine: {
              name: machineName,
              serial: parseInt(machineSerial),
            },
            sessions,
            machineSummary: {
              totalCount,
              workedTimeMs: totalWorkedMs,
              workedTimeFormatted: formatDuration(totalWorkedMs),
              pph: Math.round(machinePph * 100) / 100,
              proratedStandard: Math.round(proratedStandard * 100) / 100,
              efficiency: Math.round(machineEff * 10000) / 100,
              itemSummaries: itemSummariesFormatted,
            },
          };
        })
      );

      res.json(results);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to generate machine item summary" });
    }
  });

  //API route for machine item summary end

  //API route for operator item summary start

  router.get("/analytics/operator-item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const operatorId = req.query.operatorId
        ? parseInt(req.query.operatorId)
        : null;
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      // Fetch states filtered by operatorId if present
      const allStates = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!allStates.length) return res.json([]);

      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // Filter operator-machine pairs by operatorId if present
      const allOperatorMachinePairs = Object.keys(groupedStates)
        .map((key) => {
          const [opId, machineSerial] = key.split("-").map(Number);
          return { operatorId: opId, machineSerial };
        })
        .filter((pair) => !operatorId || pair.operatorId === operatorId);

      if (!allOperatorMachinePairs.length) return res.json([]);

      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        allOperatorMachinePairs,
        paddedStart,
        paddedEnd
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // Process each operator-machine pair in parallel
      const results = await Promise.all(
        Object.entries(groupedCounts).map(async ([key, countGroup]) => {
          const { operator, machine, validCounts, misfeedCounts } = countGroup;

          // Skip if operatorId is provided and doesn't match
          if (operatorId && operator?.id !== operatorId) return null;

          const states = groupedStates[key]?.states || [];
          if (!states.length) return null;

          const runCycles = getCompletedCyclesForOperator(states);
          if (!runCycles.length) return null;

          const totalRunMs = runCycles.reduce(
            (acc, cycle) => acc + (cycle.duration || 0),
            0
          );

          const itemMap = groupCountsByItem(validCounts);
          if (!Object.keys(itemMap).length) return null;

          // Pre-calculate misfeed counts by item for efficiency
          const misfeedByItem = {};
          for (const misfeed of misfeedCounts) {
            const itemId = misfeed.item?.id;
            if (itemId) {
              misfeedByItem[itemId] = (misfeedByItem[itemId] || 0) + 1;
            }
          }

          const hours = totalRunMs / 3600000;
          const workedTimeFormatted = formatDuration(totalRunMs);

          // Process all items for this operator-machine pair
          const itemResults = [];
          for (const [itemId, group] of Object.entries(itemMap)) {
            const item = group[0]?.item || {};
            const count = group.length;
            const misfeeds = misfeedByItem[parseInt(itemId)] || 0;
            const pph = hours > 0 ? count / hours : 0;
            const standard = item.standard > 0 ? item.standard : 666;
            const efficiency = standard > 0 ? pph / standard : 0;

            itemResults.push({
              operatorName: operator?.name || "Unknown",
              machineName: machine?.name || "Unknown",
              itemName: item?.name || "Unknown",
              workedTimeFormatted,
              count,
              misfeed: misfeeds,
              pph: Math.round(pph * 100) / 100,
              standard,
              efficiency: Math.round(efficiency * 10000) / 100,
            });
          }

          return itemResults;
        })
      );

      // Flatten results and consolidate duplicates in a single pass
      const consolidated = {};
      const flatResults = results.filter(Boolean).flat();

      for (const row of flatResults) {
        const key = `${row.operatorName}-${row.machineName}-${row.itemName}`;

        if (!consolidated[key]) {
          consolidated[key] = { ...row };
        } else {
          const existing = consolidated[key];
          existing.count += row.count;
          existing.misfeed += row.misfeed;

          // Convert formatted time back to milliseconds for calculation
          const existingMs =
            (existing.workedTimeFormatted.hours * 60 +
              existing.workedTimeFormatted.minutes) *
            60000;
          const newMs =
            (row.workedTimeFormatted.hours * 60 +
              row.workedTimeFormatted.minutes) *
            60000;
          const totalMs = existingMs + newMs;

          // Recalculate metrics
          const totalHours = totalMs / 3600000;
          const totalPph = totalHours > 0 ? existing.count / totalHours : 0;
          const totalEfficiency =
            existing.standard > 0 ? totalPph / existing.standard : 0;

          existing.workedTimeFormatted = formatDuration(totalMs);
          existing.pph = Math.round(totalPph * 100) / 100;
          existing.efficiency = Math.round(totalEfficiency * 10000) / 100;
        }
      }

      res.json(Object.values(consolidated));
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate operator item summary report" });
    }
  });

  //API route for operator item summary end

  //API route for item summary start
  router.get("/analytics/item-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      const allStates = await fetchStatesForMachine(
        db,
        null,
        paddedStart,
        paddedEnd
      );
      const groupedStates = groupStatesByMachine(allStates);

      const resultsMap = new Map();

      for (const [machineSerial, group] of Object.entries(groupedStates)) {
        const machineStates = group.states;
        const machineName = group.machine?.name || "Unknown";
        const cycles = extractAllCyclesFromStates(
          machineStates,
          start,
          end
        ).running;

        const counts = await getValidCounts(
          db,
          parseInt(machineSerial),
          start,
          end
        );
        if (!counts.length || !cycles.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(c.timestamp);
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: parseInt(itemId),
                name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency = entry.standard > 0 ? pph / entry.standard : 0;

        return {
          itemName: entry.name,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 10000) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to generate item summary report" });
    }
  });

  //API route for item summary end

  //Machine item stacked bar chart start
  router.get("/analytics/machine-item-hourly-item-stack", async (req, res) => {
    try {
      const { start, end, serial } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!serial) {
        return res.status(400).json({ error: "Machine serial is required" });
      }

      const counts = await getValidCounts(db, parseInt(serial), start, end);
      if (!counts.length)
        return res.json({
          title: "No data",
          data: { hours: [], operators: {} },
        });

      // Normalize counts into hour buckets
      const hourMap = new Map(); // hourIndex => { itemName => count }

      for (const count of counts) {
        const ts = new Date(count.timestamp);
        const hourIndex = Math.floor((ts - startDate) / (60 * 60 * 1000)); // hour offset since start
        const itemName = count.item?.name || "Unknown";

        if (!hourMap.has(hourIndex)) hourMap.set(hourIndex, {});
        const hourEntry = hourMap.get(hourIndex);
        hourEntry[itemName] = (hourEntry[itemName] || 0) + 1;
      }

      // Build structure: hours[], and for each item: count array by hour
      const maxHour = Math.max(...hourMap.keys());
      const hours = Array.from({ length: maxHour + 1 }, (_, i) => i);
      const itemNames = new Set();

      // Collect all item names
      for (const hourEntry of hourMap.values()) {
        Object.keys(hourEntry).forEach((name) => itemNames.add(name));
      }

      // Initialize operator structure
      const operators = {};
      for (const name of itemNames) {
        operators[name] = Array(maxHour + 1).fill(0);
      }

      // Fill operator counts
      for (const [hourIndex, itemCounts] of hourMap.entries()) {
        for (const [itemName, count] of Object.entries(itemCounts)) {
          operators[itemName][hourIndex] = count;
        }
      }

      res.json({
        title: `Item Stacked Count Chart for Machine ${serial}`,
        data: {
          hours,
          operators,
        },
      });
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "Failed to build item/hour stacked data" });
    }
  });

  //Machine item stacked bar chart end

  // API Route for operator cycle pie chart start
  router.get("/analytics/operator-cycle-pie", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      if (!operatorId) {
        return res.status(400).json({ error: "Operator ID is required" });
      }

      // Step 3: Get all state records using state.js utility
      const states = await fetchStatesForOperator(
        db,
        operatorId,
        paddedStart,
        paddedEnd
      );

      if (!states.length) {
        return res.json([]);
      }

      // Step 4: Extract cycles using state.js utility
      const cycles = extractAllCyclesFromStates(states, start, end);
      const runningCycles = cycles.running;
      const pausedCycles = cycles.paused;
      const faultCycles = cycles.fault;

      // Calculate total durations
      const runningTime = runningCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const pausedTime = pausedCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );
      const faultedTime = faultCycles.reduce(
        (total, cycle) => total + cycle.duration,
        0
      );

      const totalTime = runningTime + pausedTime + faultedTime;

      // Format response
      const response = [
        {
          name: "Running",
          value: Math.round((runningTime / totalTime) * 100),
        },
        {
          name: "Paused",
          value: Math.round((pausedTime / totalTime) * 100),
        },
        {
          name: "Faulted",
          value: Math.round((faultedTime / totalTime) * 100),
        },
      ];

      res.json(response);
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator cycle pie data" });
    }
  });
  // API Route for operator cycle pie chart end

  // API Route for operator efficiency across all machines
  // router.get("/analytics/operator/machine-efficiency", async (req, res) => {
  //   try {
  //     // Step 1: Parse and validate query parameters
  //     const { start, end, operatorId } = parseAndValidateQueryParams(req);

  //     // Step 2: Create padded time range
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     if (!operatorId) {
  //       return res.status(400).json({ error: "Operator ID is required" });
  //     }

  //     // Step 3: Get hourly intervals
  //     const hourlyIntervals = getHourlyIntervals(paddedStart, paddedEnd);

  //     // Step 4: Get states and counts for the operator across all machines
  //     const states = await fetchStatesForOperator(db, operatorId, paddedStart, paddedEnd);
  //     const groupedStates = groupStatesByOperatorAndSerial(states);

  //     if (!states.length) {
  //       return res.json([]);
  //     }

  //     // Step 5: Process each hour
  //     const hourlyData = await Promise.all(
  //       hourlyIntervals.map(async (interval) => {
  //         // Filter states for this hour
  //         const hourStates = states.filter((state) => {
  //           const stateTime = new Date(state.timestamp);
  //           return stateTime >= interval.start && stateTime <= interval.end;
  //         });

  //         // Group states by machine for this hour
  //         const hourGroupedStates = groupStatesByOperatorAndSerial(hourStates);

  //         // Calculate metrics for each machine
  //         const machineMetrics = {};

  //         // Process each machine's states
  //         for (const [key, group] of Object.entries(hourGroupedStates)) {
  //           const [opId, machineSerial] = key.split('-');
  //           const machineStates = group.states;
  //           const machineName = group.machine?.name || "Unknown";

  //           // Get counts for this machine
  //           const counts = await getCountsForMachine(db, parseInt(machineSerial), interval.start, interval.end);
  //           const validCounts = counts.filter(c => !c.misfeed);

  //           // Calculate runtime for this machine
  //           const { runtime: machineRuntime } = calculateOperatorTimes(
  //             machineStates,
  //             interval.start,
  //             interval.end
  //           );

  //           // Calculate efficiency for this machine
  //           const efficiency = calculateEfficiency(
  //             machineRuntime,
  //             validCounts.length,
  //             validCounts
  //           );

  //           machineMetrics[machineSerial] = {
  //             name: machineName,
  //             runTime: machineRuntime,
  //             validCounts: validCounts.length,
  //             efficiency: efficiency * 100, // Convert to percentage
  //           };
  //         }

  //         // Calculate average efficiency across all machines
  //         const avgEfficiency = Object.values(machineMetrics).length > 0
  //           ? Object.values(machineMetrics).reduce((sum, machine) => sum + machine.efficiency, 0) / Object.keys(machineMetrics).length
  //           : 0;

  //         return {
  //           hour: interval.start.toISOString(),
  //           averageEfficiency: Math.round(avgEfficiency * 100) / 100,
  //           machines: Object.entries(machineMetrics).map(([serial, metrics]) => ({
  //             serial: parseInt(serial),
  //             name: metrics.name,
  //             efficiency: Math.round(metrics.efficiency * 100) / 100,
  //           })),
  //         };
  //       })
  //     );

  //     // Step 6: Format response
  //     const response = {
  //       operator: {
  //         id: parseInt(operatorId),
  //         name: await getOperatorNameFromCount(db, operatorId) || "Unknown",
  //       },
  //       timeRange: {
  //         start: start,
  //         end: end,
  //         total: formatDuration(new Date(end) - new Date(start)),
  //       },
  //       hourlyData,
  //     };

  //     res.json(response);
  //   } catch (error) {
  //     logger.error("Error calculating operator machine efficiency:", error);
  //     res.status(500).json({ error: "Failed to calculate operator machine efficiency" });
  //   }
  // });

  // API Route for operator efficiency end

  // API Route for operator efficiency line chart start
  router.get("/analytics/operator/daily-efficiency", async (req, res) => {
    try {
      const { start, end, operatorId } = parseAndValidateQueryParams(req);
      const parsedOperatorId = parseInt(operatorId);

      if (!parsedOperatorId || isNaN(parsedOperatorId)) {
        return res.status(400).json({ error: "Valid operatorId is required" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);
      const days = [];
      let cursor = new Date(startDate);

      while (cursor <= endDate) {
        const startOfDay = new Date(cursor);
        const endOfDay = new Date(startOfDay);
        endOfDay.setUTCHours(23, 59, 59, 999);

        days.push({ start: new Date(startOfDay), end: new Date(endOfDay) });

        cursor.setUTCDate(cursor.getUTCDate() + 1); // Move to next day
      }

      const results = [];

      for (const day of days) {
        // 1. Get states for this day
        const dayStates = await fetchStatesForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );
        const runCycles = getCompletedCyclesForOperator(dayStates);
        const totalRunTimeMs = runCycles.reduce(
          (sum, cycle) => sum + cycle.duration,
          0
        );

        // 2. Get valid counts
        const validCounts = await getValidCountsForOperator(
          db,
          parsedOperatorId,
          day.start,
          day.end
        );

        // 3. Estimate average standard from item data
        let avgStandard = 666; // default fallback
        if (validCounts.length > 0) {
          const standards = validCounts
            .map((c) => c.item?.standard)
            .filter((s) => typeof s === "number" && s > 0);

          if (standards.length > 0) {
            avgStandard =
              standards.reduce((sum, s) => sum + s, 0) / standards.length;
          }
        }

        // 4. Calculate PPH
        const hours = totalRunTimeMs / 3600000;
        const pph = hours > 0 ? validCounts.length / hours : 0;

        // 5. Calculate efficiency
        const efficiency = avgStandard > 0 ? (pph / avgStandard) * 100 : 0;

        results.push({
          date: day.start.toISOString().split("T")[0],
          efficiency: Math.round(efficiency * 100) / 100,
        });
      }

      const operatorName = await getOperatorNameFromCount(db, parsedOperatorId);

      res.json({
        operator: {
          id: parsedOperatorId,
          name: operatorName || "Unknown",
        },
        timeRange: {
          start,
          end,
          totalDays: results.length,
        },
        data: results,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: "Failed to compute daily efficiency" });
    }
  });

  // API Route for operator efficiency line chart end

  //API route for item Dashboard start
  // router.get("/analytics/item-dashboard-summary", async (req, res) => {
  //   try {
  //     const { start, end } = parseAndValidateQueryParams(req);
  //     const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

  //     const allStates = await fetchStatesForMachine(
  //       db,
  //       null,
  //       paddedStart,
  //       paddedEnd
  //     );
  //     const groupedStates = groupStatesByMachine(allStates);

  //     const resultsMap = new Map();

  //     for (const [machineSerial, group] of Object.entries(groupedStates)) {
  //       const machineStates = group.states;
  //       const cycles = extractAllCyclesFromStates(
  //         machineStates,
  //         start,
  //         end
  //       ).running;
  //       if (!cycles.length) continue;

  //       const counts = await getValidCounts(
  //         db,
  //         parseInt(machineSerial),
  //         start,
  //         end
  //       );
  //       if (!counts.length) continue;

  //       for (const cycle of cycles) {
  //         const cycleStart = new Date(cycle.start);
  //         const cycleEnd = new Date(cycle.end);
  //         const cycleMs = cycleEnd - cycleStart;

  //         const cycleCounts = counts.filter((c) => {
  //           const ts = new Date(c.timestamp);
  //           return ts >= cycleStart && ts <= cycleEnd;
  //         });

  //         if (!cycleCounts.length) continue;

  //         const operators = new Set(
  //           cycleCounts.map((c) => c.operator?.id).filter(Boolean)
  //         );
  //         const workedTimeMs = cycleMs * Math.max(1, operators.size);

  //         const grouped = groupCountsByItem(cycleCounts);

  //         for (const [itemId, group] of Object.entries(grouped)) {
  //           const itemIdNum = parseInt(itemId);
  //           const name = group[0].item?.name || "Unknown";
  //           const standard =
  //             group[0].item?.standard > 0 ? group[0].item.standard : 666;
  //           const countTotal = group.length;

  //           if (!resultsMap.has(itemId)) {
  //             resultsMap.set(itemId, {
  //               itemId: itemIdNum,
  //               itemName: name,
  //               standard,
  //               count: 0,
  //               workedTimeMs: 0,
  //             });
  //           }

  //           const entry = resultsMap.get(itemId);
  //           entry.count += countTotal;
  //           entry.workedTimeMs += workedTimeMs;
  //         }
  //       }
  //     }

  //     const results = Array.from(resultsMap.values()).map((entry) => {
  //       const totalHours = entry.workedTimeMs / 3600000;
  //       const pph = totalHours > 0 ? entry.count / totalHours : 0;
  //       const efficiency =
  //         entry.standard > 0 ? (pph / entry.standard) * 100 : 0;

  //       return {
  //         itemId: entry.itemId,
  //         itemName: entry.itemName,
  //         workedTimeFormatted: formatDuration(entry.workedTimeMs),
  //         count: entry.count,
  //         pph: Math.round(pph * 100) / 100,
  //         standard: entry.standard,
  //         efficiency: Math.round(efficiency * 100) / 100,
  //       };
  //     });

  //     res.json(results);
  //   } catch (err) {
  //     logger.error("Error in /analytics/item-dashboard-summary:", err);
  //     res
  //       .status(500)
  //       .json({ error: "Failed to generate item dashboard summary" });
  //   }
  // });
  //API route for item Dashboard end
  //Bookending for item-dashboard-summary
  // const itemRoutes = require("./itemRoutes")(server);
  // router.use("/", itemRoutes);

  router.get("/analytics/item-dashboard-summary", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      const machineSerials = await db.collection("machine").distinct("serial");

      const resultsMap = new Map();

      for (const serial of machineSerials) {
        const bookended = await getBookendedStatesAndTimeRange(
          db,
          serial,
          start,
          end
        );
        if (!bookended) continue;

        const { sessionStart, sessionEnd, states } = bookended;
        const cycles = extractAllCyclesFromStates(
          states,
          sessionStart,
          sessionEnd
        ).running;
        if (!cycles.length) continue;

        const counts = await getValidCounts(
          db,
          serial,
          sessionStart,
          sessionEnd
        );
        if (!counts.length) continue;

        for (const cycle of cycles) {
          const cycleStart = new Date(cycle.start);
          const cycleEnd = new Date(cycle.end);
          const cycleMs = cycleEnd - cycleStart;

          const cycleCounts = counts.filter((c) => {
            const ts = new Date(c.timestamp);
            return ts >= cycleStart && ts <= cycleEnd;
          });

          if (!cycleCounts.length) continue;

          const operators = new Set(
            cycleCounts.map((c) => c.operator?.id).filter(Boolean)
          );
          const workedTimeMs = cycleMs * Math.max(1, operators.size);

          const grouped = groupCountsByItem(cycleCounts);

          for (const [itemId, group] of Object.entries(grouped)) {
            const itemIdNum = parseInt(itemId);
            const name = group[0].item?.name || "Unknown";
            const standard =
              group[0].item?.standard > 0 ? group[0].item.standard : 666;
            const countTotal = group.length;

            if (!resultsMap.has(itemId)) {
              resultsMap.set(itemId, {
                itemId: itemIdNum,
                itemName: name,
                standard,
                count: 0,
                workedTimeMs: 0,
              });
            }

            const entry = resultsMap.get(itemId);
            entry.count += countTotal;
            entry.workedTimeMs += workedTimeMs;
          }
        }
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const totalHours = entry.workedTimeMs / 3600000;
        const pph = totalHours > 0 ? entry.count / totalHours : 0;
        const efficiency =
          entry.standard > 0 ? (pph / entry.standard) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(entry.workedTimeMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standard,
          efficiency: Math.round(efficiency * 100) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate item dashboard summary" });
    }
  });

  //Bookending for item-dashboard-summary end

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

  //API route for item Dashboard start
  router.get("/analytics/item-dashboard-summary-agg", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Aggregation pipeline
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate },
            misfeed: { $ne: true }, // Only valid counts
            "item.id": { $ne: null },
          },
        },
        {
          $group: {
            _id: "$item.id",
            itemName: { $first: "$item.name" },
            standard: { $first: "$item.standard" },
            count: { $sum: 1 },
            minTimestamp: { $min: "$timestamp" },
            maxTimestamp: { $max: "$timestamp" },
            operatorIds: { $addToSet: "$operator.id" },
          },
        },
        {
          $addFields: {
            workedTimeMs: {
              $subtract: ["$maxTimestamp", "$minTimestamp"],
            },
            totalOperators: { $size: "$operatorIds" },
          },
        },
        {
          $addFields: {
            // Approximate worked time by multiplying by number of unique operators (if >0)
            workedTimeMs: {
              $cond: [
                { $gt: ["$totalOperators", 0] },
                { $multiply: ["$workedTimeMs", "$totalOperators"] },
                "$workedTimeMs",
              ],
            },
            standard: { $ifNull: ["$standard", 666] },
          },
        },
        {
          $project: {
            _id: 0,
            itemId: "$_id",
            itemName: 1,
            standard: 1,
            count: 1,
            workedTimeMs: 1,
            pph: {
              $cond: [
                { $gt: ["$workedTimeMs", 0] },
                {
                  $divide: ["$count", { $divide: ["$workedTimeMs", 3600000] }],
                },
                0,
              ],
            },
            efficiency: {
              $cond: [
                { $gt: ["$standard", 0] },
                {
                  $multiply: [
                    {
                      $divide: [
                        {
                          $cond: [
                            { $gt: ["$workedTimeMs", 0] },
                            {
                              $divide: [
                                "$count",
                                { $divide: ["$workedTimeMs", 3600000] },
                              ],
                            },
                            0,
                          ],
                        },
                        "$standard",
                      ],
                    },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $sort: { itemName: 1 },
        },
      ];

      const results = await db
        .collection("count")
        .aggregate(pipeline)
        .toArray();

      // Format workedTimeMs to match the old API (use formatDuration)
      const formattedResults = results.map((entry) => ({
        ...entry,
        workedTimeFormatted: formatDuration(entry.workedTimeMs),
        pph: Math.round(entry.pph * 100) / 100,
        efficiency: Math.round(entry.efficiency * 100) / 100,
      }));

      res.json(formattedResults);
    } catch (err) {
      logger.error(`Error in ${req.method} ${req.url}:`, err);
      res
        .status(500)
        .json({ error: "Failed to generate item dashboard summary (agg)" });
    }
  });

  // Aggregated operator dashboard route
  router.get("/analytics/operator-dashboard-agg", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Aggregation pipeline
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate },
            "operator.id": { $ne: null },
          },
        },
        {
          $addFields: {
            isMisfeed: { $cond: [{ $eq: ["$misfeed", true] }, 1, 0] },
            isValid: { $cond: [{ $ne: ["$misfeed", true] }, 1, 0] },
          },
        },
        {
          $group: {
            _id: "$operator.id",
            operatorName: { $first: "$operator.name" },
            totalCount: { $sum: 1 },
            validCount: { $sum: "$isValid" },
            misfeedCount: { $sum: "$isMisfeed" },
            minTimestamp: { $min: "$timestamp" },
            maxTimestamp: { $max: "$timestamp" },
            items: {
              $push: {
                id: "$item.id",
                name: "$item.name",
                standard: "$item.standard",
                misfeed: "$misfeed",
                timestamp: "$timestamp",
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            operatorId: "$_id",
            operatorName: 1,
            totalCount: 1,
            validCount: 1,
            misfeedCount: 1,
            minTimestamp: 1,
            maxTimestamp: 1,
            items: 1,
          },
        },
      ];

      const operatorResults = await db
        .collection("count")
        .aggregate(pipeline)
        .toArray();

      // For each operator, further aggregate items in JS (for PPH, efficiency, etc.)
      const results = operatorResults.map((op) => {
        // Group items by id
        const itemMap = {};
        for (const record of op.items) {
          if (!record.id) continue;
          if (!itemMap[record.id]) {
            itemMap[record.id] = {
              itemId: record.id,
              itemName: record.name,
              standard: record.standard || 666,
              count: 0,
              misfeed: 0,
              timestamps: [],
            };
          }
          itemMap[record.id].count++;
          if (record.misfeed) itemMap[record.id].misfeed++;
          itemMap[record.id].timestamps.push(record.timestamp);
        }
        // Calculate per-item stats
        const itemSummary = Object.values(itemMap).map((item) => {
          const minTs = item.timestamps.length
            ? Math.min(...item.timestamps.map((ts) => new Date(ts).getTime()))
            : 0;
          const maxTs = item.timestamps.length
            ? Math.max(...item.timestamps.map((ts) => new Date(ts).getTime()))
            : 0;
          const workedTimeMs = maxTs > minTs ? maxTs - minTs : 0;
          const hours = workedTimeMs / 3600000;
          const pph = hours > 0 ? item.count / hours : 0;
          const efficiency =
            item.standard > 0 ? (pph / item.standard) * 100 : 0;
          return {
            itemId: item.itemId,
            itemName: item.itemName,
            count: item.count,
            misfeed: item.misfeed,
            workedTimeFormatted: formatDuration(workedTimeMs),
            pph: Math.round(pph * 100) / 100,
            standard: item.standard,
            efficiency: Math.round(efficiency * 100) / 100,
          };
        });
        return {
          operator: {
            id: op.operatorId,
            name: op.operatorName || "Unknown",
          },
          totalCount: op.totalCount,
          validCount: op.validCount,
          misfeedCount: op.misfeedCount,
          workedTimeFormatted: formatDuration(
            new Date(op.maxTimestamp) - new Date(op.minTimestamp)
          ),
          itemSummary,
        };
      });

      res.json(results);
    } catch (err) {
      logger.error("Error in /analytics/operator-dashboard-agg route:", err);
      res
        .status(500)
        .json({ error: "Failed to fetch operator dashboard data (agg)" });
    }
  });

  // Aggregated operator performance route
  router.get("/analytics/operator-performance-agg", async (req, res) => {
    try {
      // Step 1: Parse and validate query parameters
      const { start, end, operatorId } = parseAndValidateQueryParams(req);

      // Step 2: Create padded time range
      const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);

      let states;
      let groupedStates;

      if (operatorId) {
        // If operatorId provided, get states for just that operator
        states = await fetchStatesForOperator(
          db,
          operatorId,
          paddedStart,
          paddedEnd
        );
        // Create a single group for this operator
        groupedStates = {
          [operatorId]: {
            operator: {
              id: operatorId,
              name: await getOperatorNameFromCount(db, operatorId),
            },
            states: states,
          },
        };
      } else {
        // If no operatorId, get all states and group them by operator
        const allStates = await fetchStatesForOperator(
          db,
          null,
          paddedStart,
          paddedEnd
        );
        groupedStates = groupStatesByOperator(allStates);

        // Update operator names for all groups
        for (const [opId, group] of Object.entries(groupedStates)) {
          group.operator.name = await getOperatorNameFromCount(db, opId);
        }
      }

      // Step 3: Get all operator IDs for count query
      const operatorIds = Object.keys(groupedStates).map((id) => parseInt(id));

      // Use aggregation to get count stats per operator
      const countAgg = await db
        .collection("count")
        .aggregate([
          {
            $match: {
              "operator.id": { $in: operatorIds },
              timestamp: { $gte: new Date(start), $lte: new Date(end) },
            },
          },
          {
            $group: {
              _id: "$operator.id",
              operatorName: { $first: "$operator.name" },
              totalCount: { $sum: 1 },
              validCount: {
                $sum: { $cond: [{ $ne: ["$misfeed", true] }, 1, 0] },
              },
              misfeedCount: {
                $sum: { $cond: [{ $eq: ["$misfeed", true] }, 1, 0] },
              },
              allCounts: { $push: "$$ROOT" },
            },
          },
        ])
        .toArray();
      const operatorCounts = {};
      for (const agg of countAgg) {
        operatorCounts[agg._id] = {
          counts: agg.allCounts,
          validCounts: agg.allCounts.filter((c) => !c.misfeed),
          misfeedCounts: agg.allCounts.filter((c) => c.misfeed),
          totalCount: agg.totalCount,
          validCount: agg.validCount,
          misfeedCount: agg.misfeedCount,
        };
      }

      // Step 4: Process each operator's data in parallel
      const operatorResults = await Promise.all(
        Object.entries(groupedStates).map(async ([operatorId, group]) => {
          const states = group.states;

          // Skip if no states found for this operator
          if (!states.length) return null;

          // Get counts for this operator
          const counts = operatorCounts[parseInt(operatorId)];
          if (!counts) return null;

          // Process count statistics using the new utility function
          const stats = processCountStatistics(counts.counts);

          // Calculate metrics for this operator
          const totalQueryMs = new Date(end) - new Date(start);
          const {
            runtime: runtimeMs,
            pausedTime: pausedTimeMs,
            faultTime: faultTimeMs,
          } = calculateOperatorTimes(states, start, end);

          const piecesPerHour = calculatePiecesPerHour(stats.total, runtimeMs);
          const efficiency = calculateEfficiency(
            runtimeMs,
            stats.total,
            counts.validCounts
          );

          // Get current status for this operator
          const currentState = states[states.length - 1] || {};

          // Format response for this operator
          return {
            operator: {
              id: parseInt(operatorId),
              name: group.operator.name || "Unknown",
            },
            currentStatus: {
              code: currentState.status?.code || 0,
              name: currentState.status?.name || "Unknown",
            },
            metrics: {
              runtime: {
                total: runtimeMs,
                formatted: formatDuration(runtimeMs),
              },
              pausedTime: {
                total: pausedTimeMs,
                formatted: formatDuration(pausedTimeMs),
              },
              faultTime: {
                total: faultTimeMs,
                formatted: formatDuration(faultTimeMs),
              },
              output: {
                totalCount: stats.total,
                misfeedCount: stats.misfeeds,
                validCount: stats.valid,
              },
              performance: {
                piecesPerHour: {
                  value: piecesPerHour,
                  formatted: Math.round(piecesPerHour).toString(),
                },
                efficiency: {
                  value: efficiency,
                  percentage: (efficiency * 100).toFixed(2) + "%",
                },
              },
            },
            timeRange: {
              start: start,
              end: end,
              total: formatDuration(totalQueryMs),
            },
          };
        })
      );

      // Filter out null results and send response
      res.json(operatorResults.filter((result) => result !== null));
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.url}:`, error);
      res
        .status(500)
        .json({ error: "Failed to fetch operator performance metrics (agg)" });
    }
  });

  // Machine Sessions route for machine Dashboard

  router.get("/analytics/machine-sessions-summary", async (req, res) => {
    try {
      //Get the time range from the query params

      const { start, end } = parseAndValidateQueryParams(req);
      const queryStart = new Date(start);
      let queryEnd = new Date(end);
      const now = new Date();
      if (queryEnd > now) queryEnd = now;

      // Active machines set
      const activeSerials = new Set(
        await db.collection("machine").distinct("serial", { active: true })
      );

      // Pull tickers for active machines only
      const tickers = await db
        .collection(config.stateTickerCollectionName)
        .find({ "machine.serial": { $in: [...activeSerials] } })
        .project({ _id: 0 })
        .toArray();

        

      res.json({
        message: "Machine Sessions Summary",
        activeSerials: Array.from(activeSerials),
        tickers: tickers,
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.url}:`, error);

      res
        .status(500)
        .json({ error: "Failed to fetch machine sessions summary" });
    }
  });

  return router;
}
