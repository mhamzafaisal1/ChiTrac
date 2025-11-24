/*** statuses API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require("express");
const router = express.Router();
const { DateTime, Duration, Interval } = require("luxon"); //For handling dates and times

const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
} = require("../../utils/time");

const {
  fetchStatesForOperator,
  fetchStatesForOperatorForSoftrol,
  getCompletedCyclesForOperator,
  groupStatesByOperatorAndSerial,
  groupStatesByMachineAndStation,
  getCompletedCyclesWithOperatorSplit
} = require("../../utils/state");

const {
  groupCountsByOperatorAndMachine,
  getCountsForOperatorMachinePairs,
  getCountsForMachineStationPairs,
  getCountsForMachineStationPairsForSoftrol,
  groupCountsByMachineAndStation
} = require("../../utils/count");

const { buildSoftrolCycleSummary } = require("../../utils/miscFunctions");



module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const db = server.db;
  const logger = server.logger;
  const xmlParser = server.xmlParser;
  const xml = xmlParser.xml;

  // Import level-two dashboard-related routes
  const levelTwoDashboardRoutes = require("./level-twoRoutes")(server);
  router.use("/", levelTwoDashboardRoutes);

  router.get("/levelone/all", async (req, res, next) => {
    const stateCollection = db.collection("state");
    const stateTickerCollection = db.collection("stateTicker");
    const countCollection = db.collection("count");

    let queryDateTime = DateTime.now().toISO();
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
          const machineDuration = session.duration;

          const operators = await Promise.all(
            machineState.operators.map(async (operator) => {
              if (operator.id == 0) {
                operator.id = serial + 900000;
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



  /*router.get("/leveltwo", (req, res, next) => {
    res.json({
      timers: {
        run: 63,
        down: 17,
        total: 80
      },
      programNumber: 2,
      item: {
        id: 1,
        name: "Incontinent Pads"
      },
      totals: {
        input: 2493,
        out: 2384,
        thru: 95.63,
        faults: 15,
        jams: 9,
      },
      availability: 86.55,
      oee: 68.47,
      operatorEfficiency: 78.61,
    });
  });*/

  // Import misc-related routes (This is the softrol routes)
  router.get("/historic-data/old", async (req, res) => {
    try {
      // Default end time to now if not provided
      if (!req.query.end && !req.query.endTime) {
        req.query.end = new Date().toISOString();
      }
      // Use centralized time parser
      const { start, end } = parseAndValidateQueryParams(req);

      // Get latest state timestamp if end date is in the future
      const [latestState] = await db
        .collection("state")
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

      // 1. Fetch and group states by operator and machine
      const allStates = await fetchStatesForOperator(
        db,
        null,
        paddedStart,
        paddedEnd
      );

      const groupedStates = groupStatesByOperatorAndSerial(allStates);

      // 2. Process completed cycles for each group
      const completedCyclesByGroup = {};
      for (const [key, group] of Object.entries(groupedStates)) {
        const completedCycles = getCompletedCyclesForOperator(group.states);
        if (completedCycles.length > 0) {
          completedCyclesByGroup[key] = { ...group, completedCycles };
        }
      }

      // 3. Get operator-machine pairs for count lookup
      const operatorMachinePairs = Object.keys(completedCyclesByGroup).map(
        (key) => {
          const [operatorId, machineSerial] = key.split("-");
          return {
            operatorId: parseInt(operatorId),
            machineSerial: parseInt(machineSerial),
          };
        }
      );

      // 4. Fetch and group counts
      const allCounts = await getCountsForOperatorMachinePairs(
        db,
        operatorMachinePairs,
        start,
        end
      );
      const groupedCounts = groupCountsByOperatorAndMachine(allCounts);

      // 5. Process each group's cycles and counts
      const results = [];
      for (const [key, group] of Object.entries(completedCyclesByGroup)) {
        const [operatorId, machineSerial] = key.split("-");
        const countGroup = groupedCounts[`${operatorId}-${machineSerial}`];
        if (!countGroup) continue;

        // Sort counts by timestamp for efficient processing
        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Process each cycle
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
  // Softrol Route end



  // Updated Softrol Route
router.get("/historic-data", async (req, res) => {
  try {
    // Default end time to now if not provided
    if (!req.query.end && !req.query.endTime) {
      req.query.end = new Date().toISOString();
    }

    // Use centralized time parser
    const { start, end } = parseAndValidateQueryParams(req);

    // Get latest state timestamp if end date is in the future
    const [latestState] = await db
      .collection("state")
      .find()
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    const effectiveEnd =
      new Date(end) > new Date() ? latestState?.timestamp || new Date() : end;

    // Create padded time range for state queries to capture boundary states
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, effectiveEnd);

    // 1. Fetch and group states by machine and station (with padding)
    const allStates = await fetchStatesForOperatorForSoftrol(
      db,
      null,
      paddedStart,
      paddedEnd
    );

    const groupedStates = groupStatesByMachineAndStation(allStates);

    // 2. Process completed cycles for each group
    const completedCyclesByGroup = {};
    for (const [key, group] of Object.entries(groupedStates)) {
      const completedCycles = getCompletedCyclesWithOperatorSplit(group.states);
      if (completedCycles.length > 0) {
        completedCyclesByGroup[key] = { ...group, completedCycles };
      }
    }

    // 3. Get ALL machine-station pairs from grouped states (not just those with cycles)
    // This ensures we fetch counts for all operators, even if they don't have completed cycles
    const allMachineStationPairs = Object.keys(groupedStates).map((key) => {
      const [machineSerial, station] = key.split("-");
      return {
        machineSerial: parseInt(machineSerial),
        station: parseInt(station),
      };
    });

    // 4. Fetch and group counts using aligned time range (effectiveEnd)
    const allCounts = await getCountsForMachineStationPairsForSoftrol(
      db,
      allMachineStationPairs,
      start,
      effectiveEnd  // Use effectiveEnd to align with state query range
    );
    
    const groupedCounts = groupCountsByMachineAndStation(allCounts);

    // 5. Process each group's cycles and counts
    const results = [];
    
    // First, process groups with completed cycles
    for (const [key, group] of Object.entries(completedCyclesByGroup)) {
      const [machineSerial, station] = key.split("-");
      const countGroup = groupedCounts[`${machineSerial}-${station}`];
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
          const operatorId = cycle?.startState?.operators?.[0]?.id ?? null;

          results.push({
            operatorId,
            machineSerial: parseInt(machineSerial),
            station: parseInt(station),
            ...summary,
          });
        }
      }
    }

    // 6. Handle groups with counts but no completed cycles (e.g., currently running operators)
    for (const [key, group] of Object.entries(groupedStates)) {
      // Skip if already processed in completed cycles
      if (completedCyclesByGroup[key]) continue;

      const [machineSerial, station] = key.split("-");
      const countGroup = groupedCounts[`${machineSerial}-${station}`];
      
      // If there are counts but no completed cycles, create a summary from all counts
      if (countGroup && countGroup.counts.length > 0) {
        const sortedCounts = countGroup.counts.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Find the operator from the first count or first state
        const operatorId = countGroup.operator?.id || 
                          group.states[0]?.operators?.[0]?.id || 
                          null;

        // Create a pseudo-cycle from the entire time range
        const firstCountTime = new Date(sortedCounts[0].timestamp);
        const lastCountTime = new Date(sortedCounts[sortedCounts.length - 1].timestamp);
        
        // Filter states that overlap with count time range
        const relevantStates = group.states.filter(state => {
          const stateTime = new Date(state.timestamp);
          return stateTime >= firstCountTime && stateTime <= lastCountTime;
        });

        if (relevantStates.length > 0) {
          const pseudoCycle = {
            start: firstCountTime,
            end: lastCountTime,
            startState: relevantStates[0],
            endState: relevantStates[relevantStates.length - 1],
            states: relevantStates,
            duration: lastCountTime - firstCountTime
          };

          const summary = buildSoftrolCycleSummary(
            pseudoCycle,
            sortedCounts,
            countGroup
          );

          if (summary) {
            results.push({
              operatorId,
              machineSerial: parseInt(machineSerial),
              station: parseInt(station),
              ...summary,
            });
          }
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